'use strict'
/* 玩家可读记忆（条款 8/10/13）—— readMemory / correctMemory / chapterRecap
 *
 * 权限原则（默认 PLAYER，fail-closed；未知级别一律降为 PLAYER）：
 *  - 所有类别（事实/承诺/伏笔/关系/事件/人物/已知信息/修正记录/章节回顾）走同一套过滤，
 *    不因类别不同而漏网；DEBUG/SYSTEM 级（canRead('secrets')）才放行秘密。
 *  - secret_from_player / hidden_from_player / secret / visibility:secret|hidden 的记录一律不可读。
 *  - 「秘密实体」：只被隐藏内容引用的实体（人物/组织名）——隐藏事实的 entity_ids、隐藏事件的
 *    participants、隐藏承诺的 counterpart、隐藏关系的两端、以及自身被标记隐藏的实体。
 *    其名字不得出现在任何类别中：记录正文提到该名字的条目整体隐去（fail-closed：宁可少显示，
 *    也不借由实体名/关系/历史泄露）。判定只用「可见叙事证据」反证（非秘密事实 + 非秘密事件参与者）：
 *    隐藏事件/承诺/关系里的人物，若无公开证据，一律按隐藏人物处理，不因「账本里有这条实体记录」而现身。
 *  - 来源回合（turn）与修正历史（before/after/reason/sourceTurn）随记录保留，供 UI 定位原文；
 *    本模块只输出账本原文摘录，不生成任何 AI 摘要。
 *  - 字段口径与 schema/repositories 一致（facts.statement / commitments.content / threads.title+detail /
 *    relationships.description / knowledge.content / events.description / entities.first_seen_turn）；
 *    读写入口顺带重建实体名索引（JSON 往返会把 Map 退化成 {}，见 rebuildNameIndex）。
 */

const { Repos, nameIndex } = require('./repositories')
const { normalizeAccessLevel, canRead } = require('./access')

const fields = { facts: ['fact_id', 'statement'], commitments: ['commitment_id', 'content'], threads: ['thread_id', 'detail'], relationships: ['relationship_id', 'description'] }
const MAX_RECAP_EXCERPTS = 24
const MAX_CORRECTIONS = 50
const MAX_CHARACTERS = 12

/* 单条记录是否被标记为玩家不可见（多写法容错，与 patch.js 的归一化对齐并更严） */
function isHidden(rec) {
  if (!rec || typeof rec !== 'object') return false
  if (rec.secret_from_player === true || rec.hidden_from_player === true || rec.secret === true) return true
  const v = String(rec.visibility || '').toLowerCase()
  return v === 'secret' || v === 'hidden'
}

/* 实体名匹配变体（与 repositories.mentionLinks 同规则：全名 + ≥3 字取末 2 字短称） */
function variantsOf(name) {
  const nm = String(name || '').trim().toLowerCase()
  if (nm.length < 2) return []
  return nm.length >= 3 ? [nm, nm.slice(-2)] : [nm]
}

/* 秘密实体名匹配集：即使全部秘密记录已被过滤，仍要按名字兜底（历史/关系/纠错文本可能提到它） */
function privacyNames(story, ids) {
  const names = []
  for (const e of Array.isArray(story.entities) ? story.entities : []) if (ids.has(e.entity_id)) names.push(...variantsOf(e.name))
  return Array.from(new Set(names))
}

/* 隐私上下文：一次性算出「哪些实体名属于隐藏」「哪些事实不可读」。
 * 可见实体判定只看玩家可见的叙事证据（非秘密事实的 entity_ids + 非秘密事件的参与者）——
 * 承诺/关系不参与「可见」判定：它们本身可能正是需要隐藏的目标。
 * 隐藏实体来源（并集）：隐藏事实引用、隐藏事件参与者、隐藏承诺对象、隐藏关系两端、自身隐藏的实体。 */
function buildPrivacy(story, level) {
  if (canRead(level, 'secrets')) return { secretsAllowed: true, hiddenFactIds: new Set(), secretEntityIds: new Set(), names: [] }
  const facts = Array.isArray(story.facts) ? story.facts : []
  const events = Array.isArray(story.events) ? story.events : []
  const entities = Array.isArray(story.entities) ? story.entities : []
  const hiddenFacts = facts.filter(isHidden)
  const secretEntityIds = new Set()
  for (const f of hiddenFacts) for (const id of f.entity_ids || []) secretEntityIds.add(id)
  for (const e of events) if (isHidden(e)) for (const id of e.participants || []) secretEntityIds.add(id)
  for (const c of (Array.isArray(story.commitments) ? story.commitments : [])) if (isHidden(c) && c.counterpart) secretEntityIds.add(c.counterpart)
  for (const r of (Array.isArray(story.relationships) ? story.relationships : [])) if (isHidden(r)) { if (r.source) secretEntityIds.add(r.source); if (r.target) secretEntityIds.add(r.target) }
  for (const r of (Array.isArray(story.relationships) ? story.relationships : [])) if (isHidden(r)) { if (r.source) secretEntityIds.add(r.source); if (r.target) secretEntityIds.add(r.target) }
  const visibleEntityIds = new Set()
  for (const f of facts) if (!isHidden(f)) for (const id of f.entity_ids || []) visibleEntityIds.add(id)
  for (const e of events) if (!isHidden(e)) for (const id of e.participants || []) visibleEntityIds.add(id)
  const secretOnly = new Set()
  for (const id of secretEntityIds) if (!visibleEntityIds.has(id)) secretOnly.add(id)
  for (const e of entities) if (isHidden(e)) secretOnly.add(e.entity_id) // 实体自身被标记隐藏：名字同样不可读
  return { secretsAllowed: false, hiddenFactIds: new Set(hiddenFacts.map((f) => f.fact_id)), secretEntityIds: secretOnly, names: privacyNames(story, secretOnly) }
}

/* 正文是否提到秘密实体名 */
function mentions(text, privacy) {
  if (!privacy || !privacy.names.length) return false
  const t = String(text == null ? '' : text).toLowerCase()
  if (!t) return false
  return privacy.names.some((v) => t.includes(v))
}

function recordOf(story, kind, id) {
  const f = fields[kind]
  if (!f) return null
  const list = Array.isArray(story[kind]) ? story[kind] : []
  return list.find((x) => x && x[f[0]] === id) || null
}

/* 实体名索引重建：JSON 往返（结构化克隆回落 / 快照恢复 / 外部改档）会把 _nameIndex 由 Map
 * 退化成普通对象（truthy 但非 Map）。repositories.nameIndex 自带 instanceof 防御并会懒重建，
 * 这里显式调一次，保证「读记忆 / 纠错」两条入口之后的实体匹配（mentionLinks / findEntity）
 * 走的是重建后的索引，而不是退化对象造成的静默漏匹配。 */
function rebuildNameIndex(story) {
  if (!story || !Array.isArray(story.entities)) return story
  if (story._nameIndex instanceof Map) return story
  story._nameIndex = null
  try { nameIndex(story) } catch { story._nameIndex = null }
  return story
}

/* 单条记录对玩家是否可见 —— readMemory 各类别过滤与 correctMemory 越权闸门共用同一判定，
 * 避免「读不到但改得动」的错位（fail-closed：宁可判不可见）。命中任一条即不可见：
 *  1) 隐藏标记（secret_from_player / hidden_from_player / secret / visibility:secret|hidden）；
 *  2) 正文（含伏笔标题）提到秘密实体名；
 *  3) 承诺的对象、关系的任一端点是「秘密实体」（名字本身不可读）。
 * 状态位（ACTIVE/OPEN）由调用方另行判断，保持各账本语义独立。 */
function visibleRecord(kind, rec, privacy) {
  if (!rec || typeof rec !== 'object') return false
  if (!privacy || privacy.secretsAllowed) return true
  if (isHidden(rec)) return false
  const f = fields[kind]
  const texts = f ? [rec[f[1]], rec.title] : []
  if (texts.some((t) => mentions(t, privacy))) return false
  if (kind === 'commitments' && privacy.secretEntityIds.has(rec.counterpart)) return false
  if (kind === 'relationships' && (privacy.secretEntityIds.has(rec.source) || privacy.secretEntityIds.has(rec.target))) return false
  return true
}

function correctionAllowed(story, mc, privacy) {
  if (!mc || typeof mc !== 'object') return false
  if (mentions(mc.before, privacy) || mentions(mc.after, privacy) || mentions(mc.reason, privacy)) return false
  const rec = recordOf(story, mc.kind, mc.recordId)
  if (rec && !visibleRecord(mc.kind, rec, privacy)) return false
  if (privacy.hiddenFactIds && privacy.hiddenFactIds.has(mc.recordId)) return false
  return true
}

/* 纠错谱系根：事实纠错走「取代」（旧记录 → 新记录），原地改写则 recordId 稳定；
 * 两种情况都要把同一记忆的全部修正串成一条只增不删的历史链。
 * 返回记忆化解析器：一次修正集合内复用，避免逐条回溯造成 O(n²)。 */
function lineageResolver(all) {
  const cache = new Map()
  return (mc) => {
    const key = mc && mc.id
    if (key != null && cache.has(key)) return cache.get(key)
    let root = mc ? mc.recordId : null
    const guard = new Set()
    while (root && !guard.has(root)) {
      guard.add(root)
      const parent = all.find((x) => x && x.resultId === root && x.id !== mc.id)
      if (!parent) break
      root = parent.recordId
    }
    if (key != null) cache.set(key, root)
    return root
  }
}

function emptyMemory(level) {
  return {
    accessLevel: level, facts: [], commitments: [], threads: [], relationships: [],
    events: [], entities: [], knowledge: [], corrections: [], goals: [], characters: [],
    recap: null, scope: { turn: 0, range: null }
  }
}

/* 章节回顾：范围内账本记录的原文摘录（不是 AI 摘要），每条带来源回合与记录 id */
function chapterRecap(story, range, opts) {
  const o = opts || {}
  const level = normalizeAccessLevel(o.accessLevel)
  if (!story) return { fromTurn: 0, toTurn: 0, source: 'ledger-excerpts', note: '', excerpts: [], total: 0, truncated: false }
  const privacy = buildPrivacy(story, level)
  /* 同一套可见性判定（visibleRecord）+ 额外文本（如伏笔 detail 与标题不同源时） */
  const allow = (kind, rec, ...texts) => visibleRecord(kind, rec, privacy) && !texts.some((t) => mentions(t, privacy))
  const total = Number(story.counters && story.counters.turn) || 0
  const from = Math.max(1, Number(range && range.fromTurn) || 1)
  const rawTo = range && range.toTurn != null ? Number(range.toTurn) : total
  const to = Math.max(from, Number.isFinite(rawTo) ? rawTo : total)
  const inRange = (t) => { const n = Number(t) || 0; return n >= from && n <= to }
  const items = []
  const push = (kind, id, turn, text, at, extra) => {
    const body = String(text == null ? '' : text).trim()
    if (!body) return
    items.push(Object.assign({ kind, id, turn: Number(turn) || 0, text: body, at, source: 'ledger' }, extra || {}))
  }
  for (const e of story.events || []) if (inRange(e.turn) && allow('events', e, e.description)) push('event', e.event_id, e.turn, e.description, e.created_at, { type: e.type || 'other', location: e.location || '' })
  for (const f of story.facts || []) if (inRange(f.turn) && f.status === 'ACTIVE' && allow('facts', f, f.statement)) push('fact', f.fact_id, f.turn, f.statement, f.created_at)
  for (const c of story.commitments || []) if (inRange(c.turn) && c.status === 'ACTIVE' && allow('commitments', c, c.content)) push('commitment', c.commitment_id, c.turn, c.content, c.created_at, { dueHint: c.due_hint || '' })
  for (const t of story.threads || []) if (inRange(t.opened_turn) && t.status === 'OPEN' && allow('threads', t, t.title, t.detail)) push('thread', t.thread_id, t.opened_turn, [t.title, t.detail].filter(Boolean).join('：'), t.created_at)
  for (const mc of story.memory_corrections || []) if (inRange(mc.turn) && correctionAllowed(story, mc, privacy)) push('correction', mc.id, mc.turn, mc.after, mc.at, { before: mc.before, reason: mc.reason, sourceTurn: Number(mc.sourceTurn) || 0 })
  items.sort((a, b) => (a.turn - b.turn) || String(a.id).localeCompare(String(b.id)))
  const truncated = items.length > MAX_RECAP_EXCERPTS
  return {
    fromTurn: from, toTurn: to, source: 'ledger-excerpts',
    note: '以下为账本原文摘录（非 AI 摘要），可回原文核对。',
    excerpts: truncated ? items.slice(-MAX_RECAP_EXCERPTS) : items,
    total: items.length, truncated
  }
}

/* 玩家可读记忆。opts: { accessLevel?, fromTurn?, toTurn? }
 * 返回值对 UI 向后兼容（原 7 个键语义不变），新增 goals / characters / knowledge / recap / scope。 */
function readMemory(story, opts) {
  const o = opts || {}
  const level = normalizeAccessLevel(o.accessLevel)
  if (!story) return emptyMemory(level)
  rebuildNameIndex(story) // 退化索引（JSON 往返）先重建，保证后续实体匹配与纠错入口口径一致
  const privacy = buildPrivacy(story, level)
  /* 与章节回顾/纠错共用同一套可见性判定（visibleRecord）：读得到的才改得动 */
  const allow = (kind, rec, ...texts) => visibleRecord(kind, rec, privacy) && !texts.some((t) => mentions(t, privacy))
  const names = new Map((story.entities || []).map((e) => [e.entity_id, e.name]))
  const nameOf = (id) => (privacy.secretEntityIds.has(id) ? '' : (names.get(id) || ''))
  const row = (kind, item) => ({
    kind, id: item[fields[kind][0]], text: item[fields[kind][1]] || '',
    title: kind === 'threads' ? item.title
      : kind === 'relationships' ? [nameOf(item.source), item.relation_type, nameOf(item.target)].filter(Boolean).join(' · ')
        : '',
    status: item.status,
    turn: item.turn || item.opened_turn || 0,
    at: item.updated_at || item.created_at
  })

  const facts = (story.facts || []).filter((x) => x.status === 'ACTIVE' && allow('facts', x, x.statement)).map((x) => row('facts', x)).reverse()
  const commitments = (story.commitments || []).filter((x) => x.status === 'ACTIVE' && allow('commitments', x, x.content)).map((x) => Object.assign(row('commitments', x), { kind_label: x.kind || 'goal', dueHint: x.due_hint || '', importance: x.importance || 0 })).reverse()
  const threads = (story.threads || []).filter((x) => x.status === 'OPEN' && allow('threads', x, x.title, x.detail)).map((x) => row('threads', x)).reverse()
  const relationships = (story.relationships || []).filter((x) => x.status === 'ACTIVE' && allow('relationships', x, x.description)).map((x) => row('relationships', x)).reverse()
  const events = (story.events || []).filter((x) => allow('events', x, x.description)).slice(-60).reverse().map((x) => ({ id: x.event_id, text: x.description, turn: x.turn, at: x.created_at, title: x.location }))
  const entities = (story.entities || [])
    .filter((x) => x.type === 'character' && allow('entities', x, x.name, x.summary) && !privacy.secretEntityIds.has(x.entity_id))
    .map((x) => ({ id: x.entity_id, name: x.name, summary: x.summary || '', turn: x.first_seen_turn }))
  const knowledge = (story.knowledge || [])
    .filter((x) => x.status === 'LEARNED' && !privacy.hiddenFactIds.has(x.fact_ref) && allow('knowledge', x, x.content))
    .map((x) => ({ id: x.knowledge_id, text: x.content, turn: x.turn, at: x.created_at, how: x.how_learned }))
    .reverse()

  /* 修正记录：保留来源回合 + 同一记忆的完整历史链（含被取代的旧记录，只增不删）。
   * 谱系解析一次记忆化：同一条修正链上的记录共享根，避免逐条回溯的 O(n²)。 */
  const correctionsAll = (story.memory_corrections || []).filter((mc) => correctionAllowed(story, mc, privacy))
  const rootOf = lineageResolver(correctionsAll)
  const corrections = correctionsAll.slice(-MAX_CORRECTIONS).reverse().map((mc) => {
    const rec = recordOf(story, mc.kind, mc.recordId)
    const root = rootOf(mc)
    const chain = correctionsAll
      .filter((x) => rootOf(x) === root)
      .sort((a, b) => (a.at || 0) - (b.at || 0))
      .map((x) => ({ id: x.id, recordId: x.recordId, resultId: x.resultId, before: x.before, after: x.after, reason: x.reason, at: x.at, turn: x.turn }))
    return {
      id: mc.id, kind: mc.kind, recordId: mc.recordId, resultId: mc.resultId, lineage: root,
      before: mc.before, after: mc.after, reason: mc.reason, at: mc.at, turn: mc.turn,
      sourceTurn: Number(mc.sourceTurn) || Number(rec && (rec.turn || rec.opened_turn)) || 0,
      history: chain
    }
  })

  /* 未完成目标（活跃承诺，含期限提示）—— kind 保持引擎可纠错的复数类别名 */
  const goals = (story.commitments || [])
    .filter((x) => x.status === 'ACTIVE' && allow('commitments', x, x.content))
    .map((x) => ({ id: x.commitment_id, kind: 'commitments', kindLabel: x.kind || 'goal', text: x.content || '', dueHint: x.due_hint || '', importance: x.importance || 0, turn: x.turn || 0, at: x.updated_at || x.created_at }))
    .sort((a, b) => (b.importance - a.importance) || (b.turn - a.turn))

  /* 关键人物：可见角色 + 可见关系（对方名字同样过滤）+ 提及该角色的可见事实 */
  const characters = (story.entities || [])
    .filter((x) => x.type === 'character' && allow('entities', x, x.name, x.summary) && !privacy.secretEntityIds.has(x.entity_id))
    .slice(0, MAX_CHARACTERS)
    .map((ent) => {
      const state = ent.state && typeof ent.state === 'object' ? JSON.stringify(ent.state) : ''
      return {
        id: ent.entity_id,
        name: ent.name,
        summary: String(ent.summary || '').slice(0, 200),
        state: mentions(state, privacy) ? '' : state.slice(0, 200),
        turn: ent.first_seen_turn || 0,
        relationships: (story.relationships || [])
          .filter((r) => r.status === 'ACTIVE' && (r.source === ent.entity_id || r.target === ent.entity_id) && allow('relationships', r, r.description))
          .map((r) => ({ with: nameOf(r.source === ent.entity_id ? r.target : r.source), type: r.relation_type || '', strength: r.strength != null ? Number(r.strength) : null }))
          .filter((r) => r.with)
          .slice(0, 6),
        facts: (story.facts || [])
          .filter((f) => f.status === 'ACTIVE' && allow('facts', f, f.statement) && String(f.statement || '').includes(ent.name))
          .slice(0, 3).map((f) => ({ id: f.fact_id, text: String(f.statement || '').slice(0, 160), turn: f.turn || 0 }))
      }
    })

  const range = (o.fromTurn != null || o.toTurn != null)
    ? { fromTurn: o.fromTurn != null ? Number(o.fromTurn) : 1, toTurn: o.toTurn != null ? Number(o.toTurn) : (Number(story.counters && story.counters.turn) || 0) }
    : null

  return {
    accessLevel: level,
    facts, commitments, threads, relationships, events, entities, knowledge, corrections, goals, characters,
    recap: range ? chapterRecap(story, range, { accessLevel: level }) : null,
    scope: { turn: Number(story.counters && story.counters.turn) || 0, range }
  }
}

/* 纠正记忆：事务内改写，写盘失败整体回滚（内存与磁盘保持一致）。
 * 修正记录保留来源回合（sourceTurn）与原文（before），同一记录的历史链只增不删。
 * 权限闸门与 readMemory 共用 visibleRecord —— 读不到的记忆同样改不动（含秘密实体对象/端点）。 */
function correctMemory(engine, { storyId, kind, id, text, reason }) {
  if (!fields[kind]) throw new Error('此记忆不支持直接纠正')
  const value = String(text || '').trim(), note = String(reason || '').trim()
  if (!value || value.length > 800 || !note || note.length > 300) throw new Error('请填写修正内容（800字以内）与原因（300字以内）')
  if (!engine || !engine.store) throw new Error('世界记忆引擎不可用')
  const original = engine.getStory(storyId)
  if (!original) throw new Error('世界线不存在')
  rebuildNameIndex(original) // 纠错入口同样重建退化索引（事实纠错会走 Repos.addFact → mentionLinks）
  const field = fields[kind]
  const record = (original[kind] || []).find((x) => x[field[0]] === id)
  if (!record) throw new Error('记忆已变化，请刷新后重试')
  /* 权限上下文按 PLAYER 计算：本次修正一旦引入秘密实体名，整条修正记录同样不可读 */
  const privacy = buildPrivacy(original, 'PLAYER')
  if (!visibleRecord(kind, record, privacy) || mentions(value, privacy)) throw new Error('这条记忆不可修改')
  if (!['ACTIVE', 'OPEN'].includes(record.status)) throw new Error('记忆已变化，请刷新后重试')
  if (value === String(record[field[1]] || '').trim()) throw new Error('修正内容与原内容相同')
  if (typeof engine.store.inTransaction === 'function' && engine.store.inTransaction(storyId)) throw new Error('世界记忆正在更新，请稍后重试')

  const now = Date.now()
  const sourceTurn = Number(record.turn || record.opened_turn) || 0
  const story = engine.store.beginTransaction(storyId)
  try {
    const target = (story[kind] || []).find((x) => x[field[0]] === id)
    /* 事务内复查：并发写入可能已把该记录改成隐藏/关闭状态，此时一律回滚不落库 */
    if (!target || !visibleRecord(kind, target, privacy) || !['ACTIVE', 'OPEN'].includes(target.status)) throw new Error('记忆已变化，请刷新后重试')
    let resultId = id
    const before = target[field[1]] || ''
    if (kind === 'facts') {
      const replacement = Repos.addFact(story, { key: target.key, statement: value, importance: target.importance, entity_ids: target.entity_ids }, now)
      target.status = 'SUPERSEDED'; target.superseded_by = replacement.fact_id; target.updated_at = now
      resultId = replacement.fact_id
    } else { target[field[1]] = value; target.updated_at = now }
    const entry = { id: 'MC-' + now.toString(36), kind, recordId: id, resultId, before, after: value, reason: note, at: now, turn: story.counters.turn, sourceTurn }
    story.memory_corrections = (story.memory_corrections || []).concat(entry)
    story.updated_at = now
    engine.store.commitTransaction(storyId) // 写盘失败会抛错 → 下方回滚，内存不留在已提交状态
    const memory = readMemory(engine.getStory(storyId), { accessLevel: 'PLAYER' })
    memory.lastCorrection = { id: entry.id, recordId: id, resultId, sourceTurn, turn: entry.turn }
    return memory
  } catch (error) {
    try { engine.store.rollbackTransaction(storyId) } catch { /* 回滚失败不掩盖原始错误 */ }
    throw error
  }
}

module.exports = { readMemory, correctMemory, chapterRecap }

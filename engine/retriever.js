'use strict'
/* Context Retriever —— 长期记忆检索 v2（条款 4/27/28/29 · 规范十二~二十一）
 *
 * story_id 过滤仍是第一原则：按 story 分文件加载 + 显式 storyId 校验。
 *
 * v2 管线（规范十五）：
 *   用户输入 → [实体解析（名字/代称/关系推断）] → [候选检索（关键词+importance+时间，全账本扫描但带索引加速）]
 *     → [关联扩展：实体共链（文本命中记录 → 其关联实体 → 同实体其他记录）+ 场景实体加权]
 *     → [多信号重排：词面 + 实体关联 + 共链 + 场景 + importance + recency]
 *     → [分类截断 Top-K]
 * 不盲目扩大 Top-K：先扩候选（关联扩展），再重排，最终仍按预算截断。
 *
 * 缓存（规范二十五/二十六/四十三/四十四）：
 *   - 实体索引与查询结果缓存挂在 store 的 retrSlot 上，键含 story_id，值随 state_version 失效
 *     （任何 flushStory/快照恢复/删除都会 bump version 并清空 —— 不存在跨版本读旧缓存）。
 *   - 查询缓存 key = 查询文本 + access_level + limit + entity_names；同 Story 相同查询零重复计算。
 *   - 无 _retr 注入时（直接调用 retrieve）自动退化为无缓存模式，行为不变。
 */

const { DECISION_EFFECTIVE, importanceLabel } = require('./schema')
const { normalizeAccessLevel, canRead } = require('./access')

function tokenize(text) {
  // 轻量中英分词：连续字母数字成词 + CJK 单字（双字组合在匹配时处理）
  return String(text || '').toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || []
}

function textOverlap(queryTokens, text) {
  if (!queryTokens.length) return 0
  const t = String(text || '').toLowerCase()
  let hits = 0
  for (const tok of queryTokens) if (tok && t.includes(tok)) hits++
  return hits / queryTokens.length
}

/* 预小写文本的重叠计算（热路径：账本文本的小写形式随实体索引增量缓存，查询期零字符串分配） */
function overlapLC(queryTokens, lcText) {
  if (!queryTokens.length) return 0
  let hits = 0
  for (const tok of queryTokens) if (tok && lcText.includes(tok)) hits++
  return hits / queryTokens.length
}

/* ---- 实体关联索引（规范二十二/二十三）：按回合水位增量构建，而非每查询/每版本全量重建 ----
 * prev = 上一版本的索引（{ wm, byName, names, byEntity }）；只处理 turn > wm 的新增记录。
 * 记录被取代/状态变化时不回删索引条目：索引只提供「候选增强」，下游仍按 ACTIVE/权限过滤，
 * 失效条目（如已被 SUPERSEDED 的 fact id）不会进入候选池，无正确性影响。 */
function buildEntityIndex(story, prev) {
  const byName = prev ? prev.byName : new Map()
  const names = prev ? prev.names : []
  const byEntity = prev ? prev.byEntity : new Map()
  const lcTexts = prev ? prev.lcTexts : new Map() // id → { a, b }（记录主/辅文本的小写形式）
  const wm = prev ? prev.wm : 0
  const link = (eid, kind, id) => {
    if (!eid) return
    let b = byEntity.get(eid)
    if (!b) { b = {}; byEntity.set(eid, b) }
    const arr = b[kind] || (b[kind] = [])
    arr.push(id)
  }
  let maxTurn = wm
  for (const f of story.facts) {
    if (f.story_id !== story.story_id || f.status !== 'ACTIVE' || f.turn <= wm) continue
    if (f.turn > maxTurn) maxTurn = f.turn
    for (const eid of f.entity_ids || []) link(eid, 'facts', f.fact_id)
    lcTexts.set('f|' + f.fact_id, { a: String(f.statement || '').toLowerCase(), b: String(f.key || '').toLowerCase() })
  }
  for (const e of story.events) {
    if (e.story_id !== story.story_id || e.turn <= wm) continue
    if (e.turn > maxTurn) maxTurn = e.turn
    for (const eid of e.participants || []) link(eid, 'events', e.event_id)
    lcTexts.set('e|' + e.event_id, { a: String(e.description || '').toLowerCase(), b: String(e.location || '').toLowerCase() })
  }
  for (const d of story.decisions) {
    if (d.story_id !== story.story_id || d.turn <= wm) continue
    if (d.turn > maxTurn) maxTurn = d.turn
    const lcD = { a: String(d.raw_input || '').toLowerCase(), b: String(d.normalized_intent || '').toLowerCase() }
    lcTexts.set('d|' + d.decision_id, lcD)
    /* 规范二十三：decision → entity 关联（文本提及已存在实体，玩家自身名除外） */
    const player = String((story.player && story.player.name) || '').toLowerCase()
    const txt = lcD.a + ' ' + lcD.b
    for (const ent of story.entities) {
      if (ent.story_id !== story.story_id) continue
      const nm = String(ent.name || '').toLowerCase()
      if (nm.length < 2 || nm === player) continue
      if (txt.includes(nm)) link(ent.entity_id, 'decisions', d.decision_id)
    }
  }
  for (const r of story.relationships) {
    if (r.story_id !== story.story_id || r.status !== 'ACTIVE' || r.turn <= wm) continue
    if (r.turn > maxTurn) maxTurn = r.turn
    link(r.source, 'rels', r.relationship_id)
    link(r.target, 'rels', r.relationship_id)
  }
  for (const e of story.entities) {
    if (e.story_id !== story.story_id || e.status === 'ARCHIVED') continue
    const nm = String(e.name || '').toLowerCase()
    if (!nm || byName.has(nm)) continue
    byName.set(nm, e.entity_id)
    names.push({ id: e.entity_id, name: nm })
  }
  const decisionsByEntity = new Map() // decision_id → [entity_id]（构建期顺手收集）
  for (const [eid, b] of byEntity) {
    for (const did of b.decisions || []) {
      let arr = decisionsByEntity.get(did)
      if (!arr) { arr = []; decisionsByEntity.set(did, arr) }
      arr.push(eid)
    }
  }
  return { wm: maxTurn, byName, names, byEntity, lcTexts, decisionsByEntity }
}

/* ---- 实体解析（规范十三/十四）：名字命中 + 关系文本推断（代称/间接指称） ---- */
function resolveEntities(story, idx, qText, qTokens) {
  const mentioned = new Map() // entity_id → 权重（1 = 点名，0.4~0.7 = 关系/摘要推断）
  let exact = 0
  for (const { id, name } of idx.names) {
    if (name.length >= 2) { if (qText.includes(name)) { mentioned.set(id, 1); exact++ } }
    else if (qTokens.includes(name)) { mentioned.set(id, 0.8); exact++ }
  }
  // 代称解析：关系文本与查询词面重叠 → 关系双方为隐含主体（“那个救过我的人” → 救命之恩 → 薇拉/凯尔）
  for (const r of story.relationships) {
    if (r.story_id !== story.story_id || r.status !== 'ACTIVE') continue
    const ov = textOverlap(qTokens, (r.relation_type || '') + ' ' + (r.description || ''))
    if (ov >= 0.2) {
      for (const eid of [r.source, r.target]) if (eid && !mentioned.has(eid)) mentioned.set(eid, 0.3 + 0.4 * ov)
    }
  }
  return { mentioned, exact }
}

/* ---- 场景实体集合：当前在场 NPC 的历史天然相关（规范十八） ---- */
function sceneEntities(story) {
  const set = new Set()
  for (const eid of (story.scene && story.scene.participants) || []) set.add(eid)
  return set
}

/* 检索入口
 * opts: { storyId, playerInput, limit?, entityNames?, accessLevel?, includeSecrets?(已废弃，不授予任何权限),
 *         _retr?: { slot }（引擎注入的缓存槽：{ version, entityIndex, queries }） }
 * 权限模型：accessLevel ∈ PLAYER/SYSTEM/DEBUG（条款 8：过滤发生在数据源）
 * includeSecrets 仅保留字段兼容，对权限零作用（条款 7）。 */
function retrieve(story, opts) {
  if (!story || !story.story_id) throw new Error('retrieve: invalid story')
  if (opts.storyId !== story.story_id) throw new Error('cross-story retrieve blocked: ' + opts.storyId + ' vs ' + story.story_id) // 条款 27 硬闸
  const accessLevel = normalizeAccessLevel(opts.accessLevel) // 未知级别 fail-closed 为 PLAYER
  const secretsAllowed = canRead(accessLevel, 'secrets')
  const debugAllowed = canRead(accessLevel, 'debug')

  /* ---- 查询缓存（规范二十五）：key 含查询/权限/limit，随 state_version 整体失效 ---- */
  const slot = opts._retr && opts._retr.slot
  const qKey = accessLevel + '\u0001' + String(opts.playerInput || '') + '\u0001' + (opts.limit || '') + '\u0001' + JSON.stringify(opts.entityNames || [])
  if (slot && slot.queries.has(qKey)) return slot.queries.get(qKey)

  const qTokens = tokenize(opts.playerInput || '')
  const qText = String(opts.playerInput || '').toLowerCase()
  const entityNames = (opts.entityNames || []).map((n) => String(n).toLowerCase())
  const limit = Math.max(3, Math.min(60, Number(opts.limit) || 24))
  const turn = story.counters.turn

  /* ---- 实体索引（缓存于槽，增量构建：只处理上次水位后的新记录） ---- */
  let idx = null, mentioned = null, sceneEids = null, nameExactCount = 0
  if (slot) {
    slot.entityIndex = buildEntityIndex(story, slot.entityIndex)
    idx = slot.entityIndex
  } else {
    idx = buildEntityIndex(story, null)
  }
  const _res = resolveEntities(story, idx, qText, qTokens)
  mentioned = _res.mentioned
  nameExactCount = _res.exact
  sceneEids = sceneEntities(story)

  /* ---- 语义信号（SQLite + sqlite-vec 派生索引，经 _vec 注入，可选）----
   * 双通道（向量 KNN + FTS5）产出 0~1 语义分；任一异常静默回退为纯词面+实体管线。 */
  let semMap = null
  if (opts._vec && opts._vec.enabled) {
    try {
      opts._vec.sync(story)
      semMap = opts._vec.search(story.story_id, String(opts.playerInput || ''), 40)
    } catch { semMap = null }
  }
  const withSem = (key, hit) => {
    if (!semMap) return hit
    const s = semMap.get(key)
    return (s && s > hit) ? s : hit
  }

  const score = (imp, turnDist, textHit, extra) => {
    // 重要度主导 + 时间衰减（重大历史不因时间消失：衰减对高重要度趋近于 0） + 词面/实体命中
    const impNorm = Math.min(101, Math.max(1, Number(imp) || 10))
    const decay = turnDist <= 0 ? 1 : 1 / (1 + turnDist / 40) * (1 - Math.min(0.65, impNorm / 160))
    return impNorm / 100 + decay * 0.45 + textHit * 1.2 + (extra || 0)
  }
  /* 实体关联权重（规范十八：实体相关 > 纯词面相关） */
  const entBoost = (eid, w) => (eid && mentioned.has(eid)) ? mentioned.get(eid) : 0

  const out = { story_id: story.story_id, turn, state_version: slot ? slot.version : null, decisions: [], commitments: [], facts: [], knowledge: [], events: [], threads: [], causal: [], relationships: [], entities: [], scene: null, counts: {} }

  // ---- 场景 ----
  out.scene = Object.assign({}, story.scene)

  // ---- active commitments：无论分数，全部进入（条款 12：ACTIVE 不得自动消失） ----
  out.commitments = story.commitments
    .filter((c) => c.story_id === story.story_id && c.status === 'ACTIVE')
    .map((c) => ({ rec: c, score: 2 + (c.importance || 0) / 100, reason: 'active_commitment' }))

  // ---- open threads：同样全部进入（伏笔必须被记得） ----
  out.threads = story.threads
    .filter((t) => t.story_id === story.story_id && t.status === 'OPEN')
    .map((t) => ({ rec: t, score: 1.6 + (t.importance || 0) / 100, reason: 'open_thread' }))

  // ---- facts：ACTIVE + 权限过滤；实体关联/共链在两遍法中回填 ----
  const factPool = story.facts
    .filter((f) => f.story_id === story.story_id && f.status === 'ACTIVE')
    .filter((f) => secretsAllowed || !f.secret_from_player)
  const factScored = factPool.map((f) => {
    const lc = idx.lcTexts.get('f|' + f.fact_id)
    const hit = withSem('f|' + f.fact_id, lc ? Math.max(overlapLC(qTokens, lc.a), overlapLC(qTokens, lc.b)) : Math.max(textOverlap(qTokens, f.statement), textOverlap(qTokens, f.key)))
    const eids = f.entity_ids || []
    let ent = 0
    for (const eid of eids) { ent = Math.max(ent, entBoost(eid)); if (sceneEids.has(eid)) ent = Math.max(ent, 0.25) }
    const entX = ent + (entityHit(f.entity_ids, story, entityNames) ? 0.5 : 0)
    return { rec: f, _hit: hit, _hitOwn: hit, _eids: eids, _ent: entX, score: score(f.importance, turn - f.turn, hit, 0) + entX, reason: 'fact' }
  })

  // ---- decisions：仅有效的（CONFIRMED/RESOLVED），PROPOSED 不是事实；实体关联/共链/PRF 与事实同管线 ----
  const decisionScored = story.decisions
    .filter((d) => d.story_id === story.story_id && DECISION_EFFECTIVE(d.status))
    .map((d) => {
      const lc = idx.lcTexts.get('d|' + d.decision_id)
      const hit = withSem('d|' + d.decision_id, lc ? Math.max(overlapLC(qTokens, lc.a), overlapLC(qTokens, lc.b)) : Math.max(textOverlap(qTokens, d.raw_input), textOverlap(qTokens, d.normalized_intent)))
      let ent = 0
      const linked = decisionEntityIds(idx, d.decision_id)
      for (const eid of linked) { ent = Math.max(ent, entBoost(eid)); if (sceneEids.has(eid)) ent = Math.max(ent, 0.25) }
      return { rec: d, _hit: hit, _hitOwn: hit, _eids: linked, _ent: ent, score: score(d.importance, turn - d.turn, hit, 0) + ent, reason: 'decision' }
    })
  out.decisions = decisionScored

  // ---- knowledge：玩家所知（LEARNED） ----
  out.knowledge = story.knowledge
    .filter((k) => k.story_id === story.story_id && k.status === 'LEARNED')
    .map((k) => ({ rec: k, score: score(30, turn - k.turn, textOverlap(qTokens, k.content)), reason: 'knowledge' }))

  // ---- events ----
  const eventPool = story.events.filter((e) => e.story_id === story.story_id)
  const eventScored = eventPool.map((e) => {
    const lc = idx.lcTexts.get('e|' + e.event_id)
    const hit = withSem('e|' + e.event_id, lc ? Math.max(overlapLC(qTokens, lc.a), overlapLC(qTokens, lc.b)) : Math.max(textOverlap(qTokens, e.description), textOverlap(qTokens, e.location)))
    let ent = 0
    for (const eid of e.participants || []) { ent = Math.max(ent, entBoost(eid)); if (sceneEids.has(eid)) ent = Math.max(ent, 0.25) }
    const entX = ent + (entityHit(e.participants, story, entityNames) ? 0.5 : 0)
    return { rec: e, _hit: hit, _hitOwn: hit, _eids: e.participants || [], _ent: entX, score: score(e.importance, turn - e.turn, hit, 0) + entX, reason: 'event' }
  })

  // ---- causal：PENDING 的因果承诺（未来果尚未发生） ----
  out.causal = story.causal
    .filter((c) => c.story_id === story.story_id && c.status === 'PENDING')
    .map((c) => ({ rec: c, score: score(c.importance, turn - c.turn, textOverlap(qTokens, c.effect + ' ' + c.cause)), reason: 'pending_causal' }))

  // ---- relationships：ACTIVE；v2 修复文本盲区（词面+代称推断+场景人物加权） ----
  out.relationships = story.relationships
    .filter((r) => r.story_id === story.story_id && r.status === 'ACTIVE')
    .map((r) => {
      const involves = entityNames.filter((n) => nameOf(story, r.source).toLowerCase() === n || nameOf(story, r.target).toLowerCase() === n).length
      const textHit = Math.max(textOverlap(qTokens, r.relation_type + ' ' + (r.description || '')), 0)
      const ent = Math.max(entBoost(r.source), entBoost(r.target))
      return { rec: r, score: 0.8 + (involves ? 1.2 : 0) + Math.abs(r.strength || 0) / 200 + textHit * 1.1 + ent, reason: involves ? 'relationship_scene' : (ent ? 'relationship_entity' : 'relationship') }
    })

  // ---- entities：按提及/代称推断/当前场景 ----
  out.entities = story.entities
    .filter((e) => e.story_id === story.story_id && e.status !== 'ARCHIVED')
    .map((e) => {
      const eid = e.entity_id
      const mention = mentioned.get(eid) || 0
      const inScene = sceneEids.has(eid) ? 0.35 : 0
      const named = entityNames.includes(String(e.name || '').toLowerCase())
      return {
        rec: e,
        score: 0.6 + (named ? 1.5 : 0) + mention * 1.2 + inScene + textOverlap(qTokens, e.name + ' ' + (e.summary || '')) + Object.keys(e.state || {}).length * 0.02,
        reason: named ? 'entity_mentioned' : (mention >= 1 ? 'entity_resolved' : (inScene ? 'entity_scene' : 'entity'))
      }
    })

  /* ---- 共链扩展 + 伪相关反馈查询扩展 + 多样化截断（规范十五/十六/十七/二十）----
   * 共链：仅「强种子」（词面命中 ≥0.25 且重要度 ≥60）的实体关联扩散加权，权重按
   * 「词面需求 × 时间需求」缩放；过广实体（家族 >50，如被自动提及的主角）不扩散。
   * 查询扩展（PRF）：仅当查询未解析出任何实体（纯代称/模糊指称）时，从强种子文本取
   * 共识实体名，至多抬 3 条同实记录（防家族淹没截断窗）；显式查询信任自身词面。
   * 多样化截断：各分类 cap = 前 N-R 条按最终分 + R 条按自身词面 merits 补位——
   * 重大历史不因同主题家族竞争而消失（规范二十的机制化）。 */
  const coBoost = new Map() // 'f|id' / 'e|id' / 'd|id' → boost
  const strongSeeds = [].concat(factScored, eventScored, decisionScored)
    .filter((it) => it._hit >= 0.25 && it.rec.importance >= 60)
    .sort((a, b) => (b._hit * 1.2 + b.rec.importance / 100) - (a._hit * 1.2 + a.rec.importance / 100))
    .slice(0, 12)
  for (const it of strongSeeds) {
    for (const eid of it._eids || []) {
      const b = idx.byEntity.get(eid)
      if (!b || ((b.facts || []).length + (b.events || []).length + (b.decisions || []).length) > 50) continue
      for (const id of b.facts || []) { const k = 'f|' + id; coBoost.set(k, Math.max(coBoost.get(k) || 0, 0.35)) }
      for (const id of b.events || []) { const k = 'e|' + id; coBoost.set(k, Math.max(coBoost.get(k) || 0, 0.35)) }
      for (const id of b.decisions || []) { const k = 'd|' + id; coBoost.set(k, Math.max(coBoost.get(k) || 0, 0.35)) }
    }
  }
  const impliedNames = []
  if (nameExactCount === 0) {
    const prfSeeds = [].concat(factScored, eventScored, decisionScored)
      .filter((it) => it._hit >= 0.2 && it.rec.importance >= 70)
      .sort((a, b) => b._hit - a._hit).slice(0, 6)
    const nameCount = new Map()
    for (const it of prfSeeds) {
      const txt = String(it.rec.statement || it.rec.description || it.rec.raw_input || '').toLowerCase()
      if (!txt) continue
      for (const { name } of idx.names) {
        if (name.length >= 2 && txt.includes(name) && qText.indexOf(name) < 0) nameCount.set(name, (nameCount.get(name) || 0) + 1)
      }
    }
    const need = Math.max(1, Math.ceil(prfSeeds.length / 2))
    let best = null
    for (const [nm, cnt] of nameCount) {
      if (cnt >= need && (!best || cnt > nameCount.get(best))) best = nm
    }
    if (best) impliedNames.push(best)
  }
  const nameTok = impliedNames.length ? (impliedNames[0].match(/[一-鿿]|[a-z0-9_]+/g) || []) : []
  /* PRF 名额：每个隐含实体至多 3 条（按重要度+自身命中挑），防家族淹没 */
  const prfMark = new Set()
  if (nameTok.length) {
    const cands = []
    const collect = (arr, kind, idKey) => {
      for (const it of arr) {
        const lc = idx.lcTexts.get(kind + '|' + it.rec[idKey])
        const nh = lc ? overlapLC(nameTok, lc.a) : 0
        if (nh > 0) cands.push({ k: kind + '|' + it.rec[idKey], imp: it.rec.importance, own: it._hit })
      }
    }
    collect(factScored, 'f', 'fact_id')
    collect(eventScored, 'e', 'event_id')
    collect(decisionScored, 'd', 'decision_id')
    cands.sort((a, b) => (b.imp + b.own * 100) - (a.imp + a.own * 100))
    for (const c of cands.slice(0, 3)) prfMark.add(c.k)
  }
  const rescore = (arr, kind) => {
    const idKey = kind === 'f' ? 'fact_id' : (kind === 'd' ? 'decision_id' : 'event_id')
    for (const it of arr) {
      const key = kind + '|' + it.rec[idKey]
      const lc = idx.lcTexts.get(key)
      let hit = it._hit, prf = false
      if (nameTok.length && prfMark.has(key)) {
        const nh = lc ? overlapLC(nameTok, lc.a) : 0
        if (nh > 0) { hit = Math.min(0.9, hit + 0.5 * nh); prf = true }
      }
      const b = coBoost.get(key)
      const scale = b ? (1 - Math.min(1, hit / 0.3)) * Math.min(1, (turn - it.rec.turn) / 50) : 0
      const impNorm = Math.min(101, Math.max(1, Number(it.rec.importance) || 10))
      const decay = (turn - it.rec.turn) <= 0 ? 1 : 1 / (1 + (turn - it.rec.turn) / 40) * (1 - Math.min(0.65, impNorm / 160))
      it._hit = hit
      it.score = impNorm / 100 + decay * 0.45 + hit * 1.2 + (b ? b * scale : 0) + (it._ent || 0)
      if (b && scale > 0) it.reason = kind === 'f' ? 'fact_colink' : (kind === 'd' ? 'decision_colink' : 'event_colink')
      else if (prf) it.reason = kind === 'f' ? 'fact_prf' : (kind === 'd' ? 'decision_prf' : 'event_prf')
    }
  }
  rescore(factScored, 'f')
  rescore(eventScored, 'e')
  rescore(decisionScored, 'd')
  out.facts = factScored
  out.events = eventScored
  out.decisions = decisionScored

  /* 多样化截断：前 N-R 按最终分，R 个保留槽按自身词面 merits 补位 */
  const capDiverse = (arr, n, reserve) => {
    arr.sort((a, b) => b.score - a.score)
    if (!reserve || arr.length <= n) return arr.slice(0, n)
    const head = arr.slice(0, n - reserve)
    const rest = arr.slice(n - reserve)
    rest.sort((a, b) => (b._hitOwn * 1.2 + b.rec.importance / 100) - (a._hitOwn * 1.2 + a.rec.importance / 100))
    return head.concat(rest.slice(0, reserve))
  }
  out.facts = capDiverse(factScored, 14, 4)
  out.decisions = capDiverse(decisionScored, 12, 3)
  out.events = capDiverse(eventScored, 12, 3)
  // ---- 各类截断（重要度高的优先保留） ----
  const cap = (arr, n, key = 'score') => { arr.sort((a, b) => b[key] - a[key]); return arr.slice(0, n) }
  /* facts/decisions/events 已由 capDiverse 多样化截断（保留槽防家族淹没） */
  out.knowledge = cap(out.knowledge, 8)
  out.causal = cap(out.causal, 8)
  out.entities = cap(out.entities, 12)
  out.relationships = out.relationships.sort((a, b) => b.score - a.score).slice(0, 10)
  out.commitments = out.commitments.sort((a, b) => b.score - a.score).slice(0, 10)
  out.threads = out.threads.sort((a, b) => b.score - a.score).slice(0, 8)

  // ---- 全局预算：总分排序后整体限量（条款 42 性能：不无限膨胀 context） ----
  out.retrieved_ids = []
  for (const grp of ['commitments', 'threads', 'facts', 'decisions', 'events', 'knowledge', 'causal', 'relationships', 'entities']) {
    for (const it of out[grp]) out.retrieved_ids.push(it.rec[grpIdField(grp)])
  }
  if (debugAllowed) out.debug = { query_tokens: qTokens.length, entity_names: entityNames, access_level: accessLevel, resolved_entities: Array.from(mentioned.keys()).slice(0, 12), colinked: coBoost.size, generated_at: Date.now(), importance_legend: importanceLabel(101) + '>…>' + importanceLabel(1) }

  /* 写入查询缓存（LRU 上限 24；版本 bump 时整体清空 —— store.flushStory 负责） */
  if (slot) {
    if (slot.queries.size >= 24) { const first = slot.queries.keys().next().value; if (first !== undefined) slot.queries.delete(first) }
    slot.queries.set(qKey, out)
  }
  return out
}

function grpIdField(grp) {
  const map = { commitments: 'commitment_id', threads: 'thread_id', facts: 'fact_id', decisions: 'decision_id', events: 'event_id', knowledge: 'knowledge_id', causal: 'causal_id', relationships: 'relationship_id', entities: 'entity_id' }
  return map[grp] || 'id'
}

function entityHit(entityIds, story, entityNames) {
  if (!entityNames.length || !entityIds || !entityIds.length) return false
  return entityIds.some((id) => { const e = story.entities.find((x) => x.entity_id === id); return e && entityNames.includes(e.name.toLowerCase()) })
}

function decisionEntityIds(idx, decisionId) {
  return (idx.decisionsByEntity && idx.decisionsByEntity.get(decisionId)) || []
}

function nameOf(story, entityId) {
  const e = story.entities.find((x) => x.entity_id === entityId)
  return e ? e.name : String(entityId || '')
}

module.exports = { retrieve, tokenize, textOverlap, buildEntityIndex }

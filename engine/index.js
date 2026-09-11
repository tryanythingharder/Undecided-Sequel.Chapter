'use strict'
/* 引擎组合入口 —— createEngine(dataDir)
 * 渲染层（经 IPC）与测试（直接 require）共用这一入口。
 */
const { StateStore } = require('./store')
const { Repos } = require('./repositories')
const { retrieve } = require('./retriever')
const { buildContextBlock, stateOverview } = require('./context-builder')
const { commitPatch, commitFromRaw } = require('./commit')
const { createSnapshot, restoreSnapshot } = require('./snapshot')
const { patchProtocolPrompt } = require('./patch')
const { createVectorStore } = require('./vector-store')
const crypto = require('crypto')

/* 引擎包元数据（轻量落位）：桌面主进程 / 移动端 Javet 桥 / 测试共用同一入口，
 * 版本号与宿主 package.json 同步演进（发布脚本与诊断日志引用此常量）。
 * 不做独立 npm 包拆分（桌面单仓 ROI 低）；生态工具按 engine_version 判别兼容性。 */
const ENGINE_VERSION = '1.5.0'
const ENGINE_META = {
  name: 'sixworlds-engine',
  version: ENGINE_VERSION,
  /* 协议兼容线：低于该版本的故事档需要走迁移（kernel 绑定 sha1 结构变化等破坏性改动时降位） */
  statePatchProtocol: 2, // 1: 基础 State Patch  2: + causal_updates / 关系归一化
  entry: 'engine/index.js',
}

function createEngine(dataDir, opts) {
  const store = new StateStore(dataDir)
  const engine = { store }
  /* 语义索引（SQLite + sqlite-vec，派生层可重建）：不可用时自动降级，检索管线不受影响。
   * opts.apiEmbedder（真实模型 /v1/embeddings 配置）：注入后引擎内向量层启用 api-v1 嵌入器。 */
  const vectorStore = createVectorStore(dataDir, opts && opts.apiEmbedder ? { embedder: 'api-v1', apiEmbedder: opts.apiEmbedder } : undefined)
  engine.vectorStore = vectorStore
  /* 派生索引随正本落盘同步（flushStory 挂点）：commit/事务/恢复等全部写入路径统一在此覆盖，
   * 检索路径不再做同步。retrieve 侧仅留兜底——首查/外部改档时由 store 版本水位判断是否补同步。 */
  store.onAfterFlush((story) => {
    vectorStore.sync(story)
    _storeVers.set(story.story_id, store.retrVersion(story.story_id)) // 挂点已同步 → retrieve 兜底不再重跑水位全遍历
  })
  const _storeVers = new Map() // storyId → store 缓存版本（用于检索兜底同步的脏判断）
  const storeVersionOf = (storyId) => store.retrVersion(storyId)

  /* 创建或获取故事。kernelText 用于计算内核版本绑定（条款 39）；engine_version 供生态工具判别 */
  engine.ensureStory = ({ storyId, title, kernelId, kernelText }) => {
    const kernelVersion = kernelText ? 'sha1:' + crypto.createHash('sha1').update(String(kernelText)).digest('hex').slice(0, 12) : 'unknown'
    if (store.exists(storyId)) {
      const story = store.getStory(storyId)
      return { story, created: false, kernel_version: story.kernel.version, kernel_match: story.kernel.version === kernelVersion, engine_version: ENGINE_VERSION }
    }
    const story = store.createStory({ storyId, title, kernelId, kernelVersion, createdAt: Date.now() })
    return { story, created: true, kernel_version: kernelVersion, kernel_match: true, engine_version: ENGINE_VERSION }
  }

  /* 显式内核迁移（须调用方明确意图） */
  engine.migrateKernel = ({ storyId, kernelId, kernelText }) => {
    const story = store.getStory(storyId)
    if (!story) throw new Error('story not found')
    story.kernel = { id: kernelId || story.kernel.id, version: 'sha1:' + crypto.createHash('sha1').update(String(kernelText || '')).digest('hex').slice(0, 12), bound_at: Date.now(), migrated_from: story.kernel.version }
    store.saveStory(storyId)
    return story.kernel
  }

  engine.getStory = (storyId) => store.getStory(storyId)
  engine.overview = (storyId) => { const s = store.getStory(storyId); return s ? stateOverview(s) : null }
  engine.deleteStory = (storyId) => {
    store.deleteStory(storyId)
    vectorStore.forgetStory(storyId) // 语义索引同步清理（派生层，漏清只浪费空间）
  }
  /* IF 分歧线状态继承（R85）：深拷贝母线全部账本到新故事——IF 线不再是失忆世界。
   * C1 修复（五岗评审）：检索层/仓储层按每条记录内嵌的 story_id 过滤（retriever.js 硬闸），
   * 深拷贝若只改顶层 story_id，继承记录全部被过滤成不可见——必须逐账本重戳归属戳。
   * 派生数据不动：sessions 登记簿/懒索引清零，vector 索引由下次 flush 重建（onAfterFlush 只增不删）。 */
  const LEDGERS = ['decisions', 'commitments', 'knowledge', 'facts', 'events', 'causal', 'relationships', 'threads', 'entities']
  engine.cloneStory = ({ storyId, targetId, title }) => {
    const src = store.getStory(storyId)
    if (!src) throw new Error('story not found: ' + storyId)
    if (store.getStory(targetId)) throw new Error('target story already exists: ' + targetId)
    const cp = JSON.parse(JSON.stringify(src))
    cp.story_id = targetId
    cp.title = title || cp.title
    cp.created_at = Date.now()
    cp.updated_at = Date.now()
    for (const key of LEDGERS) {
      const arr = cp[key]
      if (!Array.isArray(arr)) continue
      for (const rec of arr) rec.story_id = targetId // 归属戳重写：检索过滤层才认领这些继承记录
    }
    cp.sessions = [] // 登记簿按新故事的 session 重开
    cp.discarded_turns = []
    cp.counters.snapshot = 0
    if (cp.scene) cp.scene.turn_started = null
    cp._nameIndex = null // JSON 克隆把 Map 退化成 {}，置空由 nameIndex() 懒重建
    store.putStory(targetId, cp) // 深拷贝对象直接入缓存并落盘（saveStory 只标脏不接收对象）
    store._dropRetrCache(targetId) // 派生缓存已按新 story_id 就位，丢掉懒索引避免 retr 槽带着母线版本串台
    return stateOverview(cp)
  }
  engine.listStories = () => store.listStories()

  engine.openSession = ({ storyId, sessionId, label }) => {
    const story = store.getStory(storyId)
    if (!story) throw new Error('story not found')
    Repos.openSession(story, { session_id: sessionId, label }, Date.now())
    store.saveStory(storyId)
  }
  engine.closeSession = ({ storyId, sessionId }) => {
    const story = store.getStory(storyId)
    if (!story) return
    Repos.closeSession(story, sessionId, Date.now())
    store.saveStory(storyId)
  }

  engine.retrieve = (storyId, opts) => {
    const story = store.getStory(storyId)
    if (!story) throw new Error('story not found: ' + storyId)
    /* 检索兜底同步：正常同步已挂在 flushStory（落盘即同步），这里只处理未走引擎写入的变更
     * （外部改档/直改 stories 目录后的首查）。以 store 缓存版本为脏信号——版本没动、
     * 同步过的 story 直接跳过，把每查一次的水位全量遍历降为版本号比较。 */
    if (vectorStore.enabled) {
      try {
        const ver = storeVersionOf(storyId)
        if (_storeVers.get(storyId) !== ver) {
          vectorStore.sync(story)
          _storeVers.set(storyId, ver)
        }
      } catch { /* 兜底失败不阻断检索 */ }
    }
    /* 注入检索缓存槽（规范二十五/四十三）：版本随 flushStory/恢复/删除自动失效，按 story 隔离；
     * 注入语义索引（SQLite + sqlite-vec）：同步与查询失败时由 retriever 静默回退 */
    return retrieve(story, Object.assign({ storyId }, opts || {}, { _retr: { slot: store.retrSlot(storyId) }, _vec: vectorStore }))
  }

  /* 释放引擎持有的资源（语义索引的 SQLite 句柄；Windows 上不关会锁目录） */
  engine.close = () => { try { vectorStore.close() } catch {} }

  engine.buildContext = (storyId, opts) => {
    const story = store.getStory(storyId)
    if (!story) return null
    const o = opts || {}
    const retrieved = engine.retrieve(storyId, o) // accessLevel 由 retriever 在数据源过滤（条款 8）
    const budget = {}
    const block = buildContextBlock(story, retrieved, o.accessLevel, budget) // 二次权限校验（条款 10）
    return { block, retrieved, overview: stateOverview(story), budget } // budget：Context 构成/截断审计（规范三十八）
  }

  engine.commitFromRaw = (raw, meta) => commitFromRaw(engine, raw, meta)
  engine.commitPatch = (patch, meta) => commitPatch(engine, patch, meta)

  /* ---- Pending Commit（条款 18/19/26/27/28）----
   * 叙事已生成但结构化状态未正式提交时落盘；重启后可扫描恢复，仅限原 Story 补录。 */
  engine.recordPending = ({ storyId, sessionId, playerInput, narrative, patchError, retryCount, turnId, stateVersion }) => {
    const story = store.getStory(storyId)
    if (!story) throw new Error('story not found: ' + storyId)
    story.counters.pending_seq = (story.counters.pending_seq || 0) + 1
    store.saveStory(storyId)
    const rec = {
      pending_id: 'PC-' + String(story.counters.pending_seq).padStart(6, '0'),
      story_id: storyId,
      session_id: sessionId || null,
      player_input: String(playerInput || '').slice(0, 2000),
      narrative: String(narrative || '').slice(0, 20000),
      patch_error: String(patchError || '').slice(0, 500),
      retry_count: Number(retryCount) || 0,
      current_state_version: Number(stateVersion) != null ? Number(stateVersion) : story.counters.turn,
      turn_id: turnId || null,
      status: 'PENDING_COMMIT',
      created_at: Date.now(),
      updated_at: Date.now()
    }
    store.savePending(rec)
    return rec
  }
  engine.listPendings = (storyId) => store.listPendings(storyId)
  engine.getPending = (storyId, pendingId) => store.readPending(storyId, pendingId)
  engine.resolvePending = ({ storyId, pendingId, raw }) => {
    const pc = store.readPending(storyId, pendingId)
    if (!pc) throw new Error('pending not found: ' + pendingId)
    if (pc.story_id !== storyId) throw new Error('cross-story pending resolve blocked: ' + pc.story_id + ' vs ' + storyId) // 条款 27 硬闸
    const r = commitFromRaw(engine, raw, { storyId, sessionId: pc.session_id, playerInput: pc.player_input, intent: String(pc.player_input || '').slice(0, 200), rawOutput: raw })
    if (r.ok && r.committed) {
      store.deletePending(storyId, pendingId)
      return { resolved: true, result: r }
    }
    pc.retry_count = (pc.retry_count || 0) + 1
    pc.patch_error = (r.errors && r.errors.length ? r.errors[0].message : (r.warnings[0] && r.warnings[0].message) || r.patch_status || 'unknown')
    pc.updated_at = Date.now()
    store.savePending(pc)
    return { resolved: false, result: r }
  }
  engine.discardPending = ({ storyId, pendingId }) => {
    const pc = store.readPending(storyId, pendingId)
    if (!pc) return { discarded: false }
    if (pc.story_id !== storyId) throw new Error('cross-story pending discard blocked')
    store.deletePending(storyId, pendingId)
    return { discarded: true }
  }

  engine.snapshot = (storyId, label) => {
    const story = store.getStory(storyId)
    if (!story) throw new Error('story not found')
    return createSnapshot(store, story, label)
  }
  engine.restoreSnapshot = (storyId, snapshotId) => {
    const story = restoreSnapshot(store, storyId, snapshotId)
    store.replaceStory(storyId, story)
    return story
  }
  engine.listSnapshots = (storyId) => store.listSnapshots(storyId)

  engine.turnLogs = (storyId) => store.listTurnLogs(storyId)
  engine.turnLog = (storyId, turnId) => store.readTurnLog(storyId, turnId)

  /* ---- 漫画回放素材（Comic Replay）：把事件账本整编为分镜师可读的素材 ----
   * 纯读函数（不落盘、不建账本）。范围内 events 按 turn 分组，participants 的
   * entity_id 翻译为角色名；每回合取 importance 最高的 events 作为该幕代表（压缩器）。
   * cast 素材：character 实体的 name/summary/state 摘要，供外观表生成。
   * turnLogs 增强：60 轮内的 patch（scene/participants 实名）补入该幕素材。 */
  engine.comicSource = (storyId, fromTurn, toTurn) => {
    const story = store.getStory(storyId)
    if (!story) return null
    const from = Math.max(1, Number(fromTurn) || 1)
    const to = Math.min(Number.isFinite(Number(toTurn)) ? Number(toTurn) : (story.counters.turn || 1), story.counters.turn || 1)
    return buildComicSource(story, from, Math.max(from, to), store)
  }

  /* ---- 角色闪卡素材（Holo Card）：character 实体的制卡档案 ----
   * 纯读函数（不落盘、不建账本）。每个角色 = 实体档案 + 相关 ACTIVE facts（提及该角色）
   * + 关系网（双向）+ 高重要度事件（参与）+ 近期场景行。玩家不在 entities 时补位。
   * 输出供 pet:agent 'card' 任务规划卡面文案（称号/招式/一句话/生图提示词）。 */
  engine.cardSource = (storyId) => {
    const story = store.getStory(storyId)
    if (!story) return null
    return buildCardSource(story)
  }

  engine.protocolPrompt = patchProtocolPrompt
  engine.meta = ENGINE_META
  return engine
}

/* 素材整编（导出供单测：引擎无 I/O，可直接构造 story 断言压缩器行为） */
function buildComicSource(story, fromTurn, toTurn, store) {
  const entById = new Map(story.entities.map((e) => [e.entity_id, e]))
  const nameOf = (eid) => { const e = entById.get(eid); return (e && e.name) || eid }
  // 范围内事件 → 按回合分桶（保持 turn 升序）
  const byTurn = new Map()
  for (const ev of story.events) {
    const t = Number(ev.turn) || 0
    if (t < fromTurn || t > toTurn) continue
    if (!byTurn.has(t)) byTurn.set(t, [])
    byTurn.get(t).push(ev)
  }
  // turnLogs（60 轮内滚动）的 patch 素材：turn → scene 摘要（实名）
  const patchByTurn = new Map()
  try {
    if (store && typeof store.listTurnLogs === 'function') {
      for (const tid of store.listTurnLogs(story.story_id)) {
        const log = store.readTurnLog(story.story_id, tid)
        const patch = log && log.parsed_state_patch
        const turn = Number(patch && patch.turn_summary != null ? log.turn : NaN) || Number(log && log.turn) || NaN
        if (!Number.isFinite(turn)) continue
        patchByTurn.set(turn, patch)
      }
    }
  } catch { /* 日志缺失不阻断素材整编 */ }

  const turns = []
  for (const t of Array.from(byTurn.keys()).sort((a, b) => a - b)) {
    const evs = byTurn.get(t)
    // 压缩器：每回合取 importance 最高的前 4 条事件描述（同分按账本顺序），转场（arrival/departure）必留
    const picked = evs.slice().sort((a, b) => (b.importance || 0) - (a.importance || 0)).slice(0, 4)
    const transitions = evs.filter((e) => e.type === 'arrival' || e.type === 'departure').filter((e) => !picked.includes(e))
    const representative = picked[0] || evs[0]
    const patch = patchByTurn.get(t) || null
    const participants = Array.from(new Set(
      evs.flatMap((e) => Array.isArray(e.participants) ? e.participants : []).map(nameOf)
    )).filter(Boolean)
    turns.push({
      turn: t,
      location: representative.location || '',
      game_time: representative.game_time || '',
      summary: (patch && patch.turn_summary) || '',
      participants,
      scene: (patch && patch.scene) ? {
        location: patch.scene.location || '',
        game_time: patch.scene.game_time || '',
        participants: (Array.isArray(patch.scene.participants) ? patch.scene.participants : []).slice(0, 12)
      } : null,
      events: picked.concat(transitions.slice(0, 2)).map((e) => ({
        type: e.type, description: e.description, importance: e.importance || 0
      }))
    })
  }
  // cast 素材：character 实体（含玩家）档案摘要；玩家与实体同名时去重（以实体档案为准）
  const cast = story.entities.filter((e) => e.type === 'character').slice(0, 40).map((e) => ({
    name: e.name,
    summary: String(e.summary || '').slice(0, 400),
    state: e.state && typeof e.state === 'object' ? JSON.stringify(e.state).slice(0, 400) : ''
  }))
  if (story.player && story.player.name && !cast.some((c) => c.name === story.player.name)) {
    cast.unshift({ name: story.player.name, summary: '玩家角色', state: story.player.location ? JSON.stringify({ location: story.player.location }) : '' })
  }
  return {
    story_id: story.story_id,
    title: story.title,
    from_turn: fromTurn,
    to_turn: toTurn,
    total_turns: story.counters.turn || 0,
    turns,
    cast
  }
}


/* 闪卡素材整编（导出供单测）：character 实体制卡档案
 * 每个角色：档案（name/summary/state/tags）+ 提及该角色的 ACTIVE facts（前 10）
 * + 关系网（双向，前 8）+ 参与的高重要度事件（前 6）+ 玩家补位。
 * 压缩原则与 comicSource 一致：只做装配，不调任何外部服务。 */
function buildCardSource(story) {
  const byName = (name) => story.entities.filter((e) => e.name === name)
  const factsOf = (name) => story.facts
    .filter((f) => f.status === 'ACTIVE' && String(f.statement || '').includes(name))
    .slice(0, 10)
    .map((f) => ({ statement: String(f.statement || '').slice(0, 200) }))
  const relOf = (ent) => story.relationships
    .filter((r) => r.status === 'ACTIVE' && (r.source === ent.entity_id || r.target === ent.entity_id))
    .slice(0, 8)
    .map((r) => ({
      with: r.source === ent.entity_id ? r.target : r.source,
      type: r.relation_type || '',
      strength: r.strength != null ? Number(r.strength) : null
    }))
  const evOf = (ent) => story.events
    .filter((e) => Array.isArray(e.participants) && e.participants.includes(ent.entity_id))
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, 6)
    .map((e) => ({ turn: e.turn, description: String(e.description || '').slice(0, 160), importance: e.importance || 0 }))
  const characters = story.entities
    .filter((e) => e.type === 'character' && e.status !== 'RETIRED')
    .slice(0, 60)
    .map((ent) => ({
      name: ent.name,
      summary: String(ent.summary || '').slice(0, 400),
      state: ent.state && typeof ent.state === 'object' ? JSON.stringify(ent.state).slice(0, 400) : '',
      tags: Array.isArray(ent.tags) ? ent.tags.slice(0, 10) : [],
      facts: factsOf(ent.name),
      relationships: relOf(ent),
      events: evOf(ent)
    }))
  // 玩家角色补位（同名实体已存在时以实体档案为准）
  if (story.player && story.player.name && !byName(story.player.name).length) {
    characters.unshift({
      name: story.player.name,
      summary: '玩家角色',
      state: story.player.location ? JSON.stringify({ location: story.player.location }) : '',
      tags: [], facts: [], relationships: [], events: []
    })
  }
  // 关系里的 entity_id 顺手翻译成名字（渲染层/LLM 直接可读）
  const nameById = new Map(story.entities.map((e) => [e.entity_id, e.name]))
  for (const c of characters) {
    for (const r of c.relationships) {
      if (r.with && nameById.has(r.with)) r.with = nameById.get(r.with)
    }
  }
  return {
    story_id: story.story_id,
    title: story.title,
    total_turns: story.counters.turn || 0,
    characters
  }
}

module.exports = { createEngine, ENGINE_VERSION, ENGINE_META, buildComicSource, buildCardSource }

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

function createEngine(dataDir) {
  const store = new StateStore(dataDir)
  const engine = { store }
  /* 语义索引（SQLite + sqlite-vec，派生层可重建）：不可用时自动降级，检索管线不受影响 */
  const vectorStore = createVectorStore(dataDir)
  engine.vectorStore = vectorStore

  /* 创建或获取故事。kernelText 用于计算内核版本绑定（条款 39） */
  engine.ensureStory = ({ storyId, title, kernelId, kernelText }) => {
    const kernelVersion = kernelText ? 'sha1:' + crypto.createHash('sha1').update(String(kernelText)).digest('hex').slice(0, 12) : 'unknown'
    if (store.exists(storyId)) {
      const story = store.getStory(storyId)
      return { story, created: false, kernel_version: story.kernel.version, kernel_match: story.kernel.version === kernelVersion }
    }
    const story = store.createStory({ storyId, title, kernelId, kernelVersion, createdAt: Date.now() })
    return { story, created: true, kernel_version: kernelVersion, kernel_match: true }
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

  engine.protocolPrompt = patchProtocolPrompt
  return engine
}

module.exports = { createEngine }

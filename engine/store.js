'use strict'
/* Persistent State Store —— 按故事分文件的持久层
 *
 * 选型理由（对应需求条款 42）：
 *  - 当前 Electron 33（Node 20）无内置 sqlite；better-sqlite3 原生编译会破坏打包链路。
 *  - 桌面单写者、每回合一次提交、写入频率低 —— 文件存储完全够用。
 *  - 每个故事一个文件 = 文件系统级 Story 隔离（条款 4/27），不存在"先查全量再过滤"。
 *  - Repository 抽象层（repositories.js）隔离本实现，未来可无缝替换 SQLite。
 *
 * 事务：staging（内存浅拷贝）→ commit（落盘）→ rollback（丢弃 staging）。
 * 原子写：写 .tmp 后 rename，崩溃自愈（启动时清孤儿 tmp / 用 tmp 抢救主文件）。
 */
const fs = require('fs')
const path = require('path')
const { createStory } = require('./schema')

class StateStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.storiesDir = path.join(dataDir, 'stories')
    this.snapshotsDir = path.join(dataDir, 'snapshots')
    this.pendingsDir = path.join(dataDir, 'pendings') // Pending Commit（条款 18/19：重启可恢复）
    this.logsDir = path.join(dataDir, 'logs')
    this.tmpDir = path.join(dataDir, 'tmp')
    for (const d of [dataDir, this.storiesDir, this.snapshotsDir, this.pendingsDir, this.logsDir, this.tmpDir]) fs.mkdirSync(d, { recursive: true })
    this._cache = new Map() // storyId → { story, dirty }
    this._staging = new Map() // storyId → staged story（事务暂存）
    /* 检索层缓存槽（规范二十四/二十五/四十三）：storyId → { version, entityIndex, queries }
     * store 只负责持有与版本递增（flushStory 即状态变更点），结构与失效策略由 retriever 管理。 */
    this._retrCache = new Map()
    this._recover()
  }

  /* 检索缓存槽：version 单调递增，任何状态落盘（含快照恢复）都会 bump → 所有派生缓存失效 */
  retrSlot(storyId) {
    let c = this._retrCache.get(storyId)
    if (!c) { c = { version: 0, entityIndex: null, queries: new Map() }; this._retrCache.set(storyId, c) }
    return c
  }
  _dropRetrCache(storyId) {
    this._retrCache.delete(storyId)
  }

  // 崩溃自愈：孤儿 tmp 直接清掉
  _recover() {
    try {
      for (const f of fs.readdirSync(this.tmpDir)) {
        try { fs.unlinkSync(path.join(this.tmpDir, f)) } catch {}
      }
    } catch {}
  }

  _storyPath(storyId) {
    // 文件名安全化（storyId 由本引擎生成，但防外部注入）
    const safe = String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.storiesDir, safe + '.json')
  }

  _atomicWrite(filePath, data) {
    const tmp = path.join(this.tmpDir, path.basename(filePath) + '.' + Date.now() + '.tmp')
    fs.writeFileSync(tmp, data, 'utf8')
    // Windows 下 rename 覆盖已有文件会被杀软/索引器瞬态锁定（EPERM/EACCES/EBUSY），重试退避
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, filePath); return } catch (e) {
        if (i >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp) } catch {} ; throw e }
        const wait = [1, 2, 5, 10, 20, 40][i] || 40
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
      }
    }
  }

  _load(storyId) {
    const p = this._storyPath(storyId)
    if (!fs.existsSync(p)) return null
    try {
      const story = JSON.parse(fs.readFileSync(p, 'utf8'))
      story._nameIndex = null
      return story
    } catch (e) {
      // 主文件损坏：尝试同目录残存 tmp（尽力而为），否则报错暴露而非静默吞
      throw new Error('story file corrupt: ' + storyId + ' (' + e.message + ')')
    }
  }

  exists(storyId) {
    if (this._staging.has(storyId)) return true
    if (this._cache.has(storyId)) return true
    return fs.existsSync(this._storyPath(storyId))
  }

  createStory({ storyId, title, kernelId, kernelVersion, createdAt }) {
    if (this.exists(storyId)) return this.getStory(storyId)
    const story = createStory({ storyId, title, kernelId, kernelVersion, createdAt: createdAt || Date.now() })
    this._cache.set(storyId, { story })
    this.flushStory(storyId)
    return story
  }

  getStory(storyId) {
    const st = this._staging.get(storyId)
    if (st) return st
    const c = this._cache.get(storyId)
    if (c) return c.story
    const story = this._load(storyId)
    if (story) this._cache.set(storyId, { story })
    return story
  }

  saveStory(storyId) {
    // 标脏；flush 时统一落盘（也可逐次调用）
    const st = this._staging.get(storyId)
    if (st) { this.flushStory(storyId); return }
    const c = this._cache.get(storyId)
    if (c) this.flushStory(storyId)
  }

  flushStory(storyId) {
    const story = this.getStory(storyId)
    if (!story) return
    /* 性能（基线实测：全量重写随账本线性增长，事务克隆+序列化占 commit 大头）：
     * 不再做 JSON.parse(JSON.stringify()) 克隆 —— 单次 stringify + replacer 剔除懒索引即写盘。
     * 语义不变：仍为整故事原子替换写。 */
    this._atomicWrite(this._storyPath(storyId), JSON.stringify(story, (k, v) => (k === '_nameIndex' ? undefined : v)))
    this._writeMeta(storyId, story)
    this._cache.set(storyId, { story })
    const rc = this._retrCache.get(storyId)
    if (rc) { rc.version += 1; rc.queries.clear() } // 缓存一致性（规范四十三）：状态变更即失效；实体索引按水位增量续建（retriever 管理）
  }

  /* 故事元信息侧车（规范三十二：列表/首屏不解析全量正文） */
  _metaPath(storyId) {
    const safe = String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.storiesDir, safe + '.meta.json')
  }
  _writeMeta(storyId, story) {
    try {
      this._atomicWrite(this._metaPath(storyId), JSON.stringify({
        story_id: story.story_id, title: story.title, created_at: story.created_at, updated_at: story.updated_at, kernel: story.kernel,
        counts: { turns: story.counters && story.counters.turn, decisions: story.decisions.length, facts: story.facts.length, events: story.events.length, entities: story.entities.length, commitments: story.commitments.length, threads: story.threads.length, sessions: story.sessions.length }
      }))
    } catch { /* 侧车失败不阻断主数据 */ }
  }

  // ---- 事务（Scene Commit 用） ----
  beginTransaction(storyId) {
    const story = this.getStory(storyId)
    if (!story) throw new Error('story not found: ' + storyId)
    /* structuredClone：比 JSON 往返快 2-3 倍（性能基线中事务克隆是 commit 的大头之一），
     * 且实体名索引 Map 被完整克隆（仍有效，免懒重建）。故事对象是纯数据，无函数/DOM 引用。 */
    const staged = structuredClone(story)
    this._staging.set(storyId, staged)
    return staged
  }

  commitTransaction(storyId) {
    const staged = this._staging.get(storyId)
    if (!staged) return false
    this._staging.delete(storyId)
    this._cache.set(storyId, { story: staged })
    this.flushStory(storyId)
    return true
  }

  rollbackTransaction(storyId) {
    return this._staging.delete(storyId)
  }

  inTransaction(storyId) {
    return this._staging.has(storyId)
  }

  // 用给定对象替换内存中的故事并落盘（快照恢复用）
  replaceStory(storyId, story) {
    this._staging.delete(storyId)
    this._cache.set(storyId, { story })
    this.flushStory(storyId)
  }

  // ---- 索引：列出全部故事（优先读元信息侧车，不再解析全量正文 —— 条款 42/规范三十二） ----
  listStories() {
    const out = []
    let files = []
    try { files = fs.readdirSync(this.storiesDir) } catch { return out }
    for (const f of files) {
      if (!f.endsWith('.json') || f.endsWith('.meta.json')) continue
      const storyPath = path.join(this.storiesDir, f)
      const metaPath = storyPath.slice(0, -5) + '.meta.json'
      try {
        /* 侧车新鲜（mtime 不早于主文件）→ 直接用；否则退回全量解析（兼容旧数据/侧车丢失） */
        let s = null
        try {
          const mStat = fs.statSync(metaPath), sStat = fs.statSync(storyPath)
          if (mStat.mtimeMs >= sStat.mtimeMs) s = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        } catch { s = null }
        if (!s || !s.story_id) s = JSON.parse(fs.readFileSync(storyPath, 'utf8'))
        /* 侧车 shape 是 counts（展示口径），全量故事是 counters（引擎口径）——两者都兼容 */
        const c = s.counts || s.counters || {}
        const num = (k, arr) => (c[k] !== undefined ? c[k] : (arr || []).length)
        out.push({ story_id: s.story_id, title: s.title, created_at: s.created_at, updated_at: s.updated_at, kernel: s.kernel, counts: {
          turns: c.turns !== undefined ? c.turns : c.turn,
          decisions: num('decisions', s.decisions),
          facts: num('facts', s.facts),
          events: num('events', s.events)
        } })
      } catch {}
    }
    return out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
  }

  deleteStory(storyId) {
    this._cache.delete(storyId)
    this._staging.delete(storyId)
    this._dropRetrCache(storyId)
    try { fs.unlinkSync(this._storyPath(storyId)) } catch {}
    try { fs.unlinkSync(this._metaPath(storyId)) } catch {}
    // 快照、Pending 与日志一并清理（隔离原则：故事没了，附属数据无存在意义）
    this.deleteAllPendings(storyId)
    const sd = path.join(this.snapshotsDir, String(storyId))
    const ld = path.join(this.logsDir, String(storyId))
    for (const d of [sd, ld]) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }
  }

  // ---- Pending Commit 文件（条款 19/26/27：独立落盘，重启可扫描恢复） ----
  _pendingPath(storyId, pendingId) {
    const safeS = String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_')
    const safeP = String(pendingId).replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.pendingsDir, safeS + '.' + safeP + '.json')
  }

  savePending(rec) {
    if (!rec || !rec.story_id || !rec.pending_id) throw new Error('savePending: invalid record')
    this._atomicWrite(this._pendingPath(rec.story_id, rec.pending_id), JSON.stringify(rec, null, 2))
    return rec
  }

  listPendings(storyId) {
    const prefix = String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.'
    let files = []
    try { files = fs.readdirSync(this.pendingsDir) } catch { return [] }
    return files.filter((f) => f.startsWith(prefix) && f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(this.pendingsDir, f), 'utf8')) } catch { return null }
    }).filter(Boolean)
      .filter((r) => r.story_id === storyId) // 双重校验：文件名前缀 + 记录内 story_id（条款 27）
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
  }

  readPending(storyId, pendingId) {
    const p = this._pendingPath(storyId, pendingId)
    if (!fs.existsSync(p)) return null
    try {
      const rec = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (rec.story_id !== storyId) return null // 隔离硬闸（条款 27）
      return rec
    } catch { return null }
  }

  deletePending(storyId, pendingId) {
    const p = this._pendingPath(storyId, pendingId)
    if (!fs.existsSync(p)) return false
    try { fs.unlinkSync(p); return true } catch { return false }
  }

  deleteAllPendings(storyId) {
    const prefix = String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.'
    let files = []
    try { files = fs.readdirSync(this.pendingsDir) } catch { return }
    for (const f of files) if (f.startsWith(prefix)) { try { fs.unlinkSync(path.join(this.pendingsDir, f)) } catch {} }
  }

  // ---- 快照文件 ----
  snapshotPath(storyId, snapshotId) {
    const safe = String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_')
    const safeSnap = String(snapshotId).replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.snapshotsDir, safe, safeSnap + '.json')
  }

  writeSnapshot(storyId, snapshotId, data) {
    const p = this.snapshotPath(storyId, snapshotId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    this._atomicWrite(p, JSON.stringify(data))
    return p
  }

  readSnapshot(storyId, snapshotId) {
    const p = this.snapshotPath(storyId, snapshotId)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  }

  listSnapshots(storyId) {
    const dir = path.join(this.snapshotsDir, String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_'))
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        return { snapshot_id: s.snapshot_id, story_id: s.story_id, label: s.label, turn: s.turn, created_at: s.created_at }
      } catch { return null }
    }).filter(Boolean).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
  }

  // ---- 回合诊断日志（条款 45） ----
  appendTurnLog(storyId, log) {
    const dir = path.join(this.logsDir, String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_'))
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'turn-' + String(log.turn_id || 'x').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json')
    this._atomicWrite(file, JSON.stringify(log)) // 紧凑序列化（诊断日志无需 pretty-print，体积减半）
    // 滚动清理：每故事只留最近 60 个回合日志
    try {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('turn-')).sort()
      while (files.length > 60) { const f = files.shift(); try { fs.unlinkSync(path.join(dir, f)) } catch {} }
    } catch {}
  }

  readTurnLog(storyId, turnId) {
    const dir = path.join(this.logsDir, String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_'))
    const file = path.join(dir, 'turn-' + String(turnId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json')
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }

  listTurnLogs(storyId) {
    const dir = path.join(this.logsDir, String(storyId).replace(/[^a-zA-Z0-9_-]/g, '_'))
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((f) => f.startsWith('turn-')).sort().reverse().map((f) => f.slice(5, -5))
  }
}

module.exports = { StateStore }

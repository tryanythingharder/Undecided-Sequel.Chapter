'use strict'
/* VectorStore —— 长期记忆语义索引（SQLite + sqlite-vec，派生索引，可随时重建）
 *
 * 定位：stories/*.json（StateStore）仍是唯一正本（条款 4/27 不变）；本层是**派生检索索引**，
 * 删除 memory.db 会在下一次 retrieve 时从正本自动重建，不存在第二份真相。
 *
 * 三件套（单文件 userData/story-engine/memory.db）：
 *   chunks      规范化记忆文本（事实/事件/决定），UNIQUE(story_id, kind, rec_id)
 *   chunks_fts  FTS5 关键词通道（unicode61 分词，外部内容表）
 *   chunks_vec  sqlite-vec vec0 向量通道（本地确定性嵌入，见 embed()，维度 256）
 *
 * 检索为双通道融合：向量 KNN（改述/模糊回忆）+ FTS5 BM25（专有名词/精确词面），
 * 输出 0~1 的语义分，作为 retriever.js 的附加信号；融合权重在 search() 内校准，
 * retriever 只做 max(词面, 语义) 折叠。
 *
 * 降级：node:sqlite 缺失 / 扩展加载失败 / 任何写读异常 → enabled=false，
 * 检索管线原样回退为纯词面+实体信号，绝不阻塞引擎。
 */

const EMBED_DIM = 256
/* 语义分校准（实测：相关改述对余弦 0.40~0.57，无关对 ≤0.15）：
 * 低于 BASE 视为无关，线性映射到 0~1 */
const SEM_BASE = 0.25
const SEM_SPAN = 0.5

/* 特征 → 定向哈希（FNV 索引 + 独立种子符号位） */
function hashFeature(v, dim, feat) {
  let h = 2166136261
  let s = 2166136261 ^ 0x9e3779b9
  for (let i = 0; i < feat.length; i++) {
    const c = feat.charCodeAt(i)
    h = Math.imul(h ^ c, 16777619)
    s = Math.imul(s ^ c, 2654435761)
  }
  v[(h >>> 0) % dim] += (s & 1) ? 1 : -1
}

function normalize(v, dim) {
  let norm = 0
  for (let i = 0; i < dim; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i++) v[i] /= norm
  return v
}

/* hash-v1：汉字单字(1×) + CJK 二字组(2×) + 拉丁词。基线嵌入器。 */
function embedV1(text, dim = EMBED_DIM) {
  const v = new Float32Array(dim)
  const toks = String(text || '').toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (/^[\u4e00-\u9fff]$/.test(t)) {
      hashFeature(v, dim, t)
      if (i + 1 < toks.length && /^[\u4e00-\u9fff]$/.test(toks[i + 1])) {
        hashFeature(v, dim, t + toks[i + 1])
        hashFeature(v, dim, t + toks[i + 1])
      }
    } else {
      hashFeature(v, dim, t)
    }
  }
  return normalize(v, dim)
}

/* hash-v2：v1 基础上增加 CJK 跳字组（i,i+2，捕捉「救…之恩」类隔字形态）
 * 与拉丁词前/后缀特征（词形变化鲁棒）。候选升级嵌入器——由 bench-vector A/B 验证后才设为默认。 */
function embedV2(text, dim = EMBED_DIM) {
  const v = new Float32Array(dim)
  const toks = String(text || '').toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || []
  const cjk = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (/^[\u4e00-\u9fff]$/.test(t)) {
      cjk.push(t)
      hashFeature(v, dim, t)
      if (i + 1 < toks.length && /^[\u4e00-\u9fff]$/.test(toks[i + 1])) {
        hashFeature(v, dim, t + toks[i + 1])
        hashFeature(v, dim, t + toks[i + 1])
      }
    } else {
      hashFeature(v, dim, t)
      if (t.length >= 4) {
        hashFeature(v, dim, '^' + t.slice(0, 3))
        hashFeature(v, dim, t.slice(-3) + '$')
      }
    }
  }
  for (let i = 0; i + 2 < cjk.length; i++) hashFeature(v, dim, cjk[i] + '\u0000' + cjk[i + 2])
  return normalize(v, dim)
}

/* 嵌入器注册表：新模型按同形状注册即可；更换 id → 版本水位触发全量重嵌。
 * api-v1：真实模型嵌入（OpenAI 兼容 /v1/embeddings）——经 opts.apiEmbedder 注入
 * { model, dim, baseUrl, apiKey, fetchImpl }；同文本结果持久缓存（emb_cache 表），
 * 未热条目降级为 hash-v1 向量并经 opts.onMiss 异步补嵌（补齐后由调用方推进水位全量重嵌）。
 * 不在同步检索路径上发起网络请求：检索永不阻塞、离线永不降级为失败。 */
const EMBEDDERS = {
  'hash-v1': { id: 'hash-v1', dim: EMBED_DIM, fn: embedV1 },
  'hash-v2': { id: 'hash-v2', dim: EMBED_DIM, fn: embedV2 },
  /* api-v1 真实模型：维度取自注入配置（apiCfg.dim，注册表 0 占位）；向量一律走 emb_cache
   * （embedSync），注册表 fn 仅在「选了 api-v1 却无配置」的降级场景兜底为 hash-v1
   * （此时表维度也回落 256，自洽可用）。 */
  'api-v1': { id: 'api-v1', dim: 0, fn: embedV1 }
}
let activeEmbedderId = process.env.SIXWORLDS_EMBEDDER && EMBEDDERS[process.env.SIXWORLDS_EMBEDDER]
  ? process.env.SIXWORLDS_EMBEDDER
  : 'hash-v1'

function activeEmbedder() {
  return EMBEDDERS[activeEmbedderId]
}

function embed(text, dim = EMBED_DIM) {
  return activeEmbedder().fn(text, dim)
}

function semScore(cosineDistance) {
  const sim = 1 - cosineDistance
  return Math.max(0, Math.min(1, (sim - SEM_BASE) / SEM_SPAN))
}

function storyTexts(story) {
  // kind: f=事实 e=事件 d=决定 —— 与 retriever 的共链键一致
  const rows = []
  for (const f of story.facts) {
    if (f.story_id !== story.story_id) continue
    rows.push({ kind: 'f', rec_id: f.fact_id, turn: f.turn || 0, importance: f.importance || 0, text: (f.statement || '') + ' ' + (f.key || '') })
  }
  for (const e of story.events) {
    if (e.story_id !== story.story_id) continue
    rows.push({ kind: 'e', rec_id: e.event_id, turn: e.turn || 0, importance: e.importance || 0, text: (e.description || '') + ' ' + (e.location || '') })
  }
  for (const d of story.decisions) {
    if (d.story_id !== story.story_id) continue
    rows.push({ kind: 'd', rec_id: d.decision_id, turn: d.turn || 0, importance: d.importance || 0, text: (d.raw_input || '') + ' ' + (d.normalized_intent || '') })
  }
  return rows
}

function structuralWatermark(story) {
  let maxTurn = 0
  for (const arr of [story.facts, story.events, story.decisions]) {
    for (const r of arr) { if ((r.turn || 0) > maxTurn) maxTurn = r.turn }
  }
  return [story.facts.length, story.events.length, story.decisions.length, maxTurn].join(':')
}

function createVectorStore(dataDir, opts) {
  const disabled = { enabled: false, sync() {}, search() { return null }, forgetStory() {}, stats() { return { enabled: false } }, close() {} }
  const fs = require('fs')
  const path = require('path')
  /* 嵌入器选择：显式 opts > 环境变量 > 模块默认（版本水位见 syncInner 的 embedder 检查） */
  let embedderId = (opts && opts.embedder) || activeEmbedderId
  /* api-v1（真实模型）：opts.apiEmbedder = { model, dim, baseUrl, apiKey, fetchImpl? }；
   * 未注入配置时视为未启用（回退 hash 行为），保证引擎在移动桥/测试环境零依赖可用。 */
  const apiCfg = (opts && opts.apiEmbedder && opts.apiEmbedder.baseUrl && opts.apiEmbedder.model && opts.apiEmbedder.dim)
    ? opts.apiEmbedder
    : null
  let db = null
  let cosine = false
  let partitioned = false
  let synced = false
  function ensureMeta() {
    if (synced) return
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS emb_cache (
        h TEXT PRIMARY KEY,
        vec TEXT NOT NULL
      );
    `)
    synced = true
  }

  /* ---------------- api-v1 支撑：确定性缓存 + 异步补嵌（同步路径零网络） ----------------
   * 缓存键 = embedder+文本（sha1）：同文本永不重复请求；条目跨重启持久（emb_cache 表）。
   * 维度约束：vec0 表维度建表即定，真模型维度 ≠ 256 时换嵌入器即整表重建（版本水位机制）；
   * 因此未热条目【不写向量行】（只落 FTS 词面通道），绝不往表里塞维度不符的占位向量。
   * 补嵌完成后自动重同步该故事（resyncAfterWarm），检索质量随缓存热化单调上升、永不阻塞。 */
  const cryptoMod = require('crypto')
  const vecHash = (t) => cryptoMod.createHash('sha1').update(embedderId + '\u0000' + String(t)).digest('hex')
  let missQueue = []
  let missTimer = 0
  let warming = false
  const storyTextMap = new Map() // storyId → 正本 story（补嵌完成后的重同步用）
  function cacheGet(text) {
    try {
      const r = db.prepare('SELECT vec FROM emb_cache WHERE h=?').get(vecHash(text))
      if (!r) return null
      const arr = JSON.parse(r.vec)
      return (Array.isArray(arr) && arr.length) ? Float32Array.from(arr) : null
    } catch { return null }
  }
  function cachePut(text, vec) {
    try { db.prepare('INSERT INTO emb_cache(h, vec) VALUES (?, ?) ON CONFLICT(h) DO UPDATE SET vec=excluded.vec').run(vecHash(text), JSON.stringify(Array.from(vec))) } catch {}
  }
  function cacheHas(text) {
    try { return !!db.prepare('SELECT 1 FROM emb_cache WHERE h=?').get(vecHash(text)) } catch { return false }
  }
  async function fetchEmbeddings(texts) {
    const impl = apiCfg.fetchImpl || (typeof fetch === 'function' ? fetch : null)
    if (!impl) throw new Error('当前环境无可用网络接口')
    const res = await impl(String(apiCfg.baseUrl).replace(/\/+$/, '') + '/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiCfg.apiKey },
      body: JSON.stringify({ model: apiCfg.model, input: texts })
    })
    if (!res.ok) throw new Error('嵌入接口 HTTP ' + res.status)
    const j = await res.json()
    const byIdx = new Map((Array.isArray(j && j.data) ? j.data : []).map((d) => [d.index, d.embedding]))
    const out = texts.map((_, i) => byIdx.get(i))
    if (out.some((v) => !Array.isArray(v) || v.length !== apiCfg.dim)) throw new Error('嵌入接口返回维度不符（期望 ' + apiCfg.dim + '）')
    return out.map((v) => Float32Array.from(v))
  }
  function resyncAfterWarm() {
    // 补嵌落地 → 缓存已热：重同步这批故事（此时全部命中缓存，占位条目转为真向量，水位推进）
    const stories = [...storyTextMap.values()]
    storyTextMap.clear()
    for (const st of stories) { try { syncInner(st) } catch { /* 重同步失败不外抛（异步上下文） */ } }
  }
  function warmMisses() {
    if (warming || !missQueue.length) return
    warming = true
    const batch = missQueue.splice(0, 64)
    fetchEmbeddings(batch.map((x) => x.text)).then((vecs) => {
      vecs.forEach((v, i) => cachePut(batch[i].text, v))
      resyncAfterWarm()
    }).catch((e) => {
      console.warn('[vector-store] 异步补嵌失败（下次未热命中会重新入队）：' + String((e && e.message) || e).slice(0, 120))
      missQueue = [] // 失败清队：离线时不反复打网络；后续未热命中自然重试
    }).finally(() => { warming = false; if (missQueue.length) scheduleWarm() })
  }
  function scheduleWarm() {
    if (missTimer) return
    missTimer = setTimeout(() => { missTimer = 0; warmMisses() }, 150)
  }
  /* 同步嵌入入口（api-v1）：缓存命中 → 真向量；未热 → null（调用方跳过该条的向量行） */
  function embedSync(text) {
    if (embedderId !== 'api-v1' || !apiCfg) return { vec: EMBEDDERS['hash-v1'].fn(text), isPlaceholder: false }
    const hit = cacheGet(text)
    return hit ? { vec: hit, isPlaceholder: false } : { vec: null, isPlaceholder: true }
  }

  // 打包态：asar 内的原生 dll 无法被 SQLite 的原生文件读取器加载，
  // electron-builder asarUnpack 后实际位于 app.asar.unpacked——优先用解包路径
  function extensionPath() {
    const vec = require('sqlite-vec')
    let extPath = vec.getLoadablePath()
    if (extPath.includes('app.asar') && !extPath.includes('app.asar.unpacked')) {
      const unpacked = extPath.replace('app.asar', 'app.asar.unpacked')
      if (fs.existsSync(unpacked)) extPath = unpacked
    }
    return extPath
  }

  function wipeDbFiles() {
    const base = path.join(dataDir, 'memory.db')
    for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(base + suf) } catch {} }
  }

  function isCorruption(err) {
    return /corrupt|malformed|not a database|database disk image/i.test(String((err && err.message) || err))
  }

  function initDb() {
    const { DatabaseSync } = require('node:sqlite')
    fs.mkdirSync(dataDir, { recursive: true })
    db = new DatabaseSync(path.join(dataDir, 'memory.db'), { allowExtension: true })
    db.loadExtension(extensionPath())
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS chunks (
        cid INTEGER PRIMARY KEY,
        story_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        rec_id TEXT NOT NULL,
        turn INTEGER NOT NULL DEFAULT 0,
        importance INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        UNIQUE(story_id, kind, rec_id)
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_story ON chunks(story_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='cid', tokenize='trigram');
    `)
    ensureMeta()
    /* 当前嵌入器维度（api-v1 用真实模型维度，hash 系用 256）——vec0 表维度建表即定 */
    const dim = (embedderId === 'api-v1' && apiCfg) ? Number(apiCfg.dim) : EMBED_DIM
    const vecDimOk = (sql) => new RegExp('FLOAT\\[' + dim + '\\]').test(String(sql || ''))
    /* 存量库结构升级（v1 无分区 → v2 按故事分区，或维度随嵌入器变化）：派生层重建——
     * 向量/倒排/水位全弃、正本不动，各故事下次 flush/检索兜底同步时全量重嵌（零数据损失）。 */
    let oldVecSql = null
    try { oldVecSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='chunks_vec'").get().sql } catch {}
    if (oldVecSql && (!/partition key/i.test(oldVecSql) || !vecDimOk(oldVecSql))) {
      try { db.exec('DROP TABLE chunks_vec') } catch {}
      try { db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('delete-all')") } catch {}
      db.exec('DELETE FROM chunks')
      db.exec("DELETE FROM meta WHERE key LIKE 'wm:%'")
      console.warn('[vector-store] 向量表结构升级（分区/维度 ' + dim + '），旧索引已弃，将按需全量重嵌')
    }
    /* 分区表：KNN 天然限定在单故事分区内，采样窗口不被其他故事稀释。
     * 旧版扩展无分区能力 → 退化为旧表（KNN 超采样后过滤），再无 cosine → L2。 */
    try {
      db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding FLOAT[' + dim + '] distance_metric=cosine, story_id TEXT PARTITION KEY);')
      partitioned = true
    } catch {
      partitioned = false
      try {
        db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding FLOAT[' + dim + '] distance_metric=cosine);')
      } catch {
        db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding FLOAT[' + dim + ']);')
      }
    }
    const quick = db.prepare('PRAGMA quick_check').get()
    if (!quick || !String(quick.quick_check || '').startsWith('ok')) throw new Error('memory.db quick_check failed: ' + (quick && quick.quick_check))
    cosine = (() => { try { return String(db.prepare("SELECT sql FROM sqlite_master WHERE name='chunks_vec'").get().sql).includes('cosine') } catch { return false } })()
    /* 例行维护：批量删档/嵌入器重嵌后空闲页高，文件只增不减——启动时一次性 VACUUM 压缩。
     * 阈值：空闲页 ≥64 页且 ≥ 总页数 1/4（确实浪费才做，常规启动不拖慢）。 */
    try {
      const pc = db.prepare('PRAGMA page_count').get().page_count
      const fc = db.prepare('PRAGMA freelist_count').get().freelist_count
      if (fc >= 64 && fc * 4 >= pc) {
        db.exec('VACUUM')
        console.warn('[vector-store] 例行维护：空闲页 ' + fc + '/' + pc + '，已 VACUUM 压缩 memory.db')
      }
    } catch { /* 维护失败不影响功能 */ }
  }

  /* 损坏自愈：索引是正本的派生层，删库重建零风险（下次检索自动重新同步） */
  function rebuildAfterCorruption(err) {
    if (!isCorruption(err)) return false
    try { db && db.close() } catch {}
    db = null
    wipeDbFiles()
    try {
      initDb()
      console.warn('[vector-store] 检测到索引损坏，已自动重建 memory.db')
      return true
    } catch (e2) {
      console.warn('[vector-store] 已停用（重建失败：' + String((e2 && e2.message) || e2).slice(0, 120) + '）')
      db = null
      return false
    }
  }

  try {
    try {
      initDb()
    } catch (e1) {
      // 首开即坏（文件截断/损坏/版本不符）：删掉重建一次
      if (!rebuildAfterCorruption(e1)) throw e1
    }
  } catch (e) {
    console.warn('[vector-store] 已停用（' + String((e && e.message) || e).slice(0, 120) + '）；检索回退为纯词面+实体信号')
    return disabled
  }

  const watermark = (storyId) => { try { const r = db.prepare('SELECT value FROM meta WHERE key=?').get('wm:' + storyId); return r ? r.value : null } catch { return null } }
  const setWatermark = (storyId, w) => { db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('wm:' + storyId, w) }

  /* vec0 的 rowid 不接受绑定参数（扩展侧校验限制），只能内联整数——此处整数全部经本函数消毒 */
  function cidInt(v) {
    const n = Math.floor(Number(v))
    if (!Number.isFinite(n) || n < 1) throw new Error('invalid cid: ' + v)
    return n
  }

  /* 幂等同步：水位不变直接跳过；否则按正本差量 upsert + 清除已消失记录。
   * 运行中遇索引损坏 → 自动重建后重试一次（派生层，重建无数据损失）。 */
  function sync(story) {
    if (!db || !story || !story.story_id) return
    try {
      syncInner(story)
    } catch (e) {
      if (isCorruption(e) && rebuildAfterCorruption(e)) { syncInner(story); return }
      throw e
    }
  }

  function syncInner(story) {
    ensureMeta()
    /* 嵌入器版本水位：库内向量与当前嵌入器不一致 → 全量失效重建（不同模型的向量不可混用） */
    const storedEmb = (() => { try { const r = db.prepare('SELECT value FROM meta WHERE key=?').get('embedder'); return r ? r.value : null } catch { return null } })()
    if (storedEmb !== embedderId) {
      db.exec('BEGIN')
      try {
        if (partitioned) {
          db.exec('DELETE FROM chunks_vec')
        } else {
          for (const c of [...db.prepare('SELECT cid FROM chunks').iterate()]) {
            db.prepare('DELETE FROM chunks_vec WHERE rowid=' + cidInt(c.cid)).run()
          }
        }
        db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('delete-all')")
        db.exec('DELETE FROM chunks')
        db.exec('DELETE FROM meta')
        db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('embedder', embedderId)
        db.exec('COMMIT')
      } catch (e) {
        try { db.exec('ROLLBACK') } catch {}
        throw e
      }
    }
    const embedFn = EMBEDDERS[embedderId].fn
    const wm = structuralWatermark(story)
    if (watermark(story.story_id) === wm) return
    /* 向量写入：分区表带 story_id 列（TEXT 可绑定；rowid 仍需内联——vec0 主键不接受 REAL 绑定，
     * node:sqlite 把 JS 数字绑定为 real）；旧表（无分区）只写向量。 */
    const insVec = (cid, vec) => partitioned
      ? db.prepare('INSERT INTO chunks_vec(rowid, story_id, embedding) VALUES (' + cid + ', ?, ?)').run(story.story_id, vec)
      : db.prepare('INSERT INTO chunks_vec(rowid, embedding) VALUES (' + cid + ', ?)').run(vec)
    /* api-v1 冷同步的行可能只有 chunks/FTS 而无向量行——重同步时据此判断是否补插 */
    const hasVecRow = (cid, sid) => {
      try {
        return partitioned
          ? !!db.prepare('SELECT 1 FROM chunks_vec WHERE rowid=? AND story_id=?').get(cid, sid)
          : !!db.prepare('SELECT 1 FROM chunks_vec WHERE rowid=?').get(cid)
      } catch { return false }
    }
    const rows = storyTexts(story)
    const seen = new Set()
    let misses = 0
    db.exec('BEGIN')
    try {
      const getRow = db.prepare('SELECT cid, text FROM chunks WHERE story_id=? AND kind=? AND rec_id=?')
      const insChunk = db.prepare('INSERT INTO chunks(story_id, kind, rec_id, turn, importance, text) VALUES (?,?,?,?,?,?)')
      const updChunk = db.prepare('UPDATE chunks SET turn=?, importance=?, text=? WHERE cid=?')
      for (const r of rows) {
        const key = r.kind + '|' + r.rec_id
        seen.add(key)
        const cur = getRow.get(story.story_id, r.kind, r.rec_id)
        /* api-v1：缓存命中用真向量；未热条目不写向量行（维度不符不能占位），FTS 词面通道照常覆盖，
         * 文本入异步补嵌队列——补嵌落地后 resyncAfterWarm 重同步该故事，占位条目转为真向量。 */
        const emb = (embedderId === 'api-v1' && apiCfg) ? embedSync(r.text) : { vec: embedFn(r.text), isPlaceholder: false }
        if (emb.isPlaceholder) {
          // 未热：先落 chunks 行（FTS 通道可用），向量行留空，等补嵌重同步补齐
          if (!cur) { insChunk.run(story.story_id, r.kind, r.rec_id, r.turn, r.importance, r.text); const cid = cidInt(db.prepare('SELECT last_insert_rowid() AS i').get().i); db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?,?)').run(cid, r.text) }
          else { updChunk.run(r.turn, r.importance, r.text, cur.cid); if (cur.text !== r.text) { db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', ?, ?)").run(cur.cid, cur.text); db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?,?)').run(cur.cid, r.text) } }
          misses++
          continue
        }
        const vecVal = JSON.stringify(Array.from(emb.vec))
        if (!cur) {
          const info = insChunk.run(story.story_id, r.kind, r.rec_id, r.turn, r.importance, r.text)
          const cid = cidInt(info.lastInsertRowid)
          insVec(cid, vecVal)
          db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?,?)').run(cid, r.text)
        } else {
          updChunk.run(r.turn, r.importance, r.text, cur.cid)
          /* 文本变化才重算向量与倒排——hash 系同步路径的常规优化；
           * api-v1 额外处理「行存在但向量行缺失」：冷同步只落了 chunks/FTS，补嵌后的
           * 重同步必须补插向量行（文本未变的老优化路径会永远跳过它）。 */
          const vecMissing = (embedderId === 'api-v1' && apiCfg) && !hasVecRow(cur.cid, story.story_id)
          if (cur.text !== r.text || vecMissing) {
            const cid = cidInt(cur.cid)
            if (vecMissing || cur.text !== r.text) db.prepare('DELETE FROM chunks_vec WHERE rowid=' + cid).run()
            insVec(cid, vecVal)
            if (cur.text !== r.text) {
              db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', ?, ?)").run(cid, cur.text)
              db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?,?)').run(cid, r.text)
            }
          }
        }
      }
      // 清除已消失的记录（补丁回滚/删除）
      const stale = [...db.prepare('SELECT cid, kind, rec_id, text FROM chunks WHERE story_id=?').iterate(story.story_id)]
        .filter((c) => !seen.has(c.kind + '|' + c.rec_id))
      for (const c of stale) {
        const cid = cidInt(c.cid)
        db.prepare('DELETE FROM chunks_vec WHERE rowid=' + cid).run()
        db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', ?, ?)").run(cid, c.text)
        db.prepare('DELETE FROM chunks WHERE cid=?').run(cid)
      }
      if (misses > 0) {
        // 占位期不写水位：补嵌落地后 resyncAfterWarm 重走本路径（缓存已热），此时才推进水位。
        // 未热条目可能有旧的真向量（文本未变则不重复删除），由重同步按缓存命中统一收敛。
        db.exec('COMMIT')
        storyTextMap.set(story.story_id, story)
        for (const r of rows) if (!cacheHas(r.text)) { missQueue.push({ text: r.text }); if (missQueue.length > 1024) missQueue.splice(0, missQueue.length - 1024) }
        scheduleWarm()
        return
      }
      setWatermark(story.story_id, wm)
      db.exec('COMMIT')
    } catch (e) {
      try { db.exec('ROLLBACK') } catch {}
      throw e
    }
  }

  /* 双通道检索：向量 KNN（宽松超采样后按故事过滤）+ FTS5，融合取最大语义分。
   * 两通道各自独立隔离异常：单通道失败不拖垮另一通道；索引损坏则重建。 */
  function search(storyId, query, limit = 40) {
    if (!db) return null
    const q = String(query || '').trim()
    if (!q) return null
    const out = new Map()
    const bump = (kind, recId, sim) => {
      if (!(sim > 0)) return
      const key = kind + '|' + recId
      if (sim > (out.get(key) || 0)) out.set(key, sim)
    }
    // —— 向量通道 ——
    try {
      const knn = Math.max(limit * 4, 64)
      /* api-v1：查询向量同样走缓存——未热则本轮跳过向量通道（词面通道兜底），文本入队异步补嵌。
       * 同步检索路径零网络请求。 */
      let qv = null
      if (embedderId === 'api-v1' && apiCfg) {
        const qe = embedSync(q)
        if (qe.isPlaceholder) {
          if (!cacheHas(q)) { missQueue.push({ text: q }); scheduleWarm() }
          qv = null
        } else qv = JSON.stringify(Array.from(qe.vec))
      } else {
        qv = JSON.stringify(Array.from(EMBEDDERS[embedderId].fn(q)))
      }
      /* 分区表：KNN 天然限定单故事分区（采样窗口不被其他故事稀释），无需再按故事过滤；
       * 旧表（扩展无分区能力）：超采样后按故事过滤（rowid → chunks 反查）。 */
      const vecRows = qv && partitioned
        ? [...db.prepare('SELECT rowid AS cid, distance AS d FROM chunks_vec WHERE story_id = ? AND embedding MATCH ? AND k = ?').iterate(storyId, qv, knn)]
        : (qv ? [...db.prepare('SELECT rowid AS cid, distance AS d FROM chunks_vec WHERE embedding MATCH ? ORDER BY d LIMIT ?').iterate(qv, knn)] : [])
      const cidMap = db.prepare('SELECT kind, rec_id FROM chunks WHERE cid=? AND story_id=?')
      for (const r of vecRows) {
        const m = partitioned
          ? { kind: null, rec_id: null, ...(cidMap.get(r.cid, storyId) || {}) }
          : cidMap.get(r.cid, storyId)
        if (!m || !m.rec_id) continue
        // cosine 距离直接用；L2 退化模式下换算回等价余弦距离（单位向量：L2² = 2 - 2cos）
        bump(m.kind, m.rec_id, semScore(cosine ? r.d : (r.d * r.d) / 2))
      }
    } catch (e) {
      if (isCorruption(e)) { try { rebuildAfterCorruption(e) } catch {} }
    }
    // —— FTS5 关键词通道 ——
    try {
      const escaped = q.replace(/["']/g, ' ').trim()
      // trigram 分词器只能匹配 ≥3 字序列：中文长词切三字滑窗；不足 3 字的词跳过（向量通道兜底）
      const terms = []
      for (const w of escaped.split(/\s+/)) {
        if (!w) continue
        if (/^[\u4e00-\u9fff]+$/.test(w)) {
          for (let i = 0; i + 3 <= w.length && terms.length < 24; i++) terms.push('"' + w.slice(i, i + 3) + '"')
        } else if (w.length >= 3 && terms.length < 24) {
          terms.push('"' + w + '"')
        }
      }
      if (terms.length) {
        const ftsQuery = terms.join(' OR ')
        for (const r of [...db.prepare('SELECT rowid AS cid, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?').iterate(ftsQuery, limit)]) {
          const m = db.prepare('SELECT kind, rec_id, story_id FROM chunks WHERE cid=?').get(r.cid)
          if (!m || m.story_id !== storyId) continue
          const sim = Math.max(0, Math.min(1, 1 / (1 + Math.abs(Number(r.rank) || 1))))
          bump(m.kind, m.rec_id, sim * 0.9)
        }
      }
    } catch (e) {
      if (isCorruption(e)) { try { rebuildAfterCorruption(e) } catch {} }
    }
    return out
  }

  /* 故事删除后清理其全部索引残留（engine.deleteStory 调用；索引可重建，漏清只浪费空间） */
  function forgetStory(storyId) {
    if (!db || !storyId) return
    try {
      ensureMeta()
      db.exec('BEGIN')
      try {
        for (const c of [...db.prepare('SELECT cid, text FROM chunks WHERE story_id=?').iterate(storyId)]) {
          const cid = cidInt(c.cid)
          db.prepare('DELETE FROM chunks_vec WHERE rowid=' + cid).run()
          db.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', ?, ?)").run(cid, c.text)
        }
        db.prepare('DELETE FROM chunks WHERE story_id=?').run(storyId)
        db.prepare('DELETE FROM meta WHERE key=?').run('wm:' + storyId)
        db.exec('COMMIT')
      } catch (e) {
        try { db.exec('ROLLBACK') } catch {}
        throw e
      }
    } catch (e) {
      if (isCorruption(e)) { try { rebuildAfterCorruption(e) } catch {} }
    }
  }

  function stats() {
    try {
      const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n
      const stories = db.prepare('SELECT COUNT(DISTINCT story_id) FROM chunks').get()['COUNT(DISTINCT story_id)']
      let pages = null, freelist = null, dbBytes = null
      try {
        pages = db.prepare('PRAGMA page_count').get().page_count
        freelist = db.prepare('PRAGMA freelist_count').get().freelist_count
        dbBytes = pages * db.prepare('PRAGMA page_size').get().page_size
      } catch { /* 诊断字段缺失不阻断 */ }
      const dimNow = (embedderId === 'api-v1' && apiCfg) ? Number(apiCfg.dim) : EMBED_DIM
      return { enabled: true, chunks, stories, dim: dimNow, metric: cosine ? 'cosine' : 'l2', partitioned, embedder: embedderId, pages, freelist, dbBytes }
    } catch { const dimNow = (embedderId === 'api-v1' && apiCfg) ? Number(apiCfg.dim) : EMBED_DIM; return { enabled: true, chunks: 0, stories: 0, dim: dimNow, metric: cosine ? 'cosine' : 'l2', partitioned, embedder: embedderId } }
  }

  /* 收尾维护：checkpoint 把 WAL 并回主库并截断（否则 -wal 文件随使用无限增长），
   * 再关闭句柄（Windows 上句柄不锁目录，rmSync 会 EPERM） */
  function close() {
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    try { db.close() } catch {}
  }

  return { enabled: true, sync, search, forgetStory, stats, close }
}

module.exports = { createVectorStore, embed, semScore, EMBED_DIM, EMBEDDERS, activeEmbedderId }

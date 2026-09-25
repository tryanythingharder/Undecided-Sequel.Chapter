'use strict'
/* ======== 作者工具（桌面主进程） ========
 * 覆盖 docs/desktop-evolution.md 的「内核不可变版本、版本差异、独立试玩与可重现测试记录」
 * 与「精选内核信息、版本/许可/适用模型/题材和预览」两项验收。
 *
 * 设计约束（与仓库既有风格一致）：
 *  - 纯 Node（无 Electron 依赖），与 engine/archive-store.js 一样可直接 require 做单测；
 *  - 内核版本 = 内容 sha1 命名的不可变文件（写一次不再改；同 hash 重复登记只读回原文件）。
 *    目录名是 kernelId 的可读 slug，slug 撞名（user:a.b 与 user:a-b）时共用同一目录，
 *    因此归属一律以版本文件里的 kernelId 为准：列举/读取/去重都精确按 kernelId 过滤，
 *    同 hash 撞名时后写入者用 <hash>-<id8>.json 避免覆盖；
 *  - 沙盒试玩跑在独立引擎目录 author-tools/sandbox/<id>/engine，绝不触碰真实
 *    story-engine 世界线（与 archive-store 的隔离原则一致）；引擎状态是回合数的权威，
 *    meta.json 只是同步缓存：提交后 meta 写失败不回滚也不报失败，而是回包
 *    metadataSaved:false + warning code SANDBOX_META_SYNC_FAILED（UI 提示「已提交但元数据
 *    同步失败，勿重复提交」）；listSandboxes 一律以引擎故事文件的 counters.turn 校正
 *    meta 里的旧值，重启后不会继续显示过期回合数；
 *  - 测试记录真实执行引擎开局 / 失败回滚 / 快照恢复 / 重启持久化 / 隔离校验，
 *    并把内核 hash、脚本 hash、引擎版本与逐用例结果一起落盘，可复跑比对；
 *  - 正文按字节原样保存（不可变版本 + hash 校验的前提，截断/改写都会让校验失去意义）；
 *    正文命中密钥串时拒绝登记（不做静默脱敏），元数据与诊断产物（版本元数据 / 沙盒 meta /
 *    测试记录 / 证据）统一脱敏（密钥字段剔除、sk-/Bearer 串打码）；
 *  - 模型请求默认不发起：沙盒回合必须由调用方显式提交 raw（真实模型）或省略 raw（离线
 *    确定性回合），本模块自身从不联网。runSuite 是确定性结构用例（引擎开局/回滚/恢复/
 *    持久化/隔离），只证明引擎与内核契约，不代表模型叙事质量——记录里 scope/modelInvolved
 *    显式标注，UI 不得把结构测试当作模型试玩结果展示。
 *
 * 主进程接入（两种方式任选，接口等价）：
 *   const at = require('./engine/author-tools.cjs')
 *   at.register({ ipcMain, dataRoot: app.getPath('userData'), queue: queueSessionOperation,
 *                 kernelSource: { list: () => [...], read: (id) => ({ ok, id, name, text }) } })
 *   // 或
 *   const tools = at.createAuthorTools({ dataRoot, kernelSource })
 *   ipcMain.handle('author:versions', async (_e, p) => { try { return { ok: true, data: tools.listVersions(p || {}) } } catch (e) { return { ok: false, error: String(e.message || e) } } })
 *
 * 所有 IPC 回包形状固定为 { ok: true, data } / { ok: false, error }（channel 见 CHANNELS）。
 * register() 的 queue 传入主进程 queueSessionOperation 时，会把该函数吞异常产生的
 * { ok:false, error } 还原成抛错，避免 UI 把失败当数据渲染。
 * kernelSource 可省略（精选库退化为内置精选常量），但传入后可复用现有内核库
 * （main.cjs 的 kernels:list / kernels:read 逻辑）做预览与题材/许可元数据；
 * 也接受直接返回 { ok, kernels } 的 list。
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createEngine, ENGINE_VERSION, ENGINE_META } = require('./index')

const AUTHOR_DIR = 'author-tools'
const SANDBOX_DIR = 'sandbox'
const RECORD_DIR = 'records'
const VERSION_DIR = 'versions'
const HASH_RE = /^[a-f0-9]{12}$/
/* 版本文件名：<hash>.json；当同一目录被不同内核 id 共用（slug 撞名）时，
 * 后写入者加内核 id 指纹后缀 <hash>-<id8>.json，避免互相覆盖/误读。 */
const VERSION_FILE_RE = /^[a-f0-9]{12}(?:-[a-f0-9]{8}(?:-\d{1,3})?)?\.json$/
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/
const MAX_KERNEL_BYTES = 1024 * 1024
const MAX_RECORDS = 80
const MAX_SANDBOXES = 12
const MAX_VERSIONS = 60
const MAX_LISTED_KERNELS = 24
const DIFF_CELL_LIMIT = 2000000
const SECRET_FIELD = /(api[_-]?key|apikey|secret|token|password|authorization|bearer|credential)/i
/* 密钥串模式：每次按需构造正则，避免 /g 的 lastIndex 状态在 test/replace 之间串味 */
const SECRET_TEXT_SOURCE = '\\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}\\b|Bearer\\s+[A-Za-z0-9._-]{12,}'

/* 内置精选元数据：内核文件里没有的策展字段（题材/许可/适用模型）放这里；
 * 标题与版本优先取内核自身 KERNEL_META，缺失时回落本表。 */
const CURATED = {
  'builtin:kernel.md': {
    title: '六面世界：人生模拟器',
    tagline: '人生模拟 · 关系 · 长期记忆',
    genres: ['人生模拟', '开放世界', '长期记忆'],
    license: 'MIT',
    author: '六面世界',
    recommendedModels: ['OpenAI 兼容对话模型', '本地小模型（离线示例）'],
    version: '1.0'
  },
  'builtin:kernel-xianxia.md': {
    title: '玄寰界：修真人生模拟器',
    tagline: '修行成长 · 世界推进 · 因果',
    genres: ['修真', '宗门经营', '因果'],
    license: 'MIT',
    author: '六面世界',
    recommendedModels: ['OpenAI 兼容对话模型'],
    version: '1.1'
  }
}

const nowMs = () => Date.now()
/* 沙盒 meta 同步失败的受控告警：回包只带 code 与固定文案，不回传原始路径/异常串
 * （异常串可能含用户目录等本机路径，UI 无需也不应看到）。
 * 注意：meta 写失败与「引擎是否推进」是两件事 —— 显式 NO_STATE_CHANGE 等合法回合
 * committed=false，但 meta 里的回合数缓存同样需要更新，因此文案不预设已提交。 */
const META_SYNC_FAILED_CODE = 'SANDBOX_META_SYNC_FAILED'
const META_SYNC_FAILED_MESSAGE = '沙盒元数据（meta.json）同步失败：引擎状态为准（回合数/账本以引擎为准，列表下次读取时会自磁盘校正）；本条不表示回合结果，请勿据此重复提交。'
const shortId = (prefix) => prefix + '-' + nowMs().toString(36) + '-' + crypto.randomBytes(3).toString('hex')
const hashText = (text) => crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 12)
const splitLines = (text) => String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')

/* 脱敏（仅用于元数据 / 诊断产物，不用于内核正文）：
 * 剔除密钥字段并对 sk-/Bearer 串打码。内核正文必须逐字节原样保存——截断或改写都会
 * 让 hash 校验失去意义，因此正文不经此函数（见 checkKernelText 的密钥拒绝策略）。 */
function scrub(value, depth) {
  const level = depth || 0
  if (level > 8) return '[deep]'
  if (typeof value === 'string') return value.replace(new RegExp(SECRET_TEXT_SOURCE, 'g'), (m) => (m.startsWith('Bearer') ? 'Bearer [redacted]' : '[redacted-key]')).slice(0, 20000)
  if (Array.isArray(value)) return value.slice(0, 2000).map((item) => scrub(item, level + 1))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) continue
    out[key] = scrub(item, level + 1)
  }
  return out
}
/* 正文里的密钥串探测（拒绝登记，而不是静默改写内容） */
const hasSecretLikeText = (text) => new RegExp(SECRET_TEXT_SOURCE, 'g').test(String(text || ''))

/* KERNEL_META 解析：与 ui/shared/kernel-data.js 的 parseKernelMeta 同语义（主进程侧镜像，
 * 只取策展需要的字段；块损坏时静默回落 null）。 */
function parseKernelMeta(text) {
  const match = String(text || '').match(/<!--KERNEL_META\s*([\s\S]*?)\s*KERNEL_META-->/)
  if (!match) return null
  try {
    const raw = JSON.parse(match[1])
    if (!raw || typeof raw !== 'object') return null
    const out = {}
    for (const key of ['title', 'tagline', 'startLabel', 'startPayload', 'quickLabel', 'version', 'author', 'license']) {
      if (typeof raw[key] === 'string' && raw[key].trim()) out[key] = raw[key].trim()
    }
    if (Array.isArray(raw.origins)) {
      out.origins = raw.origins
        .filter((item) => item && typeof item.label === 'string' && typeof item.text === 'string' && item.label.trim() && item.text.trim())
        .map((item) => ({ label: item.label.trim(), text: item.text.trim() }))
        .slice(0, 8)
      if (!out.origins.length) delete out.origins
    }
    return out
  } catch { return null }
}

/* ---- 行差异（LCS；超限退化为前缀/后缀裁剪 + 整段替换，标记 truncated） ---- */
function diffOps(oldLines, newLines) {
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++
  let tail = 0
  while (tail < oldLines.length - head && tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++
  const a = oldLines.slice(head, oldLines.length - tail)
  const b = newLines.slice(head, newLines.length - tail)
  const ops = []
  for (let i = 0; i < head; i++) ops.push({ type: 'equal', text: oldLines[i] })
  if (a.length * b.length > DIFF_CELL_LIMIT) {
    for (const line of a) ops.push({ type: 'del', text: line })
    for (const line of b) ops.push({ type: 'add', text: line })
    for (let i = oldLines.length - tail; i < oldLines.length; i++) ops.push({ type: 'equal', text: oldLines[i] })
    return { ops, truncated: true }
  }
  const width = b.length + 1
  const table = new Int32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: 'equal', text: a[i] }); i++; j++ }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push({ type: 'del', text: a[i] }); i++ }
    else { ops.push({ type: 'add', text: b[j] }); j++ }
  }
  while (i < a.length) { ops.push({ type: 'del', text: a[i] }); i++ }
  while (j < b.length) { ops.push({ type: 'add', text: b[j] }); j++ }
  for (let k = oldLines.length - tail; k < oldLines.length; k++) ops.push({ type: 'equal', text: oldLines[k] })
  return { ops, truncated: false }
}

function diffText(oldText, newText, options) {
  const context = Math.max(0, Math.min(10, Number(options && options.context) >= 0 ? Number(options.context) : 3))
  const diff = diffOps(splitLines(oldText), splitLines(newText))
  const rows = []
  let oldNo = 1, newNo = 1
  for (const op of diff.ops) {
    rows.push({ type: op.type, text: op.text, oldNo: op.type === 'add' ? null : oldNo, newNo: op.type === 'del' ? null : newNo })
    if (op.type !== 'add') oldNo++
    if (op.type !== 'del') newNo++
  }
  const changed = rows.map((row, index) => (row.type === 'equal' ? -1 : index)).filter((index) => index >= 0)
  const hunks = []
  let last = -1
  for (const index of changed) {
    if (!hunks.length || index - last > context * 2 + 1) {
      hunks.push({ from: Math.max(0, index - context), to: Math.min(rows.length - 1, index + context), indexes: [] })
    }
    const hunk = hunks[hunks.length - 1]
    hunk.to = Math.min(rows.length - 1, index + context)
    hunk.indexes.push(index)
    last = index
  }
  const stats = { added: 0, removed: 0, unchanged: 0 }
  for (const row of rows) stats[row.type === 'equal' ? 'unchanged' : row.type === 'add' ? 'added' : 'removed']++
  return {
    stats,
    truncated: diff.truncated,
    hunks: hunks.map((hunk) => ({
      oldStart: rows[hunk.from] ? rows[hunk.from].oldNo : null,
      newStart: rows[hunk.from] ? rows[hunk.from].newNo : null,
      rows: rows.slice(hunk.from, hunk.to + 1)
    }))
  }
}

/* ---- 可重现测试脚本（确定性回合；不联网、不调模型） ---- */
const SUITE_SCRIPT = [
  {
    id: 'open',
    title: '开局：绑定内核并提交第一回合',
    playerInput: '我在清晨的村口醒来',
    raw: [
      '你睁开眼，薄雾还没散。',
      '<<<STATE_PATCH>>>',
      JSON.stringify({
        turn_summary: '玩家在村口醒来，见到守门人',
        scene: { game_time: '第 1 日 清晨', location: '北门', participants: ['守门人'] },
        player_state: { name: '旅人', location: '北门', status_add: ['清醒'] },
        entity_changes: [{ name: '守门人', type: 'character', summary: '北门值守的中年人' }],
        facts: [{ key: 'north_gate_guard', statement: '北门由一名守门人值守', importance: 40 }],
        events: [{ type: 'action', description: '玩家在村口醒来', importance: 20 }]
      }),
      '<<<END_PATCH>>>'
    ].join('\n'),
    expect: { committed: true, turn: 1, facts: 1, entities: 1 }
  },
  {
    id: 'no-change',
    title: '纯闲聊回合：显式无状态变化不推进计数',
    playerInput: '我问守门人今天天气',
    raw: '他只是笑笑，没有多说。\n<<<NO_STATE_CHANGE>>>',
    expect: { committed: false, patchStatus: 'NO_STATE_CHANGE', turn: 1 }
  },
  {
    id: 'conflict',
    title: '非法引用：确定性冲突整体回滚，不写入半提交',
    playerInput: '我处理一个不存在的伏笔',
    raw: [
      '叙事。',
      '<<<STATE_PATCH>>>',
      JSON.stringify({ turn_summary: '试图更新不存在的伏笔', threads: [{ op: 'update', ref: '不存在的伏笔引用', status: 'RESOLVED' }] }),
      '<<<END_PATCH>>>'
    ].join('\n'),
    expect: { committed: false, patchStatus: 'PATCH_CONFLICT', turn: 1, facts: 1 }
  }
]

function createAuthorTools(config) {
  const options = config || {}
  const dataRoot = path.resolve(String(options.dataRoot || process.cwd()))
  const root = path.join(dataRoot, AUTHOR_DIR)
  const versionRoot = path.join(root, VERSION_DIR)
  const sandboxRoot = path.join(root, SANDBOX_DIR)
  const recordRoot = path.join(root, RECORD_DIR)
  for (const dir of [root, versionRoot, sandboxRoot, recordRoot]) fs.mkdirSync(dir, { recursive: true })
  const kernelSource = options.kernelSource || null
  const engines = new Map() // sandboxId → engine 实例（进程内缓存；磁盘仍是唯一事实来源）

  function atomicWriteJson(file, value) {
    const tmp = file + '.' + nowMs() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); return } catch (error) {
        if (i >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) { try { fs.unlinkSync(tmp) } catch {} ; throw error }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, [1, 2, 5, 10, 20, 40][i] || 40)
      }
    }
  }
  function readJson(file) {
    if (!fs.existsSync(file)) return null
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
  }
  function safeName(value, label) {
    const text = String(value == null ? '' : value).trim()
    if (!text) throw new Error((label || '标识') + '不能为空')
    return text.slice(0, 200)
  }
  function safeDirName(value, label) {
    const text = safeName(value, label)
    if (!ID_RE.test(text)) throw new Error((label || '标识') + '只能是字母、数字、下划线与短横线')
    return text
  }
  function kernelDir(kernelId) {
    const slug = safeName(kernelId, '内核 id').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) throw new Error('内核 id 无法生成目录名')
    return path.join(versionRoot, slug.slice(0, 60))
  }
  /* slug 归一会让 user:a.b 与 user:a-b 落到同一目录（既有的可读目录名保留不动），
   * 因此目录只是桶，真实归属一律以版本文件里的 kernelId 为准：读取/列举/去重全部按
   * kernelId 精确过滤，同 hash 撞桶时后写入者用 id 指纹后缀避免覆盖。 */
  function versionEntries(dir) {
    let files = []
    try { files = fs.readdirSync(dir) } catch { return [] }
    return files.filter((file) => VERSION_FILE_RE.test(file)).flatMap((file) => {
      const data = readJson(path.join(dir, file))
      return data && data.hash && data.kernelId ? [{ file, data }] : []
    })
  }
  function findVersionEntry(dir, kernelId, hash) {
    return versionEntries(dir).find((entry) => entry.data.kernelId === kernelId && entry.data.hash === hash) || null
  }
  /* 落盘文件名：优先 <hash>.json；该名已被别的内核占用时退化为 <hash>-<id8>.json */
  function versionFilePath(dir, kernelId, hash) {
    const id8 = hashText(kernelId).slice(0, 8)
    let file = path.join(dir, hash + '.json')
    for (let i = 1; fs.existsSync(file) && i <= 20; i++) {
      file = path.join(dir, i === 1 ? hash + '-' + id8 + '.json' : hash + '-' + id8 + '-' + i + '.json')
    }
    return file
  }
  function checkKernelText(text) {
    const value = String(text == null ? '' : text)
    if (!value.trim()) throw new Error('内核内容不能为空')
    if (Buffer.byteLength(value) > MAX_KERNEL_BYTES) throw new Error('内核过大（上限 1MB）')
    /* 不可变版本按内容原文保存（否则 hash 校验失效），因此不做静默脱敏：命中密钥串直接拒绝，
     * 由作者自行移除后再登记。 */
    if (hasSecretLikeText(value)) throw new Error('内核内容疑似包含密钥串（sk-/Bearer），已拒绝登记：请先移除密钥再登记（版本按原文不可变保存，不做静默改写）')
    return value
  }
  function recordPath(recordId) { return path.join(recordRoot, safeDirName(recordId, '测试记录编号') + '.json') }
  function sandboxPath(sandboxId) { return path.join(sandboxRoot, safeDirName(sandboxId, '沙盒编号')) }

  /* ---------- 内核不可变版本 ---------- */
  /* 全量列举（按 kernelId 精确过滤；仅供内部与裁剪使用，未截断） */
  function allVersions(kernelId) {
    const dir = kernelDir(kernelId)
    return versionEntries(dir)
      .filter((entry) => entry.data.kernelId === kernelId)
      .map((entry) => entry.data)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
  function listVersions({ kernelId } = {}) {
    return allVersions(kernelId).slice(0, MAX_VERSIONS).map(publicVersion)
  }

  /* 登记版本：同 hash 只写一次（immutable）。重复登记读回原文件，不改写、不覆盖。 */
  function registerVersion(payload) {
    const body = payload || {}
    const kernelId = safeName(body.kernelId, '内核 id')
    /* fromLibrary：从既有内核库读取全文（精选列表里登记版本用，避免渲染层回传大文本） */
    let source = body.text
    if (source == null && body.fromLibrary) {
      const read = libraryRead(kernelId)
      if (!read || typeof read.text !== 'string') throw new Error('内核库中读不到该内核内容：' + kernelId)
      source = read.text
    }
    const text = checkKernelText(source)
    const hash = hashText(text)
    const dir = kernelDir(kernelId)
    fs.mkdirSync(dir, { recursive: true })
    const meta = parseKernelMeta(text)
    const curated = CURATED[kernelId] || null
    const base = {
      id: kernelId + '@' + hash,
      kernelId, hash, name: String(body.name || (meta && meta.title) || (curated && curated.title) || kernelId).slice(0, 200),
      version: String(body.version || (meta && meta.version) || (curated && curated.version) || '').slice(0, 40),
      source: String(body.source || 'user').slice(0, 20),
      note: String(body.note || '').slice(0, 300),
      bytes: Buffer.byteLength(text), text, meta
    }
    const existing = findVersionEntry(dir, kernelId, hash)
    if (existing) {
      if (existing.data.text === base.text) return { created: false, immutable: true, version: publicVersion(existing.data) }
      throw new Error('内核版本文件与内容不一致（hash 冲突），请检查是否被外部改写')
    }
    /* 正文逐字节原样保存（不可变 + hash 校验的前提，已在 checkKernelText 拒绝密钥串）；
     * 元数据字符串仍过脱敏，避免 note/name 里被贴进密钥。 */
    const stored = Object.assign({}, base, {
      name: String(scrub(base.name)), version: String(scrub(base.version)),
      source: String(scrub(base.source)), note: String(scrub(base.note)),
      createdAt: nowMs()
    })
    atomicWriteJson(versionFilePath(dir, kernelId, hash), stored)
    /* 裁剪按文件真实名删除（撞桶时文件名带 id 指纹后缀，不能按 hash 猜路径） */
    const all = versionEntries(dir).filter((entry) => entry.data.kernelId === kernelId)
      .sort((a, b) => (b.data.createdAt || 0) - (a.data.createdAt || 0))
    for (const old of all.slice(MAX_VERSIONS)) { try { fs.unlinkSync(path.join(dir, old.file)) } catch {} }
    return { created: true, immutable: true, version: publicVersion(stored) }
  }
  function publicVersion(data) {
    return {
      id: data.id, kernelId: data.kernelId, hash: data.hash, name: data.name, version: data.version || '',
      title: (data.meta && data.meta.title) || data.name, source: data.source || 'user', note: data.note || '',
      bytes: data.bytes, createdAt: data.createdAt, meta: data.meta || null
    }
  }
  function readVersion(payload) {
    const body = payload || {}
    const kernelId = safeName(body.kernelId, '内核 id')
    const hash = safeName(body.hash, '内核版本 hash')
    if (!HASH_RE.test(hash)) throw new Error('内核版本 hash 格式不正确')
    const dir = kernelDir(kernelId)
    const entry = findVersionEntry(dir, kernelId, hash)
    if (!entry) throw new Error('内核版本不存在：' + hash)
    const data = entry.data
    const intact = hashText(data.text) === hash && Buffer.byteLength(data.text) === Number(data.bytes)
    return Object.assign(publicVersion(data), { text: data.text, intact })
  }

  /* 版本差异：两个已登记版本的逐行对比 */
  function diffVersions(payload) {
    const body = payload || {}
    const kernelId = safeName(body.kernelId, '内核 id')
    const from = readVersion({ kernelId, hash: body.from })
    const to = readVersion({ kernelId, hash: body.to })
    if (from.hash === to.hash) return { kernelId, from: publicVersion(from), to: publicVersion(to), same: true, stats: { added: 0, removed: 0, unchanged: 0 }, hunks: [], truncated: false }
    const diff = diffText(from.text, to.text, { context: body.context })
    return {
      kernelId, from: publicVersion(from), to: publicVersion(to), same: false,
      stats: diff.stats, hunks: diff.hunks, truncated: diff.truncated,
      titleChanged: from.title !== to.title
    }
  }

  /* ---------- 独立沙盒试玩 ---------- */
  function sandboxMeta(sandboxId) {
    return readJson(path.join(sandboxPath(sandboxId), 'meta.json'))
  }
  function engineFor(sandboxId) {
    const cached = engines.get(sandboxId)
    if (cached) return cached
    const meta = sandboxMeta(sandboxId)
    if (!meta) throw new Error('沙盒不存在：' + sandboxId)
    const engine = createEngine(path.join(sandboxPath(sandboxId), 'engine'))
    engines.set(sandboxId, engine)
    return engine
  }
  function closeEngine(sandboxId) {
    const engine = engines.get(sandboxId)
    if (!engine) return
    try { engine.close() } catch { /* Windows 句柄释放失败不阻断删除 */ }
    engines.delete(sandboxId)
  }
  /* 引擎故事文件里的 counters.turn 是回合数的唯一权威（meta.json 只是同步缓存）：
   * 提交后 meta 写失败时列表仍须显示真实回合数而不是旧值。
   * meta.json 仍是沙盒的存在凭据（listSandboxes 无 meta 即不列举），本函数只负责校正已列举沙盒的回合数。
   * 只读故事主文件，不创建引擎句柄；读不到就回落 meta 的缓存值。 */
  function storyTurnFromDisk(sandboxId, storyId) {
    const safe = String(storyId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
    if (!safe) return null
    try {
      const data = JSON.parse(fs.readFileSync(path.join(sandboxPath(sandboxId), 'engine', 'stories', safe + '.json'), 'utf8'))
      const turn = data && data.counters && Number(data.counters.turn)
      return Number.isFinite(turn) ? turn : null
    } catch { return null }
  }
  /* 列举：meta.json 是沙盒的存在凭据；其上的回合数一律以引擎状态为准 */
  function listSandboxes() {
    let dirs = []
    try { dirs = fs.readdirSync(sandboxRoot) } catch { return [] }
    return dirs.filter((name) => ID_RE.test(name) && !name.endsWith('.tmp'))
      .flatMap((name) => {
        const meta = sandboxMeta(name)
        if (!meta) return []
        const turn = storyTurnFromDisk(name, meta.storyId)
        return [turn == null ? meta : Object.assign({}, meta, { turns: turn })]
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
  function pruneSandboxes() {
    const all = listSandboxes()
    for (const old of all.slice(MAX_SANDBOXES)) { closeEngine(old.sandboxId); try { fs.rmSync(sandboxPath(old.sandboxId), { recursive: true, force: true }) } catch {} }
  }
  /* 内核版本来源校验：hash 与 text 同时传入时必须互相一致（否则会按 text 静默采用与声明不符的版本） */
  function resolveKernelSource(body, kernelId) {
    const hasText = body.text != null && String(body.text) !== ''
    const declaredHash = body.hash == null || String(body.hash) === '' ? null : safeName(body.hash, '内核版本 hash')
    if (declaredHash && !HASH_RE.test(declaredHash)) throw new Error('内核版本 hash 格式不正确')
    if (hasText) {
      const text = checkKernelText(body.text)
      const hash = hashText(text)
      if (declaredHash && declaredHash !== hash) throw new Error('内核版本 hash 与传入正文不一致（hash ' + declaredHash + ' ≠ 正文实际 ' + hash + '）：请只传其一，或传互相一致的版本')
      return { text, hash }
    }
    if (!declaredHash) throw new Error('需要传入内核正文（text）或已登记版本 hash')
    /* 读已登记版本：要求内容完整（intact），避免 hash 与实际正文错配后静默开档 */
    const stored = readVersion({ kernelId, hash: declaredHash })
    if (stored.intact !== true) throw new Error('内核版本内容校验失败（文件已被外部改写）：请重新登记该内核后再创建沙盒')
    return { text: stored.text, hash: stored.hash }
  }
  function createSandbox(payload) {
    const body = payload || {}
    const kernelId = safeName(body.kernelId, '内核 id')
    const source = resolveKernelSource(body, kernelId)
    const text = source.text
    const hash = source.hash
    const sandboxId = shortId('SBX')
    const storyId = 'sandbox_' + sandboxId.slice(4).replace(/[^a-z0-9]/gi, '').slice(0, 20)
    const dir = sandboxPath(sandboxId)
    const meta = {
      sandboxId, storyId, kernelId, kernelHash: hash, label: String(body.label || '沙盒试玩').slice(0, 120),
      engineVersion: ENGINE_VERSION, createdAt: nowMs(), turns: 0,
      path: path.relative(dataRoot, dir).split(path.sep).join('/'),
      kernelVersion: null, kernelMatch: null
    }
    /* 首次 meta 写与引擎开档同属创建事务：任何一步失败都关引擎句柄并删目录，不留半个沙盒
     * （残留目录没有 meta.json，既不可列举也无法清理，只会在磁盘上堆积）。 */
    fs.mkdirSync(dir, { recursive: true })
    try {
      const engine = createEngine(path.join(dir, 'engine'))
      engines.set(sandboxId, engine)
      const opened = engine.ensureStory({ storyId, title: String(body.label || '沙盒试玩').slice(0, 120), kernelId, kernelText: text })
      meta.kernelVersion = opened.kernel_version
      meta.kernelMatch = opened.kernel_match
      atomicWriteJson(path.join(dir, 'meta.json'), scrub(meta))
      pruneSandboxes()
      return Object.assign({}, meta, { overview: engine.overview(storyId) })
    } catch (error) {
      closeEngine(sandboxId)
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
      throw error
    }
  }
  function sandboxContext(payload) {
    const body = payload || {}
    const sandboxId = safeDirName(body.sandboxId, '沙盒编号')
    const meta = sandboxMeta(sandboxId)
    if (!meta) throw new Error('沙盒不存在：' + sandboxId)
    const engine = engineFor(sandboxId)
    const built = engine.buildContext(meta.storyId, { playerInput: String(body.input || '').slice(0, 2000) })
    if (!built) throw new Error('沙盒世界线不存在')
    return { block: built.block, overview: built.overview, contextSize: built.block.length, storyId: meta.storyId, kernelHash: meta.kernelHash }
  }
  /* 沙盒回合：raw 由调用方提供（真实模型输出）；省略 raw 时生成确定性离线回合，
   * 本模块自身不发起任何模型请求。离线回合只验证引擎链路（非模型叙事质量验收）。
   * 引擎提交是权威：提交结果照实回传，meta.json 只是回合数同步缓存，
   * 其写失败不得把已推进的引擎报成「提交失败」（否则 UI 会重复提交并丢回合）。 */
  function sandboxTurn(payload) {
    const body = payload || {}
    const sandboxId = safeDirName(body.sandboxId, '沙盒编号')
    const meta = sandboxMeta(sandboxId)
    if (!meta) throw new Error('沙盒不存在：' + sandboxId)
    const engine = engineFor(sandboxId)
    const current = engine.getStory(meta.storyId)
    if (!current) throw new Error('沙盒世界线不存在：' + meta.storyId)
    const input = String(body.input || '').slice(0, 2000)
    const mock = body.raw == null
    const turnNo = (current.counters.turn || 0) + 1
    const raw = mock ? [
      '（离线沙盒回合 ' + turnNo + '：未调用模型）' + (input ? ' 玩家行动：' + input : ''),
      '<<<STATE_PATCH>>>',
      JSON.stringify({
        turn_summary: '沙盒回合 ' + turnNo + (input ? '：' + input.slice(0, 60) : ''),
        events: [{ type: 'action', description: (input || '沙盒静观').slice(0, 120), importance: 10 }]
      }),
      '<<<END_PATCH>>>'
    ].join('\n') : String(body.raw)
    const result = engine.commitFromRaw(raw, {
      storyId: meta.storyId, sessionId: 'sandbox', playerInput: input,
      intent: input.slice(0, 200), model: mock ? 'sandbox-offline' : String(body.model || 'user-configured'),
      rawOutput: raw
    })
    const story = engine.getStory(meta.storyId) || current
    const turn = story.counters.turn || 0
    let metadataSaved = true
    try {
      atomicWriteJson(path.join(sandboxPath(sandboxId), 'meta.json'), scrub(Object.assign({}, meta, { turns: turn, updatedAt: nowMs() })))
    } catch { metadataSaved = false }
    const warnings = (result.warnings || []).slice()
    if (!metadataSaved) warnings.push({ code: META_SYNC_FAILED_CODE, message: META_SYNC_FAILED_MESSAGE })
    return {
      sandboxId, storyId: meta.storyId, mock, committed: !!result.committed, patchStatus: result.patch_status || null,
      narrative: result.narrative || '', errors: result.errors || [], warnings,
      /* 元数据同步状态与 committed 独立：false 只表示 meta.json 未更新，以引擎结果为准（勿据此重复提交） */
      metadataSaved, metadataWarningCode: metadataSaved ? null : META_SYNC_FAILED_CODE,
      turn, overview: engine.overview(meta.storyId), kernelHash: meta.kernelHash,
      /* 明确标注：离线回合不经过任何模型，不能当作模型质量验收 */
      scope: mock ? 'offline-deterministic' : 'model-output-supplied', modelInvolved: !mock
    }
  }
  function closeSandbox(payload) {
    const body = payload || {}
    const sandboxId = safeDirName(body.sandboxId, '沙盒编号')
    closeEngine(sandboxId)
    if (body.keep) return { sandboxId, kept: true }
    try { fs.rmSync(sandboxPath(sandboxId), { recursive: true, force: true }) } catch (error) { return { sandboxId, kept: false, removed: false, error: String(error.message || error) } }
    return { sandboxId, kept: false, removed: true }
  }

  /* ---------- 可重现测试记录 ---------- */
  /* 真实世界线指纹：文件清单 + 逐文件内容 hash。用例只比对指纹，确保沙盒/测试不写入真实引擎目录。 */
  function realWorldSnapshot() {
    const dir = path.join(dataRoot, 'story-engine')
    const out = {}
    const walk = (base, rel) => {
      let entries = []
      try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const key = rel ? rel + '/' + entry.name : entry.name
        if (entry.isDirectory()) { walk(path.join(base, entry.name), key); continue }
        try { out[key] = hashText(fs.readFileSync(path.join(base, entry.name))) } catch { out[key] = 'unreadable' }
      }
    }
    walk(dir, '')
    return out
  }
  function sameSnapshot(before, after) {
    const keys = Object.keys(before)
    return keys.length === Object.keys(after).length && keys.every((key) => before[key] === after[key])
  }
  function runSuite(payload) {
    const body = payload || {}
    const kernelId = safeName(body.kernelId, '内核 id')
    const started = nowMs()
    let text = body.text ? checkKernelText(body.text) : ''
    if (!text) text = readVersion({ kernelId, hash: safeName(body.hash, '内核版本 hash') }).text
    const hash = hashText(text)
    // UI 可直接测试尚未登记的草稿。先保存不可变输入，才能在重启后仅凭 recordId 复跑。
    // 同内容复用原文件；已有文件被外部改写时 registerVersion 会拒绝，不伪造复现证据。
    registerVersion({ kernelId, name: body.name, text, source: 'author-suite' })
    const scriptHash = hashText(JSON.stringify(SUITE_SCRIPT))
    const realBefore = realWorldSnapshot()
    const sandbox = createSandbox({ kernelId, text, label: '可重现测试 ' + hash })
    const engine = engineFor(sandbox.sandboxId)
    const storyId = sandbox.storyId
    const cases = []
    const push = (id, title, ok, detail, evidence) => cases.push({ id, title, ok: !!ok, detail: detail || '', evidence: scrub(evidence == null ? null : evidence) })

    try {
      // 用例 1：开局（内核绑定 + 首回合提交真实落账）
      const opened = engine.ensureStory({ storyId, title: '可重现测试', kernelId, kernelText: text })
      const openCase = SUITE_SCRIPT[0]
      const openResult = engine.commitFromRaw(openCase.raw, { storyId, sessionId: 'suite', playerInput: openCase.playerInput, model: 'suite-script' })
      const story = engine.getStory(storyId)
      const openOk = opened.kernel_match === true && opened.kernel_version === 'sha1:' + hash &&
        openResult.committed === true && story.counters.turn === openCase.expect.turn &&
        story.facts.length === openCase.expect.facts && story.entities.length >= openCase.expect.entities
      push('open', openCase.title, openOk, openOk ? '开局成功，内核 hash 与故事绑定一致' : '开局或首回合提交未达预期',
        { kernelVersion: opened.kernel_version, kernelMatch: opened.kernel_match, turn: story.counters.turn, facts: story.facts.length, entities: story.entities.length, patchStatus: openResult.patch_status })

      // 用例 2：显式无状态变化（合法回合不推进计数）
      const noChangeCase = SUITE_SCRIPT[1]
      const noChangeResult = engine.commitFromRaw(noChangeCase.raw, { storyId, sessionId: 'suite', playerInput: noChangeCase.playerInput, model: 'suite-script' })
      const afterNoChange = engine.getStory(storyId)
      const noChangeOk = noChangeResult.ok === true && noChangeResult.patch_status === noChangeCase.expect.patchStatus && afterNoChange.counters.turn === noChangeCase.expect.turn
      push('no-change', noChangeCase.title, noChangeOk, noChangeOk ? '无变化回合合法且未推进状态' : '无变化回合处理与预期不符',
        { patchStatus: noChangeResult.patch_status, turn: afterNoChange.counters.turn })

      // 用例 3：确定性冲突整体回滚（不留半提交）
      const conflictCase = SUITE_SCRIPT[2]
      const beforeConflict = engine.getStory(storyId)
      const conflictResult = engine.commitFromRaw(conflictCase.raw, { storyId, sessionId: 'suite', playerInput: conflictCase.playerInput, model: 'suite-script' })
      const afterConflict = engine.getStory(storyId)
      const conflictOk = conflictResult.committed === false && conflictResult.patch_status === conflictCase.expect.patchStatus &&
        afterConflict.counters.turn === beforeConflict.counters.turn && afterConflict.facts.length === beforeConflict.facts.length &&
        afterConflict.threads.length === beforeConflict.threads.length
      push('conflict-rollback', conflictCase.title, conflictOk, conflictOk ? '非法引用被拒绝，状态与提交前一致' : '冲突回合未能保持原状态',
        { patchStatus: conflictResult.patch_status, turn: afterConflict.counters.turn, facts: afterConflict.facts.length, threads: afterConflict.threads.length })

      // 用例 4：写盘失败回滚（模拟磁盘故障）
      /* 用例 4：写盘失败回滚（模拟磁盘故障）
       * store._atomicWrite(filePath, data) 是引擎唯一的原子落盘入口（store.js），
       * 在这里注入失败即可覆盖全部写入路径；无论提交是否抛错，都必须在 finally 还原。 */
      const originalWrite = engine.store._atomicWrite
      let diskFailed = false
      let failureResult = null
      try {
        engine.store._atomicWrite = () => { throw new Error('simulated disk failure') }
        try { failureResult = engine.commitPatch({ facts: [{ key: 'disk_failure_probe', statement: '不得落盘' }] }, { storyId, sessionId: 'suite', playerInput: '写盘失败探针' }) } catch (error) { diskFailed = true }
      } finally {
        engine.store._atomicWrite = originalWrite
      }
      const afterFailure = engine.getStory(storyId)
      const failureOk = !!failureResult && failureResult.committed === false &&
        afterFailure.counters.turn === beforeConflict.counters.turn &&
        !afterFailure.facts.some((fact) => fact.key === 'disk_failure_probe')
      push('disk-failure-rollback', '写盘失败：内存与磁盘保持提交前状态', failureOk,
        failureOk ? '写盘失败被回滚，未污染内存状态' : '写盘失败后状态不一致',
        { committed: failureResult && failureResult.committed, patchStatus: failureResult && failureResult.patch_status, turn: afterFailure.counters.turn, probePersisted: afterFailure.facts.some((fact) => fact.key === 'disk_failure_probe'), threw: diskFailed })

      // 用例 5：快照恢复（回到历史状态）
      const snapshot = engine.snapshot(storyId, 'suite-baseline')
      const baseline = { turn: afterFailure.counters.turn, facts: afterFailure.facts.length }
      engine.commitPatch({ facts: [{ key: 'after_snapshot', statement: '快照之后新增' }], events: [{ type: 'action', description: '快照之后推进', importance: 30 }] }, { storyId, sessionId: 'suite', playerInput: '快照后继续' })
      const advanced = engine.getStory(storyId)
      const restored = engine.restoreSnapshot(storyId, snapshot.snapshot_id)
      const restoreOk = advanced.counters.turn > baseline.turn && restored.counters.turn === baseline.turn &&
        restored.facts.length === baseline.facts && !restored.facts.some((fact) => fact.key === 'after_snapshot')
      push('restore', '快照恢复：状态回到快照点', restoreOk,
        restoreOk ? '快照恢复后回合与账本回到基线' : '快照恢复结果与基线不一致',
        { baseline, advancedTurn: advanced.counters.turn, restoredTurn: restored.counters.turn, restoredFacts: restored.facts.length })

      // 用例 6：重启持久化（关引擎后从磁盘重新打开）
      const persisted = { turn: restored.counters.turn, facts: restored.facts.length }
      closeEngine(sandbox.sandboxId)
      const reopenedEngine = engineFor(sandbox.sandboxId)
      const reopened = reopenedEngine.ensureStory({ storyId, title: '可重现测试', kernelId, kernelText: text })
      const restartOk = reopened.created === false && reopened.kernel_match === true &&
        reopened.story.counters.turn === persisted.turn && reopened.story.facts.length === persisted.facts
      push('restart-persistence', '重启持久化：磁盘状态与内核绑定可取回', restartOk,
        restartOk ? '重开后回合与记忆与关闭前一致' : '重开后状态与关闭前不一致',
        { created: reopened.created, kernelMatch: reopened.kernel_match, turn: reopened.story.counters.turn, facts: reopened.story.facts.length })

      // 用例 7：内核版本绑定（换内核不得混用旧档）
      const migrated = reopenedEngine.ensureStory({ storyId, title: '可重现测试', kernelId, kernelText: text + '\n\n<!-- 变更 -->' })
      const bindingOk = migrated.kernel_match === false && migrated.kernel_text === text
      push('kernel-binding', '内核版本绑定：换内核不混用旧档规则', bindingOk,
        bindingOk ? '不同内核文本被识别为不匹配，旧档仍使用绑定版本' : '内核绑定校验未生效',
        { kernelMatch: migrated.kernel_match, kernelVersion: migrated.kernel_version })

      // 用例 8：沙盒隔离（真实世界线目录未被触碰）
      const realAfter = realWorldSnapshot()
      const isolated = sameSnapshot(realBefore, realAfter) &&
        path.resolve(sandboxPath(sandbox.sandboxId)).startsWith(path.resolve(sandboxRoot) + path.sep)
      push('isolation', '沙盒隔离：真实世界线目录零改动', isolated,
        isolated ? '沙盒运行于独立目录，真实引擎目录逐文件指纹不变' : '沙盒写入越界或真实目录被改动',
        { realFiles: Object.keys(realAfter).length, unchanged: sameSnapshot(realBefore, realAfter), sandboxPath: sandbox.path })
    } catch (error) {
      push('suite-error', '测试执行中断', false, String((error && error.message) || error), null)
    } finally {
      closeEngine(sandbox.sandboxId)
      try { fs.rmSync(sandboxPath(sandbox.sandboxId), { recursive: true, force: true }) } catch {}
    }

    const finished = nowMs()
    const record = scrub({
      recordId: shortId('ATR'),
      kind: 'author-suite',
      /* 验收口径：这些用例是确定性结构用例，全程离线、不调用任何模型；
       * 只证明引擎与内核契约（开局/回滚/恢复/持久化/隔离），不是模型叙事质量验收。 */
      scope: 'engine-contract',
      modelInvolved: false,
      scopeNote: '确定性结构用例：离线运行、不调用任何模型，仅验证引擎与内核契约（开局/冲突回滚/写盘失败回滚/快照恢复/重启持久化/内核绑定/沙盒隔离），不代表模型叙事质量。模型质量验收须用真实试玩。',
      kernel: { id: kernelId, hash, name: String(body.name || '').slice(0, 200) },
      engine: { version: ENGINE_VERSION, name: ENGINE_META.name, protocol: ENGINE_META.statePatchProtocol, node: process.version },
      script: { hash: scriptHash, inputs: SUITE_SCRIPT.map((item) => item.id), cases: cases.map((item) => item.id) },
      startedAt: started, finishedAt: finished, durationMs: finished - started,
      ok: cases.length > 0 && cases.every((item) => item.ok),
      cases
    })
    atomicWriteJson(recordPath(record.recordId), record)
    pruneRecords()
    return record
  }
  function allRecords(kernelId) {
    let files = []
    try { files = fs.readdirSync(recordRoot) } catch { return [] }
    return files.filter((file) => file.endsWith('.json')).flatMap((file) => {
      const data = readJson(path.join(recordRoot, file))
      if (!data || !data.recordId) return []
      if (kernelId && data.kernel && data.kernel.id !== kernelId) return []
      return [data]
    }).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
  }
  function listRecords({ kernelId } = {}) {
    return allRecords(kernelId).slice(0, MAX_RECORDS).map((data) => ({
      recordId: data.recordId, kernel: data.kernel, engine: data.engine, script: data.script,
      startedAt: data.startedAt, durationMs: data.durationMs, ok: data.ok,
      scope: data.scope || 'engine-contract', modelInvolved: !!data.modelInvolved, scopeNote: data.scopeNote || '',
      cases: (data.cases || []).map((item) => ({ id: item.id, title: item.title, ok: item.ok, detail: item.detail }))
    }))
  }
  function readRecord(payload) {
    const data = readJson(recordPath((payload || {}).recordId))
    if (!data) throw new Error('测试记录不存在')
    return data
  }
  /* 复跑比对：同一内核与脚本重跑，逐用例比对结果 —— 证明记录可重现 */
  function replayRecord(payload) {
    const body = payload || {}
    const original = readRecord(body)
    if (body.text) return compare(original, runSuite({ kernelId: original.kernel.id, name: original.kernel.name, text: checkKernelText(body.text) }))
    return compare(original, runSuite({ kernelId: original.kernel.id, name: original.kernel.name, hash: original.kernel.hash }))
  }
  function compare(original, replay) {
    const before = new Map((original.cases || []).map((item) => [item.id, item.ok]))
    const rows = (replay.cases || []).map((item) => ({ id: item.id, title: item.title, before: before.has(item.id) ? before.get(item.id) : null, after: item.ok, same: before.get(item.id) === item.ok }))
    return {
      original: { recordId: original.recordId, ok: original.ok, scriptHash: original.script && original.script.hash, kernelHash: original.kernel && original.kernel.hash },
      replay: { recordId: replay.recordId, ok: replay.ok, scriptHash: replay.script && replay.script.hash, kernelHash: replay.kernel && replay.kernel.hash },
      reproduced: rows.length > 0 && rows.length === before.size && rows.every((row) => row.same) && original.ok === replay.ok &&
        original.kernel.hash === replay.kernel.hash && original.script.hash === replay.script.hash,
      rows
    }
  }
  function pruneRecords() {
    /* 裁剪必须基于全量列表（listRecords 已被 MAX_RECORDS 截断，用它做裁剪永远删不掉东西） */
    for (const old of allRecords().slice(MAX_RECORDS)) { try { fs.unlinkSync(recordPath(old.recordId)) } catch {} }
  }

  /* ---------- 精选内核元数据 / 预览 ---------- */
  function libraryList() {
    if (!kernelSource || typeof kernelSource.list !== 'function') return []
    try {
      const raw = kernelSource.list()
      const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.kernels) ? raw.kernels : [])
      return items.slice(0, MAX_LISTED_KERNELS)
    } catch { return [] }
  }
  function libraryRead(id) {
    if (!kernelSource || typeof kernelSource.read !== 'function') return null
    try {
      const result = kernelSource.read(id)
      return result && result.ok ? result : null
    } catch { return null }
  }
  function curatedEntry(item) {
    const curated = CURATED[item.id] || {}
    const read = libraryRead(item.id)
    const text = read && typeof read.text === 'string' ? read.text : ''
    const meta = parseKernelMeta(text)
    const versions = listVersions({ kernelId: item.id })
    const records = listRecords({ kernelId: item.id })
    return scrub({
      kernelId: item.id,
      name: (meta && meta.title) || item.name || curated.title || item.id,
      source: item.source || (String(item.id).startsWith('builtin:') ? 'builtin' : 'user'),
      tagline: (meta && meta.tagline) || curated.tagline || '',
      genres: curated.genres || [],
      license: (meta && meta.license) || curated.license || '',
      author: (meta && meta.author) || curated.author || '',
      recommendedModels: curated.recommendedModels || [],
      version: (meta && meta.version) || curated.version || '',
      size: Number(item.size) || (text ? Buffer.byteLength(text) : 0),
      mtime: Number(item.mtime) || 0,
      hash: text ? hashText(text) : '',
      readable: !!read,
      origins: (meta && meta.origins) || [],
      registeredVersions: versions.length,
      latestVersion: versions[0] || null,
      latestRecord: records[0] ? { recordId: records[0].recordId, ok: records[0].ok, startedAt: records[0].startedAt } : null
    })
  }
  function curatedList() {
    const listed = libraryList()
    if (!listed.length) {
      return Object.entries(CURATED).map(([kernelId, curated]) => scrub(Object.assign({ kernelId, source: 'builtin', readable: false, hash: '', size: 0, origins: [], registeredVersions: listVersions({ kernelId }).length, latestVersion: listVersions({ kernelId })[0] || null, latestRecord: null }, curated)))
    }
    return listed.map(curatedEntry)
  }
  function preview(payload) {
    const body = payload || {}
    const kernelId = safeName(body.kernelId, '内核 id')
    const listed = libraryList()
    const item = listed.find((entry) => entry.id === kernelId) || { id: kernelId, name: kernelId, source: String(kernelId).startsWith('builtin:') ? 'builtin' : 'user' }
    const entry = curatedEntry(item)
    const read = libraryRead(kernelId)
    const text = read && typeof read.text === 'string' ? read.text : ''
    const lines = splitLines(text)
    const meta = parseKernelMeta(text)
    /* 章节标题：Markdown 标题 + 仓库内核惯用的【…】小节标记（内置内核用后者分卷） */
    const headings = lines
      .filter((line) => /^#{1,3}\s+\S/.test(line) || /^【[^】]{1,60}】\s*$/.test(line.trim()))
      .slice(0, 12)
      .map((line) => line.trim())
    return scrub({
      kernelId,
      info: entry,
      preview: {
        available: !!text,
        bytes: text ? Buffer.byteLength(text) : 0,
        lineCount: text ? lines.length : 0,
        headings,
        excerpt: text ? lines.slice(0, 40).join('\n') : '',
        startLabel: (meta && meta.startLabel) || '',
        startPayload: (meta && meta.startPayload) || ''
      },
      versions: listVersions({ kernelId }),
      records: listRecords({ kernelId }).slice(0, 10)
    })
  }

  const tools = {
    root,
    listVersions, registerVersion, readVersion, diffVersions,
    listSandboxes, createSandbox, sandboxContext, sandboxTurn, closeSandbox,
    runSuite, listRecords, readRecord, replayRecord,
    curatedList, preview,
    closeAll: () => { for (const id of Array.from(engines.keys())) closeEngine(id) }
  }
  return tools
}

/* ---- IPC 注册：父进程一行接入；返回的 channel 名与 UI 侧 AuthorTools 契约一致 ---- */
const CHANNELS = {
  versions: 'author:versions',
  registerVersion: 'author:version-register',
  versionRead: 'author:version-read',
  diff: 'author:diff',
  curated: 'author:curated',
  preview: 'author:preview',
  sandboxList: 'author:sandbox-list',
  sandboxOpen: 'author:sandbox-open',
  sandboxContext: 'author:sandbox-context',
  sandboxTurn: 'author:sandbox-turn',
  sandboxClose: 'author:sandbox-close',
  suiteRun: 'author:suite-run',
  records: 'author:records',
  record: 'author:record',
  replay: 'author:replay'
}

function register(config) {
  const options = config || {}
  const ipcMain = options.ipcMain
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('register 需要 ipcMain')
  const tools = createAuthorTools({ dataRoot: options.dataRoot, kernelSource: options.kernelSource })
  const serial = typeof options.queue === 'function' ? options.queue : (task) => Promise.resolve().then(task)
  /* 主进程 queueSessionOperation 把任务异常吞成 { ok:false, error } 再 resolve；
   * 该形状（恰好两键）在此还原成异常，避免 UI 把失败当成功数据渲染。
   * 工具自身的结果里 runSuite 记录也带 ok 字段，但字段远多于两个，不会误判。 */
  const isErrorEnvelope = (value) => !!value && typeof value === 'object' && value.ok === false &&
    typeof value.error === 'string' && Object.keys(value).length <= 2
  const handler = (fn, queued) => async (_event, payload) => {
    const run = () => fn(payload || {})
    try {
      const data = await (queued ? serial(run) : Promise.resolve().then(run))
      if (isErrorEnvelope(data)) throw new Error(data.error)
      return { ok: true, data }
    } catch (error) { return { ok: false, error: String((error && error.message) || error) } }
  }
  ipcMain.handle(CHANNELS.versions, handler(tools.listVersions))
  ipcMain.handle(CHANNELS.registerVersion, handler(tools.registerVersion, true))
  ipcMain.handle(CHANNELS.versionRead, handler(tools.readVersion))
  ipcMain.handle(CHANNELS.diff, handler(tools.diffVersions))
  ipcMain.handle(CHANNELS.curated, handler(tools.curatedList))
  ipcMain.handle(CHANNELS.preview, handler(tools.preview))
  ipcMain.handle(CHANNELS.sandboxList, handler(tools.listSandboxes))
  ipcMain.handle(CHANNELS.sandboxOpen, handler(tools.createSandbox, true))
  ipcMain.handle(CHANNELS.sandboxContext, handler(tools.sandboxContext))
  ipcMain.handle(CHANNELS.sandboxTurn, handler(tools.sandboxTurn, true))
  ipcMain.handle(CHANNELS.sandboxClose, handler(tools.closeSandbox, true))
  ipcMain.handle(CHANNELS.suiteRun, handler(tools.runSuite, true))
  ipcMain.handle(CHANNELS.records, handler(tools.listRecords))
  ipcMain.handle(CHANNELS.record, handler(tools.readRecord))
  ipcMain.handle(CHANNELS.replay, handler(tools.replayRecord, true))
  return tools
}

module.exports = { createAuthorTools, register, CHANNELS, parseKernelMeta, diffText, SUITE_SCRIPT, CURATED }

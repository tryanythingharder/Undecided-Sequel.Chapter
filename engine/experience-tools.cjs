'use strict'
/* ======== 六面世界 · 体验工具（主进程数据面）========
 * 覆盖 docs/desktop-evolution.md 的两项验收里属于主进程的部分：
 *   -「可选模型报价、调用/页数估计、任务状态与累计费用」→ 提供只读存储统计与真实用量聚合口径；
 *   -「脱敏诊断导出；默认不含正文、密钥或用户文件路径」→ 提供白名单诊断报告。
 *
 * 设计约束（与 engine/archive-store.js、engine/author-tools.cjs、engine/usage-ledger.js 同规制）：
 *  - 纯 Node（无 Electron 依赖），可直接 require 做单测；IPC 只在 register() 里接；
 *  - 只读扫描：只统计「文件数量 + 字节数」，输出里永远不出现路径、文件名、世界线标题或正文；
 *  - 默认诊断只允许：版本、阶段、存储统计、真实用量聚合数字、错误码计数。
 *    平台/架构与布尔配置属于「扩展项」，需显式 extended:true 才出现；
 *  - 阶段 / 错误码 / 配置键全部白名单，白名单外一律落到 'unknown' 或被丢弃（宁可少记，不可泄漏）；
 *  - 复用 engine/usage-ledger.js 的 safeToken / scanForSensitive 做版本清洗与导出前自检。
 *
 * 主进程接入（main.cjs / preload.cjs 由父代理维护；本模块不改它们）：
 *   const et = require('./engine/experience-tools.cjs')
 *   et.register({
 *     ipcMain,
 *     dataRoot: app.getPath('userData'),
 *     version: app.getVersion(),
 *     stage: () => stageOfCurrentCfg(),        // 'first-run' | 'text-ready' | 'illust-ready'
 *     queue: queueSessionOperation,            // 可选：串行化落盘
 *     saveFile: async (evt, { defaultName, content }) => { ... }  // 可选；缺失时导出返回可读错误
 *   })
 *   // 也可用现成对话框包装：
 *   saveFile: et.createDialogSaver({ dialog, windowForEvent })
 *
 *   preload：
 *     experienceStorage: () => ipcRenderer.invoke('experience:storage'),
 *     experienceDiagnosticsInfo: () => ipcRenderer.invoke('experience:diagnostics-info'),
 *     experienceDiagnosticsReport: (p) => ipcRenderer.invoke('experience:report', p),
 *     experienceDiagnosticsSave: (p) => ipcRenderer.invoke('experience:diagnostics-save', p),
 *     experienceRecordError: (p) => ipcRenderer.invoke('experience:record-error', p)
 */

const fs = require('node:fs')
const path = require('node:path')
const { safeToken, scanForSensitive, DIAG_CONFIG_KEYS } = require('./usage-ledger')

const DIAGNOSTICS_SCHEMA = 'sixworlds.experience-diagnostics.v1'
const STAGES = ['first-run', 'text-ready', 'illust-ready']

/* 错误码白名单：诊断包只允许出现这一组短码，永远不带原始错误文本 */
const ERROR_CODES = [
  'aborted', 'timeout', 'dns', 'refused', 'reset', 'tls', 'invalid-address',
  'http-400', 'http-401', 'http-403', 'http-404', 'http-409', 'http-413', 'http-429', 'http-5xx',
  'rate-limit', 'parse', 'storage', 'canceled', 'unknown'
]

const MAX_ERROR_ENTRIES = 500
const MAX_SCAN_FILES = 20000
const MAX_SESSIONS_BYTES = 8 * 1024 * 1024
const MAX_DIAG_BYTES = 512 * 1024

/* ---- 导出内容严格白名单 ----
 * experience:diagnostics-save 只允许保存「本模块自己生成的诊断报告」。
 * 渲染端当前契约：{ defaultName, content }，其中 content = JSON.stringify(report, null, 2)。
 * 这里按报告结构逐字段校验：字段名、字段类型、嵌套层级全部限定；
 * 未知字段、密钥 / 路径 / URL / 模型名 / 正文一律拒绝（宁可拒导，不可泄漏）。 */
const DIAG_TOP_KEYS = ['schema', 'generatedAt', 'app', 'storage', 'errors', 'usage', 'config']
const DIAG_APP_KEYS = ['version', 'stage', 'platform', 'arch']
const DIAG_STORAGE_KEYS = [
  'available', 'sessions', 'messages', 'sessionBytes', 'imageFiles', 'imageBytes',
  'archiveCount', 'archiveFiles', 'storyFiles', 'snapshotFiles', 'pendingFiles',
  'logFiles', 'memoryBytes', 'kernelFiles', 'holoCardCount', 'secretsPresent', 'truncated'
]
const DIAG_STORAGE_NUMERIC_KEYS = DIAG_STORAGE_KEYS.filter((k) => k !== 'available' && k !== 'secretsPresent' && k !== 'truncated')
const DIAG_USAGE_KEYS = [
  'calls', 'running', 'chatCalls', 'imageCalls', 'failed', 'partial', 'aborted',
  'promptTokens', 'completionTokens', 'totalTokens', 'usageUnknownCalls',
  'imageCount', 'costKnownEntries', 'costUnknownEntries', 'costProvisionalEntries', 'ledgerEntries'
]
const DIAG_GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
/* 版本字段：只接受语义版本（数字三段，可带预发布 / 构建元数据）。
 * 旧契约 /^[A-Za-z0-9._-]{1,24}$/ 太宽：'gpt-4o'、'my-secret-model' 这类短自由串能整段塞进
 * version 且未必命中 scanForSensitive 的关键词规则，等于给诊断包开了一个「藏短文本」的口子。
 * 真实应用版本（electron app.getVersion()）本就是 x.y.z，收紧后不破坏合法报告。 */
const DIAG_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[A-Za-z0-9.]{1,20})?(?:\+[A-Za-z0-9.]{1,20})?$/
/* 平台 / 架构：不是自由串，而是固定枚举（Node 取值 + 归一后的兜底 'unknown'）。
 * 这样任何「短正文 / 模型名」都无法借这两个字段过闸。 */
const DIAG_PLATFORM_VALUES = ['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32', 'android', 'unknown']
const DIAG_ARCH_VALUES = ['arm', 'arm64', 'ia32', 'loong64', 'mips', 'mipsel', 'ppc', 'ppc64', 'riscv64', 's390', 's390x', 'x64', 'unknown']
/* 版本归一：主进程侧已过 safeToken（可能得到 'redacted'）→ 语义版本外的取值一律 'unknown'，
 * 与 normalizeStage 同规制：宁可少记，不可夹带自由文本。 */
function normalizeVersion(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim()
  return DIAG_VERSION_RE.test(raw) ? raw : 'unknown'
}
function normalizePlatform(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase()
  return DIAG_PLATFORM_VALUES.includes(raw) ? raw : 'unknown'
}
function normalizeArch(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase()
  return DIAG_ARCH_VALUES.includes(raw) ? raw : 'unknown'
}

/* 严格对象：键必须全部在白名单内，否则判定为「未知字段」 */
function strictKeys(value, allowed) {
  const keys = Object.keys(value)
  if (keys.some((k) => !allowed.includes(k))) return false
  return true
}
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function isNullableNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

/* 校验报告对象是否严格符合白名单形状（不抛异常，返回可读原因） */
function validateDiagnosticsReport(value) {
  if (!isPlainObject(value)) return { ok: false, error: '诊断内容必须是 JSON 对象' }
  if (value.schema !== DIAGNOSTICS_SCHEMA) return { ok: false, error: '诊断内容 schema 不符（只允许本应用生成的诊断报告）' }
  if (!strictKeys(value, DIAG_TOP_KEYS)) return { ok: false, error: '诊断内容含未知字段（已拒绝导出）' }
  if (typeof value.generatedAt !== 'string' || !DIAG_GENERATED_AT_RE.test(value.generatedAt)) return { ok: false, error: '诊断内容 generatedAt 不合法' }

  const app = value.app
  if (!isPlainObject(app) || !strictKeys(app, DIAG_APP_KEYS)) return { ok: false, error: '诊断内容 app 字段不合法' }
  if (typeof app.version !== 'string' || !DIAG_VERSION_RE.test(app.version)) return { ok: false, error: '诊断内容版本字段不合法（只接受语义版本 x.y.z）' }
  if (!STAGES.concat('unknown').includes(app.stage)) return { ok: false, error: '诊断内容阶段字段不合法' }
  if (app.platform !== undefined && !DIAG_PLATFORM_VALUES.includes(app.platform)) return { ok: false, error: '诊断内容平台字段不合法（只接受 Node 平台枚举）' }
  if (app.arch !== undefined && !DIAG_ARCH_VALUES.includes(app.arch)) return { ok: false, error: '诊断内容架构字段不合法（只接受 Node 架构枚举）' }

  const storage = value.storage
  if (!isPlainObject(storage) || !strictKeys(storage, DIAG_STORAGE_KEYS)) return { ok: false, error: '诊断内容 storage 字段不合法' }
  for (const key of DIAG_STORAGE_NUMERIC_KEYS) {
    if (!isNullableNumber(storage[key])) return { ok: false, error: '诊断内容 storage.' + key + ' 必须是非负数字或 null' }
  }
  for (const key of ['available', 'secretsPresent', 'truncated']) {
    if (typeof storage[key] !== 'boolean') return { ok: false, error: '诊断内容 storage.' + key + ' 必须是布尔值' }
  }

  const errors = value.errors
  if (!isPlainObject(errors) || !strictKeys(errors, ['total', 'byCode'])) return { ok: false, error: '诊断内容 errors 字段不合法' }
  if (!isNullableNumber(errors.total)) return { ok: false, error: '诊断内容 errors.total 不合法' }
  if (!isPlainObject(errors.byCode) || !strictKeys(errors.byCode, ERROR_CODES)) return { ok: false, error: '诊断内容 errors.byCode 含非白名单错误码' }
  for (const code of Object.keys(errors.byCode)) {
    if (!isNullableNumber(errors.byCode[code])) return { ok: false, error: '诊断内容错误码计数不合法' }
  }

  if (value.usage !== undefined) {
    if (!isPlainObject(value.usage) || !strictKeys(value.usage, DIAG_USAGE_KEYS)) return { ok: false, error: '诊断内容 usage 字段不合法' }
    for (const key of Object.keys(value.usage)) {
      if (!isNullableNumber(value.usage[key])) return { ok: false, error: '诊断内容 usage.' + key + ' 必须是非负数字或 null' }
    }
  }
  if (value.config !== undefined) {
    if (!isPlainObject(value.config) || !strictKeys(value.config, DIAG_CONFIG_KEYS)) return { ok: false, error: '诊断内容 config 字段不合法' }
    for (const key of Object.keys(value.config)) {
      if (typeof value.config[key] !== 'boolean') return { ok: false, error: '诊断内容 config.' + key + ' 必须是布尔值' }
    }
  }
  /* 形状过关后再做一次敏感内容自检（双保险：结构合法但值被污染也拒绝） */
  const findings = scanForSensitive(value)
  if (findings.length) return { ok: false, error: '诊断内容自检未通过（已阻止导出）', findings }
  return { ok: true }
}

/* 导出通道入参：只接受 { defaultName, content } 两键 + 白名单报告内容 */
function validateSavePayload(payload) {
  const p = payload || {}
  if (!isPlainObject(p)) return { ok: false, error: '导出参数不合法' }
  if (!strictKeys(p, ['defaultName', 'content'])) return { ok: false, error: '导出参数含未知字段（已拒绝）' }
  if (typeof p.content !== 'string' || !p.content) return { ok: false, error: '缺少诊断内容' }
  if (Buffer.byteLength(p.content, 'utf8') > MAX_DIAG_BYTES) return { ok: false, error: '诊断包过大' }
  let parsed = null
  try { parsed = JSON.parse(p.content) } catch { return { ok: false, error: '诊断内容不是合法 JSON（只允许本应用生成的诊断报告）' } }
  const valid = validateDiagnosticsReport(parsed)
  if (!valid.ok) return valid
  const defaultName = /^[A-Za-z0-9._-]{1,80}$/.test(String(p.defaultName || '')) ? String(p.defaultName) : 'sixworlds-diagnostics.json'
  /* 只回「白名单对象重新序列化」的结果：JSON.parse 对同名键「后者胜」，若原样返回入参字符串，
   * 前一个同名键里的密钥 / 路径会随原字节一起落盘。规范化后导出文件里只剩解析后的白名单对象，
   * 任何被 JSON.parse 丢弃的隐藏内容都不可能写出。合法报告由本模块生成，格式与逐字内容不变。 */
  return { ok: true, defaultName, content: JSON.stringify(parsed, null, 2) }
}

const clampInt = (value, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/* ---- 错误码归一：任意错误文本 / 既有短码 → 白名单短码 ---- */
const ERROR_RULES = [
  [/^[a-z0-9-]{1,24}$/, null], // 已是短码：下面用白名单校验
  [/abort/i, 'aborted'],
  [/timeout|timed ?out|etimedout|esockettimedout/i, 'timeout'],
  [/enotfound|getaddrinfo|\bdns\b|域名解析/i, 'dns'],
  [/econnrefused|无法连接/i, 'refused'],
  [/econnreset|epipe|socket hang up|连接被中断|网络连接中断/i, 'reset'],
  [/certificate|\bssl\b|\btls\b|证书/i, 'tls'],
  [/仅支持 ?http|invalid url|地址格式/i, 'invalid-address'],
  [/429|rate ?limit|too many/i, 'rate-limit'],
  [/401|unauthorized|鉴权/i, 'http-401'],
  [/403|forbidden|无权限/i, 'http-403'],
  [/404|not found|接口不存在/i, 'http-404'],
  [/409|conflict/i, 'http-409'],
  [/413|too large|过大/i, 'http-413'],
  [/50\d|internal server|bad gateway|service unavailable|服务端错误/i, 'http-5xx'],
  [/40\d/i, 'http-400'],
  [/json|parse|解析/i, 'parse'],
  [/storage|localstorage|quota|磁盘|写盘|落盘/i, 'storage'],
  [/cancel|取消/i, 'canceled']
]
function normalizeErrorCode(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim()
  if (!raw) return 'unknown'
  if (ERROR_CODES.includes(raw.toLowerCase())) return raw.toLowerCase()
  for (const [re, code] of ERROR_RULES) {
    if (!code) continue
    if (re.test(raw)) return code
  }
  return 'unknown'
}

function normalizeStage(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase()
  return STAGES.includes(raw) ? raw : 'unknown'
}

/* ---- 只读统计：只回数量与字节，绝不回路径 ---- */
function dirStat(root, rel) {
  const out = { files: 0, bytes: 0, truncated: false }
  if (!root) return out
  const stack = [path.join(root, rel)]
  while (stack.length) {
    const dir = stack.pop()
    let entries = null
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (out.files >= MAX_SCAN_FILES) { out.truncated = true; return out }
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { stack.push(full); continue }
      if (!entry.isFile()) continue
      out.files++
      try { out.bytes += fs.statSync(full).size } catch { /* 单文件异常忽略 */ }
    }
  }
  return out
}

function fileSize(root, rel) {
  if (!root) return null
  try { return fs.statSync(path.join(root, rel)).size } catch { return null }
}
function fileExists(root, rel) {
  if (!root) return false
  try { return fs.statSync(path.join(root, rel)).isFile() } catch { return false }
}
function subdirCount(root, rel) {
  if (!root) return null
  try {
    return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).length
  } catch { return null }
}

/* 会话正本：只取「世界线数量 / 消息数量 / 字节数」，读不出就是 null（不猜 0） */
function sessionCounts(root) {
  const out = { sessions: null, messages: null, bytes: null }
  if (!root) return out
  const file = path.join(root, 'session-data', 'sessions.json')
  let stat = null
  try { stat = fs.statSync(file) } catch { return out }
  out.bytes = stat.size
  if (stat.size > MAX_SESSIONS_BYTES) return out
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const list = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.sessions) ? doc.sessions : null)
    if (!list) return out
    out.sessions = list.length
    out.messages = list.reduce((n, s) => n + (s && Array.isArray(s.messages) ? s.messages.length : 0), 0)
  } catch { /* 解析失败保持 null */ }
  return out
}

function createExperienceTools(options) {
  const o = options || {}
  const root = o.dataRoot ? path.resolve(String(o.dataRoot)) : null
  const version = String(o.version || '').trim()
  const stageFn = typeof o.stage === 'function' ? o.stage : () => o.stage
  let errorCounts = Object.create(null)
  let errorTotal = 0

  /* 存储统计：键名固定白名单，值只有数字与布尔 */
  function storage() {
    const sessions = sessionCounts(root)
    const images = dirStat(root, 'session-data/images')
    const archives = dirStat(root, 'archives')
    const stories = dirStat(root, 'story-engine/stories')
    const snapshots = dirStat(root, 'story-engine/snapshots')
    const pendings = dirStat(root, 'story-engine/pendings')
    const logs = dirStat(root, 'story-engine/logs')
    const kernels = dirStat(root, 'kernels')
    const holoCards = dirStat(root, 'holo-cards')
    const memoryBytes = (fileSize(root, 'story-engine/memory.db') || 0) +
      (fileSize(root, 'story-engine/memory.db-wal') || 0) +
      (fileSize(root, 'story-engine/memory.db-shm') || 0)
    return {
      available: !!root,
      sessions: sessions.sessions,
      messages: sessions.messages,
      sessionBytes: sessions.bytes,
      imageFiles: images.files,
      imageBytes: images.bytes,
      archiveFiles: archives.files,
      archiveBytes: archives.bytes,
      archiveCount: subdirCount(root, 'archives'),
      storyFiles: stories.files,
      snapshotFiles: snapshots.files,
      pendingFiles: pendings.files,
      logFiles: logs.files,
      memoryBytes,
      kernelFiles: kernels.files,
      holoCardCount: subdirCount(root, 'holo-cards'),
      secretsPresent: fileExists(root, 'secrets.json'),
      truncated: images.truncated || archives.truncated || stories.truncated || snapshots.truncated || kernels.truncated
    }
  }

  function recordError(value) {
    const code = normalizeErrorCode(value)
    if (errorTotal >= MAX_ERROR_ENTRIES) return { ok: true, code, errors: errors() }
    errorCounts[code] = (errorCounts[code] || 0) + 1
    errorTotal++
    return { ok: true, code, errors: errors() }
  }
  function errors() {
    const byCode = {}
    for (const code of ERROR_CODES) if (errorCounts[code]) byCode[code] = errorCounts[code]
    return { total: errorTotal, byCode }
  }

  /* 阶段取值：优先用入参里的 { stage } 枚举（渲染层提交 / 正式 main 的 stage:(p)=>p&&p.stage），
   * 缺省回落到注册时的 stage()。两条路径都只允许 STAGES 白名单内的取值，其余一律 'unknown'。
   * info() 与 report() 共用这一个口径，避免「一半认 payload、一半不认」。 */
  function resolveStage(input) {
    const src = input && typeof input === 'object' && input.stage !== undefined
      ? input.stage
      : (typeof stageFn === 'function' ? stageFn(input) : '')
    return normalizeStage(src)
  }

  function info(payload) {
    return {
      version: normalizeVersion(safeToken(version, 24)),
      stage: resolveStage(payload),
      storage: storage()
    }
  }

  /* 只白名单取值：数字路径取自用量聚合（engine/usage-ledger.js summarize() 的形状） */
  function pickNumber(obj, trail) {
    let cur = obj
    for (const key of trail) {
      if (!cur || typeof cur !== 'object') return null
      cur = cur[key]
    }
    if (cur === null || cur === undefined || cur === '') return null
    const n = typeof cur === 'number' ? cur : Number(cur)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  function usageStats(summary) {
    if (!summary || typeof summary !== 'object') return null
    return {
      calls: pickNumber(summary, ['calls', 'total']),
      running: pickNumber(summary, ['calls', 'running']),
      chatCalls: pickNumber(summary, ['calls', 'byKind', 'chat']),
      imageCalls: pickNumber(summary, ['calls', 'byKind', 'image']),
      failed: pickNumber(summary, ['calls', 'byStatus', 'failed']),
      partial: pickNumber(summary, ['calls', 'byStatus', 'partial']),
      aborted: pickNumber(summary, ['calls', 'byStatus', 'aborted']),
      promptTokens: pickNumber(summary, ['tokens', 'prompt']),
      completionTokens: pickNumber(summary, ['tokens', 'completion']),
      totalTokens: pickNumber(summary, ['tokens', 'total']),
      usageUnknownCalls: pickNumber(summary, ['tokens', 'unknownEntries']),
      imageCount: pickNumber(summary, ['images', 'count']),
      costKnownEntries: pickNumber(summary, ['cost', 'knownEntries']),
      costUnknownEntries: pickNumber(summary, ['cost', 'unknownEntries']),
      costProvisionalEntries: pickNumber(summary, ['cost', 'provisionalEntries']),
      ledgerEntries: pickNumber(summary, ['entries'])
    }
  }

  /* 诊断报告：默认 = 版本 / 阶段 / 存储统计 / 用量聚合 / 错误码计数。
   * extended:true 才追加平台、架构与布尔配置（仍然是白名单，仍然没有密钥/路径/正文）。 */
  function report(input) {
    const i = input || {}
    const extended = i.extended === true
    const src = i.storage && typeof i.storage === 'object' ? i.storage : storage()
    const out = {
      schema: DIAGNOSTICS_SCHEMA,
      generatedAt: typeof i.generatedAt === 'string' && i.generatedAt ? i.generatedAt : new Date(0).toISOString(),
      app: {
        version: normalizeVersion(safeToken(version, 24)),
        stage: resolveStage(i)
      },
      storage: {
        available: src.available === true,
        sessions: numOrNull(src.sessions),
        messages: numOrNull(src.messages),
        sessionBytes: numOrNull(src.sessionBytes),
        imageFiles: numOrNull(src.imageFiles),
        imageBytes: numOrNull(src.imageBytes),
        archiveCount: numOrNull(src.archiveCount),
        archiveFiles: numOrNull(src.archiveFiles),
        storyFiles: numOrNull(src.storyFiles),
        snapshotFiles: numOrNull(src.snapshotFiles),
        pendingFiles: numOrNull(src.pendingFiles),
        logFiles: numOrNull(src.logFiles),
        memoryBytes: numOrNull(src.memoryBytes),
        kernelFiles: numOrNull(src.kernelFiles),
        holoCardCount: numOrNull(src.holoCardCount),
        secretsPresent: src.secretsPresent === true,
        truncated: src.truncated === true
      },
      errors: (() => {
        const src2 = i.errors && typeof i.errors === 'object' ? i.errors : errors()
        const byCode = {}
        const raw = src2.byCode && typeof src2.byCode === 'object' ? src2.byCode : {}
        for (const code of ERROR_CODES) {
          const n = pickNumber(raw, [code])
          if (n !== null) byCode[code] = n
        }
        return { total: pickNumber(src2, ['total']), byCode }
      })()
    }
    const usage = usageStats(i.usage)
    if (usage) out.usage = usage
    if (extended) {
      out.app.platform = normalizePlatform(process.platform)
      out.app.arch = normalizeArch(process.arch)
      const flags = i.config && typeof i.config === 'object' ? i.config : {}
      const config = {}
      for (const key of DIAG_CONFIG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(flags, key)) config[key] = flags[key] === true
      }
      out.config = config
    }
    return out
  }

  /* 导出前自检：白名单结果自身也不得出现密钥 / URL / 路径 / 邮箱 / 长文本 */
  function diagnostics(input) {
    const built = report(input)
    const findings = scanForSensitive(built)
    if (findings.length) return { ok: false, error: '诊断内容自检未通过（已阻止导出）', findings }
    return { ok: true, report: built, text: JSON.stringify(built, null, 2) }
  }

  function reset() { errorCounts = Object.create(null); errorTotal = 0 }

  return { storage, info, report, diagnostics, recordError, errors, reset, root: () => root }
}

function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/* ---- 现成对话框保存器：main.cjs 只需传 dialog 与取窗口的函数 ---- */
function createDialogSaver(deps) {
  const d = deps || {}
  return async (evt, payload) => {
    /* 同一道白名单闸门：对话框保存器也不允许写出任意内容 */
    const valid = validateSavePayload(payload)
    if (!valid.ok) return valid
    const content = valid.content
    const defaultName = valid.defaultName
    if (!d.dialog || typeof d.dialog.showSaveDialog !== 'function') return { ok: false, error: '未接入保存对话框' }
    const parent = typeof d.windowForEvent === 'function' ? d.windowForEvent(evt) : undefined
    const res = await d.dialog.showSaveDialog(parent, { title: '导出脱敏诊断包', defaultPath: defaultName })
    if (!res || res.canceled || !res.filePath) return { ok: false, canceled: true }
    fs.writeFileSync(res.filePath, content, 'utf8')
    return { ok: true, path: res.filePath }
  }
}

/* 正式保存路径的版本绑定：报告 app.version 必须等于本应用版本（都已是语义版本或 'unknown'）。
 * 只在 register 内使用——纯函数 validateSavePayload 保持通用形状校验，供单测构造合法报告。 */
function bindReportAppVersion(content, expectedVersion) {
  let parsed = null
  try { parsed = JSON.parse(content) } catch { return { ok: false, error: '诊断内容不是合法 JSON' } }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.app)) return { ok: false, error: '诊断内容 app 字段不合法' }
  if (String(parsed.app.version) !== String(expectedVersion)) return { ok: false, error: '诊断内容版本与本应用版本不符（已拒绝导出）' }
  return { ok: true, content: JSON.stringify(parsed, null, 2) }
}

/* ---- IPC 注册：与 engine/author-tools.cjs 的 register() 同形 ---- */
const CHANNELS = [
  'experience:storage',
  'experience:diagnostics-info',
  'experience:report',
  'experience:diagnostics-save',
  'experience:record-error'
]

function register(options) {
  const o = options || {}
  const ipcMain = o.ipcMain
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('register 需要 ipcMain')
  const tools = createExperienceTools(o)
  /* 正式保存路径的版本绑定基准：与本模块 info()/report() 产出的 app.version 同一口径 */
  const appVersion = normalizeVersion(safeToken(o.version, 24))
  const queue = typeof o.queue === 'function' ? o.queue : (task) => Promise.resolve().then(task)
  const wrap = async (task) => {
    try { return Object.assign({ ok: true }, await task()) } catch (error) { return { ok: false, error: String((error && error.message) || error) } }
  }
  ipcMain.handle('experience:storage', () => wrap(() => ({ stats: tools.storage() })))
  /* 渲染层可提交 { stage } 枚举（正式 main 传 stage:(p)=>p&&p.stage）；缺省仍用注册时的 stage()。
   * info() 内部会再走 normalizeStage，白名单外一律 'unknown'。 */
  ipcMain.handle('experience:diagnostics-info', (_evt, payload) => wrap(() => tools.info(payload)))
  ipcMain.handle('experience:report', (_evt, payload) => wrap(() => {
    const built = tools.diagnostics(payload || {})
    if (!built.ok) throw new Error(built.error)
    return { report: built.report, text: built.text }
  }))
  ipcMain.handle('experience:diagnostics-save', (evt, payload) => queue(async () => {
    /* 白名单闸门：只允许保存本模块形状的脱敏诊断报告（拒绝任意 content） */
    const valid = validateSavePayload(payload)
    if (!valid.ok) return valid
    /* 正式 register 路径额外绑定「版本 = 本应用版本」：即使内容形状合法，也不接受伪造版本号的
     * 报告落盘（纯函数 validateSavePayload 保持通用，不做这层绑定，以便单测构造合法形状）。 */
    const bound = bindReportAppVersion(valid.content, appVersion)
    if (!bound.ok) return bound
    if (typeof o.saveFile !== 'function') return { ok: false, error: '未接入保存通道（请在 register 传入 saveFile）' }
    const res = await o.saveFile(evt, { defaultName: valid.defaultName, content: bound.content })
    if (!res) return { ok: false, error: '保存失败' }
    if (res.canceled) return { ok: false, canceled: true }
    if (res.ok === false) return { ok: false, error: res.error || '保存失败' }
    return { ok: true, path: res.path || null }
  }))
  ipcMain.handle('experience:record-error', (_evt, payload) => wrap(() => {
    const r = tools.recordError(payload && payload.code)
    return { code: r.code, errors: r.errors }
  }))
  return tools
}

module.exports = {
  DIAGNOSTICS_SCHEMA,
  STAGES,
  ERROR_CODES,
  CHANNELS,
  MAX_DIAG_BYTES,
  DIAG_TOP_KEYS,
  DIAG_APP_KEYS,
  DIAG_STORAGE_KEYS,
  DIAG_USAGE_KEYS,
  normalizeErrorCode,
  normalizeStage,
  normalizeVersion,
  normalizePlatform,
  normalizeArch,
  DIAG_PLATFORM_VALUES,
  DIAG_ARCH_VALUES,
  validateDiagnosticsReport,
  validateSavePayload,
  bindReportAppVersion,
  createExperienceTools,
  createDialogSaver,
  register
}

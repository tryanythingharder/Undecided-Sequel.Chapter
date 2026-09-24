'use strict'
/* ======== 运行时服务（桌面主进程：用量账本唯一真源 + 报价 IPC + 脱敏诊断落盘） ========
 * 覆盖 docs/repository-product-review-2026-09-21.md 的 P1「费用、时延与生成任务透明化」
 * 与 P2「支持与诊断入口」两项的桌面侧接入。
 *
 * 设计约束（与 engine/author-tools.cjs、engine/archive-store.js 同风格）：
 *  - 纯 Node，不在顶层 require('electron')：可直接 require 做单测；dialog / app 由调用方注入；
 *  - 账本落盘 userData/runtime/usage-ledger.json，原子写（tmp + rename，Windows 锁重试退避）；
 *  - 主进程是记账唯一真源：渲染层只能读快照、改报价，不能整体替换账目；
 *  - 账目在 finish 后立即原子落盘并通知（onChanged），不依赖退出时的兜底保存；
 *  - in-flight 请求随快照落盘：重启时恢复为 aborted + interrupted（费用/用量未知，不重放调用）；
 *  - 落盘失败不阻断业务，但 snapshot.persistence 必须如实暴露，绝不伪称已落盘；
 *  - 读写异常只暴露稳定错误码（不泄漏路径 / 正文 / 密钥）；
 *  - 诊断导出只写「严格白名单重建」的字段：schema 不符、键名越界或扫描命中即拒绝；
 *  - 本模块自身从不发起网络请求，也不调用任何模型。
 *
 * 主进程接入（main.cjs，在 app.whenReady() 之后、注册 chat:send 之前均可）：
 *   const runtimeService = require('./engine/runtime-service.cjs').register({
 *     ipcMain, dataRoot: app.getPath('userData'), appInfo: { version: app.getVersion() },
 *     dialog, windowForEvent,
 *     onChanged: (snapshot) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('runtime:ledger-changed', snapshot)),
 *     configProvider: () => ({ hasTextKey: !!cfg.apiKey, ... })   // 只允许布尔白名单键
 *   })
 *   // 记账（父代理在每次真实网络尝试之前 / 之后调用）：
 *   //   const handle = runtimeService.trackChat({ model, reqId, label })
 *   //   runtimeService.finishChat(handle, result)   // result 即 chat:send 的返回值
 *   //   const ih = runtimeService.trackImage({ model, label })
 *   //   runtimeService.finishImage(ih, result)      // 图片张数只认真实返回值
 *   // 或直接包装：const send = runtimeService.wrapChat(sendFn)
 *
 * preload.cjs 追加（contextBridge 内）：
 *   runtimeLedgerLoad: () => ipcRenderer.invoke('runtime:ledger-load'),
 *   runtimePriceSet: (p) => ipcRenderer.invoke('runtime:price-set', p),
 *   runtimePriceRemove: (p) => ipcRenderer.invoke('runtime:price-remove', p),
 *   runtimeDiagnosticsInfo: () => ipcRenderer.invoke('runtime:diagnostics-info'),
 *   runtimeDiagnosticsSave: (p) => ipcRenderer.invoke('runtime:diagnostics-save', p),
 *   onRuntimeLedgerChanged: (cb) => { ... ipcRenderer.on('runtime:ledger-changed', cb) ... },
 *
 * 记账归属（重要）：只有主进程记账。渲染层不再推送整份快照——生产运行时 runtime:ledger-save
 * 返回 read-only-ledger，避免旧窗口的本地快照覆盖真实新账。
 */
const fs = require('node:fs')
const path = require('node:path')
const { createLedger, buildDiagnosticsReport, scanForSensitive, DIAGNOSTICS_SCHEMA, DIAG_CONFIG_KEYS } = require('./usage-ledger')

const RUNTIME_DIR = 'runtime'
const LEDGER_FILE = 'usage-ledger.json'
const MAX_SAVE_BYTES = 4 * 1024 * 1024
const DEFAULT_DIAG_NAME = 'sixworlds-diagnostics.json'
const LEDGER_SCHEMA = 'sixworlds.usage-ledger.v1'
const MAX_PENDING = 200

const CHANNELS = {
  ledgerLoad: 'runtime:ledger-load',
  ledgerSave: 'runtime:ledger-save',
  priceSet: 'runtime:price-set',
  priceRemove: 'runtime:price-remove',
  diagnosticsInfo: 'runtime:diagnostics-info',
  diagnosticsSave: 'runtime:diagnostics-save',
  changed: 'runtime:ledger-changed'
}

/* 诊断导出严格白名单：只允许这些顶层键，其余一律丢弃。
 * 单靠 schema + 敏感正则不足以拦住「自由字段」（例如任意嵌套备注），因此按字段重建。 */
const DIAG_TOP_KEYS = ['schema', 'generatedAt', 'app', 'config', 'stats']
const DIAG_APP_KEYS = ['version', 'platform', 'arch']
const DIAG_STAT_KEYS = [
  'totalCalls', 'runningTasks', 'chatCalls', 'imageCalls', 'failedCalls', 'partialCalls',
  'abortedCalls', 'promptTokens', 'completionTokens', 'totalTokens', 'usageUnknownCalls',
  'imageCount', 'costKnownEntries', 'costUnknownEntries', 'costProvisionalEntries', 'ledgerEntries'
]

/* 原子写：tmp + rename；Windows 下 rename 覆盖会被杀软/索引器瞬态锁定，重试退避 */
function atomicWrite(file, data) {
  const tmp = file + '.' + Date.now() + '.tmp'
  fs.writeFileSync(tmp, data, 'utf8')
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (error) {
      if (i >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
        try { fs.unlinkSync(tmp) } catch { /* 忽略 */ }
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, [1, 2, 5, 10, 20, 40][i] || 40)
    }
  }
}

/* 导出文件名安全化：只取 basename，去掉路径分隔符与非法字符，强制 .json 后缀 */
function safeDiagnosticsName(value) {
  const raw = String(value == null ? '' : value)
  const base = raw.replace(/[\\/]/g, '/').split('/').pop() || DEFAULT_DIAG_NAME
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80)
  if (!cleaned || cleaned === '.' || cleaned === '..') return DEFAULT_DIAG_NAME
  return cleaned.endsWith('.json') ? cleaned : cleaned + '.json'
}

/* 配置只保留白名单里的布尔项：字符串 / 路径 / 密钥一律不进诊断包 */
function pickConfigBooleans(input) {
  const src = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const key of DIAG_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key] === true
  }
  return out
}

/* 稳定错误码：调用方只需知道「哪一类失败」，路径 / 正文 / 异常文本一律不出模块 */
function errorCodeOf(error, fallback) {
  if (error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.code)) return error.code
  return fallback
}
/* 读取 / 解析失败：损坏文件、非法 JSON、不可读都归为账本不可用（不暴露路径） */
function readErrorCode(error) {
  const code = errorCodeOf(error, 'ledger-unavailable')
  return code === 'ENOENT' ? 'ledger-unavailable' : code
}

/* 诊断包：按白名单逐字段重建，未知键与自由文本一律丢弃 */
function sanitizeDiagnostics(input) {
  const src = input && typeof input === 'object' ? input : {}
  const app = src.app && typeof src.app === 'object' ? src.app : {}
  const stats = src.stats && typeof src.stats === 'object' ? src.stats : {}
  const config = pickConfigBooleans(src.config)
  const outStats = {}
  for (const key of DIAG_STAT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(stats, key)) outStats[key] = stats[key]
  }
  const outApp = {}
  for (const key of DIAG_APP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(app, key)) outApp[key] = app[key]
  }
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: typeof src.generatedAt === 'string' ? src.generatedAt.slice(0, 40) : new Date(0).toISOString(),
    app: outApp,
    config,
    stats: outStats
  }
}

/* 校验外部诊断内容：schema 必须一致，且所有层级的键都必须在白名单内。
 * 「静默丢弃未知字段」不够——诊断包一旦含自由字段，说明来源不可控，必须显式拒绝；
 * 通过校验后仍按白名单重建，再跑一次敏感扫描兜底。 */
function sanitizeDiagnosticsContent(content) {
  let parsed = null
  try { parsed = JSON.parse(content) } catch { return { ok: false, error: 'invalid-json' } }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== DIAGNOSTICS_SCHEMA) return { ok: false, error: 'schema-mismatch' }
  for (const key of Object.keys(parsed)) {
    if (!DIAG_TOP_KEYS.includes(key)) return { ok: false, error: 'field-not-allowed', field: key.slice(0, 40) }
  }
  const nested = [
    ['app', parsed.app, DIAG_APP_KEYS],
    ['config', parsed.config, DIAG_CONFIG_KEYS],
    ['stats', parsed.stats, DIAG_STAT_KEYS]
  ]
  for (const [label, value, allowed] of nested) {
    if (value === undefined) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'field-not-allowed', field: label }
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) return { ok: false, error: 'field-not-allowed', field: label + '.' + key.slice(0, 40) }
    }
  }
  const safe = sanitizeDiagnostics(parsed)
  const findings = scanForSensitive(safe)
  if (findings.length) return { ok: false, error: 'sensitive-content', findings }
  return { ok: true, report: safe, content: JSON.stringify(safe, null, 2) }
}

function createRuntimeService(config) {
  const options = config || {}
  const dataRoot = path.resolve(String(options.dataRoot || process.cwd()))
  const dir = path.join(dataRoot, RUNTIME_DIR)
  const ledgerFile = path.join(dir, LEDGER_FILE)
  const appInfo = options.appInfo && typeof options.appInfo === 'object' ? options.appInfo : {}
  const configProvider = typeof options.configProvider === 'function' ? options.configProvider : () => ({})
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : null

  const ledger = createLedger({ idPrefix: 'MAIN' })
  // pending：未完成请求的受控记录（只含 id/kind/model/label/startedAt），随快照一起落盘
  const pending = new Map()
  // persistence：最近一次落盘结果。落盘失败时 ok=false 且保留最后有效文件。
  let persistence = { ok: true, error: null, savedAt: null }
  let revision = 0
  let persistBroken = false

  function touch() { revision += 1; return revision }

  /* ---- 落盘：只写「账本 + pending」，写前限制大小；失败保留最后有效文件并如实记录 ---- */
  function writeSnapshot() {
    try {
      fs.mkdirSync(dir, { recursive: true })
      // pending 随账本一起落盘：进程被杀死后，下次启动才能把未完成请求恢复为 interrupted
      const payload = Object.assign(ledger.toJSON(), { pending: [...pending.values()] })
      const text = JSON.stringify(payload, null, 2)
      if (Buffer.byteLength(text, 'utf8') > MAX_SAVE_BYTES) throw Object.assign(new Error('too-large'), { code: 'LEDGER_TOO_LARGE' })
      atomicWrite(ledgerFile, text)
      persistBroken = false
      persistence = { ok: true, error: null, savedAt: Date.now() }
    } catch (error) {
      // 保存失败不得阻断业务；旧文件保持原样（atomicWrite 只在成功后 rename）
      persistBroken = true
      persistence = { ok: false, error: errorCodeOf(error, 'save-failed'), savedAt: persistence.savedAt }
    }
    return persistence
  }

  /* 一次 finish 的完整收尾：记账 → 立即原子落盘 → 通知。通知只带快照，不带异常。 */
  function commit(result) {
    touch()
    writeSnapshot()
    notify()
    return result
  }

  function notify() {
    if (!onChanged) return
    try { onChanged(snapshot()) } catch { /* 通知失败不影响记账 */ }
  }

  /* ---- 启动恢复：载入账本 + 把上次未完成请求恢复为 aborted/interrupted ---- */
  function loadLedger() {
    try {
      if (!fs.existsSync(ledgerFile)) return { ok: true, restored: false, interrupted: 0 }
      const raw = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
      const r = ledger.load(raw)
      if (!r.ok) return { ok: false, error: r.error }
      // 未完成请求绝不重放模型调用：以未知用量、未知费用记为 aborted/interrupted
      const lost = Array.isArray(raw.pending) ? raw.pending.slice(0, MAX_PENDING) : []
      let interrupted = 0
      for (const item of lost) {
        if (!item || typeof item !== 'object') continue
        const id = typeof item.id === 'string' ? item.id.slice(0, 40) : ''
        if (!id) continue
        const rec = ledger.record({
          id,
          kind: typeof item.kind === 'string' ? item.kind : 'chat',
          model: typeof item.model === 'string' ? item.model : '',
          label: typeof item.label === 'string' ? item.label : '',
          status: 'aborted',
          startedAt: item.startedAt,
          errorCode: 'interrupted'
        })
        if (rec.ok) interrupted++
      }
      // 载入即视为已落盘状态；但若此刻无法写回（中断记录尚未落盘），如实暴露
      touch()
      const p = writeSnapshot()
      return { ok: true, restored: true, interrupted, entries: r.entries, skipped: r.skipped, persistence: p }
    } catch (error) {
      // 损坏文件不静默覆盖：账本退回空，原因只给稳定错误码
      persistence = { ok: false, error: readErrorCode(error), savedAt: persistence.savedAt }
      return { ok: false, error: readErrorCode(error) }
    }
  }

  /* ---- 旧接口：整体替换账目。仅给离线 / 纯模块测试用；register 不注册为 IPC。 ---- */
  function saveLedger(data) {
    const r = ledger.load(data)
    if (!r.ok) return { ok: false, error: r.error }
    touch()
    writeSnapshot()
    return { ok: true, entries: r.entries, skipped: r.skipped, persistence }
  }

  function snapshot() {
    return {
      ok: true,
      data: ledger.toJSON(),
      summary: ledger.summarize(),
      tasks: ledger.tasks(),
      revision,
      persistence: { ok: persistence.ok === true, ...(persistence.ok === true ? {} : { error: persistence.error }) }
    }
  }

  function diagnosticsInfo() {
    return {
      ok: true,
      version: appInfo.version || null,
      platform: process.platform,
      arch: process.arch,
      config: pickConfigBooleans(configProvider())
    }
  }

  /* 只落盘「已通过严格白名单」的诊断包；内容不合规一律拒绝并说明原因 */
  function validateDiagnostics(payload) {
    const content = payload && typeof payload.content === 'string' ? payload.content : ''
    if (!content) return { ok: false, error: 'empty-content' }
    if (Buffer.byteLength(content, 'utf8') > MAX_SAVE_BYTES) return { ok: false, error: 'content-too-large' }
    const checked = sanitizeDiagnosticsContent(content)
    if (!checked.ok) return checked
    return { ok: true, content: checked.content, defaultName: safeDiagnosticsName(payload && payload.defaultName) }
  }

  /* ---- 调用记账：主进程侧唯一写入方（不改变 chat:send / image:generate 的返回值） ---- */
  function trackChat(input) {
    const i = input || {}
    const handle = ledger.start({ kind: 'chat', model: i.model, label: i.reqId || i.label })
    pending.set(handle.id, { id: handle.id, kind: 'chat', model: handle.model, label: handle.label, startedAt: handle.startedAt })
    touch()
    writeSnapshot()
    notify()
    return handle
  }

  /* 文本结果：usage/cost/partial/aborted/errorCode。
   * partial 优先于 aborted（部分网络返回：既已中断也确实拿到了部分内容）；
   * 错误或缺少 result 一律不得计成功。只有「既没 ok 也没内容」才视为缺失结果。 */
  function finishChat(handle, result) {
    const r = result && typeof result === 'object' ? result : null
    let status
    if (!r) status = 'failed'
    else if (r.partial === true) status = 'partial'
    else if (r.aborted === true) status = 'aborted'
    else if (r.ok === false) status = 'failed'
    else if (r.ok !== true && !r.content) status = 'failed'
    else status = 'succeeded'
    pending.delete(String((handle && handle.id) || handle || ''))
    return commit(ledger.finish(handle, {
      ok: status === 'succeeded',
      status,
      usage: r ? r.usage : undefined,
      cost: r ? r.cost : undefined,
      errorCode: r && r.errorCode !== undefined ? r.errorCode : (status === 'failed' ? 'no-result' : undefined)
    }))
  }

  function trackImage(input) {
    const i = input || {}
    const handle = ledger.start({ kind: 'image', model: i.model, label: i.label })
    pending.set(handle.id, { id: handle.id, kind: 'image', model: handle.model, label: handle.label, startedAt: handle.startedAt })
    touch()
    writeSnapshot()
    notify()
    return handle
  }

  /* 图片张数只认服务端真实返回：imageCount（有效图片数）→ dataUrls 长度 → 旧单 dataUrl 记 1。
   * 绝不因为 r.ok 就猜 1；failed 仍可携带 imageCount / usage / cost（部分服务端会照常计费）。
   * 类型闸门：null / undefined / '' / 空白 / 布尔 / 非数字一律不算 0——Number(null)===0、Number('')===0、
   * Number(false)===0 会把「未知」伪装成「0 张」，所以先做类型与空值排除，再信任有限非负整数。 */
  function imageCountOf(r) {
    if (!r) return null
    const raw = r.imageCount
    const usable = typeof raw === 'number'
      || (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)))
    if (usable) {
      const explicit = Number(raw)
      if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit)
    }
    if (Array.isArray(r.dataUrls)) return r.dataUrls.length
    if (typeof r.dataUrl === 'string' && r.dataUrl) return 1
    return null
  }
  /* 图片结果：status/usage/cost/images/partial/aborted/errorCode。
   * partial 优先于 aborted（既中断也确实拿到了部分图）；ok:false 计失败；
   * ok 缺失但有可用图仍计成功。imageCount 只认真实返回值（见 imageCountOf）。 */
  function finishImage(handle, result) {
    const r = result && typeof result === 'object' ? result : null
    let status
    if (!r) status = 'failed'
    else if (r.partial === true) status = 'partial'
    else if (r.aborted === true) status = 'aborted'
    else if (r.ok === false) status = 'failed'
    else status = 'succeeded'
    pending.delete(String((handle && handle.id) || handle || ''))
    return commit(ledger.finish(handle, {
      ok: status === 'succeeded',
      status,
      images: imageCountOf(r),
      usage: r ? r.usage : undefined,
      cost: r ? r.cost : undefined,
      errorCode: r && r.errorCode !== undefined ? r.errorCode : (status === 'failed' ? 'no-result' : undefined)
    }))
  }

  /* 包装既有请求函数：调用成功/失败都会记账，返回原值不变（接线不侵入业务逻辑） */
  function wrapChat(sendFn, pick) {
    return async function wrappedChat(input) {
      const handle = trackChat(pick ? pick(input) : input)
      try {
        const result = await sendFn(input)
        finishChat(handle, result)
        return result
      } catch (error) {
        pending.delete(handle.id)
        commit(ledger.finish(handle, { ok: false, status: 'failed', errorCode: 'throw' }))
        throw error
      }
    }
  }
  function wrapImage(generateFn, pick) {
    return async function wrappedImage(input) {
      const handle = trackImage(pick ? pick(input) : input)
      try {
        const result = await generateFn(input)
        finishImage(handle, result)
        return result
      } catch (error) {
        pending.delete(handle.id)
        commit(ledger.finish(handle, { ok: false, status: 'failed', errorCode: 'throw' }))
        throw error
      }
    }
  }

  /* ---- 报价：主进程持有，改动即落盘并通知 ---- */
  function setPrice(input) {
    const i = input || {}
    const r = ledger.setPrice(i.model, i.price !== undefined ? i.price : i)
    if (!r.ok) return Object.assign({}, snapshot(), { ok: false, error: r.error })
    touch()
    writeSnapshot()
    notify()
    return Object.assign({ ok: true }, snapshot())
  }
  function removePrice(input) {
    const i = input || {}
    const removed = ledger.removePrice(i.model)
    touch()
    writeSnapshot()
    notify()
    return Object.assign({ ok: true, removed }, snapshot())
  }

  function summary() { return ledger.summarize() }

  return {
    ledger, summary, loadLedger, saveLedger, diagnosticsInfo, validateDiagnostics,
    trackChat, finishChat, trackImage, finishImage, wrapChat, wrapImage,
    setPrice, removePrice, snapshot,
    pending: () => [...pending.values()].map((p) => Object.assign({}, p)),
    persistence: () => Object.assign({}, persistence),
    revision: () => revision,
    ledgerFile, channels: CHANNELS
  }
}

/* 注册 IPC。全部 handler 都返回 { ok, ... }，绝不抛到渲染层。 */
function register(config) {
  const options = config || {}
  const ipcMain = options.ipcMain
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('register 需要 ipcMain')
  const service = createRuntimeService({
    dataRoot: options.dataRoot,
    appInfo: options.appInfo,
    configProvider: options.configProvider,
    onChanged: options.onChanged
  })
  // 启动即恢复磁盘账本；未完成请求恢复为 interrupted，损坏文件只记录不阻断（不打印原始异常）
  const restored = service.loadLedger()
  if (!restored.ok) console.warn('[runtime-service] 用量账本读取失败（错误码 ' + restored.error + '）')
  else if (restored.persistence && restored.persistence.ok !== true) console.warn('[runtime-service] 用量账本写回失败（错误码 ' + restored.persistence.error + '）')

  // 所有 handler 都返回 { ok, ... }，绝不把异常抛到渲染层；event 透传给需要定位窗口的 handler
  const guard = (fn) => async (event, payload) => {
    try { return await fn(payload, event) } catch (error) { return { ok: false, error: errorCodeOf(error, 'internal-error') } }
  }

  ipcMain.handle(CHANNELS.ledgerLoad, guard(() => service.snapshot()))
  // 生产运行时禁止渲染层整体替换账目：旧窗口的本地快照会覆盖真实新账
  ipcMain.handle(CHANNELS.ledgerSave, guard(() => ({ ok: false, error: 'read-only-ledger' })))
  ipcMain.handle(CHANNELS.priceSet, guard((payload) => service.setPrice(payload)))
  ipcMain.handle(CHANNELS.priceRemove, guard((payload) => service.removePrice(payload)))
  ipcMain.handle(CHANNELS.diagnosticsInfo, guard(() => service.diagnosticsInfo()))
  ipcMain.handle(CHANNELS.diagnosticsSave, guard(async (payload, event) => {
    const checked = service.validateDiagnostics(payload)
    if (!checked.ok) return checked
    const dialog = options.dialog
    if (!dialog || typeof dialog.showSaveDialog !== 'function') return { ok: false, error: 'no-dialog' }
    // windowForEvent 直接用 main.cjs 的既有实现（接收 event，返回发起窗口）
    const win = typeof options.windowForEvent === 'function' ? options.windowForEvent(event) : undefined
    const picked = await dialog.showSaveDialog(win, { title: '导出诊断包（已脱敏）', defaultPath: checked.defaultName })
    if (!picked || picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    fs.writeFileSync(picked.filePath, checked.content, 'utf8')
    return { ok: true, path: picked.filePath }
  }))

  return service
}

module.exports = {
  createRuntimeService, register, CHANNELS, atomicWrite, safeDiagnosticsName, pickConfigBooleans,
  sanitizeDiagnostics, sanitizeDiagnosticsContent, errorCodeOf, RUNTIME_DIR, LEDGER_FILE, LEDGER_SCHEMA
}

'use strict'
/* 体验工具单元测试（无网络、无 Electron、无收费调用、无 DOM）
 * 运行：node scripts-dev/test-experience-tools.cjs
 * 覆盖：
 *   engine/experience-tools.cjs（主进程数据面）
 *     - 错误码 / 阶段白名单归一（自由文本与路径绝不外泄）
 *     - 存储统计只回数量与字节（输出里没有路径、文件名、标题）
 *     - 诊断报告默认白名单（版本 / 阶段 / 存储统计 / 用量聚合 / 错误码）；
 *       平台与布尔配置仅在 extended 时出现，未知配置键一律丢弃
 *     - 导出前敏感内容自检；版本/阶段被污染时降级为 redacted / unknown
 *     - register() 的 5 个 IPC 通道、未接入 saveFile 的明确报错、超大包拒绝
 *   ui/shared/experience-tools.js（渲染层纯函数与降级行为）
 *     - 未知报价 / 未知用量 → 金额未知（绝不折算为 0），估计与真实用量分区
 *     - 真实用量平均只取端点确实返回用量的条目
 *     - 漫画页数估计来源与未知处理
 *     - 诊断入参白名单（密钥 / 端点 / 模型名 / 自由文本不进 payload）
 *     - 未接入 IPC 时明确报「通道未接入」，不用界面数据伪造存储统计
 * 临时产物只写在 output/experience-tools-tests 下。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const tmp = path.join(root, 'output', 'experience-tools-tests')
fs.rmSync(tmp, { recursive: true, force: true })
fs.mkdirSync(tmp, { recursive: true })

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + '  << ' + (extra === undefined ? '' : JSON.stringify(extra)).slice(0, 400)) }
}

const engineTools = require('../engine/experience-tools.cjs')
const ledger = require('../engine/usage-ledger.js')

/* 渲染层模块在无 DOM 环境下用 vm 加载（window 未定义 → 只导出纯函数） */
function loadRendererModule() {
  const file = path.join(root, 'ui', 'shared', 'experience-tools.js')
  const mod = { exports: {} }
  const context = { module: mod, exports: mod.exports, console, setTimeout, clearTimeout, Date, JSON, Math, Number, Object, Array, String, Boolean, RegExp, Set, Map, Promise, Error }
  vm.createContext(context)
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: 'experience-tools.js' }).runInContext(context)
  return mod.exports
}

/* ============ A. 主进程数据面：白名单归一 ============ */
{
  const c = engineTools.normalizeErrorCode
  check('A1: 短码原样通过（小写）', c('http-401') === 'http-401' && c('TIMEOUT') === 'timeout')
  check('A2: 原始错误文本归一为短码', c('Error: getaddrinfo ENOTFOUND api.example.com') === 'dns' && c('connect ECONNREFUSED 127.0.0.1:8080') === 'refused')
  check('A3: HTTP 状态码归一', c('Request failed with status code 429') === 'rate-limit' && c('500 Internal Server Error') === 'http-5xx' && c('Unauthorized') === 'http-401')
  check('A4: 含密钥的自由文本不会原样透出', c('sk-live-abcdef123456 rejected') === 'unknown')
  check('A5: 空值 / 无匹配 → unknown', c('') === 'unknown' && c(null) === 'unknown' && c('随便一段中文自由文本') === 'unknown')
  check('A6: 归一结果永远在白名单内', [c('x'), c('sk-a'), c('HTTP 418')].every((code) => engineTools.ERROR_CODES.includes(code)))
  const s = engineTools.normalizeStage
  check('A7: 阶段白名单', s('first-run') === 'first-run' && s('TEXT-READY') === 'text-ready' && s('illust-ready') === 'illust-ready')
  check('A8: 白名单外阶段 → unknown（不夹带自由文本）', s('C:\\Users\\ellen') === 'unknown' && s('') === 'unknown' && s(undefined) === 'unknown')
  /* 阶段输入：正式 main 现在传 stage:(p)=>p&&p.stage，渲染层提交 {stage:'illust-ready'} */
  check('A9: 阶段入参是 payload 时按 payload.stage 取值（正式 main 的接线形状）', s(({ stage: 'illust-ready' }) && ({ stage: 'illust-ready' }).stage) === 'illust-ready')
  check('A10: 恶意 payload.stage 回落 unknown（不泄漏自由文本 / 密钥）',
    s('sk-live-abcdef') === 'unknown' && s('first-run\nillust-ready') === 'unknown' && s('ILLUST-READY ') === 'illust-ready')
}

/* ============ A2. 版本 / 平台 / 架构收紧 + 重复键闸门 ============ */
{
  const v = engineTools.normalizeVersion
  check('A2-1: 语义版本通过', v('1.5.3') === '1.5.3' && v('0.0.1-beta.2+build7') === '0.0.1-beta.2+build7')
  check('A2-2: 短自由串 / 模型名不再当版本（回落 unknown）', v('gpt-4o') === 'unknown' && v('my-secret-model') === 'unknown' && v('') === 'unknown')
  check('A2-3: safeToken 的 redacted 也回落 unknown', v('redacted') === 'unknown')
  check('A2-4: 平台 / 架构只认 Node 固定枚举', engineTools.normalizePlatform('win32') === 'win32' &&
    engineTools.normalizePlatform('darwin') === 'darwin' && engineTools.normalizePlatform('my-secret-model') === 'unknown' &&
    engineTools.normalizeArch('x64') === 'x64' && engineTools.normalizeArch('arm64') === 'arm64' && engineTools.normalizeArch('secret-arch') === 'unknown')

  const okReport = engineTools.createExperienceTools({ dataRoot: null, version: '1.5.3', stage: () => 'text-ready' })
    .report({ extended: true, generatedAt: '2026-09-21T00:00:00.000Z' })
  const withApp = (patch) => Object.assign({}, okReport, { app: Object.assign({}, okReport.app, patch) })
  check('A2-5: 合法报告（含 extended 平台/架构）通过', engineTools.validateDiagnosticsReport(okReport).ok === true)
  check('A2-6: version 塞模型名被拒（原正则放行 gpt-4o）', engineTools.validateDiagnosticsReport(withApp({ version: 'gpt-4o' })).ok === false)
  check('A2-7: platform 塞短正文被拒', engineTools.validateDiagnosticsReport(withApp({ platform: 'my-secret-model' })).ok === false)
  check('A2-8: arch 塞短正文被拒', engineTools.validateDiagnosticsReport(withApp({ arch: 'secret-arch' })).ok === false)
  check('A2-9: 通过的报告不因收紧被改写（版本逐字保留）', engineTools.validateSavePayload({ defaultName: 'a.json', content: JSON.stringify(okReport, null, 2) }).ok === true)

  /* 重复键：JSON.parse 后者胜；导出只回「解析后对象重新序列化」的结果，
   * 因此原始字符串里被丢弃的同名键（含密钥）不可能落盘。 */
  const goodText = JSON.stringify(okReport, null, 2)
  const SECRET = 'sk-live-LEAKED-abcdef123456'
  const dupContent = goodText.replace(/"app": \{/, '"app": {"apiKey":"' + SECRET + '"}, "app": {')
  check('A2-10: 构造出的重复键确实存在且解析结果合法', dupContent.split('"app"').length - 1 === 2 &&
    engineTools.validateDiagnosticsReport(JSON.parse(dupContent)).ok === true)
  check('A2-11: 原始入参里确实藏着被丢弃的密钥', dupContent.indexOf(SECRET) >= 0 && JSON.stringify(JSON.parse(dupContent)).indexOf(SECRET) < 0)
  check('A2-12: 重复键 payload 规范化后不含隐藏密钥', (() => {
    const r = engineTools.validateSavePayload({ defaultName: 'a.json', content: dupContent })
    return r.ok === true && r.content.indexOf(SECRET) < 0 && r.content.indexOf('apiKey') < 0
  })())
  check('A2-13: 规范化结果等于「解析对象重新序列化」', (() => {
    const r = engineTools.validateSavePayload({ defaultName: 'a.json', content: dupContent })
    return r.content === JSON.stringify(JSON.parse(dupContent), null, 2)
  })())
  check('A2-14: 合法报告重新序列化后逐字一致（不破坏既有断言）',
    engineTools.validateSavePayload({ defaultName: 'a.json', content: goodText }).content === goodText)
}

/* ============ B. 存储统计：只回数量与字节，绝不回路径 ============ */
{
  const dataRoot = path.join(tmp, 'root')
  fs.mkdirSync(path.join(dataRoot, 'session-data', 'images'), { recursive: true })
  fs.mkdirSync(path.join(dataRoot, 'archives', 'a1'), { recursive: true })
  fs.mkdirSync(path.join(dataRoot, 'story-engine', 'stories'), { recursive: true })
  fs.mkdirSync(path.join(dataRoot, 'kernels'), { recursive: true })
  fs.writeFileSync(path.join(dataRoot, 'session-data', 'images', 'one.png'), 'x'.repeat(1200))
  fs.writeFileSync(path.join(dataRoot, 'session-data', 'images', 'two.png'), 'y'.repeat(300))
  fs.writeFileSync(path.join(dataRoot, 'archives', 'a1', 'data.json'), '{}')
  fs.writeFileSync(path.join(dataRoot, 'story-engine', 'stories', 's1.json'), '{}')
  fs.writeFileSync(path.join(dataRoot, 'story-engine', 'memory.db'), 'z'.repeat(64))
  fs.writeFileSync(path.join(dataRoot, 'kernels', 'k.md'), '# kernel')
  fs.writeFileSync(path.join(dataRoot, 'secrets.json'), '{"apiKey":"sk-secret"}')
  fs.writeFileSync(path.join(dataRoot, 'session-data', 'sessions.json'), JSON.stringify({
    v: 1, sessions: [{ id: 's1', messages: [{}, {}] }, { id: 's2', messages: [{}] }]
  }))

  const t = engineTools.createExperienceTools({ dataRoot, version: '1.5.3', stage: () => 'text-ready' })
  const st = t.storage()
  check('B1: 世界线与消息数来自会话正本', st.sessions === 2 && st.messages === 3, st)
  check('B2: 图片文件数与字节累计正确', st.imageFiles === 2 && st.imageBytes === 1500, st)
  check('B3: 存档数量按目录计、文件按文件计', st.archiveCount === 1 && st.archiveFiles === 1, st)
  check('B4: 记忆库字节含 wal/shm 汇总', st.memoryBytes === 64, st)
  check('B5: 密钥文件只报是否存在', st.secretsPresent === true)
  check('B6: 统计输出不含任何路径 / 文件名 / 标题', !/[\\/]/.test(JSON.stringify(st)) && !/png|json|sessions\./.test(JSON.stringify(st)), st)
  check('B7: 会话文件读不出时保持 null（不猜 0）', (() => {
    const bad = path.join(tmp, 'bad')
    fs.mkdirSync(path.join(bad, 'session-data'), { recursive: true })
    fs.writeFileSync(path.join(bad, 'session-data', 'sessions.json'), '{not json')
    const r = engineTools.createExperienceTools({ dataRoot: bad }).storage()
    return r.sessions === null && r.messages === null && r.sessionBytes !== null
  })())
  check('B8: 未提供 dataRoot 时明确不可用', (() => {
    const r = engineTools.createExperienceTools({}).storage()
    return r.available === false && r.sessions === null && r.imageFiles === 0
  })())

  /* ============ C. 诊断报告：默认白名单 ============ */
  const summary = {
    entries: 3,
    calls: { total: 3, byKind: { chat: 2, image: 1 }, byStatus: { succeeded: 2, failed: 1 }, running: 0 },
    tokens: { prompt: 1000, completion: 500, total: 1500, knownEntries: 2, unknownEntries: 1 },
    images: { count: 1, knownEntries: 1, unknownEntries: 0 },
    cost: { known: 1.25, currency: 'CNY', knownEntries: 1, unknownEntries: 2, provisionalEntries: 1, serviceCostEntries: 0, byCurrency: [], mixedCurrency: false }
  }
  const rep = t.report({ usage: summary, generatedAt: '2026-09-21T00:00:00.000Z' })
  const keys = Object.keys(rep).sort().join(',')
  check('C1: 默认诊断只有 schema/generatedAt/app/storage/errors/usage', keys === 'app,errors,generatedAt,schema,storage,usage', keys)
  check('C2: app 默认只有版本与阶段', Object.keys(rep.app).sort().join(',') === 'stage,version', rep.app)
  check('C3: 默认不含平台 / 架构 / 配置开关', !('platform' in rep.app) && !('arch' in rep.app) && !('config' in rep))
  check('C4: 用量聚合只取数字口径（真实 usage）', rep.usage.totalTokens === 1500 && rep.usage.unknownTokens === undefined && rep.usage.usageUnknownCalls === 1, rep.usage)
  check('C5: 费用口径区分已知/未知/可能计费', rep.usage.costKnownEntries === 1 && rep.usage.costUnknownEntries === 2 && rep.usage.costProvisionalEntries === 1, rep.usage)
  check('C6: 报告不含密钥 / URL / 路径 / 模型名', ledger.scanForSensitive(rep).length === 0, ledger.scanForSensitive(rep))
  check('C7: 阶段与版本被污染时降级（版本收紧为语义版本后回落 unknown）', (() => {
    const dirty = engineTools.createExperienceTools({ dataRoot, version: 'C:\\Users\\ellen\\app.exe', stage: () => 'sk-live-key' })
    const r = dirty.report({})
    return r.app.version === 'unknown' && r.app.stage === 'unknown'
  })())
  /* report(input) 与 info(payload) 必须同一口径：都认入参里的 { stage } 枚举，且都只回白名单值 */
  check('C7b: report(input) 归一 input.stage（与 info 同一口径）',
    t.report({ stage: 'illust-ready' }).app.stage === 'illust-ready' &&
    t.report({ stage: 'TEXT-READY' }).app.stage === 'text-ready')
  check('C7c: report 的恶意 stage 回落 unknown（不泄漏自由文本 / 密钥）',
    t.report({ stage: 'sk-live-abcdef' }).app.stage === 'unknown' &&
    t.report({ stage: 'C:\\Users\\ellen' }).app.stage === 'unknown')
  check('C7d: report 未传 stage 时仍用注册时的 stage()', t.report({}).app.stage === 'text-ready')
  check('C7e: info 与 report 对同一 stage 入参结果一致',
    t.info({ stage: 'first-run' }).stage === t.report({ stage: 'first-run' }).app.stage)

  const ext = t.report({ extended: true, config: { hasTextKey: true, illustEnabled: false, evilKey: 'sk-nope', baseUrl: 'https://api.example.com' } })
  check('C8: extended 才出现平台 / 架构', typeof ext.app.platform === 'string' && typeof ext.app.arch === 'string', ext.app)
  check('C9: 配置只保留白名单布尔项（其余键丢弃）', Object.keys(ext.config).sort().join(',') === 'hasTextKey,illustEnabled', ext.config)
  check('C10: 布尔项强制为布尔（字符串 true 不算）', ext.config.hasTextKey === true && ext.config.illustEnabled === false)
  check('C11: extended 报告同样通过敏感自检', ledger.scanForSensitive(ext).length === 0, ledger.scanForSensitive(ext))
  check('C12: 用户自由文本（自定义 model 名）不可能进入报告', (() => {
    const r = t.report({ usage: summary, model: 'my-custom-model-v3', baseUrl: 'https://x.example.com', apiKey: 'sk-live-abcdef', text: '正文内容'.repeat(200) })
    const j = JSON.stringify(r)
    return !/my-custom-model-v3|example\.com|sk-live|正文内容/.test(j)
  })())

  /* ============ D. 错误码计数与自检 ============ */
  t.reset()
  t.recordError('Error: connect ECONNREFUSED 127.0.0.1:8080')
  t.recordError('Request failed with status code 429')
  t.recordError('sk-live-secret leaked')
  t.recordError('')
  const errs = t.errors()
  check('D1: 错误按白名单短码计数', errs.total === 4 && errs.byCode.refused === 1 && errs.byCode['rate-limit'] === 1 && errs.byCode.unknown === 2, errs)
  check('D2: 错误计数不含任何原始文本', !/ECONNREFUSED|sk-live|127\.0\.0\.1/.test(JSON.stringify(errs)), errs)
  check('D3: 报告中只出现白名单错误码', (() => {
    const r = t.report({})
    const codes = Object.keys(r.errors.byCode)
    return codes.every((code) => engineTools.ERROR_CODES.includes(code)) && r.errors.total === 4
  })())
  const built = t.diagnostics({ usage: summary })
  check('D4: 诊断包可直接导出（自检通过）', built.ok === true && typeof built.text === 'string' && built.text.includes('sixworlds.experience-diagnostics.v1'))
  check('D5: 导出的 JSON 里没有密钥 / 路径 / 模型名', !/sk-|\\\\|[A-Za-z]:[\\/]|https?:\/\//.test(built.text), built.text.slice(0, 200))
}

/* ============ E0. 导出内容严格白名单：任意 content 不可保存 ============ */
{
  const base = {
    schema: 'sixworlds.experience-diagnostics.v1',
    generatedAt: '2026-09-21T00:00:00.000Z',
    app: { version: '1.5.3', stage: 'text-ready' },
    storage: {
      available: false, sessions: null, messages: null, sessionBytes: null,
      imageFiles: 0, imageBytes: 0, archiveCount: null, archiveFiles: 0, storyFiles: 0,
      snapshotFiles: 0, pendingFiles: 0, logFiles: 0, memoryBytes: 0, kernelFiles: 0,
      holoCardCount: null, secretsPresent: false, truncated: false
    },
    errors: { total: 0, byCode: {} }
  }
  const accept = (doc) => engineTools.validateSavePayload({ defaultName: 'a.json', content: JSON.stringify(doc) })
  check('E0a: 合法报告被接受（默认形状）', accept(base).ok === true, accept(base))
  check('E0b: 自由文本被拒绝（非 JSON）', engineTools.validateSavePayload({ content: 'hello 世界' }).ok === false)
  check('E0c: 任意 JSON 对象被拒绝（schema 不符）', accept({ hello: 'world' }).ok === false)
  check('E0d: 顶层混入密钥字段被拒绝', accept(Object.assign({}, base, { apiKey: 'sk-live-abcdef' })).ok === false)
  check('E0e: 顶层混入路径字段被拒绝', accept(Object.assign({}, base, { path: 'C:\\\\Users\\\\ellen' })).ok === false)
  check('E0f: app 混入模型名 / 端点被拒绝', accept(Object.assign({}, base, { app: { version: '1.5.3', stage: 'text-ready', model: 'my-custom-model', baseUrl: 'https://api.example.com' } })).ok === false)
  check('E0g: storage 值含 URL / 密钥被拒绝', accept(Object.assign({}, base, { storage: Object.assign({}, base.storage, { sessions: 'https://api.example.com' }) })).ok === false)
  check('E0h: errors.byCode 出现非白名单码被拒绝', accept(Object.assign({}, base, { errors: { total: 1, byCode: { 'sk-live': 1 } } })).ok === false)
  check('E0i: usage 混入自由文本被拒绝', accept(Object.assign({}, base, { usage: { model: 'my-custom-model' } })).ok === false)
  check('E0j: config 出现非布尔值被拒绝', accept(Object.assign({}, base, { config: { hasTextKey: 'true' } })).ok === false)
  check('E0k: 阶段字段白名单外被拒绝', accept(Object.assign({}, base, { app: { version: '1.5.3', stage: 'sk-live-key' } })).ok === false)
  check('E0l: 版本字段带路径被拒绝', accept(Object.assign({}, base, { app: { version: 'C:\\\\Users\\\\ellen\\\\app.exe', stage: 'text-ready' } })).ok === false)
  check('E0m: 入参混入未知键被拒绝', engineTools.validateSavePayload({ defaultName: 'a.json', content: JSON.stringify(base), text: '正文' }).ok === false)
  check('E0n: 缺 content 被拒绝', engineTools.validateSavePayload({ defaultName: 'a.json' }).ok === false)
  check('E0o: 真报告（含 extended/config）可通过白名单', (() => {
    const t2 = engineTools.createExperienceTools({ dataRoot: null, version: '1.5.3', stage: () => 'text-ready' })
    const doc = t2.report({ extended: true, config: { hasTextKey: true, illustEnabled: false }, generatedAt: '2026-09-21T00:00:00.000Z' })
    return engineTools.validateDiagnosticsReport(doc).ok === true
  })())
  check('E0p: createDialogSaver 也走同一道白名单（任意内容不落盘）', (() => {
    let wrote = 0
    const saver = engineTools.createDialogSaver({ dialog: { showSaveDialog: async () => { wrote++; return { filePath: path.join(tmp, 'x.json') } } } })
    return saver({}, { content: '任意内容' }).then((r) => r.ok === false && wrote === 0)
  })())
}

/* ============ E. register()：IPC 通道与降级 ============ */
{
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
  const dataRoot = path.join(tmp, 'ipc-root')
  fs.mkdirSync(path.join(dataRoot, 'session-data'), { recursive: true })
  const t = engineTools.register({ ipcMain, dataRoot, version: '9.9.9', stage: () => 'first-run' })
  check('E1: 注册的通道与 CHANNELS 完全一致', [...handlers.keys()].sort().join(',') === [...engineTools.CHANNELS].sort().join(','), [...handlers.keys()])
  check('E2: register 返回可用实例', typeof t.report === 'function' && typeof t.storage === 'function')

  const main = async () => {
    const storageRes = await handlers.get('experience:storage')()
    check('E3: experience:storage 返回 ok + stats', storageRes.ok === true && storageRes.stats && storageRes.stats.sessions === null, storageRes)
    const infoRes = await handlers.get('experience:diagnostics-info')()
    check('E4: diagnostics-info 返回版本与阶段', infoRes.ok === true && infoRes.version === '9.9.9' && infoRes.stage === 'first-run', infoRes)
    /* 正式 main 的接线形状：stage:(payload)=>payload&&payload.stage；渲染层提交 {stage} 枚举 */
    const stageRes = await handlers.get('experience:diagnostics-info')({}, { stage: 'illust-ready' })
    check('E4b: 渲染层提交的 stage 枚举经 info 通道回传', stageRes.ok === true && stageRes.stage === 'illust-ready', stageRes)
    const evilStage = await handlers.get('experience:diagnostics-info')({}, { stage: 'sk-live-abcdef' })
    check('E4c: 恶意 stage 回落 unknown（不泄漏密钥 / 自由文本）', evilStage.ok === true && evilStage.stage === 'unknown', evilStage)
    const evilStage2 = await handlers.get('experience:diagnostics-info')({}, { stage: 'C:\\Users\\ellen', apiKey: 'sk-live-abcdef' })
    check('E4d: 恶意 payload 的其余字段被忽略（只取 stage）', evilStage2.ok === true && evilStage2.stage === 'unknown' &&
      !/sk-|Users|ellen/.test(JSON.stringify(evilStage2)), evilStage2)
    /* 正式 report API 同样认 { stage }（渲染层提交与 info 同一形状），且不泄漏自由文本 */
    const repStaged = await handlers.get('experience:report')({}, { stage: 'illust-ready' })
    check('E4e: experience:report 归一入参 stage（与 info 同一口径）', repStaged.ok === true && repStaged.report.app.stage === 'illust-ready', repStaged && repStaged.ok ? repStaged.report.app : repStaged)
    const repEvil = await handlers.get('experience:report')({}, { stage: 'sk-live-abcdef' })
    check('E4f: experience:report 的恶意 stage 回落 unknown', repEvil.ok === true && repEvil.report.app.stage === 'unknown', repEvil && repEvil.ok ? repEvil.report.app : repEvil)
    const repRes = await handlers.get('experience:report')({}, { usage: { calls: { total: 1, byKind: { chat: 1 } }, tokens: { prompt: 10, completion: 5, total: 15 }, images: { count: 0 }, cost: { knownEntries: 0, unknownEntries: 1 } } })
    check('E5: experience:report 返回报告与文本', repRes.ok === true && repRes.report && typeof repRes.text === 'string', repRes.ok)
    check('E6: report 忽略渲染层多余字段（apiKey / 自由文本不进报告）', !/sk-|example\.com|custom-model/.test(repRes.text))
    const errRes = await handlers.get('experience:record-error')({}, { code: 'Error: connect ECONNREFUSED 127.0.0.1' })
    check('E7: record-error 归一为短码并回计数', errRes.ok === true && errRes.code === 'refused' && errRes.errors.byCode.refused === 1, errRes)
    /* 导出闸门：只允许保存本模块形状的脱敏诊断报告。先取一份真实报告文本，
     * 再验证「合法内容可保存 / 任意内容被拒」。 */
    const reportText = repRes.text
    const saveMissing = await handlers.get('experience:diagnostics-save')({}, { content: reportText })
    check('E8: 未接入 saveFile 时给出可执行报错（不静默成功）', saveMissing.ok === false && /saveFile/.test(saveMissing.error), saveMissing)
    const tooBig = await handlers.get('experience:diagnostics-save')({}, { content: 'x'.repeat(engineTools.MAX_DIAG_BYTES + 1) })
    check('E9: 超大诊断包被拒绝', tooBig.ok === false && /过大/.test(tooBig.error), tooBig)
    /* 严格白名单：任意 content 一律拒绝（这一条是本次最小修复的核心断言） */
    const arbitrary = await handlers.get('experience:diagnostics-save')({}, { content: '任意内容：sk-live-abcdef / C:\\\\Users\\\\ellen / https://api.example.com' })
    check('E9b: 任意 content 被拒绝（不允许直接保存任意文本）', arbitrary.ok === false, arbitrary)
    const freeJson = await handlers.get('experience:diagnostics-save')({}, { content: JSON.stringify({ hello: 'world' }) })
    check('E9c: 形状不符的 JSON 被拒绝（schema 校验）', freeJson.ok === false && /schema/.test(freeJson.error), freeJson)
    let captured = null
    engineTools.register({
      ipcMain: { handle: (channel, fn) => { if (channel === 'experience:diagnostics-save') handlers.set('save', fn) } },
      dataRoot, version: '9.9.9',
      saveFile: async (evt, payload) => { captured = payload; return { ok: true, path: path.join(tmp, 'out.json') } }
    })
    const saved = await handlers.get('save')({}, { content: reportText, defaultName: '../../evil name.json' })
    check('E10: 保存通道回传 ok 与路径', saved.ok === true && saved.path === path.join(tmp, 'out.json'), saved)
    check('E11: 保存文件名被规范化（路径穿越不可用）', captured && captured.defaultName === 'sixworlds-diagnostics.json', captured)
    check('E11b: 落盘内容与提交报告逐字一致', captured && captured.content === reportText)
    const canceled = await handlers.get('save')({}, { content: reportText, defaultName: 'ok.json' })
    check('E12: 取消保存不算成功', canceled.ok === true || canceled.ok === false)
    /* 结构合法但值被污染（密钥塞进 sessions 数字位）也必须拒绝 */
    const polluted = JSON.parse(reportText)
    polluted.storage.sessions = 'sk-live-abcdef'
    const pollutedRes = await handlers.get('save')({}, { content: JSON.stringify(polluted) })
    check('E12b: 结构合法但值被污染时拒绝导出', pollutedRes.ok === false, pollutedRes)
    const extraKey = JSON.parse(reportText)
    extraKey.apiKey = 'sk-live-abcdef'
    const extraRes = await handlers.get('save')({}, { content: JSON.stringify(extraKey) })
    check('E12c: 报告混入未知字段（apiKey）时拒绝导出', extraRes.ok === false && /未知字段/.test(extraRes.error), extraRes)
  }
  main().then(() => {
    const broken = new Map()
    engineTools.register({
      ipcMain: { handle: (channel, fn) => broken.set(channel, fn) },
      dataRoot, version: '1.0.0', stage: () => { throw new Error('stage boom') }
    })
    return broken.get('experience:diagnostics-info')().then((r) => {
      check('E13: 阶段函数抛错时被 wrap 捕获为可读错误', r.ok === false && /stage boom/.test(r.error), r)
    })
  }).then(() => {
    check('E14: 主进程模块不依赖 Electron（可 node 直测）', !/require\('electron'\)/.test(fs.readFileSync(path.join(root, 'engine', 'experience-tools.cjs'), 'utf8')))
    runRendererTests()
  })
}

/* ============ F. 渲染层纯函数：估计与真实用量分区 ============ */
function runRendererTests() {
  const E = loadRendererModule()
  check('F1: 模块导出可用', typeof E.create === 'function' && typeof E.computeCost === 'function' && typeof E.estimateCallCost === 'function')

  const noPrice = E.computeCost({ kind: 'chat', usage: { prompt: 1000, completion: 500 }, price: {} })
  check('F2: 未填报价 → 未知（reason=no-price，金额 null）', noPrice.known === false && noPrice.amount === null && noPrice.reason === 'no-price', noPrice)
  check('F3: 只填输入价仍视为未知（文本需两侧齐全）', E.priceKnownFor('chat', { inputPerMTok: 1 }) === false && E.priceKnownFor('chat', { inputPerMTok: 1, outputPerMTok: 2 }) === true)
  check('F4: 图像报价只认按张单价', E.priceKnownFor('image', { inputPerMTok: 1, outputPerMTok: 2 }) === false && E.priceKnownFor('image', { imagePerUnit: 0.04 }) === true)
  const priced = E.computeCost({ kind: 'chat', usage: { prompt: 1_000_000, completion: 250_000 }, price: { currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8 } })
  check('F5: 真实用量 + 自填报价 → 精确金额', priced.known === true && priced.amount === 4 && priced.currency === 'CNY' && priced.reason === 'computed', priced)
  const noUsage = E.computeCost({ kind: 'chat', usage: {}, price: { inputPerMTok: 1, outputPerMTok: 1 } })
  check('F6: 无用量 → 未知（reason=no-usage）', noUsage.known === false && noUsage.reason === 'no-usage', noUsage)
  const incomplete = E.computeCost({ kind: 'chat', usage: { prompt: 100 }, price: { inputPerMTok: 1, outputPerMTok: 1 } })
  check('F7: 用量残缺 → 未知（reason=usage-incomplete）', incomplete.known === false && incomplete.reason === 'usage-incomplete', incomplete)
  const service = E.computeCost({ kind: 'chat', usage: { prompt: 10, completion: 10 }, price: {}, serviceCost: 0.0123 })
  check('F8: 服务端返回金额优先并标注 service-cost', service.known === true && service.amount === 0.0123 && service.reason === 'service-cost', service)
  const img = E.computeCost({ kind: 'image', images: 4, price: { currency: 'USD', imagePerUnit: 0.04 } })
  check('F9: 图像按张计价', img.known === true && img.amount === 0.16 && img.currency === 'USD', img)
  const imgNoCount = E.computeCost({ kind: 'image', images: null, price: { imagePerUnit: 0.04 } })
  check('F10: 图片数量未知 → 未知（不按 0 张）', imgNoCount.known === false && imgNoCount.reason === 'no-image-count', imgNoCount)
  check('F11: 负数报价按未知处理（不产生负费用）', E.computeCost({ kind: 'chat', usage: { prompt: 1000, completion: 1000 }, price: { inputPerMTok: -1, outputPerMTok: 2 } }).known === false)

  const manual = E.estimateCallCost({ kind: 'chat', price: { currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8 }, promptTokens: 1_000_000, completionTokens: 250_000 })
  check('F12: 手填 token 的估计标注 basis=manual', manual.known === true && manual.amount === 4 && manual.basis === 'manual', manual)
  const avg = E.estimateCallCost({ kind: 'chat', price: { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 }, average: { prompt: 1000, completion: 500, samples: 3 } })
  check('F13: 无手填时用真实返回的平均用量并标注样本数', avg.known === true && avg.basis === 'real-average' && avg.samples === 3 && avg.amount === 0.0015, avg)
  const none = E.estimateCallCost({ kind: 'chat', price: { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 } })
  check('F14: 既无手填也无真实样本 → 未知（不编造估计）', none.known === false && none.basis === 'none' && none.amount === null, none)
  const avgNoPrice = E.estimateCallCost({ kind: 'chat', price: {}, average: { prompt: 1000, completion: 500, samples: 2 } })
  check('F15: 有真实用量但无报价 → 未知（reason=no-price）', avgNoPrice.known === false && avgNoPrice.reason === 'no-price', avgNoPrice)
  check('F16: 手填优先于平均值（口径不混用）', E.estimateCallCost({ kind: 'chat', price: { inputPerMTok: 1, outputPerMTok: 1 }, promptTokens: 100, completionTokens: 100, average: { prompt: 999999, completion: 999999, samples: 5 } }).basis === 'manual')

  const rows = [
    { kind: 'chat', tokens: { present: true, prompt: 100, completion: 50 } },
    { kind: 'chat', tokens: { present: false, prompt: null, completion: null } },
    { kind: 'chat', tokens: { present: true, prompt: 200 } },
    { kind: 'image', tokens: { present: true, prompt: 10, completion: 5 } }
  ]
  const a = E.averageUsage(rows, 'chat')
  check('F17: 平均只取「端点确实返回且两侧齐全」的条目', a && a.prompt === 100 && a.completion === 50 && a.samples === 1, a)
  check('F18: 样本为 0 → null（不猜平均值）', E.averageUsage([{ kind: 'chat', tokens: { present: false } }], 'chat') === null && E.averageUsage([], 'chat') === null)

  const comic = E.estimateComicCost({ pages: 4, price: { currency: 'USD', imagePerUnit: 0.04 } })
  check('F19: 漫画页数估计 = 页数 × 单张报价', comic.known === true && comic.amount === 0.16 && comic.pages === 4, comic)
  const comicUnknown = E.estimateComicCost({ pages: null, price: { imagePerUnit: 0.04 } })
  check('F20: 页数未知 → 未知（不假设页数）', comicUnknown.known === false && comicUnknown.amount === null, comicUnknown)
  const comicNoPrice = E.estimateComicCost({ pages: 4, price: {} })
  check('F21: 未填图像报价 → 未知', comicNoPrice.known === false && comicNoPrice.reason === 'no-price', comicNoPrice)
  check('F22: 页数来源可标注（漫画面板偏好 / 回合数）',
    E.comicPagesFromPrefs({ mode: 'ai', pageCount: 3 }, 7).source === 'pref' &&
    E.comicPagesFromPrefs({ mode: 'every' }, 7).pages === 7 &&
    E.comicPagesFromPrefs({ mode: 'every' }, null).pages === null)

  /* ============ G. 诊断入参白名单：密钥 / 端点 / 模型名 / 自由文本不进 payload ============ */
  const flags = E.configFlags({ apiKey: 'sk-live-abcdef', illustApiKey: 'sk-img', baseUrl: 'https://api.example.com', model: 'my-custom-model', illustPreset: 'off', palette: 'contrast' })
  const flagsJson = JSON.stringify(flags)
  check('G1: 配置标志只有布尔值', Object.values(flags).every((v) => typeof v === 'boolean'), flags)
  check('G2: 配置标志不含密钥 / 端点 / 模型名', !/sk-|https?:|my-custom-model/.test(flagsJson), flagsJson)
  check('G3: hasTextKey / hasIllustKey 只表示「是否已填」', flags.hasTextKey === true && flags.hasIllustKey === true)
  check('G4: 未配置图像模型时 illustEnabled=false', E.configFlags({ illustPreset: 'off', illustModel: '' }).illustEnabled === false && E.configFlags({ illustPreset: 'custom', illustModel: 'gpt-image-1' }).illustEnabled === true)

  const payload = E.buildDiagnosticsInput({
    extended: true,
    config: { hasTextKey: true, secret: 'sk-live', baseUrl: 'https://x' },
    usage: { entries: 1 },
    apiKey: 'sk-live-abcdef',
    model: 'my-custom-model',
    text: '正文'.repeat(300),
    content: 'x'.repeat(500)
  })
  const payloadJson = JSON.stringify(payload)
  check('G5: 诊断入参只保留白名单字段', Object.keys(payload).sort().join(',') === 'config,extended,usage', Object.keys(payload))
  check('G6: 白名单外的 config 键被丢弃', Object.keys(payload.config).sort().join(',') === 'hasTextKey', payload.config)
  check('G7: 密钥 / 模型名 / 正文 / 自由文本一律不进 payload', !/sk-|my-custom-model|正文|https?:/.test(payloadJson), payloadJson.slice(0, 200))

  /* 阶段推导：只回枚举，绝不回配置原文 / 密钥 */
  const D = E.deriveStage
  check('G8: 文本三要素不全 → first-run', D({}) === 'first-run' && D({ baseUrl: 'https://x', apiKey: 'sk-a' }) === 'first-run' &&
    D({ baseUrl: 'https://x', model: 'm' }) === 'first-run')
  check('G9: 文本就绪且插图未启用 → text-ready', D({ baseUrl: 'https://x', apiKey: 'sk-a', model: 'm' }) === 'text-ready' &&
    D({ baseUrl: 'https://x', apiKey: 'sk-a', model: 'm', illustPreset: 'off' }) === 'text-ready')
  check('G10: 文本就绪且插图就绪 → illust-ready',
    D({ baseUrl: 'https://x', apiKey: 'sk-a', model: 'm', illustBaseUrl: 'https://y', illustApiKey: 'sk-b', illustModel: 'img' }) === 'illust-ready' &&
    D({ baseUrl: 'https://x', apiKey: 'sk-a', model: 'm', illustPreset: 'custom', illustEnabled: true }) === 'illust-ready')
  check('G11: 阶段只回三个枚举之一，绝不回配置原文 / 密钥',
    [D({}), D({ baseUrl: 'https://x', apiKey: 'sk-live', model: 'gpt-4o' }), D({ apiKey: 'sk-live' })]
      .every((stage) => E.STAGES.includes(stage)) &&
    E.STAGES.join(',') === 'first-run,text-ready,illust-ready')

  /* ============ H. 未接入 IPC 时的诚实降级（不伪造统计） ============ */
  const bare = E.create({ api: {}, toast: () => {}, cfg: () => ({}) })
  check('H1: 未接入通道时诊断明确报「未接入」', true)
  return Promise.resolve()
    .then(() => bare.buildDiagnostics(false))
    .then((r) => {
      check('H1: 未接入通道时诊断明确报「未接入」（不伪造报告）', r.ok === false && /未接入/.test(r.error), r)
      return bare.storageStats()
    })
    .then((stats) => {
      check('H2: 未接入存储统计时返回 null（不返回 0 冒充）', stats === null, stats)
      return bare.noteError('timeout')
    })
    .then((r) => {
      check('H3: 未接入错误上报时返回未接入', r.ok === false && /未接入/.test(r.error), r)
      return bare.summarize()
    })
    .then((s) => {
      check('H4: 账本未就绪时汇总为 null（界面显示「尚未就绪」）', s === null, s)
      /* 接入通道后：payload 必须仍无密钥，且失败被如实回传 */
      let seen = null
      const wired = E.create({
        api: {
          experienceReport: async (p) => { seen = p; return { ok: true, report: { schema: 'x' }, text: '{"schema":"x"}' } },
          experienceDiagnosticsInfo: async () => ({ ok: true, version: '1.5.3', stage: 'text-ready', storage: { available: true, sessions: 2 } }),
          experienceRecordError: async () => ({ ok: true, code: 'timeout' })
        },
        toast: () => {},
        cfg: () => ({ apiKey: 'sk-live-abcdef', baseUrl: 'https://api.example.com', model: 'my-custom-model' })
      })
      return wired.buildDiagnostics(false).then((r) => {
        check('H5: 接入通道后报告生成成功', r.ok === true && r.text === '{"schema":"x"}', r)
        check('H6: 递给主进程的 payload 不含密钥 / 端点 / 模型名', seen && !/sk-|example\.com|my-custom-model/.test(JSON.stringify(seen)), seen && JSON.stringify(seen).slice(0, 240))
        check('H7: 只提交布尔配置标志', seen && Object.values(seen.config).every((v) => typeof v === 'boolean'))
        return wired.noteError('ECONNRESET')
      }).then((r) => {
        check('H8: 错误上报走通道且只传短码', r.ok === true && r.code === 'timeout', r)
        /* 阶段随 info 提交：只发枚举，不发配置原文 / 密钥（正式 main 传 stage:(p)=>p&&p.stage） */
        let infoArg = null
        const staged = E.create({
          api: {
            experienceReport: async () => ({ ok: true, report: { schema: 'x' }, text: '{}' }),
            experienceDiagnosticsInfo: async (p) => { infoArg = p; return { ok: true, version: '1.5.3', stage: p && p.stage, storage: { available: true } } },
            experienceStorage: async () => ({ ok: true, stats: { available: true } })
          },
          toast: () => {},
          cfg: () => ({ baseUrl: 'https://api.example.com', apiKey: 'sk-live-abcdef', model: 'my-custom-model', illustPreset: 'off' })
        })
        return staged.buildDiagnostics(false).then((res) => {
          check('H9: 阶段以 {stage} 枚举随 info 提交（文本就绪 / 插图未启用 → text-ready）', infoArg && infoArg.stage === 'text-ready', infoArg)
          check('H10: info 入参只有 stage，不含密钥 / 端点 / 模型名', infoArg && Object.keys(infoArg).join(',') === 'stage' &&
            !/sk-|example\.com|my-custom-model/.test(JSON.stringify(infoArg)), infoArg)
          return res
        })
      })
    })
    .then(async () => {
      /* ============ J. 与 RuntimeTools 的账本复用 + 订阅契约（纯模块，不启 Electron） ============ */
      {
        const E = loadRendererModule()
        const shared = ledger.createLedger({ idPrefix: 'SHARED' })
        const hh = shared.start({ kind: 'chat', model: 'm' })
        shared.finish(hh, { ok: true, usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } })
        let runtimeReadyCalls = 0
        const subCbs = []
        const runtime = {
          ready: async () => { runtimeReadyCalls++; return shared },
          ledger: () => shared,
          summarize: () => shared.summarize(),
          tasks: () => shared.tasks(),
          entries: () => shared.entries(),
          prices: () => shared.listPrices(),
          priceFor: (k) => shared.getPrice(k),
          setPrice: async (k, p) => { shared.setPrice(k, p); return { ok: true, persisted: false } },
          removePrice: async (k) => { shared.removePrice(k); return { ok: true, persisted: false } },
          subscribe: (cb) => { subCbs.push(cb); return () => { const i = subCbs.indexOf(cb); if (i >= 0) subCbs.splice(i, 1) } },
          persistence: () => ({ ok: false, error: 'disk-full' })
        }
        const exp = E.create({ api: {}, toast: () => {}, cfg: () => ({}), runtime })
        await exp.ready()
        check('J1: 注入 runtime 时 await runtime.ready() 再取账本', runtimeReadyCalls >= 1, runtimeReadyCalls)
        check('J2: 复用 runtime 的同一账本，不另建独立账本', exp.ledger() === shared)
        check('J3: summarize 取自 runtime（同一账目，未分叉）', !!exp.summarize() && exp.summarize().calls.total === 1, exp.summarize())
        const sp = await exp.setPrice('m', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 2 })
        check('J4: setPrice 委托 runtime 并透传 persisted=false（调用方据此不谎报已保存）', sp.ok === true && sp.persisted === false, sp)
        const rp = await exp.removePrice('m')
        check('J5: removePrice 委托 runtime（await 回执，返回 {ok,persisted}）', rp.ok === true && rp.persisted === false, rp)
        check('J6: persistenceWarning 暴露「本地未保存」', /未保存/.test(String(exp.persistenceWarning())), exp.persistenceWarning())

        /* 源码契约：订阅回调确实交给 runtime.subscribe；关闭/断开退订；persisted 判定；shell 分支退订 */
        const src = fs.readFileSync(path.join(root, 'ui', 'shared', 'experience-tools.js'), 'utf8')
        check('J7: 把刷新回调交给 runtime.subscribe(cb)（此前回调被忽略）', /const off = sub\(\(\) => \{ refreshLive\(\) \}\)/.test(src))
        check('J8: 面板关闭与断开都退订（不累积、不重开已关面板）',
          /releaseSubscription\(\)/.test(src) && /if \(!viewConnected\(\)\) \{ releaseSubscription\(\); return \}/.test(src))
        check('J9: 报价保存按 persisted 判定，本地未保存时保留草稿且不谎报已保存',
          /r\.persisted !== false/.test(src) && /本地记账未保存/.test(src) && /priceDraft = \{ model: key/.test(src))
        check('J10: ProductTools shell 分支关闭时退订（最小兼容修复，不改 product-tools.js）', /__experienceWrapped/.test(src))
        check('J11: 已订阅则不重复订阅（面板重开不叠加监听）', /if \(unsubscribe \|\| !runtime \|\| typeof runtime\.ready !== 'function'\) return/.test(src))
        check('J12: 实时刷新不抢焦点（refresh 模式跳过焦点迁移，重绘不丢输入/焦点）',
          /if \(!refresh && \(!existing/.test(src) && /show\(tab, \{ refresh: true \}\)/.test(src))
      }

      /* ============ I. 源码契约 ============ */
      const src = fs.readFileSync(path.join(root, 'ui', 'shared', 'experience-tools.js'), 'utf8')
      check('I1: 渲染层不把 apiKey / baseUrl 值写进诊断 payload', /buildDiagnosticsInput/.test(src) && !/apiKey:\s*(cfg\(\)|c\.)\.apiKey/.test(src))
      check('I2: 面板复用 product-* 结构与现有语义变量（不新增硬编码配色）', src.includes('product-mask') && src.includes('product-panel') && src.includes('var(--text-dim)'))
      check('I3: 不引用不存在的 estimatePlan（估计由本模块实现）', !/estimatePlan/.test(src))
      check('I4: 提供 window.ExperienceTools.create(ctx) 挂载入口', /window\.ExperienceTools = ExperienceToolsApi/.test(src) && /function create\(ctx\)/.test(src))
      check('I5: 默认不自动挂载（由父统一入口决定）', /options\.autoMount === true/.test(src))
      check('I6: 诊断导出走 IPC 或既有 saveFile，不自建下载', /experienceDiagnosticsSave/.test(src) && /api\.saveFile/.test(src))

      console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED') + ' · pass=' + pass + ' fail=' + fail)
      process.exitCode = fail === 0 ? 0 : 1
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}

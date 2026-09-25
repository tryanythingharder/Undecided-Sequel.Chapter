/* ======== 六面世界 · 运行时工具（共享入口：用量账本面板 + 报价 + 诊断导出）（三方案共享） ========
 * 依赖：engine/usage-ledger.js（纯账本模块）。三套 index.html 已在 product-tools 之前显式
 * <script src="../../engine/usage-ledger.js">，渲染层经 window.UsageLedger 使用；本模块仍保留
 * 自动注入兜底（缺失时按脚本 src 推导候选路径补 <script>，CSP 为 default-src 'self'，同源文件允许）。
 *
 * 记账归属（唯一真源＝主进程；渲染层只读快照 + 提交报价，绝不回写全量账目）：
 *  - 每个真实 network attempt 由 main.cjs 的 runtimeAttempt() 记一笔，完成即落盘并广播快照；
 *  - 本模块不包装 / 不截获 sendChat 与 generateImage，不提供 startCall/finishCall/recordCall 的
 *    真实接线入口，也不把渲染层账本整体推送覆盖主进程（生产环境不存在 runtimeLedgerSave 写入口）；
 *  - 报价与诊断走 IPC：runtimePriceSet / runtimePriceRemove / runtimeDiagnosticsInfo / runtimeDiagnosticsSave。
 *
 * preload 暴露面（preload.cjs；缺失时本模块退回纯内存账本降级模式）：
 *   runtimeLedgerLoad()            -> { ok, data, summary, tasks, revision, persistence }
 *   runtimePriceSet({model,price}) -> 同一快照形状（主进程落盘后回执）
 *   runtimePriceRemove({model})    -> 同一快照形状
 *   onRuntimeLedgerChanged(cb)     -> 返回取消订阅函数（快照按 revision 单调递增）
 *   runtimeDiagnosticsInfo() / runtimeDiagnosticsSave(payload)
 *  snapshot.data 为 ledger.toJSON()（不含 running）；实时进行中状态取自 snapshot.summary.tasks 与
 *  snapshot.tasks（ledger.tasks() 形状，running 任务在其中）。persistence.ok=false 表示本次落盘失败，
 *  UI 必须显示「本地记账未保存」警告（不影响故事生成）。
 *
 * 语义（与 engine/usage-ledger.js 一致，UI 只做如实呈现）：
 *  - 端点未返回 usage → 显示「未返回」，不显示 0；
 *  - 未填写报价 → 费用显示「未知（未填写报价）」；
 *  - 失败 / 中止 / 部分返回 → 费用标「可能仍计费，以账单为准」；
 *  - 服务端直接返回 cost 时优先采用并标注来源。
 *
 * 挂载（app.js 单一入口）：
 *   const RuntimeTools = window.RuntimeTools.create({ api, cfg: () => cfg, toast, options: { autoMount: false } })
 *   const ExperienceTools = window.ExperienceTools.create({ api, shell: ProductTools, toast, cfg: () => cfg, runtime: RuntimeTools })
 * 不再新增冗余入口按钮（体验工具入口已可达真实用量 / 任务 / 报价）。
 *
 * 降级（无 IPC / 单测环境）：退回本模块自建内存账本 + localStorage（sixworlds.usage-ledger.v1）回显；
 * 无 runtimeDiagnosticsSave → 现有 api.saveFile（dialog:saveFile）；两者都无 → 明确报错，不静默丢数据。
 */
(function () {
  'use strict'

  const LEDGER_LOCAL_KEY = 'sixworlds.usage-ledger.v1'
  const CSS_HREF_FALLBACK = '../shared/runtime-tools.css'
  const scriptSrc = (() => {
    try { return (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '' } catch { return '' }
  })()
  const siblingHref = (file) => (scriptSrc ? scriptSrc.replace(/runtime-tools\.js.*$/, file) : '')

  /* 账本模块（engine/usage-ledger.js）与共享目录不同级，路径按「本文件绝对 URL」推导，
   * 再退回按文档相对路径的候选表；三套界面（classic / proto / d）层级一致，均可用。 */
  const ledgerCandidates = (() => {
    const list = []
    if (scriptSrc) list.push(scriptSrc.replace(/ui\/shared\/runtime-tools\.js.*$/, 'engine/usage-ledger.js'))
    list.push('../../engine/usage-ledger.js', '../engine/usage-ledger.js', './usage-ledger.js')
    return [...new Set(list)]
  })()

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  /* ---- 资源注入（只在浏览器环境执行） ---- */
  function ensureStyle() {
    if (typeof document === 'undefined' || !document.head) return
    try {
      if (document.querySelector('link[data-runtime-tools]')) return
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.setAttribute('data-runtime-tools', '1')
      link.href = siblingHref('runtime-tools.css') || CSS_HREF_FALLBACK
      document.head.appendChild(link)
    } catch { /* noop */ }
  }

  function ensureLedgerGlobal() {
    if (typeof window === 'undefined') return Promise.resolve(null)
    if (window.UsageLedger) return Promise.resolve(window.UsageLedger)
    if (typeof document === 'undefined' || !document.head) return Promise.resolve(null)
    // 依次尝试候选路径（脚本 src 推导 → 相对文档的常见层级），全部失败即明确放弃
    return ledgerCandidates.reduce((chain, href) => chain.then((mod) => {
      if (mod || window.UsageLedger) return mod || window.UsageLedger
      return new Promise((resolve) => {
        try {
          const script = document.createElement('script')
          script.src = href
          script.onload = () => resolve(window.UsageLedger || null)
          script.onerror = () => resolve(null)
          document.head.appendChild(script)
          setTimeout(() => resolve(window.UsageLedger || null), 3000)
        } catch { resolve(null) }
      })
    }), Promise.resolve(null))
  }

  /* ---- 展示格式化：未知一律是「未知」，不是 0 ---- */
  const num = (v) => (v === null || v === undefined ? '未知' : Number(v).toLocaleString('zh-CN'))
  function money(amount, currency) {
    if (amount === null || amount === undefined) return '未知'
    const unit = currency ? ' ' + currency : ''
    return Number(amount).toFixed(4) + unit
  }
  function statusLabel(status) {
    return ({ running: '进行中', succeeded: '完成', failed: '失败', partial: '部分返回', aborted: '已中止' })[status] || String(status || '未知')
  }
  function costText(cost) {
    if (!cost) return '未知'
    if (!cost.known) {
      const why = cost.reason === 'no-price' ? '未填写报价' : cost.reason === 'no-usage' ? '端点未返回用量' : cost.reason === 'usage-incomplete' ? '用量不完整' : cost.reason === 'no-image-count' ? '未返回图片数量' : cost.reason === 'invalid-amount' ? '金额超出可计算范围' : '信息不足'
      return '未知（' + why + '）'
    }
    return money(cost.amount, cost.currency) + (cost.provisional ? ' · 可能仍计费（以账单为准）' : cost.reason === 'service-cost' ? ' · 服务端返回' : '')
  }

  function create(ctx) {
    const c = ctx || {}
    const api = c.api || (typeof window !== 'undefined' ? window.api : null) || {}
    const toast = typeof c.toast === 'function' ? c.toast : () => {}
    const cfg = typeof c.cfg === 'function' ? c.cfg : () => ({})
    const options = c.options || {}
    let ledger = options.ledger || null
    let ledgerMod = (typeof window !== 'undefined' && window.UsageLedger) || (options.ledgerModule || null)
    let ledgerReady = null
    let view = null
    let saveTimer = null
    let tab = 'usage'
    /* 主进程权威模式：可用 runtimeLedgerLoad + onRuntimeLedgerChanged 时，账本唯一真源在主进程，
     * 渲染层只保存镜像（ledger 为本地镜像实例），并丢弃 revision 更旧的乱序快照。 */
    const authoritative = typeof api.runtimeLedgerLoad === 'function' && typeof api.onRuntimeLedgerChanged === 'function'
    let revision = -1
    let unsubscribe = null
    let persistence = { ok: true }
    /* 权威模式下运行中任务与汇总来自同一快照（data 不含 running，不能只靠 ledger 镜像） */
    let snapshotTasks = null
    let snapshotSummary = null
    /* 订阅者集合（ExperienceTools 等）：应用快照后统一通知；退订即从集合移除 */
    const listeners = new Set()
    let initPromise = null
    let restoreResult = null

    function getLedger() { return ledger }
    /* ensureLedger：只保证账本模块 / 实例就绪（不含首次 restore） */
    function ensureLedger() {
      if (ledger) return Promise.resolve(ledger)
      if (!ledgerReady) {
        ledgerReady = ensureLedgerGlobal().then((mod) => {
          if (mod) ledgerMod = mod
          if (!ledger && mod && typeof mod.createLedger === 'function') ledger = mod.createLedger()
          return ledger
        })
      }
      return ledgerReady
    }
    /* 账本模块引用：优先已解析的模块对象，其次 window.UsageLedger（无 DOM 环境也能用） */
    function moduleRef() { return ledgerMod || (typeof window !== 'undefined' && window.UsageLedger) || null }

    /* ---- 权威快照：校验形状 → 按 revision 去重 → 镜像 data → 记录 summary/tasks/persistence ---- */
    function isSnapshot(value) {
      return !!value && typeof value === 'object' && value.data && typeof value.data === 'object'
    }
    /* 应用一份主进程快照；返回是否真的应用（revision 更旧的乱序快照一律丢弃） */
    function applySnapshot(snapshot) {
      if (!isSnapshot(snapshot)) return false
      const rev = Number(snapshot.revision)
      if (Number.isFinite(rev)) {
        if (rev < revision) return false // 乱序旧快照：丢弃，绝不覆盖更新的账
        revision = rev
      }
      /* data/summary/tasks 同源：都取自这一份快照，避免新账目配旧汇总 */
      if (ledger && typeof ledger.load === 'function') ledger.load(snapshot.data)
      snapshotSummary = snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : null
      snapshotTasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : null
      persistence = snapshot.persistence && typeof snapshot.persistence === 'object'
        ? { ok: snapshot.persistence.ok !== false, error: snapshot.persistence.error }
        : { ok: true }
      if (view) render()
      notifyListeners()
      return true
    }
    /* 通知所有订阅者（逐个隔离异常，订阅者出错不影响记账与其它订阅者） */
    function notifyListeners() {
      if (!listeners.size) return
      const payload = {
        revision,
        summary: snapshotSummary,
        tasks: snapshotTasks,
        persistence: { ok: persistence.ok !== false, error: persistence.error }
      }
      for (const cb of [...listeners]) { try { cb(payload) } catch { /* 订阅者异常不影响记账 */ } }
    }
    /* 建立主进程 IPC 订阅（幂等）：只在权威模式下；收到快照即镜像并通知订阅者 */
    function ensureIpcSubscription() {
      if (!authoritative || unsubscribe || typeof api.onRuntimeLedgerChanged !== 'function') return
      try { unsubscribe = api.onRuntimeLedgerChanged((snapshot) => { applySnapshot(snapshot) }) } catch { unsubscribe = null }
    }
    /* 公共订阅契约：subscribe(cb) 注册变更监听并返回退订函数（无 cb 时仅确保 IPC 订阅就绪）。
     * 订阅者收到的 payload 与主进程快照同源（revision / summary / tasks / persistence）。
     * 退订语义：最后一个订阅者退出且本模块面板未打开时，一并释放主进程 IPC 订阅（真正退订，
     * 不留常驻监听）；再次订阅会自动重建订阅并补一次快照，保证镜像不落后。 */
    function subscribe(callback) {
      const cb = typeof callback === 'function' ? callback : null
      if (cb) listeners.add(cb)
      const hadIpc = !!unsubscribe
      ensureIpcSubscription()
      /* 曾释放过 IPC 订阅（面板重开 / 重新订阅）：补一次快照，避免空闲期镜像落后 */
      if (authoritative && cb && !hadIpc && restoreResult) void performRestore()
      let done = false
      return function unsubscribeListener() {
        if (done) return
        done = true
        if (!cb) return
        listeners.delete(cb)
        if (!listeners.size && !view) releaseSubscription()
      }
    }
    /* 释放主进程 IPC 订阅（最后一个订阅者退出 / 面板关闭 / 实例弃用时）：
     * 只停渲染层监听，不影响主进程记账与落盘。 */
    function releaseSubscription() {
      if (!unsubscribe) return
      try { unsubscribe() } catch { /* noop */ }
      unsubscribe = null
    }

    /* ---- 持久化：权威模式绝不回写渲染层全量；降级模式走 localStorage ---- */
    function scheduleSave() {
      if (authoritative) return // 主进程是唯一写入方，渲染层不再调度全量落盘
      if (typeof setTimeout !== 'function') return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { saveTimer = null; void persist() }, 800)
    }
    async function persist() {
      const data = ledger && ledger.toJSON()
      if (!data) return { ok: false, error: 'no-ledger' }
      /* 权威模式：生产不存在 runtimeLedgerSave 写入口，渲染层不得推送全量快照覆盖主进程 */
      if (authoritative) return { ok: true, skipped: 'authoritative' }
      try {
        if (typeof api.runtimeLedgerSave === 'function') return await api.runtimeLedgerSave(data)
      } catch { /* 回退 localStorage */ }
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem(LEDGER_LOCAL_KEY, JSON.stringify(data))
          return { ok: true, storage: 'local' }
        }
        return { ok: false, error: 'storage-unavailable' }
      } catch { return { ok: false, error: 'storage-unavailable' } }
    }
    /* performRestore：权威模式读一次主进程快照（并建立订阅）；降级模式读 localStorage 回显。
     * ledger.load 只影响本地镜像，绝不写回主进程。 */
    async function performRestore() {
      if (!ledger) { restoreResult = { ok: false, error: 'ledger-unavailable' }; return restoreResult }
      if (authoritative) {
        let snapshot = null
        try { snapshot = await api.runtimeLedgerLoad() } catch { snapshot = null }
        if (isSnapshot(snapshot)) {
          applySnapshot(snapshot)
          ensureIpcSubscription()
          restoreResult = { ok: true, restored: true, revision }
          return restoreResult
        }
        /* 主进程通道异常：明确降级为纯模块（不谎报已恢复） */
        persistence = { ok: false, error: 'ledger-load-failed' }
        restoreResult = { ok: false, error: 'ledger-load-failed' }
        return restoreResult
      }
      let data = null
      try {
        if (typeof api.runtimeLedgerLoad === 'function') {
          const r = await api.runtimeLedgerLoad()
          if (r && r.ok && r.data) data = r.data
        }
      } catch { /* 回退 localStorage */ }
      if (!data) {
        try { if (typeof localStorage !== 'undefined') data = JSON.parse(localStorage.getItem(LEDGER_LOCAL_KEY) || 'null') } catch { data = null }
      }
      if (!data) { restoreResult = { ok: true, restored: false }; return restoreResult }
      const r = ledger.load(data)
      restoreResult = Object.assign({ restored: r.ok }, r)
      return restoreResult
    }
    /* ready：账本就绪 + 完成一次 restore（拿到首个快照）后才 resolve。
     * 这样调用方 await ready() 后 summarize()/tasks() 已有数据，不会出现「已就绪但汇总为空」的竞态；
     * 首次 restore 也只会发生一次，避免后续异步加载覆盖新账。 */
    function ready() {
      if (!initPromise) initPromise = ensureLedger().then(() => performRestore()).then(() => ledger)
      return initPromise
    }
    /* restore：幂等返回首次 restore 的结果（ready 已内含），不重复拉取覆盖新账 */
    async function restore() {
      await ready()
      return restoreResult || { ok: true, restored: false }
    }

    /* ---- 对外调用面：权威模式下渲染层不记账，startCall/finishCall/recordCall 只读不写 ----
     * 保留同名接口仅为兼容既有调用方与单测；权威模式下明确返回 not-authoritative，
     * 提示调用方记账归属在主进程，避免出现「两边同时记」的双记账。 */
    function readOnlyInAuthoritative() {
      return authoritative ? { ok: false, error: 'not-authoritative', reason: '主进程是唯一记账方（runtimeAttempt）' } : null
    }
    async function startCall(input) {
      const blocked = readOnlyInAuthoritative(); if (blocked) return blocked
      await ready()
      if (!ledger) return { ok: false, error: 'ledger-unavailable' }
      const handle = ledger.start(input)
      scheduleSave()
      if (view) render()
      return { ok: true, handle }
    }
    async function finishCall(handleOrId, result) {
      const blocked = readOnlyInAuthoritative(); if (blocked) return blocked
      await ready()
      if (!ledger) return { ok: false, error: 'ledger-unavailable' }
      const r = ledger.finish(handleOrId, result)
      if (r.ok) scheduleSave()
      if (view) render()
      return r
    }
    async function recordCall(input) {
      const blocked = readOnlyInAuthoritative(); if (blocked) return blocked
      await ready()
      if (!ledger) return { ok: false, error: 'ledger-unavailable' }
      const r = ledger.record(input)
      if (r.ok) scheduleSave()
      if (view) render()
      return r
    }
    /* 报价：权威模式走 IPC，await 回执后再应用返回快照（失败绝不谎报成功）。
     * 回执 ok 但主进程落盘失败（persistence.ok=false）时，persisted=false——
     * 调用方必须据此提示「仅内存、本地未保存」，不得提示「已保存」。 */
    async function setPrice(modelKey, price) {
      await ready()
      if (!ledger) return { ok: false, error: 'ledger-unavailable' }
      if (authoritative) {
        if (typeof api.runtimePriceSet !== 'function') return { ok: false, error: 'price-channel-unavailable' }
        try {
          const snapshot = await api.runtimePriceSet({ model: modelKey, price })
          if (isSnapshot(snapshot)) { applySnapshot(snapshot); if (view) render(true); return { ok: true, revision, persisted: persistence.ok !== false } }
          return { ok: false, error: (snapshot && snapshot.error) || 'price-set-failed' }
        } catch (error) { return { ok: false, error: String((error && error.message) || error) } }
      }
      const r = ledger.setPrice(modelKey, price)
      if (r.ok) { scheduleSave(); if (view) render(true) }
      return r
    }
    async function removePrice(modelKey) {
      await ready()
      if (!ledger) return { ok: false, error: 'ledger-unavailable' }
      if (authoritative) {
        if (typeof api.runtimePriceRemove !== 'function') return { ok: false, error: 'price-channel-unavailable' }
        try {
          const snapshot = await api.runtimePriceRemove({ model: modelKey })
          if (isSnapshot(snapshot)) { applySnapshot(snapshot); if (view) render(true); return { ok: true, revision, persisted: persistence.ok !== false } }
          return { ok: false, error: (snapshot && snapshot.error) || 'price-remove-failed' }
        } catch (error) { return { ok: false, error: String((error && error.message) || error) } }
      }
      if (typeof ledger.removePrice !== 'function') return { ok: false, error: 'ledger-unavailable' }
      const r = ledger.removePrice(modelKey)
      scheduleSave()
      if (view) render(true)
      return r
    }
    /* summarize/tasks 来源同一快照：权威模式优先用快照值（含 running），降级模式用本地镜像 */
    function summarize() {
      if (authoritative) {
        if (snapshotSummary) return snapshotSummary
        return ledger ? ledger.summarize() : null
      }
      return ledger ? ledger.summarize() : null
    }
    function tasks() {
      if (authoritative && snapshotTasks) return snapshotTasks
      return ledger ? ledger.tasks() : []
    }
    function entries() {
      return ledger ? ledger.entries() : []
    }
    function listPrices() { return ledger && typeof ledger.listPrices === 'function' ? ledger.listPrices() : [] }
    function getPrice(modelKey) { return ledger && typeof ledger.getPrice === 'function' ? ledger.getPrice(modelKey) : null }
    function priceKnownFor(modelKey, kind) {
      if (!ledger) return false
      const mod = moduleRef()
      if (mod && typeof mod.priceKnownFor === 'function') return mod.priceKnownFor(kind, ledger.getPrice(modelKey))
      return !!ledger.getPrice(modelKey)
    }
    /* 权威模式：主进程持久化失败（persistence.ok=false）必须显式暴露，UI 显示警告 */
    function persistenceState() { return { ok: persistence.ok !== false, error: persistence.error } }

    /* ---- 生成前估算（页数 / 请求数 / 费用）----
     * 只做算术：调用次数、每页张数、每次 token 由调用方（用户）给出，报价取已保存的自填报价。
     * 缺项一律保持「未知」，不按经验值编造；不联网、不发起任何模型请求。 */
    function estimate(input) {
      const mod = moduleRef()
      if (!mod || typeof mod.estimatePlan !== 'function') return { ok: false, error: 'ledger-unavailable' }
      const i = input || {}
      const model = String(i.model || '').trim()
      const price = i.price || (model ? getPrice(model) : null)
      return mod.estimatePlan(Object.assign({}, i, { price }))
    }

    /* ---- 诊断导出：只白名单版本 / 平台 / 布尔配置 / 统计；导出前自检 ---- */
    async function collectDiagnosticsInfo() {
      let info = null
      try { if (typeof api.runtimeDiagnosticsInfo === 'function') { const r = await api.runtimeDiagnosticsInfo(); if (r && r.ok) info = r } } catch { /* 无则留空 */ }
      const conf = cfg() || {}
      const config = info && info.config && typeof info.config === 'object' ? info.config : {
        hasTextKey: !!conf.apiKey,
        hasIllustKey: !!conf.illustApiKey,
        illustEnabled: conf.illustPreset !== 'off' && !!(conf.illustModel || conf.illustBaseUrl),
        autoIllust: !!conf.illustAuto,
        skipSplash: !!conf.skipSplash,
        thinkingEnabled: !!conf.thinkLevel && conf.thinkLevel !== 'default',
        customEndpoint: conf.preset === 'custom',
        reducedMotion: conf.reducedMotion === true,
        highContrast: conf.palette === 'contrast'
      }
      return {
        version: info && info.version ? info.version : null,
        platform: info && info.platform ? info.platform : null,
        arch: info && info.arch ? info.arch : null,
        config
      }
    }
    async function buildDiagnostics() {
      const mod = moduleRef()
      if (!mod || typeof mod.buildDiagnosticsReport !== 'function') return { ok: false, error: 'ledger-unavailable' }
      const info = await collectDiagnosticsInfo()
      const report = mod.buildDiagnosticsReport({
        version: info.version, platform: info.platform, arch: info.arch,
        config: info.config, summary: summarize(), generatedAt: new Date().toISOString()
      })
      // 防御性自检：白名单结果自身不得出现密钥 / URL / 路径 / 邮箱 / 长文本
      const findings = typeof mod.scanForSensitive === 'function' ? mod.scanForSensitive(report) : []
      if (findings.length) return { ok: false, error: '诊断内容自检未通过（已阻止导出）', findings }
      return { ok: true, report, text: JSON.stringify(report, null, 2) }
    }
    async function exportDiagnostics() {
      const built = await buildDiagnostics()
      if (!built.ok) { toast(built.error, 'err'); return built }
      const defaultName = 'sixworlds-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json'
      try {
        if (typeof api.runtimeDiagnosticsSave === 'function') {
          const r = await api.runtimeDiagnosticsSave({ defaultName, content: built.text })
          if (r && r.ok) toast('诊断包已导出：' + (r.path || defaultName), 'ok')
          else if (r && r.canceled) { /* 用户取消 */ }
          else toast('导出失败：' + ((r && r.error) || '未知错误'), 'err')
          return r
        }
        if (typeof api.saveFile === 'function') {
          const r = await api.saveFile({ title: '导出诊断包（已脱敏）', defaultName, content: built.text })
          if (r && r.ok) toast('诊断包已导出：' + (r.path || defaultName), 'ok')
          else if (r && r.error) toast('导出失败：' + r.error, 'err')
          return r
        }
      } catch (error) { toast('导出失败：' + (error.message || error), 'err') }
      return { ok: false, error: 'no-save-channel' }
    }

    /* ---- 面板 ---- */
    function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el }
    function open(title) {
      if (view) view.close()
      /* 面板打开即确保主进程订阅在（此前可能因无订阅者被释放），并补一次快照 */
      const hadIpc = !!unsubscribe
      ensureIpcSubscription()
      if (authoritative && !hadIpc && restoreResult) void performRestore()
      const trigger = document.activeElement
      const mask = node('div', 'product-mask runtime-mask')
      const panel = node('section', 'product-panel runtime-panel')
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title || '用量与任务')
      const head = node('header', 'product-head')
      const heading = node('h2', '', title || '用量与任务')
      const closeBtn = node('button', 'product-close', '×')
      closeBtn.type = 'button'; closeBtn.title = '关闭'; closeBtn.setAttribute('aria-label', '关闭')
      head.append(heading, closeBtn)
      const body = node('div', 'product-body')
      const tabs = node('div', 'product-tabs runtime-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '用量视图')
      const tabDefs = [['usage', '用量与费用'], ['estimate', '生成前估算'], ['price', '模型报价'], ['tasks', '任务状态'], ['diag', '诊断导出']]
      for (const [key, label] of tabDefs) {
        const b = node('button', 'product-tab runtime-tab', label)
        b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = key
        b.addEventListener('click', () => { tab = key; render() })
        tabs.append(b)
      }
      const content = node('div', 'runtime-content')
      panel.append(head, body); body.append(tabs, content); mask.append(panel); document.body.append(mask)
      const onKey = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
        if (event.key === 'Tab' && window.A11y && window.A11y.trapTab) window.A11y.trapTab(panel, event)
      }
      document.addEventListener('keydown', onKey, true)
      mask.addEventListener('click', (event) => { if (event.target === mask) close() })
      function close() {
        document.removeEventListener('keydown', onKey, true)
        mask.remove()
        if (view && view.mask === mask) view = null
        /* 面板关闭且无其它订阅者：释放 IPC 订阅（真正退订，不留常驻监听） */
        if (!listeners.size) releaseSubscription()
        if (window.A11y && window.A11y.restore) window.A11y.restore(trigger)
      }
      view = { mask, body, content, close, render }
      closeBtn.addEventListener('click', close)
      render()
      return view
    }

    function render(force) {
      if (!view) return
      /* 报价页正在输入时（焦点在面板内）不因账本事件重绘，避免丢输入 / 焦点；
       * 保存 / 删除等用户操作显式传 force=true 强制重绘。 */
      if (!force && tab === 'price' && typeof document !== 'undefined' && document.activeElement &&
        view.content && view.content.contains(document.activeElement)) return
      for (const el of view.content.parentElement.querySelectorAll('.runtime-tab')) {
        const on = el.dataset.tab === tab
        el.setAttribute('aria-selected', String(on))
        el.tabIndex = on ? 0 : -1
      }
      const box = view.content
      box.replaceChildren()
      if (!ledger) {
        box.append(node('p', 'product-status', '用量模块尚未就绪（engine/usage-ledger.js 未加载）'))
        return
      }
      /* 主进程落盘失败：显式警告，不谎报「已保存」（不影响故事生成） */
      if (authoritative && persistence.ok === false) {
        const warn = node('p', 'product-status error', '本地记账未保存：' + (persistence.error || '未知原因') + '。本次用量仅存在于内存，重启后可能丢失；故事生成不受影响。')
        warn.setAttribute('role', 'alert')
        box.append(warn)
      }
      if (tab === 'usage') renderUsage(box)
      else if (tab === 'estimate') renderEstimate(box)
      else if (tab === 'price') renderPrice(box)
      else if (tab === 'tasks') renderTasks(box)
      else renderDiag(box)
    }

    function renderUsage(box) {
      const s = summarize()
      if (!s) { box.append(node('p', 'product-status', '用量尚未就绪（账本未加载或主进程快照未返回）')); return }
      const cards = node('div', 'runtime-cards')
      const card = (label, value, note, cls) => {
        const el = node('div', 'runtime-card' + (cls ? ' ' + cls : ''))
        el.append(node('span', 'runtime-card-label', label), node('strong', 'runtime-card-value', value))
        if (note) el.append(node('small', 'runtime-card-note', note))
        return el
      }
      cards.append(card('调用总数', String(s.calls.total), '进行中 ' + s.calls.running + ' · 文本 ' + (s.calls.byKind.chat || 0) + ' · 图像 ' + (s.calls.byKind.image || 0)))
      cards.append(card('服务端返回 token', num(s.tokens.total), s.tokens.unknownEntries
        ? s.tokens.unknownEntries + ' 次调用未返回用量（按未知计，不计 0）'
        : '输入 ' + num(s.tokens.prompt) + ' / 输出 ' + num(s.tokens.completion) + (s.tokens.derivedTotalEntries ? '（' + s.tokens.derivedTotalEntries + ' 次合计由输入+输出推导）' : '')))
      cards.append(card('生成图片', num(s.images.count), s.images.unknownEntries ? s.images.unknownEntries + ' 次未返回图片数量' : '已知 ' + s.images.knownEntries + ' 次调用'))
      let costNote
      if (s.cost.known === null) costNote = s.cost.unknownEntries ? s.cost.unknownEntries + ' 次调用无法计价（未返回用量或未填报价）' : '暂无计费数据'
      else costNote = '已知 ' + s.cost.knownEntries + ' 次 · 未知 ' + s.cost.unknownEntries + ' 次' +
        (s.cost.provisionalEntries ? ' · ' + s.cost.provisionalEntries + ' 次失败/部分返回，金额可能仍计费' : '') +
        (s.cost.mixedCurrency ? ' · 含多种货币，未合并' : '')
      cards.append(card('累计费用', s.cost.known === null ? '未知' : money(s.cost.known, s.cost.currency), costNote, 'runtime-card-cost'))
      box.append(cards)
      if (s.cost.byCurrency && s.cost.byCurrency.length > 1) {
        const list = node('ul', 'runtime-currency')
        for (const b of s.cost.byCurrency) list.append(node('li', '', (b.currency || '未知货币') + '：' + money(b.amount, b.currency) + '（' + b.entries + ' 次）'))
        box.append(list)
      }
      const hint = node('p', 'runtime-hint', '仅统计本机记录的真实调用返回；端点未返回用量时不估算、不补 0。报价为你自己填写的参考价，最终以提供商账单为准。')
      box.append(hint)
      const recent = entries().slice(-12).reverse()
      box.append(node('h3', 'runtime-sub', '最近调用'))
      if (!recent.length) { box.append(node('p', 'product-status', '暂无调用记录')); return }
      const table = node('table', 'runtime-table')
      const thead = node('thead'); const hr = node('tr')
      for (const t of ['时间', '类型', '状态', 'token', '图片', '费用']) hr.append(node('th', '', t))
      thead.append(hr); table.append(thead)
      const tbody = node('tbody')
      for (const e of recent) {
        const tr = node('tr')
        tr.append(node('td', '', new Date(e.finishedAt || e.startedAt).toLocaleTimeString('zh-CN', { hour12: false })))
        tr.append(node('td', '', e.kind === 'image' ? '图像' : e.kind === 'chat' ? '文本' : e.kind))
        tr.append(node('td', 'runtime-status runtime-status-' + e.status, statusLabel(e.status)))
        tr.append(node('td', '', e.tokens.present ? num(e.tokens.total) : '未返回'))
        tr.append(node('td', '', e.images === null ? '未返回' : String(e.images)))
        tr.append(node('td', '', costText(e.cost)))
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
    }

    /* 估算未知原因：与 engine/usage-ledger.js 的 reason 取值一一对应 */
    function estimateReasonText(reason) {
      return ({
        'no-calls': '没有可估算的调用',
        'no-tokens': '未填每次 token',
        'no-price': '未填写报价',
        'no-image-count': '未填页数或每页张数',
        'invalid-amount': '数值超出可计算范围',
        'partial-unknown': '部分无法计价'
      })[reason] || '信息不足'
    }

    /* 生成前估算：全部输入由用户填写，缺项保持「未知」，不按经验值编造 */
    function renderEstimate(box) {
      box.append(node('p', 'runtime-hint', '填入这次操作的计划（页数、请求数、每次大概的 token 数），按你自己保存的报价估算。没填的项目保持「未知」，不会按经验值或 0 补；估算只是算术，不会发起任何模型请求。'))
      const form = node('form', 'runtime-form')
      const field = (label, placeholder, name, value, type) => {
        const wrap = node('label', 'runtime-field', label)
        const input = node('input')
        input.type = type || 'text'; input.name = name; input.placeholder = placeholder || ''
        if (value !== undefined && value !== null) input.value = String(value)
        wrap.append(input); return wrap
      }
      const prices = listPrices()
      const modelWrap = node('label', 'runtime-field', '模型（使用已保存的报价）')
      const modelSel = node('select')
      modelSel.name = 'model'
      const noneOpt = node('option', '', prices.length ? '（不选：全部按未知计价）' : '（尚未保存任何报价）')
      noneOpt.value = ''
      modelSel.append(noneOpt)
      for (const item of prices) {
        const opt = node('option', '', item.model + (item.price.currency ? '（' + item.price.currency + '）' : ''))
        opt.value = item.model
        modelSel.append(opt)
      }
      modelWrap.append(modelSel)
      const pages = field('页数（漫画 / 插图张数）', '例如 4', 'pages', null, 'number')
      const perPage = field('每页图片数', '默认 1', 'imagesPerPage', null, 'number')
      const chatCalls = field('文本调用次数', '例如 1', 'chatCalls', null, 'number')
      const promptPer = field('每次输入 token（估算）', '例如 3000', 'promptTokensPerCall', null, 'number')
      const completionPer = field('每次输出 token（估算）', '例如 800', 'completionTokensPerCall', null, 'number')
      for (const el of [modelWrap, pages, perPage, chatCalls, promptPer, completionPer]) form.append(el)
      const actions = node('div', 'product-actions')
      const runBtn = node('button', 'primary', '估算')
      runBtn.type = 'submit'
      actions.append(runBtn)
      form.append(actions)
      const out = node('div', 'runtime-cards')
      const notesBox = node('p', 'runtime-hint')
      const readNum = (wrap) => { const v = wrap.querySelector('input').value.trim(); return v === '' ? null : Number(v) }
      const renderResult = (r) => {
        out.replaceChildren()
        if (!r || r.ok !== true) { out.append(node('p', 'product-status', '估算不可用：' + ((r && r.error) || '未知错误'))); return }
        const card = (label, value, note, cls) => {
          const el = node('div', 'runtime-card' + (cls ? ' ' + cls : ''))
          el.append(node('span', 'runtime-card-label', label), node('strong', 'runtime-card-value', value))
          if (note) el.append(node('small', 'runtime-card-note', note))
          return el
        }
        const chat = r.parts.find((p) => p.kind === 'chat')
        const image = r.parts.find((p) => p.kind === 'image')
        out.append(card('预计文本调用', chat.calls === null ? '未知' : String(chat.calls), chat.tokens.total === null ? '每次 token 未填，无法估算' : '合计约 ' + num(chat.tokens.total) + ' token'))
        out.append(card('预计图片调用', image.calls === null ? '未知' : String(image.calls), r.imageCallsDerived ? '由页数 × 每页张数推导' : (image.calls === null ? '页数 / 每页张数未填' : '按填写值')))
        out.append(card('预计费用', r.total.known ? money(r.total.amount, r.total.currency) : '未知（' + estimateReasonText(r.total.reason) + '）', '按你保存的报价计算，实际以提供商账单为准', 'runtime-card-cost'))
        notesBox.textContent = (r.notes || []).join('；')
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        renderResult(estimate({
          model: modelSel.value,
          pages: readNum(pages),
          imagesPerPage: readNum(perPage),
          chatCalls: readNum(chatCalls),
          promptTokensPerCall: readNum(promptPer),
          completionTokensPerCall: readNum(completionPer)
        }))
      })
      box.append(form, out, notesBox)
    }

    function renderPrice(box) {
      box.append(node('p', 'runtime-hint', '填写你自己模型的单价（来自提供商定价页）。留空的项保持「未知」，不会按 0 计算。文本模型需同时填写输入与输出单价才会计价。'))
      const form = node('form', 'runtime-form')
      const field = (label, placeholder, name, value, type) => {
        const wrap = node('label', 'runtime-field', label)
        const input = node('input')
        input.type = type || 'text'; input.name = name; input.placeholder = placeholder || ''
        if (value !== undefined && value !== null) input.value = String(value)
        wrap.append(input); return wrap
      }
      const model = field('模型名（与调用时一致）', 'deepseek-chat', 'model')
      const currency = field('货币', 'CNY / USD', 'currency')
      const inputPrice = field('输入单价（每百万 token）', '例如 1', 'inputPerMTok', null, 'number')
      const outputPrice = field('输出单价（每百万 token）', '例如 2', 'outputPerMTok', null, 'number')
      const imagePrice = field('图像单价（每张）', '例如 0.04', 'imagePerUnit', null, 'number')
      for (const el of [model, currency, inputPrice, outputPrice, imagePrice]) form.append(el)
      const actions = node('div', 'product-actions')
      const saveBtn = node('button', 'primary', '保存报价')
      saveBtn.type = 'submit'
      actions.append(saveBtn)
      form.append(actions)
      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        const key = model.querySelector('input').value.trim()
        if (!key) { toast('请填写模型名', 'err'); return }
        const read = (wrap) => { const v = wrap.querySelector('input').value.trim(); return v === '' ? null : Number(v) }
        const r = await setPrice(key, { currency: currency.querySelector('input').value.trim() || null, inputPerMTok: read(inputPrice), outputPerMTok: read(outputPrice), imagePerUnit: read(imagePrice) })
        if (r && r.ok && r.persisted !== false) toast('报价已保存（未知项保持未知）', 'ok')
        else if (r && r.ok) toast('报价仅保存在内存，本地记账未保存——重启后可能丢失', 'err')
        else toast('保存失败：' + ((r && r.error) || '未知错误'), 'err')
      })
      box.append(form)
      const prices = listPrices()
      box.append(node('h3', 'runtime-sub', '已保存报价'))
      if (!prices.length) { box.append(node('p', 'product-status', '尚未填写任何报价——费用将显示为未知')); return }
      const table = node('table', 'runtime-table')
      const thead = node('thead'); const hr = node('tr')
      for (const t of ['模型', '货币', '输入/百万', '输出/百万', '图像/张', '操作']) hr.append(node('th', '', t))
      thead.append(hr); table.append(thead)
      const tbody = node('tbody')
      for (const item of prices) {
        const p = item.price
        const tr = node('tr')
        tr.append(node('td', '', item.model))
        tr.append(node('td', '', p.currency || '未知'))
        tr.append(node('td', '', p.inputPerMTok === null ? '未知' : String(p.inputPerMTok)))
        tr.append(node('td', '', p.outputPerMTok === null ? '未知' : String(p.outputPerMTok)))
        tr.append(node('td', '', p.imagePerUnit === null ? '未知' : String(p.imagePerUnit)))
        const del = node('button', 'ghost', '删除')
        del.type = 'button'
        /* 删除报价：等待主进程回执后再反馈；失败绝不谎报成功。
         * 回执 ok 但本地未落盘（persisted=false）时如实提示「仅内存」，不说「已删除保存」。 */
        del.addEventListener('click', async () => {
          del.disabled = true
          const r = await removePrice(item.model)
          if (!r || r.ok !== true) { del.disabled = false; toast('删除失败：' + ((r && r.error) || '未知错误'), 'err'); return }
          if (r.persisted === false) toast('报价已从内存移除，但本地记账未保存——重启后可能仍在', 'err')
          else toast('报价已删除', 'ok')
          render(true)
        })
        const td = node('td'); td.append(del); tr.append(td)
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
    }

    function renderTasks(box) {
      const s = summarize()
      const cards = node('div', 'runtime-cards')
      const card = (label, value) => { const el = node('div', 'runtime-card'); el.append(node('span', 'runtime-card-label', label), node('strong', 'runtime-card-value', value)); return el }
      cards.append(card('进行中', String(s.tasks.running)), card('完成', String(s.tasks.succeeded)), card('失败', String(s.tasks.failed)), card('部分返回', String(s.tasks.partial)), card('已中止', String(s.tasks.aborted)))
      box.append(cards)
      box.append(node('p', 'runtime-hint', '失败、中止与部分返回会单独标记；这些调用是否已计费由提供商决定，界面不代为判断。'))
      const rows = tasks().slice(-30).reverse()
      if (!rows.length) { box.append(node('p', 'product-status', '暂无任务')); return }
      const table = node('table', 'runtime-table')
      const thead = node('thead'); const hr = node('tr')
      for (const t of ['开始', '类型', '状态', '耗时']) hr.append(node('th', '', t))
      thead.append(hr); table.append(thead)
      const tbody = node('tbody')
      for (const t of rows) {
        const tr = node('tr')
        tr.append(node('td', '', new Date(t.startedAt).toLocaleTimeString('zh-CN', { hour12: false })))
        tr.append(node('td', '', t.kind === 'image' ? '图像' : t.kind === 'chat' ? '文本' : t.kind))
        tr.append(node('td', 'runtime-status runtime-status-' + t.status, statusLabel(t.status)))
        tr.append(node('td', '', t.durationMs === null ? '—' : Math.round(t.durationMs) + ' ms'))
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
    }

    function renderDiag(box) {
      box.append(node('p', 'runtime-hint', '诊断包只包含：应用版本、平台与架构、若干布尔开关、以及聚合统计（调用数 / token / 图片数 / 费用条目数）。不含 API Key、模型名、端点地址、正文或任何用户路径；导出前会再做一次敏感内容自检。'))
      const actions = node('div', 'product-actions')
      const exportBtn = node('button', 'primary', '导出脱敏诊断包')
      exportBtn.type = 'button'
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true
        try { await exportDiagnostics() } finally { exportBtn.disabled = false }
      })
      const previewBtn = node('button', 'ghost', '预览将导出的内容')
      previewBtn.type = 'button'
      const out = node('pre', 'runtime-pre')
      previewBtn.addEventListener('click', async () => {
        const built = await buildDiagnostics()
        out.textContent = built.ok ? built.text : '自检未通过，已阻止导出：' + built.error
      })
      actions.append(exportBtn, previewBtn); box.append(actions, out)
    }

    function mount(selector) {
      try {
        if (typeof document === 'undefined' || !document.body) return null
        if (document.getElementById('btn-runtime-tools')) return document.getElementById('btn-runtime-tools')
        const host = (selector && document.querySelector(selector)) ||
          document.querySelector('.chat-head-right') || document.querySelector('.titlebar-actions') || document.querySelector('.chat-header')
        if (!host) return null
        const button = node('button', 'tool-btn', '用量')
        button.id = 'btn-runtime-tools'
        button.type = 'button'
        button.title = '调用数 / 真实返回的 token 与图片数 / 任务状态 / 费用累计（未知不显示为 0）'
        button.addEventListener('click', () => open('用量与任务'))
        host.prepend(button)
        return button
      } catch { return null }
    }

    ensureStyle()
    if (options.autoMount !== false) {
      if (typeof document !== 'undefined' && document.body) mount(options.hostSelector)
      else if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => mount(options.hostSelector))
    }
    /* ready 时完成一次 restore（权威模式 = 读主进程快照并建立订阅），再按需重绘；
     * 先 restore 再订阅，避免异步加载覆盖已到达的新账（revision 去重是第二道保险）。 */
    /* 启动即完成首次 restore（权威模式=读首个快照并建立订阅），随后按需重绘。
     * ready() 已内含这次 restore，故这里 await 后 summarize()/tasks() 必已就绪。 */
    void ready().then(() => { if (view) render() })

    return {
      open, mount, render, ready, restore, persist, subscribe, releaseSubscription,
      startCall, finishCall, recordCall, cancelCall: (h) => { const r = ledger ? ledger.cancel(h) : { ok: false, error: 'ledger-unavailable' }; scheduleSave(); return r },
      setPrice, removePrice, priceKnownFor, summarize, tasks, entries,
      prices: listPrices, listPrices, priceFor: getPrice, getPrice,
      estimate, buildDiagnostics, exportDiagnostics,
      persistence: persistenceState,
      isAuthoritative: () => authoritative,
      revision: () => revision,
      ledger: () => ledger
    }
  }

  const api = { create, ensureLedgerGlobal, LEDGER_LOCAL_KEY }
  if (typeof window !== 'undefined') window.RuntimeTools = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()

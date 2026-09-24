/* ======== 六面世界 · 体验工具（共享入口：用量与估计 / 模型报价 / 任务状态 / 脱敏诊断）（三方案共享）========
 * 覆盖 docs/desktop-evolution.md 两项验收的界面面：
 *   -「可选模型报价、调用/页数估计、任务状态与累计费用」
 *   -「脱敏诊断导出；默认不含正文、密钥或用户文件路径」
 *
 * 复用既有系统，不另起一套：
 *   - 账本：优先复用注入的 RuntimeTools 实例（ctx.runtime）——同一份 engine/usage-ledger.js 账本，
 *     因此「累计用量/金额」与「用量」面板天然一致；未注入时自行按 window.UsageLedger 建实例，
 *     并从同一个 localStorage 键（sixworlds.usage-ledger.v1）只读取回显。
 *   - 面板外壳：复用 ctx.shell（ProductTools 实例）的 open(title)；缺失时用同一套 product-* 结构自建。
 *   - 漫画页数：默认读 comic-panel 自己的偏好键 sixworlds.comic.pref（不重复实现漫画逻辑）。
 *   - 诊断：数据面全部在主进程 engine/experience-tools.cjs（IPC experience:*）；本文件只做白名单
 *     取值 + 提交 + 展示，未接入通道时明确说明「无法生成」，绝不用界面数据伪造存储统计。
 *
 * 语义（与 engine/usage-ledger.js、engine/experience-tools.cjs 一致）：
 *   - 端点未返回 usage → 「未知（未返回）」；未填报价 → 「未知（未填写报价）」；两者都不折算为 0；
 *   - 「估计」与「真实返回」严格分区标注：估计值只由「你填写的报价 × 你填写的用量/页数」得出，
 *     或由「最近 N 次真实返回的平均用量」推导（标注样本数），永不冒充真实账单；
 *   - 失败 / 中止 / 部分返回：金额标「可能仍计费，以账单为准」。
 *
 * 挂载（父集成统一入口时用）：
 *   const ExperienceTools = window.ExperienceTools.create({
 *     api,                       // preload 暴露面（experience* 方法；缺失时自动降级）
 *     cfg: () => cfg,            // 只读布尔开关；apiKey/baseUrl 永不出渲染层
 *     toast,                     // 现有 toast
 *     session: () => curSession(),
 *     shell: ProductTools,       // 复用 open(title)
 *     runtime: RuntimeTools,     // 可选：复用同一账本（推荐）
 *     comic: () => ({ pages }),  // 可选：漫画页数来源；缺省读 sixworlds.comic.pref
 *     options: { autoMount: true }   // 默认不自动挂载，由父统一入口决定
 *   })
 *   ExperienceTools.open()        // 打开面板
 *   ExperienceTools.mount(sel)    // 挂一个入口按钮（可选）
 *
 * 主进程 / preload 接入（main.cjs、preload.cjs 由父代理维护，全部可选——缺失时面板给出可执行提示）：
 *   ipcMain.handle('experience:storage', ...)             preload: experienceStorage()
 *   ipcMain.handle('experience:diagnostics-info', ...)    preload: experienceDiagnosticsInfo()
 *   ipcMain.handle('experience:report', ...)              preload: experienceReport(payload)
 *   ipcMain.handle('experience:diagnostics-save', ...)    preload: experienceDiagnosticsSave(payload)
 *   ipcMain.handle('experience:record-error', ...)        preload: experienceRecordError(payload)
 *   接线见 engine/experience-tools.cjs 的 register()。
 */
(function () {
  'use strict'

  const LEDGER_LOCAL_KEY = 'sixworlds.usage-ledger.v1'
  const COMIC_PREF_KEY = 'sixworlds.comic.pref'
  const STYLE_ID = 'experience-tools-style'

  /* 诊断只允许出现的布尔配置键（与 engine/usage-ledger.js 的 DIAG_CONFIG_KEYS 同集） */
  const DIAG_CONFIG_KEYS = [
    'hasTextKey', 'hasIllustKey', 'illustEnabled', 'autoIllust', 'skipSplash',
    'petModelReady', 'embedderConfigured', 'thinkingEnabled', 'customEndpoint',
    'reducedMotion', 'highContrast', 'diagnosticsOptIn'
  ]

  /* 只用各界面 styles.css / theme-system.css 已定义的语义变量：七配色 × 明暗自动成立 */
  const CSS_TEXT = [
    '.exp-panel{width:min(900px,100%);}',
    '.exp-tabs{padding-bottom:12px;}',
    '.exp-content{min-height:180px;}',
    '.exp-sub{margin:18px 0 10px;font-size:13px;font-weight:650;color:var(--text);}',
    '.exp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:4px 0 8px;}',
    '.exp-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px;background:var(--panel-2);border:1px solid var(--border);border-radius:var(--ui-radius);}',
    '.exp-card-label{font-size:11.5px;color:var(--text-dim);}',
    '.exp-card-value{font-size:19px;font-weight:650;color:var(--text);overflow-wrap:anywhere;}',
    '.exp-card-note{font-size:11.5px;line-height:1.6;color:var(--text-dim);}',
    '.exp-card-real .exp-card-value{color:var(--accent);}',
    '.exp-card-est .exp-card-value{color:var(--warn,var(--accent));}',
    '.exp-hint{padding:10px 0 4px;font-size:12px;line-height:1.75;color:var(--text-dim);}',
    '.exp-form{display:flex;flex-wrap:wrap;gap:12px;padding:6px 0 12px;}',
    '.exp-field{display:flex;flex-direction:column;gap:6px;flex:1 1 170px;font-size:12px;color:var(--text-dim);}',
    '.exp-field input{height:var(--ui-control);padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border-strong);border-radius:var(--ui-radius);}',
    '.exp-field input:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}',
    '.exp-table{width:100%;border-collapse:collapse;font-size:12px;}',
    '.exp-table th{padding:8px 10px;text-align:left;font-weight:600;color:var(--text-dim);border-bottom:1px solid var(--border-strong);white-space:nowrap;}',
    '.exp-table td{padding:8px 10px;color:var(--text);border-bottom:1px solid var(--border);overflow-wrap:anywhere;}',
    '.exp-status-succeeded{color:var(--ok);}',
    '.exp-status-failed{color:var(--danger);}',
    '.exp-status-partial{color:var(--warn,var(--accent));}',
    '.exp-status-aborted{color:var(--text-dim);}',
    '.exp-status-running{color:var(--accent);}',
    '.exp-pre{margin-top:12px;max-height:320px;overflow:auto;padding:12px 14px;font-size:11.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel-2);color:var(--text-dim);border:1px solid var(--border);border-radius:var(--ui-radius);}',
    '.exp-pre:empty{display:none;}',
    '.exp-content button:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}',
    '@media(max-width:700px){.exp-cards{grid-template-columns:1fr 1fr;}.exp-field{flex:1 1 100%;}.exp-table{display:block;overflow-x:auto;}}'
  ].join('')

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  /* ---- 基础数值：未知一律 null，绝不折算为 0 ---- */
  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null
    const n = typeof value === 'number' ? value : Number(String(value).trim())
    return Number.isFinite(n) ? n : null
  }
  function finiteCount(value) {
    const n = finiteNumber(value)
    return n !== null && n >= 0 ? n : null
  }
  function round6(n) { return Math.round(n * 1e6) / 1e6 }
  const numText = (v) => (v === null || v === undefined ? '未知' : Number(v).toLocaleString('zh-CN'))
  function money(amount, currency) {
    if (amount === null || amount === undefined) return '未知'
    return Number(amount).toFixed(4) + (currency ? ' ' + currency : '')
  }

  /* ---- 报价归一（与 engine/usage-ledger.js 同形；未知分项保持 null，负数视为无效） ---- */
  function normalizePrice(input) {
    const p = input && typeof input === 'object' ? input : {}
    const pick = (...keys) => {
      for (const k of keys) {
        if (p[k] === undefined || p[k] === null || p[k] === '') continue
        const n = finiteNumber(p[k])
        return n !== null && n >= 0 ? n : null
      }
      return null
    }
    return {
      currency: typeof p.currency === 'string' && p.currency.trim() ? p.currency.trim().slice(0, 8) : null,
      inputPerMTok: pick('inputPerMTok', 'input', 'promptPerMTok', 'prompt'),
      outputPerMTok: pick('outputPerMTok', 'output', 'completionPerMTok', 'completion'),
      imagePerUnit: pick('imagePerUnit', 'image', 'perImage'),
      perCall: pick('perCall'),
      source: 'user'
    }
  }
  function priceKnownFor(kind, price) {
    const p = normalizePrice(price)
    if (String(kind) === 'image') return p.imagePerUnit !== null
    return p.inputPerMTok !== null && p.outputPerMTok !== null
  }

  /* ---- 估计：只用「你填的报价 × 你给的用量/页数」，或「真实返回的平均用量」 ---- */
  function computeCost(options) {
    const o = options || {}
    const kind = String(o.kind || 'chat')
    const price = normalizePrice(o.price)
    const usage = o.usage || {}
    const images = finiteCount(o.images !== undefined ? o.images : o.imageCount)
    const serviceCost = finiteNumber(o.serviceCost)
    const currency = price.currency
    if (serviceCost !== null && serviceCost >= 0) return { amount: serviceCost, currency, known: true, reason: 'service-cost' }
    if (kind === 'image') {
      if (images === null) return { amount: null, currency, known: false, reason: 'no-image-count' }
      if (price.imagePerUnit === null) return { amount: null, currency, known: false, reason: 'no-price' }
      return { amount: round6(images * price.imagePerUnit), currency, known: true, reason: 'computed' }
    }
    const prompt = finiteCount(usage.prompt !== undefined ? usage.prompt : usage.prompt_tokens)
    const completion = finiteCount(usage.completion !== undefined ? usage.completion : usage.completion_tokens)
    if (prompt === null && completion === null) return { amount: null, currency, known: false, reason: 'no-usage' }
    if (price.inputPerMTok === null || price.outputPerMTok === null) return { amount: null, currency, known: false, reason: 'no-price' }
    if (prompt === null || completion === null) return { amount: null, currency, known: false, reason: 'usage-incomplete' }
    return {
      amount: round6((prompt / 1e6) * price.inputPerMTok + (completion / 1e6) * price.outputPerMTok),
      currency, known: true, reason: 'computed'
    }
  }

  /* 调用估计：用量来源二选一 —— 手填（manual）或最近 N 次真实返回的平均（real-average） */
  function estimateCallCost(input) {
    const i = input || {}
    const price = normalizePrice(i.price)
    const kind = String(i.kind || 'chat')
    const manualPrompt = finiteCount(i.promptTokens)
    const manualCompletion = finiteCount(i.completionTokens)
    const manual = manualPrompt !== null || manualCompletion !== null
    const avg = i.average && typeof i.average === 'object' ? i.average : null
    const samples = avg ? finiteCount(avg.samples) : null
    const useAvg = !manual && avg && samples !== null && samples > 0
    const prompt = manual ? manualPrompt : (useAvg ? finiteCount(avg.prompt) : null)
    const completion = manual ? manualCompletion : (useAvg ? finiteCount(avg.completion) : null)
    const basis = manual ? 'manual' : (useAvg ? 'real-average' : 'none')
    if (kind === 'image') {
      const images = finiteCount(i.images)
      const cost = computeCost({ kind: 'image', price, images })
      return { known: cost.known, amount: cost.amount, currency: cost.currency, reason: cost.reason, basis: images === null ? 'none' : (manual || useAvg ? basis : 'manual'), samples: useAvg ? samples : null }
    }
    if (prompt === null || completion === null) {
      return { known: false, amount: null, currency: price.currency, reason: 'no-usage', basis: 'none', samples: null }
    }
    const cost = computeCost({ kind, price, usage: { prompt, completion } })
    return { known: cost.known, amount: cost.amount, currency: cost.currency, reason: cost.reason, basis, samples: useAvg ? samples : null, prompt, completion }
  }

  /* 真实用量平均：只取「端点确实返回了用量」的条目，样本不足就是 null（不猜） */
  function averageUsage(entries, kind) {
    const rows = (Array.isArray(entries) ? entries : []).filter((e) => e && e.tokens && e.tokens.present &&
      (kind ? e.kind === kind : true) && finiteCount(e.tokens.prompt) !== null && finiteCount(e.tokens.completion) !== null)
    if (!rows.length) return null
    const prompt = rows.reduce((n, e) => n + Number(e.tokens.prompt), 0) / rows.length
    const completion = rows.reduce((n, e) => n + Number(e.tokens.completion), 0) / rows.length
    return { prompt: Math.round(prompt), completion: Math.round(completion), samples: rows.length }
  }

  /* 漫画页数估计：页数 × 图片单价；页数未知或报价未知 → 未知 */
  function estimateComicCost(input) {
    const i = input || {}
    const pages = finiteCount(i.pages)
    const price = normalizePrice(i.price)
    const cost = computeCost({ kind: 'image', price, images: pages })
    return { pages, known: cost.known, amount: cost.amount, currency: cost.currency, reason: cost.reason, minutes: pages === null ? null : Math.max(1, Math.round(pages * 15 / 60)) }
  }

  /* 漫画页数来源：优先 ctx.comic()，其次 comic-panel 的偏好键，最后按回合数推算（每回合一张模式） */
  function comicPagesFromPrefs(readPref, turns) {
    const pref = readPref && typeof readPref === 'object' ? readPref : {}
    const mode = pref.mode === 'every' ? 'every' : 'ai'
    const pageCount = finiteCount(pref.pageCount)
    if (mode === 'every') {
      const t = finiteCount(turns)
      return { pages: t, mode, source: t === null ? 'unknown' : 'turns' }
    }
    return { pages: pageCount, mode, source: pageCount === null ? 'unknown' : 'pref' }
  }

  /* ---- 阶段推导：由渲染层自己的配置推导，只回枚举，绝不回配置原文 / 密钥 ----
   * 与主进程 STAGES 同一组枚举；正式 main 不再读取 renderer 配置，阶段由本函数算好后随
   * experienceDiagnosticsInfo({ stage }) 提交，主进程侧仍会再走一次白名单归一。
   *   first-run   ：文本模型还没配好（缺 baseUrl / apiKey / model 任一）
   *   text-ready  ：文本已就绪，但插图未启用
   *   illust-ready：文本就绪且插图也已配置（illustEnabled 或三要素齐全） */
  const STAGES = ['first-run', 'text-ready', 'illust-ready']
  function deriveStage(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {}
    const textReady = !!(c.baseUrl && c.apiKey && c.model)
    if (!textReady) return 'first-run'
    const illustReady = c.illustPreset !== 'off' &&
      !!(c.illustEnabled || (c.illustBaseUrl && c.illustApiKey && c.illustModel))
    return illustReady ? 'illust-ready' : 'text-ready'
  }

  /* ---- 诊断入参白名单：渲染层绝不把密钥 / 端点 / 模型名 / 自由文本递给主进程 ---- */
  function configFlags(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {}
    return {
      hasTextKey: !!c.apiKey,
      hasIllustKey: !!c.illustApiKey,
      illustEnabled: c.illustPreset !== 'off' && !!(c.illustModel || c.illustBaseUrl),
      autoIllust: !!c.illustAuto,
      skipSplash: !!c.skipSplash,
      thinkingEnabled: !!c.thinkLevel && c.thinkLevel !== 'default',
      customEndpoint: c.preset === 'custom',
      reducedMotion: c.reducedMotion === true,
      highContrast: c.palette === 'contrast'
    }
  }
  function buildDiagnosticsInput(input) {
    const i = input || {}
    const out = { extended: i.extended === true }
    const src = i.config && typeof i.config === 'object' ? i.config : {}
    const config = {}
    for (const key of DIAG_CONFIG_KEYS) if (Object.prototype.hasOwnProperty.call(src, key)) config[key] = src[key] === true
    out.config = config
    if (i.usage && typeof i.usage === 'object') out.usage = i.usage
    if (i.errors && typeof i.errors === 'object') out.errors = i.errors
    if (i.storage && typeof i.storage === 'object') out.storage = i.storage
    /* 阶段只保留白名单枚举（推导自渲染层配置），绝不回配置原文 / 密钥 */
    if (STAGES.includes(i.stage)) out.stage = i.stage
    if (typeof i.generatedAt === 'string') out.generatedAt = i.generatedAt
    return out
  }

  function ensureStyle() {
    if (typeof document === 'undefined' || !document.head) return
    try {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.setAttribute('data-experience-tools', '1')
      style.textContent = CSS_TEXT
      document.head.appendChild(style)
    } catch { /* noop */ }
  }

  function ensureLedgerGlobal() {
    if (typeof window === 'undefined') return Promise.resolve(null)
    if (window.UsageLedger) return Promise.resolve(window.UsageLedger)
    if (typeof document === 'undefined' || !document.head) return Promise.resolve(null)
    const src = (() => {
      try { return (document.currentScript && document.currentScript.src) || '' } catch { return '' }
    })()
    const candidates = []
    if (src) candidates.push(src.replace(/ui\/shared\/experience-tools\.js.*$/, 'engine/usage-ledger.js'))
    candidates.push('../../engine/usage-ledger.js', '../engine/usage-ledger.js', './usage-ledger.js')
    return [...new Set(candidates)].reduce((chain, href) => chain.then((mod) => {
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

  const statusLabel = (status) => ({ running: '进行中', succeeded: '完成', failed: '失败', partial: '部分返回', aborted: '已中止' })[status] || String(status || '未知')
  function costText(cost) {
    if (!cost) return '未知'
    if (!cost.known) {
      const why = cost.reason === 'no-price' ? '未填写报价'
        : cost.reason === 'no-usage' ? '端点未返回用量'
          : cost.reason === 'usage-incomplete' ? '用量不完整'
            : cost.reason === 'no-image-count' ? '未返回图片数量' : '信息不足'
      return '未知（' + why + '）'
    }
    return money(cost.amount, cost.currency) +
      (cost.provisional ? ' · 可能仍计费（以账单为准）' : cost.reason === 'service-cost' ? ' · 服务端返回' : '')
  }

  function create(ctx) {
    const c = ctx || {}
    const api = c.api || (typeof window !== 'undefined' ? window.api : null) || {}
    const toast = typeof c.toast === 'function' ? c.toast : () => {}
    const cfg = typeof c.cfg === 'function' ? c.cfg : () => ({})
    const shell = c.shell || null
    const runtime = c.runtime || null
    const options = c.options || {}
    const readPref = typeof c.readComicPref === 'function'
      ? c.readComicPref
      : () => { try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(COMIC_PREF_KEY)) || 'null') || {} } catch { return {} } }

    let ledger = null
    let ledgerMod = (typeof window !== 'undefined' && window.UsageLedger) || options.ledgerModule || null
    let readyPromise = null
    let view = null
    let returnFocus = null
    let tab = 'usage'
    let priceModel = ''
    let priceDraft = null
    let estTokens = { prompt: '', completion: '' }
    let estPages = null
    let unsubscribe = null

    /* 账本：优先复用注入的 RuntimeTools 实例（同一份账目），否则自建并只读取回显。
     * 注入 runtime 时必须 await runtime.ready() 再取同一账本，绝不抢先创建独立账本
     * （否则「累计用量/金额」会与「用量」面板分叉）。 */
    function ledgerOf() { return ledger }
    function moduleRef() { return ledgerMod || (typeof window !== 'undefined' && window.UsageLedger) || null }
    function ready() {
      if (ledger) return Promise.resolve(ledger)
      if (readyPromise) return readyPromise
      readyPromise = Promise.resolve()
        .then(() => {
          if (runtime && typeof runtime.ready === 'function') {
            return Promise.resolve(runtime.ready()).then(() => {
              const l = typeof runtime.ledger === 'function' ? runtime.ledger() : null
              if (l) { ledger = l; return l }
              return null
            })
          }
          return null
        })
        .then((l) => {
          if (l) return l
          return ensureLedgerGlobal().then((mod) => {
            if (mod) ledgerMod = mod
            if (!ledger && mod && typeof mod.createLedger === 'function') {
              ledger = mod.createLedger({ idPrefix: 'EXP' })
              try {
                const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LEDGER_LOCAL_KEY) : null
                if (raw) ledger.load(JSON.parse(raw))
              } catch { /* 回显失败不影响新建账本 */ }
            }
            return ledger
          })
        })
      return readyPromise
    }
    /* 订阅 runtime 的账本变化，用于已打开面板的实时更新；runtime 无订阅能力时静默跳过。
     * 公共契约：runtime.subscribe(cb) 注册监听并返回退订函数（cb 收到与主进程同源的快照）。 */
    function subscribeRuntime() {
      if (unsubscribe || !runtime || typeof runtime.ready !== 'function') return
      const sub = runtime.subscribe
      if (typeof sub !== 'function') return
      try {
        const off = sub(() => { refreshLive() })
        if (typeof off === 'function') unsubscribe = off
      } catch { /* 订阅失败不影响面板可用性 */ }
    }
    /* 释放订阅：面板关闭 / 已断开时调用；只停本面板的实时刷新，不影响主进程记账 */
    function releaseSubscription() {
      if (!unsubscribe) return
      try { unsubscribe() } catch { /* noop */ }
      unsubscribe = null
    }
    /* 面板是否仍然挂在文档里（ProductTools 的 shell 分支关闭时不回调我们，只能自检） */
    function viewConnected() {
      return !!(view && view.mask && view.mask.isConnected)
    }
    /* 实时刷新：只重绘只读区域（用量 / 任务）自动更新；
     * 报价页正在输入时（焦点在面板内）不自动重绘，避免丢输入 / 焦点——
     * 保存或删除成功后由操作自身触发重绘。
     * 面板已被关闭（尤其 shell 分支）时先退订，绝不因事件把已关面板重新打开。 */
    function refreshLive() {
      if (!viewConnected()) { releaseSubscription(); return }
      if (tab === 'usage' || tab === 'tasks') { void show(tab, { refresh: true }); return }
      if (tab === 'price') {
        const active = document.activeElement
        if (active && view.mask && view.mask.contains(active)) return // 正在编辑：保留输入与焦点
        void show('price', { refresh: true })
      }
    }
    function summarize() {
      if (runtime && typeof runtime.summarize === 'function') { const s = runtime.summarize(); if (s) return s }
      return ledger ? ledger.summarize() : null
    }
    function tasks() {
      if (runtime && typeof runtime.tasks === 'function') return runtime.tasks()
      return ledger ? ledger.tasks() : []
    }
    function entries() {
      if (runtime && typeof runtime.entries === 'function') return runtime.entries()
      return ledger ? ledger.entries() : []
    }
    /* 本地记账未保存警告：主进程 persistence.ok=false 时如实显示（不影响故事生成） */
    function persistenceWarning() {
      if (!runtime || typeof runtime.persistence !== 'function') return null
      let p = null
      try { p = runtime.persistence() } catch { return null }
      if (!p || p.ok !== false) return null
      return '本地记账未保存：' + (p.error || '未知原因') + '。本次用量仅存在于内存，重启后可能丢失；故事生成不受影响。'
    }
    async function setPrice(model, price) {
      if (runtime && typeof runtime.setPrice === 'function') return runtime.setPrice(model, price)
      if (!ledger) return { ok: false, error: '账本未就绪' }
      const r = ledger.setPrice(model, price)
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(LEDGER_LOCAL_KEY, JSON.stringify(ledger.toJSON())) } catch { /* noop */ }
      return r
    }
    function prices() {
      if (runtime && typeof runtime.prices === 'function') return runtime.prices()
      if (runtime && typeof runtime.listPrices === 'function') return runtime.listPrices()
      return ledger ? ledger.listPrices() : []
    }
    function priceFor(model) {
      const key = String(model || '').trim()
      if (!key) return null
      if (runtime && typeof runtime.priceFor === 'function') return runtime.priceFor(key)
      if (runtime && typeof runtime.getPrice === 'function') return runtime.getPrice(key)
      if (ledger && typeof ledger.getPrice === 'function') return ledger.getPrice(key)
      return null
    }
    /* 删除报价：注入 runtime 时 await IPC 回执（失败绝不谎报成功）；自建账本时同步删除并落盘 */
    async function removePrice(model) {
      if (runtime && typeof runtime.removePrice === 'function') return runtime.removePrice(model)
      if (ledger && typeof ledger.removePrice === 'function') {
        const r = ledger.removePrice(model)
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(LEDGER_LOCAL_KEY, JSON.stringify(ledger.toJSON())) } catch { /* noop */ }
        return { ok: true, removed: r === true }
      }
      return { ok: false, error: '账本未就绪' }
    }

    /* ---- 诊断：数据面在主进程；未接入通道时如实说明，不用界面数据伪造 ---- */
    async function storageStats() {
      if (typeof api.experienceStorage === 'function') {
        try { const r = await api.experienceStorage(); if (r && r.ok && r.stats) return r.stats } catch { /* 通道异常按未接入处理 */ }
      }
      return null
    }
    async function diagInfo(payload) {
      if (typeof api.experienceDiagnosticsInfo === 'function') {
        try { const r = await api.experienceDiagnosticsInfo(payload); if (r && r.ok) return r } catch { /* noop */ }
      }
      return null
    }
    async function buildDiagnostics(extended) {
      if (typeof api.experienceReport !== 'function') {
        return { ok: false, error: '诊断通道未接入（需主进程注册 experience:* 并在 preload 暴露 experienceReport）' }
      }
      const flags = configFlags(cfg())
      /* 阶段枚举：既随 info 提交，也随 report 入参提交（主进程不再读 renderer 配置），
       * 只发枚举，不发配置原文 / 密钥。 */
      const stage = deriveStage(cfg())
      const info = await diagInfo({ stage })
      const stats = (info && info.storage) || await storageStats()
      const payload = buildDiagnosticsInput({
        extended: extended === true,
        config: flags,
        stage,
        usage: summarize(),
        storage: stats || undefined,
        generatedAt: new Date().toISOString()
      })
      try {
        const r = await api.experienceReport(payload)
        if (!r || r.ok !== true) return { ok: false, error: (r && r.error) || '诊断生成失败' }
        return { ok: true, report: r.report, text: r.text }
      } catch (error) { return { ok: false, error: String((error && error.message) || error) } }
    }
    async function exportDiagnostics(extended) {
      const built = await buildDiagnostics(extended)
      if (!built.ok) { toast(built.error, 'err'); return built }
      const defaultName = 'sixworlds-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json'
      try {
        if (typeof api.experienceDiagnosticsSave === 'function') {
          const r = await api.experienceDiagnosticsSave({ defaultName, content: built.text })
          if (r && r.ok) toast('脱敏诊断包已导出', 'ok')
          else if (!(r && r.canceled)) toast('导出失败：' + ((r && r.error) || '未知错误'), 'err')
          return r
        }
        if (typeof api.saveFile === 'function') {
          const r = await api.saveFile({ title: '导出脱敏诊断包', defaultName, content: built.text })
          if (r && r.ok) toast('脱敏诊断包已导出', 'ok')
          else if (r && r.error) toast('导出失败：' + r.error, 'err')
          return r
        }
      } catch (error) { toast('导出失败：' + ((error && error.message) || error), 'err') }
      return { ok: false, error: '没有可用的保存通道' }
    }
    /* 供父集成（send-flow / 连接测试等）上报错误码：只传短码，绝不传原始错误文本 */
    async function noteError(code) {
      if (typeof api.experienceRecordError !== 'function') return { ok: false, error: '未接入' }
      try { return await api.experienceRecordError({ code: String(code || '') }) } catch { return { ok: false, error: '上报失败' } }
    }

    /* ---- 面板外壳：优先复用 ProductTools.open ---- */
    function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el }
    function open(title) {
      if (shell && typeof shell.open === 'function') {
        view = shell.open(title || '用量与估计')
        view.experience = true
        /* 最小兼容修复：ProductTools 的 close 不会回调本模块，这里包一层，
         * 关闭时退订（ProductTools 复用面板 / 其它工具抢开面板都会走同一个 close）。 */
        if (typeof view.close === 'function' && view.close.__experienceWrapped !== true) {
          const innerClose = view.close
          const wrapped = function (...args) { releaseSubscription(); return innerClose.apply(this, args) }
          wrapped.__experienceWrapped = true
          view.close = wrapped
        }
        return view
      }
      /* 焦点归还目标由 show() 记录（它知道这次是首次打开还是复用面板） */
      if (view) view.close(false)
      const mask = node('div', 'product-mask')
      const panel = node('section', 'product-panel exp-panel')
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title || '用量与估计')
      const head = node('header', 'product-head')
      const heading = node('h2', '', title || '用量与估计')
      const closeButton = node('button', 'product-close', '×')
      closeButton.type = 'button'; closeButton.title = '关闭'; closeButton.setAttribute('aria-label', '关闭')
      head.append(heading, closeButton)
      const body = node('div', 'product-body')
      panel.append(head, body); mask.append(panel); document.body.append(mask)
      const onKey = (event) => {
        if (document.querySelector('.confirm-mask')) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
        if (event.key === 'Tab' && window.A11y && window.A11y.trapTab) window.A11y.trapTab(panel, event)
      }
      document.addEventListener('keydown', onKey, true)
      mask.addEventListener('click', (event) => { if (event.target === mask) close() })
      function close(restore = true) {
        document.removeEventListener('keydown', onKey, true)
        mask.remove()
        if (view && view.mask === mask) view = null
        /* 面板关闭即退订，避免面板重开时累积重复订阅 */
        releaseSubscription()
        if (restore && returnFocus) { if (window.A11y && window.A11y.restore) window.A11y.restore(returnFocus); returnFocus = null }
      }
      view = { mask, body, close }
      closeButton.focus()
      return view
    }

    async function show(which, opts) {
      tab = which || tab
      const refresh = !!(opts && opts.refresh)
      /* 面板已打开（切换标签页）→ 复用现有面板重绘内容；只有真的没打开时才新建。
       * 复用避免了 ProductTools.open 每次都会关闭旧面板并重设焦点归还目标的问题。 */
      const existing = (view && view.mask && view.mask.isConnected) ? view : null
      const active = document.activeElement
      /* 实时刷新（账本事件触发的重绘）不得挪动焦点，否则后台完成一笔调用就会抢走用户焦点 */
      if (!refresh && (!existing || !existing.mask.contains(active))) {
        // 焦点在面板之外（首次打开，或从入口按钮重新打开）：记录归还目标，并把焦点移入面板
        returnFocus = active && active !== document.body ? active : null
        const closeButton = existing && existing.mask.querySelector('.product-close')
        if (closeButton) closeButton.focus()
      }
      const v = existing || open('用量与估计')
      /* 首次打开：先 await 同一账本就绪，再建立实时订阅（不抢先建独立账本） */
      await ready()
      subscribeRuntime()
      v.body.replaceChildren()
      const warn = persistenceWarning()
      if (warn) {
        const el = node('p', 'product-status error', warn)
        el.setAttribute('role', 'alert')
        v.body.append(el)
      }
      const tabs = node('div', 'product-tabs exp-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '体验工具视图')
      for (const [key, label] of [['usage', '用量与估计'], ['price', '模型报价'], ['tasks', '任务状态'], ['diag', '脱敏诊断']]) {
        const b = node('button', 'product-tab exp-tab', label)
        b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = key
        b.setAttribute('aria-selected', String(key === tab))
        b.tabIndex = key === tab ? 0 : -1
        b.addEventListener('click', () => { void show(key) })
        tabs.append(b)
      }
      const content = node('div', 'exp-content')
      v.body.append(tabs, content)
      if (tab === 'usage') await renderUsage(content)
      else if (tab === 'price') await renderPrice(content)
      else if (tab === 'tasks') renderTasks(content)
      else await renderDiag(content)
      return v
    }

    async function renderUsage(box) {
      await ready()
      const s = summarize()
      box.append(node('p', 'exp-hint', '「真实返回」只统计端点确实回传的用量与金额；「估计」由你填写的报价推算，两者分开标注。端点没返回的一律显示「未知」，不补 0。'))
      const cards = node('div', 'exp-cards')
      const card = (label, value, note, cls) => {
        const el = node('div', 'exp-card' + (cls ? ' ' + cls : ''))
        el.append(node('span', 'exp-card-label', label), node('strong', 'exp-card-value', value))
        if (note) el.append(node('small', 'exp-card-note', note))
        return el
      }
      if (!s) {
        box.append(node('p', 'product-status', '账本尚未就绪（engine/usage-ledger.js 未加载）'))
        return
      }
      cards.append(card('真实调用数', String(s.calls.total), '进行中 ' + s.calls.running + ' · 文本 ' + (s.calls.byKind.chat || 0) + ' · 图像 ' + (s.calls.byKind.image || 0)))
      cards.append(card('真实返回 token', numText(s.tokens.total), s.tokens.unknownEntries
        ? s.tokens.unknownEntries + ' 次未返回用量（按未知计）'
        : '输入 ' + numText(s.tokens.prompt) + ' / 输出 ' + numText(s.tokens.completion) + (s.tokens.derivedTotalEntries ? '（' + s.tokens.derivedTotalEntries + ' 次合计为推导）' : '')))
      cards.append(card('真实图片数', numText(s.images.count), s.images.unknownEntries ? s.images.unknownEntries + ' 次未返回图片数量' : '已知 ' + s.images.knownEntries + ' 次'))
      cards.append(card('真实累计费用', s.cost.known === null ? '未知' : money(s.cost.known, s.cost.currency),
        (s.cost.knownEntries ? '已知 ' + s.cost.knownEntries + ' 次' : '') + (s.cost.unknownEntries ? ' · 未知 ' + s.cost.unknownEntries + ' 次' : '') + (s.cost.provisionalEntries ? ' · ' + s.cost.provisionalEntries + ' 次可能仍计费' : ''), 'exp-card-real'))
      box.append(cards)
      if (s.cost.byCurrency && s.cost.byCurrency.length > 1) {
        const list = node('ul', 'exp-hint')
        for (const b of s.cost.byCurrency) list.append(node('li', '', (b.currency || '未知货币') + '：' + money(b.amount, b.currency) + '（' + b.entries + ' 次）'))
        box.append(list)
      }

      /* ---- 调用估计 ---- */
      box.append(node('h3', 'exp-sub', '单次调用估计（估计值）'))
      const form = node('form', 'exp-form')
      /* 数字输入：显式声明 min/step —— number 输入默认 step=1，单价这类小数会被浏览器判为无效而静默拦住提交 */
      const field = (label, placeholder, value, type, step) => {
        const wrap = node('label', 'exp-field', label)
        const input = node('input')
        input.type = type || 'text'; input.placeholder = placeholder || ''
        if (type === 'number') { input.min = '0'; input.step = step || 'any' }
        if (value !== undefined && value !== null) input.value = String(value)
        wrap.append(input); return wrap
      }
      const modelField = field('模型名（与调用时一致，用于取报价）', 'deepseek-chat', priceModel)
      const promptField = field('输入 token（留空则用最近真实平均）', '例如 8000', estTokens.prompt, 'number', '1')
      const completionField = field('输出 token（留空则用最近真实平均）', '例如 1200', estTokens.completion, 'number', '1')
      for (const el of [modelField, promptField, completionField]) form.append(el)
      const out = node('div', 'exp-card exp-card-est')
      const outLabel = node('span', 'exp-card-label', '估计单次费用')
      const outValue = node('strong', 'exp-card-value', '—')
      const outNote = node('small', 'exp-card-note', '')
      out.append(outLabel, outValue, outNote)
      const refresh = () => {
        const model = modelField.querySelector('input').value.trim()
        priceModel = model
        estTokens = { prompt: promptField.querySelector('input').value, completion: completionField.querySelector('input').value }
        const price = priceFor(model)
        const avg = averageUsage(entries(), 'chat')
        const est = estimateCallCost({
          kind: 'chat', price,
          promptTokens: estTokens.prompt === '' ? null : estTokens.prompt,
          completionTokens: estTokens.completion === '' ? null : estTokens.completion,
          average: avg
        })
        outValue.textContent = est.known ? money(est.amount, est.currency) : '未知'
        const basisText = est.basis === 'real-average' ? '按最近 ' + est.samples + ' 次真实返回的平均用量'
          : est.basis === 'manual' ? '按你填写的 token 数'
            : '缺少用量（可手填 token，或先产生真实调用）'
        const why = !est.known ? (est.reason === 'no-price' ? '（未填写该模型的报价）' : est.reason === 'usage-incomplete' ? '（输入/输出需成对）' : '') : ''
        outNote.textContent = basisText + why + (est.known && est.currency ? ' · 币种 ' + est.currency : '') + ' · 估计值，以提供商账单为准'
      }
      for (const el of [modelField, promptField, completionField]) el.querySelector('input').addEventListener('input', refresh)
      form.addEventListener('submit', (event) => event.preventDefault())
      box.append(form, out)
      refresh()

      /* ---- 漫画页数估计 ---- */
      box.append(node('h3', 'exp-sub', '漫画页数估计（估计值）'))
      /* 页数来源：父集成可注入 ctx.comic()（例如直接问漫画面板当前计划的页数），
       * 缺省则读 comic-panel 自己的偏好键 / 当前世界线回合数——不重复实现漫画逻辑 */
      let pages = null
      try {
        const injected = typeof c.comic === 'function' ? c.comic() : null
        if (injected && typeof injected === 'object' && finiteCount(injected.pages) !== null) {
          pages = { pages: finiteCount(injected.pages), mode: injected.mode || 'ai', source: 'comic' }
        }
      } catch { /* 注入源异常则回退到偏好键 */ }
      if (!pages) pages = comicPagesFromPrefs(readPref(), turnsOf(c.session))
      const imgModel = String((cfg() && (cfg().illustModel || '')) || '')
      const imgPrice = priceFor(imgModel)
      const pageField = field('页数', '例如 4', estPages === null ? (pages.pages === null ? '' : pages.pages) : estPages, 'number')
      const pageOut = node('div', 'exp-card exp-card-est')
      const pageValue = node('strong', 'exp-card-value', '—')
      const pageNote = node('small', 'exp-card-note', '')
      pageOut.append(node('span', 'exp-card-label', '估计生图费用'), pageValue, pageNote)
      const refreshPages = () => {
        estPages = pageField.querySelector('input').value
        const n = estPages === '' ? null : estPages
        const est = estimateComicCost({ pages: n, price: imgPrice })
        pageValue.textContent = est.known ? money(est.amount, est.currency) : '未知'
        const why = !est.known ? (est.reason === 'no-price' ? '（未填写图像模型报价）' : '（页数未知）') : ''
        pageNote.textContent = '来源：' + (pages.source === 'comic' ? '漫画面板当前计划' : pages.source === 'pref' ? '漫画面板偏好' : pages.source === 'turns' ? '当前世界线回合数（每回合一张）' : '未知')
          + (imgModel ? ' · 图像模型 ' + imgModel : ' · 图像模型未配置')
          + (est.minutes === null ? '' : ' · 约 ' + est.minutes + ' 分钟起') + why + ' · 估计值，以提供商账单为准'
      }
      pageField.querySelector('input').addEventListener('input', refreshPages)
      box.append(pageField, pageOut)
      refreshPages()
    }

    function turnsOf(sessionFn) {
      try {
        const s = typeof sessionFn === 'function' ? sessionFn() : null
        if (!s || !Array.isArray(s.messages)) return null
        const turns = s.messages.map((m) => Number(m.engineTurn)).filter((n) => Number.isFinite(n) && n > 0)
        return turns.length ? Math.max(...turns) : null
      } catch { return null }
    }

    async function renderPrice(box) {
      await ready()
      box.append(node('p', 'exp-hint', '填写你自己模型的单价（来自提供商定价页）。留空的分项保持「未知」，不会按 0 计算；文本模型需同时填输入与输出单价才会计价。'))
      const form = node('form', 'exp-form')
      /* 数字输入显式声明 min/step：number 默认 step=1，单价小数（如 0.04）会被浏览器判为无效并静默拦住提交 */
      const field = (label, placeholder, value, type) => {
        const wrap = node('label', 'exp-field', label)
        const input = node('input')
        input.type = type || 'text'; input.placeholder = placeholder || ''
        if (type === 'number') { input.min = '0'; input.step = 'any' }
        if (value !== undefined && value !== null) input.value = String(value)
        wrap.append(input); return wrap
      }
      const draft = priceDraft || {}
      const modelField = field('模型名（与调用时一致）', 'deepseek-chat', draft.model || priceModel)
      const currencyField = field('货币', 'CNY / USD', draft.currency || '')
      const inputField = field('输入单价（每百万 token）', '例如 1', draft.inputPerMTok, 'number')
      const outputField = field('输出单价（每百万 token）', '例如 2', draft.outputPerMTok, 'number')
      const imageField = field('图像单价（每张）', '例如 0.04', draft.imagePerUnit, 'number')
      for (const el of [modelField, currencyField, inputField, outputField, imageField]) form.append(el)
      const actions = node('div', 'product-actions')
      const saveBtn = node('button', 'primary', '保存报价')
      saveBtn.type = 'submit'
      actions.append(saveBtn)
      form.append(actions)
      const read = (wrap) => { const v = wrap.querySelector('input').value.trim(); return v === '' ? null : v }
      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        const key = read(modelField)
        if (!key) { toast('请填写模型名', 'err'); return }
        // 浏览器原生校验可能拦下非法数字（如负数）：给出可读提示，而不是静默无反应
        const invalid = [inputField, outputField, imageField].find((wrap) => !wrap.querySelector('input').checkValidity())
        if (invalid) { toast('单价必须是 0 或正数', 'err'); return }
        const r = await setPrice(key, {
          currency: read(currencyField), inputPerMTok: read(inputField),
          outputPerMTok: read(outputField), imagePerUnit: read(imageField)
        })
        if (r && r.ok && r.persisted !== false) {
          priceDraft = null; priceModel = key
          toast('报价已保存（留空项保持未知）', 'ok')
          void show('price')
        } else if (r && r.ok) {
          /* IPC 成功但主进程未落盘：保留草稿并明确「本地未保存」，绝不谎报已保存 */
          priceDraft = { model: key, currency: read(currencyField), inputPerMTok: read(inputField), outputPerMTok: read(outputField), imagePerUnit: read(imageField) }
          toast('报价仅保存在内存，本地记账未保存——重启后可能丢失', 'err')
          void show('price')
        } else {
          // 保存失败时保留草稿，避免玩家重填一遍
          priceDraft = { model: key, currency: read(currencyField), inputPerMTok: read(inputField), outputPerMTok: read(outputField), imagePerUnit: read(imageField) }
          toast('保存失败：' + ((r && r.error) || '未知错误'), 'err')
        }
      })
      box.append(form)
      const list = prices()
      box.append(node('h3', 'exp-sub', '已保存报价'))
      if (!list.length) { box.append(node('p', 'product-status', '尚未填写任何报价——费用与估计将显示为「未知」')); return }
      const table = node('table', 'exp-table')
      const head = node('thead'); const hr = node('tr')
      for (const t of ['模型', '货币', '输入/百万', '输出/百万', '图像/张', '操作']) hr.append(node('th', '', t))
      head.append(hr); table.append(head)
      const tbody = node('tbody')
      for (const item of list) {
        const p = normalizePrice(item.price)
        const tr = node('tr')
        tr.append(node('td', '', item.model))
        tr.append(node('td', '', p.currency || '未知'))
        tr.append(node('td', '', p.inputPerMTok === null ? '未知' : String(p.inputPerMTok)))
        tr.append(node('td', '', p.outputPerMTok === null ? '未知' : String(p.outputPerMTok)))
        tr.append(node('td', '', p.imagePerUnit === null ? '未知' : String(p.imagePerUnit)))
        const del = node('button', 'ghost', '删除')
        del.type = 'button'
        /* 删除报价：等待回执再反馈；失败绝不谎报成功。
         * 回执 ok 但本地未落盘（persisted=false）时如实提示「仅内存」。 */
        del.addEventListener('click', async () => {
          del.disabled = true
          const r = await removePrice(item.model)
          if (!r || r.ok !== true) { del.disabled = false; toast('删除失败：' + ((r && r.error) || '未知错误'), 'err'); return }
          if (r.persisted === false) toast('报价已从内存移除，但本地记账未保存——重启后可能仍在', 'err')
          else toast('报价已删除', 'ok')
          void show('price')
        })
        const td = node('td'); td.append(del); tr.append(td)
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
    }

    function renderTasks(box) {
      const s = summarize()
      const cards = node('div', 'exp-cards')
      const card = (label, value) => { const el = node('div', 'exp-card'); el.append(node('span', 'exp-card-label', label), node('strong', 'exp-card-value', value)); return el }
      const t = s ? s.tasks : { running: 0, succeeded: 0, failed: 0, partial: 0, aborted: 0 }
      cards.append(card('进行中', String(t.running)), card('完成', String(t.succeeded)), card('失败', String(t.failed)), card('部分返回', String(t.partial)), card('已中止', String(t.aborted)))
      box.append(cards)
      box.append(node('p', 'exp-hint', '失败、中止与部分返回单独标记；这些调用是否已计费由提供商决定，界面不代为判断。'))
      const rows = tasks().slice(-30).reverse()
      if (!rows.length) { box.append(node('p', 'product-status', '暂无任务')); return }
      const table = node('table', 'exp-table')
      const head = node('thead'); const hr = node('tr')
      for (const label of ['开始', '类型', '状态', '耗时']) hr.append(node('th', '', label))
      head.append(hr); table.append(head)
      const tbody = node('tbody')
      for (const row of rows) {
        const tr = node('tr')
        tr.append(node('td', '', row.startedAt ? new Date(row.startedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '未知'))
        tr.append(node('td', '', row.kind === 'image' ? '图像' : row.kind === 'chat' ? '文本' : String(row.kind || '未知')))
        tr.append(node('td', 'exp-status-' + row.status, statusLabel(row.status)))
        tr.append(node('td', '', row.durationMs === null || row.durationMs === undefined ? '—' : Math.round(row.durationMs) + ' ms'))
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
    }

    async function renderDiag(box) {
      box.append(node('p', 'exp-hint', '诊断包默认只含：应用版本、阶段（首次运行 / 已配置文本模型 / 已配置插图）、存储统计（世界线数、消息数、各类文件数量与字节数）与真实用量聚合数字。不含 API Key、模型名、端点地址、正文、错误原文或任何用户路径；导出前主进程会再做一次敏感内容自检。'))
      const actions = node('div', 'product-actions')
      const exportBtn = node('button', 'primary', '导出脱敏诊断包')
      exportBtn.type = 'button'
      const previewBtn = node('button', 'ghost', '预览将导出的内容')
      previewBtn.type = 'button'
      const extended = node('label', 'exp-field', '包含平台与布尔开关（扩展项）')
      const extendedInput = node('input'); extendedInput.type = 'checkbox'
      extended.append(extendedInput)
      const pre = node('pre', 'exp-pre')
      const status = node('p', 'product-status')
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true
        try { const r = await exportDiagnostics(extendedInput.checked); if (r && r.ok === false && !r.canceled) status.textContent = r.error || '' } finally { exportBtn.disabled = false }
      })
      previewBtn.addEventListener('click', async () => {
        const built = await buildDiagnostics(extendedInput.checked)
        if (built.ok) { pre.textContent = built.text; status.textContent = '' }
        else { pre.textContent = ''; status.className = 'product-status error'; status.textContent = built.error }
      })
      actions.append(exportBtn, previewBtn)
      const stats = await storageStats()
      box.append(actions, extended, status, pre)
      box.append(node('h3', 'exp-sub', '存储统计（只读，只回数量与字节）'))
      if (!stats) { box.append(node('p', 'product-status', '存储统计通道未接入（需主进程注册 experience:storage）')); return }
      const table = node('table', 'exp-table')
      const head = node('thead'); const hr = node('tr')
      for (const label of ['项目', '数值']) hr.append(node('th', '', label))
      head.append(hr); table.append(head)
      const tbody = node('tbody')
      const rows = [
        ['世界线数', stats.sessions], ['消息数', stats.messages], ['会话文件字节', stats.sessionBytes],
        ['插图文件数', stats.imageFiles], ['插图字节', stats.imageBytes],
        ['存档数', stats.archiveCount], ['存档文件数', stats.archiveFiles],
        ['世界记忆文件数', stats.storyFiles], ['快照文件数', stats.snapshotFiles], ['待补录文件数', stats.pendingFiles],
        ['日志文件数', stats.logFiles], ['记忆库字节', stats.memoryBytes],
        ['内核文件数', stats.kernelFiles], ['闪卡数', stats.holoCardCount]
      ]
      for (const [label, value] of rows) {
        const tr = node('tr')
        tr.append(node('td', '', label), node('td', '', numText(finiteCount(value))))
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
      box.append(node('p', 'exp-hint', '密钥文件存在：' + (stats.secretsPresent ? '是' : '否') + '（只报是否存在，不含内容）' +
        (stats.truncated ? ' · 统计达到扫描上限，已标记截断' : '')))
    }

    function mount(selector) {
      try {
        if (typeof document === 'undefined' || !document.body) return null
        if (document.getElementById('btn-experience-tools')) return document.getElementById('btn-experience-tools')
        /* 入口 1：工作台头部（经典 / 方案 D 可见；proto 方案用 CSS 隐藏 .chat-head-right，
         * 必须检测计算样式，否则按钮挂在被隐藏的容器里点不到）。 */
        const head = selector ? document.querySelector(selector) : document.querySelector('.chat-head-right')
        const headVisible = head && getComputedStyle(head).display !== 'none'
        if (headVisible) {
          const button = node('button', 'tool-btn', '用量与估计')
          button.id = 'btn-experience-tools'
          button.type = 'button'
          button.title = '真实用量与费用 / 单次调用与漫画页数估计 / 模型报价 / 任务状态 / 脱敏诊断导出'
          button.addEventListener('click', () => { void show('usage') })
          head.prepend(button)
          return button
        }
        /* 入口 2：会话栏底部（三套界面共有；头部隐藏时仍可用，与「存档 / 作者」入口同列） */
        const foot = document.querySelector('.sidebar-foot')
        if (foot) {
          const button = node('button', 'side-btn', '用量与估计')
          button.id = 'btn-experience-tools'
          button.type = 'button'
          button.title = '真实用量与费用 / 单次调用与漫画页数估计 / 模型报价 / 任务状态 / 脱敏诊断导出'
          button.addEventListener('click', () => { void show('usage') })
          foot.prepend(button)
          return button
        }
        return null
      } catch { return null }
    }

    ensureStyle()
    if (options.autoMount === true) {
      if (typeof document !== 'undefined' && document.body) mount(options.hostSelector)
      else if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => mount(options.hostSelector))
    }

    return {
      open: (which) => show(which),
      show, mount, ready, summarize, tasks, entries,
      prices, priceFor, setPrice, removePrice, averageUsage,
      persistenceWarning,
      buildDiagnostics, exportDiagnostics, noteError, storageStats,
      configFlags, buildDiagnosticsInput, comicPagesFromPrefs, deriveStage,
      ledger: () => ledger
    }
  }

  const ExperienceToolsApi = {
    create,
    ensureLedgerGlobal,
    ensureStyle,
    CSS_TEXT,
    LEDGER_LOCAL_KEY,
    COMIC_PREF_KEY,
    DIAG_CONFIG_KEYS,
    finiteNumber,
    finiteCount,
    normalizePrice,
    priceKnownFor,
    computeCost,
    estimateCallCost,
    estimateComicCost,
    averageUsage,
    comicPagesFromPrefs,
    configFlags,
    buildDiagnosticsInput,
    deriveStage,
    STAGES,
    money,
    numText
  }

  if (typeof window !== 'undefined') window.ExperienceTools = ExperienceToolsApi
  if (typeof module !== 'undefined' && module.exports) module.exports = ExperienceToolsApi
})()

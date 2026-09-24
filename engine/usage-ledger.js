'use strict'
/* 六面世界 · 运行时用量账本（纯模块：无 I/O、无 DOM；主进程与渲染层共用同一份实现，node 直测）
 *
 * 设计约束（产品评估 P1「费用、时延与生成任务透明化」）：
 *  - 未知一律记 null，绝不用 0 冒充：没有用量就是「未知」，没有报价也是「未知」。
 *  - 费用只在「端点真实返回的用量 + 用户自填报价」都具备时才计算；
 *    服务端直接返回 cost（usage.cost / data.cost）时优先采用，并标记 reason='service-cost'。
 *  - 失败 / 中止 / 部分返回（aborted / partial）明确标记 status，费用标记 provisional=true，
 *    不猜测已计费金额；完全没有用量时费用保持未知。
 *  - 任务 start/finish 支持并发与乱序完成：id 唯一，互不串账；重复 finish 返回 ok:false。
 *  - 诊断导出 buildDiagnosticsReport 只白名单「版本 / 平台 / 布尔配置 / 统计数字」；
 *    正文、密钥、模型名、端点、自由文本、用户路径一律不进（scanForSensitive 可独立验证）。
 *
 * 主进程 / preload 接入：优先用 engine/runtime-service.cjs（封装 IPC 注册、落盘与记账），
 * 它注册的通道与本文件下方注释一致；缺失可选 IPC 时 UI 自动退回本地存储：
 *   ipcMain.handle('runtime:ledger-load', () => ({ ok: true, data: ledger.toJSON() }))
 *   ipcMain.handle('runtime:ledger-save', (_e, data) => { const r = ledger.load(data); return { ok: r.ok, entries: r.entries, skipped: r.skipped } })
 *   ipcMain.handle('runtime:diagnostics-info', () => ({ ok: true, version, platform, arch, config: { 布尔项 } }))
 *   ipcMain.handle('runtime:diagnostics-save', (_e, payload) => ({ ok: true, path }))
 *   preload：runtimeLedgerLoad / runtimeLedgerSave / runtimeDiagnosticsInfo / runtimeDiagnosticsSave
 *
 * 调用点（chat:send / image:generate 已返回 usage 与 cost）：
 *   const h = ledger.start({ kind: 'chat', model, label: reqId })
 *   ledger.finish(h, { ok: true, usage: result.usage, status: result.aborted ? 'aborted' : 'succeeded' })
 *   const hi = ledger.start({ kind: 'image', model })
 *   ledger.finish(hi, { ok: true, images: 1, usage: result.usage, cost: result.cost })
 *
 * 生成前估算（「调用/页数估计」）：estimatePlan({ pages, imagesPerPage, chatCalls,
 * promptTokensPerCall, completionTokensPerCall, price }) 只做算术——调用次数、每次 token 与报价
 * 全部来自用户；缺任何一项即该部分未知，总额只在所有「已给次数的部分」都能计价时才给出。
 * 不联网、不读配置、不按经验值补数。
 */

const LEDGER_SCHEMA = 'sixworlds.usage-ledger.v1'
const DIAGNOSTICS_SCHEMA = 'sixworlds.diagnostics.v1'
const MAX_ENTRIES = 2000
const TASK_STATES = ['running', 'succeeded', 'failed', 'partial', 'aborted']

/* 诊断导出允许出现的布尔配置键（白名单；其余键一律丢弃） */
const DIAG_CONFIG_KEYS = [
  'hasTextKey', 'hasIllustKey', 'illustEnabled', 'autoIllust', 'skipSplash',
  'petModelReady', 'embedderConfigured', 'thinkingEnabled', 'customEndpoint',
  'reducedMotion', 'highContrast', 'diagnosticsOptIn'
]

/* ---- 基础数值工具：null / '' / undefined / NaN 一律视为「未知」，绝不折算为 0 ---- */
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

/* ---- 报价：用户自填。未填写的分项保持 null（未知），不是 0 ----
 * 负数是无效报价（不是「便宜」），一律按未知处理，避免算出负费用。 */
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
  const currency = typeof p.currency === 'string' && p.currency.trim() ? p.currency.trim().slice(0, 8) : null
  return {
    currency,
    inputPerMTok: pick('inputPerMTok', 'input', 'promptPerMTok', 'prompt'),
    outputPerMTok: pick('outputPerMTok', 'output', 'completionPerMTok', 'completion'),
    imagePerUnit: pick('imagePerUnit', 'image', 'perImage'),
    perCall: pick('perCall'),
    source: 'user'
  }
}

/* 某类调用是否有可用报价（文本需输入+输出两侧齐全才算已知） */
function priceKnownFor(kind, price) {
  const p = normalizePrice(price)
  if (String(kind) === 'image') return p.imagePerUnit !== null
  return p.inputPerMTok !== null && p.outputPerMTok !== null
}

/* ---- 用量归一：只读取端点真实返回的字段 ---- */
function normalizeUsage(raw) {
  const empty = { present: false, source: 'none', hasTokens: false, prompt: null, completion: null, total: null, derivedTotal: false, cost: null }
  if (!raw || typeof raw !== 'object') return empty
  const prompt = finiteCount(raw.prompt_tokens !== undefined ? raw.prompt_tokens : raw.prompt)
  const completion = finiteCount(raw.completion_tokens !== undefined ? raw.completion_tokens : raw.completion)
  const rawTotal = finiteCount(raw.total_tokens !== undefined ? raw.total_tokens : raw.total)
  const cost = finiteNumber(raw.cost !== undefined ? raw.cost : raw.total_cost)
  // 仅当两侧都真实返回时才推导合计（derivedTotal 标记，便于 UI 说明来源）
  const total = rawTotal !== null ? rawTotal : (prompt !== null && completion !== null ? prompt + completion : null)
  return {
    present: true,
    source: 'service',
    hasTokens: prompt !== null || completion !== null || rawTotal !== null,
    prompt,
    completion,
    total,
    derivedTotal: rawTotal === null && total !== null,
    cost
  }
}

/* ---- 费用计算：任一必要项未知 → amount=null 且 known=false（明确未知） ----
 * 负数（服务端返回或报价）视为无效数据，不参与计价。 */
function computeCost(options) {
  const o = options || {}
  const kind = String(o.kind || 'chat')
  const price = normalizePrice(o.price)
  const usage = o.usage && typeof o.usage === 'object' && 'present' in o.usage ? o.usage : normalizeUsage(o.usage)
  const images = finiteCount(o.images !== undefined ? o.images : o.imageCount)
  const rawServiceCost = finiteNumber(o.serviceCost !== undefined ? o.serviceCost : usage.cost)
  const serviceCost = rawServiceCost !== null && rawServiceCost >= 0 ? rawServiceCost : null
  const currency = price.currency || (typeof o.currency === 'string' && o.currency.trim() ? o.currency.trim().slice(0, 8) : null)
  if (serviceCost !== null) return { amount: serviceCost, currency, known: true, reason: 'service-cost' }
  if (kind === 'image') {
    if (images === null) return { amount: null, currency: price.currency, known: false, reason: 'no-image-count' }
    if (price.imagePerUnit === null) return { amount: null, currency: price.currency, known: false, reason: 'no-price' }
    return knownAmount(round6(images * price.imagePerUnit), price.currency, 'computed')
  }
  if (!usage.hasTokens) return { amount: null, currency: price.currency, known: false, reason: 'no-usage' }
  if (price.inputPerMTok === null || price.outputPerMTok === null) return { amount: null, currency: price.currency, known: false, reason: 'no-price' }
  if (usage.prompt === null || usage.completion === null) return { amount: null, currency: price.currency, known: false, reason: 'usage-incomplete' }
  return knownAmount(round6((usage.prompt / 1e6) * price.inputPerMTok + (usage.completion / 1e6) * price.outputPerMTok), price.currency, 'computed')
}

/* 计算结果必须是有限数才算「已知」：溢出 / NaN 会以 Infinity 混进账本，
 * 序列化后变成 null、界面上变成 "Infinity"，比「未知」更糟。 */
function knownAmount(amount, currency, reason) {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount < 0) {
    return { amount: null, currency: currency || null, known: false, reason: 'invalid-amount' }
  }
  return { amount, currency: currency || null, known: true, reason }
}

/* 乘法护栏：结果必须是有限数，否则按未知处理（避免 Infinity / NaN 混进估算与账本） */
function finiteProduct(a, b) {
  const x = finiteNumber(a), y = finiteNumber(b)
  if (x === null || y === null) return null
  const product = x * y
  return Number.isFinite(product) ? product : null
}

/* ---- 生成前估算（「调用 / 页数估计」）----
 * 输入全部来自用户：页数、每页图片数、文本调用次数、每次调用的 token 数、用户自填报价。
 * 规则与记账一致：任何一项没给 → 对应部分为 null（未知），绝不按 0 或经验值补；
 * 只有每个「有调用次数」的部分都能计价时，总额才算已知（否则 reason='partial-price'）。
 * 本函数不联网、不读配置、不猜 token：调用方给多少就用多少。 */
function estimatePlan(input) {
  const i = input && typeof input === 'object' ? input : {}
  const price = normalizePrice(i.price)
  const currency = price.currency
  const pages = finiteCount(i.pages)
  const imagesPerPageRaw = i.imagesPerPage === undefined || i.imagesPerPage === null ? 1 : finiteCount(i.imagesPerPage)
  const chatCalls = finiteCount(i.chatCalls !== undefined ? i.chatCalls : i.calls)
  const imageCallsGiven = finiteCount(i.imageCalls)
  const promptPerCall = finiteCount(i.promptTokensPerCall)
  const completionPerCall = finiteCount(i.completionTokensPerCall)

  const notes = []
  // 图片调用次数：显式给了就用显式的；否则由「页数 × 每页张数」推导（并注明是推导值）
  let imageCalls = imageCallsGiven
  let imageCallsDerived = false
  if (imageCalls === null && pages !== null && imagesPerPageRaw !== null) {
    imageCalls = finiteProduct(pages, imagesPerPageRaw)
    imageCallsDerived = imageCalls !== null
    if (imageCalls !== null) notes.push('图片调用次数由「页数 × 每页张数」推导')
    else notes.push('页数 × 每页张数超出可计算范围，图片调用次数按未知处理')
  }
  if (pages !== null && imageCallsGiven === null && imageCallsDerived === false && imageCalls === null) notes.push('页数已给出但每页张数未知，无法推导图片调用次数')

  const parts = []

  /* 文本部分 */
  {
    const calls = chatCalls
    const promptTokens = calls !== null && promptPerCall !== null ? finiteProduct(calls, promptPerCall) : null
    const completionTokens = calls !== null && completionPerCall !== null ? finiteProduct(calls, completionPerCall) : null
    const tokens = {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens !== null && completionTokens !== null ? finiteProduct(1, promptTokens + completionTokens) : null
    }
    let cost
    if (calls === null) cost = { amount: null, currency, known: false, reason: 'no-calls' }
    else if (tokens.total === null) cost = { amount: null, currency, known: false, reason: 'no-tokens' }
    else if (!priceKnownFor('chat', price)) cost = { amount: null, currency, known: false, reason: 'no-price' }
    else cost = knownAmount(round6((tokens.prompt / 1e6) * price.inputPerMTok + (tokens.completion / 1e6) * price.outputPerMTok), currency, 'computed')
    parts.push({ kind: 'chat', calls, tokens, cost })
  }

  /* 图片部分 */
  {
    const calls = imageCalls
    let cost
    if (calls === null) cost = { amount: null, currency, known: false, reason: 'no-calls' }
    else if (price.imagePerUnit === null) cost = { amount: null, currency, known: false, reason: 'no-price' }
    else {
      // 先做乘法护栏：round6(null) 会得到 0，必须先确认乘积是有限数
      const amount = finiteProduct(calls, price.imagePerUnit)
      cost = amount === null
        ? { amount: null, currency, known: false, reason: 'invalid-amount' }
        : knownAmount(round6(amount), currency, 'computed')
    }
    parts.push({ kind: 'image', calls, tokens: { prompt: null, completion: null, total: null }, cost })
  }

  /* 总额：所有「已给出调用次数」的部分都已知才合计；
   * 有未知部分时，reason 直接沿用该部分的未知原因（界面据此给出准确说明）。 */
  const billable = parts.filter((p) => p.calls !== null && p.calls > 0)
  const unknown = billable.filter((p) => !p.cost.known)
  let total
  if (!billable.length) total = { amount: null, currency, known: false, reason: 'no-calls' }
  else if (unknown.length) total = { amount: null, currency, known: false, reason: unknown[0].cost.reason || 'partial-unknown' }
  else {
    const sum = billable.reduce((acc, p) => acc + p.cost.amount, 0)
    total = knownAmount(round6(sum), currency, 'computed')
  }
  if (unknown.length) notes.push('有 ' + unknown.length + ' 个部分无法计价，总额保持未知')
  if (currency === null && billable.length) notes.push('未填写货币，金额不带币种')

  return {
    ok: true,
    pages,
    imagesPerPage: imagesPerPageRaw,
    imageCallsDerived,
    parts,
    chatCalls,
    imageCalls,
    total,
    notes
  }
}

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase()
  return TASK_STATES.includes(s) && s !== 'running' ? s : 'succeeded'
}

/* 调用方附带的 meta：只保留一层原始值并截断；密钥、URL、路径、疑似正文一律丢弃。
 * 账本可能被导出，因此这里与诊断导出用同一套敏感规则（宁可少记，不可泄漏）。
 * 原型链键名（__proto__ / constructor / prototype）一并丢弃：它们在普通对象上赋值会改到原型。 */
const META_KEY_DENY_RE = /^(__proto__|constructor|prototype|api[-_]?key|apikey|authorization|password|secret|token|baseurl|base_url|endpoint|prompt|content|text|path|file|message|body|error)$/i
const META_VALUE_DENY_RES = [/sk-[A-Za-z0-9_-]{6,}/i, /https?:\/\//i, /[A-Za-z]:[\\/]/, /\/(?:Users|home|root)\//i]
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {}
  // 无原型容器：即使键名漏网也不会写到 Object.prototype 上
  const out = Object.create(null)
  let n = 0
  for (const key of Object.keys(meta)) {
    if (n >= 12) break
    const name = String(key).slice(0, 24)
    if (META_KEY_DENY_RE.test(name)) continue
    const v = meta[key]
    if (v === null || v === undefined) continue
    if (typeof v === 'number') { if (Number.isFinite(v)) { out[name] = v; n++ } continue }
    if (typeof v === 'boolean') { out[name] = v; n++; continue }
    if (typeof v === 'string') {
      if (META_VALUE_DENY_RES.some((re) => re.test(v))) continue
      out[name] = v.slice(0, 80)
      n++
    }
  }
  return out
}

/* 载入的条目来自磁盘（可能被手工编辑或损坏）：逐条重建为受控形状，
 * 非法条目直接丢弃；meta 重新过一遍敏感过滤，避免旧文件把密钥/路径带回来。 */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : null
  if (!id) return null
  /* tokens 是「已归一」形状（prompt/completion/total + present/derivedTotal 语义），
   * 不是端点原始 usage 形状：这里必须重建 present 与 derivedTotal，否则重载后
   * 「有用量」与「合计由两侧推导」两项语义会丢失（tokensUnknown 误计、derivedTotal 归零）。 */
  const usage = normalizeUsage(raw.tokens ? {
    prompt_tokens: raw.tokens.prompt,
    completion_tokens: raw.tokens.completion,
    total_tokens: raw.tokens.derivedTotal === true ? undefined : raw.tokens.total
  } : null)
  // 无原始 total 但两侧齐全 → 重新推导合计并标记 derivedTotal
  if (raw.tokens && raw.tokens.present === true && !usage.hasTokens && (usage.prompt !== null || usage.completion !== null)) {
    usage.present = true
    usage.hasTokens = true
  }
  if (raw.tokens && raw.tokens.present === true && usage.total === null && usage.prompt !== null && usage.completion !== null) {
    usage.total = usage.prompt + usage.completion
    usage.derivedTotal = true
  }
  const rawCost = raw.cost && typeof raw.cost === 'object' ? raw.cost : null
  const amount = rawCost ? finiteNumber(rawCost.amount) : null
  const cost = {
    amount: amount !== null && amount >= 0 ? amount : null,
    currency: rawCost && typeof rawCost.currency === 'string' ? rawCost.currency.slice(0, 8) : null,
    known: !!(rawCost && rawCost.known === true && amount !== null && amount >= 0),
    reason: rawCost && typeof rawCost.reason === 'string' ? rawCost.reason.slice(0, 24) : 'unknown',
    provisional: !!(rawCost && rawCost.provisional === true)
  }
  if (!cost.known) cost.amount = null
  const startedAt = finiteNumber(raw.startedAt)
  const finishedAt = finiteNumber(raw.finishedAt)
  return {
    id,
    kind: typeof raw.kind === 'string' ? raw.kind.slice(0, 24) : 'chat',
    model: typeof raw.model === 'string' ? raw.model.slice(0, 80) : '',
    label: typeof raw.label === 'string' ? raw.label.slice(0, 80) : '',
    status: TASK_STATES.includes(raw.status) && raw.status !== 'running' ? raw.status : 'succeeded',
    startedAt: startedAt !== null ? startedAt : 0,
    finishedAt: finishedAt !== null ? finishedAt : (startedAt !== null ? startedAt : 0),
    durationMs: finiteCount(raw.durationMs) || 0,
    usageSource: usage.source,
    tokens: { prompt: usage.prompt, completion: usage.completion, total: usage.total, derivedTotal: usage.derivedTotal, present: usage.hasTokens },
    images: finiteCount(raw.images),
    cost,
    errorCode: typeof raw.errorCode === 'string' ? raw.errorCode.slice(0, 24) : null,
    meta: sanitizeMeta(raw.meta)
  }
}

/* ---- 账本实例 ---- */
function createLedger(options) {
  const o = options || {}
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  const idPrefix = String(o.idPrefix || 'RUN').slice(0, 12)
  const maxEntries = finiteNumber(o.maxEntries) !== null ? Math.max(50, finiteNumber(o.maxEntries)) : MAX_ENTRIES

  const prices = new Map()
  const inflight = new Map()
  let entries = []
  let dropped = 0
  let seq = 0

  function nextId() { seq += 1; return idPrefix + '-' + seq.toString(36) + '-' + Math.random().toString(36).slice(2, 6) }

  function setPrice(modelKey, price) {
    const key = String(modelKey || '').trim()
    if (!key) return { ok: false, error: 'empty-model' }
    prices.set(key, normalizePrice(price))
    return { ok: true, price: prices.get(key) }
  }
  function removePrice(modelKey) { return prices.delete(String(modelKey || '').trim()) }
  function getPrice(modelKey) { return prices.get(String(modelKey || '').trim()) || null }
  function listPrices() { return [...prices.entries()].map(([model, price]) => ({ model, price })) }

  function start(input) {
    const i = input || {}
    const handle = {
      id: nextId(),
      kind: String(i.kind || 'chat'),
      model: String(i.model || ''),
      label: String(i.label || '').slice(0, 80),
      startedAt: now(),
      status: 'running'
    }
    inflight.set(handle.id, handle)
    return Object.assign({}, handle)
  }

  function resolveId(handleOrId) {
    if (!handleOrId) return null
    const id = typeof handleOrId === 'string' ? handleOrId : String(handleOrId.id || '')
    return id || null
  }

  function finish(handleOrId, result) {
    const id = resolveId(handleOrId)
    const task = id ? inflight.get(id) : null
    if (!task) return { ok: false, error: 'unknown-task' }
    inflight.delete(id)
    const r = result || {}
    const usage = normalizeUsage(r.usage)
    const images = finiteCount(r.images !== undefined ? r.images : r.imageCount)
    let status = normalizeStatus(r.status)
    if (!r.status) {
      if (r.aborted === true) status = 'aborted'
      else if (r.partial === true) status = 'partial'
      else if (r.ok === false) status = 'failed'
    }
    const cost = computeCost({ kind: task.kind, price: getPrice(task.model), usage, images, serviceCost: r.cost })
    if ((status === 'failed' || status === 'partial' || status === 'aborted') && cost.known) cost.provisional = true
    const finishedAt = now()
    const entry = {
      id: task.id,
      kind: task.kind,
      model: task.model,
      label: task.label,
      status,
      startedAt: task.startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - task.startedAt),
      usageSource: usage.source,
      tokens: { prompt: usage.prompt, completion: usage.completion, total: usage.total, derivedTotal: usage.derivedTotal, present: usage.hasTokens },
      images,
      cost,
      errorCode: typeof r.errorCode === 'string' ? r.errorCode.slice(0, 24) : null,
      meta: sanitizeMeta(r.meta)
    }
    push(entry)
    return { ok: true, entry }
  }

  function record(input) {
    const i = input || {}
    const kind = String(i.kind || 'chat')
    const model = String(i.model || '')
    const usage = normalizeUsage(i.usage)
    const images = finiteCount(i.images !== undefined ? i.images : i.imageCount)
    const status = normalizeStatus(i.status || (i.ok === false ? 'failed' : 'succeeded'))
    const cost = computeCost({ kind, price: getPrice(model), usage, images, serviceCost: i.cost })
    if ((status === 'failed' || status === 'partial' || status === 'aborted') && cost.known) cost.provisional = true
    const at = now()
    const entry = {
      id: String(i.id || nextId()),
      kind,
      model,
      label: String(i.label || '').slice(0, 80),
      status,
      startedAt: finiteNumber(i.startedAt) !== null ? finiteNumber(i.startedAt) : at,
      finishedAt: at,
      durationMs: finiteNumber(i.durationMs) !== null ? finiteNumber(i.durationMs) : 0,
      usageSource: usage.source,
      tokens: { prompt: usage.prompt, completion: usage.completion, total: usage.total, derivedTotal: usage.derivedTotal, present: usage.hasTokens },
      images,
      cost,
      errorCode: typeof i.errorCode === 'string' ? i.errorCode.slice(0, 24) : null,
      meta: sanitizeMeta(i.meta)
    }
    push(entry)
    return { ok: true, entry }
  }

  function cancel(handleOrId) {
    const id = resolveId(handleOrId)
    if (!id || !inflight.has(id)) return { ok: false, error: 'unknown-task' }
    return finish(id, { ok: false, aborted: true, status: 'aborted' })
  }

  function push(entry) {
    entries.push(entry)
    if (entries.length > maxEntries) { dropped += entries.length - maxEntries; entries = entries.slice(entries.length - maxEntries) }
    return entry
  }

  function tasks() {
    const running = [...inflight.values()].map((t) => ({ id: t.id, kind: t.kind, model: t.model, label: t.label, status: 'running', startedAt: t.startedAt, finishedAt: null, durationMs: null }))
    const done = entries.map((e) => ({ id: e.id, kind: e.kind, model: e.model, label: e.label, status: e.status, startedAt: e.startedAt, finishedAt: e.finishedAt, durationMs: e.durationMs }))
    return running.concat(done)
  }

  /* 汇总：已知量才累加；未知单独计数（UI 显示「未知」而不是 0） */
  // 计数键来自账目字段（kind / status / currency 可能被磁盘数据污染），过滤危险键名
  const UNSAFE_KEY_RE = /^(__proto__|constructor|prototype)$/
  function bump(map, key) {
    if (!key || UNSAFE_KEY_RE.test(key)) return
    map[key] = (map[key] || 0) + 1
  }
  function summarize() {
    const byKind = {}
    const byStatus = {}
    let prompt = 0, completion = 0, total = 0
    let tokensKnown = 0, tokensUnknown = 0, derivedTotal = 0
    let images = 0, imagesKnown = 0, imagesUnknown = 0
    const byCurrency = {}
    let costKnownEntries = 0, costUnknownEntries = 0, costProvisionalEntries = 0, serviceCostEntries = 0
    for (const e of entries) {
      bump(byKind, e.kind)
      bump(byStatus, e.status)
      if (e.tokens.present) {
        tokensKnown++
        prompt += e.tokens.prompt || 0
        completion += e.tokens.completion || 0
        total += e.tokens.total || 0
        if (e.tokens.derivedTotal) derivedTotal++
      } else tokensUnknown++
      if (e.kind === 'image' || e.images !== null) {
        if (e.images === null) imagesUnknown++
        else { imagesKnown++; images += e.images }
      }
      if (e.cost.known) {
        costKnownEntries++
        if (e.cost.provisional) costProvisionalEntries++
        if (e.cost.reason === 'service-cost') serviceCostEntries++
        const cur = e.cost.currency || 'unknown'
        // 币种来自磁盘数据：危险键名跳过（正常币种已被截断为 8 字符，这里只是兜底）
        if (!UNSAFE_KEY_RE.test(cur)) {
          if (!Object.prototype.hasOwnProperty.call(byCurrency, cur)) byCurrency[cur] = { currency: cur, amount: 0, entries: 0 }
          byCurrency[cur].amount = round6(byCurrency[cur].amount + e.cost.amount)
          byCurrency[cur].entries++
        }
      } else costUnknownEntries++
    }
    const buckets = Object.values(byCurrency).sort((a, b) => b.entries - a.entries)
    const primary = buckets[0] || null
    return {
      schema: LEDGER_SCHEMA,
      entries: entries.length,
      dropped,
      calls: { total: entries.length, byKind, byStatus, running: inflight.size },
      tokens: {
        prompt, completion, total,
        knownEntries: tokensKnown, unknownEntries: tokensUnknown, derivedTotalEntries: derivedTotal
      },
      images: { count: images, knownEntries: imagesKnown, unknownEntries: imagesUnknown },
      cost: {
        known: primary ? primary.amount : null,
        currency: primary ? primary.currency : null,
        knownEntries: costKnownEntries,
        unknownEntries: costUnknownEntries,
        provisionalEntries: costProvisionalEntries,
        serviceCostEntries,
        byCurrency: buckets,
        mixedCurrency: buckets.length > 1
      },
      tasks: {
        running: inflight.size,
        succeeded: byStatus.succeeded || 0,
        failed: byStatus.failed || 0,
        partial: byStatus.partial || 0,
        aborted: byStatus.aborted || 0
      }
    }
  }

  function toJSON() {
    const priceMap = {}
    for (const [model, price] of prices) priceMap[model] = price
    return { schema: LEDGER_SCHEMA, savedAt: now(), seq, dropped, prices: priceMap, entries: entries.slice() }
  }

  function load(data) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'invalid-data' }
    if (data.schema && data.schema !== LEDGER_SCHEMA) return { ok: false, error: 'schema-mismatch' }
    prices.clear()
    const src = data.prices && typeof data.prices === 'object' ? data.prices : {}
    for (const model of Object.keys(src)) prices.set(String(model), normalizePrice(src[model]))
    const rawEntries = Array.isArray(data.entries) ? data.entries : []
    const rebuilt = []
    let skipped = 0
    for (const raw of rawEntries) {
      const entry = normalizeEntry(raw)
      if (entry) rebuilt.push(entry); else skipped++
    }
    entries = rebuilt.slice(-maxEntries)
    dropped = (finiteNumber(data.dropped) || 0) + skipped + Math.max(0, rebuilt.length - entries.length)
    seq = finiteNumber(data.seq) || 0
    return { ok: true, entries: entries.length, skipped }
  }

  function reset() { entries = []; dropped = 0; inflight.clear() }

  return {
    setPrice, getPrice, removePrice, listPrices, priceKnownFor,
    start, finish, record, cancel, tasks, summarize,
    entries: () => entries.slice(),
    running: () => [...inflight.values()].map((t) => Object.assign({}, t)),
    toJSON, load, reset
  }
}

/* ---- 诊断导出：白名单取值 + 敏感内容自检 ---- */

/* 版本 / 平台 / 架构等短标识：路径、URL、密钥、邮箱一律拒绝 */
function safeToken(value, max) {
  const raw = String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!raw) return null
  if (/[\\/]/.test(raw)) return 'redacted'
  if (/sk-[A-Za-z0-9_-]{6,}/i.test(raw)) return 'redacted'
  if (/https?:/i.test(raw)) return 'redacted'
  if (/@/.test(raw)) return 'redacted'
  const limit = finiteNumber(max) || 40
  return raw.length > limit ? raw.slice(0, limit) : raw
}

function pickNumber(obj, path) {
  let cur = obj
  for (const key of path) { if (!cur || typeof cur !== 'object') return null; cur = cur[key] }
  return finiteCount(cur)
}

/* 独立可测：只输出 版本 / 平台 / 布尔配置 / 统计数字 */
function buildDiagnosticsReport(input) {
  const src = input && typeof input === 'object' ? input : {}
  const flags = src.config && typeof src.config === 'object' ? src.config : {}
  const config = {}
  for (const key of DIAG_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) config[key] = flags[key] === true
  }
  const summary = src.summary && typeof src.summary === 'object'
    ? src.summary
    : (src.ledger && typeof src.ledger.summarize === 'function' ? src.ledger.summarize() : null)
  const stats = {}
  if (summary) {
    stats.totalCalls = pickNumber(summary, ['calls', 'total'])
    stats.runningTasks = pickNumber(summary, ['calls', 'running'])
    stats.chatCalls = pickNumber(summary, ['calls', 'byKind', 'chat'])
    stats.imageCalls = pickNumber(summary, ['calls', 'byKind', 'image'])
    stats.failedCalls = pickNumber(summary, ['calls', 'byStatus', 'failed'])
    stats.partialCalls = pickNumber(summary, ['calls', 'byStatus', 'partial'])
    stats.abortedCalls = pickNumber(summary, ['calls', 'byStatus', 'aborted'])
    stats.promptTokens = pickNumber(summary, ['tokens', 'prompt'])
    stats.completionTokens = pickNumber(summary, ['tokens', 'completion'])
    stats.totalTokens = pickNumber(summary, ['tokens', 'total'])
    stats.usageUnknownCalls = pickNumber(summary, ['tokens', 'unknownEntries'])
    stats.imageCount = pickNumber(summary, ['images', 'count'])
    stats.costKnownEntries = pickNumber(summary, ['cost', 'knownEntries'])
    stats.costUnknownEntries = pickNumber(summary, ['cost', 'unknownEntries'])
    stats.costProvisionalEntries = pickNumber(summary, ['cost', 'provisionalEntries'])
    stats.ledgerEntries = pickNumber(summary, ['entries'])
  }
  const generatedAt = typeof src.generatedAt === 'string' && src.generatedAt ? src.generatedAt : new Date(0).toISOString()
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt,
    app: {
      version: safeToken(src.version),
      platform: safeToken(src.platform),
      arch: safeToken(src.arch)
    },
    config,
    stats
  }
}

const SENSITIVE_KEY_RE = /^(api[-_]?key|apikey|authorization|password|secret|token|baseurl|base_url|endpoint|model|prompt|content|text|path|file|message|error)$/i
const SENSITIVE_VALUE_RES = [
  { reason: 'api-key', re: /sk-[A-Za-z0-9_-]{10,}/i },
  { reason: 'url', re: /https?:\/\//i },
  { reason: 'windows-path', re: /[A-Za-z]:[\\/]/ },
  { reason: 'user-path', re: /\/(?:Users|home|root)\//i },
  { reason: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { reason: 'long-text', re: /^[\s\S]{200,}$/ }
]

/* 独立可测：扫描对象里是否出现密钥 / URL / 路径 / 邮箱 / 长自由文本 */
function scanForSensitive(value, path) {
  const found = []
  const walk = (node, trail) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, trail + '[' + i + ']')); return }
    if (typeof node === 'object') {
      for (const key of Object.keys(node)) {
        if (SENSITIVE_KEY_RE.test(key)) found.push({ path: trail + '.' + key, reason: 'sensitive-key' })
        walk(node[key], trail + '.' + key)
      }
      return
    }
    if (typeof node !== 'string') return
    for (const rule of SENSITIVE_VALUE_RES) {
      if (rule.re.test(node)) { found.push({ path: trail, reason: rule.reason }); return }
    }
  }
  walk(value, path || '$')
  return found
}

/* 导出面：浏览器 classic script 下不能用顶层 const api —— 预加载脚本已通过 contextBridge
 * 在全局对象上定义了不可配置的 window.api，同名顶层声明会抛 SyntaxError。 */
const UsageLedgerApi = {
  LEDGER_SCHEMA,
  DIAGNOSTICS_SCHEMA,
  MAX_ENTRIES,
  TASK_STATES,
  DIAG_CONFIG_KEYS,
  finiteNumber,
  finiteCount,
  normalizePrice,
  priceKnownFor,
  normalizeUsage,
  computeCost,
  estimatePlan,
  createLedger,
  buildDiagnosticsReport,
  scanForSensitive,
  safeToken
}

if (typeof module !== 'undefined' && module.exports) module.exports = UsageLedgerApi
if (typeof window !== 'undefined') window.UsageLedger = UsageLedgerApi

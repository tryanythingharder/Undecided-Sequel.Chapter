'use strict'
/* 运行时工具与用量账本自动化测试（无网络、无 Electron、无收费模型调用）
 * 运行：node scripts-dev/test-runtime-tools.cjs
 * 覆盖：报价未知 / 真实 usage 费用 / 无 usage 不伪造 / 并发与乱序完成 /
 *       失败与部分返回的未知计费 / 图片按张计价 / 多货币不合并 /
 *       诊断导出白名单与敏感数据不泄露 / 共享入口（ui/shared/runtime-tools.js）行为 /
 *       向导离线示例与连接测试反馈的源码契约。
 * 临时产物只写在 output/runtime-tools-tests 下。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
// 临时产物只写在 output/runtime-tools-tests 下的 unit 子目录（不触碰同目录内的其它探针文件）
const tmp = path.join(root, 'output', 'runtime-tools-tests', 'unit')
fs.rmSync(tmp, { recursive: true, force: true })
fs.mkdirSync(tmp, { recursive: true })

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + '  << ' + (extra === undefined ? '' : JSON.stringify(extra)).slice(0, 400)) }
}

const ledger = require('../engine/usage-ledger')
const { createLedger, computeCost, normalizeUsage, normalizePrice, priceKnownFor, estimatePlan, buildDiagnosticsReport, scanForSensitive, LEDGER_SCHEMA, DIAGNOSTICS_SCHEMA } = ledger

/* ============ 1. 报价未知：未知就是未知，绝不折算为 0 ============ */
{
  const l = createLedger({ idPrefix: 'T1' })
  const h = l.start({ kind: 'chat', model: 'unknown-model' })
  const r = l.finish(h, { ok: true, usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } })
  check('t1: 未填报价时费用为 null（未知）', r.entry.cost.amount === null && r.entry.cost.known === false, r.entry.cost)
  check('t1: 未知原因标注为 no-price', r.entry.cost.reason === 'no-price', r.entry.cost)
  check('t1: 真实 token 照常入账（不因报价缺失而丢）', r.entry.tokens.prompt === 1000 && r.entry.tokens.completion === 500 && r.entry.tokens.total === 1500)
  const s = l.summarize()
  check('t1: 汇总费用为 null 而非 0', s.cost.known === null && s.cost.knownEntries === 0 && s.cost.unknownEntries === 1, s.cost)
  check('t1: 仅填输入价仍视为未知（文本需两侧齐全）', priceKnownFor('chat', { inputPerMTok: 1 }) === false)
  check('t1: 两侧齐全才视为已知', priceKnownFor('chat', { inputPerMTok: 1, outputPerMTok: 2 }) === true)
  check('t1: 空字符串/NaN 报价按未知处理', normalizePrice({ inputPerMTok: '', outputPerMTok: 'abc' }).inputPerMTok === null && normalizePrice({ outputPerMTok: 'abc' }).outputPerMTok === null)
  check('t1: 图片报价缺失同样未知', priceKnownFor('image', { inputPerMTok: 1, outputPerMTok: 2 }) === false)
}

/* ============ 2. 真实 usage + 用户自填报价 → 可计算费用 ============ */
{
  const l = createLedger({ idPrefix: 'T2' })
  l.setPrice('priced-model', { currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8 })
  const h = l.start({ kind: 'chat', model: 'priced-model' })
  const r = l.finish(h, { ok: true, usage: { prompt_tokens: 1_000_000, completion_tokens: 250_000, total_tokens: 1_250_000 } })
  check('t2: 按报价计算费用（1M 输入 × 2 + 0.25M 输出 × 8 = 4）', r.entry.cost.known === true && r.entry.cost.amount === 4, r.entry.cost)
  check('t2: 费用来源标记为 computed', r.entry.cost.reason === 'computed' && r.entry.cost.currency === 'CNY')
  const s = l.summarize()
  check('t2: 汇总累计已知费用', s.cost.known === 4 && s.cost.currency === 'CNY' && s.cost.knownEntries === 1, s.cost)
  check('t2: token 汇总与调用一致', s.tokens.total === 1_250_000 && s.tokens.unknownEntries === 0, s.tokens)
  // 服务端直接返回 cost 时优先采用
  const h2 = l.start({ kind: 'chat', model: 'priced-model' })
  const r2 = l.finish(h2, { ok: true, usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20, cost: 0.0123 } })
  check('t2: 服务端返回 cost 优先且标注来源', r2.entry.cost.amount === 0.0123 && r2.entry.cost.reason === 'service-cost', r2.entry.cost)
  check('t2: 服务端 cost 计入口径可追溯', l.summarize().cost.serviceCostEntries === 1)
}

/* ============ 3. 端点未返回 usage：不伪造、不补 0 ============ */
{
  const l = createLedger({ idPrefix: 'T3' })
  l.setPrice('priced-model', { currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8 })
  const h = l.start({ kind: 'chat', model: 'priced-model' })
  const r = l.finish(h, { ok: true })
  check('t3: 无 usage 时 token 全为 null', r.entry.tokens.prompt === null && r.entry.tokens.total === null && r.entry.tokens.present === false, r.entry.tokens)
  check('t3: 无 usage 时费用未知且原因为 no-usage', r.entry.cost.amount === null && r.entry.cost.reason === 'no-usage', r.entry.cost)
  const s = l.summarize()
  check('t3: 汇总 token 为 0 但明确标注 1 次未知（不冒充真实用量）', s.tokens.total === 0 && s.tokens.unknownEntries === 1 && s.tokens.knownEntries === 0, s.tokens)
  check('t3: 汇总费用保持未知', s.cost.known === null && s.cost.unknownEntries === 1, s.cost)
  // 用量残缺（只有输入）→ 未知，不按 0 输出计费
  const h2 = l.start({ kind: 'chat', model: 'priced-model' })
  const r2 = l.finish(h2, { ok: true, usage: { prompt_tokens: 100 } })
  check('t3: 用量残缺时费用未知（usage-incomplete）', r2.entry.cost.known === false && r2.entry.cost.reason === 'usage-incomplete', r2.entry.cost)
  check('t3: 只有一侧用量时不推导合计（合计仍未知）', r2.entry.tokens.total === null && r2.entry.tokens.derivedTotal === false && r2.entry.tokens.prompt === 100, r2.entry.tokens)
  const h3 = l.start({ kind: 'chat', model: 'priced-model' })
  const r3 = l.finish(h3, { ok: true, usage: { prompt_tokens: 100, completion_tokens: 40 } })
  check('t3: 两侧齐全但端点未给合计时推导并标记 derivedTotal', r3.entry.tokens.total === 140 && r3.entry.tokens.derivedTotal === true, r3.entry.tokens)
  check('t3: normalizeUsage 对非对象返回 present:false', normalizeUsage(null).present === false && normalizeUsage('x').present === false)
}

/* ============ 4. 并发与乱序完成：id 唯一、互不串账、重复 finish 被拒 ============ */
{
  const l = createLedger({ idPrefix: 'T4' })
  l.setPrice('m', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 })
  const handles = []
  for (let i = 0; i < 25; i++) handles.push(l.start({ kind: i % 5 === 0 ? 'image' : 'chat', model: 'm', label: 'call-' + i }))
  check('t4: 并发 25 个任务 id 唯一', new Set(handles.map((h) => h.id)).size === 25)
  check('t4: 进行中任务数正确', l.summarize().calls.running === 25 && l.tasks().filter((t) => t.status === 'running').length === 25)
  // 乱序完成：倒序 finish，图像任务同时给图片数量
  const order = handles.map((h, i) => i).reverse()
  const results = order.map((i) => l.finish(handles[i], {
    ok: true,
    images: i % 5 === 0 ? 2 : undefined,
    usage: { prompt_tokens: 10 * (i + 1), completion_tokens: 5 * (i + 1), total_tokens: 15 * (i + 1) }
  }))
  check('t4: 乱序完成全部成功', results.every((r) => r.ok === true))
  const entries = l.entries()
  check('t4: 账目与任务一一对应（无串账）', entries.length === 25 && entries.every((e) => e.id.startsWith('T4-') && e.label.startsWith('call-')))
  check('t4: 每笔文本费用各自计算正确（15×(i+1) token × 1 元/M）', entries.filter((e) => e.kind === 'chat').every((e) => Math.abs(e.cost.amount - (15 * (Number(e.label.slice(5)) + 1) / 1e6)) < 1e-9))
  check('t4: 图像任务按张计价且与文本口径分离', entries.filter((e) => e.kind === 'image').every((e) => e.cost.known === false && e.cost.reason === 'no-price'))
  check('t4: 完成后无进行中任务', l.summarize().calls.running === 0 && l.summarize().calls.total === 25)
  check('t4: 重复 finish 被拒绝（unknown-task）', l.finish(handles[0], { ok: true }).ok === false)
  check('t4: 未知 id 的 finish 被拒绝', l.finish('T4-nope', { ok: true }).ok === false)
  check('t4: 未知 id 的 cancel 被拒绝', l.cancel('T4-nope').ok === false)
  // 中止路径
  const hx = l.start({ kind: 'chat', model: 'm' })
  const rc = l.cancel(hx)
  check('t4: 中止任务记录为 aborted', rc.ok === true && rc.entry.status === 'aborted' && rc.entry.cost.known === false)
  check('t4: 中止后不再计入进行中', l.summarize().calls.running === 0 && l.summarize().tasks.aborted === 1)
}

/* ============ 5. 失败 / 部分返回：金额明确未知或标注「可能仍计费」 ============ */
{
  const l = createLedger({ idPrefix: 'T5' })
  l.setPrice('m', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 })
  const hf = l.start({ kind: 'chat', model: 'm' })
  const rf = l.finish(hf, { ok: false, errorCode: 'http-500' })
  check('t5: 失败且无用量 → 费用未知（不猜已计费金额）', rf.entry.status === 'failed' && rf.entry.cost.known === false && rf.entry.cost.amount === null, rf.entry.cost)
  check('t5: 失败保留错误码用于诊断（不含正文）', rf.entry.errorCode === 'http-500')
  const hp = l.start({ kind: 'chat', model: 'm' })
  const rp = l.finish(hp, { ok: true, partial: true, usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
  check('t5: 部分返回状态为 partial', rp.entry.status === 'partial')
  check('t5: 部分返回已知金额标注 provisional（可能仍计费）', rp.entry.cost.known === true && rp.entry.cost.provisional === true, rp.entry.cost)
  const ha = l.start({ kind: 'chat', model: 'm' })
  const ra = l.finish(ha, { aborted: true, usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 } })
  check('t5: 中止但有用量 → aborted + provisional', ra.entry.status === 'aborted' && ra.entry.cost.provisional === true)
  const s = l.summarize()
  check('t5: 汇总分别计数 failed / partial / aborted', s.tasks.failed === 1 && s.tasks.partial === 1 && s.tasks.aborted === 1, s.tasks)
  check('t5: 汇总标注 provisional 笔数', s.cost.provisionalEntries === 2, s.cost)
}

/* ============ 6. 图像按张计价 + 多货币不合并 ============ */
{
  const l = createLedger({ idPrefix: 'T6' })
  l.setPrice('img-model', { currency: 'USD', imagePerUnit: 0.04 })
  const h1 = l.start({ kind: 'image', model: 'img-model' })
  const r1 = l.finish(h1, { ok: true, images: 3 })
  check('t6: 图片按张 × 单价计算', r1.entry.cost.amount === 0.12 && r1.entry.cost.known === true, r1.entry.cost)
  const h2 = l.start({ kind: 'image', model: 'img-model' })
  const r2 = l.finish(h2, { ok: true })
  check('t6: 未返回图片数量 → 费用未知（no-image-count）', r2.entry.cost.known === false && r2.entry.cost.reason === 'no-image-count', r2.entry.cost)
  check('t6: 图片数量未知计入 unknownEntries', l.summarize().images.unknownEntries === 1 && l.summarize().images.count === 3)
  l.setPrice('cn-model', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 })
  const h3 = l.start({ kind: 'chat', model: 'cn-model' })
  l.finish(h3, { ok: true, usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 } })
  const s = l.summarize()
  check('t6: 多货币不合并，按货币分桶', s.cost.byCurrency.length === 2 && s.cost.mixedCurrency === true, s.cost.byCurrency)
  check('t6: 主口径取笔数最多的一种并给出币种', s.cost.known !== null && typeof s.cost.currency === 'string', s.cost)
}

/* ============ 7. 敏感数据不泄露：诊断导出白名单 + 账本不留正文/密钥 ============ */
{
  const l = createLedger({ idPrefix: 'T7' })
  l.setPrice('m', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 })
  const h = l.start({ kind: 'chat', model: 'm', label: 'req-1' })
  // 恶意/疏漏的 meta：正文、密钥、路径都可能被误传进来
  l.finish(h, {
    ok: true,
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    meta: {
      apiKey: 'sk-secret-key-value-1234567890',
      baseUrl: 'https://api.example.com/v1',
      userPath: 'C:\\Users\\ellen\\AppData\\Roaming\\sixworlds',
      content: '这是模型生成的正文内容，不应该进入账本导出'.repeat(10),
      count: 3,
      cached: true,
      nested: { deep: 'x'.repeat(500) }
    }
  })
  const entry = l.entries()[0]
  check('t7: 账本条目不含 meta.nested 这类深层对象', entry.meta.nested === undefined)
  check('t7: 账本条目 meta 丢弃密钥 / URL / 路径 / 正文键', entry.meta.apiKey === undefined && entry.meta.baseUrl === undefined && entry.meta.userPath === undefined && entry.meta.content === undefined, entry.meta)
  check('t7: 账本条目保留无敏感含义的普通字段', entry.meta.count === 3 && entry.meta.cached === true)
  const report = buildDiagnosticsReport({
    version: '1.5.3',
    platform: 'win32',
    arch: 'x64',
    config: { hasTextKey: true, illustEnabled: false, skipSplash: true, apiKey: 'sk-should-not-appear', baseUrl: 'https://api.example.com', freeText: '我的私人备注' },
    summary: l.summarize(),
    generatedAt: '2026-09-21T00:00:00.000Z'
  })
  const json = JSON.stringify(report)
  check('t7: 诊断报告 schema 正确', report.schema === DIAGNOSTICS_SCHEMA)
  check('t7: 报告不含 apiKey 正文', !json.includes('sk-should-not-appear') && !json.includes('sk-secret'))
  check('t7: 报告不含端点地址', !json.includes('api.example.com') && !/https?:\/\//.test(json))
  check('t7: 报告不含用户路径', !/[A-Za-z]:[\\/]/.test(json) && !json.includes('ellen'))
  check('t7: 报告不含自由文本 / 模型名', !json.includes('私人备注') && !json.includes('"model"') && !json.includes('"m"'))
  check('t7: 报告不含正文内容', !json.includes('不应该进入账本导出'))
  check('t7: 非白名单布尔键被丢弃（apiKey/baseUrl/freeText 未出现）', report.config.apiKey === undefined && report.config.baseUrl === undefined && report.config.freeText === undefined)
  check('t7: 白名单布尔键保留且归一为布尔', report.config.hasTextKey === true && report.config.illustEnabled === false && report.config.skipSplash === true)
  check('t7: 统计只含数字', Object.values(report.stats).every((v) => v === null || typeof v === 'number'), report.stats)
  check('t7: 统计含调用数与 token 数', report.stats.totalCalls === 1 && report.stats.totalTokens === 15)
  check('t7: 统计含未知用量笔数（费用口径可追溯）', report.stats.usageUnknownCalls === 0 && report.stats.costUnknownEntries === 0)
  check('t7: 报告自身通过敏感扫描', scanForSensitive(report).length === 0, scanForSensitive(report))
  // 扫描器必须真的能抓到问题（否则上一条断言没有意义）
  check('t7: 扫描器能抓到密钥', scanForSensitive({ a: 'sk-abcdefghijklmnop' }).some((f) => f.reason === 'api-key'))
  check('t7: 扫描器能抓到路径', scanForSensitive({ a: 'D:\\代码\\测试\\无职转生\\data' }).some((f) => f.reason === 'windows-path'))
  check('t7: 扫描器能抓到敏感键名', scanForSensitive({ apiKey: 1 }).some((f) => f.reason === 'sensitive-key'))
  check('t7: safeToken 对含斜杠/密钥的版本号返回 redacted', ledger.safeToken('C:\\x') === 'redacted' && ledger.safeToken('sk-abcdefghijk') === 'redacted')
  // 账本持久化往返：价格与条目保留，仍然没有正文
  const dumped = l.toJSON()
  check('t7: 账本 schema 标记正确', dumped.schema === LEDGER_SCHEMA)
  const l2 = createLedger({ idPrefix: 'T7b' })
  const loaded = l2.load(JSON.parse(JSON.stringify(dumped)))
  check('t7: 账本可往返加载', loaded.ok === true && l2.entries().length === 1 && l2.getPrice('m').inputPerMTok === 1)
  check('t7: 往返后仍无正文 / 密钥', !JSON.stringify(l2.toJSON()).includes('不应该进入账本导出') && !JSON.stringify(l2.toJSON()).includes('sk-secret'))
  check('t7: schema 不匹配时拒绝加载', l2.load({ schema: 'other.v9', entries: [] }).ok === false)
  check('t7: 非法数据拒绝加载', l2.load(null).ok === false && l2.load('x').ok === false)
}

/* ============ 8. 账本容量上限：超限丢弃最早记录且计数可查 ============ */
{
  const l = createLedger({ idPrefix: 'T8', maxEntries: 50 })
  for (let i = 0; i < 60; i++) l.record({ kind: 'chat', model: 'm', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  const s = l.summarize()
  check('t8: 条目数不超过上限', s.entries === 50 && l.entries().length === 50)
  check('t8: 丢弃数量被记录（不静默）', s.dropped === 10, s.dropped)
}

/* ============ 8b. 脏数据防护：负数报价 / 负数用量 / 被篡改的持久化文件 ============ */
{
  // 负数报价不是「便宜」，按未知处理，绝不产出负费用
  const l = createLedger({ idPrefix: 'T8b' })
  l.setPrice('m', { currency: 'CNY', inputPerMTok: -100, outputPerMTok: 2 })
  check('t8b: 负数报价按未知处理', l.getPrice('m').inputPerMTok === null && priceKnownFor('chat', l.getPrice('m')) === false)
  const h = l.start({ kind: 'chat', model: 'm' })
  const r = l.finish(h, { ok: true, usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 } })
  check('t8b: 负数报价下费用为未知而非负数', r.entry.cost.amount === null && r.entry.cost.known === false, r.entry.cost)
  const hs = l.start({ kind: 'chat', model: 'm' })
  check('t8b: 服务端返回负数 cost 不采信', l.finish(hs, { ok: true, cost: -9 }).entry.cost.known === false)
  // 负数用量按未知处理，不产生负 token
  const hu = l.start({ kind: 'chat', model: 'm' })
  const ru = l.finish(hu, { ok: true, usage: { prompt_tokens: -3, completion_tokens: -1 } })
  check('t8b: 负数 token 按未知处理', ru.entry.tokens.present === false && ru.entry.tokens.total === null, ru.entry.tokens)
  check('t8b: 负 token 不会污染汇总（合计为 0 且标注未知）', l.summarize().tokens.unknownEntries === 2 && l.summarize().tokens.total === 1_000_000, l.summarize().tokens)

  // 被篡改 / 损坏的持久化文件：非法条目丢弃，且不得把密钥/路径带回来
  const lt = createLedger({ idPrefix: 'T8c' })
  const evil = {
    schema: LEDGER_SCHEMA,
    prices: { m: { inputPerMTok: 'x', outputPerMTok: null } },
    entries: [
      { id: 'e1', kind: 'chat', model: 'm', label: 'x', status: 'succeeded', startedAt: 1, finishedAt: 2, tokens: { present: true, prompt: 1, completion: 1, total: 2 }, cost: { known: true, amount: 5, currency: 'CNY' }, meta: { apiKey: 'sk-evil-abcdefghij' } },
      { id: 'e2', kind: 'chat' },
      null,
      'not-an-entry'
    ]
  }
  const lr = lt.load(evil)
  check('t8c: 非法条目被丢弃且数量可查', lr.ok === true && lt.entries().length === 2 && lr.skipped === 2, lr)
  check('t8c: 篡改文件里的密钥不会进入账本', JSON.stringify(lt.toJSON()).includes('sk-evil') === false)
  check('t8c: 残缺条目被重建为受控形状（summarize 不抛错）', typeof lt.summarize().cost.known === 'number')
  check('t8c: 残缺条目的 token 按未知处理', lt.entries()[1].tokens.present === false && lt.entries()[1].cost.known === false)
  check('t8c: 丢弃计数含被跳过的非法条目', lt.summarize().dropped >= 2, lt.summarize().dropped)
  // 原型污染键名不得写入统计
  const lp = createLedger({ idPrefix: 'T8d' })
  lp.record({ kind: '__proto__', model: 'm' })
  lp.record({ kind: 'chat', model: 'm', status: 'constructor' })
  const sp = lp.summarize()
  const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
  check('t8d: 危险 kind 键不进入统计', !owns(sp.calls.byKind, '__proto__'), sp.calls.byKind)
  check('t8d: 危险 status 键不进入统计', !owns(sp.calls.byStatus, 'constructor'), sp.calls.byStatus)
  check('t8d: 原型未被污染', ({}).polluted === undefined && Object.prototype.polluted === undefined)
  check('t8d: 危险键条目本身仍被计数（不丢账）', sp.calls.total === 2)
  // 诊断对不可信 summary 的健壮性：不抛错，未知保持 null
  const bad = buildDiagnosticsReport({ version: '1', platform: 'win32', arch: 'x64', config: { hasTextKey: 'yes' }, summary: { calls: { total: 'NaN' }, tokens: null, cost: { knownEntries: -5 } } })
  check('t8d: 诊断对不可信统计不抛错且未知为 null', bad.stats.totalCalls === null && bad.stats.costKnownEntries === null && bad.stats.totalTokens === null)
  check('t8d: 非布尔配置项不冒充布尔', bad.config.hasTextKey === false)
}

/* ============ 9. 共享入口 ui/shared/runtime-tools.js（Node 下无 DOM 也能测的对外面） ============ */
async function sharedEntryTests() {
  const src = fs.readFileSync(path.join(root, 'ui', 'shared', 'runtime-tools.js'), 'utf8')
  // 语法解析（浏览器侧文件，用 vm 只做解析，不执行）
  let parseOk = true, parseErr = ''
  try { new vm.Script(src, { filename: 'runtime-tools.js' }) } catch (e) { parseOk = false; parseErr = String(e.message) }
  check('t9: runtime-tools.js 语法可解析', parseOk, parseErr)
  let onboardingOk = true, onboardingErr = ''
  try { new vm.Script(fs.readFileSync(path.join(root, 'ui', 'shared', 'onboarding.js'), 'utf8'), { filename: 'onboarding.js' }) } catch (e) { onboardingOk = false; onboardingErr = String(e.message) }
  check('t9: onboarding.js 语法可解析', onboardingOk, onboardingErr)
  let ledgerParseOk = true
  try { new vm.Script(fs.readFileSync(path.join(root, 'engine', 'usage-ledger.js'), 'utf8'), { filename: 'usage-ledger.js' }) } catch (e) { ledgerParseOk = false }
  check('t9: usage-ledger.js 语法可解析', ledgerParseOk)

  // 在 Node 中加载共享入口（无 window/document：模块只导出工厂，不自行挂载）
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout, Date, JSON, Math, Number, String, Object, Array, RegExp }
  sandbox.exports = sandbox.module.exports
  vm.createContext(sandbox)
  new vm.Script(src, { filename: 'runtime-tools.js' }).runInContext(sandbox)
  const RuntimeTools = sandbox.module.exports
  check('t9: 共享入口导出 create', typeof RuntimeTools.create === 'function')

  const savedFiles = []
  const fakeApi = {
    runtimeDiagnosticsInfo: async () => ({ ok: true, version: '1.5.3', platform: 'win32', arch: 'x64', config: { hasTextKey: true, illustEnabled: false, skipSplash: true } }),
    runtimeDiagnosticsSave: async (payload) => { savedFiles.push(payload); return { ok: true, path: 'out.json' } }
  }
  const inner = createLedger({ idPrefix: 'T9' })
  const tools = RuntimeTools.create({ api: fakeApi, cfg: () => ({ apiKey: 'sk-live', illustPreset: 'off', skipSplash: true }), toast: () => {}, options: { ledger: inner, ledgerModule: ledger, autoMount: false } })
  await tools.ready()
  check('t9: 注入账本后 ready 生效', tools.ledger() === inner)

  const started = await tools.startCall({ kind: 'chat', model: 'm' })
  check('t9: startCall 返回句柄', started.ok === true && typeof started.handle.id === 'string')
  const noPrice = await tools.finishCall(started.handle, { ok: true, usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })
  check('t9: 未填报价时 finishCall 费用未知（不显示 0）', noPrice.entry.cost.known === false && noPrice.entry.cost.amount === null)
  check('t9: summarize 透出未知口径', tools.summarize().cost.known === null && tools.summarize().tokens.total === 200)

  await tools.setPrice('m', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 3 })
  check('t9: priceKnownFor 反映已保存报价', tools.priceKnownFor('m', 'chat') === true && tools.priceKnownFor('nope', 'chat') === false)
  const priced = await tools.recordCall({ kind: 'chat', model: 'm', usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 } })
  check('t9: recordCall 按报价计价', priced.entry.cost.amount === 4, priced.entry.cost)

  const diag = await tools.buildDiagnostics()
  check('t9: buildDiagnostics 成功', diag.ok === true, diag.error)
  const diagJson = diag.text
  check('t9: 诊断导出不含密钥（含真实 apiKey 的配置也不泄漏）', !diagJson.includes('sk-live') && !/sk-[A-Za-z0-9]{6,}/.test(diagJson))
  check('t9: 诊断导出含版本与统计', diagJson.includes('1.5.3') && diagJson.includes('totalCalls'))
  check('t9: 诊断导出不含模型名', !diagJson.includes('"m"') && !diagJson.includes('model'))
  const exported = await tools.exportDiagnostics()
  check('t9: exportDiagnostics 走 runtimeDiagnosticsSave', exported.ok === true && savedFiles.length === 1)
  check('t9: 导出文件名不含用户路径', /^sixworlds-diagnostics-\d{4}-\d{2}-\d{2}\.json$/.test(savedFiles[0].defaultName), savedFiles[0].defaultName)
  check('t9: 导出的文件内容同样脱敏', !savedFiles[0].content.includes('sk-live') && !/[A-Za-z]:[\\/]/.test(savedFiles[0].content))
  check('t9: 任务列表含已完成条目', tools.tasks().length >= 2)

  // 无主进程 IPC 时退回 localStorage / 明确失败（不抛异常）
  const tools2 = RuntimeTools.create({ api: {}, cfg: () => ({}), toast: () => {}, options: { ledger: createLedger({ idPrefix: 'T9b' }), ledgerModule: ledger, autoMount: false } })
  const persisted = await tools2.persist()
  check('t9: 无 IPC 且无 localStorage 时 persist 返回失败而不是抛异常', persisted.ok === false && persisted.error === 'storage-unavailable', persisted)
  const diag2 = await tools2.buildDiagnostics()
  check('t9: 无版本信息时诊断仍可生成（版本为 null 不编造）', diag2.ok === true && JSON.parse(diag2.text).app.version === null)

  // 生成前估算对外面：取已保存报价，缺项保持未知
  const est = tools.estimate({ pages: 4, imagesPerPage: 2, chatCalls: 1, promptTokensPerCall: 1_000_000, completionTokensPerCall: 1_000_000, model: 'm' })
  check('t9: estimate 走已保存报价（1M 输入 × 1 + 1M 输出 × 3 = 4；图片无报价 → 总额未知）', est.ok === true && est.parts.find((p) => p.kind === 'chat').cost.amount === 4 && est.total.known === false && est.total.reason === 'no-price', est.total)
  const estUnknown = tools.estimate({ pages: 2 })
  check('t9: estimate 缺项时为未知（不按 0 估）', estUnknown.ok === true && estUnknown.total.known === false && estUnknown.imageCalls === 2)
  check('t9: 共享入口源码含估算标签页', src.includes("['estimate', '生成前估算']") && src.includes('function renderEstimate'))
  check('t9: 估算面板不发起网络请求', !/renderEstimate[\s\S]{0,4000}api\.(sendChat|generateImage|testEndpoint)/.test(src))
  // 估算结果卡必须带 runtime-card-cost 类，否则样式与 e2e 选择器都定位不到费用卡
  check('t9: 估算费用卡带 runtime-card-cost 类', /renderEstimate[\s\S]{0,4000}runtime-card-cost/.test(src))
  check('t9: 估算面板支持模型下拉（复用已保存报价）', /renderEstimate[\s\S]{0,1500}createElement\('select'\)|renderEstimate[\s\S]{0,1500}node\('select'\)/.test(src))
}

/* ============ 10. 向导契约：离线示例与连接测试反馈（源码级，不启动 Electron） ============ */
function onboardingContractTests() {
  const src = fs.readFileSync(path.join(root, 'ui', 'shared', 'onboarding.js'), 'utf8')
  check('t10: 存在离线示例文案与标注徽标', src.includes('离线示例') && src.includes('未联网') && src.includes('不产生费用'))
  check('t10: 离线示例块有 data-example-block 锚点', src.includes('data-example-block="1"'))
  check('t10: 未填密钥也能展开示例（按钮不依赖密钥）', /wizard-example-toggle[\s\S]{0,400}不需要密钥/.test(src))
  check('t10: 示例开关只重绘、不调用网络', /wizard-example-toggle[\s\S]{0,300}render\(\)/.test(src) && !/example[\s\S]{0,200}api\.testEndpoint/.test(src))
  check('t10: 示例文本为内置常量（非模板拼接外部数据）', src.includes('const OFFLINE_EXAMPLE'))
  check('t10: 连接测试有解释函数 explainProbe', src.includes('function explainProbe'))
  check('t10: 解释覆盖 401 / 404 / 429 / 5xx / 超时', ['401', '404', '429', '5xx', '超时'].every((k) => src.includes(k)))
  check('t10: 失败时提供就地重试按钮', src.includes('wizard-retry-btn') && src.includes('重试连接测试'))
  check('t10: 空密钥提示不再只说「请先填写」', src.includes('两者都不能为空'))
  check('t10: 未返回模型列表时提示可手填', src.includes('可以手填模型名继续'))
  check('t10: 连接测试仍只调用既有 api.testEndpoint', (src.match(/api\.testEndpoint/g) || []).length === 1)
}

/* ============ 11. 样式与文档锚点 ============ */
function styleContractTests() {
  const css = fs.readFileSync(path.join(root, 'ui', 'shared', 'runtime-tools.css'), 'utf8')
  check('t11: runtime-tools.css 只用主题语义变量（无硬编码颜色）', !/#[0-9a-fA-F]{3,8}\b/.test(css) && !/rgba?\(/.test(css))
  check('t11: runtime-tools.css 引用既有语义变量', ['var(--panel-2)', 'var(--accent)', 'var(--danger)', 'var(--border)', 'var(--text)'].every((v) => css.includes(v)))
  check('t11: runtime-tools.css 覆盖窄窗', css.includes('@media(max-width:700px)'))
  check('t11: 主进程接入说明写在模块头（含 IPC 名）', fs.readFileSync(path.join(root, 'engine', 'usage-ledger.js'), 'utf8').includes("runtime:ledger-load"))
  check('t11: 共享入口自带 CSS 注入兜底（不改 index.html 也能生效）', fs.readFileSync(path.join(root, 'ui', 'shared', 'runtime-tools.js'), 'utf8').includes('data-runtime-tools'))
}

/* ============ 12. 生成前估算：只算用户给的数，缺项保持未知 ============ */
function estimateTests() {
  const noPrice = estimatePlan({ pages: 4 })
  check('t12: 只给页数 → 图片调用数由页数×每页张数推导并注明', noPrice.imageCalls === 4 && noPrice.imageCallsDerived === true, noPrice)
  check('t12: 未填报价时总额未知（不按 0 估），并沿用该部分的未知原因', noPrice.total.known === false && noPrice.total.amount === null && noPrice.total.reason === 'no-price', noPrice.total)
  check('t12: 未填文本调用次数时文本部分未知（no-calls）', noPrice.parts.find((p) => p.kind === 'chat').cost.reason === 'no-calls')

  const both = estimatePlan({
    pages: 4, imagesPerPage: 2, chatCalls: 1, promptTokensPerCall: 3000, completionTokensPerCall: 800,
    price: { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 2, imagePerUnit: 0.5 }
  })
  check('t12: 两侧报价齐全时总额可算（8 张 × 0.5 + 3800 token）', both.total.known === true && both.total.amount === 4.0046, both.total)
  check('t12: 图片调用次数 = 页数 × 每页张数', both.imageCalls === 8 && both.parts.find((p) => p.kind === 'image').calls === 8)
  check('t12: 估算结果币种跟随用户填写的报价', both.total.currency === 'CNY')

  const partial = estimatePlan({ pages: 4, imagesPerPage: 2, chatCalls: 1, promptTokensPerCall: 3000, completionTokensPerCall: 800, price: { currency: 'CNY', imagePerUnit: 0.5 } })
  check('t12: 只有图片报价时总额保持未知（部分缺价不合计）', partial.total.known === false && partial.total.reason === 'no-price')
  check('t12: 已知部分仍单独给出金额', partial.parts.find((p) => p.kind === 'image').cost.amount === 4)
  check('t12: 未知部分会写进 notes', partial.notes.some((n) => n.includes('无法计价')))

  const noTokens = estimatePlan({ chatCalls: 2, price: { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 } })
  check('t12: 未填每次 token 时文本费用未知（no-tokens）', noTokens.parts.find((p) => p.kind === 'chat').cost.reason === 'no-tokens')
  check('t12: 有调用次数但缺 token 时总额未知并说明原因', noTokens.total.known === false && noTokens.total.reason === 'no-tokens', noTokens.total)

  const nothing = estimatePlan({ price: { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 1 } })
  check('t12: 什么都没填时总额未知（no-calls）', nothing.total.reason === 'no-calls' && nothing.imageCalls === null)

  const negative = estimatePlan({ pages: -4, chatCalls: -1, price: { currency: 'CNY', imagePerUnit: 1, inputPerMTok: 1, outputPerMTok: 1 } })
  check('t12: 负数页数/次数按未填写处理（不产生负估算）', negative.pages === null && negative.chatCalls === null && negative.total.known === false)

  const overflow = estimatePlan({ imageCalls: 1e10, price: { currency: 'CNY', imagePerUnit: 1e300 } })
  check('t12: 溢出金额不冒充已知（invalid-amount）', overflow.parts.find((p) => p.kind === 'image').cost.known === false && overflow.parts.find((p) => p.kind === 'image').cost.reason === 'invalid-amount', overflow.parts[1])
  check('t12: 溢出时总额同样未知', overflow.total.known === false)

  const overflowCalls = estimatePlan({ pages: 1e300, imagesPerPage: 1e300, price: { currency: 'CNY', imagePerUnit: 1 } })
  check('t12: 次数乘积溢出时按未知处理并在 notes 说明', overflowCalls.imageCalls === null && overflowCalls.imageCallsDerived === false && overflowCalls.notes.some((n) => n.includes('超出可计算范围')), overflowCalls)

  const noCurrency = estimatePlan({ pages: 1, price: { imagePerUnit: 2 } })
  check('t12: 未填货币时金额仍给数值但不带币种', noCurrency.total.known === true && noCurrency.total.amount === 2 && noCurrency.total.currency === null)
  check('t12: 未填货币会在 notes 里说明', noCurrency.notes.some((n) => n.includes('货币')))
}

/* ============ 13. 主进程运行时服务：IPC 形状、落盘重建、诊断白名单、记账封装 ============ */
function runtimeServiceTests() {
  const svc = require('../engine/runtime-service.cjs')
  check('t13: 导出 register / createRuntimeService / CHANNELS', typeof svc.register === 'function' && typeof svc.createRuntimeService === 'function' && !!svc.CHANNELS)
  check('t13: 通道名与渲染层约定一致', svc.CHANNELS.ledgerLoad === 'runtime:ledger-load' && svc.CHANNELS.ledgerSave === 'runtime:ledger-save' && svc.CHANNELS.diagnosticsInfo === 'runtime:diagnostics-info' && svc.CHANNELS.diagnosticsSave === 'runtime:diagnostics-save')

  // 假 ipcMain：记录 handler，便于直接调用（不启动 Electron）
  const handlers = new Map()
  const fakeIpc = { handle: (ch, fn) => handlers.set(ch, fn) }
  const dataRoot = path.join(tmp, 'runtime-service')
  const dialogCalls = []
  const service = svc.register({
    ipcMain: fakeIpc, dataRoot,
    appInfo: { version: '9.9.9' },
    configProvider: () => ({ hasTextKey: true, skipSplash: true, apiKey: 'sk-should-not-leak-abcdefgh', baseUrl: 'https://api.example.com', freeText: '私人备注' }),
    dialog: { showSaveDialog: async (_win, opts) => { dialogCalls.push(opts); return { canceled: false, filePath: path.join(dataRoot, 'diag-out.json') } } },
    windowForEvent: () => null
  })
  check('t13: register 注册六个通道', handlers.size === 6 && handlers.has('runtime:ledger-load') && handlers.has('runtime:price-set') && handlers.has('runtime:price-remove') && handlers.has('runtime:diagnostics-save'))

  const info = service.diagnosticsInfo()
  check('t13: 诊断信息只含白名单布尔键', info.config.hasTextKey === true && info.config.skipSplash === true && info.config.apiKey === undefined && info.config.baseUrl === undefined && info.config.freeText === undefined, info.config)
  check('t13: 诊断信息含版本/平台/架构', info.version === '9.9.9' && typeof info.platform === 'string' && typeof info.arch === 'string')

  // 记账：成功 / 失败 / 中止
  const h1 = service.trackChat({ model: 'm', reqId: 'req-1' })
  service.finishChat(h1, { ok: true, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  const h2 = service.trackChat({ model: 'm', reqId: 'req-2' })
  service.finishChat(h2, { ok: false })
  const h3 = service.trackImage({ model: 'img' })
  service.finishImage(h3, { ok: true, cost: 0.02 })
  const s = service.summary()
  check('t13: 记账区分成功 / 失败 / 图像', s.calls.total === 3 && s.tasks.failed === 1 && s.calls.byKind.image === 1, s.calls)
  check('t13: 服务端返回 cost 被采用', s.cost.known === 0.02 && s.cost.serviceCostEntries === 1, s.cost)
  check('t13: 失败调用无用量时费用未知（不猜）', s.cost.unknownEntries >= 1)

  // 渲染层保存的数据不可信：非法条目丢弃、密钥不带回、落盘可读
  const loadResult = service.saveLedger({
    schema: 'sixworlds.usage-ledger.v1',
    prices: { m: { inputPerMTok: -1, outputPerMTok: 2 } },
    entries: [
      { id: 'x1', kind: 'chat', status: 'succeeded', tokens: { present: true, prompt: 1, completion: 1, total: 2 }, cost: { known: true, amount: 3, currency: 'CNY' }, meta: { apiKey: 'sk-evil-abcdefghij' } },
      null
    ]
  })
  check('t13: 保存返回计数而非条目内容', loadResult.ok === true && loadResult.entries === 1 && loadResult.skipped === 1 && loadResult.content === undefined, loadResult)
  check('t13: 负数报价在落盘前被归一为未知', service.ledger.getPrice('m').inputPerMTok === null)
  const onDisk = fs.readFileSync(service.ledgerFile, 'utf8')
  check('t13: 磁盘上的账本不含密钥', onDisk.includes('sk-evil') === false && onDisk.includes('sk-should-not-leak') === false)
  check('t13: 磁盘文件可被重新加载（原子写生效）', (() => { try { return JSON.parse(onDisk).schema === 'sixworlds.usage-ledger.v1' } catch { return false } })())

  // 诊断保存：内容必须通过白名单自检
  return (async () => {
    const bad = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'sixworlds.diagnostics.v1', leak: 'sk-evil-abcdefghij' }) })
    check('t13: 含敏感内容的诊断包被拒绝且不落盘', bad.ok === false && ['field-not-allowed', 'sensitive-content'].includes(bad.error) && dialogCalls.length === 0, bad)
    const notSchema = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'other' }) })
    check('t13: schema 不符的诊断包被拒绝', notSchema.ok === false && notSchema.error === 'schema-mismatch')
    const empty = await handlers.get('runtime:diagnostics-save')(null, { content: '' })
    check('t13: 空内容被拒绝', empty.ok === false && empty.error === 'empty-content')

    const good = buildDiagnosticsReport({ version: '9.9.9', platform: 'win32', arch: 'x64', config: service.diagnosticsInfo().config, summary: service.summary() })
    const saved = await handlers.get('runtime:diagnostics-save')(null, { defaultName: '../../evil name?.json', content: JSON.stringify(good, null, 2) })
    check('t13: 合规诊断包可导出', saved.ok === true, saved)
    check('t13: 导出文件名被安全化（去路径与非法字符）', /^[A-Za-z0-9._-]+\.json$/.test(dialogCalls[0].defaultPath) && !dialogCalls[0].defaultPath.includes('..'), dialogCalls[0].defaultPath)
    const written = fs.readFileSync(path.join(dataRoot, 'diag-out.json'), 'utf8')
    check('t13: 落盘诊断包不含密钥 / 路径 / 模型名', !written.includes('sk-') && !/[A-Za-z]:[\\/]/.test(written) && !written.includes('"model"'))

    const load = await handlers.get('runtime:ledger-load')(null)
    check('t13: ledger-load 返回受控账本数据', load.ok === true && Array.isArray(load.data.entries))
    check('t13: ledger-load 回传内容不含密钥', JSON.stringify(load.data).includes('sk-evil') === false)
    const infoIpc = await handlers.get('runtime:diagnostics-info')(null)
    check('t13: diagnostics-info 走 IPC 也不泄漏密钥', infoIpc.ok === true && JSON.stringify(infoIpc).includes('sk-should-not-leak') === false)
  })()
}

/* ============ 14. 不可信数据的收尾加固：原型链键名 / 溢出金额 / 估算边界 ============ */
function hardeningTests() {
  // meta 键名是 __proto__（磁盘/调用方都可能给）：不得写到 Object.prototype
  const l = createLedger({ idPrefix: 'T14' })
  const h = l.start({ kind: 'chat', model: 'm' })
  const entry = l.finish(h, { ok: true, meta: JSON.parse('{"__proto__":{"polluted":1},"count":3}') }).entry
  check('t14: meta 里的 __proto__ 键被丢弃', Object.prototype.hasOwnProperty.call(entry.meta, '__proto__') === false && ({}).polluted === undefined, entry.meta)
  check('t14: meta 的普通字段照常保留', entry.meta.count === 3)

  // 币种被磁盘数据污染成危险键名
  const lc = createLedger({ idPrefix: 'T14b' })
  lc.load(JSON.parse(JSON.stringify({
    schema: LEDGER_SCHEMA,
    entries: [{ id: 'a', kind: 'chat', status: 'succeeded', cost: { known: true, amount: 1, currency: '__proto__' } }]
  })))
  const sc = lc.summarize()
  check('t14: 危险币种键不进入分桶', !Object.prototype.hasOwnProperty.call(sc.cost.byCurrency, '__proto__'), sc.cost.byCurrency)
  check('t14: 汇总后原型未被污染', ({}).amount === undefined && ({}).entries === undefined)
  check('t14: 该笔仍按已知计费计数（不丢账）', sc.cost.knownEntries === 1)

  // 报价模型名为 __proto__：Map 承载，不落到对象原型上
  const lp = createLedger({ idPrefix: 'T14c' })
  lp.load(JSON.parse(JSON.stringify({ schema: LEDGER_SCHEMA, prices: { __proto__: { inputPerMTok: 1, outputPerMTok: 2 } }, entries: [] })))
  check('t14: __proto__ 模型报价不会污染 toJSON 的普通对象', Object.keys(lp.toJSON().prices).length === 0 && JSON.stringify(lp.toJSON()).includes('inputPerMTok') === false)

  // 金额溢出：Infinity 不能混进账本
  const lo = createLedger({ idPrefix: 'T14d' })
  lo.setPrice('m', { currency: 'CNY', inputPerMTok: 1e308, outputPerMTok: 1e308 })
  const ho = lo.start({ kind: 'chat', model: 'm' })
  const overflow = lo.finish(ho, { ok: true, usage: { prompt_tokens: 1e308, completion_tokens: 1e308 } }).entry
  check('t14: 溢出金额按未知处理（invalid-amount）', overflow.cost.known === false && overflow.cost.amount === null && overflow.cost.reason === 'invalid-amount', overflow.cost)
  check('t14: 溢出不会让汇总出现 Infinity', Number.isFinite(lo.summarize().cost.known) === false && lo.summarize().cost.known === null)

  // 估算对外面在账本模块缺失时明确失败，不抛异常
  check('t14: estimatePlan 对非对象输入不抛错', estimatePlan(null).ok === true && estimatePlan('x').total.known === false)
}

/* ============ 15. 权威账本：公共订阅契约 + ready/restore 竞态 + persisted 回执（纯模块，不启 Electron） ============
 * 主进程是唯一记账源：本测试用真实 usage-ledger 充当主进程账本，手动广播快照模拟 main.cjs 的
 * runtimeAttempt/onChanged，验证渲染层只读镜像、订阅通知、乱序丢弃与落盘失败的真实回执。 */
async function authoritativeContractTests() {
  const src = fs.readFileSync(path.join(root, 'ui', 'shared', 'runtime-tools.js'), 'utf8')
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout, Date, JSON, Math, Number, String, Object, Array, RegExp, Promise }
  sandbox.exports = sandbox.module.exports
  vm.createContext(sandbox)
  new vm.Script(src, { filename: 'runtime-tools.js' }).runInContext(sandbox)
  const RuntimeTools = sandbox.module.exports

  const main = createLedger({ idPrefix: 'MAIN' })
  let rev = 0
  const subscribers = []
  const snap = (persistence) => ({
    ok: true,
    data: main.toJSON(),
    summary: main.summarize(),
    tasks: main.tasks(),
    revision: ++rev,
    persistence: persistence || { ok: true }
  })
  const api = {
    runtimeLedgerLoad: async () => snap(),
    onRuntimeLedgerChanged: (cb) => { subscribers.push(cb); return () => { const i = subscribers.indexOf(cb); if (i >= 0) subscribers.splice(i, 1) } },
    runtimePriceSet: async ({ model, price }) => { main.setPrice(model, price); const s = snap(); subscribers.forEach((cb) => cb(s)); return s },
    runtimePriceRemove: async ({ model }) => { main.removePrice(model); const s = snap(); subscribers.forEach((cb) => cb(s)); return s }
  }
  const broadcast = (persistence) => { const s = snap(persistence); subscribers.forEach((cb) => cb(s)); return s }

  // 预置一笔主进程账目（渲染层不得复制记账）
  const h = main.start({ kind: 'chat', model: 'm' })
  main.finish(h, { ok: true, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })

  const mirror = createLedger({ idPrefix: 'MIRROR' })
  const rt = RuntimeTools.create({ api, cfg: () => ({}), toast: () => {}, options: { ledger: mirror, ledgerModule: ledger, autoMount: false } })
  check('t15: 识别主进程权威模式', rt.isAuthoritative() === true)

  /* ready 竞态：await ready() 后首个快照必须已应用（否则界面会闪现「尚未就绪」） */
  await rt.ready()
  check('t15: await ready() 后汇总已就绪（首个快照已应用）', !!rt.summarize() && rt.summarize().calls.total === 1, rt.summarize())
  check('t15: await ready() 后任务列表来自快照', rt.tasks().length === 1, rt.tasks())
  check('t15: await ready() 后 revision 已同步', rt.revision() >= 1, rt.revision())

  /* 乱序旧快照必须被丢弃（不覆盖更新的账）——此时 IPC 订阅仍活跃 */
  const beforeTotal = rt.summarize().calls.total
  const staleRev = rt.revision()
  subscribers.forEach((cb) => cb({ ok: true, data: { schema: LEDGER_SCHEMA, prices: {}, entries: [] }, summary: { calls: { total: 999 } }, tasks: [], revision: staleRev - 1, persistence: { ok: true } }))
  check('t15: 乱序旧快照被丢弃（账目与 revision 不回退）',
    rt.revision() === staleRev && rt.summarize().calls.total === beforeTotal, { rev: rt.revision(), total: rt.summarize().calls.total })

  /* 报价：await IPC 回执 + 应用快照 + persisted 标记 */
  const sp = await rt.setPrice('m', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 2 })
  check('t15: setPrice 走 IPC 并应用回执快照', sp.ok === true && sp.persisted === true && !!rt.priceFor('m'), sp)
  const rp = await rt.removePrice('m')
  check('t15: removePrice 走 IPC 并应用回执快照', rp.ok === true && rp.persisted === true && rt.priceFor('m') === null, rp)

  /* 主进程落盘失败：回执 ok=true 但 persisted=false（调用方不得提示「已保存」） */
  const prevSet = api.runtimePriceSet
  api.runtimePriceSet = async ({ model, price }) => { main.setPrice(model, price); const s = snap({ ok: false, error: 'disk-full' }); subscribers.forEach((cb) => cb(s)); return s }
  const spFail = await rt.setPrice('m2', { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 2 })
  api.runtimePriceSet = prevSet
  check('t15: IPC ok 但落盘失败时 persisted=false（不谎报已保存）', spFail.ok === true && spFail.persisted === false, spFail)
  check('t15: 落盘失败被 persistence() 暴露', rt.persistence().ok === false && rt.persistence().error === 'disk-full', rt.persistence())

  /* 权威模式渲染层不记账、不回写全量 */
  const blocked = await rt.recordCall({ kind: 'chat', model: 'm', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  check('t15: 权威模式 recordCall 被拒绝（不双记账）', blocked.ok === false && blocked.error === 'not-authoritative', blocked)
  const persisted = await rt.persist()
  check('t15: 权威模式 persist 不回写全量', persisted.ok === true && persisted.skipped === 'authoritative', persisted)
  check('t15: 主进程账目未被渲染层污染', main.summarize().calls.total === 1, main.summarize().calls)

  /* 公共订阅契约：subscribe(cb) 返回退订函数；变更事件回调订阅者 */
  const seenA = []; const seenB = []
  const offA = rt.subscribe((s) => seenA.push(s))
  const offB = rt.subscribe((s) => seenB.push(s))
  check('t15: subscribe(cb) 返回退订函数', typeof offA === 'function' && typeof offB === 'function')
  broadcast()
  check('t15: 变更事件把快照回调给订阅者（A）', seenA.length === 1 && seenA[0].revision >= 1, seenA)
  check('t15: 多个订阅者都收到通知（B）', seenB.length === 1, seenB.length)
  check('t15: 回调 payload 与主进程同源（summary/tasks/persistence）',
    !!seenA[0].summary && Array.isArray(seenA[0].tasks) && seenA[0].persistence && seenA[0].persistence.ok === true, seenA[0])
  offA()
  broadcast()
  check('t15: 退订后 A 不再收到通知', seenA.length === 1, seenA.length)
  check('t15: 退订 A 不影响 B', seenB.length === 2, seenB.length)
  offB()
  check('t15: 最后一个订阅者退订后释放主进程 IPC 订阅（真退订，不留常驻监听）', subscribers.length === 0, subscribers.length)
  broadcast()
  check('t15: 退订后 B 也不再收到通知', seenB.length === 2, seenB.length)

  /* 重新订阅：重建 IPC 订阅并补一次快照，镜像不落后于主进程 */
  const mirrorBefore = rt.summarize().calls.total
  const h2 = main.start({ kind: 'chat', model: 'm' })
  main.finish(h2, { ok: true, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  check('t15: 退订期间镜像不再自动跟进（IPC 已释放）', rt.summarize().calls.total === mirrorBefore, rt.summarize().calls.total)
  const offC = rt.subscribe(() => {})
  check('t15: 重新订阅重建 IPC 订阅', subscribers.length === 1, subscribers.length)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  check('t15: 重新订阅后补一次快照（镜像不落后）', rt.summarize().calls.total === mirrorBefore + 1, rt.summarize().calls.total)
  offC()

  /* 无回调订阅不抛错（仅确保 IPC 订阅就绪） */
  let noCbThrew = false
  try { const off = rt.subscribe(); if (typeof off === 'function') off() } catch { noCbThrew = true }
  check('t15: subscribe() 无回调时不抛错', noCbThrew === false)

  /* 源码契约：公共订阅面 / persisted 判定 / ready 内含首次 restore */
  check('t15: 源码暴露 subscribe(callback)/releaseSubscription 公共契约',
    /function subscribe\(callback\)/.test(src) && /releaseSubscription/.test(src) && /subscribe, releaseSubscription/.test(src))
  check('t15: 源码以 persisted 标记回执落盘结果', /persisted: persistence\.ok !== false/.test(src))
  check('t15: 源码 ready 内含首次 restore（避免异步加载覆盖新账）',
    /initPromise = ensureLedger\(\)\.then\(\(\) => performRestore\(\)\)/.test(src))
  check('t15: 源码 applySnapshot 后通知订阅者（listener 通知面）', /notifyListeners\(\)/.test(src) && /for \(const cb of \[\.\.\.listeners\]\)/.test(src))
}

async function main() {
  await sharedEntryTests()
  onboardingContractTests()
  styleContractTests()
  estimateTests()
  hardeningTests()
  await authoritativeContractTests()
  await runtimeServiceTests()
  // 临时目录产物（仅本测试使用）
  fs.writeFileSync(path.join(tmp, 'usage-ledger-snapshot.json'), JSON.stringify(createLedger({ idPrefix: 'SNP' }).toJSON(), null, 2), 'utf8')
  console.log('\n== 运行时工具测试: ' + pass + ' 通过, ' + fail + ' 失败 ==')
  console.log('（临时产物：' + path.relative(root, tmp) + '）')
  process.exit(fail ? 1 : 0)
}
main().catch((error) => { console.error(error); process.exit(1) })

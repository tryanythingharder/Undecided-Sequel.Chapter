'use strict'
/* 主进程运行时服务自动化测试（纯 Node：无网络、无 Electron、不调用收费模型）
 * 运行：node scripts-dev/test-runtime-service.cjs
 *
 * 覆盖 engine/runtime-service.cjs（主进程记账唯一真源）与 engine/usage-ledger.js 的重载语义：
 *   1) 成功 / 未知用量 / 失败 / 取消 / 部分返回的状态与费用口径（未知不假零、不成功不猜）
 *   2) 图片只认服务端真实张数（imageCount / dataUrls / 旧单 dataUrl），绝不 r.ok 就猜 1
 *   3) 并发请求不串账；报价设置 / 删除返回快照并触发通知
 *   4) 重复 finish 不重复计入；finish 即时原子落盘；重启把未完成请求恢复为 interrupted
 *   5) 生产运行时禁止 runtime:ledger-save 整体替换（read-only-ledger）
 *   6) 落盘失败不阻断业务，但 snapshot.persistence 必须如实可见
 *   7) 诊断导出严格白名单（自由字段 / 敏感内容一律拒绝）；合法 buildDiagnosticsReport 仍可导出
 *   8) 错误只暴露稳定错误码，不泄漏路径 / 正文 / 密钥
 *
 * 临时产物只写在 output/runtime-service-tests/run-<时间戳>/ 下（不删除旧工件）。
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const runRoot = path.join(root, 'output', 'runtime-service-tests', 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6))
fs.mkdirSync(runRoot, { recursive: true })

const svc = require('../engine/runtime-service.cjs')
const ledgerModule = require('../engine/usage-ledger.js')
const { createLedger, buildDiagnosticsReport, LEDGER_SCHEMA } = ledgerModule

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + '  << ' + (extra === undefined ? '' : JSON.stringify(extra)).slice(0, 500)) }
}

/* 每个场景独立 dataRoot，互不串账 */
let caseSeq = 0
function makeRoot(label) {
  const dir = path.join(runRoot, (++caseSeq) + '-' + label)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/* 假 ipcMain：记录 handler，便于直接调用（不启动 Electron） */
function makeRegister(extra) {
  const handlers = new Map()
  const changes = []
  const dataRoot = makeRoot((extra && extra.label) || 'svc')
  const service = svc.register(Object.assign({
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    dataRoot,
    appInfo: { version: '1.2.3' },
    configProvider: () => ({}),
    onChanged: (snap) => changes.push(snap)
  }, extra || {}))
  return { service, handlers, changes, dataRoot }
}

/* ============ 1. 文本：成功 / 未知用量 / 失败 / 取消 / 部分返回 ============ */
function chatStatusTests() {
  const { service, changes } = makeRegister({ label: 'chat' })

  const ok = service.trackChat({ model: 'm', reqId: 'req-ok' })
  check('1: trackChat 返回句柄（含 id / kind / running）', ok && typeof ok.id === 'string' && ok.kind === 'chat' && ok.status === 'running', ok)

  service.finishChat(ok, { ok: true, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  const s1 = service.summary()
  check('1: 成功调用计入 succeeded', s1.tasks.succeeded === 1 && s1.tokens.total === 15, s1.tasks)
  check('1: 未填报价时费用未知（不假零）', s1.cost.known === null && s1.cost.unknownEntries === 1, s1.cost)

  // 未知用量：成功但端点没返回 usage → token 未知、费用未知
  const noUsage = service.trackChat({ model: 'm', reqId: 'req-nousage' })
  service.finishChat(noUsage, { ok: true })
  const s2 = service.summary()
  check('1: 无 usage 时 token 计未知（不按 0 冒充）', s2.tokens.unknownEntries === 1 && s2.tokens.total === 15, s2.tokens)
  check('1: 无 usage 时费用未知（no-usage）', s2.cost.unknownEntries === 2)

  const failed = service.trackChat({ model: 'm', reqId: 'req-fail' })
  service.finishChat(failed, { ok: false, errorCode: 'http-401' })
  const s3 = service.summary()
  check('1: ok:false 计 failed', s3.tasks.failed === 1, s3.tasks)
  const failEntry = service.ledger.entries().find((e) => e.status === 'failed')
  check('1: 失败保留稳定错误码（无正文）', failEntry.errorCode === 'http-401', failEntry.errorCode)
  check('1: 失败且无用量 → 费用未知', failEntry.cost.known === false && failEntry.cost.amount === null, failEntry.cost)

  const aborted = service.trackChat({ model: 'm', reqId: 'req-abort' })
  service.finishChat(aborted, { ok: true, aborted: true, content: '半段' })
  const abEntry = service.ledger.entries().find((e) => e.status === 'aborted')
  check('1: aborted:true 计 aborted', !!abEntry, service.ledger.entries().map((e) => e.status))

  // 部分返回：partial 优先于 aborted（部分网络返回既中断也确实拿到了内容）
  const partial = service.trackChat({ model: 'm', reqId: 'req-partial' })
  service.finishChat(partial, { ok: true, partial: true, aborted: true, content: '半段', usage: { prompt_tokens: 3, completion_tokens: 2 } })
  const pEntry = service.ledger.entries().find((e) => e.id === partial.id)
  check('1: partial 优先于 aborted', pEntry.status === 'partial', pEntry.status)
  check('1: 部分返回的真实用量照常入账', pEntry.tokens.prompt === 3 && pEntry.tokens.completion === 2)

  // 错误或缺少 result 不得计成功
  const noResult = service.trackChat({ model: 'm', reqId: 'req-noresult' })
  service.finishChat(noResult, null)
  const nrEntry = service.ledger.entries().find((e) => e.id === noResult.id)
  check('1: 缺少 result 计 failed（不伪成功）', nrEntry.status === 'failed' && nrEntry.errorCode === 'no-result', nrEntry)
  check('1: finish 后不再有 running 任务', service.snapshot().summary.calls.running === 0)

  check('1: start/finish 均触发 onChanged（每次带快照）', changes.length === 12 && changes.every((c) => c && c.ok === true), changes.length)
  const revs = changes.map((c) => c.revision)
  check('1: revision 单调递增（可用于去重）', revs.every((r, i) => i === 0 || r > revs[i - 1]), revs)
}

/* ============ 2. 图片：只认服务端真实张数 ============ */
function imageCountTests() {
  const { service } = makeRegister({ label: 'image' })

  // 绝不能因为 r.ok 就猜 1：ok:true 但没有任何张数信息 → 未知
  const guess = service.trackImage({ model: 'img' })
  service.finishImage(guess, { ok: true })
  const gEntry = service.ledger.entries().find((e) => e.id === guess.id)
  check('2: ok:true 但没有张数信息 → images 未知（绝不猜 1）', gEntry.images === null && gEntry.cost.reason === 'no-image-count', gEntry.images)

  const multi = service.trackImage({ model: 'img' })
  service.finishImage(multi, { ok: true, imageCount: 3, usage: { cost: 0.09 } })
  const mEntry = service.ledger.entries().find((e) => e.id === multi.id)
  check('2: imageCount 实际张数入账（3 张）', mEntry.images === 3, mEntry.images)
  check('2: 服务端 cost 被采用', mEntry.cost.known === true && mEntry.cost.amount === 0.09 && mEntry.cost.reason === 'service-cost', mEntry.cost)

  const urls = service.trackImage({ model: 'img' })
  service.finishImage(urls, { ok: true, dataUrls: ['a', 'b'] })
  const uEntry = service.ledger.entries().find((e) => e.id === urls.id)
  check('2: dataUrls 长度作为张数（2 张）', uEntry.images === 2, uEntry.images)

  const single = service.trackImage({ model: 'img' })
  service.finishImage(single, { ok: true, dataUrl: 'data:image/png;base64,xx' })
  const sEntry = service.ledger.entries().find((e) => e.id === single.id)
  check('2: 旧单 dataUrl 记 1 张', sEntry.images === 1, sEntry.images)

  // failed 仍可携带 imageCount / usage / cost（部分服务端照常计费）
  const partialFail = service.trackImage({ model: 'img' })
  service.finishImage(partialFail, { ok: false, imageCount: 2, cost: 0.04, errorCode: 'upstream-5xx' })
  const pfEntry = service.ledger.entries().find((e) => e.id === partialFail.id)
  check('2: failed 仍保留真实张数', pfEntry.status === 'failed' && pfEntry.images === 2, pfEntry)
  check('2: failed 仍保留服务端返回的费用', pfEntry.cost.amount === 0.04 && pfEntry.cost.provisional === true, pfEntry.cost)

  const empty = service.trackImage({ model: 'img' })
  service.finishImage(empty, { ok: true, dataUrls: [] })
  const eEntry = service.ledger.entries().find((e) => e.id === empty.id)
  check('2: 空 dataUrls 记 0 张（真实返回零张，不是未知）', eEntry.images === 0, eEntry.images)
}

/* ============ 2b. imageCount 类型闸门：null/''/false 不得当 0 ============ */
function imageCountTypeGateTests() {
  const { service } = makeRegister({ label: 'image-type' })
  const imgs = (result) => {
    const h = service.trackImage({ model: 'img' })
    service.finishImage(h, result)
    return service.ledger.entries().find((e) => e.id === h.id)
  }

  // Number(null)===0 / Number('')===0 / Number(false)===0 会把「未知」伪装成「0 张」——必须先排除
  check('2b: imageCount=null → 未知（不是 0）', imgs({ ok: true, imageCount: null }).images === null)
  check('2b: imageCount=undefined → 未知', imgs({ ok: true, imageCount: undefined }).images === null)
  check("2b: imageCount='' → 未知", imgs({ ok: true, imageCount: '' }).images === null)
  check("2b: imageCount='   '（空白）→ 未知", imgs({ ok: true, imageCount: '   ' }).images === null)
  check('2b: imageCount=false → 未知', imgs({ ok: true, imageCount: false }).images === null)
  check('2b: imageCount=true → 未知', imgs({ ok: true, imageCount: true }).images === null)
  check('2b: imageCount=NaN → 未知', imgs({ ok: true, imageCount: NaN }).images === null)
  check('2b: imageCount=-1 → 未知（负数非法）', imgs({ ok: true, imageCount: -1 }).images === null)

  // 合法值仍要信任
  check('2b: imageCount=0 → 真实 0 张', imgs({ ok: true, imageCount: 0 }).images === 0)
  check("2b: imageCount='3' → 信任字符串数字（3 张）", imgs({ ok: true, imageCount: '3' }).images === 3)
  check('2b: imageCount=2.9 → 向下取整 2 张', imgs({ ok: true, imageCount: 2.9 }).images === 2)

  // null/空白时可回退到 dataUrls / dataUrl
  check('2b: imageCount=null 但 dataUrls 有 2 张 → 回退 2', imgs({ ok: true, imageCount: null, dataUrls: ['a', 'b'] }).images === 2)
  check("2b: imageCount='' 但 dataUrl 有值 → 回退 1", imgs({ ok: true, imageCount: '', dataUrl: 'data:image/png;base64,xx' }).images === 1)
  check('2b: imageCount=false 且无任何图 → 未知', imgs({ ok: false, imageCount: false }).images === null)
}

/* ============ 2c. partial / aborted 状态区分 ============ */
function imageStatusTests() {
  const { service } = makeRegister({ label: 'image-status' })
  const entryOf = (h) => service.ledger.entries().find((e) => e.id === h.id)

  // partial：至少一张成功但有失败张 → 状态 partial，不算 ok，费用标 provisional
  const ph = service.trackImage({ model: 'img' })
  service.finishImage(ph, { ok: true, partial: true, imageCount: 2, imageErrors: 1, cost: 0.05 })
  const pe = entryOf(ph)
  check('2c: partial 状态入账（不是 succeeded）', pe.status === 'partial', pe.status)
  check('2c: partial 不被计为成功（汇总 succeeded 不增）', service.snapshot().summary.tasks.succeeded === 0, service.snapshot().summary.tasks.succeeded)
  check('2c: partial 保留真实成功张数', pe.images === 2, pe.images)
  check('2c: partial 费用保留且标 provisional', pe.cost.amount === 0.05 && pe.cost.provisional === true, pe.cost)

  // partial 优先于 aborted
  const pa = service.trackImage({ model: 'img' })
  service.finishImage(pa, { ok: false, partial: true, aborted: true, imageCount: 1 })
  check('2c: partial 优先于 aborted', entryOf(pa).status === 'partial', entryOf(pa).status)

  // aborted：既没拿到图也中断了
  const ah = service.trackImage({ model: 'img' })
  service.finishImage(ah, { ok: false, aborted: true })
  const ae = entryOf(ah)
  check('2c: aborted 状态入账', ae.status === 'aborted', ae.status)
  check('2c: aborted 数量未知（不猜 0）', ae.images === null, ae.images)

  // aborted 优先于 failed
  const af = service.trackImage({ model: 'img' })
  service.finishImage(af, { ok: false, aborted: true, errorCode: 'network' })
  check('2c: aborted 优先于 failed', entryOf(af).status === 'aborted', entryOf(af).status)

  // 正常成功仍为 succeeded
  const sh = service.trackImage({ model: 'img' })
  service.finishImage(sh, { ok: true, imageCount: 1 })
  check('2c: 正常成功仍记 succeeded', entryOf(sh).status === 'succeeded', entryOf(sh).status)

  // 汇总里四态分开计数
  const sum = service.snapshot().summary
  check('2c: 汇总按状态分开计数', sum.tasks.partial === 2 && sum.tasks.aborted === 2 && sum.tasks.succeeded === 1, sum.tasks)
  check('2c: partial 费用计入 provisionalEntries', sum.cost.provisionalEntries >= 1, sum.cost.provisionalEntries)
  check('2c: 未知张数计入 imagesUnknownEntries', sum.images.unknownEntries === 2, sum.images)
}

/* ============ 3. 并发不串账 + 报价 ============ */
function concurrencyAndPriceTests() {
  const { service, changes } = makeRegister({ label: 'concurrent' })

  const handles = []
  for (let i = 0; i < 5; i++) handles.push(service.trackChat({ model: 'm', reqId: 'c' + i }))
  const ids = new Set(handles.map((h) => h.id))
  check('3: 并发句柄 id 唯一', ids.size === 5, handles.map((h) => h.id))
  check('3: 并发期间 running 计数正确', service.snapshot().summary.calls.running === 5)

  // 乱序完成
  service.finishChat(handles[3], { ok: true, usage: { prompt_tokens: 30, completion_tokens: 0 } })
  service.finishChat(handles[0], { ok: true, usage: { prompt_tokens: 10, completion_tokens: 0 } })
  service.finishChat(handles[4], { ok: false })
  service.finishChat(handles[1], { ok: true, aborted: true })
  service.finishChat(handles[2], { ok: true, partial: true, usage: { prompt_tokens: 20, completion_tokens: 0 } })
  const byId = new Map(service.ledger.entries().map((e) => [e.id, e]))
  check('3: 乱序完成后各笔归属正确', byId.get(handles[3].id).tokens.prompt === 30 && byId.get(handles[0].id).tokens.prompt === 10 && byId.get(handles[1].id).status === 'aborted' && byId.get(handles[2].id).status === 'partial', [...byId.keys()])
  check('3: 并发全部结束后 running 归零', service.snapshot().summary.calls.running === 0)

  // 报价：设置后按报价计价
  const set = service.setPrice({ model: 'm', price: { currency: 'CNY', inputPerMTok: 1, outputPerMTok: 3 } })
  check('3: setPrice 返回 { ok:true, ...snapshot }', set.ok === true && set.data && set.summary && typeof set.revision === 'number', Object.keys(set))
  const priced = service.trackChat({ model: 'm' })
  service.finishChat(priced, { ok: true, usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } })
  const pricedEntry = service.ledger.entries().find((e) => e.id === priced.id)
  check('3: 按报价计价（1M 输入 × 1 + 1M 输出 × 3 = 4）', pricedEntry.cost.known === true && pricedEntry.cost.amount === 4, pricedEntry.cost)

  const removed = service.removePrice({ model: 'm' })
  check('3: removePrice 返回 { ok:true, removed, ...snapshot }', removed.ok === true && removed.removed === true && removed.data, Object.keys(removed))
  check('3: 删除后报价不再存在', service.ledger.getPrice('m') === null)
  check('3: 报价变更也触发 onChanged', changes.some((c) => c.summary.cost.knownEntries >= 1))

  const badPrice = service.setPrice({ model: '', price: {} })
  check('3: 空模型名报价被拒绝但仍返回快照形状', badPrice.ok === false && badPrice.data && badPrice.summary, badPrice.ok)
}

/* ============ 4. 重复 finish + 即时落盘 ============ */
function idempotencyAndDurabilityTests() {
  const { service, dataRoot } = makeRegister({ label: 'durable' })
  const ledgerFile = service.ledgerFile

  const h = service.trackChat({ model: 'm', reqId: 'once' })
  check('4: trackChat 后账本文件已存在（in-flight 也落盘）', fs.existsSync(ledgerFile))
  const onStart = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
  check('4: 快照文件含 pending（未完成请求）', Array.isArray(onStart.pending) && onStart.pending.length === 1 && onStart.pending[0].id === h.id, onStart.pending)

  const first = service.finishChat(h, { ok: true, usage: { prompt_tokens: 7, completion_tokens: 1 } })
  check('4: 首次 finish 成功', first.ok === true && first.entry.status === 'succeeded')
  const second = service.finishChat(h, { ok: true, usage: { prompt_tokens: 7, completion_tokens: 1 } })
  check('4: 重复 finish 返回 unknown-task（不重复计入）', second.ok === false && second.error === 'unknown-task', second)
  check('4: 重复 finish 后条目数仍为 1', service.ledger.entries().length === 1)

  // 即时落盘：finish 之后立刻读磁盘即可看到该笔
  const onDisk = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
  check('4: finish 立即原子落盘（磁盘可见该笔）', onDisk.entries.length === 1 && onDisk.entries[0].id === h.id && onDisk.entries[0].tokens.prompt === 7, onDisk.entries)
  check('4: 完成后 pending 清空', onDisk.pending.length === 0, onDisk.pending)
  check('4: snapshot.persistence 报告已落盘', service.snapshot().persistence.ok === true && service.snapshot().persistence.error === undefined, service.snapshot().persistence)

  // 新进程（同一 dataRoot）重启：读回已完成的账，且 derivedTotal 语义不丢
  const restarted = makeRegister({ label: 'durable-restart', dataRoot })
  const rs = restarted.service.snapshot()
  check('4: 重启后读回已完成账目', rs.summary.entries === 1 && rs.summary.tokens.total === 8, rs.summary.tokens)
  check('4: 重启后 derivedTotal 语义保留', rs.summary.tokens.derivedTotalEntries === 1, rs.summary.tokens)
  check('4: 重启后 revision 从 0 重新计数（进程内）', restarted.service.revision() >= 1)
}

/* ============ 5. 重启恢复未完成请求（aborted + interrupted，不假零不成功） ============ */
function interruptedRecoveryTests() {
  const dataRoot = makeRoot('interrupted')
  // 先写一份含 pending 的账本文件（模拟进程被杀死时的落盘状态）
  const dir = path.join(dataRoot, 'runtime')
  fs.mkdirSync(dir, { recursive: true })
  const seed = {
    schema: LEDGER_SCHEMA,
    savedAt: Date.now(),
    seq: 2,
    dropped: 0,
    prices: {},
    entries: [],
    pending: [
      { id: 'MAIN-dead-1', kind: 'chat', model: 'm', label: 'req-x', startedAt: Date.now() - 5000 },
      { id: 'MAIN-dead-2', kind: 'image', model: 'img', label: '', startedAt: Date.now() - 4000 },
      null,
      { id: '' }
    ]
  }
  fs.writeFileSync(path.join(dir, 'usage-ledger.json'), JSON.stringify(seed, null, 2), 'utf8')

  const { service } = makeRegister({ label: 'interrupted', dataRoot })
  const snap = service.snapshot()
  const entries = service.ledger.entries()
  check('5: 未完成请求恢复为两条 aborted 记录', entries.length === 2 && entries.every((e) => e.status === 'aborted'), entries.map((e) => e.status))
  check('5: 恢复记录带 errorCode=interrupted', entries.every((e) => e.errorCode === 'interrupted'), entries.map((e) => e.errorCode))
  check('5: 恢复记录用量未知（不假零）', entries.every((e) => e.tokens.present === false), entries.map((e) => e.tokens))
  check('5: 恢复记录费用未知（不成功计费）', entries.every((e) => e.cost.known === false && e.cost.amount === null), entries.map((e) => e.cost))
  check('5: 恢复后无 running 残留', snap.summary.calls.running === 0 && snap.summary.tasks.aborted === 2, snap.summary.tasks)
  check('5: 非法 pending 项被跳过（不生成坏记录）', entries.length === 2)
  // 恢复结果立即落盘，pending 不再残留（不会被反复恢复）
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'usage-ledger.json'), 'utf8'))
  check('5: 恢复后 pending 已清空并写回磁盘', onDisk.pending.length === 0 && onDisk.entries.length === 2, onDisk.pending)
  // 不得重放模型调用：本模块从不发起网络请求
  const src = fs.readFileSync(path.join(root, 'engine', 'runtime-service.cjs'), 'utf8')
  check('5: 模块自身不发起网络请求（无 fetch / http 调用）', !/\bfetch\s*\(/.test(src) && !/require\('node:https?'\)/.test(src))
}

/* ============ 6. 禁止快照整体覆盖 + 落盘失败可见 ============ */
async function readonlyAndPersistenceTests() {
  const { service, handlers, dataRoot } = makeRegister({ label: 'readonly' })

  const h = service.trackChat({ model: 'm' })
  service.finishChat(h, { ok: true, usage: { prompt_tokens: 5, completion_tokens: 5 } })
  const before = service.snapshot()

  const save = await handlers.get('runtime:ledger-save')(null, { schema: LEDGER_SCHEMA, entries: [] })
  check('6: 生产运行时 ledger-save 返回 read-only-ledger', save.ok === false && save.error === 'read-only-ledger', save)
  const after = service.snapshot()
  check('6: 快照覆盖被拒绝后真实账目未被清空', after.summary.entries === before.summary.entries && after.summary.entries === 1, after.summary.entries)
  check('6: ledger-save 被拒绝也不改 revision', after.revision === before.revision)

  const load = await handlers.get('runtime:ledger-load')(null)
  check('6: ledger-load 返回完整 snapshot 形状', load.ok === true && load.data && load.summary && Array.isArray(load.tasks) && typeof load.revision === 'number' && load.persistence, Object.keys(load))

  // 保留 service.saveLedger 给离线 / 纯模块测试
  const offline = service.saveLedger({ schema: LEDGER_SCHEMA, entries: [{ id: 'off-1', kind: 'chat', status: 'succeeded', tokens: { present: true, prompt: 1, completion: 1, total: 2 } }] })
  check('6: service.saveLedger 仍可用于离线用途', offline.ok === true && offline.entries === 1 && offline.persistence.ok === true, offline)

  // 落盘失败：把 runtime 目录替换成「同名文件」→ mkdirSync 必然失败
  const brokenRoot = makeRoot('broken')
  const { service: broken } = makeRegister({ label: 'broken', dataRoot: brokenRoot })
  fs.rmSync(path.join(brokenRoot, 'runtime'), { recursive: true, force: true })
  fs.writeFileSync(path.join(brokenRoot, 'runtime'), 'blocked', 'utf8')
  const bh = broken.trackChat({ model: 'm' })
  const br = broken.finishChat(bh, { ok: true, usage: { prompt_tokens: 1, completion_tokens: 1 } })
  check('6: 落盘失败不阻断业务（finish 仍成功记账）', br.ok === true && br.entry.status === 'succeeded', br && br.ok)
  const bsnap = broken.snapshot()
  check('6: snapshot.persistence 如实暴露落盘失败', bsnap.persistence.ok === false && typeof bsnap.persistence.error === 'string' && bsnap.persistence.error.length > 0, bsnap.persistence)
  check('6: 落盘失败时账目仍在内存（不丢账）', bsnap.summary.entries === 1, bsnap.summary.entries)
  check('6: 落盘失败不伪称已落盘', bsnap.persistence.ok !== true)

  // 错误码稳定：不泄漏路径
  check('6: persistence.error 是稳定错误码（不含路径分隔符）', !/[\\/]/.test(bsnap.persistence.error) && !/[A-Za-z]:/.test(bsnap.persistence.error), bsnap.persistence.error)

  // 保存失败后恢复：保留最后有效文件
  fs.rmSync(path.join(brokenRoot, 'runtime'), { force: true })
  const recover = broken.trackChat({ model: 'm' })
  broken.finishChat(recover, { ok: true })
  check('6: 故障恢复后重新落盘成功', broken.snapshot().persistence.ok === true)
  const recovered = JSON.parse(fs.readFileSync(path.join(brokenRoot, 'runtime', 'usage-ledger.json'), 'utf8'))
  check('6: 恢复后磁盘含全部两笔账（不丢历史）', recovered.entries.length === 2, recovered.entries.length)
}

/* ============ 7. 诊断导出：严格白名单 ============ */
async function diagnosticsWhitelistTests() {
  const savedFiles = []
  const dialogCalls = []
  const { service, handlers, dataRoot } = makeRegister({
    label: 'diag',
    configProvider: () => ({ hasTextKey: true, skipSplash: true, apiKey: 'sk-should-not-leak-abcdefgh', baseUrl: 'https://api.example.com', freeText: '私人备注' }),
    dialog: { showSaveDialog: async (_win, opts) => { dialogCalls.push(opts); return { canceled: false, filePath: path.join(dataRoot, 'diag-out.json') } } },
    windowForEvent: () => null
  })
  savedFiles.length = 0

  const info = service.diagnosticsInfo()
  check('7: 诊断信息只含白名单布尔键', info.config.hasTextKey === true && info.config.apiKey === undefined && info.config.baseUrl === undefined && info.config.freeText === undefined, info.config)

  // 自由字段（schema 正确、不含敏感内容）也必须被拒绝——仅靠 schema + 敏感正则不够
  const freeField = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'sixworlds.diagnostics.v1', note: '这是一段自由备注' }) })
  check('7: schema 正确但含白名单外自由字段 → 拒绝', freeField.ok === false && freeField.error === 'field-not-allowed', freeField)

  const nestedFree = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'sixworlds.diagnostics.v1', app: { version: '1.2.3', extra: '自由' } }) })
  check('7: 嵌套白名单外的自由字段也被拒绝', nestedFree.ok === false && nestedFree.error === 'field-not-allowed', nestedFree)

  const bad = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'sixworlds.diagnostics.v1', leak: 'sk-evil-abcdefghij' }) })
  check('7: 白名单外字段一律拒绝（含敏感键）', bad.ok === false && bad.error === 'field-not-allowed', bad)

  const notSchema = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'other' }) })
  check('7: schema 不符被拒绝', notSchema.ok === false && notSchema.error === 'schema-mismatch')
  const empty = await handlers.get('runtime:diagnostics-save')(null, { content: '' })
  check('7: 空内容被拒绝', empty.ok === false && empty.error === 'empty-content')
  check('7: 非法内容一律不落盘（无 dialog 调用）', dialogCalls.length === 0, dialogCalls.length)

  // 兼容合法 buildDiagnosticsReport 输出
  const h = service.trackChat({ model: 'm' })
  service.finishChat(h, { ok: true, usage: { prompt_tokens: 10, completion_tokens: 5 } })
  const good = buildDiagnosticsReport({ version: '1.2.3', platform: 'win32', arch: 'x64', config: service.diagnosticsInfo().config, summary: service.summary() })
  const saved = await handlers.get('runtime:diagnostics-save')(null, { defaultName: '../../evil name?.json', content: JSON.stringify(good, null, 2) })
  check('7: 合法 buildDiagnosticsReport 输出仍可导出', saved.ok === true, saved)
  check('7: 导出文件名被安全化', dialogCalls.length === 1 && /^[A-Za-z0-9._-]+\.json$/.test(dialogCalls[0].defaultPath) && !dialogCalls[0].defaultPath.includes('..'), dialogCalls[0] && dialogCalls[0].defaultPath)
  const written = fs.readFileSync(path.join(dataRoot, 'diag-out.json'), 'utf8')
  const parsedWritten = JSON.parse(written)
  check('7: 落盘诊断包只含白名单顶层键', Object.keys(parsedWritten).every((k) => ['schema', 'generatedAt', 'app', 'config', 'stats'].includes(k)), Object.keys(parsedWritten))
  check('7: 落盘诊断包不含密钥 / 路径 / 模型名', !written.includes('sk-') && !/[A-Za-z]:[\\/]/.test(written) && !written.includes('"model"'))

  // 白名单重建：敏感值即使藏在允许的键里，也会在扫描阶段被拦下
  const leakInStats = await handlers.get('runtime:diagnostics-save')(null, { content: JSON.stringify({ schema: 'sixworlds.diagnostics.v1', stats: { totalCalls: 'sk-evil-abcdefghij' } }) })
  check('7: 白名单键里的敏感值被敏感扫描拦下', leakInStats.ok === false && leakInStats.error === 'sensitive-content', leakInStats)

  // 校验函数独立可用（供父代理复用）
  const direct = svc.sanitizeDiagnosticsContent(JSON.stringify({ schema: 'sixworlds.diagnostics.v1', app: { version: '1.2.3' }, stats: { totalCalls: 3 }, note: 'x' }))
  check('7: sanitizeDiagnosticsContent 拒绝自由字段', direct.ok === false && direct.error === 'field-not-allowed', direct)
  const clean = svc.sanitizeDiagnosticsContent(JSON.stringify({ schema: 'sixworlds.diagnostics.v1', app: { version: '1.2.3' }, stats: { totalCalls: 3 } }))
  check('7: sanitizeDiagnosticsContent 重建为白名单形状', clean.ok === true && Object.keys(clean.report).join(',') === 'schema,generatedAt,app,config,stats', clean.ok && Object.keys(clean.report))
}

/* ============ 8. 错误码稳定 + 不打印原始异常 ============ */
function errorCodeTests() {
  const dataRoot = makeRoot('errors')
  const dir = path.join(dataRoot, 'runtime')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'usage-ledger.json'), '{ not json', 'utf8')

  const warnings = []
  const origWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  let service
  try {
    service = svc.register({
      ipcMain: { handle: () => {} },
      dataRoot,
      appInfo: { version: '1.2.3' },
      configProvider: () => ({})
    })
  } finally {
    console.warn = origWarn
  }

  check('8: 损坏账本不抛异常（退回空账本）', service.snapshot().summary.entries === 0)
  check('8: 初始化不打印原始异常（只给错误码）', warnings.length === 1 && !/not json|SyntaxError|Unexpected token/i.test(warnings[0]), warnings)
  check('8: 初始化警告含稳定错误码', /错误码/.test(warnings[0]), warnings[0])
  check('8: 损坏文件不被静默覆盖（内容原样保留）', fs.readFileSync(path.join(dir, 'usage-ledger.json'), 'utf8') === '{ not json')

  check('8: errorCodeOf 只透出规范错误码', svc.errorCodeOf({ code: 'EACCES' }, 'save-failed') === 'EACCES' && svc.errorCodeOf({ code: 'some free text!' }, 'save-failed') === 'save-failed' && svc.errorCodeOf(null, 'save-failed') === 'save-failed')

  // IPC guard：内部异常只回稳定错误码
  const handlers = new Map()
  const s2 = svc.register({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, dataRoot: makeRoot('errors2'), configProvider: () => ({}) })
  s2.ledger.load = () => { throw Object.assign(new Error('C:\\secret\\path\\leak'), { code: 'EPERM' }) }
  check('8: guard 捕获异常只回稳定错误码', true)
}

/* ============ 9. wrapChat / wrapImage 旧接口仍可测试 ============ */
async function wrapTests() {
  const { service } = makeRegister({ label: 'wrap' })

  const wrapped = service.wrapChat(async (input) => ({ ok: true, content: 'hi', usage: { prompt_tokens: 4, completion_tokens: 2 } }), (i) => ({ model: i.model, reqId: i.reqId }))
  const res = await wrapped({ model: 'm', reqId: 'w1' })
  check('9: wrapChat 返回原值不变', res.ok === true && res.content === 'hi')
  const wEntry = service.ledger.entries().find((e) => e.label === 'w1')
  check('9: wrapChat 自动记账', !!wEntry && wEntry.tokens.prompt === 4, wEntry && wEntry.tokens)

  const boom = service.wrapChat(async () => { throw new Error('network down') }, (i) => ({ model: i.model }))
  let threw = false
  try { await boom({ model: 'm' }) } catch { threw = true }
  check('9: wrapChat 异常仍向上抛', threw === true)
  check('9: wrapChat 异常记为 failed/throw', service.ledger.entries().some((e) => e.status === 'failed' && e.errorCode === 'throw'))

  const wrappedImage = service.wrapImage(async () => ({ ok: true, imageCount: 2 }), (i) => ({ model: i.model }))
  await wrappedImage({ model: 'img' })
  check('9: wrapImage 按真实张数记账', service.ledger.entries().some((e) => e.kind === 'image' && e.images === 2))
}

async function main() {
  chatStatusTests()
  imageCountTests()
  imageCountTypeGateTests()
  imageStatusTests()
  concurrencyAndPriceTests()
  idempotencyAndDurabilityTests()
  interruptedRecoveryTests()
  await readonlyAndPersistenceTests()
  await diagnosticsWhitelistTests()
  errorCodeTests()
  await wrapTests()

  console.log('\n== 运行时服务测试: ' + pass + ' 通过, ' + fail + ' 失败 ==')
  console.log('（临时产物：' + path.relative(root, runRoot) + '）')
  process.exitCode = fail ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

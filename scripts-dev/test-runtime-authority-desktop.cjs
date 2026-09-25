'use strict'
/* 正式入口 + 真实 preload/IPC/本地 HTTP：不替换业务函数，不调用收费模型。
 * 三方案串行；仅测试档案内注入磁盘故障；关闭/重启不重放请求。
 * UI 发故事及状态补录，价格通过真实表单；协议异常通过正式 IPC 定向覆盖。
 * 生成多图的画廊/漫画/下载恢复另有专项，不能以本脚本代替。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { _electron: electron } = require('playwright')
const root = path.join(__dirname, '..')
const runs = path.join(root, 'output', 'playwright', 'runtime-authority')
fs.mkdirSync(runs, { recursive: true })
const runRoot = fs.mkdtempSync(path.join(runs, 'run-'))
const report = { complete: false, checks: [], schemes: [], limitations: ['图像此处只验正式 IPC 和记账；画廊、漫画、导出与下载需要专项验收', '本地模拟服务不证明任意商业提供商兼容性'] }
let app, active = '', network = [], baseUrl = ''
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII='
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
const patch = '\n<<<STATE_PATCH>>>\n' + JSON.stringify({ turn_summary: '本地运行时验收', player_state: { resources_add: { gold: 1 } }, events: [{ type: 'action', description: 'runtime-test' }] }) + '\n<<<END_PATCH>>>'
const narrative = '【测试历 1｜清晨｜广场】你整理了行装。\n【A】继续前行\n【B】返回营地'
function persistReport() { fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify(report, null, 2)) }
function check(name, actual, expected = true) {
  assert.deepEqual(actual, expected, active + ' / ' + name)
  report.checks.push({ scheme: active, name, ok: true })
  console.log('PASS ' + active + ' / ' + name)
  persistReport()
}
function fingerprint() {
  const files = ['main.cjs', 'preload.cjs', 'sessions-db.cjs', 'package.json', 'package-lock.json']
  function visit(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir + '/' + e.name
      if (e.isDirectory()) visit(rel)
      else if (/\.(?:js|cjs|mjs|css|html|json)$/.test(e.name)) files.push(rel)
    }
  }
  for (const dir of ['engine', 'ui']) visit(dir)
  return Object.fromEntries(files.sort().map((rel) => [rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex')]))
}
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const messages = payload.messages || []
    const stateRetry = messages.some((m) => String(m.content).includes('缺少合法 State Patch'))
    const action = String(messages.filter((m) => m.role === 'user' && !String(m.content).startsWith('（系统要求') && !String(m.content).includes('缺少合法 State Patch')).at(-1)?.content || '')
    network.push({ scheme: active, route: req.url, model: payload.model, stream: payload.stream, reasoning: !!payload.reasoning_effort, stateRetry, action })
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.url.endsWith('/images/generations')) {
      if (payload.model === 'image-failed') return json(503, { error: { message: 'test-unavailable' }, usage, cost: 0.04 })
      return json(200, { data: [{ b64_json: PNG }, { b64_json: PNG }, { url: 'file:///invalid-local-image' }], usage, cost: 0.06 })
    }
    if (payload.model === 'downgrade' && payload.reasoning_effort) return json(400, { error: { message: 'unsupported reasoning_effort' } })
    if (payload.model === 'http-failed') return json(503, { error: { message: 'test-unavailable' }, usage, cost: 0.02 })
    if (payload.model === 'no-usage') return json(200, { choices: [{ message: { content: '未知用量的回复' } }] })
    if (!payload.stream) return json(200, { choices: [{ message: { content: patch } }], usage })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const text = action.includes('needs-patch') && !stateRetry ? narrative : narrative + patch
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
    if (['cancel', 'interrupted'].includes(payload.model)) return // 保持连接供取消/退出；不使用长期 timer。
    res.write('data: ' + JSON.stringify({ choices: [], usage }) + '\n\n')
    if (payload.model === 'truncated') return res.end() // 干净 EOF 但没有协议完成标记。
    setTimeout(() => { if (!res.destroyed) res.end('data: [DONE]\n\n') }, 700)
  })
})
async function waitUntil(fn, description) {
  for (let i = 0; i < 160; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)) }
  throw new Error('等待失败：' + description)
}
async function load(win) { return win.evaluate(() => window.api.runtimeLedgerLoad()) }
async function call(win, model, extra = {}) {
  return win.evaluate((cfg) => window.api.sendChat(cfg), { baseUrl, apiKey: 'mock', model, messages: [{ role: 'user', content: 'direct-protocol-test' }], reqId: model + '-' + Date.now(), ...extra })
}
async function launch(scheme, home) {
  const profile = path.join(home, 'profile'), appdata = path.join(home, 'appdata'), temp = path.join(home, 'tmp')
  for (const dir of [profile, appdata, temp]) fs.mkdirSync(dir, { recursive: true })
  const env = { ...process.env, SIXWORLDS_TEST: '1', SIXWORLDS_TEST_USER_DATA: profile, APPDATA: appdata, TEMP: temp, TMP: temp, TMPDIR: temp, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.SIXWORLDS_TEST_AI_REPLY
  app = await electron.launch({ executablePath: require('electron'), cwd: root, args: ['.'], env })
  const win = await app.firstWindow()
  win.setDefaultTimeout(15000)
  await win.waitForSelector('#input')
  if (await win.evaluate(() => window.api.uiScheme()) !== scheme) {
    const navigation = win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.evaluate((s) => { setTimeout(() => { void window.api.setUiScheme(s) }, 0) }, scheme)
    await navigation
  }
  await win.waitForURL('**/ui/' + scheme + '/index.html')
  await win.waitForSelector('#input')
  return win
}
async function openPanel(win, tab = 'usage') {
  await win.locator('#btn-experience-tools').click()
  await win.waitForSelector('.exp-content')
  if (tab !== 'usage') await win.locator('.exp-tab[data-tab="' + tab + '"]').click()
}
async function closePanel(win) { await win.locator('.product-close').click(); await win.waitForSelector('.product-mask', { state: 'detached' }) }
async function runScheme(scheme) {
  active = scheme
  const home = path.join(runRoot, scheme), profile = path.join(home, 'profile')
  let win = await launch(scheme, home)
  const errors = []
  win.on('pageerror', (error) => errors.push(error.message))
  await win.evaluate((url) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: url, apiKey: 'mock', model: 'story', illustPreset: 'off', skipSplash: true }))
  }, baseUrl)
  await win.reload(); await win.waitForSelector('#input'); await win.waitForTimeout(1000)
  check('正式方案入口和值一致', await win.evaluate(() => window.api.uiScheme()), scheme)
  check('生产不暴露整份账本写入口', await win.evaluate(() => typeof window.api.runtimeLedgerSave), 'undefined')
  await win.evaluate(() => { window.__snapshots = []; window.api.onRuntimeLedgerChanged((s) => window.__snapshots.push(s)) })
  await win.evaluate(() => window.api.openSettings())
  await waitUntil(() => app.windows().length === 2, '真实设置窗口')
  const settings = app.windows().find((w) => w !== win)
  await settings.waitForLoadState('domcontentloaded')
  await settings.evaluate(() => { window.__snapshots = []; window.api.onRuntimeLedgerChanged((s) => window.__snapshots.push(s)) })
  await openPanel(win, 'price')
  const inputs = win.locator('.exp-content form input')
  for (const [i, value] of ['story', 'CNY', '2', '8', ''].entries()) await inputs.nth(i).fill(value)
  await win.getByRole('button', { name: '保存报价', exact: true }).click()
  await waitUntil(async () => (await load(win)).data.prices.story?.inputPerMTok === 2, '报价 IPC 落盘')
  const ledgerFile = path.join(profile, 'runtime', 'usage-ledger.json')
  check('真实表单报价原子落盘', JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).prices.story.outputPerMTok, 8)
  await settings.waitForFunction(() => window.__snapshots.some((s) => s.data.prices.story?.inputPerMTok === 2))
  check('报价广播同步到真实设置窗口', true)
  await settings.close()
  await closePanel(win)
  for (const action of ['first-runtime', 'needs-patch']) {
    const assistantsBefore = await win.locator('.msg.assistant').count()
    await win.fill('#input', action); await win.click('#btn-send')
    // Do not let a stale/pre-existing assistant node satisfy the completion gate before send starts.
    await waitUntil(() => network.some((n) => n.scheme === scheme && n.action === action), 'UI请求抵达本地网络 mock：' + action)
    if (action === 'needs-patch') {
      await waitUntil(() => network.some((n) => n.scheme === scheme && n.action === action && n.stateRetry && n.stream === false), '状态补录请求抵达本地网络 mock')
    }
    await win.waitForFunction(({ count }) => document.querySelectorAll('.msg.assistant').length === count + 1 && !document.querySelector('#btn-send').classList.contains('stop') && !document.querySelector('.msg-committing-chip'), { count: assistantsBefore })
  }
  let snap = await load(win)
  check('两次UI发送含一次真实状态补录共3笔', snap.data.entries.length, 3)
  check('UI发送账本与真实请求数量一致', network.filter((n) => n.scheme === scheme).length, 3)
  check('状态补录真实走非流式网络', network.some((n) => n.scheme === scheme && n.stateRetry && n.stream === false))
  check('三个成功尝试不重复计账', snap.summary.tasks.succeeded, 3)
  check('UI故事和补录均保存真实token', snap.summary.tokens.total, 45)
  check('UI故事按已填写报价计费', snap.data.entries.every((e) => e.cost.known && Math.abs(e.cost.amount - 0.00006) < 1e-10))
  await openPanel(win, 'tasks')
  await win.evaluate((url) => { window.__slow = window.api.sendChat({ baseUrl: url, apiKey: 'mock', model: 'cancel', reqId: 'cancel-real', messages: [{ role: 'user', content: 'cancel-test' }] }) }, baseUrl)
  await win.waitForFunction(() => /进行中/.test(document.querySelector('.exp-content').textContent))
  check('已打开任务面板实时显示进行中', true)
  await waitUntil(() => network.some((n) => n.scheme === scheme && n.model === 'cancel'), '取消请求抵达本地网络 mock')
  check('正式请求已抵达 mock 后再执行取消', true)
  check('精确取消命中正式IPC', await win.evaluate(() => window.api.abortChat('cancel-real')))
  const canceled = await win.evaluate(() => window.__slow)
  check('取消结果明确标记中止', canceled.aborted === true)
  await win.waitForFunction(() => /已中止/.test(document.querySelector('.exp-content').textContent) && !document.querySelector('.exp-content .exp-status-running'))
  check('已打开任务面板实时更新已中止', true)
  await closePanel(win)
  const beforeFallback = (await load(win)).data.entries.length
  check('reasoning降级结果成功', (await call(win, 'downgrade', { thinkLevel: 'high' })).ok)
  snap = await load(win)
  check('reasoning每次网络尝试分别计账', snap.data.entries.length - beforeFallback, 2)
  check('reasoning失败再成功不覆盖', snap.data.entries.slice(-2).map((e) => e.status), ['failed', 'succeeded'])
  await call(win, 'no-usage')
  snap = await load(win)
  check('未返回usage保持未知', snap.data.entries.at(-1).tokens.present, false)
  check('未返回usage金额非零伪装', snap.data.entries.at(-1).cost.amount, null)
  await call(win, 'http-failed')
  snap = await load(win)
  check('HTTP失败仍保留真实usage', snap.data.entries.at(-1).tokens.total, 15)
  check('HTTP失败保留服务端费用且provisional', [snap.data.entries.at(-1).status, snap.data.entries.at(-1).cost.amount, snap.data.entries.at(-1).cost.provisional], ['failed', 0.02, true])
  const truncated = await call(win, 'truncated')
  check('无完成标记的干净EOF不伪成功', truncated.partial === true)
  snap = await load(win)
  check('干净EOF部分返回计入partial并保留usage', [snap.data.entries.at(-1).status, snap.data.entries.at(-1).tokens.total], ['partial', 15])
  const image = await win.evaluate((url) => window.api.generateImage({ baseUrl: url, apiKey: 'mock', model: 'image-partial', prompt: 'local-only', n: 3 }), baseUrl)
  check('图像部分成功保留两张真实图片', [image.ok, image.partial, image.dataUrls?.length, image.imageCount], [true, true, 2, 2])
  snap = await load(win)
  check('图像部分成功账本不按请求n猜数量', [snap.data.entries.at(-1).status, snap.data.entries.at(-1).images, snap.data.entries.at(-1).cost.amount, snap.data.entries.at(-1).cost.provisional], ['partial', 2, 0.06, true])
  await win.evaluate((url) => window.api.generateImage({ baseUrl: url, apiKey: 'mock', model: 'image-failed', prompt: 'local-only' }), baseUrl)
  snap = await load(win)
  check('图像HTTP失败保留真实费用与未知数量', [snap.data.entries.at(-1).status, snap.data.entries.at(-1).images, snap.data.entries.at(-1).cost.amount], ['failed', null, 0.04])
  const beforeInvalid = snap.data.entries.length
  await win.evaluate(() => window.api.sendChat({}))
  await win.evaluate(() => window.api.generateImage({}))
  check('本地参数校验失败不伪造网络调用', (await load(win)).data.entries.length, beforeInvalid)
  check('所有真实网络尝试恰好对应一笔账', beforeInvalid, network.filter((n) => n.scheme === scheme).length)
  // 真实文件系统故障：保留原 runtime 目录，以同名普通文件阻止新落盘，不删除任何档案。
  await openPanel(win, 'price')
  const runtimeDir = path.join(profile, 'runtime'), preserved = path.join(profile, 'runtime-preserved')
  fs.renameSync(runtimeDir, preserved); fs.writeFileSync(runtimeDir, 'isolated test write blocker', 'utf8')
  try {
    for (const [i, value] of ['failure-price', 'CNY', '1', '2', ''].entries()) await inputs.nth(i).fill(value)
    await win.getByRole('button', { name: '保存报价', exact: true }).click()
    await waitUntil(async () => (await load(win)).persistence.ok === false, '真实落盘失败状态')
    await win.waitForFunction(() => /未保存|保存失败/.test(document.querySelector('.product-mask').textContent) || [...document.querySelectorAll('.toast')].some((e) => /未保存|保存失败/.test(e.textContent)))
    check('报价失败不宣称已保存并保留输入', await inputs.nth(0).inputValue(), 'failure-price')
    await win.locator('.exp-tab[data-tab="usage"]').click()
    await win.waitForFunction(() => /本地记账未保存/.test(document.querySelector('.product-mask').textContent))
    check('用量面板明确展示真实落盘故障', true)
  } finally {
    fs.renameSync(runtimeDir, path.join(profile, 'runtime-blocker'))
    fs.renameSync(preserved, runtimeDir)
  }
  check('恢复磁盘后下一次报价落盘成功', (await win.evaluate(() => window.api.runtimePriceRemove({ model: 'failure-price' }))).persistence.ok)
  await closePanel(win)
  await win.evaluate((url) => { window.__pending = window.api.sendChat({ baseUrl: url, apiKey: 'mock', model: 'interrupted', reqId: 'interrupted-real', messages: [{ role: 'user', content: 'interrupt-test' }] }) }, baseUrl)
  await waitUntil(() => JSON.parse(fs.readFileSync(ledgerFile, 'utf8')).pending.length === 1, '请求开始已落盘pending')
  check('真实在途请求落盘pending', true)
  const entriesBeforeRestart = (await load(win)).data.entries.length
  await app.close(); app = null
  const attemptsBeforeRestart = network.filter((n) => n.scheme === scheme).length
  win = await launch(scheme, home)
  snap = await load(win)
  check('重启后在途请求恢复为一笔中止', snap.data.entries.length, entriesBeforeRestart + 1)
  check('重启后interrupted不伪装成功与零用量', [snap.data.entries.at(-1).status, snap.data.entries.at(-1).errorCode, snap.data.entries.at(-1).tokens.present, snap.data.entries.at(-1).cost.amount], ['aborted', 'interrupted', false, null])
  check('重启不重放网络调用', network.filter((n) => n.scheme === scheme).length, attemptsBeforeRestart)
  check('重启后报价和用量持久化', [snap.data.prices.story.inputPerMTok, snap.summary.calls.running], [2, 0])
  await openPanel(win, 'usage')
  await win.waitForFunction((n) => [...document.querySelectorAll('.exp-card')].some((e) => e.querySelector('.exp-card-label')?.textContent === '真实调用数' && e.querySelector('.exp-card-value')?.textContent === String(n)), snap.summary.calls.total)
  await win.screenshot({ path: path.join(home, 'usage-after-restart.png') })
  check('重启UI读取权威累计值', true)
  await closePanel(win)
  check('无renderer未处理异常', errors, [])
  report.schemes.push({ scheme, entries: snap.data.entries.length, requests: attemptsBeforeRestart, summary: snap.summary })
  fs.writeFileSync(path.join(home, 'ledger-snapshot.json'), JSON.stringify(snap, null, 2))
  await app.close(); app = null
}
async function main() {
  console.log('运行时真实桌面验收工件：' + runRoot)
  report.sourceBefore = fingerprint(); persistReport()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
  for (const scheme of ['classic', 'proto', 'd']) await runScheme(scheme)
  report.sourceAfter = fingerprint()
  check('整个三入口验收期间业务源码未变', report.sourceAfter, report.sourceBefore)
  report.complete = true
}
main().catch((error) => { report.error = error.stack; console.error(error); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  server.closeAllConnections(); server.close()
  report.network = network
  persistReport()
  console.log('结果：' + report.checks.length + ' 项通过；complete=' + report.complete)
})

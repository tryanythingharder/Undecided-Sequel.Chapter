// 验证 R22：多选组合（勾选→组合发送→合并行动）与 中止生成（停止→保留半段）
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })
const fails = []
const check = (n, c, e) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (e ? '  ' + e : '')); if (!c) fails.push(n) }

async function connect() {
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!browser) throw new Error('CDP connect failed')
  let win = null
  for (let i = 0; i < 40 && !win; i++) {
    for (const ctx of browser.contexts()) {
      const p = ctx.pages().find((x) => x.url().includes('index.html'))
      if (p) win = p
    }
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  return win
}

async function main() {
  const win = await connect()
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // ---- A. 中止生成：开局后流式中点停止 ----
  await win.locator('.empty button.primary').click()
  let stopped = false
  for (let i = 0; i < 30; i++) {
    const t = await win.evaluate(() => (document.querySelector('#btn-send') || {}).textContent || '')
    if (t.includes('停止')) { stopped = true; break }
    await win.waitForTimeout(50)
  }
  check('stop-btn-appears', stopped)
  await win.locator('#btn-send').click() // 点停止
  await win.waitForTimeout(900)
  const afterStop = await win.evaluate(() => ({
    send: (document.querySelector('#btn-send') || {}).textContent || '',
    msgs: (document.querySelector('.messages') || {}).textContent || '',
    choices: document.querySelectorAll('.choice').length,
  }))
  check('partial-kept-after-stop', afterStop.msgs.length > 30, 'len=' + afterStop.msgs.length)
  check('busy-cleared-after-stop', afterStop.send.includes('发送'), afterStop.send)
  check('no-choices-when-truncated', afterStop.choices === 0)
  await win.screenshot({ path: path.join(OUT, 'r22-01-stopped.png') })

  // ---- B. 多选组合：换新线重开局，勾选两项组合发送 ----
  await win.locator('#btn-new').click(); await win.waitForTimeout(600)
  await win.locator('.empty button.primary').click()
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  await win.locator('.multi-toggle').click()
  await win.locator('.choice').nth(0).click()
  await win.locator('.choice').nth(1).click()
  await win.waitForTimeout(300)
  const bar = (await win.locator('.multi-bar').textContent()) || ''
  check('multi-bar-count', bar.includes('2'), bar.slice(0, 30))
  await win.screenshot({ path: path.join(OUT, 'r22-02-multisel.png') })
  await win.locator('.multi-send').click() // R54 修正：必须点「组合发送」本体（旧选择器误点清空，曾被 mock 回复的假阳性掩盖）
  await win.waitForTimeout(500)
  const sent = (await win.locator('.messages').textContent()) || ''
  check('multi-combined-sent', sent.includes('；【B】'), sent.slice(-120, -40)) // 合并行动以「；」连接（区别于 mock 回复的换行分隔，防假阳性）
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  check('multi-turn-completes', true)
  // R54：组合发送后多选模式已退出（toggle 无 .on），新回合单击应直接发送而非勾选
  const mmOff = await win.evaluate(() => !document.querySelector('.multi-toggle').classList.contains('on'))
  check('multi-mode-off-after-send', mmOff)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

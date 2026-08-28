// 验证 R13：灵感按钮存在、点击填入、再点轮换、内容可编辑
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })
const fails = []
const check = (n, c, e) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (e ? '  ' + e : '')); if (!c) fails.push(n) }

async function main() {
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
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.evaluate(() => { localStorage.clear(); localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1800)

  check('inspire-btn-exists', (await win.locator('#btn-inspire').count()) === 1)
  await win.locator('#btn-inspire').click(); await win.waitForTimeout(200)
  const v1 = await win.locator('#input').inputValue()
  check('inspire-fills-input', v1.length >= 8, v1.slice(0, 16))
  await win.locator('#btn-inspire').click(); await win.waitForTimeout(200)
  const v2 = await win.locator('#input').inputValue()
  check('inspire-rotates', v2 !== v1 && v2.length >= 8, v2.slice(0, 16))
  await win.locator('#input').fill(v2 + '（改）')
  check('input-editable', (await win.locator('#input').inputValue()).endsWith('（改）'))
  await win.screenshot({ path: path.join(OUT, 'r13-01-inspire.png') })

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

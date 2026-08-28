// 验证 R48：字号缩放快捷键（Ctrl+= 放大、Ctrl+- 缩小、Ctrl+0 复位、持久化、封顶/封底）
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
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
  await win.evaluate(() => { localStorage.clear(); localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1500)
  const fs = () => win.evaluate(() => document.documentElement.getAttribute('data-fontsize'))

  check('default-standard', (await fs()) === 'standard')
  await win.keyboard.press('Control+='); await win.waitForTimeout(300)
  check('zoom-in-large', (await fs()) === 'large', await fs())
  await win.keyboard.press('Control+='); await win.waitForTimeout(300)
  check('zoom-in-capped', (await fs()) === 'large')
  await win.keyboard.press('Control+-'); await win.waitForTimeout(300)
  check('zoom-out-standard', (await fs()) === 'standard')
  await win.keyboard.press('Control+-'); await win.waitForTimeout(300)
  check('zoom-out-small', (await fs()) === 'small')
  await win.keyboard.press('Control+0'); await win.waitForTimeout(300)
  check('reset-standard', (await fs()) === 'standard')
  const persisted = await win.evaluate(() => JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}').fontSize)
  check('fontsize-persisted', persisted === 'standard', persisted)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

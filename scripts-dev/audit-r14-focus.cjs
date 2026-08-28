// R14：高对比调色板（contrast dark/light）焦点环抽测
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'

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
  await win.evaluate(() => { localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1500)

  const out = await win.evaluate(() => {
    const res = []
    for (const th of ['dark', 'light']) {
      document.documentElement.setAttribute('data-palette', 'contrast')
      document.documentElement.setAttribute('data-theme', th)
      const row = { theme: th }
      const el = document.querySelector('#btn-send')
      el.focus()
      const cs = getComputedStyle(el)
      row.outline = cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor
      const bg = getComputedStyle(document.body).backgroundColor
      row.bodyBg = bg
      res.push(row)
    }
    return res
  })
  for (const r of out) console.log('contrast/' + r.theme + '  outline=' + r.outline + '  bg=' + r.bodyBg + (r.outline.includes('solid') && !r.outline.startsWith('none') ? '  PASS' : '  FAIL'))
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R29：主题 UI 流——弹层开启、色板切换即时生效、明暗切换、重载持久化
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

  await win.locator('#btn-theme').click(); await win.waitForTimeout(500)
  check('theme-pop-opens', await win.locator('#theme-pop').isVisible())
  const bgBefore = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())

  await win.locator('.swatch[title*="林"]').click(); await win.waitForTimeout(500)
  const st1 = await win.evaluate(() => ({
    pal: document.documentElement.getAttribute('data-palette'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  }))
  check('palette-applies-attr', st1.pal === 'forest', st1.pal)
  check('palette-applies-bg', st1.bg !== bgBefore && st1.bg.length > 0, st1.bg)

  await win.locator('#btn-theme').click(); await win.waitForTimeout(400) // 色板选择后弹层自动关闭 → 重开
  await win.locator('.theme-mode[data-mode="dark"]').click(); await win.waitForTimeout(400)
  check('mode-applies', (await win.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark')
  await win.screenshot({ path: path.join(OUT, 'r28-01-forest-dark.png') })

  await win.reload(); await win.waitForTimeout(1500)
  const st2 = await win.evaluate(() => ({
    pal: document.documentElement.getAttribute('data-palette'),
    th: document.documentElement.getAttribute('data-theme'),
  }))
  check('persists-after-reload', st2.pal === 'forest' && st2.th === 'dark', JSON.stringify(st2))

  // 复位：回 Codex + 跟随系统（保持测试档干净）
  await win.locator('#btn-theme').click(); await win.waitForTimeout(400)
  await win.locator('.swatch').first().click(); await win.waitForTimeout(300)
  await win.locator('#btn-theme').click(); await win.waitForTimeout(400) // 弹层已随选择关闭 → 重开
  await win.locator('.theme-mode[data-mode="system"]').click(); await win.waitForTimeout(300)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R43：IF 线母线面包屑——chip 显示（含母线标题）、点击回母线、母线无 chip
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
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    const msgs = [{ role: 'user', content: '开始' }, { role: 'assistant', content: '第一幕。\n\n【A】走【B】停' }]
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'if1', title: 'IF · 母线甲', createdAt: Date.now(), updatedAt: Date.now(), messages: msgs, ifFrom: 'mom1' },
      { id: 'mom1', title: '母线甲', createdAt: Date.now() - 9999, updatedAt: Date.now() - 999, messages: msgs.concat([{ role: 'user', content: '【A】走' }, { role: 'assistant', content: '第二幕。' }]) },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const chip = win.locator('.mother-chip')
  check('mother-chip-shows', (await chip.count()) === 1)
  const ct = ((await chip.textContent()) || '').trim()
  check('mother-chip-text', ct.includes('母线：母线甲') || ct.includes('母线甲'), ct)

  await chip.click(); await win.waitForTimeout(800)
  const title = (await win.locator('#chat-title').textContent()) || ''
  check('switched-to-parent', title.includes('母线甲') && !title.startsWith('IF'), title.slice(0, 20))
  check('chip-gone-on-parent', (await win.locator('.mother-chip').count()) === 0)
  const active = await win.evaluate(() => document.querySelector('#session-list .session-item.active').textContent)
  check('parent-active-in-list', active.includes('母线甲') && !active.includes('IF ·'), active.slice(0, 20))

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

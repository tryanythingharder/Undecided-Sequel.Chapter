// 验证 R39：置顶切换（active 类 + cfg 持久化）与 搜索命中导航（Enter/Shift+Enter 计数跳转）
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
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'p1', title: '搜索导航线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '蓝光闪过。旅人离去。\n\n远处又是蓝光。钟声响起。' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // A. 置顶切换
  await win.locator('#btn-pin').click(); await win.waitForTimeout(400)
  const st1 = await win.evaluate(() => ({
    active: document.querySelector('#btn-pin').classList.contains('active'),
    pin: (JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}').pin),
  }))
  check('pin-on', st1.active === true && st1.pin === true, JSON.stringify(st1))
  await win.locator('#btn-pin').click(); await win.waitForTimeout(400)
  const st2 = await win.evaluate(() => ({
    active: document.querySelector('#btn-pin').classList.contains('active'),
    pin: (JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}').pin),
  }))
  check('pin-off', st2.active === false && st2.pin === false, JSON.stringify(st2))

  // B. 搜索导航：两处「蓝光」→ Enter 2/2 → Shift+Enter 1/2
  await win.keyboard.press('Control+f'); await win.waitForTimeout(400)
  await win.locator('#search-input').fill('蓝光')
  await win.waitForTimeout(500)
  const c1 = ((await win.locator('#search-count').textContent()) || '').trim()
  check('search-count-first', c1.startsWith('1') && c1.includes('2'), c1)
  await win.locator('#search-input').press('Enter'); await win.waitForTimeout(300)
  const c2 = ((await win.locator('#search-count').textContent()) || '').trim()
  check('enter-next-hit', c2.startsWith('2'), c2)
  await win.locator('#search-input').press('Shift+Enter'); await win.waitForTimeout(300)
  const c3 = ((await win.locator('#search-count').textContent()) || '').trim()
  check('shiftenter-prev-hit', c3.startsWith('1'), c3)
  await win.keyboard.press('Escape')

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R33：键盘可达性——会话项/进度条节点 tabindex+role，Enter 触发切换/跳转
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
      { id: 'k1', title: '键盘线一', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '第一幕甲。\n\n【A】走【B】停' }, { role: 'user', content: '【A】走' }, { role: 'assistant', content: '第二幕甲。\n\n【A】续【B】回' }] },
      { id: 'k2', title: '键盘线二', createdAt: Date.now() - 999, updatedAt: Date.now() - 999, messages: [{ role: 'user', content: '开始' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const a11y = await win.evaluate(() => {
    const it = document.querySelector('#session-list .session-item')
    return { tabindex: it.getAttribute('tabindex'), role: it.getAttribute('role') }
  })
  check('session-item-focusable', a11y.tabindex === '0' && a11y.role === 'button', JSON.stringify(a11y))

  // 键盘切线：聚焦第二条 → Enter → 激活切换
  const second = win.locator('#session-list .session-item', { hasText: '键盘线二' })
  await second.focus()
  await win.keyboard.press('Enter'); await win.waitForTimeout(600)
  check('enter-switches-session', await win.evaluate(() => document.querySelector('#session-list .session-item.active').textContent.includes('键盘线二')))

  // 进度条节点键盘可达
  await win.locator('#session-list .session-item', { hasText: '键盘线一' }).click(); await win.waitForTimeout(600)
  await win.locator('#btn-sb-collapse').click(); await win.waitForTimeout(800)
  const railA11y = await win.evaluate(() => {
    const n = document.querySelector('.rail-node')
    return n ? { tabindex: n.getAttribute('tabindex'), role: n.getAttribute('role') } : null
  })
  check('rail-node-focusable', !!railA11y && railA11y.tabindex === '0' && railA11y.role === 'button', JSON.stringify(railA11y))

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R47：Ctrl+N 新建世界线（激活空线、空状态出现、原线保留在列表）
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
      { id: 'n1', title: '原线甲', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  await win.keyboard.press('Control+n'); await win.waitForTimeout(800)
  const m = await win.evaluate(() => ({
    active: (document.querySelector('#session-list .session-item.active') || {}).textContent || '',
    empty: document.querySelectorAll('.empty').length,
    list: (document.querySelector('#session-list') || {}).textContent || '',
    title: (document.querySelector('#chat-title') || {}).textContent || '',
  }))
  check('ctrl-n-new-session', m.active.includes('新世界线'), m.active.slice(0, 20))
  check('empty-state-shown', m.empty === 1)
  check('original-kept', m.list.includes('原线甲'))
  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

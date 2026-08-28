// 验证 R34：toast aria-live/role 通告 + prefers-reduced-motion 媒体规则存在
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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 't1', title: '待删线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // 触发一条 toast（删除会话）
  await win.locator('#session-list .session-item', { hasText: '待删线' }).locator('.session-del').click({ force: true })
  await win.waitForTimeout(400)
  await win.locator('.confirm .danger').click(); await win.waitForTimeout(600)
  const t = await win.evaluate(() => {
    const wrap = document.querySelector('.toast-wrap')
    const toastEl = document.querySelector('.toast')
    return {
      live: wrap ? wrap.getAttribute('aria-live') : null,
      role: toastEl ? toastEl.getAttribute('role') : null,
    }
  })
  check('toast-wrap-aria-live', t.live === 'polite', JSON.stringify(t))
  check('toast-role-status', t.role === 'status' || t.role === 'alert', JSON.stringify(t))

  // reduced-motion 规则存在
  const hasMQ = await win.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.conditionText && rule.conditionText.includes('prefers-reduced-motion')) return true
        }
      } catch {}
    }
    return false
  })
  check('reduced-motion-rule-exists', hasMQ === true)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

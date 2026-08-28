// 验证 R25：工作区隔离——新建工作区、会话互不串联、切换后各自保留
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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'w1', ws: 'default', title: '默认世界的线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const listBefore = (await win.locator('#session-list').textContent()) || ''
  check('default-ws-has-session', listBefore.includes('默认世界的线'))

  // 新建工作区
  await win.locator('#btn-ws').click(); await win.waitForTimeout(400)
  await win.locator('#ws-new').click(); await win.waitForTimeout(400)
  await win.locator('.confirm-input').fill('武侠世界')
  await win.locator('.confirm .primary').click(); await win.waitForTimeout(800)
  const wsName = ((await win.locator('#ws-name').textContent()) || '').trim()
  check('ws-created', wsName.includes('武侠'), wsName)

  // 新工作区会话列表应为空（或仅自动新建的空线），不含默认世界的线
  const listNew = (await win.locator('#session-list').textContent()) || ''
  check('ws-isolated-list', !listNew.includes('默认世界的线'), listNew.slice(0, 40))
  await win.screenshot({ path: path.join(OUT, 'r25-01-workspace.png') })

  // 切回默认世界 → 原线仍在
  await win.locator('#btn-ws').click(); await win.waitForTimeout(400)
  await win.locator('#ws-menu-list .ws-menu-item').first().click(); await win.waitForTimeout(800)
  const listBack = (await win.locator('#session-list').textContent()) || ''
  check('default-ws-restored', listBack.includes('默认世界的线'), listBack.slice(0, 40))

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

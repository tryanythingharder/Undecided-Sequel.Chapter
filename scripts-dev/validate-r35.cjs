// 验证 R37：侧栏拖拽调宽（200→320 持久化）+ 拖到最窄 snap 收起 + 双击把手恢复
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
      { id: 's1', title: '调宽验证线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const w0 = await win.evaluate(() => document.querySelector('#sidebar').getBoundingClientRect().width)
  const handle = win.locator('.sidebar-handle')
  const hb = await handle.boundingBox()
  // 拖宽：200 → 320
  await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await win.mouse.down()
  await win.mouse.move(hb.x + 120, hb.y + hb.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  const w1 = await win.evaluate(() => document.querySelector('#sidebar').getBoundingClientRect().width)
  check('drag-widens-sidebar', w1 > w0 + 80, 'w0=' + Math.round(w0) + ' w1=' + Math.round(w1))
  const persistedW = await win.evaluate(() => JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}').sidebarWidth)
  check('width-persisted', Math.abs((persistedW || 0) - w1) < 6, 'persisted=' + persistedW)

  // 拖到最窄 → snap 收起
  const hb2 = await handle.boundingBox().catch(() => null)
  const hx = hb2 ? hb2.x + hb2.width / 2 : w1 + 2
  const hy = 400
  await win.mouse.move(hx, hy)
  await win.mouse.down()
  await win.mouse.move(20, hy, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(600)
  check('snap-collapses', await win.evaluate(() => document.querySelector('#sidebar').classList.contains('collapsed')))

  // 双击把手恢复
  await win.locator('.sidebar-handle').dblclick(); await win.waitForTimeout(600)
  check('dblclick-restores', await win.evaluate(() => !document.querySelector('#sidebar').classList.contains('collapsed')))

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

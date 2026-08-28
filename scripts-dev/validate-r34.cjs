// 验证 R36：会话时间分组（今天/昨天/更早）+ 拖拽排序（拖 B 到 A 上 → 顺序更新并持久化）
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const fails = []
const check = (n, c, e) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (e ? '  ' + e : '')); if (!c) fails.push(n) }
const D = 86400000

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
  await win.evaluate((D) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    const now = Date.now()
    const mk = (id, t, u) => ({ id, title: t, createdAt: u, updatedAt: u, messages: [{ role: 'user', content: '开始' }] })
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      mk('d1', 'A线', now), mk('d2', 'B线', now - 3600000), mk('d3', '昨日线', now - D), mk('d4', '古早线', now - 9 * D),
    ]))
  }, D)
  await win.reload(); await win.waitForTimeout(1800)

  const groups = await win.evaluate(() => [...document.querySelectorAll('.session-group-label')].map((el) => el.textContent.trim()))
  check('time-groups-ordered', groups.join('>').includes('今天') && groups.indexOf('今天') < groups.indexOf('昨天') && groups.indexOf('昨天') < groups.indexOf('更早'), groups.join('>'))

  // 拖拽 B线 到 A线 之上
  const itemA = win.locator('#session-list .session-item', { hasText: 'A线' })
  const itemB = win.locator('#session-list .session-item', { hasText: 'B线' })
  const boxA = await itemA.boundingBox()
  const boxB = await itemB.boundingBox()
  await win.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2)
  await win.mouse.down()
  await win.mouse.move(boxA.x + boxA.width / 2, boxA.y + 4, { steps: 10 })
  await win.waitForTimeout(300)
  await win.mouse.up()
  await win.waitForTimeout(600)

  const order = await win.evaluate(() => [...document.querySelectorAll('#session-list .session-item')].map((el) => el.textContent.replace(/[^A-Za-z一-鿿线]/g, '').slice(0, 3)).join('|'))
  check('drag-reorders-list', order.indexOf('B线') < order.indexOf('A线'), order)
  const persisted = await win.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]')
    return arr.slice(0, 2).map((s) => s.title).join('|')
  })
  check('order-persisted', persisted.startsWith('B线'), persisted)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 专项验证：会话时间分组 + 拖拽排序（对标 Codex/ChatGPT 侧栏）
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1500)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // 注入跨时间段的会话：今天×2、昨天×1、7天内×1、更早×1（数组顺序即显示顺序）
  const day = 86400000
  const now = Date.now()
  await win.evaluate((ts) => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', title: '甲今天一', createdAt: ts.now, updatedAt: ts.now, messages: [] },
      { id: 's2', title: '乙今天二', createdAt: ts.now, updatedAt: ts.now, messages: [] },
      { id: 's3', title: '丙昨天', createdAt: ts.yday, updatedAt: ts.yday, messages: [] },
      { id: 's4', title: '丁七天内', createdAt: ts.week, updatedAt: ts.week, messages: [] },
      { id: 's5', title: '戊更早', createdAt: ts.old, updatedAt: ts.old, messages: [] }
    ]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentSessionId: 's1' }))
  }, { now, yday: now - day, week: now - 3 * day, old: now - 30 * day })
  await win.reload()
  await win.waitForTimeout(1800)

  // ---- 分组标题渲染 ----
  const groups = await win.locator('.session-group-label').allTextContents()
  check('group-labels-4', groups.length === 4, 'groups=' + JSON.stringify(groups))
  check('group-order', groups[0] === '今天' && groups[1] === '昨天' && groups[2] === '7 天内' && groups[3] === '更早', JSON.stringify(groups))
  // 今天组内两条
  const firstGroupItems = await win.evaluate(() => {
    const out = []
    let el = document.querySelector('.session-group-label').nextElementSibling
    while (el && !el.classList.contains('session-group-label')) { out.push(el.dataset.sid); el = el.nextElementSibling }
    return out
  })
  check('today-group-2-items', firstGroupItems.length === 2 && firstGroupItems[0] === 's1', JSON.stringify(firstGroupItems))

  // ---- 拖拽排序：把 s2（今天二）拖到列表最后（s5 下半区）----
  const box = (sel) => win.locator(sel).boundingBox()
  const s2 = await box('.session-item[data-sid="s2"]')
  const s5 = await box('.session-item[data-sid="s5"]')
  await win.mouse.move(s2.x + s2.width / 2, s2.y + s2.height / 2)
  await win.mouse.down()
  await win.mouse.move(s5.x + s5.width / 2, s5.y + s5.height - 2, { steps: 12 })
  // 拖拽中：目标条目应有落点标记（轮询等待，避免时序偶发）
  let dropMarked = false
  for (let i = 0; i < 10; i++) {
    if (await win.evaluate(() => !!document.querySelector('.session-item.drop-before, .session-item.drop-after'))) { dropMarked = true; break }
    await win.waitForTimeout(100)
  }
  check('drop-mark-shown-while-dragging', dropMarked)
  await win.mouse.up()
  await win.waitForTimeout(400)

  const orderAfter = await win.evaluate(() => Array.from(document.querySelectorAll('.session-item')).map((el) => el.dataset.sid))
  check('drag-reorder-moves-to-end', orderAfter[orderAfter.length - 1] === 's2', JSON.stringify(orderAfter))

  // ---- 排序持久化：重载后顺序保持 ----
  await win.reload()
  await win.waitForTimeout(1800)
  const orderReload = await win.evaluate(() => Array.from(document.querySelectorAll('.session-item')).map((el) => el.dataset.sid))
  check('reorder-persisted-after-reload', JSON.stringify(orderReload) === JSON.stringify(orderAfter), JSON.stringify(orderReload))

  // ---- 拖拽后点击会话仍正常切换（拖拽不误触 click）----
  await win.locator('.session-item[data-sid="s5"]').click()
  await win.waitForTimeout(300)
  const activeId = await win.evaluate(() => (document.querySelector('.session-item.active') || {}).dataset.sid)
  check('click-switches-after-drag', activeId === 's5', 'active=' + activeId)

  // ---- 收起态分组标题隐藏 ----
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)
  check('group-labels-hidden-when-collapsed', await win.evaluate(() => {
    const g = document.querySelector('.session-group-label')
    return !g || getComputedStyle(g).display === 'none'
  }))
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)

  // ---- 无控制台错误 ----
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await win.waitForTimeout(500)
  check('no-console-errors', errors.length === 0, errors.join(' | ').slice(0, 300))

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

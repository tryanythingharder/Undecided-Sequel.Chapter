// 专项验证：侧边栏拖拽伸缩 + 收起/展开 + 持久化（对标 Codex/ChatGPT 侧栏体验）
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
  // 窗口复位到默认尺寸（消除共享 test-profile 的 window-state.json 对鼠标绝对坐标的串扰）
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.isVisible())
    w.setSize(1120, 760)
    w.center()
    if (w.isMaximized()) w.unmaximize()
  })
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }
  const sbW = () => win.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width)

  // 基础：默认 200px + handle 存在 + 切换按钮存在
  check('default-width-200', Math.round(await sbW()) === 200, 'w=' + Math.round(await sbW()))
  check('handle-exists', (await win.locator('.sidebar-handle').count()) === 1)
  check('toggle-btn-exists', (await win.locator('#btn-sidebar-toggle').count()) === 1)

  // ---- 拖拽伸缩：200 → 320（起点取 handle 内侧，落点按偏移换算）----
  await win.mouse.move(197, 400)
  await win.mouse.down()
  await win.mouse.move(317, 400, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const w1 = Math.round(await sbW())
  check('drag-resize-to-320', Math.abs(w1 - 320) <= 3, 'w=' + w1)

  // ---- 持久化：重载后保持 320 ----
  await win.reload()
  await win.waitForTimeout(1800)
  const w2 = Math.round(await sbW())
  check('width-persisted-after-reload', Math.abs(w2 - 320) <= 3, 'w=' + w2)

  // ---- Ctrl+B 收起：48px 图标列 + 徽标可见 ----
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)
  const w3 = Math.round(await sbW())
  check('ctrl-b-collapses-to-48', w3 === 48, 'w=' + w3)
  const collapsedCls = await win.evaluate(() => document.querySelector('.sidebar').classList.contains('collapsed'))
  check('collapsed-class-applied', collapsedCls)
  // 徽标可见（有会话）
  const badgeVis = await win.evaluate(() => {
    const b = document.querySelector('.session-badge')
    return b && getComputedStyle(b).display !== 'none'
  })
  check('session-badge-visible-when-collapsed', badgeVis)
  // 标签隐藏
  check('label-hidden-when-collapsed', await win.evaluate(() => getComputedStyle(document.querySelector('.session-label-wrap')).display === 'none'))
  // 切换按钮方向变化
  check('toggle-btn-points-right', (await win.locator('#btn-sidebar-toggle').textContent()) === '»')

  // ---- 收起态持久化：重载后仍是 48px ----
  await win.reload()
  await win.waitForTimeout(1800)
  check('collapsed-persisted-after-reload', Math.round(await sbW()) === 48, 'w=' + Math.round(await sbW()))

  // ---- 收起态点击徽标可切换会话（先注入两条会话；保留 sidebarWidth=320）----
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'sa', title: '甲龙历开局', createdAt: Date.now(), updatedAt: Date.now(), messages: [] },
      { id: 'sb', title: '乙夜行记', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
    ]))
    const cfg = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    cfg.currentSessionId = 'sa'
    cfg.sidebarCollapsed = true
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(cfg))
  })
  await win.reload()
  await win.waitForTimeout(1800)
  check('two-badges-rendered', (await win.locator('.session-badge').count()) === 2)
  await win.locator('.session-item').nth(1).click()
  await win.waitForTimeout(300)
  const activeBadge = await win.evaluate(() => {
    const item = document.querySelector('.session-item.active .session-badge')
    return item ? item.textContent : ''
  })
  check('badge-click-switches-session', activeBadge === '乙', 'badge=' + activeBadge)

  // ---- Ctrl+B 展开：恢复持久化的宽度（320）----
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)
  const w4 = Math.round(await sbW())
  check('ctrl-b-expands-back-to-320', Math.abs(w4 - 320) <= 3, 'w=' + w4)

  // ---- 拖到最窄 snap 收起（320 → 拖过阈值 → 收起 48）----
  await win.mouse.move(317, 400)
  await win.mouse.down()
  await win.mouse.move(60, 400, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const w5 = Math.round(await sbW())
  check('drag-past-snap-collapses', w5 === 48, 'w=' + w5)

  // ---- 从收起态拖出展开（48 → 拖到 260：48+(256-44)=260）----
  await win.mouse.move(44, 400)
  await win.mouse.down()
  await win.mouse.move(256, 400, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const w6 = Math.round(await sbW())
  check('drag-out-from-collapsed-expands', Math.abs(w6 - 260) <= 3, 'w=' + w6)

  // ---- 标题栏按钮切换收起 ----
  await win.click('#btn-sidebar-toggle')
  await win.waitForTimeout(400)
  check('toggle-btn-collapses', Math.round(await sbW()) === 48, 'w=' + Math.round(await sbW()))
  await win.click('#btn-sidebar-toggle')
  await win.waitForTimeout(400)
  check('toggle-btn-expands', Math.abs(Math.round(await sbW()) - 260) <= 3, 'w=' + Math.round(await sbW()))

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

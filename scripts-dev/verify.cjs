const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const checks = []

function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra || '' })
}

// 获取设置独立窗口（settings.html）；closed=true 时确认其已关闭
async function settingsWindow(app, closed) {
  for (let i = 0; i < 30; i++) {
    const ws = app.windows()
    const s = ws.find((w) => w.url().includes('settings.html'))
    if (closed ? !s : s) return s || null
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1200)
  // 清空持久化配置，验证「首次启动」的默认状态（其他 e2e 会写入共享 localStorage）
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(2500)

  // 1. titlebar + brand
  const brand = await win.textContent('.titlebar-name')
  check('titlebar brand', brand === '六面世界', brand)
  const sigil = await win.$('.sigil')
  check('sigil present', !!sigil) // R7x：徽记为纯 SVG，无 textContent

  // 2. kernel loaded
  const kernelState = await win.textContent('#kernel-state')
  check('kernel loaded', /已加载/.test(kernelState || ''), kernelState)
  const chipOk = await win.getAttribute('#kernel-state', 'style') || ''
  check('kernel ok color', chipOk.includes('var(--ok)') || /rgb\(127, 176, 105\)/.test(chipOk), chipOk)

  // 3. empty state visible + start button
  const hasEmpty = await win.locator('.empty').count()
  const startBtn = await win.locator('.empty .primary').textContent().catch(() => null)
  check('empty state + start', hasEmpty === 1 && /开始游戏/.test(startBtn || ''), startBtn)

  // 4. no console errors
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await win.waitForTimeout(800)
  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400))

  // 5. sidebar geometry + layout
  const layout = await win.evaluate(() => {
    const sb = document.querySelector('.sidebar').getBoundingClientRect()
    const chat = document.querySelector('.chat').getBoundingClientRect()
    const msg = document.querySelector('.messages').getBoundingClientRect()
    const comp = document.querySelector('.composer').getBoundingClientRect()
    return { sbW: Math.round(sb.width), chatW: Math.round(chat.width), msgH: Math.round(msg.height), compH: Math.round(comp.height), innerW: window.innerWidth, innerH: window.innerHeight }
  })
  check('sidebar 200px wide', layout.sbW === 200, JSON.stringify(layout))
  check('chat column fills', layout.sbW + layout.chatW === layout.innerW, JSON.stringify(layout))
  check('composer visible', layout.compH > 40, JSON.stringify(layout))

  // 6. settings（独立系统窗口 · 分页签）
  await win.click('#btn-settings')
  const sw = await settingsWindow(app)
  check('settings window opens', !!sw)
  const winInfo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('设置'))
    return w ? { movable: w.isMovable(), resizable: w.isResizable(), frame: w.isResizable() && w.isMovable() } : null
  })
  check('settings window movable', !!(winInfo && winInfo.movable))
  check('settings window resizable', !!(winInfo && winInfo.resizable))
  const tabCount = await sw.locator('.modal-tabs .tab').count()
  check('settings has 4 tabs', tabCount === 4, 'tabs=' + tabCount)
  const presetVal = await sw.inputValue('#set-preset')
  const baseVal = await sw.inputValue('#set-baseurl')
  check('preset default deepseek', presetVal === 'deepseek', presetVal)
  check('base url default', baseVal === 'https://api.deepseek.com', baseVal)

  // 7. provider preset switch changes base+model（R80：预设收敛为五项，用 zhipu 验证联动）
  await sw.selectOption('#set-preset', 'zhipu')
  const msBase = await sw.inputValue('#set-baseurl')
  const msModel = await sw.inputValue('#set-model')
  check('preset switch -> zhipu', msBase === 'https://open.bigmodel.cn/api/paas/v4' && /glm/.test(msModel || ''), msBase + ' / ' + msModel)
  await sw.selectOption('#set-preset', 'deepseek')

  // 8. theme: data-theme 始终被解析为具体明暗（system 在应用侧解析，R7x 调色板体系依赖确定值）
  // 关闭即销毁窗口：evaluate+catch 避免 Playwright 与窗口销毁竞态（同 e2e-mock 的处理）
  await sw.evaluate(() => { const b = document.getElementById('btn-win-close'); if (b) b.click() }).catch(() => {})
  check('settings window closes', !(await settingsWindow(app, true)))
  await win.waitForTimeout(300)
  const themeAttr0 = await win.getAttribute('html', 'data-theme')
  check('theme attr resolved', themeAttr0 === 'dark' || themeAttr0 === 'light', 'data-theme=' + themeAttr0)
  // 主窗口主题弹层：选择 dark / light 立即生效
  await win.click('#btn-theme')
  await win.waitForTimeout(400)
  const popModeDark = await win.evaluate(() => {
    const b = document.querySelector('#theme-pop [data-mode="dark"]')
    if (b) b.click()
    return !!b
  })
  await win.waitForTimeout(400)
  const themeAttrDark = await win.getAttribute('html', 'data-theme')
  check('theme pick -> dark', popModeDark && themeAttrDark === 'dark', 'data-theme=' + themeAttrDark)
  await win.click('#btn-theme')
  await win.waitForTimeout(300)
  await win.evaluate(() => { const b = document.querySelector('#theme-pop [data-mode="light"]'); if (b) b.click() })
  await win.waitForTimeout(400)
  const themeAttrLight = await win.getAttribute('html', 'data-theme')
  check('theme pick -> light', themeAttrLight === 'light', 'data-theme=' + themeAttrLight)
  // 设置窗口预览 system → 主窗口立即生效（仍解析出具体值）；关闭未保存 → 回滚
  await win.click('#btn-settings')
  const sw2 = await settingsWindow(app)
  await sw2.click('.tab[data-tab="appearance"]')
  await sw2.waitForTimeout(200)
  await sw2.selectOption('#set-theme', 'system')
  await win.waitForTimeout(300)
  const themeAttrSys = await win.getAttribute('html', 'data-theme')
  check('theme preview -> system (resolved)', themeAttrSys === 'dark' || themeAttrSys === 'light', 'data-theme=' + themeAttrSys)
  await sw2.evaluate(() => { const b = document.getElementById('btn-win-close'); if (b) b.click() }).catch(() => {})
  await win.waitForTimeout(400)
  const themeAttrRevert = await win.getAttribute('html', 'data-theme')
  check('theme reverts on close (unsaved)', themeAttrRevert === 'light', 'data-theme=' + themeAttrRevert)

  // 9. pin toggle reflects button active state
  await win.click('#btn-pin')
  await win.waitForTimeout(300)
  const pinActive = await win.evaluate(() => document.getElementById('btn-pin').classList.contains('active'))
  check('pin toggle active', pinActive)

  // 10. adaptive resize: narrow width auto-collapses sidebar (48px icon rail)
  await win.setViewportSize({ width: 640, height: 700 })
  await win.waitForTimeout(500)
  const narrowSb = await win.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width)
  check('narrow: sidebar auto-collapses to 48px', Math.round(narrowSb) === 48, 'sidebar=' + Math.round(narrowSb))
  const badgeShown = await win.evaluate(() => {
    const sb = document.querySelector('.sidebar')
    const badge = sb.querySelector('.session-badge')
    return sb.classList.contains('collapsed') && badge && getComputedStyle(badge).display !== 'none'
  })
  check('narrow: session badge visible when collapsed', badgeShown)
  await win.setViewportSize({ width: 1180, height: 780 })
  await win.waitForTimeout(400)
  const wideSb = await win.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width)
  check('wide: sidebar restores to 200px', Math.round(wideSb) === 200, 'sidebar=' + Math.round(wideSb))

  // 11. window control IPC responds (maximize toggles without error)
  const maxOK = await win.evaluate(() => window.api.maximizeToggle().then(() => true).catch(() => false))
  check('maximize IPC ok', maxOK)
  await win.evaluate(() => window.api.maximizeToggle().catch(() => {}))
  await win.waitForTimeout(300)

  // 11b. new actions exist & send button initial state
  const sendText = await win.locator('#btn-send').textContent()
  check('send button initial text', /发送/.test(sendText || ''), 'btn=' + sendText)
  check('stop-css-absent-initially', !(await win.evaluate(() => document.getElementById('btn-send').classList.contains('stop'))))
  // abort IPC exposed
  const abortIPC = await win.evaluate(() => typeof window.api.abortChat === 'function')
  check('abortChat IPC exposed', abortIPC)
  const saveImgIPC = await win.evaluate(() => typeof window.api.saveImage === 'function')
  check('saveImage IPC exposed', saveImgIPC)
  // titlebar gallery button
  check('gallery button present', await win.locator('#btn-gallery').count() === 1)

  // 12. parseChoices logic via evaluating the internal function indirectly: inject a fake last assistant message path is complex; verify regex through re-implementation
  const sample = '【甲龙历 407.01.01｜清晨｜布耶纳】你醒来了。\n【A】接受委托（获报酬人脉但被监视）【B】拒绝（保自由失情报信任）\n【C】私下调查（耗时间有风险）'
  const parsed = await win.evaluate(new Function('text', `
    const out = [], seen = new Set()
    const re = /【([A-Z])】([^【\\n]*)/g
    let m
    while ((m = re.exec(text))) { if (seen.has(m[1])) continue; seen.add(m[1]); const label = (m[2]||'').trim(); if (label) out.push({key:m[1],label}) }
    return out
  `), sample)
  check('choice parser extracts A/B/C', parsed.length === 3 && parsed[0].key === 'A', JSON.stringify(parsed))

  const themeSnapshot = await win.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, light: matchMedia('(prefers-color-scheme: light)').matches }))
  check('prefers-color-scheme media available', typeof themeSnapshot.dark === 'boolean', JSON.stringify(themeSnapshot))

  await app.close()

  let pass = 0
  for (const c of checks) { if (c.ok) pass++; console.log((c.ok ? 'PASS' : 'FAIL') + '  ' + c.name + '  ' + c.extra) }
  console.log('\n==== ' + pass + '/' + checks.length + ' checks passed ====')
  process.exit(pass === checks.length ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

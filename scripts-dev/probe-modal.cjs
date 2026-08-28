// 探针：实测设置窗口与画廊在屏幕中的实际位置/尺寸
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

async function settingsWindow(app) {
  for (let i = 0; i < 30; i++) {
    const s = app.windows().find((w) => w.url().includes('settings.html'))
    if (s) return s
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
  await win.waitForTimeout(1500)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1200)

  // 打开设置独立窗口 → 汇报 BrowserWindow 坐标/尺寸
  await win.click('#btn-settings')
  const sw = await settingsWindow(app)
  const settingsInfo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('设置'))
    if (!w) return null
    const [x, y] = w.getPosition()
    const [width, height] = w.getSize()
    return { title: w.getTitle(), x, y, width, height, movable: w.isMovable(), resizable: w.isResizable() }
  })
  console.log('SETTINGS_WINDOW: ' + JSON.stringify(settingsInfo))

  // 关闭设置窗口
  if (sw) { await sw.click('#btn-win-close'); await win.waitForTimeout(300) }

  // 打开画廊（页内模态）
  await win.keyboard.press('Control+g')
  await win.waitForTimeout(400)
  const g = await win.evaluate(() => {
    const el = document.getElementById('gallery')
    const r = el.getBoundingClientRect()
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, vw: innerWidth, vh: innerHeight }
  })
  console.log('GALLERY: ' + JSON.stringify(g))

  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

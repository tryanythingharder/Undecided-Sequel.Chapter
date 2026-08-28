// 验证置顶修复（Electron 级 + OS 级 HWND 精确双重验证）
const path = require('node:path')
const { execSync } = require('node:child_process')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

// 从主进程取当前可见窗口的原生 HWND（64 位安全读取）
function getHwnd(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.isVisible())
    if (!w) return 0
    const buf = w.getNativeWindowHandle()
    if (buf.length === 4) return buf.readInt32LE(0) >>> 0
    return Number(buf.readBigUInt64LE(0))
  })
}

function osTopmost(hwnd) {
  return execSync('powershell -ExecutionPolicy Bypass -File "' + path.join(__dirname, 'check-topmost.ps1') + '" -Hwnd ' + hwnd).toString().trim()
}

async function main() {
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1200)
  // 显式准备初始状态：pin=false（test-profile 可能残留 true）
  await win.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    c.pin = false
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
    document.getElementById('btn-pin').classList.remove('active')
    window.api.pin(false)
  })
  await win.reload()
  await win.waitForTimeout(1800)
  const getAot = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.isVisible()).isAlwaysOnTop())

  const hwnd = await getHwnd(app)
  console.log('hwnd:', hwnd)

  // 1. 初始未置顶（Electron + OS）
  check('initial-not-topmost', (await getAot()) === false)
  let os = osTopmost(hwnd)
  check('initial-os-not-topmost', /TOPMOST=False/.test(os), os)

  // 2. 点击置顶 → 生效
  await win.click('#btn-pin')
  await win.waitForTimeout(500)
  check('pin-click-enables-aot', (await getAot()) === true)
  os = osTopmost(hwnd)
  console.log('  os:', os)
  check('os-ws-ex-topmost-set', /TOPMOST=True/.test(os), os)

  // 3. 最大化 → 还原 → TOPMOST 保持（修复点）
  await win.click('#btn-max')
  await win.waitForTimeout(600)
  const aotMax = await getAot()
  await win.click('#btn-max')
  await win.waitForTimeout(600)
  check('topmost-survives-maximize-restore', (await getAot()) === true, 'maximized aot=' + aotMax)
  os = osTopmost(hwnd)
  check('os-topmost-after-max-restore', /TOPMOST=True/.test(os), os)

  // 4. 最小化 → 恢复 → TOPMOST 保持
  await win.click('#btn-min')
  await win.waitForTimeout(800)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.restore()))
  await win.waitForTimeout(800)
  check('topmost-survives-minimize-restore', (await getAot()) === true)
  os = osTopmost(hwnd)
  check('os-topmost-after-min-restore', /TOPMOST=True/.test(os), os)

  // 5. 取消置顶 → 清除（Electron + OS）
  await win.click('#btn-pin')
  await win.waitForTimeout(400)
  check('unpin-disables-aot', (await getAot()) === false)
  os = osTopmost(hwnd)
  console.log('  os:', os)
  check('os-topmost-cleared', /TOPMOST=False/.test(os), os)

  // 6. 重启后 pin=true 自动恢复（boot setPin 链路）
  await win.evaluate(() => { const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}'); c.pin = true; localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c)) })
  await win.reload()
  await win.waitForTimeout(1800)
  check('boot-restores-pin-from-config', (await getAot()) === true)
  const hwnd2 = await getHwnd(app)
  os = osTopmost(hwnd2)
  console.log('  os:', os)
  check('os-topmost-after-reload', /TOPMOST=True/.test(os), os)

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

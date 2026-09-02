// 界面方案（经典 / 原型工作台）端到端测试。
// 验证：默认加载经典界面；API/主题抽屉切换到原型工作台并重载；重启后持久化生效；切回经典。
// 用法：node scripts-dev/test-ui-scheme.cjs
const path = require('path')
const fs = require('fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')

async function launch() {
  return electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
}

async function main() {
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // ---- 1. 默认经典方案 ----
  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForTimeout(1600)
  let st = await win.evaluate(() => ({ dock: !!document.querySelector('.command-dock'), island: !!document.querySelector('.dynamic-island'), sidebar: !!document.querySelector('#sidebar'), entry: location.pathname.replace(/\\/g, '/') }))
  check('default-loads-classic', !st.dock && !st.island && st.sidebar && st.entry.includes('/renderer/index.html'), JSON.stringify(st))
  check('preload-exposes-ui-scheme', await win.evaluate(() => typeof window.api.uiScheme === 'function' && typeof window.api.setUiScheme === 'function'))
  check('initial-scheme-is-classic', (await win.evaluate(() => window.api.uiScheme())) === 'classic')

  // ---- 2. 主题抽屉里出现「界面方案」磁贴且当前方案点亮 ----
  await win.click('#btn-theme')
  await win.waitForTimeout(500)
  const tiles = await win.evaluate(() => [...document.querySelectorAll('[data-ui-scheme]')].map((t) => ({ s: t.dataset.uiScheme, on: t.classList.contains('on') })))
  check('theme-drawer-has-scheme-tiles', tiles.length === 2 && tiles.some((t) => t.s === 'classic' && t.on) && tiles.some((t) => t.s === 'proto' && !t.on), JSON.stringify(tiles))

  // ---- 3. 点击「原型工作台」→ 主进程重载到原型方案入口 ----
  await win.click('[data-ui-scheme="proto"]')
  await win.waitForTimeout(2200)
  st = await win.evaluate(() => ({ dock: !!document.querySelector('.command-dock'), island: !!document.querySelector('.dynamic-island'), scheme: window.api.uiScheme && null, entry: location.pathname.replace(/\\/g, '/') }))
  st.scheme = await win.evaluate(() => window.api.uiScheme())
  check('switch-to-proto-reloads-entry', st.dock && st.island && st.scheme === 'proto' && st.entry.includes('/renderer-proto/index.html'), JSON.stringify(st))

  // ---- 4. 原型方案主题抽屉可切回经典 ----
  await win.click('#btn-theme')
  await win.waitForTimeout(500)
  const protoTiles = await win.evaluate(() => [...document.querySelectorAll('[data-ui-scheme]')].map((t) => ({ s: t.dataset.uiScheme, on: t.classList.contains('on') })))
  check('proto-drawer-reflects-proto', protoTiles.some((t) => t.s === 'proto' && t.on), JSON.stringify(protoTiles))
  await win.click('[data-ui-scheme="classic"]')
  await win.waitForTimeout(2200)
  st = await win.evaluate(() => ({ dock: !!document.querySelector('.command-dock'), sidebar: !!document.querySelector('#sidebar'), entry: location.pathname.replace(/\\/g, '/') }))
  check('switch-back-to-classic', !st.dock && st.sidebar && st.entry.includes('/renderer/index.html'), JSON.stringify(st))

  // ---- 5. 持久化：切到原型后重启直接进入原型方案 ----
  await win.click('#btn-theme')
  await win.waitForTimeout(400)
  await win.click('[data-ui-scheme="proto"]')
  await win.waitForTimeout(2200)
  check('back-on-proto', (await win.evaluate(() => window.api.uiScheme())) === 'proto')
  await app.close()

  app = await launch()
  win = await app.firstWindow()
  await win.waitForTimeout(1600)
  st = await win.evaluate(() => ({ dock: !!document.querySelector('.command-dock'), entry: location.pathname.replace(/\\/g, '/') }))
  check('restart-persists-proto', st.dock && st.entry.includes('/renderer-proto/index.html'), JSON.stringify(st))

  // ---- 6. 数据共享：经典侧写入的 localStorage 在原型侧可读 ----
  await win.evaluate(() => localStorage.setItem('ui-scheme-probe', 'shared-ok'))
  await app.close()
  app = await launch()
  win = await app.firstWindow()
  await win.waitForTimeout(1600)
  check('localstorage-shared-across-schemes', (await win.evaluate(() => localStorage.getItem('ui-scheme-probe'))) === 'shared-ok')
  await win.evaluate(() => localStorage.removeItem('ui-scheme-probe'))
  // 收尾：恢复经典方案（切换会触发窗口重载，evaluate 上下文可能随之销毁，吞掉该异常）
  await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
  await win.waitForTimeout(2200)
  check('restore-classic-at-end', (await win.evaluate(() => window.api.uiScheme())) === 'classic')
  await app.close()

  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })

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
  check('default-loads-classic', !st.dock && !st.island && st.sidebar && st.entry.includes('/ui/classic/index.html'), JSON.stringify(st))
  check('preload-exposes-ui-scheme', await win.evaluate(() => typeof window.api.uiScheme === 'function' && typeof window.api.setUiScheme === 'function'))
  check('initial-scheme-is-classic', (await win.evaluate(() => window.api.uiScheme())) === 'classic')

  // ---- 2. 主题抽屉里出现「界面方案」磁贴且当前方案点亮（三方案：经典/原型/通用阅读D） ----
  await win.click('#btn-theme')
  await win.waitForTimeout(500)
  const tiles = await win.evaluate(() => [...document.querySelectorAll('[data-ui-scheme]')].map((t) => ({ s: t.dataset.uiScheme, on: t.classList.contains('on') })))
  check('theme-drawer-has-scheme-tiles', tiles.length === 3 && tiles.some((t) => t.s === 'classic' && t.on) && tiles.some((t) => t.s === 'proto' && !t.on) && tiles.some((t) => t.s === 'd' && !t.on), JSON.stringify(tiles))

  // ---- 3. 点击「原型工作台」→ 主进程重载到原型方案入口 ----
  await win.click('[data-ui-scheme="proto"]')
  await win.waitForTimeout(2200)
  st = await win.evaluate(() => ({ dock: !!document.querySelector('.command-dock'), island: !!document.querySelector('.dynamic-island'), scheme: window.api.uiScheme && null, entry: location.pathname.replace(/\\/g, '/') }))
  st.scheme = await win.evaluate(() => window.api.uiScheme())
  check('switch-to-proto-reloads-entry', st.dock && st.island && st.scheme === 'proto' && st.entry.includes('/ui/proto/index.html'), JSON.stringify(st))

  // ---- 4. 原型方案主题抽屉可切回经典 ----
  await win.click('#btn-theme')
  await win.waitForTimeout(500)
  const protoTiles = await win.evaluate(() => [...document.querySelectorAll('[data-ui-scheme]')].map((t) => ({ s: t.dataset.uiScheme, on: t.classList.contains('on') })))
  check('proto-drawer-reflects-proto', protoTiles.some((t) => t.s === 'proto' && t.on), JSON.stringify(protoTiles))
  await win.click('[data-ui-scheme="classic"]')
  await win.waitForTimeout(2200)
  st = await win.evaluate(() => ({ dock: !!document.querySelector('.command-dock'), sidebar: !!document.querySelector('#sidebar'), entry: location.pathname.replace(/\\/g, '/') }))
  check('switch-back-to-classic', !st.dock && st.sidebar && st.entry.includes('/ui/classic/index.html'), JSON.stringify(st))

  // ---- 4.5 方案D「通用阅读」：切换 → 三态面板交互（图钉/细轨/浮层） ----
  await win.click('#btn-theme')
  await win.waitForTimeout(400)
  await win.click('[data-ui-scheme="d"]')
  await win.waitForTimeout(2200)
  st = await win.evaluate(() => ({ sidebar: !!document.querySelector('#sidebar'), rail: !!document.querySelector('#rail-strip'), pin: !!document.querySelector('#btn-sb-pin'), entry: location.pathname.replace(/\\/g, '/') }))
  st.scheme = await win.evaluate(() => window.api.uiScheme())
  check('switch-to-d-reloads-entry', st.sidebar && st.rail && st.pin && st.scheme === 'd' && st.entry.includes('/ui/d/index.html'), JSON.stringify(st))

  // 初始态归一化：若上次测试遗留细轨态（sbDock 持久化），先通过磁贴恢复停靠，再验证三态
  let d0 = await win.evaluate(() => document.body.dataset.sb)
  if (d0 !== 'dock') {
    await win.keyboard.press('Control+b')   // 浮层中可见图钉 → 钉回停靠
    await win.waitForTimeout(400)
    await win.evaluate(() => document.getElementById('btn-sb-pin') && document.getElementById('btn-sb-pin').click())
    await win.waitForTimeout(400)
  }
  // 初始停靠：内联占位
  let d1 = await win.evaluate(() => ({ sb: document.body.dataset.sb, dock: !document.getElementById('sidebar').classList.contains('collapsed'), pinOn: document.getElementById('btn-sb-pin').classList.contains('on') }))
  check('d-initial-dock-inline', d1.sb === 'dock' && d1.dock && d1.pinOn, JSON.stringify(d1))

  // 图钉取消停靠 → 细轨态（不占布局）
  await win.click('#btn-sb-pin')
  await win.waitForTimeout(400)
  let d2 = await win.evaluate(() => ({ sb: document.body.dataset.sb, rail: document.getElementById('rail-strip').classList.contains('show'), pinOn: document.getElementById('btn-sb-pin').classList.contains('on') }))
  check('d-unpin-to-rail', d2.sb === 'rail' && d2.rail && !d2.pinOn, JSON.stringify(d2))

  // 细轨态 Ctrl+B → 浮层（overlay 定位，不占布局）
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)
  let d3 = await win.evaluate(() => ({ float: document.getElementById('sidebar').classList.contains('sb-float'), chatX: Math.round(document.querySelector('.chat').getBoundingClientRect().x), pos: getComputedStyle(document.getElementById('sidebar')).position }))
  check('d-ctrlb-opens-float', d3.float && d3.pos === 'absolute', JSON.stringify(d3))

  // 再按 Ctrl+B 收回浮层；再按重新停靠（浮层中点图钉）
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(300)
  let d4 = await win.evaluate(() => document.getElementById('sidebar').classList.contains('sb-float'))
  check('d-ctrlb-closes-float', !d4)
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(300)
  await win.click('#btn-sb-pin')
  await win.waitForTimeout(400)
  let d5 = await win.evaluate(() => ({ sb: document.body.dataset.sb, pinOn: document.getElementById('btn-sb-pin').classList.contains('on'), inlineW: document.getElementById('sidebar').getBoundingClientRect().width > 100 }))
  check('d-repin-docks-inline', d5.sb === 'dock' && d5.pinOn && d5.inlineW, JSON.stringify(d5))

  // 停靠磁贴：主题抽屉「细轨浮层」选项 → 未停靠；「停靠展开」→ 恢复
  await win.click('#btn-theme')
  await win.waitForTimeout(500)
  const sbTiles = await win.evaluate(() => [...document.querySelectorAll('#theme-pop [data-sb]')].map((t) => ({ s: t.dataset.sb, on: t.classList.contains('on') })))
  check('d-drawer-has-sb-tiles', sbTiles.length === 2 && sbTiles.some((t) => t.s === 'dock' && t.on), JSON.stringify(sbTiles))
  await win.click('[data-sb="rail"]')
  await win.waitForTimeout(400)
  let d6 = await win.evaluate(() => ({ sb: document.body.dataset.sb, dockTiles: [...document.querySelectorAll('#theme-pop [data-sb]')].filter((t) => t.classList.contains('on')).map((t) => t.dataset.sb) }))
  check('d-tile-rail-unpins', d6.sb === 'rail' && d6.dockTiles.includes('rail'), JSON.stringify(d6))
  await win.click('[data-sb="dock"]')
  await win.waitForTimeout(400)
  let d7 = await win.evaluate(() => document.body.dataset.sb)
  check('d-tile-dock-restores', d7 === 'dock')

  // 悬停路径：切细轨 → 关抽屉 → 悬停细轨 500ms → 浮层浮出 → 移开阅读区 → 800ms 后收回
  await win.click('[data-sb="rail"]')
  await win.waitForTimeout(600)   // 越过细轨 500ms 抑制期
  await win.click('#btn-theme-close')
  await win.waitForTimeout(400)
  await win.hover('#rail-strip')
  await win.waitForTimeout(500)
  let d8 = await win.evaluate(() => ({ float: document.getElementById('sidebar').classList.contains('sb-float'), pos: getComputedStyle(document.getElementById('sidebar')).position }))
  check('d-hover-rail-opens-float', d8.float && d8.pos === 'absolute', JSON.stringify(d8))
  await win.hover('#messages')
  await win.waitForTimeout(800)
  let d9 = await win.evaluate(() => ({ float: document.getElementById('sidebar').classList.contains('sb-float'), sb: document.body.dataset.sb, rail: document.getElementById('rail-strip').classList.contains('show') }))
  check('d-hover-away-retracts', !d9.float && d9.sb === 'rail' && d9.rail, JSON.stringify(d9))

  // 收尾：恢复停靠（避免细轨态持久化污染下次运行的初始断言）
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)
  await win.evaluate(() => document.getElementById('btn-sb-pin').click())
  await win.waitForTimeout(400)
  let d10 = await win.evaluate(() => document.body.dataset.sb)
  check('d-final-restore-dock', d10 === 'dock')

  // 切回经典，保证后续断言从经典开始
  await win.click('#btn-theme')
  await win.waitForTimeout(400)
  await win.click('[data-ui-scheme="classic"]')
  await win.waitForTimeout(2200)

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
  check('restart-persists-proto', st.dock && st.entry.includes('/ui/proto/index.html'), JSON.stringify(st))

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

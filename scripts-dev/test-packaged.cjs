'use strict'
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')

async function main() {
  const root = path.join(__dirname, '..')
  const executable = path.join(root, 'dist', 'win-unpacked', '六面世界.exe')
  if (!fs.existsSync(executable)) throw new Error('打包目录不存在，请先运行 npm run dist')
  const resources = path.join(root, 'dist', 'win-unpacked', 'resources')

  // ---- 打包产物静态检查：原型方案已入 asar；sqlite-vec dll 已解包 ----
  const asarBuf = fs.readFileSync(path.join(resources, 'app.asar'))
  if (!asarBuf.includes('renderer-proto')) throw new Error('app.asar 缺少 renderer-proto（原型方案未打包）')
  if (!asarBuf.includes(Buffer.from('sessions-client.js'))) throw new Error('app.asar 缺少 shared/sessions-client.js（双方案共享会话数据层未打包——两侧启动即崩）')
  if (!asarBuf.includes(Buffer.from('cat.png'))) throw new Error('app.asar 缺少 build/cat.png（品牌图未打包）')
  const dll = path.join(resources, 'app.asar.unpacked', 'node_modules', 'sqlite-vec-windows-x64', 'vec0.dll')
  if (!fs.existsSync(dll)) throw new Error('sqlite-vec 的 vec0.dll 未解包到 app.asar.unpacked')

  // ---- 桌宠本地小模型依赖：node-llama-cpp（JS + win-x64 CPU/vulkan 后端）已解包（native .node 不能在 asar 内加载）----
  const llamaJs = path.join(resources, 'app.asar.unpacked', 'node_modules', 'node-llama-cpp', 'dist', 'bindings', 'getLlama.js')
  if (!fs.existsSync(llamaJs)) throw new Error('node-llama-cpp 的 dist/bindings/getLlama.js 未解包到 app.asar.unpacked（桌宠本地模型无法加载）')
  const walkBins = (dir) => {
    let found = []
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name)
      if (f.isDirectory()) found = found.concat(walkBins(full))
      else if (f.name.endsWith('.node')) found.push(full)
    }
    return found
  }
  const llamaBins = walkBins(path.join(resources, 'app.asar.unpacked', 'node_modules', '@node-llama-cpp'))
  if (!llamaBins.length) throw new Error('@node-llama-cpp 的 .node 后端二进制未解包（桌宠本地模型无法加载）')
  const backends = [...new Set(llamaBins.map((p) => path.basename(path.dirname(path.dirname(path.dirname(p))))))]
  const unwanted = backends.filter((b) => b !== 'win-x64' && b !== 'win-x64-vulkan')
  if (unwanted.length) throw new Error('桌宠模型后端混入了多余平台包（应只留 win-x64 CPU + Vulkan）：' + unwanted.join(', '))
  console.log('  桌宠模型后端二进制：' + backends.join(', '))

  const app = await electron.launch({
    executablePath: executable,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  let win = null
  try {
    win = await app.firstWindow()
    // 环境自清理：上次运行可能残留 proto 方案持久化，统一先回经典再跑流程
    const startScheme = await win.evaluate(() => window.api.uiScheme()).catch(() => 'classic')
    if (startScheme !== 'classic') {
      await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
      await win.waitForSelector('#sidebar', { state: 'visible', timeout: 15000 })
      await win.waitForTimeout(800)
    }
    await win.waitForSelector('#kernel-state', { state: 'visible' })
    await win.waitForFunction(() => document.querySelector('#kernel-state')?.textContent.includes('已加载'))
    // 等启动序列彻底结束（splash 退场），否则过早点「内核设计」会被启动尾段的视图初始化覆盖
    await win.waitForFunction(() => {
      const s = document.querySelector('#splash')
      return !s || s.classList.contains('hidden')
    }, { timeout: 15000 }).catch(() => {})
    await win.waitForTimeout(400)
    const errors = []
    win.on('pageerror', (e) => errors.push(String(e)))
    // ---- 内核工作台：经典版流程为「设计标签 → hub 打开 → 内核库按钮 → 抽屉滑入」 ----
    await win.click('#btn-kernel-hub')
    await win.waitForSelector('#kernel-hub:not([hidden])')
    await win.waitForSelector('#btn-kernel-library', { state: 'visible' })
    // ---- 内核库抽屉：library-open 类挂上后 #kernel-search 才在屏内 ----
    await win.click('#btn-kernel-library')
    await win.waitForFunction(() => document.querySelector('#kernel-hub')?.classList.contains('library-open'), undefined, { timeout: 10000 })
    await win.waitForSelector('#kernel-search', { state: 'visible' })
    const cards = await win.locator('#kernel-cards .kernel-card').count()
    await win.fill('#kernel-search', '玄寰')
    await win.waitForTimeout(250)
    const filteredCards = await win.locator('#kernel-cards .kernel-card').count()
    await win.fill('#kernel-search', '')
    await win.click('#btn-kernel-library-close')
    await win.click('#btn-theme')
    await win.waitForSelector('#theme-pop:not(.hidden)')
    const themeControls = await win.locator('#theme-pop [data-setting]').count()
    const title = await win.title()
    const contentTab = await win.locator('#btn-content-area').isVisible()

    // ---- 界面方案：打包版内切换到原型工作台（入口存在 + 品牌图可加载 + 向量层未停用） ----
    await win.click('[data-ui-scheme="proto"]')
    await win.waitForSelector('.command-dock', { state: 'visible', timeout: 15000 })
    await win.waitForTimeout(800)
    const brandOk = await win.evaluate(() => {
      const img = document.querySelector('.brand-block img')
      return !!img && img.complete && img.naturalWidth > 0
    })
    // 触发引擎初始化 → 主进程加载 sqlite-vec；直接查诊断接口而不是猜日志
    await win.evaluate(() => window.api.engineOverview('packaged-probe'))
    await win.waitForTimeout(600)
    const vecStats = await win.evaluate(() => window.api.vectorStats())
    const vecDisabled = !(vecStats && vecStats.enabled === true)

    // 切回经典
    await win.click('#btn-theme')
    await win.waitForTimeout(400)
    await win.click('[data-ui-scheme="classic"]')
    await win.waitForSelector('#sidebar', { state: 'visible', timeout: 15000 })

    console.log('PACKAGED_SMOKE', JSON.stringify({ title, cards, filteredCards, themeControls, contentTab, brandOk, vecDisabled, errors }))
    if (!title || cards < 2 || filteredCards !== 1 || themeControls < 25 || !contentTab || errors.length) throw new Error('打包应用冒烟失败')
    if (!brandOk) throw new Error('原型方案品牌图（cat.png）加载失败')
    if (vecDisabled) throw new Error('打包版 sqlite-vec 加载失败（向量层被停用）')
  } finally {
    // 无论成败，恢复经典方案，避免污染下一次运行的持久化
    try {
      const w = win || await app.firstWindow()
      await w.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
      await w.waitForTimeout(1200)
    } catch {}
    await app.close().catch(() => {})
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })

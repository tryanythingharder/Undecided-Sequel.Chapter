'use strict'
/* 作者工具桌面联调（真实 Electron + 真实 ipcMain + 真实渲染模块）
 *
 * 与 test-author-tools.cjs（纯 Node 单测）分工：本文件验证「主进程 register() 契约 +
 * preload 桥 + window.AuthorTools 渲染模块」三段的真实串联，产物落在
 * workspace/output/author-tools-desktop（不用 os.tmpdir，也不写真实 userData 档案）。
 *
 * 生成的测试宿主（main.cjs / preload.cjs / index.html）只存在于 output/ 下，不是产品文件。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')

const repoRoot = path.join(__dirname, '..')
const outRoot = path.join(repoRoot, 'output', 'author-tools-desktop')
const profile = path.join(outRoot, 'profile')
fs.rmSync(outRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(profile, 'story-engine', 'stories'), { recursive: true })
const realStory = path.join(profile, 'story-engine', 'stories', 'real-story.json')
fs.writeFileSync(realStory, JSON.stringify({ story_id: 'real-story', counters: { turn: 7 } }))
const realStoryBytes = fs.readFileSync(realStory, 'utf8')

/* 测试宿主主进程：把 engine/author-tools.cjs 接到真实 ipcMain，preload 暴露 author* 方法。
 * kernelSource 复用仓库真实内核文件（与 main.cjs 的 kernels:list/read 同形）。 */
fs.writeFileSync(path.join(outRoot, 'main.cjs'), `
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { register } = require(${JSON.stringify(path.join(repoRoot, 'engine', 'author-tools.cjs'))})
const BUILTIN = ${JSON.stringify(path.join(repoRoot, 'kernel.md'))}
app.setPath('userData', ${JSON.stringify(profile)})
// 与 main.cjs 的 queueSessionOperation 同形：串行 + 把异常吞成 { ok:false, error }（验证 register 能还原失败）
let queue = Promise.resolve()
const serial = (task) => { queue = queue.then(task, task); return queue.catch((error) => ({ ok: false, error: error.message || String(error) })) }
register({
  ipcMain,
  dataRoot: ${JSON.stringify(profile)},
  queue: serial,
  kernelSource: {
    list: () => [
      { id: 'builtin:kernel.md', name: 'kernel', source: 'builtin', size: fs.statSync(BUILTIN).size, mtime: 1 },
      { id: 'user:test-kernel', name: 'test-kernel', source: 'user', size: 120, mtime: 3 }
    ],
    read: (id) => {
      if (id === 'builtin:kernel.md') return { ok: true, id, name: 'kernel', text: fs.readFileSync(BUILTIN, 'utf8') }
      if (id === 'user:test-kernel') return { ok: true, id, name: 'test-kernel', text: process.env.AUTHOR_TEST_KERNEL || '' }
      return { ok: false, error: '未知内核 id' }
    }
  }
})
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'index.html'))
})
`)

/* 测试宿主 preload：按交付契约暴露 author* 方法（与建议父集成 preload 写法一致） */
fs.writeFileSync(path.join(outRoot, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('api', {
  authorVersions: (p) => ipcRenderer.invoke('author:versions', p),
  authorVersionRegister: (p) => ipcRenderer.invoke('author:version-register', p),
  authorVersionRead: (p) => ipcRenderer.invoke('author:version-read', p),
  authorDiff: (p) => ipcRenderer.invoke('author:diff', p),
  authorCurated: (p) => ipcRenderer.invoke('author:curated', p),
  authorPreview: (p) => ipcRenderer.invoke('author:preview', p),
  authorSandboxList: (p) => ipcRenderer.invoke('author:sandbox-list', p),
  authorSandboxOpen: (p) => ipcRenderer.invoke('author:sandbox-open', p),
  authorSandboxContext: (p) => ipcRenderer.invoke('author:sandbox-context', p),
  authorSandboxTurn: (p) => ipcRenderer.invoke('author:sandbox-turn', p),
  authorSandboxClose: (p) => ipcRenderer.invoke('author:sandbox-close', p),
  authorSuiteRun: (p) => ipcRenderer.invoke('author:suite-run', p),
  authorRecords: (p) => ipcRenderer.invoke('author:records', p),
  authorRecord: (p) => ipcRenderer.invoke('author:record', p),
  authorReplay: (p) => ipcRenderer.invoke('author:replay', p)
})
`)

/* 测试宿主页面：按交付契约装配 window.AuthorTools（不加载 app.js / ProductTools） */
fs.writeFileSync(path.join(outRoot, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<link rel="stylesheet" href="../../ui/shared/works.css" />
<link rel="stylesheet" href="../../ui/shared/theme-system.css" />
<link rel="stylesheet" href="../../ui/shared/product-tools.css" />
</head><body>
<header class="chat-header"><div class="chat-head-right"></div></header>
<div class="layout"><div class="sidebar"><div class="sidebar-foot"></div></div><div class="chat"><div id="input"></div></div></div>
<script src="../../ui/shared/a11y.js"></script>
<script src="../../ui/shared/author-tools.js"></script>
<script>
  const KERNEL_A = '# 测试内核\\n\\n规则一：世界由六面构成。\\n规则二：记忆不可篡改。\\n'
  const KERNEL_B = '# 测试内核\\n\\n规则一：世界由六面构成。\\n规则二：记忆不可篡改（修订）。\\n规则三：新增条款。\\n'
  window.__toasts = []
  window.__confirmed = 0
  window.AuthorTools = window.AuthorTools.create({
    api: window.api,
    toast: (message, kind) => window.__toasts.push(kind + ':' + message),
    confirm: async () => { window.__confirmed += 1; return true },
    prompt: async () => 'x',
    busy: () => false,
    kernel: () => ({ id: 'user:test-kernel', name: '测试内核', text: window.__kernelText || KERNEL_A })
  })
  window.__kernelText = KERNEL_A
  window.AuthorTools.mount()
  window.__setKernel = (text) => { window.__kernelText = text }
  window.__KERNEL_B = KERNEL_B
</script>
</body></html>`)

const waitText = async (win, selector, text) => {
  await win.waitForFunction(({ selector, text }) => {
    const el = document.querySelector(selector)
    return !!el && el.textContent.includes(text)
  }, { selector, text }, { timeout: 20000 })
}
const clickButton = async (win, label) => {
  const button = win.locator('button', { hasText: label }).first()
  await button.waitFor({ state: 'visible', timeout: 20000 })
  await button.click()
}
const waitToast = async (win, text) => {
  await win.waitForFunction((text) => (window.__toasts || []).some((item) => item.includes(text)), text, { timeout: 20000 })
}

async function main() {
  const app = await electron.launch({
    executablePath: require('electron'),
    cwd: repoRoot,
    args: [path.join(outRoot, 'main.cjs')],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', AUTHOR_TEST_KERNEL: '# 测试内核\n\n规则一：世界由六面构成。\n规则二：记忆不可篡改。\n' }
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', (error) => errors.push(error.message))
    await win.waitForSelector('#btn-author-tools')
    assert.equal(await win.locator('#btn-author-tools').textContent(), '作者', 'mount 应在工作台头部挂入口')

    // ---- 1. 版本登记（真实 IPC → 主进程不可变版本文件） ----
    await clickButton(win, '作者')
    await waitText(win, '.product-panel', '尚无已登记版本')
    await clickButton(win, '登记当前内核版本')
    await waitText(win, '.product-panel', 'hash ')
    const versions = await win.evaluate(() => window.api.authorVersions({ kernelId: 'user:test-kernel' }))
    assert.equal(versions.ok, true)
    assert.equal(versions.data.length, 1)
    const hashA = versions.data[0].hash
    assert.ok(fs.existsSync(path.join(profile, 'author-tools', 'versions', 'user-test-kernel', hashA + '.json')), '版本文件应落在档案目录')

    // ---- 2. 版本差异（第二版登记后比较） ----
    await win.evaluate(() => window.__setKernel(window.__KERNEL_B))
    await clickButton(win, '登记当前内核版本')
    await win.waitForFunction(() => document.querySelectorAll('.product-panel .product-row').length === 2, null, { timeout: 20000 })
    await clickButton(win, '比较版本')
    await waitText(win, '.product-panel', '基准版本')
    await clickButton(win, '开始比较')
    await waitText(win, '.product-panel', '新增 2 行 · 删除 1 行')
    const diff = await win.evaluate((hashA) => window.api.authorDiff({ kernelId: 'user:test-kernel', from: hashA, to: '' }), hashA)
    assert.equal(diff.ok, false, '缺少 to 应返回可读错误而不是崩溃')
    const diffOk = await win.evaluate(async (hashA) => {
      const list = await window.api.authorVersions({ kernelId: 'user:test-kernel' })
      const other = list.data.find((item) => item.hash !== hashA).hash
      return window.api.authorDiff({ kernelId: 'user:test-kernel', from: hashA, to: other })
    }, hashA)
    // 宿主内核无 KERNEL_META：规则二修订 + 规则三新增 → 增 2 删 1
    assert.equal(diffOk.data.stats.added, 2)
    assert.equal(diffOk.data.stats.removed, 1)

    // ---- 3. 沙盒试玩（离线回合，不发起模型请求） ----
    await win.evaluate(() => document.querySelector('.product-panel .product-close').click())
    await clickButton(win, '作者')
    await win.waitForSelector('.product-panel')
    await win.evaluate(() => { window.AuthorTools.sandbox() })
    await waitText(win, '.product-panel', '当前没有沙盒')
    await clickButton(win, '创建独立沙盒')
    await waitText(win, '.product-panel', '沙盒 SBX-')
    await win.fill('.product-panel input[aria-label="沙盒行动"]', '我在沙盒里观察四周')
    await clickButton(win, '提交离线回合（不调用模型）')
    await waitToast(win, '沙盒回合 1 已提交（离线）')
    const sandboxes = await win.evaluate(() => window.api.authorSandboxList())
    assert.equal(sandboxes.data.length, 1)
    assert.equal(sandboxes.data[0].turns, 1)
    const sandboxEngineDir = path.join(profile, 'author-tools', 'sandbox', sandboxes.data[0].sandboxId, 'engine', 'stories')
    assert.ok(fs.readdirSync(sandboxEngineDir).some((file) => file.endsWith('.json')), '沙盒回合应写入沙盒自己的引擎目录')

    // 真实试玩在未注入 realTurn 时必须被拒绝（默认不调用模型）
    await clickButton(win, '真实试玩（使用已配置模型）')
    await waitToast(win, '真实试玩未接入')
    assert.equal(await win.evaluate(() => window.__confirmed), 0, '未接入真实试玩时不应弹确认框')

    // ---- 4. 可重现测试记录：运行 + 复跑比对 ----
    await win.evaluate(() => { document.querySelector('.product-panel .product-close').click(); window.AuthorTools.records() })
    await waitText(win, '.product-panel', '暂无测试记录')
    await clickButton(win, '运行内核测试')
    await waitText(win, '.product-panel', '通过 · 内核')
    const records = await win.evaluate(() => window.api.authorRecords({ kernelId: 'user:test-kernel' }))
    assert.equal(records.data[0].ok, true)
    assert.equal(records.data[0].cases.length, 8)
    await clickButton(win, '查看详情')
    await waitText(win, '.product-panel', '测试记录 ATR-')
    await waitText(win, '.product-panel', '通过 · 写盘失败：内存与磁盘保持提交前状态')
    await waitText(win, '.product-panel', '通过 · 快照恢复：状态回到快照点')
    await waitText(win, '.product-panel', '通过 · 沙盒隔离：真实世界线目录零改动')
    await clickButton(win, '返回记录列表')
    await clickButton(win, '复跑比对')
    await waitText(win, '.product-panel', '复跑一致')

    // ---- 5. 精选内核：元数据与预览 ----
    await win.evaluate(() => { document.querySelector('.product-panel .product-close').click(); window.AuthorTools.library() })
    await waitText(win, '.product-panel', '已登记版本')
    const curated = await win.evaluate(() => window.api.authorCurated())
    const builtinEntry = curated.data.find((item) => item.kernelId === 'builtin:kernel.md')
    assert.equal(builtinEntry.license, 'MIT', '内置内核应带许可元数据')
    assert.ok(builtinEntry.recommendedModels.length > 0)
    assert.ok(builtinEntry.genres.length > 0)
    assert.equal(builtinEntry.readable, true)
    const userEntry = curated.data.find((item) => item.kernelId === 'user:test-kernel')
    assert.ok(userEntry.registeredVersions >= 2, '精选列表应带出已登记版本数')
    await win.locator('.product-panel .product-row', { hasText: 'test-kernel' }).locator('button', { hasText: '预览' }).first().click()
    await waitText(win, '.product-panel', '规则一：世界由六面构成。')

    // ---- 6. 失败路径：串行队列把异常吞成 { ok:false } 时 register 仍须还原为失败 ----
    const badTurn = await win.evaluate(() => window.api.authorSandboxTurn({ sandboxId: 'SBX-not-exist', input: 'x' }))
    assert.equal(badTurn.ok, false, '沙盒不存在应返回 ok:false')
    assert.match(badTurn.error, /沙盒不存在/)
    const badVersion = await win.evaluate(() => window.api.authorVersionRegister({ kernelId: 'user:test-kernel', text: '   ' }))
    assert.equal(badVersion.ok, false, '空内核内容应返回 ok:false')

    // ---- 7. 隔离与无异常 ----
    assert.equal(fs.readFileSync(realStory, 'utf8'), realStoryBytes, '真实世界线文件不得被改写')
    assert.deepEqual(errors, [], '渲染层不应有未捕获异常')
    assert.equal(await win.evaluate(() => document.querySelectorAll('.product-mask').length), 1, '同一时刻只应有一个浮层')
    assert.equal(await win.evaluate(() => document.querySelectorAll('#btn-author-tools').length), 1, '入口只应挂一次')
    assert.equal(await win.evaluate(() => document.getElementById('btn-author-tools').closest('.chat-head-right') !== null), true, '头部可见时应挂在头部')
    // 头部被 CSS 隐藏的方案（proto）：入口应回落到会话栏底部
    const fallback = await win.evaluate(() => {
      document.querySelector('.chat-head-right').style.display = 'none'
      document.getElementById('btn-author-tools').remove()
      const ok = window.AuthorTools.mount()
      const el = document.getElementById('btn-author-tools')
      return { ok, inFoot: !!(el && el.closest('.sidebar-foot')), count: document.querySelectorAll('#btn-author-tools').length }
    })
    assert.equal(fallback.ok, true)
    assert.equal(fallback.inFoot, true, '头部隐藏时应回落到会话栏底部')
    assert.equal(fallback.count, 1)
    console.log('PASS author-tools desktop: ipcMain register + preload bridge + AuthorTools panels (versions/diff/sandbox/suite/curated)')
  } finally {
    await app.close()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })

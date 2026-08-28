// UI 冒烟测试：验证新 UI 渲染 + 设置独立窗口（分页签） + 图像模型设置 + 插图 UI（不调真实 API）
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

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
  await win.waitForTimeout(1500)
  // 清空持久化配置，验证「首次启动」的默认状态
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1500)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // 基础 UI 存在
  check('titlebar', await win.locator('.titlebar').count() === 1)
  check('sidebar', await win.locator('.sidebar').count() === 1)
  check('empty-state', await win.locator('.empty').count() === 1)
  check('gallery-btn-in-titlebar', await win.locator('#btn-gallery').count() === 1)

  // 内核加载
  const kstate = await win.locator('#kernel-state').textContent()
  check('kernel-loaded', kstate.includes('已加载'))

  // 设置（独立系统窗口 · 分页签）
  await win.click('#btn-settings')
  const sw = await settingsWindow(app)
  check('settings-window-visible', !!sw)
  check('settings-tabs-4', (await sw.locator('.modal-tabs .tab').count()) === 4)
  check('text-tab-active', await sw.locator('.tab[data-tab="text"]').evaluate((el) => el.classList.contains('active')))
  check('text-panel-active', await sw.locator('.tab-panel[data-panel="text"]').isVisible())
  check('image-panel-hidden-init', await sw.locator('.tab-panel[data-panel="image"]').evaluate((el) => el.hidden))

  // 文本预设默认
  const presetVal = await sw.inputValue('#set-preset')
  const baseVal = await sw.inputValue('#set-baseurl')
  check('preset default deepseek', presetVal === 'deepseek', presetVal)
  check('base url default', baseVal === 'https://api.deepseek.com', baseVal)
  // 分组标题（Codex 式信息层级）
  check('text-panel-group-headers', (await sw.locator('.tab-panel[data-panel="text"] h3').count()) >= 2)
  // 模型组合框：获取按钮 + 下拉面板结构
  check('model-fetch-btn-text', (await sw.locator('#btn-models-text').count()) === 1)
  check('model-dropdown-structure', (await sw.locator('#model-dd-text .model-filter').count()) === 1 && (await sw.locator('#model-opts-text').count()) === 1)
  check('model-fetch-btn-image', (await sw.locator('#btn-models-image').count()) === 1)

  // 切到「插图模型」页签
  await sw.click('.tab[data-tab="image"]')
  await sw.waitForTimeout(200)
  check('image-tab-active', await sw.locator('.tab[data-tab="image"]').evaluate((el) => el.classList.contains('active')))
  check('image-panel-visible', await sw.locator('.tab-panel[data-panel="image"]').isVisible())
  check('illust-preset-select', await sw.locator('#set-illust-preset').count() === 1)
  check('illust-style-select', await sw.locator('#set-illust-style').count() === 1)
  check('illust-style-has-ln-original', (await sw.locator('#set-illust-style option[value="ln-original"]').count()) === 1)
  check('illust-style-has-custom', (await sw.locator('#set-illust-style option[value="custom"]').count()) === 1)
  check('illust-size-select', await sw.locator('#set-illust-size').count() === 1)
  check('illust-auto-check', await sw.locator('#set-illust-auto').count() === 1)
  check('illust-custom-textarea', await sw.locator('#set-illust-custom').count() === 1)
  check('illust-custom-label-hidden-by-default', await sw.locator('#set-illust-custom-label').evaluate((el) => el.classList.contains('hidden')))
  check('illust-negative-input', await sw.locator('#set-illust-negative').count() === 1)
  check('illust-seed-input', await sw.locator('#set-illust-seed').count() === 1)
  check('illust-seed-lock-check', await sw.locator('#set-illust-seed-lock').count() === 1)

  // 选择智谱预设 → 自动填充模型
  await sw.selectOption('#set-illust-preset', 'zhipu')
  check('illust-preset-fills-model', (await sw.locator('#set-illust-model').inputValue()) === 'cogview-4')

  // 选「自定义」风格 → 自定义提示词输入框出现
  await sw.selectOption('#set-illust-style', 'custom')
  await sw.waitForTimeout(150)
  check('illust-custom-visible-on-custom', !(await sw.locator('#set-illust-custom-label').evaluate((el) => el.classList.contains('hidden'))))
  await sw.selectOption('#set-illust-style', 'ln-original')
  await sw.waitForTimeout(150)
  check('illust-custom-hidden-again', await sw.locator('#set-illust-custom-label').evaluate((el) => el.classList.contains('hidden')))

  // 高级页签
  await sw.click('.tab[data-tab="advanced"]')
  await sw.waitForTimeout(200)
  check('advanced-panel-visible', await sw.locator('.tab-panel[data-panel="advanced"]').isVisible())
  check('advanced-group-headers', (await sw.locator('.tab-panel[data-panel="advanced"] h3').count()) >= 2)
  check('ctx-count-input', await sw.locator('#set-ctx').count() === 1)
  check('keep-count-input', await sw.locator('#set-keep').count() === 1)
  check('illust-minlen-input', await sw.locator('#set-illust-minlen').count() === 1)
  check('clear-sessions-btn', await sw.locator('#btn-clear-sessions').count() === 1)
  check('export-config-btn', await sw.locator('#btn-export-config').count() === 1)
  check('reset-settings-btn', await sw.locator('#btn-reset-settings').count() === 1)

  // 外观页签
  await sw.click('.tab[data-tab="appearance"]')
  await sw.waitForTimeout(200)
  check('appearance-panel-visible', await sw.locator('.tab-panel[data-panel="appearance"]').isVisible())
  check('theme-select', await sw.locator('#set-theme').count() === 1)

  // 保存设置 → 设置窗口关闭，主窗口收到广播
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(400)
  check('settings-window-closed-after-save', !(await settingsWindow(app, true)))

  // Toast 出现（保存成功，由主窗口显示）
  const toast = await win.locator('.toast.ok').count()
  check('toast-shown-on-save', toast >= 1)

  // 画廊：空态（当前会话无插图）
  await win.click('#btn-gallery')
  await win.waitForTimeout(300)
  check('gallery-visible', await win.locator('#gallery').isVisible())
  check('gallery-session-select', await win.locator('#gallery-session').count() === 1)
  check('gallery-empty-state', await win.locator('.gallery-empty').count() === 1)
  await win.click('#btn-gallery-close')
  await win.waitForTimeout(200)
  check('gallery-closed', await win.locator('#gallery').evaluate((el) => el.hidden))

  // 注入模拟会话验证渲染与选项解析 + ILLUST 按钮
  await win.evaluate(() => {
    const msgs = document.getElementById('messages')
    const empty = msgs.querySelector('.empty')
    if (empty) empty.remove()
    const div = document.createElement('div')
    div.className = 'msg assistant'
    div.innerHTML = '<div class="msg-role">WORLD<span class="msg-tools"><button class="tool-btn">ILLUST</button></span></div>' +
      '<div class="msg-body">【甲龙历 407.03.01｜清晨｜布耶纳村】薄雾中有敲门声。A. 开门 B. 继续睡</div>'
    const il = document.createElement('div')
    il.className = 'illust'
    il.innerHTML = '<img alt="场景插图" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">'
    div.insertBefore(il, div.querySelector('.msg-body'))
    msgs.appendChild(div)
  })
  check('illust-render', await win.locator('.illust img').count() === 1)
  check('illust-btn-render', await win.locator('.tool-btn').count() === 1)

  await win.screenshot({ path: path.join(__dirname, 'shot-ui-new.png') })
  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

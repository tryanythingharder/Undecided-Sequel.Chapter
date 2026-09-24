'use strict'
/* 体验工具 · 桌面渲染层验证（真实 Electron 渲染进程，三套界面）
 * 运行：node scripts-dev/test-experience-tools-desktop.cjs
 *
 * 界面方案：main.cjs 的 readUiScheme() 只读 userData/ui-scheme.json，不认 SIXWORLDS_UI_SCHEME。
 * 三套界面各跑一轮，每轮独立 workspace/output 下的 profile，并调正式 API window.api.setUiScheme()
 * 切换后断言实际入口 /ui/<scheme>/index.html 与 api 值一致（不再用环境变量冒充方案切换）。
 *
 * 本测试在「父代理尚未把 experience:* 接进 main.cjs / preload.cjs / index.html」的前提下运行，
 * 因此只验证渲染层自身能验证的部分，并如实标注未验证项： *   已验证
 *     - ui/shared/experience-tools.js 能在真实渲染进程按现有 CSP（default-src 'self'）加载，无页面错误；
 *     - 复用真实 engine/usage-ledger.js（同一份账本）后：真实用量/金额、未知报价、未知用量、部分返回、
 *       失败与中止任务的口径与既有账本一致；估计值与真实值分区标注；
 *     - 模型报价可手填并即时影响估计与真实金额；
 *     - 漫画页数估计：页数未知 / 未填图像报价 → 未知；
 *     - 诊断面板在未接入 experience:* 时明确说明「未接入」，不伪造存储统计；
 *       接入（注入）后递出的 payload 不含密钥 / 端点 / 模型名 / 正文；
 *     - 面板可打开/关闭、Escape 关闭并归还焦点、Tab 焦点被限制在对话框内；
 *     - 整个过程不发任何 http(s) 请求（面板自身不联网）；
 *     - 首玩向导：沿用现有配置（不覆盖）、离线示例展开零请求、本地内核提示。
 *   未验证（需父集成后再测，本测试不声称完成）
 *     - 主进程 experience:* 通道 → preload → 渲染层的真实端到端导出（需 main.cjs / preload.cjs 接线）；
 *     - 面板入口按钮挂进真实标题栏后的布局与主题回归（需 app.js / index.html 接线）。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')

const root = path.join(__dirname, '..')
const shots = path.join(root, 'output', 'experience-tools-tests', 'desktop')
fs.mkdirSync(shots, { recursive: true })
/* 每套界面独立 profile：profilesRoot 下 mkdtempSync 出唯一 run 根，每套方案各自一个子目录，
 * 落在 workspace/output 下（不写真实 userData、不复用历史数据）。 */
const profilesRoot = path.join(root, 'output', 'experience-tools-tests', 'desktop-profiles')
fs.mkdirSync(profilesRoot, { recursive: true })
const runRoot = fs.mkdtempSync(path.join(profilesRoot, 'run-'))

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + '  << ' + (extra === undefined ? '' : JSON.stringify(extra)).slice(0, 400)) }
}

let app = null

/* 在渲染进程内注入共享模块（真实 <script src>，走既有 CSP，不用 inline 脚本） */
const inject = (win, src, globalName) => win.evaluate(({ href, name }) => new Promise((resolve) => {
  if (window[name]) { resolve({ ok: true, cached: true }); return }
  const script = document.createElement('script')
  script.src = href
  script.onload = () => resolve({ ok: !!window[name] })
  script.onerror = () => resolve({ ok: false, error: 'script-error' })
  document.head.appendChild(script)
  setTimeout(() => resolve({ ok: !!window[name], timeout: true }), 5000)
}), { href: src, name: globalName })

async function runScheme(scheme) {
  console.log('\n== 界面方案 ' + scheme + ' ==')
  /* 每套方案独立 profile，落在 workspace/output 下（不写真实 userData、不复用历史数据）。 */
  const profile = path.join(runRoot, scheme)
  fs.mkdirSync(profile, { recursive: true })
  app = await electron.launch({
    executablePath: require('electron'), args: ['.'], cwd: root,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1', SIXWORLDS_TEST_USER_DATA: profile }
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (error) => errors.push(error.message))
  await win.waitForSelector('#input', { timeout: 30000 })
  await win.waitForTimeout(1200)
  /* 界面方案只走正式通道：main.cjs 的 readUiScheme() 只读 userData/ui-scheme.json，
   * 不认 SIXWORLDS_UI_SCHEME 环境变量（旧写法会让三套界面实际全跑 classic）。
   * 调正式 API window.api.setUiScheme(scheme)：主进程写真实 ui-scheme.json 并把当前窗口
   * loadFile 到对应入口（同一窗口重载），随后等实际入口落地并断言 api 值一致。 */
  const current = await win.evaluate(() => window.api.uiScheme())
  if (current !== scheme) await win.evaluate((s) => window.api.setUiScheme(s), scheme)
  await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
  await win.waitForSelector('#input', { timeout: 30000 })
  check(scheme + ' / 实际入口为 ui/' + scheme + '/index.html', (await win.evaluate(() => location.pathname.replace(/\\/g, '/'))).includes('/ui/' + scheme + '/index.html'), await win.evaluate(() => location.pathname))
  check(scheme + ' / 正式方案值 window.api.uiScheme() 与目标一致', (await win.evaluate(() => window.api.uiScheme())) === scheme)
  await win.waitForTimeout(1200)
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
      skipSplash: true, theme: 'dark', palette: 'classic',
      baseUrl: 'https://api.example.com/v1', apiKey: 'sk-live-should-not-leak', model: 'my-custom-model-v3',
      illustPreset: 'custom', illustBaseUrl: 'https://img.example.com/v1', illustModel: 'my-image-model'
    }))
    localStorage.setItem('sixworlds.comic.pref', JSON.stringify({ mode: 'ai', pageCount: 3 }))
  })
  await win.reload()
  await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
  await win.waitForSelector('#input', { timeout: 30000 })
  await win.waitForTimeout(1200)

  /* ---- 1. 模块按现有 CSP 加载 ---- */
  const loaded = await inject(win, '../shared/experience-tools.js', 'ExperienceTools')
  check(scheme + ' / 模块按现有 CSP 加载', loaded.ok === true, loaded)
  const ledgerLoaded = await inject(win, '../../engine/usage-ledger.js', 'UsageLedger')
  check(scheme + ' / 复用真实账本模块（同一份实现）', ledgerLoaded.ok === true && await win.evaluate(() => typeof window.UsageLedger === 'object'), ledgerLoaded)

  const network = []
  win.on('request', (request) => { if (/^https?:/i.test(request.url())) network.push(request.url()) })

  /* ---- 2. 准备真实账目：真实用量 / 无用量 / 部分返回 / 失败 / 中止 ---- */
  const setup = await win.evaluate(() => {
    const L = window.UsageLedger.createLedger({ idPrefix: 'DT' })
    L.setPrice('my-custom-model-v3', { currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8 })
    const a = L.start({ kind: 'chat', model: 'my-custom-model-v3' })
    L.finish(a, { ok: true, usage: { prompt_tokens: 1_000_000, completion_tokens: 250_000, total_tokens: 1_250_000 } })
    const b = L.start({ kind: 'chat', model: 'no-price-model' })
    L.finish(b, { ok: true, usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } })
    const c = L.start({ kind: 'chat', model: 'my-custom-model-v3' })
    L.finish(c, { ok: true }) // 端点未返回用量
    const d = L.start({ kind: 'chat', model: 'my-custom-model-v3' })
    L.finish(d, { ok: true, partial: true, usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
    const e = L.start({ kind: 'chat', model: 'my-custom-model-v3' })
    L.finish(e, { ok: false, errorCode: 'http-500' })
    const f = L.start({ kind: 'chat', model: 'my-custom-model-v3' })
    L.cancel(f)
    window.__dtLedger = L
    return L.summarize()
  })
  check(scheme + ' / 真实账本口径：6 次调用、1 次未知用量、1 次可能仍计费', setup.calls.total === 6 && setup.tokens.unknownEntries >= 2 && setup.cost.provisionalEntries === 1, setup.calls)

  /* ---- 3. 打开面板：默认显示真实用量（估计与真实分区） ---- */
  const toasts = []
  const captured = { reports: [] }
  const opened = await win.evaluate(async () => {
    const L = window.__dtLedger
    window.__dtToasts = []
    window.__dtCaptured = { reports: [] }
    const tools = window.ExperienceTools.create({
      api: {
        experienceReport: async (payload) => { window.__dtCaptured.reports.push(payload); return { ok: true, report: { schema: 'sixworlds.experience-diagnostics.v1' }, text: '{"schema":"sixworlds.experience-diagnostics.v1"}' } },
        experienceDiagnosticsInfo: async () => ({ ok: true, version: '1.5.3', stage: 'text-ready', storage: null })
      },
      cfg: () => ({ apiKey: 'sk-live-should-not-leak', baseUrl: 'https://api.example.com/v1', model: 'my-custom-model-v3', illustPreset: 'custom', illustModel: 'my-image-model' }),
      toast: (message) => window.__dtToasts.push(String(message)),
      session: () => ({ id: 's1', messages: [{ engineTurn: 1 }, { engineTurn: 2 }, { engineTurn: 3 }, { engineTurn: 4 }] }),
      comic: () => ({ pages: 4, mode: 'ai' }),
      runtime: {
        ledger: () => L, summarize: () => L.summarize(), entries: () => L.entries(), tasks: () => L.tasks(),
        setPrice: (model, price) => L.setPrice(model, price), prices: () => L.listPrices(), priceFor: (model) => L.getPrice(model)
      },
      options: { autoMount: false }
    })
    window.__dtTools = tools
    await tools.open('usage')
    return { panel: !!document.querySelector('.exp-panel'), tabs: document.querySelectorAll('.exp-tab').length, role: document.querySelector('.exp-panel').getAttribute('role') }
  })
  check(scheme + ' / 面板打开且为模态对话框（4 个标签页）', opened.panel === true && opened.tabs === 4 && opened.role === 'dialog', opened)
  check(scheme + ' / 焦点被移入面板（不留在正文）', await win.evaluate(() => document.querySelector('.exp-panel').contains(document.activeElement)))

  const usageText = await win.evaluate(() => document.querySelector('.exp-content').textContent)
  check(scheme + ' / 显示真实调用数 6 与进行中 0', /真实调用数[\s\S]{0,20}6/.test(usageText), usageText.slice(0, 200))
  check(scheme + ' / 未知用量被标注（不补 0）', /未返回用量/.test(usageText), usageText.slice(0, 300))
  check(scheme + ' / 真实累计费用按报价计算并标注可能仍计费', /真实累计费用/.test(usageText) && /可能仍计费/.test(usageText), usageText.slice(0, 400))
  check(scheme + ' / 估计区与真实区并存且标注为估计值', /单次调用估计/.test(usageText) && /估计值，以提供商账单为准/.test(usageText))
  check(scheme + ' / 漫画页数估计优先用注入来源（ctx.comic 当前计划 4 页）', /漫画面板当前计划/.test(usageText) && /4/.test(usageText.slice(-400)), usageText.slice(-400))

  /* ---- 4. 手填报价 → 真实金额与估计同步变化 ---- */
  const priceFlow = await win.evaluate(async () => {
    const tools = window.__dtTools
    const fill = (model, currency, input, output, image) => {
      const form = document.querySelector('.exp-content form')
      const inputs = [...form.querySelectorAll('input')]
      inputs[0].value = model
      inputs[1].value = currency
      inputs[2].value = input
      inputs[3].value = output
      inputs[4].value = image
      form.querySelector('button.primary').click()
    }
    await tools.open('price')
    fill('no-price-model', 'CNY', '3', '6', '0.5')
    await new Promise((resolve) => setTimeout(resolve, 150))
    // 图像模型另存一份按张报价：漫画页数估计应能取到（与文本模型分开计价）
    await tools.open('price')
    fill('my-image-model', 'CNY', '', '', '0.5')
    await new Promise((resolve) => setTimeout(resolve, 150))
    return {
      saved: !!window.__dtLedger.getPrice('no-price-model'),
      price: window.__dtLedger.getPrice('no-price-model'),
      imagePrice: window.__dtLedger.getPrice('my-image-model')
    }
  })
  check(scheme + ' / 手填报价落进同一份账本', priceFlow.saved === true && priceFlow.price.inputPerMTok === 3 && priceFlow.price.outputPerMTok === 6, priceFlow)
  check(scheme + ' / 图像报价按张保存（文本分项留空保持未知）',
    priceFlow.imagePrice && priceFlow.imagePrice.imagePerUnit === 0.5 && priceFlow.imagePrice.inputPerMTok === null, priceFlow.imagePrice)

  const afterPrice = await win.evaluate(async () => {
    await window.__dtTools.open('usage')
    const content = document.querySelector('.exp-content')
    // 把估计的模型名切到刚填过报价的模型：估计应从「未知（未填写报价）」变成可算金额
    const modelInput = content.querySelector('form input')
    modelInput.value = 'no-price-model'
    modelInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    return content.textContent
  })
  check(scheme + ' / 累计费用口径保持账本原值（后填报价不追溯改写已入账金额）', /真实累计费用/.test(afterPrice) && /已知 2 次/.test(afterPrice), afterPrice.slice(0, 300))
  check(scheme + ' / 手填报价后该模型的估计从「未填写报价」变为可算', /估计单次费用/.test(afterPrice) && !/未填写该模型的报价/.test(afterPrice), afterPrice.slice(0, 600))
  check(scheme + ' / 漫画估计在图像模型有报价后给出金额', /估计生图费用/.test(afterPrice) && !/未填写图像模型报价/.test(afterPrice), afterPrice.slice(-500))

  /* ---- 5. 任务状态：失败 / 中止 / 部分返回分别标记 ---- */
  const tasksText = await win.evaluate(async () => {
    await window.__dtTools.open('tasks')
    return document.querySelector('.exp-content').textContent
  })
  check(scheme + ' / 任务状态区分失败 / 部分返回 / 已中止', /失败/.test(tasksText) && /部分返回/.test(tasksText) && /已中止/.test(tasksText), tasksText.slice(0, 400))
  check(scheme + ' / 不代替提供商判断是否已计费', /不代为判断/.test(tasksText))

  /* ---- 6. 诊断：未接入存储统计时如实说明，不伪造 ---- */
  const diagText = await win.evaluate(async () => {
    await window.__dtTools.open('diag')
    await new Promise((resolve) => setTimeout(resolve, 60))
    return document.querySelector('.exp-content').textContent
  })
  check(scheme + ' / 存储统计未接入时明确说明（不显示伪造数字）', /存储统计通道未接入/.test(diagText), diagText.slice(0, 300))
  check(scheme + ' / 默认导出范围在界面上写明', /不含 API Key/.test(diagText) && /任何用户路径/.test(diagText))

  const payloadCheck = await win.evaluate(async () => {
    const built = await window.__dtTools.buildDiagnostics(false)
    const payload = window.__dtCaptured.reports[0]
    return { ok: built.ok, payload, json: JSON.stringify(payload) }
  })
  check(scheme + ' / 诊断 payload 不含密钥 / 端点 / 模型名 / 正文', !/sk-live|example\.com|my-custom-model-v3|my-image-model/.test(payloadCheck.json), payloadCheck.json.slice(0, 300))
  check(scheme + ' / 诊断 payload 只带布尔配置标志与用量聚合', payloadCheck.ok === true && Object.values(payloadCheck.payload.config).every((v) => typeof v === 'boolean') && typeof payloadCheck.payload.usage === 'object')

  /* ---- 7. 关闭行为：Escape 关闭 + 焦点归还 ---- */
  const closed = await win.evaluate(async () => {
    const host = document.createElement('div')
    host.id = 'dt-host'
    document.body.append(host)
    const button = window.__dtTools.mount('#dt-host')
    button.focus()
    await window.__dtTools.open('usage')
    const inside = document.querySelector('.exp-panel').contains(document.activeElement)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    const stillOpen = !!document.querySelector('.exp-panel')
    return { mounted: !!button, inside, stillOpen, restored: document.activeElement === button }
  })
  check(scheme + ' / mount() 提供统一入口按钮', closed.mounted === true)
  check(scheme + ' / Escape 关闭面板并把焦点还给入口按钮', closed.inside === true && closed.stillOpen === false && closed.restored === true, closed)
  await win.screenshot({ path: path.join(shots, scheme + '-panel.png') })

  /* ---- 8. 首玩向导：沿用现有配置 + 离线示例零请求 + 本地内核提示 ---- */
  const wizard = await win.evaluate(async () => {
    const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-live-should-not-leak', model: 'my-custom-model-v3', preset: 'deepseek', palette: 'classic', illustPreset: 'custom', illustBaseUrl: 'https://img.example.com/v1', illustModel: 'my-image-model' }
    let calls = 0
    const setup = window.Onboarding.createOnboarding({
      $: (id) => document.getElementById(id),
      cfg: () => cfg,
      api: { testEndpoint: async () => { calls++; return { ok: true, models: [] } } },
      PALETTES: [], applyTheme: () => {}, applyPalettePresetLink: () => {}, refreshModelSelect: () => {}, saveStore: () => {}, toast: () => {}
    })
    setup.showSetupWizard()
    await new Promise((resolve) => setTimeout(resolve, 60))
    const kernelHint = document.querySelector('.wizard-kernel-hint')
    document.querySelector('.wizard .primary').click() // 第 1 步 → 第 2 步
    await new Promise((resolve) => setTimeout(resolve, 60))
    const step2 = {
      baseUrl: document.querySelector('.wizard-baseurl') ? document.querySelector('.wizard-baseurl').value : null,
      model: document.querySelector('.wizard-model') ? document.querySelector('.wizard-model').value : null,
      apiKey: document.querySelector('.wizard-apikey') ? document.querySelector('.wizard-apikey').value : null,
      existingHint: !!document.querySelector('.wizard-existing-hint'),
      presetHint: !!document.querySelector('.wizard-preset-hint')
    }
    // 展开离线示例：纯本地，不应产生任何请求
    document.querySelector('.wizard-example-toggle').click()
    await new Promise((resolve) => setTimeout(resolve, 80))
    const example = {
      shown: !!document.querySelector('[data-example-block="1"]'),
      badge: document.querySelector('.wizard-example-badge') ? document.querySelector('.wizard-example-badge').textContent : '',
      calls
    }
    return { kernelHint: !!kernelHint, step2, example }
  })
  check(scheme + ' / 向导提示开局使用随应用分发的本地内核', wizard.kernelHint === true)
  check(scheme + ' / 向导沿用现有地址 / 模型 / 密钥（不被预设覆盖）',
    wizard.step2.baseUrl === 'https://api.example.com/v1' && wizard.step2.model === 'my-custom-model-v3' && wizard.step2.apiKey === 'sk-live-should-not-leak', wizard.step2)
  check(scheme + ' / 已有配置时给出「直接下一步」提示', wizard.step2.existingHint === true)
  check(scheme + ' / 说明预设模型名只是占位示例（不推荐厂商型号）', wizard.step2.presetHint === true)
  check(scheme + ' / 离线示例可展开且标注未联网 / 未调用模型 / 不产生费用',
    wizard.example.shown === true && /离线示例/.test(wizard.example.badge) && /未联网/.test(wizard.example.badge) && /不产生费用/.test(wizard.example.badge), wizard.example)
  check(scheme + ' / 展开离线示例不发起任何连接测试', wizard.example.calls === 0, wizard.example)
  await win.screenshot({ path: path.join(shots, scheme + '-wizard-example.png') })
  await win.evaluate(() => document.querySelector('.wizard-example-close') && document.querySelector('.wizard-example-close').click())

  /* ---- 9. 面板自身不联网 ---- */
  check(scheme + ' / 面板与向导全程零 http(s) 请求', network.length === 0, network.slice(0, 3))
  check(scheme + ' / 无渲染进程错误', errors.length === 0, errors.slice(0, 3))

  await app.close(); app = null
}

async function main() {
  for (const scheme of ['classic', 'proto', 'd']) await runScheme(scheme)
  console.log('\n== 体验工具桌面验证: ' + pass + ' 通过, ' + fail + ' 失败 ==')
  console.log('（截图：' + path.relative(root, shots) + '；本轮 profile：' + path.relative(root, runRoot) + '）')
  console.log('未验证（需父集成后另测）：experience:* 真实 IPC 端到端、面板入口挂载后的布局与主题回归')
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { if (app) await app.close() })

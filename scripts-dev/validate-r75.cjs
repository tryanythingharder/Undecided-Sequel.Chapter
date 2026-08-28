// R75：初始化配置向导重设计验证（欢迎区/圆点步骤条/迷你界面预览卡/实时预览/空状态/键盘/免责声明后置）
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron, chromium } = require(PLAYWRIGHT)

const PORT = process.argv[2] || ''
const checks = []
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra || '' })
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

// 套件模式（传端口）：连接已运行的 CDP 实例（避免 userData SingletonLock 冲突）；单跑模式：自建实例
async function connectWin() {
  if (!PORT) {
    const app = await electron.launch({
      executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
    })
    const win = await app.firstWindow()
    return { win, close: () => app.close() }
  }
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!browser) throw new Error('CDP connect failed')
  let win = null
  for (let i = 0; i < 40 && !win; i++) {
    for (const ctx of browser.contexts()) {
      const p = ctx.pages().find((x) => x.url().includes('index.html'))
      if (p) win = p
    }
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  if (!win) throw new Error('index.html page not found')
  await win.setViewportSize({ width: 1120, height: 700 })
  return { win, close: () => browser.close() }
}

async function main() {
  const { win, close } = await connectWin()
  await win.waitForTimeout(1200)
  // 清空持久化 → 重载触发「首次安装」链：向导 → 免责声明 → 教程
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)

  const q = (sel) => win.evaluate((s) => {
    const el = document.querySelector(s)
    return el ? { exists: true, text: (el.textContent || '').trim(), cls: el.className } : { exists: false }
  }, sel)

  // ---- 步骤 1：外观 ----
  const wizardVisible = await q('.confirm.wizard')
  check('向导弹窗出现', wizardVisible.exists)

  const head = await q('.wizard-head .wizard-welcome')
  check('欢迎区标题', head.exists && head.text.includes('欢迎使用六面世界'), head.text)

  const dots = await win.evaluate(() => document.querySelectorAll('.wizard-step').length)
  check('步骤条 3 个节点', dots === 3, String(dots))
  const active0 = await q('.wizard-step.active .wizard-step-label')
  check('第 1 步高亮为「外观」', active0.exists && active0.text === '外观')

  const mocks = await win.evaluate(() => document.querySelectorAll('.wizard-theme-mock').length)
  check('3 张迷你界面预览卡', mocks === 3, String(mocks))
  const selTheme = await q('.wizard-theme-opt.sel')
  check('默认选中卡片存在', selTheme.exists)
  const prog = await q('.wizard-progress')
  check('底部进度文字', prog.text === '第 1 / 3 步', prog.text)

  const shot0 = path.join(__dirname, 'shot-r75-step0.png')
  await win.screenshot({ path: shot0 })

  // 画布高度基准（R72：三步零跳变）
  const h0 = await win.evaluate(() => Math.round(document.querySelector('.confirm.wizard').getBoundingClientRect().height))

  // ---- 实时主题预览：点与当前解析主题相反的卡 → data-theme 立即切换 ----
  const before = await win.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const pick = before === 'dark' ? 'light' : 'dark'
  await win.click('.wizard-theme-opt[data-v="' + pick + '"]')
  await win.waitForTimeout(300)
  const afterPick = await win.evaluate((p) => ({
    t: document.documentElement.getAttribute('data-theme'),
    sel: !!document.querySelector('.wizard-theme-opt.sel[data-v="' + p + '"]'),
    check: getComputedStyle(document.querySelector('.wizard-theme-opt[data-v="' + p + '"] .wizard-theme-check')).transform
  }), pick)
  check('点击主题卡实时切换 data-theme', afterPick.t === pick, before + ' → ' + afterPick.t)
  check('选中态 + ✓ 角标出现', afterPick.sel && afterPick.check !== 'none' && !afterPick.check.includes('matrix(0'))

  // ---- Esc = 跳过：还原原主题并关闭 ----
  await win.keyboard.press('Escape')
  await win.waitForTimeout(500)
  const reverted = await win.evaluate(() => ({
    t: document.documentElement.getAttribute('data-theme'),
    wizard: !!document.querySelector('.confirm.wizard'),
    disclaimer: !!document.querySelector('.disclaimer-check')
  }))
  check('Esc 跳过后还原原主题', reverted.t === before, afterPick.t + ' → ' + reverted.t)
  check('跳过向导 → 免责声明紧随其后出现', !reverted.wizard && reverted.disclaimer)

  // 截图免责声明（新顺序验证）
  await win.screenshot({ path: path.join(__dirname, 'shot-r75-disclaimer.png') })
  await win.click('.disclaimer-check')
  await win.click('.confirm-foot .primary')
  await win.waitForTimeout(400)

  // ---- 重新触发向导走完整三步（不清 onboarding 标记，直接手动重建场景）----
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)

  // Enter 前进到第 2 步
  await win.keyboard.press('Enter')
  await win.waitForTimeout(400)
  const step2Title = await q('.wizard-title')
  check('Enter 前进到「配置对话模型」', step2Title.exists && step2Title.text.includes('对话模型'), step2Title.text)
  const chips1 = await win.evaluate(() => document.querySelectorAll('.wizard-preset-opt').length)
  check('7 个文本预设卡', chips1 === 7, String(chips1))
  const dot1 = await q('.wizard-preset-opt.sel .wizard-preset-dot')
  check('预设卡带首字头像', dot1.exists && dot1.text.length === 1, dot1.text)
  const anim1 = await win.evaluate(() => document.querySelector('.wizard-pane').className)
  check('切步动画类挂载', /anim-(fwd|back)/.test(anim1), anim1)
  const h1 = await win.evaluate(() => Math.round(document.querySelector('.confirm.wizard').getBoundingClientRect().height))

  await win.screenshot({ path: path.join(__dirname, 'shot-r75-step1.png') })

  // 选一个不同预设 → 表单值跟随；再前进到第 3 步
  await win.click('.wizard-preset-opt[data-p="openai"]')
  await win.waitForTimeout(250)
  const urlVal = await win.evaluate(() => document.querySelector('.wizard-baseurl').value)
  check('切换预设填充 baseUrl', urlVal === 'https://api.openai.com/v1', urlVal)
  await win.keyboard.press('Enter')
  await win.waitForTimeout(400)

  // 第 3 步：默认「暂不启用」→ 空状态卡
  const empty = await q('.wizard-empty-title')
  check('插图未启用显示空状态卡', empty.exists && empty.text.includes('暂不启用'), empty.text)
  const h2 = await win.evaluate(() => Math.round(document.querySelector('.confirm.wizard').getBoundingClientRect().height))
  await win.screenshot({ path: path.join(__dirname, 'shot-r75-step2-off.png') })

  // 选启用预设 → 字段出现，空状态消失
  await win.click('.wizard-preset-opt[data-ip="zhipu"]')
  await win.waitForTimeout(250)
  const fieldsOn = await win.evaluate(() => ({
    empty: !!document.querySelector('.wizard-empty'),
    baseurl: !!document.querySelector('.wizard-imgbaseurl'),
    model: !!document.querySelector('.wizard-imgmodel')
  }))
  check('启用预设后字段出现、空状态消失', !fieldsOn.empty && fieldsOn.baseurl && fieldsOn.model)

  // 上一步返回方向动画 + 画布高度稳定
  const prog3 = await q('.wizard-progress')
  check('第 3 步进度文字', prog3.text === '第 3 / 3 步', prog3.text)
  const nextBtn = await win.evaluate(() => document.querySelector('.wizard-foot .primary').textContent)
  check('末步主按钮文案「完成」', nextBtn.trim() === '完成', nextBtn.trim())
  check('画布高度三步零跳变(R72)', Math.abs(h0 - h1) <= 2 && Math.abs(h1 - h2) <= 2, [h0, h1, h2].join('/'))
  await win.screenshot({ path: path.join(__dirname, 'shot-r75-step2-on.png') })

  // 完成落库：回到第 2 步填 Key 再走到完成（模拟最小配置）
  await win.click('.wizard-foot .cancel') // 上一步
  await win.waitForTimeout(300)
  await win.fill('.wizard-apikey', 'sk-test-123')
  await win.click('.wizard-foot .primary') // 下一步
  await win.waitForTimeout(300)
  await win.click('.wizard-foot .primary') // 完成（插图 off）
  await win.waitForTimeout(600)
  const saved = await win.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    return { keys: Object.keys(localStorage), preset: cfg.preset, key: cfg.apiKey }
  })
  check('完成落库 preset/apiKey', saved.preset === 'openai' && saved.key === 'sk-test-123', JSON.stringify(saved.keys))
  const postDone = await win.evaluate(() => ({ wizard: !!document.querySelector('.confirm.wizard'), disc: !!document.querySelector('.disclaimer-check') }))
  check('完成向导 → 免责声明出现（顺序：向导在前）', !postDone.wizard && postDone.disc)

  const failed = checks.filter((c) => !c.ok)
  console.log('\n==== R75 汇总: ' + (checks.length - failed.length) + '/' + checks.length + ' passed ====')
  if (failed.length) { failed.forEach((c) => console.log('FAILED: ' + c.name)); process.exitCode = 1 }
  await close()
  console.log(failed.length ? 'RESULT FAIL ' + failed.join(',') : 'RESULT ALL PASS')
  process.exit(failed.length ? 1 : 0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

// 验证 R26：真实首跑流程——R75 起顺序调整为：初始化向导 → 免责声明(未勾选不可继续→勾选→同意) → 教程自动打开 → 关闭 → 空状态
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })
const fails = []
const check = (n, c, e) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (e ? '  ' + e : '')); if (!c) fails.push(n) }

async function main() {
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
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.evaluate(() => localStorage.clear()) // 完全首跑，不预置 onboard 标记
  await win.reload(); await win.waitForTimeout(1800)

  // 1. R75：初始化向导首先出现（免责声明后置到向导之后）
  const okBtn = win.locator('.confirm .primary')
  check('wizard-appears', (await win.locator('.wizard-body').count()) === 1)
  await win.screenshot({ path: path.join(OUT, 'r26-01-wizard-theme.png') })
  check('wizard-theme-step', (await win.locator('.wizard-theme-opt').count()) === 3)
  await win.locator('.wizard-theme-opt[data-v="light"]').click()
  await win.waitForTimeout(200)
  // 下一步 → 文本模型步（预设卡片 + 地址/密钥/模型 + 拉取按钮）
  await win.locator('.confirm.wizard .confirm-foot .primary').click()
  await win.waitForTimeout(400)
  check('wizard-model-step', (await win.locator('.wizard-preset-opt[data-p]').count()) >= 6)
  check('wizard-fetch-btn', (await win.locator('.wizard-fetch-btn').count()) === 1)
  await win.locator('.wizard-baseurl').fill('http://127.0.0.1:4599')
  await win.locator('.wizard-apikey').fill('sk-mock')
  // R73：拉取模型列表 → 模型名变为下拉（mock 返回 7 个模型）
  await win.locator('.wizard-fetch-btn').click()
  await win.waitForTimeout(1500)
  const fetched = await win.evaluate(() => ({
    isSelect: !!document.querySelector('select.wizard-model'),
    status: (document.querySelector('[data-status="text"]') || {}).textContent || '',
  }))
  check('wizard-model-list-fetched', fetched.isSelect && /已获取/.test(fetched.status), JSON.stringify(fetched))
  // 下拉选择 mock-chat
  await win.locator('select.wizard-model').selectOption('mock-chat')
  await win.waitForTimeout(200)
  // 下一步 → 插图模型步（默认暂不启用）→ 完成
  await win.locator('.confirm.wizard .confirm-foot .primary').click()
  await win.waitForTimeout(400)
  check('wizard-illust-step', (await win.locator('.wizard-preset-opt[data-ip]').count()) >= 5)
  await win.locator('.confirm.wizard .confirm-foot .primary').click()
  await win.waitForTimeout(1800)
  // 向导落库：主题浅色 + 文本模型就绪
  const wiz = await win.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    cfg: JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}'),
  }))
  check('wizard-theme-applied', wiz.theme === 'light', 'theme=' + wiz.theme)
  check('wizard-model-saved', wiz.cfg.baseUrl === 'http://127.0.0.1:4599' && wiz.cfg.model === 'mock-chat', JSON.stringify({ b: wiz.cfg.baseUrl, m: wiz.cfg.model }))

  // 2. R75：向导完成后免责声明出现，同意按钮初始禁用
  check('disclaimer-shown-after-wizard', (await win.locator('.disclaimer-body').count()) === 1)
  const disabled0 = await okBtn.evaluate((el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || getComputedStyle(el).pointerEvents === 'none' || el.classList.contains('disabled'))
  check('agree-gated', disabled0 === true)
  await win.screenshot({ path: path.join(OUT, 'r26-02-disclaimer.png') })

  // 2b. 勾选 → 按钮启用 → 同意
  await win.locator('.disclaimer-check input[type="checkbox"]').check()
  await win.waitForTimeout(300)
  const disabled1 = await okBtn.evaluate((el) => el.disabled || el.classList.contains('disabled'))
  check('agree-enabled-after-check', disabled1 === false)
  await okBtn.click(); await win.waitForTimeout(1200)

  // 3. 向导完成后教程自动打开 → Esc 关闭 → 空状态出现
  check('guide-auto-opens', await win.locator('#guide').isVisible())
  await win.screenshot({ path: path.join(OUT, 'r26-03-guide.png') })
  await win.keyboard.press('Escape'); await win.waitForTimeout(500)
  check('guide-closes', !(await win.locator('#guide').isVisible()))
  check('empty-state-after-onboard', (await win.locator('.empty').count()) === 1)
  check('onboard-flag-set', (await win.evaluate(() => localStorage.getItem('sixworlds.onboard.v1'))) === '1')

  // 4. 重载 → 免责声明与向导均不再出现
  await win.reload(); await win.waitForTimeout(1500)
  check('no-disclaimer-on-second-run', (await win.locator('.disclaimer-body').count()) === 0)
  check('no-wizard-on-second-run', (await win.locator('.wizard-body').count()) === 0)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

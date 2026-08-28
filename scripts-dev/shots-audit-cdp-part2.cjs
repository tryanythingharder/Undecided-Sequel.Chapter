// 续跑：shots-audit-cdp.cjs 在第 11 张超时后，从 11-narrative-choices 继续（应用状态已保留）
// 用法: node shots-audit-cdp-part2.cjs <cdpPort>
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)

const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })
const PORT = process.argv[2] || '9333'

async function mainWindow(browser) {
  for (let i = 0; i < 40; i++) {
    for (const ctx of browser.contexts()) {
      const p = ctx.pages().find((x) => x.url().includes('index.html'))
      if (p) return p
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('main window not found')
}

async function shot(page, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.screenshot({ path: path.join(OUT, name + '.png'), timeout: 20000 })
      console.log('SHOT', name)
      return
    } catch (e) {
      console.log('RETRY', name, e.message.split('\n')[0])
      await page.waitForTimeout(1200)
    }
  }
  console.log('SKIP', name)
}

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT)
  const win = await mainWindow(browser)
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForTimeout(800)

  // 11. 叙事 + 选项（状态应已就位）
  await win.waitForSelector('.choice', { timeout: 15000 })
  await win.waitForTimeout(500)
  await shot(win, '11-narrative-choices')

  // 消息悬停工具条
  await win.locator('.msg.assistant').last().hover()
  await win.waitForTimeout(300)
  await shot(win, '12-msg-tools')
  await win.mouse.move(10, 400)
  await win.waitForTimeout(200)

  // 多选组合
  const multiToggle = win.locator('#multi-toggle')
  if (await multiToggle.count()) {
    await multiToggle.click()
    await win.locator('.choice').nth(0).click()
    await win.locator('.choice').nth(1).click()
    await win.waitForTimeout(350)
    await shot(win, '13-multi-select')
    await multiToggle.click(); await win.waitForTimeout(250)
  }

  // 点选项 → 第二回合
  await win.locator('.choice').first().click()
  await win.waitForTimeout(15000)
  const msgCount = await win.locator('.msg.assistant').count()
  if (msgCount >= 2) { await win.waitForTimeout(500); await shot(win, '14-second-turn') }

  // 用量面板
  await win.click('#chip-text-model'); await win.waitForTimeout(400)
  await shot(win, '15-usage-panel')
  await win.click('.chat-title'); await win.waitForTimeout(300)

  // 主题弹层
  await win.click('#btn-theme'); await win.waitForTimeout(400)
  await shot(win, '16-theme-pop')
  await win.click('.chat-title'); await win.waitForTimeout(300)

  // 工作区菜单
  await win.click('#btn-ws'); await win.waitForTimeout(350)
  await shot(win, '17-workspace-menu')
  await win.keyboard.press('Escape'); await win.waitForTimeout(250)

  // 会话内搜索
  await win.keyboard.press('Control+f'); await win.waitForTimeout(300)
  await win.fill('#search-input', '石片'); await win.waitForTimeout(450)
  await shot(win, '18-search-in-session')
  await win.keyboard.press('Escape'); await win.waitForTimeout(250)

  // 侧栏全局搜索
  await win.fill('#sb-search', '石片'); await win.waitForTimeout(450)
  await shot(win, '19-global-search')
  await win.fill('#sb-search', ''); await win.waitForTimeout(300)

  // 侧栏收起 → 进度条
  await win.keyboard.press('Control+b'); await win.waitForTimeout(600)
  const railNode = win.locator('.rail-node').first()
  if (await railNode.count()) { await railNode.hover(); await win.waitForTimeout(450) }
  await shot(win, '20-collapsed-progress-rail')
  await win.keyboard.press('Control+b'); await win.waitForTimeout(450)

  // 画廊
  await win.click('#btn-gallery'); await win.waitForTimeout(450)
  await shot(win, '21-gallery')
  await win.click('#btn-gallery-close'); await win.waitForTimeout(350)

  // 错误恢复
  await win.fill('#input', '触发错误')
  await win.click('#btn-send')
  await win.waitForTimeout(1500)
  await shot(win, '22-error-state')

  // 浅色主题
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await win.waitForTimeout(350)
  await shot(win, '23-light-theme')
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await win.waitForTimeout(250)

  // 窄窗口 / 笔记本
  await win.setViewportSize({ width: 700, height: 800 }); await win.waitForTimeout(650)
  await shot(win, '24-narrow-700')
  await win.setViewportSize({ width: 1280, height: 800 }); await win.waitForTimeout(550)
  await shot(win, '25-laptop-1280')

  // 快捷键面板
  await win.keyboard.press('Control+/'); await win.waitForTimeout(450)
  await shot(win, '26-shortcuts')
  await win.keyboard.press('Escape'); await win.waitForTimeout(300)

  // 指南
  await win.click('#btn-help'); await win.waitForTimeout(450)
  await shot(win, '27-guide-modal')
  await win.keyboard.press('Escape'); await win.waitForTimeout(300)

  await shot(win, '28-final-state')
  await browser.close()
  console.log('PART2_DONE')
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

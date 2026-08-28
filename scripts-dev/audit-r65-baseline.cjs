// R65 视觉重构前基线补拍:设置窗 / 画廊 / 主题弹层 / 浅色整体 (只截图,不改 UI)
// 用法: node audit-r65-baseline.cjs [cdp-port]
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const fs = require('fs')
const OUT = 'D:\\代码\\测试\\无职转生\\test-shots\\audit'

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

  // 种子:已有会话与配置(mock),跳过 onboarding
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', ws: 'w1', title: '布耶纳村的少年', createdAt: Date.now() - 86400000, updatedAt: Date.now(), messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n晨光透过窗帘的缝隙洒进来。\n\n【A】起床出门\n【B】继续睡' },
      ] },
    ]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: Date.now() }]))
  })
  await win.reload()
  await win.waitForTimeout(1200)

  // 1) 主题弹层(色板网格)
  await win.locator('#btn-theme').click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: OUT + '\\r65-01-theme-pop.png' })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  // 2) 画廊(空态)
  await win.locator('#btn-gallery').click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: OUT + '\\r65-02-gallery-empty.png' })
  await win.locator('#btn-gallery-close').click()
  await win.waitForTimeout(400)

  // 3) 设置窗口(通过 IPC 打开的独立窗口)
  await win.evaluate(() => { try { window.api.openSettings() } catch {} })
  await win.waitForTimeout(1200)
  let setWin = null
  for (let i = 0; i < 20 && !setWin; i++) {
    for (const ctx of browser.contexts()) {
      const p = ctx.pages().find((x) => x.url().includes('settings.html'))
      if (p) setWin = p
    }
    if (!setWin) await new Promise((r) => setTimeout(r, 250))
  }
  if (setWin) {
    await setWin.setViewportSize({ width: 560, height: 720 })
    await setWin.screenshot({ path: OUT + '\\r65-03-settings-text.png' })
    await setWin.locator('.tab[data-tab="image"]').click()
    await setWin.waitForTimeout(300)
    await setWin.screenshot({ path: OUT + '\\r65-04-settings-image.png' })
    await setWin.locator('.tab[data-tab="appearance"]').click()
    await setWin.waitForTimeout(300)
    await setWin.screenshot({ path: OUT + '\\r65-05-settings-appearance.png' })
    await setWin.locator('.tab[data-tab="advanced"]').click()
    await setWin.waitForTimeout(300)
    await setWin.screenshot({ path: OUT + '\\r65-06-settings-advanced.png' })
    // 4) 确认对话框(danger 样式)
    await setWin.locator('#btn-clear-sessions').click()
    await setWin.waitForTimeout(400)
    await setWin.screenshot({ path: OUT + '\\r65-07-confirm-danger.png' })
    await setWin.keyboard.press('Escape')
    await setWin.waitForTimeout(200)
    // 关闭设置窗
    await setWin.locator('#btn-win-close').click()
    await setWin.waitForTimeout(400)
  } else {
    console.log('WARN settings window not found')
  }

  // 5) 浅色模式整体基线(切换 light)
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
  await win.waitForTimeout(400)
  await win.screenshot({ path: OUT + '\\r65-08-light-full.png' })
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })

  console.log('RESULT DONE')
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

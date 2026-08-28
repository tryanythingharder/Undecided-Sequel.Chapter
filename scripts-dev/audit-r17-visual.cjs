// R17：深色主题整合态 + 窄窗 composer 拥挤度 视觉抽查（截图人工复核）
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })

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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'https://x', apiKey: 'k', model: 'm', theme: 'dark' }))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'v17', title: '深色验证线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n你醒了。\n\n【你需要决定】\n\n【A】出门探索【B】再睡一会' },
      ],
    }]))
  })
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.reload(); await win.waitForTimeout(1800)
  await win.screenshot({ path: path.join(OUT, 'r17-dark-choices.png') })
  console.log('SHOT r17-dark-choices')

  // 窄窗 composer 拥挤度：foot 元素是否换行/溢出
  await win.setViewportSize({ width: 500, height: 800 })
  await win.waitForTimeout(800)
  const m = await win.evaluate(() => {
    const foot = document.querySelector('.composer-foot')
    const box = document.querySelector('.composer-box')
    const over = foot.scrollWidth > box.clientWidth + 1
    return { footScrollW: foot.scrollWidth, boxW: box.clientWidth, overflow: over, footH: Math.round(foot.getBoundingClientRect().height) }
  })
  console.log((m.overflow ? 'FAIL' : 'PASS') + ' narrow-composer  ' + JSON.stringify(m))
  const box = await win.locator('.composer-box').boundingBox()
  await win.screenshot({ path: path.join(OUT, 'r17-narrow-composer.png'), clip: { x: 0, y: Math.max(0, box.y - 130), width: 500, height: Math.min(800 - box.y + 130, box.height + 140) } })
  console.log('SHOT r17-narrow-composer')
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

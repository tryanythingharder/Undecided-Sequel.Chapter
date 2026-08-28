// R33d 视觉复审：文本提级清扫后的关键状态截图（空态提示/选项+IF提示/深色选项）
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
  await win.setViewportSize({ width: 1440, height: 900 })

  // 1. 浅色空态（未配置 → 琥珀提示）
  await win.evaluate(() => { localStorage.clear(); localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1800)
  await win.screenshot({ path: path.join(OUT, 'r33-01-light-empty-cfgtip.png') })
  console.log('SHOT r33-01')

  // 2. 浅色选项 + IF 提示（首次）
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'v33', title: '视觉复审线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。\n\n【你需要决定】\n\n【A】接过石片【B】询问报酬\n【C】婉拒关门' },
      ],
    }]))
  })
  await win.reload(); await win.waitForTimeout(1800)
  await win.screenshot({ path: path.join(OUT, 'r33-02-light-choices-ifhint.png') })
  console.log('SHOT r33-02')

  // 3. 深色同一状态
  await win.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(OUT, 'r33-03-dark-choices.png') })
  console.log('SHOT r33-03')
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

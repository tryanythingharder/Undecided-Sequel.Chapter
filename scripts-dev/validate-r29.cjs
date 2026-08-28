// 验证 R30：用量反馈——回合后模型芯片显示模型、点击展开用量面板（输入/输出/合计 token）
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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // 打一局（mock 流带 usage：prompt 1240 / completion 186 / total 1426）
  await win.locator('.empty button.primary').click()
  await win.locator('.choice').first().waitFor({ timeout: 15000 })

  const chip = ((await win.locator('#chip-text-model').textContent()) || '').trim()
  check('chip-shows-model', chip.includes('mock-chat'), chip)

  await win.locator('#chip-text-model').click(); await win.waitForTimeout(600)
  check('usage-pop-opens', await win.locator('#model-pop').isVisible())
  const pop = (await win.locator('#model-pop').textContent()) || ''
  check('usage-has-tokens', /\d{3,}/.test(pop) && pop.includes('输入') && pop.includes('输出') && pop.includes('tok'), pop.slice(0, 60).replace(/\s+/g, ' ')) // 与调用次序无关：mock 用量=基数×chatCalls
  await win.screenshot({ path: path.join(OUT, 'r29-01-usage-pop.png') })

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R7：IF 一次性发现提示（出现 → 关闭置标记 → 重载不再现）
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })
const fails = []
const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

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
    localStorage.setItem('sixworlds.onboard.v1', '1') // 跳过免责声明/教程（否则遮罩拦截点击）
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'v7', title: 'IF提示验证线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n你醒了。\n\n【你需要决定】\n\n【A】出门探索【B】再睡一会' },
      ],
    }]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const hint = win.locator('.if-hint')
  check('if-hint-shown', (await hint.count()) === 1)
  const txt = (await hint.textContent()) || ''
  check('if-hint-text', txt.includes('IF 分歧'), txt.slice(0, 40))
  await win.screenshot({ path: path.join(OUT, 'r7-01-if-hint.png') })

  await win.locator('.if-hint-x').click(); await win.waitForTimeout(300)
  check('if-hint-dismissed', (await win.locator('.if-hint').count()) === 0)
  check('if-hint-flag', (await win.evaluate(() => localStorage.getItem('sixworlds.ifhint-seen.v1'))) === '1')

  await win.reload(); await win.waitForTimeout(1500)
  check('if-hint-gone-after-reload', (await win.locator('.if-hint').count()) === 0)
  check('choices-still-there', (await win.locator('.choice').count()) >= 2)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

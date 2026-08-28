// 验证 R19：错误态渲染——.err 样式、去前缀友好文本、末条重试按钮
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
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'v19', title: '错误态验证线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '第一幕。\n\n【A】走【B】停' },
        { role: 'user', content: '【A】走' },
        { role: 'assistant', content: '⚠️ [[世界引擎报错]]\n网络连接超时，请检查网络后重试' },
      ],
    }]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const err = win.locator('.msg-body.err')
  check('err-rendered', (await err.count()) === 1)
  const t = ((await err.textContent()) || '').trim()
  check('err-text-friendly', t.includes('网络连接超时') && !t.includes('⚠️') && !t.includes('世界引擎报错'), t.slice(0, 24))
  const retry = win.locator('.retry-btn')
  check('retry-btn-exists', (await retry.count()) === 1)
  check('retry-label', ((await retry.textContent()) || '').includes('重试这一回合'))
  await win.screenshot({ path: path.join(OUT, 'r19-01-error-state.png') })

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

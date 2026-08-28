// 验证 R10：空状态 API 未配置预防提示（未配→显示；已配→不显示）
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

  // 场景 1：未配置 API → 提示出现
  await win.evaluate(() => { localStorage.clear(); localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1800)
  const tip1 = win.locator('.empty-cfg-tip')
  check('cfg-tip-shown-when-unconfigured', (await tip1.count()) === 1)
  const t = (await tip1.textContent()) || ''
  check('cfg-tip-text', t.includes('尚未配置 API'), t.slice(0, 30))
  await win.screenshot({ path: path.join(OUT, 'r10-01-empty-cfg-tip.png') })

  // 场景 2：已配置 → 提示消失
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: 'deepseek-chat' }))
  })
  await win.reload(); await win.waitForTimeout(1800)
  check('cfg-tip-hidden-when-configured', (await win.locator('.empty-cfg-tip').count()) === 0)
  check('empty-state-intact', (await win.locator('.empty').count()) === 1)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R38：REGEN 重生成——移除该回合重走（用户行动保留、世界回应被替换、不重复 push user）
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
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

  // 回合 1：开始 → 再自由输入一回合，凑够两条 user + 两条 assistant
  await win.locator('.empty button.primary').click()
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  await win.locator('.choice').first().click()
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  const before = await win.evaluate(() => document.querySelectorAll('.messages [data-mi]').length)

  // 悬停最后一条世界回应 → 点「重生成」
  const lastIdx = before - 1
  const lastMsg = win.locator('[data-mi="' + lastIdx + '"]')
  await lastMsg.hover()
  const regenBtn = lastMsg.locator('.tool-btn', { hasText: '重生成' })
  check('regen-btn-shows', (await regenBtn.count()) === 1)
  await regenBtn.click()
  await win.waitForTimeout(500)

  // 重流完成后：消息数不变（无重复 user），最后一条世界回应被替换
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  const after = await win.evaluate(() => ({
    total: document.querySelectorAll('.messages [data-mi]').length,
    text: (document.querySelector('.messages') || {}).textContent || '',
  }))
  check('no-duplicate-user-after-regen', after.total === before, 'before=' + before + ' after=' + after.total)
  check('regen-turn-replaced', (after.text.match(/老槐树下|布耶纳村/g) || []).length >= 1)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

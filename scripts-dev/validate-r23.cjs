// 验证 R23：全局搜索过滤 + 会话内搜索（高亮/计数/跳转）
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
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', title: '石片线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '你接过神秘石片，纹路泛着蓝光。' }] },
      { id: 's2', title: '钟声线', createdAt: Date.now(), updatedAt: Date.now() - 999, messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '远处传来教堂的钟声，惊起白鸽。' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // A. 全局搜索：输入「石片」→ 列表过滤
  await win.locator('#sb-search').fill('石片')
  await win.waitForTimeout(500)
  const vis = await win.evaluate(() => {
    const items = [...document.querySelectorAll('#session-list .session-item')]
    return items.filter((el) => el.offsetParent !== null).map((el) => el.textContent)
  })
  check('global-filters-list', vis.length === 1 && vis[0].includes('石片线'), JSON.stringify(vis).slice(0, 40))
  await win.screenshot({ path: path.join(OUT, 'r23-01-global-search.png') })
  await win.locator('#sb-search').fill('')
  await win.waitForTimeout(400)

  // B. 会话内搜索：Ctrl+F → 输入「蓝光」→ 计数/高亮
  await win.locator('#session-list .session-item').first().click(); await win.waitForTimeout(600)
  await win.keyboard.press('Control+f'); await win.waitForTimeout(400)
  check('search-bar-opens', await win.locator('#search-bar').isVisible())
  await win.locator('#search-input').fill('蓝光')
  await win.waitForTimeout(500)
  const cnt = ((await win.locator('#search-count').textContent()) || '').trim()
  check('search-count-hit', cnt !== '0/0' && cnt.includes('/'), cnt)
  const marks = await win.locator('.msg-body mark').count()
  check('search-highlights', marks >= 1, 'marks=' + marks)
  await win.screenshot({ path: path.join(OUT, 'r23-02-in-session-search.png') })
  await win.keyboard.press('Escape'); await win.waitForTimeout(300)
  check('esc-clears', (await win.locator('.msg-body mark').count()) === 0)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

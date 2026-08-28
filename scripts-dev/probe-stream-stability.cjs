// 探针：流式期间消息节点是否被整树重建（决定 busy 中按钮能否被点中）
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'

async function main() {
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
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
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'g1', title: '探针线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '第一幕。' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)
  await win.locator('#input').fill('继续')
  await win.locator('#input').press('Enter')
  await win.evaluate(() => {
    const el = document.querySelector('[data-mi="0"]')
    if (el) el.dataset.mark = '1'
  })
  for (let i = 1; i <= 8; i++) {
    await win.waitForTimeout(250)
    const m = await win.evaluate(() => ({
      mark: (document.querySelector('[data-mi="0"]') || { dataset: {} }).dataset.mark || 'GONE',
      send: (document.querySelector('#btn-send') || {}).textContent || '',
    }))
    console.log('t+' + i * 250 + 'ms  mark=' + m.mark + '  send=' + m.send)
  }
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

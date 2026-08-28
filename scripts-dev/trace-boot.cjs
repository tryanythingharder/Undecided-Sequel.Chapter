// R69:boot 后页面内性能条目(DCL/FCP/资源耗时),定位渲染阶段开销
const PLAYWRIGHT = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9345'
async function main() {
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!browser) { console.log('SKIP'); process.exit(0) }
  let win = null
  for (let i = 0; i < 40 && !win; i++) {
    for (const ctx of browser.contexts()) { const p = ctx.pages().find((x) => x.url().includes('index.html')); if (p) win = p }
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  // 注入 300 条消息种子
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    const msgs = []
    for (let i = 0; i < 150; i++) {
      msgs.push({ role: 'user', content: '行动 ' + i })
      msgs.push({ role: 'assistant', content: '【甲龙历 407】场景描述。'.repeat(20) + '\n\n【A】走\n【B】停' })
    }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{ id: 's1', ws: 'w1', title: '长线', createdAt: Date.now(), updatedAt: Date.now(), messages: msgs }]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: Date.now() }]))
  })
  await win.reload()
  await win.waitForTimeout(3000)
  const stats = await win.evaluate(() => {
    const paints = performance.getEntriesByType('paint')
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const res = performance.getEntriesByType('resource').reduce((a, r) => { a[r.name.split('/').pop()] = Math.round(r.duration); return a }, {})
    // 首条消息到末条消息的布局总耗时不可直接取,用 .msg 数量
    return {
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEnd: Math.round(nav.loadEventEnd || 0),
      paints: paints.map((p) => p.name + ':' + Math.round(p.startTime)),
      res,
      msgCount: document.querySelectorAll('.msg').length,
    }
  })
  console.log(JSON.stringify(stats))
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

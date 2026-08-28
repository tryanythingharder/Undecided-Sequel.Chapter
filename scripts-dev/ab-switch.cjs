// R69 A/B:会话切换 + 打字延迟(当前样式)
const PLAYWRIGHT = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9346'
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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    const msgs = []
    for (let i = 0; i < 150; i++) {
      msgs.push({ role: 'user', content: '行动 ' + i })
      msgs.push({ role: 'assistant', content: '【甲龙历 407】场景描述。'.repeat(20) + '\n\n【A】走\n【B】停' })
    }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', ws: 'w1', title: '长线', createdAt: Date.now(), updatedAt: Date.now(), messages: msgs },
      { id: 's2', ws: 'w1', title: '短线', createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000, messages: [{ role: 'user', content: '开始' }] },
    ]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: Date.now() }]))
  })
  await win.reload()
  await win.waitForTimeout(2000)
  // 打字延迟:每次 input → 双 rAF
  const type = await win.evaluate(() => {
    const ta = document.getElementById('input')
    ta.focus()
    return new Promise((resolve) => {
      const lat = []
      let i = 0
      function once() {
        if (i >= 10) return resolve({ avg: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), max: Math.max(...lat) })
        const t0 = performance.now()
        ta.value += '测试'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        requestAnimationFrame(() => requestAnimationFrame(() => { lat.push(Math.round(performance.now() - t0)); i++; once() }))
      }
      once()
    })
  })
  // 切换 ×3 取均值
  const switches = []
  for (let k = 0; k < 3; k++) {
    const ms = await win.evaluate(() => new Promise((resolve) => {
      const items = document.querySelectorAll('#session-list .session-item')
      let a = null, b = null
      items.forEach((it) => { if (it.textContent.includes('长线')) a = it; if (it.textContent.includes('短线')) b = it })
      const t0 = performance.now()
      ;(window.__k = (window.__k || 0) + 1) % 2 === 0 ? a.click() : b.click()
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))))
    }))
    switches.push(ms)
    await win.waitForTimeout(200)
  }
  console.log(JSON.stringify({ type, switches }))
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

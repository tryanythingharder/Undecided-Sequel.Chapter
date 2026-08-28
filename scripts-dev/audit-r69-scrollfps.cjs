// R69:滚动帧率精确测量(300 条消息,匀速滚动全程)
const PLAYWRIGHT = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9342'
async function main() {
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!browser) { console.log('SKIP no CDP'); process.exit(0) }
  let win = null
  for (let i = 0; i < 40 && !win; i++) {
    for (const ctx of browser.contexts()) { const p = ctx.pages().find((x) => x.url().includes('index.html')); if (p) win = p }
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  // 种子:300 条消息(含插图标记密度对齐 R53)
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    const msgs = []
    for (let i = 0; i < 150; i++) {
      msgs.push({ role: 'user', content: '行动 ' + i })
      msgs.push({ role: 'assistant', content: '【甲龙历 407.03.' + String((i % 28) + 1).padStart(2, '0') + '】\n' + '你继续前行，穿过麦田与溪流，远处的风车缓缓转动。'.repeat(12) + '\n\n【A】继续前进\n【B】原地休整\n【C】观察四周' })
    }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{ id: 's1', ws: 'w1', title: '长线', createdAt: Date.now(), updatedAt: Date.now(), messages: msgs }]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: Date.now() }]))
  })
  await win.reload()
  await win.waitForTimeout(2500)

  // 滚动帧率:每帧滚 40px(模拟真实滚轮节奏),从顶到底统计 rAF 间隔分布
  const r = await win.evaluate(() => {
    const el = document.getElementById('messages')
    el.scrollTop = 0
    return new Promise((resolve) => {
      const intervals = []
      let last = performance.now()
      let done = false
      function frame() {
        if (done) return
        const now = performance.now()
        intervals.push(Math.round(now - last))
        last = now
        el.scrollTop += 40
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2 || intervals.length > 900) done = true
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      setTimeout(() => {
        done = true
        const jit = intervals.filter((x) => x > 34) // 丢帧(>2帧间隔)
        const avg = intervals.length ? (intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0
        resolve({ frames: intervals.length, avgMs: +avg.toFixed(1), fps: +(1000 / avg).toFixed(1), jankFrames: jit.length, jankMax: jit.length ? Math.max(...jit) : 0, scrollH: el.scrollHeight })
      }, 8000)
    })
  })
  console.log(JSON.stringify(r))
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// R69 性能诊断:长会话(300 条消息)下的交互延迟/滚动帧率/切换耗时,对照 R61 基线
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

  // 种子:300 条消息长会话(对齐 R61 audit-r53 的密度)
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    const now = Date.now()
    const msgs = []
    for (let i = 0; i < 150; i++) {
      msgs.push({ role: 'user', content: '行动 ' + i + '：向前探索一段' })
      msgs.push({ role: 'assistant', content: '【甲龙历 407.03.' + String((i % 28) + 1).padStart(2, '0') + '】\n你继续前行。' + '场景描述文字。'.repeat(30) + '\n\n【A】继续前进\n【B】原地休整\n【C】观察四周' })
    }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', ws: 'w1', title: '长会话测试', createdAt: now - 86400000, updatedAt: now, messages: msgs },
      { id: 's2', ws: 'w1', title: '第二条线', createdAt: now, updatedAt: now, messages: [ { role: 'user', content: '开始' } ] },
    ]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: now }]))
  })

  const t0 = Date.now()
  await win.reload()
  await win.waitForTimeout(1500)
  const bootMs = Date.now() - t0

  // 1) 滚动帧率:通过 rAF 采样
  const fps = await win.evaluate(async () => {
    return await new Promise((resolve) => {
      const el = document.getElementById('messages')
      el.scrollTop = 0
      let frames = 0
      const start = performance.now()
      function step() {
        el.scrollTop += 60
        frames++
        if (el.scrollTop < el.scrollHeight - el.clientHeight && performance.now() - start < 2000) requestAnimationFrame(step)
        else resolve({ frames, ms: Math.round(performance.now() - start), h: el.scrollHeight })
      }
      requestAnimationFrame(step)
    })
  })

  // 2) 打字延迟:连续 input 事件到下一帧的间隔
  const typeLatency = await win.evaluate(async () => {
    const ta = document.getElementById('input')
    ta.focus()
    const delays = []
    let lastT = 0
    let pending = false
    return await new Promise((resolve) => {
      for (let i = 0; i < 20; i++) {
        setTimeout(() => {
          lastT = performance.now()
          ta.value += '测试输入内容'
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          if (!pending) {
            pending = true
            requestAnimationFrame(() => { delays.push(Math.round(performance.now() - lastT)); pending = false })
          }
        }, i * 50)
      }
      setTimeout(() => resolve({ avg: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : -1, samples: delays.length }), 1200)
    })
  })

  // 3) 会话切换耗时(点击另一条线再切回)
  const switchMs = await win.evaluate(async () => {
    const items = document.querySelectorAll('.session-item')
    if (items.length < 2) return -1
    const t1 = performance.now()
    items[1].click()
    await new Promise((r) => setTimeout(r, 300))
    items[0].click()
    await new Promise((r) => setTimeout(r, 300))
    return Math.round(performance.now() - t1)
  })

  // 4) hover 延迟:choice hover 的 transform 触发合成层检查
  const stylePerf = await win.evaluate(() => {
    const styles = document.styleSheets.length
    const rules = Array.from(document.styleSheets).reduce((n, s) => { try { return n + s.cssRules.length } catch { return n } }, 0)
    return { stylesheets: styles, rules }
  })

  // 5) 主线程长任务检测(5s 采样)
  const longTasks = await win.evaluate(async () => {
    return await new Promise((resolve) => {
      const tasks = []
      const obs = new PerformanceObserver((list) => { list.getEntries().forEach((e) => tasks.push(Math.round(e.duration))) })
      obs.observe({ entryTypes: ['longtask'] })
      // 模拟滚动制造负载
      const el = document.getElementById('messages')
      let i = 0
      const iv = setInterval(() => { el.scrollTop += 200; if (++i > 20) clearInterval(iv) }, 80)
      setTimeout(() => { obs.disconnect(); resolve({ count: tasks.length, max: tasks.length ? Math.max(...tasks) : 0 }) }, 2500)
    })
  })

  console.log(JSON.stringify({
    bootMs,
    scroll: fps,
    typeAvgMs: typeLatency.avg,
    switchMs,
    cssRules: stylePerf.rules,
    longTasks,
  }))
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

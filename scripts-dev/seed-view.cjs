// R68 查看效果:CDP 连接应用,注入丰富种子会话(消息/选项/IF/多工作区/插图模型),reload 后留给用户
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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat', illustModel: 'mock-image' }))
    const now = Date.now()
    const msgs = [
      { role: 'user', content: '开始' },
      { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n晨光透过窗帘的缝隙洒进来，远处传来牲口的叫声——这是布耶纳村又一个寻常的清早。\n\n【A】起床出门，看看村里的情况\n【B】继续睡，赖一会床\n【C】先翻一翻枕边的旧地图' },
      { role: 'user', content: '【A】起床出门，看看村里的情况' },
      { role: 'assistant', content: '你推开门，晨风迎面扑来。村口的老橡树下，几个孩子正围着一只受伤的鸟雀。\n\n【A】上前帮忙救治\n【B】去中央广场找村长\n【C】朝森林方向走去，不理会' },
    ]
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', ws: 'w1', title: '布耶纳村的少年', createdAt: now - 86400000, updatedAt: now, messages: msgs },
      { id: 's2', ws: 'w2', title: '王都的异乡人', createdAt: now - 172800000, updatedAt: now - 86400000, messages: [ { role: 'user', content: '开始' } ] },
    ]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([
      { id: 'w1', name: '默认世界', createdAt: now },
      { id: 'w2', name: '异世界线', createdAt: now },
    ]))
  })
  await win.reload()
  await win.waitForTimeout(1200)
  console.log('SEEDED - window left open for viewing')
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R30：结构化叙事渲染——场景行/决定块/状态卡/弱化选项行 四类结构件齐备
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
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'v30', title: '结构渲染线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '我走进酒馆' },
        // 历史轮：选项行弱化显示（无按钮，正文保留 option-line）
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。\n\n一位灰袍旅人向你问路。\n\n【你需要决定】如何回应这位旅人。\n\n【A】为他指路并闲聊（获得情报）\n【B】闭门不开\n\n【简要状态】\n身份：村民 · 地点：布耶纳村\n魔力：尚可 · 目标：活下去' },
        { role: 'user', content: '【A】为他指路并闲聊（获得情报）' },
        // 当前轮：选项已提取为可点按钮 → 正文不再渲染选项行（R71）
        { role: 'assistant', content: '【甲龙历 407.03.02｜午后｜村口】\n你为旅人指了路，他留下一个古旧的护符。\n\n【A】收下护符\n【B】婉言谢绝' },
      ],
    }]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const m = await win.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length
    const sc = document.querySelector('.scene-line')
    // R71：当前轮选项已提取为按钮 → 正文不渲染选项行；历史轮保留
    const msgs = Array.from(document.querySelectorAll('.msg.assistant'))
    const lastMsg = msgs[msgs.length - 1]
    return {
      scene: q('.scene-line'), ask: q('.ask-line'), status: q('.status-panel'), opt: q('.option-line'),
      choiceBtns: q('.choice'),
      lastMsgOptLines: lastMsg ? lastMsg.querySelectorAll('.option-line').length : -1,
      sceneMono: sc ? getComputedStyle(sc).fontFamily : '',
      sceneColor: sc ? getComputedStyle(sc).color : '',
      optColor: (document.querySelector('.option-line') ? getComputedStyle(document.querySelector('.option-line')).color : ''),
    }
  })
  check('scene-line-rendered', m.scene >= 2, 'n=' + m.scene)
  check('ask-line-rendered', m.ask >= 1, 'n=' + m.ask)
  check('status-panel-rendered', m.status >= 1, 'n=' + m.status)
  check('option-line-rendered', m.opt >= 2, 'n=' + m.opt)
  check('last-msg-option-line-hidden', m.lastMsgOptLines === 0, 'lastOpt=' + m.lastMsgOptLines)
  check('current-choices-as-buttons', m.choiceBtns >= 2, 'btns=' + m.choiceBtns)
  check('scene-line-accent', m.sceneColor.includes('165, 100, 31') || m.sceneColor.includes('201, 139, 75'), m.sceneColor)
  check('option-line-dim-not-faint', !m.optColor.includes('160, 156, 147'), m.optColor)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

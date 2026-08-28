// R11：窄窗实测 700px/500px——无横向溢出、侧栏自收、进度轨可见、输入区可用、选项卡堆叠
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })

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
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'r11', title: '窄窗验证线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n你醒了。\n\n【你需要决定】\n\n【A】出门探索【B】再睡一会' },
      ],
    }]))
  })

  for (const w of [700, 500]) {
    await win.setViewportSize({ width: w, height: 800 })
    await win.reload(); await win.waitForTimeout(1800)
    const m = await win.evaluate(() => {
      const vis = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
      const r = (el) => el ? Math.round(el.getBoundingClientRect().width) : -1
      return {
        scrollW: document.body.scrollWidth,
        sidebarCollapsed: document.querySelector('#sidebar') ? document.querySelector('#sidebar').classList.contains('collapsed') : null,
        railVisible: vis(document.querySelector('#progress-rail')),
        inputW: r(document.querySelector('#input')),
        sendVisible: vis(document.querySelector('#btn-send')),
        choiceW: r(document.querySelector('.choice')),
        msgW: r(document.querySelector('.messages')),
      }
    })
    const ok = m.scrollW <= w && m.sidebarCollapsed === true && m.railVisible && m.sendVisible && m.choiceW > 200
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + w + 'px  ' + JSON.stringify(m))
    await win.screenshot({ path: path.join(OUT, 'r11-' + w + 'px.png') })
  }
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

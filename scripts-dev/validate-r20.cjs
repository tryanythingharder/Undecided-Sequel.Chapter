// 验证 R20：核心闭环——开局点击 → 流式(忙碌徽标/停止钮) → 叙事+选项渲染 → 点选项推进第二回合
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
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // 空状态点击「开始游戏」→ 真实首跑路径
  await win.locator('.empty button.primary').click()
  // 轮询捕捉流式中状态（24ms/chunk 的 mock 流）
  let badgeSeen = false, stopSeen = false
  for (let i = 0; i < 40; i++) {
    const s = await win.evaluate(() => ({
      badge: (document.querySelector('#chat-status') || {}).textContent || '',
      send: (document.querySelector('#btn-send') || {}).textContent || '',
    }))
    if (s.badge.includes('世界运转中')) badgeSeen = true
    if (s.send.includes('停止')) stopSeen = true
    if (badgeSeen && stopSeen) break
    await win.waitForTimeout(60)
  }
  check('busy-badge-during-stream', badgeSeen)
  check('stop-btn-during-stream', stopSeen)
  await win.screenshot({ path: path.join(OUT, 'r20-01-streaming.png') })

  // 等待流结束：选项卡出现
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  const msgText = (await win.locator('.messages').textContent()) || ''
  console.log('DEBUG messages[:300]=[' + msgText.slice(0, 300) + ']')
  check('narrative-rendered', msgText.includes('布耶纳村') || msgText.includes('老槐树下')) // 与调用次序无关：mock 计数器决定返回哪一段
  check('choices-after-stream', (await win.locator('.choice').count()) >= 3)

  // 点选项推进第二回合
  await win.locator('.choice').first().click()
  await win.waitForTimeout(300)
  const streaming2 = await win.evaluate(() => (document.querySelector('#btn-send') || {}).textContent || '')
  await win.locator('.choice').first().waitFor({ timeout: 15000 })
  const finalText = (await win.locator('.messages').textContent()) || ''
  const msgCount = await win.evaluate(() => document.querySelectorAll('.messages [data-mi]').length)
  check('second-turn-advanced', finalText.includes('老槐树下') && msgCount === 4, 'msgs=' + msgCount) // 地标+消息数双条件，防陈旧 mock 假阳性
  check('choice-click-sent', streaming2.includes('停止') || finalText.includes('接过石片'))
  await win.screenshot({ path: path.join(OUT, 'r20-02-second-turn.png') })

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

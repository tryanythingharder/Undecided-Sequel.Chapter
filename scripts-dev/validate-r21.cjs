// 验证 R21：真实错误流（mock 429→中文映射+重试钮）与 IF 分歧端到端（复刻历史、选项重现、原线保留）
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

  // 回合 1：开局成功
  await win.locator('.empty button.primary').click()
  await win.locator('.choice').first().waitFor({ timeout: 15000 })

  // 回合 2：发送「触发错误」→ mock 429 → 错误 UI
  await win.locator('#input').fill('触发错误')
  await win.locator('#btn-send').click()
  await win.locator('.msg-body.err').waitFor({ timeout: 15000 })
  const errText = (await win.locator('.msg-body.err').textContent()) || ''
  check('err-429-friendly', errText.includes('请求过于频繁'), errText.slice(0, 22))
  check('err-retry-btn', (await win.locator('.retry-btn').count()) === 1)
  await win.screenshot({ path: path.join(OUT, 'r21-01-429-error.png') })

  // IF 分歧：悬停第二条 user 消息（触发错误，idx=2）→ 工具条 IF 分歧 → 确认
  const msg2 = win.locator('[data-mi="2"]')
  await msg2.hover()
  await msg2.locator('.if-btn').click()
  await win.locator('.confirm .primary').click()
  await win.waitForTimeout(1200)

  const title = (await win.locator('#chat-title').textContent()) || ''
  check('if-title-prefix', title.startsWith('IF ·'), title.slice(0, 16))
  const bodyText = (await win.locator('.messages').textContent()) || ''
  console.log('DEBUG if-body[:260]=[' + bodyText.slice(0, 260) + ']')
  check('if-history-sliced', (bodyText.includes('布耶纳村') || bodyText.includes('老槐树下')) && !bodyText.includes('触发错误') && !bodyText.includes('请求过于频繁')) // 与调用次序无关
  check('if-choices-reappear', (await win.locator('.choice').count()) >= 3)
  const sideText = (await win.locator('#session-list').textContent()) || ''
  check('if-original-kept', (sideText.match(/IF ·/g) || []).length === 1 && sideText.length > 0)
  await win.screenshot({ path: path.join(OUT, 'r21-02-if-branch.png') })

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

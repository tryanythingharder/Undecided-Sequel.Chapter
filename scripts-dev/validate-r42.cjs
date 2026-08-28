// 验证 R57：生成中 IF/删线/删工作区均被 toast 拦截（无确认框）；回合结束后恢复正常
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
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'g1', title: '守卫线甲', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '第一幕。\n\n【A】走【B】停' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // 发起回合并**轮询等待忙碌确立**（发送钮变「停止」）
  await win.locator('#input').fill('继续')
  await win.locator('#input').press('Enter')
  let busyOn = false
  for (let i = 0; i < 40; i++) {
    const t = await win.evaluate(() => (document.querySelector('#btn-send') || {}).textContent || '')
    if (t.includes('停止')) { busyOn = true; break }
    await win.waitForTimeout(50)
  }
  check('busy-established', busyOn)

  const probe = async () => win.evaluate(() => ({
    toast: (document.querySelector('.toast') || {}).textContent || '',
    confirm: document.querySelectorAll('.confirm').length,
    send: (document.querySelector('#btn-send') || {}).textContent || '',
  }))

  // (a) 设计验证：生成中消息工具栏（含 IF）本就不渲染（app.js:1217 showTools=!busy）→ .if-btn 应不存在
  const msg0 = win.locator('[data-mi="0"]')
  const ifCount = await win.evaluate(() => document.querySelectorAll('.if-btn').length)
  check('busy-if-tools-absent', ifCount === 0, 'if-btn=' + ifCount)

  // (b) 生成中点删除线 → toast 拦截，无确认框
  await win.locator('#session-list .session-item', { hasText: '守卫线甲' }).locator('.session-del').dispatchEvent('click')
  await win.waitForTimeout(200)
  const b = await probe()
  check('busy-del-session-blocked', b.toast.includes('世界运转中') && b.confirm === 0, JSON.stringify(b).slice(0, 80))
  await win.keyboard.press('Escape'); await win.waitForTimeout(200)

  // (c) 生成中点删除工作区 → toast 拦截，无确认框
  await win.locator('#btn-ws').click(); await win.waitForTimeout(200)
  await win.locator('#ws-del').dispatchEvent('click'); await win.waitForTimeout(200)
  const c = await probe()
  check('busy-del-ws-blocked', c.toast.includes('世界运转中') && c.confirm === 0, JSON.stringify(c).slice(0, 80))
  await win.keyboard.press('Escape')

  // 中止当前生成（点「停止」）→ 回合收尾后 IF 恢复正常出确认框
  await win.locator('#btn-send').click()
  for (let i = 0; i < 60; i++) {
    const t = await win.evaluate(() => (document.querySelector('#btn-send') || {}).textContent || '')
    if (t.includes('发送')) break
    await win.waitForTimeout(100)
  }
  await win.waitForTimeout(2300)
  await msg0.hover()
  await msg0.locator('.if-btn').click()
  await win.waitForTimeout(500)
  check('if-recovers-after-turn', (await win.locator('.confirm').count()) === 1)
  await win.locator('.confirm .cancel').click()

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })
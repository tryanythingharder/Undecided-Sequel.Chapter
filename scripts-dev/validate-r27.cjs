// 验证 R28：会话管理——双击重命名（Enter 生效）、删除带确认（确认生效/取消保留）
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
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'm1', title: '旧名字', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }] },
      { id: 'm2', title: '待删除线', createdAt: Date.now() - 999, updatedAt: Date.now() - 999, messages: [{ role: 'user', content: '开始' }] },
    ]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  // A. 双击重命名
  const first = win.locator('#session-list .session-item', { hasText: '旧名字' })
  await first.dblclick(); await win.waitForTimeout(400)
  const rin = win.locator('.session-rename-input')
  check('rename-input-appears', (await rin.count()) === 1)
  await rin.fill('新名字甲')
  await rin.press('Enter'); await win.waitForTimeout(500)
  const listText = (await win.locator('#session-list').textContent()) || ''
  check('rename-commits', listText.includes('新名字甲') && !listText.includes('旧名字'), listText.slice(0, 40))

  // B. 删除需确认：先取消 → 保留
  await win.locator('#session-list .session-item', { hasText: '待删除线' }).locator('.session-del').click({ force: true })
  await win.waitForTimeout(400)
  check('del-confirm-shows', (await win.locator('.confirm').count()) === 1)
  await win.locator('.confirm .cancel').click(); await win.waitForTimeout(800) // 等离场动画结束再二次触发
  check('del-cancel-keeps', ((await win.locator('#session-list').textContent()) || '').includes('待删除线'))

  // C. 确认删除 → 移除
  await win.locator('#session-list .session-item', { hasText: '待删除线' }).locator('.session-del').click({ force: true })
  await win.waitForTimeout(600)
  await win.locator('.confirm .danger').click(); await win.waitForTimeout(600) // 危险操作确认按钮 class=danger
  const after = (await win.locator('#session-list').textContent()) || ''
  check('del-confirmed-removes', !after.includes('待删除线') && after.includes('新名字甲'), after.slice(0, 40))
  await win.screenshot({ path: path.join(OUT, 'r27-01-session-mgmt.png') })

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

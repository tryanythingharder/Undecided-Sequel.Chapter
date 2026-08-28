// 验证 R46：空输入 ↑ 召回历史上行动（连按回溯、↓ 返回、非空不拦截、越界封顶）
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
      id: 'r39', title: '召回验证线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '第一条行动' },
        { role: 'assistant', content: '回应一。' },
        { role: 'user', content: '第二条行动' },
        { role: 'assistant', content: '回应二。' },
      ],
    }]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const input = win.locator('#input')
  await input.focus()
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  check('up-recalls-latest', (await input.inputValue()) === '第二条行动', await input.inputValue())
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  check('up-again-recalls-earlier', (await input.inputValue()) === '第一条行动', await input.inputValue())
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  check('up-capped-at-oldest', (await input.inputValue()) === '第一条行动')
  await win.keyboard.press('ArrowDown'); await win.waitForTimeout(200)
  check('down-returns-newer', (await input.inputValue()) === '第二条行动')
  await win.keyboard.press('ArrowDown'); await win.waitForTimeout(200)
  check('down-to-empty', (await input.inputValue()) === '')

  // 有草稿时 ↑ 不拦截（光标正常移动，内容不变）
  await input.fill('我的草稿')
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  check('no-intercept-when-draft', (await input.inputValue()) === '我的草稿')
  // 清空后 Esc 复位，再按 ↑ 从最新开始
  await input.fill('')
  await win.keyboard.press('Escape'); await win.waitForTimeout(200)
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  check('recall-restarts-at-latest', (await input.inputValue()) === '第二条行动')

  // R46b 护栏：召回中手动改动内容 → 再按 ↑ 重置为最新召回（而非错位回溯）
  await win.keyboard.press('ArrowDown'); await win.waitForTimeout(150) // 回到空
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(150) // 召回 第二条
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(150) // 召回 第一条
  await input.fill('手动改过的内容')
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  // 期望行为：召回态被重置（不再错位回溯到「第一条」），且按草稿规则不拦截（内容保持手动改动）
  check('guard-resets-after-manual-edit', (await input.inputValue()) === '手动改过的内容', await input.inputValue())
  // 清空后再按 ↑：正常从最新召回（状态已干净）
  await input.fill('')
  await win.keyboard.press('ArrowUp'); await win.waitForTimeout(200)
  check('recall-works-after-guard-reset', (await input.inputValue()) === '第二条行动', await input.inputValue())

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

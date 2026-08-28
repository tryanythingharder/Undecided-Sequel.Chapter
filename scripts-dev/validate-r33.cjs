// 验证 R35：设置往返——开设置窗 → 填端点/密钥/模型 → 测试连接(mock) → 保存 → 主窗芯片更新 → 持久化
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
  const findPage = async (frag, tries) => {
    for (let i = 0; i < (tries || 40); i++) {
      for (const ctx of browser.contexts()) {
        const p = ctx.pages().find((x) => x.url().includes(frag))
        if (p) return p
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    return null
  }
  const win = await findPage('index.html')
  await win.evaluate(() => { localStorage.clear(); localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1800)

  // 打开设置（独立系统窗口）
  await win.keyboard.press('Control+,')
  const st = await findPage('settings.html', 30)
  check('settings-window-opens', !!st)
  await st.waitForTimeout(1000)

  // 填写文本模型端点
  await st.locator('#set-baseurl').fill('http://127.0.0.1:4599')
  await st.locator('#set-apikey').fill('sk-mock')
  await st.locator('#set-model').fill('mock-chat')

  // 测试连接（GET /models，sk-mock 返回 7 个模型）
  await st.locator('#btn-test-text').click()
  await st.waitForTimeout(2500)
  const testOut = (await st.locator('.test-result').first().textContent().catch(() => '')) || ''
  check('test-connection-ok', /模型|可用|✓|成功|7/.test(testOut), testOut.slice(0, 30))

  // 保存 → 主窗芯片更新
  await st.locator('#btn-save-settings').click()
  await win.waitForTimeout(1200) // 保存后设置窗口自动关闭 → 不再使用 st 句柄
  const chip = ((await win.locator('#chip-text-model').textContent()) || '').trim()
  check('main-chip-updated', chip.includes('mock-chat'), chip)

  // 主窗重载 → 持久化
  await win.reload(); await win.waitForTimeout(1500)
  const chip2 = ((await win.locator('#chip-text-model').textContent()) || '').trim()
  check('config-persisted', chip2.includes('mock-chat'), chip2)

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// 验证 R24：画廊（卡片渲染）+ 大图查看器（计数/左右切换/Esc）
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })
const fails = []
const check = (n, c, e) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (e ? '  ' + e : '')); if (!c) fails.push(n) }
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

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
  await win.evaluate(([p1, p2]) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'v24', title: '画廊验证线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '第一幕，石片泛光。', illust: p1 },
        { role: 'user', content: '继续' },
        { role: 'assistant', content: '第二幕，钟声惊鸽。', illust: p2 },
      ],
    }]))
  }, [PNG1, PNG2])
  await win.reload(); await win.waitForTimeout(1800)

  await win.locator('#btn-gallery').click(); await win.waitForTimeout(800)
  check('gallery-opens', await win.locator('#gallery').isVisible())
  const cards = await win.locator('#gallery-body img').count()
  check('gallery-cards', cards >= 2, 'imgs=' + cards)
  await win.screenshot({ path: path.join(OUT, 'r24-01-gallery.png') })

  const imgA11y = await win.evaluate(() => {
    const im = document.querySelector('#gallery-body img')
    return { tabindex: im.getAttribute('tabindex'), role: im.getAttribute('role') }
  })
  check('gallery-img-focusable', imgA11y.tabindex === '0' && imgA11y.role === 'button', JSON.stringify(imgA11y))
  await win.locator('#gallery-body img').first().focus()
  await win.keyboard.press('Enter'); await win.waitForTimeout(600) // R33b：键盘 Enter 打开大图
  check('lightbox-opens', await win.locator('#lightbox').isVisible())
  const c1 = ((await win.locator('.lightbox-counter').textContent()) || '').trim()
  check('counter-first', c1.includes('1') && c1.includes('2'), c1)
  await win.keyboard.press('ArrowRight'); await win.waitForTimeout(400)
  const c2 = ((await win.locator('.lightbox-counter').textContent()) || '').trim()
  check('arrow-cycles', c2 !== c1 && c2.includes('2'), c2)
  await win.screenshot({ path: path.join(OUT, 'r24-02-lightbox.png') })
  await win.keyboard.press('Escape'); await win.waitForTimeout(400)
  check('esc-closes-lightbox', (await win.locator('#lightbox').count()) === 0 || !(await win.locator('#lightbox').isVisible().catch(() => false)))
  await win.waitForTimeout(600) // 等 lightbox popout 离场动画结束
  const galVisible = await win.locator('#gallery').isVisible().catch(() => false)
  if (galVisible) {
    await win.locator('#btn-gallery-close').click({ force: true }); await win.waitForTimeout(400)
    check('gallery-closes', !(await win.locator('#gallery').isVisible()))
  } else {
    check('gallery-closes', true) // Esc 级联关闭（全局 Esc 同时处理画廊）
  }

  console.log(fails.length ? 'RESULT FAIL ' + fails.join(',') : 'RESULT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// R65 视觉重构后复测:分层像素验证 + 截图(只读 UI,不改样式)
// 用法: node audit-r65-after.cjs [cdp-port]
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = 'D:\\代码\\测试\\无职转生\\test-shots\\audit'

const hex = (s) => {
  s = String(s).trim()
  if (s.startsWith('#')) { const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)) }
  const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null
}

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
      { id: 's1', ws: 'w1', title: '布耶纳村的少年', createdAt: Date.now() - 86400000, updatedAt: Date.now(), messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n晨光透过窗帘的缝隙洒进来。\n\n【A】起床出门\n【B】继续睡' },
      ] },
    ]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: Date.now() }]))
  })
  await win.reload()
  await win.waitForTimeout(1200)

  const results = []
  const check = (name, pass, detail) => {
    results.push({ name, pass, detail })
    console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ' + (detail || ''))
  }

  // A. 深色主题:bg / surface 令牌分层(通过临时元素解析 color-mix 实际值)
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  const tokensDark = await win.evaluate(() => {
    const mk = (v) => { const d = document.createElement('div'); d.style.cssText = 'background:' + v + ';position:absolute;visibility:hidden'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c }
    const cs = getComputedStyle(document.documentElement)
    return { bg: mk('var(--bg)'), s1: mk('var(--surface-1)'), s3: mk('var(--surface-3)'), panel: mk('var(--panel)'), sh1: cs.getPropertyValue('--shadow-1'), ov: cs.getPropertyValue('--overlay') }
  })
  const bgD = hex(tokensDark.bg), s1D = hex(tokensDark.s1), s3D = hex(tokensDark.s3), panelD = hex(tokensDark.panel)
  const delta = (a, b) => Math.round(Math.abs(a[0] - b[0]))
  check('dark-bg-vs-surface1', delta(bgD, s1D) >= 6, 'bg=' + tokensDark.bg + ' s1=' + tokensDark.s1 + ' d=' + delta(bgD, s1D))
  check('dark-panel-vs-surface3', delta(panelD, s3D) >= 2, 'panel=' + tokensDark.panel + ' s3=' + tokensDark.s3 + ' d=' + delta(panelD, s3D))
  check('shadow-tokens-defined', tokensDark.sh1.trim().length > 0, tokensDark.sh1)

  // B. 浅色主题:遮罩修正 + focus 光圈
  const tokensLight = await win.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light')
    const cs = getComputedStyle(document.documentElement)
    const g = (n) => cs.getPropertyValue(n)
    return { ov: g('--overlay'), glow: g('--accent-glow'), s3: g('--surface-3') }
  })
  const ovL = hex(tokensLight.ov)
  check('light-overlay-darkened', ovL && ovL[0] <= 60, 'overlay=' + tokensLight.ov)
  const glowA = parseFloat((tokensLight.glow.match(/[\d.]+/g) || []).pop())
  check('light-focus-glow-visible', glowA >= 0.12, 'glow alpha=' + glowA)
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
  await win.waitForTimeout(400)
  await win.screenshot({ path: OUT + '\\r65-after-01-light-main.png' })

  // C. 浅色确认框:遮罩下背景明度应明显低于表面(修复 62% 中灰蒙罩)
  // 打开新建线确认框(需要打开一个 confirm)——用工作区删除按钮
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
  // 切回深色前先测浅色 ws-menu 浮层截图
  await win.locator('#btn-ws').click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: OUT + '\\r65-after-02-light-wsmenu.png' })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  // D. 深色主题主界面 + 主题弹层 + 确认框
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await win.waitForTimeout(400)
  await win.screenshot({ path: OUT + '\\r65-after-03-dark-main.png' })
  await win.locator('#btn-theme').click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: OUT + '\\r65-after-04-dark-themepop.png' })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)
  await win.locator('#btn-gallery').click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: OUT + '\\r65-after-05-dark-gallery.png' })
  await win.locator('#btn-gallery-close').click()
  await win.waitForTimeout(400)

  // E. 空态层级(水印静止 & 弱化):临时元素读计算样式
  const emptyState = await win.evaluate(() => {
    const d = document.createElement('div')
    d.className = 'empty-sigil'
    d.style.cssText = 'position:absolute;visibility:hidden'
    document.body.appendChild(d)
    const cs = getComputedStyle(d)
    const r = { opacity: cs.opacity, animation: cs.animationName }
    d.remove()
    return r
  })
  check('empty-sigil-watermark', emptyState && parseFloat(emptyState.opacity) <= 0.3 && emptyState.animation === 'none', JSON.stringify(emptyState))

  // F. choice hover 位移:transform 而非 padding
  const choiceTransition = await win.evaluate(() => {
    const el = document.querySelector('.choice')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { transition: cs.transitionProperty }
  })
  check('choice-hover-transform', choiceTransition && choiceTransition.transition.includes('transform') && !choiceTransition.transition.includes('padding'), JSON.stringify(choiceTransition))

  const fails = results.filter((r) => !r.pass).length
  console.log(fails ? 'AUDIT ' + fails + ' check(s) failed' : 'AUDIT ALL PASS')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

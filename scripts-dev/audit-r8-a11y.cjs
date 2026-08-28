// R8 P2-1：无障碍核查——关键文本对比度（WCAG AA）+ 焦点可见性 + 选项卡可聚焦性
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'

function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2) }

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
      id: 'a8', title: 'a11y', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n你醒了。\n\n【你需要决定】\n\n【A】出门探索【B】再睡一会' },
      ],
    }]))
  })
  await win.reload(); await win.waitForTimeout(1800)

  const rows = await win.evaluate(() => {
    const out = []
    const pick = (el, label) => {
      if (!el) { out.push({ label, missing: true }); return }
      const cs = getComputedStyle(el)
      let bg = null, n = el
      while (n && n !== document.documentElement) {
        const b = cs.backgroundColor && n === el ? getComputedStyle(n).backgroundColor : getComputedStyle(n).backgroundColor
        const m = b.match(/[\d.]+/g)
        if (m && Number(m[3] || 1) > 0) { bg = m.slice(0, 3).map(Number); break }
        n = n.parentElement
      }
      if (!bg) bg = [255, 255, 255]
      const fm = cs.color.match(/[\d.]+/g).slice(0, 3).map(Number)
      out.push({ label, fg: fm, bg, size: cs.fontSize, tag: el.tagName, tabindex: el.getAttribute('tabindex'), role: el.getAttribute('role') })
    }
    pick(document.querySelector('.send'), '发送按钮')
    pick(document.querySelector('.choice'), '选项卡')
    pick(document.querySelector('.choice .choice-key') || document.querySelector('.choice'), '选项字母')
    pick(document.querySelector('.if-hint'), 'IF提示')
    pick(document.querySelector('#input'), '输入框占位')
    pick(document.querySelector('.session-item.active'), '当前会话项')
    pick(document.querySelector('.choices-title'), '选项区标题')
    pick(document.querySelector('.empty-tip'), '空态提示')
    // 焦点可见性
    const focusInfo = []
    for (const sel of ['#btn-send', '.choice', '#btn-new', '#btn-theme']) {
      const el = document.querySelector(sel)
      if (!el) { focusInfo.push({ sel, missing: true }); continue }
      el.focus()
      const cs = getComputedStyle(el)
      focusInfo.push({ sel, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 60), focusable: el.tabIndex >= 0 })
    }
    return { rows: out, focusInfo }
  })

  console.log('--- 对比度（AA：正文≥4.5，大字/UI≥3.0） ---')
  for (const r of rows.rows) {
    if (r.missing) { console.log('MISS  ' + r.label); continue }
    const ra = ratio(r.fg, r.bg)
    const big = parseFloat(r.size) >= 18
    const need = big ? 3.0 : 4.5
    console.log((Number(ra) >= need ? 'PASS ' : Number(ra) >= 3.0 ? 'WARN ' : 'FAIL ') + r.label + '  ratio=' + ra + '  size=' + r.size + '  fg=' + r.fg.join(',') + ' bg=' + r.bg.join(','))
  }
  console.log('--- 焦点可见性 ---')
  for (const f of rows.focusInfo) console.log(JSON.stringify(f))
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

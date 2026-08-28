// R9：7 调色板 × 明暗 = 14 组合的关键变量对比度矩阵（WCAG AA）
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'

function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

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
  await win.evaluate(() => { localStorage.setItem('sixworlds.onboard.v1', '1') })
  await win.reload(); await win.waitForTimeout(1500)

  const combos = []
  for (const pal of ['', 'paper', 'forest', 'violet', 'ocean', 'rose', 'contrast']) {
    for (const th of ['dark', 'light']) combos.push([pal, th])
  }
  const data = await win.evaluate((combos) => {
    const hex = (s) => {
      s = s.trim()
      if (s.startsWith('#')) { const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1); return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)) }
      const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null
    }
    const out = []
    for (const [pal, th] of combos) {
      if (pal) document.documentElement.setAttribute('data-palette', pal); else document.documentElement.removeAttribute('data-palette')
      document.documentElement.setAttribute('data-theme', th)
      const cs = getComputedStyle(document.documentElement)
      out.push({
        combo: (pal || 'classic') + '/' + th,
        bg: hex(cs.getPropertyValue('--bg')),
        panel: hex(cs.getPropertyValue('--panel')),
        text: hex(cs.getPropertyValue('--text')),
        dim: hex(cs.getPropertyValue('--text-dim')),
        accent: hex(cs.getPropertyValue('--accent')),
        onacc: hex(cs.getPropertyValue('--on-accent')) || [255, 255, 255],
      })
    }
    return out
  }, combos)

  let fails = 0
  console.log('combo          text/bg  dim/bg  acc/bg  wht/acc')
  for (const d of data) {
    const r1 = ratio(d.text, d.bg), r2 = ratio(d.dim, d.bg), r3 = ratio(d.accent, d.bg), r4 = ratio(d.onacc, d.accent)
    const bad = []
    if (r1 < 4.5) bad.push('text')
    if (r2 < 4.5) bad.push('dim')
    if (r3 < 3.0) bad.push('acc-border')
    if (r4 < 4.5) bad.push('wht/acc-btn')
    if (bad.length) fails++
    console.log((bad.length ? 'FAIL ' : 'PASS ') + d.combo.padEnd(12) + r1.toFixed(2).padStart(6) + r2.toFixed(2).padStart(8) + r3.toFixed(2).padStart(8) + r4.toFixed(2).padStart(8) + (bad.length ? '  <- ' + bad.join(',') : ''))
  }
  console.log(fails ? 'MATRIX ' + fails + ' combo(s) below AA' : 'MATRIX ALL PASS')
  process.exit(0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

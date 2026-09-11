/* 画廊审查探针 v2：定量查清截图暴露的排版疑点，并验证根因假设（运行时注入 CSS 对照） */
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const OUT = path.join(__dirname, '..', 'output', 'gallery-audit')
fs.mkdirSync(OUT, { recursive: true })
const out = {}
const log = (...a) => { const s = a.join(' '); console.log(s); }

function svgIllust(i) {
  const colors = ['#2b1f3a', '#1d2740', '#050510', '#0d1f12', '#3a2a1a', '#0a1a2a']
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="' + colors[i % 6] + '"/><circle cx="300" cy="200" r="80" fill="#e8c45c"/></svg>')
}

async function main() {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  let win = await app.firstWindow()
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(2500)
  await win.evaluate((imgs) => {
    const now = Date.now()
    const mk = (text, illust, i) => { const m = { role: 'assistant', content: text, at: now - i * 36e5 }; if (illust) { m.illust = illust; m.illustAt = now - i * 36e5 } return m }
    const big = []
    for (let i = 0; i < 12; i++) big.push(mk('第' + (i + 1) + '回合的叙事。', imgs[i % 6], i))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'd1', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1', title: '《十二图会话》', createdAt: now, updatedAt: now, messages: big },
      { id: 'd2', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1', title: '《一个很长很长很长很长很长很长很长很长很长的世界线标题》', createdAt: now, updatedAt: now, messages: [{ role: 'assistant', content: '无图。', at: now }] }
    ]))
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentSessionId: 'd1', theme: 'dark', palette: 'classic' }))
  }, [0, 1, 2, 3, 4, 5].map(svgIllust))
  await win.reload(); await win.waitForTimeout(600)
  try { await win.waitForSelector('#splash.ready', { timeout: 15000 }) } catch { }
  await win.locator('#splash').click({ force: true, timeout: 5000 }).catch(() => { })
  await win.waitForTimeout(900)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center() })
  await win.waitForTimeout(700)

  await win.evaluate(() => document.getElementById('btn-gallery').click())
  await win.waitForSelector('.gallery-card', { timeout: 10000 }).catch(() => { })
  await win.waitForTimeout(1200)

  const geom = () => win.evaluate(() => {
    const rr = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    const body = document.getElementById('gallery-body')
    const cards = [...document.querySelectorAll('.gallery-card')]
    const media = document.querySelector('.gallery-media')
    const tb = document.querySelector('.gallery-toolbar')
    return {
      body: rr(body), bodyScrollH: body ? body.scrollHeight : null, bodyClientH: body ? body.clientHeight : null,
      bodyGridAutoRows: body ? getComputedStyle(body).gridAutoRows : null,
      bodyAlignContent: body ? getComputedStyle(body).alignContent : null,
      cards: cards.length, card0: rr(cards[0]), card1: rr(cards[1]),
      media0: rr(media), mediaAspect: media ? getComputedStyle(media).aspectRatio : null,
      select: rr(document.getElementById('gallery-session')),
      selectVisibleW: (() => { const s = document.getElementById('gallery-session'); return s ? Math.round(s.getBoundingClientRect().width) : null })(),
      buttons: tb ? [...tb.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), ...rr(b) })) : [],
      toolbarH: tb ? Math.round(tb.getBoundingClientRect().height) : null
    }
  })

  // ---- 1) 12 图：行高压缩实测 ----
  out.before = await geom()
  log('== 修复前（12 图，1440×900，抽屉 520）==')
  log('  body scrollH=' + out.before.bodyScrollH + ' clientH=' + out.before.bodyClientH + ' gridAutoRows=' + out.before.bodyGridAutoRows + ' alignContent=' + out.before.bodyAlignContent)
  log('  card0=' + JSON.stringify(out.before.card0) + ' media0=' + JSON.stringify(out.before.media0) + ' aspect=' + out.before.mediaAspect)
  log('  select 宽=' + out.before.selectVisibleW + 'px | toolbar 高=' + out.before.toolbarH + 'px')
  log('  buttons=' + JSON.stringify(out.before.buttons))

  // ---- 2) 注入 grid-auto-rows: max-content 对照（只改运行时，不动仓库） ----
  await win.evaluate(() => {
    const st = document.createElement('style')
    st.id = 'audit-probe-fix'
    st.textContent = '.gallery-body { grid-auto-rows: max-content; }'
    document.head.appendChild(st)
  })
  await win.waitForTimeout(500)
  out.afterFix = await geom()
  log('== 注入 grid-auto-rows:max-content 后 ==')
  log('  body scrollH=' + out.afterFix.bodyScrollH + ' clientH=' + out.afterFix.bodyClientH)
  log('  card0=' + JSON.stringify(out.afterFix.card0) + ' media0=' + JSON.stringify(out.afterFix.media0))
  await win.screenshot({ path: path.join(OUT, 'probe-after-fix.png') })
  await win.evaluate(() => { const s = document.getElementById('audit-probe-fix'); if (s) s.remove() })
  await win.waitForTimeout(300)

  // ---- 3) 空态：全部 .gallery-empty 逐个实测 ----
  await win.evaluate(() => {
    const sel = document.getElementById('gallery-session')
    sel.value = 'd2'; sel.dispatchEvent(new Event('change'))
  })
  await win.waitForTimeout(700)
  out.empty = await win.evaluate(() => {
    const all = [...document.querySelectorAll('.gallery-empty')]
    return {
      count: all.length,
      each: all.map((e) => {
        const b = e.getBoundingClientRect()
        const cs = getComputedStyle(e)
        const parent = e.parentElement
        return {
          text: (e.textContent || '').slice(0, 18), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
          textAlign: cs.textAlign, display: cs.display, gridColumn: cs.gridColumn, padding: cs.padding,
          parentId: parent ? (parent.id || parent.className) : null,
          parentDisplay: parent ? getComputedStyle(parent).display : null
        }
      })
    }
  })
  log('== 空态元素 ==')
  for (const e of out.empty.each) log('  ' + JSON.stringify(e))
  await win.screenshot({ path: path.join(OUT, 'probe-empty.png') })

  // ---- 4) 长标题头部 ----
  out.head = await win.evaluate(() => {
    const rr = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    return {
      head: rr(document.querySelector('.gallery-head')),
      title: rr(document.getElementById('gallery-title')),
      chip: rr(document.getElementById('gallery-count')),
      chipWhiteSpace: getComputedStyle(document.getElementById('gallery-count')).whiteSpace,
      close: rr(document.getElementById('btn-gallery-close')),
      headOverflow: (() => { const h = document.querySelector('.gallery-head'); return { scrollW: h.scrollWidth, clientW: h.clientWidth } })()
    }
  })
  log('== 长标题头部 ==')
  log('  ' + JSON.stringify(out.head))
  await win.screenshot({ path: path.join(OUT, 'probe-longtitle.png') })

  // ---- 5) 交互可达性：hover 操作按钮的键盘/无障碍信息 ----
  out.a11y = await win.evaluate(() => {
    const sel = document.getElementById('gallery-session')
    sel.value = 'd1'; sel.dispatchEvent(new Event('change'))
    return null
  })
  await win.waitForTimeout(700)
  out.a11y = await win.evaluate(() => {
    const btns = [...document.querySelectorAll('.hover-actions button')]
    const img = document.querySelector('.gallery-media img')
    return {
      actionButtons: btns.slice(0, 3).map((b) => ({ text: b.textContent, title: b.title, ariaLabel: b.getAttribute('aria-label') })),
      imgTabIndex: img ? img.tabIndex : null,
      imgRole: img ? img.getAttribute('role') : null,
      imgAlt: img ? img.getAttribute('alt') : null,
      cardCount: document.querySelectorAll('.gallery-card').length,
      tabbableInBody: document.querySelectorAll('#gallery-body [tabindex="0"], #gallery-body button').length
    }
  })
  log('== 可达性 ==')
  log('  ' + JSON.stringify(out.a11y))

  fs.writeFileSync(path.join(OUT, 'probe-v2.json'), JSON.stringify(out, null, 2))
  await app.close()
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

/* 画廊 UI/UX 审查专用截图 + 几何测量
 * 用途：为画廊（插图集）的多维度评审提供真实渲染证据——多状态截图 + DOM 几何数据。
 * 与 capture-readme-shots.cjs 的区别：那个是给 README 用的单张美图；这个是为了暴露
 * 排版/密度/溢出/截断等问题的「体检」，覆盖：双方案 × 明暗 × 宽窄 × 空态 × hover ×
 * 大图 × 长标题 × 多图滚动，并把关键容器几何量出来存 JSON 供评审引用。
 * 运行：node scripts-dev/capture-gallery-audit.cjs（SIXWORLDS_TEST=1，测试档隔离）
 */
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const OUT = path.join(__dirname, '..', 'output', 'gallery-audit')
fs.mkdirSync(OUT, { recursive: true })

// ---- 演示插图：多场景渐变剪影（与 capture-readme-shots 同款，独立复制避免耦合） ----
function svgIllust(variant) {
  const scenes = {
    dawn: { sky: ['#2b1f3a', '#8a4d3f', '#e8a45c'], sun: ['#f5d9a0', '#e8a45c'], moon: false, mist: 'rgba(232,164,92,.25)' },
    church: { sky: ['#1d2740', '#3d5a80', '#98c1d9'], sun: ['#e0fbfc', '#98c1d9'], moon: false, mist: 'rgba(152,193,217,.22)' },
    night: { sky: ['#050510', '#101830', '#27324f'], sun: ['#d8e4ff', '#8fa8d8'], moon: true, mist: 'rgba(143,168,216,.18)' },
    forest: { sky: ['#0d1f12', '#1d4028', '#4a7c59'], sun: ['#c2e8c8', '#7fb069'], moon: false, mist: 'rgba(127,176,105,.20)' },
    desert: { sky: ['#3a2a1a', '#8a6a3f', '#e8c45c'], sun: ['#f5e9a0', '#e8c45c'], moon: false, mist: 'rgba(232,196,92,.22)' },
    sea: { sky: ['#0a1a2a', '#1a4a6a', '#5c9ec4'], sun: ['#d0eaf8', '#5c9ec4'], moon: false, mist: 'rgba(92,158,196,.22)' }
  }[variant] || { sky: ['#222', '#444', '#777'], sun: ['#eee', '#ccc'], moon: false, mist: 'rgba(200,200,200,.2)' }
  const ridgeSvg = '<path d="M0 675 L0 470 Q150 430 300 470 Q450 510 600 470 Q750 430 900 470 Q1050 510 1200 470 L1200 675 Z" fill="rgba(0,0,0,.5)"/>'
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">' +
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + scenes.sky[0] + '"/><stop offset=".55" stop-color="' + scenes.sky[1] + '"/><stop offset="1" stop-color="' + scenes.sky[2] + '"/>' +
    '</linearGradient></defs><rect width="1200" height="675" fill="url(#sky)"/>' +
    (scenes.moon ? '<circle cx="900" cy="170" r="58" fill="#e8eeff"/>' : '<circle cx="330" cy="200" r="46" fill="' + scenes.sun[0] + '" opacity=".9"/>') +
    ridgeSvg + '<rect y="600" width="1200" height="75" fill="' + scenes.mist + '"/></svg>')
}

async function passSplash(w) {
  try { await w.waitForSelector('#splash.ready', { timeout: 20000, state: 'attached' }) } catch { return }
  try { await w.locator('#splash').click({ force: true, timeout: 5000 }) } catch { }
  await w.waitForTimeout(800)
}

const VARIANTS = ['dawn', 'church', 'night', 'forest', 'desert', 'sea']

async function seed(win) {
  await win.evaluate((imgs) => {
    const now = Date.now()
    // 长摘要 / 短摘要 / 多行摘要都覆盖：hover 浮层的截断行为是评审重点
    const LONG = '你推开木门，带着一身煤灰味走进布耶纳村的集市。晨雾还挂在麦田上，铁匠铺的炉火昨夜熄得很晚。集市长老认出了你，朝你招了招手，压低声音说今天有外地商队带来了北地来的魔法道具。'
    const SHORT = '晨雾散尽，集市开张。'
    const mk = (role, content, illust, illustAt) => {
      const m = { role, content, at: now - Math.random() * 3e6 }
      if (illust) { m.illust = illust; m.illustAt = illustAt || now - Math.random() * 8.64e7 }
      return m
    }
    const mkTurn = (n, text, illust, illustAt) => ([
      mk('user', '第' + n + '回合：我继续往前走。'),
      mk('assistant', text, illust, illustAt)
    ])
    const big = []
    for (let n = 1; n <= 12; n++) {
      const text = n % 3 === 0 ? LONG : (n % 3 === 1 ? SHORT : '【甲龙历 407.03.' + String(n).padStart(2, '0') + '｜清晨】\n你沿着村道往' + (n % 2 ? '后山' : '集市') + '走去，草叶上的露水打湿了裤脚。远处传来钟声。\n\n【你需要决定】\n【A】继续前进\n【B】折返\n【C】原地观察')
      big.push(...mkTurn(n, text, imgs[(n - 1) % imgs.length], now - (13 - n) * 36e5))
    }
    const sessions = [
      {
        id: 'demo1', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1',
        title: '《布耶纳村的清晨》', createdAt: now - 864e5, updatedAt: now - 6e5, messages: big
      },
      {
        id: 'demo2', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1',
        title: '《月夜的后山》', createdAt: now - 2 * 864e5, updatedAt: now - 9e6,
        messages: [
          mk('user', '半夜我偷偷溜出家门，往后山走。'),
          mk('assistant', '月亮悬在后山尖上。', imgs[2], now - 3e7),
          mk('assistant', '林子深处有低语声。', imgs[3], now - 2e7)
        ]
      },
      {
        id: 'demo3', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1',
        title: '《一个很长很长很长很长很长很长很长很长很长的世界线标题》', createdAt: now - 3 * 864e5, updatedAt: now - 1e7,
        messages: [mk('user', '开始。'), mk('assistant', '故事开始的地方没有插图。')]
      },
      { id: 'demo4', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1', title: '《空世界线》', createdAt: now - 4 * 864e5, updatedAt: now - 2e7, messages: [] }
    ]
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify(sessions))
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.ifhint-seen.v1', '1')
    localStorage.setItem('sixworlds.railhint-seen.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
      preset: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat',
      currentSessionId: 'demo1', theme: 'dark', palette: 'classic', illustAuto: false
    }))
  }, VARIANTS.map(svgIllust))
}

// 打开画廊并等待卡片渲染
async function openGallery(win) {
  await win.evaluate(() => document.getElementById('btn-gallery').click())
  await win.waitForSelector('.gallery-card', { timeout: 10000 }).catch(() => {})
  await win.waitForTimeout(900) // 等 shimmer 淡入结束
}

async function closeGallery(win) {
  await win.evaluate(() => document.getElementById('btn-gallery-close').click()).catch(() => {})
  await win.waitForTimeout(500)
}

// 切会话：直接设值 + 派发 change（避免 Playwright 可见性等待；顺带兜底确保抽屉开着）
async function selectSession(win, id) {
  await win.evaluate((sid) => {
    const g = document.getElementById('gallery')
    if (g && g.hidden) document.getElementById('btn-gallery').click()
    const sel = document.getElementById('gallery-session')
    sel.value = sid
    sel.dispatchEvent(new Event('change'))
  }, id)
  await win.waitForTimeout(700)
}

async function measure(win, label) {
  return await win.evaluate((label) => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    const g = document.getElementById('gallery')
    const tb = document.querySelector('.gallery-toolbar')
    const body = document.getElementById('gallery-body')
    const cards = [...document.querySelectorAll('.gallery-card')]
    const cardW = cards.length ? Math.round(cards[0].getBoundingClientRect().width) : 0
    const cols = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().x))).size
    const btn = document.querySelector('#btn-gallery-saveall')
    return {
      label,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scheme: document.documentElement.getAttribute('data-ui-scheme') || 'classic',
      theme: document.documentElement.getAttribute('data-theme'),
      palette: document.documentElement.getAttribute('data-palette'),
      drawer: r(g),
      head: r(document.querySelector('.gallery-head')),
      toolbar: r(tb),
      toolbarOverflow: tb ? { scrollW: tb.scrollWidth, clientW: tb.clientWidth, overflowing: tb.scrollWidth > tb.clientWidth + 1 } : null,
      toolbarChildren: tb ? [...tb.children].map((c) => ({ tag: c.tagName, text: (c.textContent || '').trim().slice(0, 14), ...r(c) })) : [],
      body: r(body),
      bodyScroll: body ? { scrollH: body.scrollHeight, clientH: body.clientHeight } : null,
      cardCount: cards.length,
      gridCols: cols,
      cardSize: cards.length ? { w: cardW, h: Math.round(cards[0].getBoundingClientRect().height) } : null,
      cardGap: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().right) : null,
      metaFontSize: (() => { const m = document.querySelector('.gallery-card-meta'); return m ? getComputedStyle(m).fontSize : null })(),
      metaColor: (() => { const m = document.querySelector('.gallery-card-meta'); return m ? getComputedStyle(m).color : null })(),
      excerptFontSize: (() => { const m = document.querySelector('.gallery-card-excerpt-text'); return m ? getComputedStyle(m).fontSize : null })(),
      selectW: r(document.getElementById('gallery-session')),
      selectText: (() => { const s = document.getElementById('gallery-session'); return s && s.selectedOptions[0] ? s.selectedOptions[0].textContent : null })(),
      saveallBtn: r(btn),
      subChip: { text: (document.getElementById('gallery-count') || {}).textContent || '', ...r(document.getElementById('gallery-count')) },
      title: r(document.getElementById('gallery-title')),
      bodyPadding: body ? getComputedStyle(body).padding : null,
      emptyEl: r(document.querySelector('.gallery-empty'))
    }
  }, label)
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
  await seed(win)
  await win.reload()
  await win.waitForTimeout(600)
  await passSplash(win)

  const measures = []
  const shot = async (name) => { await win.screenshot({ path: path.join(OUT, name + '.png') }); console.log('shot ' + name) }

  // 基准窗口：桌面常用尺寸
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center() })
  await win.waitForTimeout(700)

  // 1) 经典 · 深色 · 12 图（默认态）
  await openGallery(win)
  measures.push(await measure(win, 'classic-dark-1440'))
  await shot('01-classic-dark-1440')

  // 2) 悬停一张卡（摘要浮层 + 操作按钮显形）
  await win.locator('.gallery-card').first().hover()
  await win.waitForTimeout(600)
  await shot('02-classic-dark-hover')

  // 3) 滚到底（多图滚动的视觉连续性 + 最后一行）
  await win.evaluate(() => { const b = document.getElementById('gallery-body'); b.scrollTop = b.scrollHeight })
  await win.waitForTimeout(500)
  await shot('03-classic-dark-scrolled')
  await win.evaluate(() => { const b = document.getElementById('gallery-body'); b.scrollTop = 0 })

  // 4) 大图 lightbox（从画廊点开）
  await win.locator('.gallery-media img').first().click()
  await win.waitForTimeout(900)
  await shot('04-classic-dark-lightbox')
  const lb = await win.evaluate(() => {
    const m = document.getElementById('lightbox')
    if (!m) return null
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    return { mask: r(m), img: r(m.querySelector('img')), counter: (m.querySelector('.lightbox-counter') || {}).textContent || '', navPrev: r(m.querySelector('.lightbox-prev')), navNext: r(m.querySelector('.lightbox-next')), save: r(m.querySelector('.lightbox-save')) }
  })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(500)

  // 5) 空态：切到无插图会话（长标题会话）
  await selectSession(win, 'demo3')
  await win.waitForTimeout(700)
  measures.push(await measure(win, 'classic-dark-empty'))
  await shot('05-classic-dark-empty-longtitle')
  // 6) 无消息会话的空态
  await selectSession(win, 'demo4')
  await win.waitForTimeout(600)
  await shot('06-classic-dark-empty-nomsg')

  // 7) 浅色 · 羊皮纸
  await win.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    c.theme = 'light'; c.palette = 'paper'; localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  })
  await win.reload(); await win.waitForTimeout(600); await passSplash(win)
  await openGallery(win)
  await selectSession(win, 'demo1')
  await win.waitForTimeout(700)
  measures.push(await measure(win, 'classic-light-1440'))
  await shot('07-classic-light-1440')
  await win.locator('.gallery-card').first().hover()
  await win.waitForTimeout(600)
  await shot('08-classic-light-hover')
  await closeGallery(win)

  // 8) 窄窗口：抽屉占满宽度时的网格与工具条（先切回深色，否则标签与实况不符）
  await win.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    c.theme = 'dark'; c.palette = 'classic'; localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  })
  await win.reload(); await win.waitForTimeout(600); await passSplash(win)
  await win.setViewportSize({ width: 900, height: 820 })
  await win.waitForTimeout(600)
  await openGallery(win)
  measures.push(await measure(win, 'classic-dark-900'))
  await shot('09-classic-dark-900')
  await win.setViewportSize({ width: 720, height: 800 })
  await win.waitForTimeout(600)
  measures.push(await measure(win, 'classic-dark-720'))
  await shot('10-classic-dark-720')
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForTimeout(600)
  await closeGallery(win)

  // 9) 原型方案 · 深色（切方案会整页重载：必须重新取窗口引用 + 过 splash）
  await win.evaluate(() => window.api.setUiScheme('proto')).catch(() => {})
  await win.waitForTimeout(2500)
  win = await app.firstWindow()
  await passSplash(win)
  await win.waitForTimeout(600)
  await openGallery(win)
  await selectSession(win, 'demo1')
  measures.push(await measure(win, 'proto-dark-1440'))
  await shot('11-proto-dark-1440')
  await win.locator('.gallery-card').first().hover()
  await win.waitForTimeout(600)
  await shot('12-proto-dark-hover')
  await closeGallery(win)
  // 恢复经典，避免污染测试档
  await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
  await win.waitForTimeout(1800)

  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify({ measures, lightbox: lb }, null, 2))
  console.log('measurements -> ' + path.join(OUT, 'measurements.json'))
  await app.close()
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

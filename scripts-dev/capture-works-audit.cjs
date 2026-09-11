/* 作品面板验收脚本：画廊瘦身 + 作品菜单 + 闪卡图鉴独立面板 + 漫画分幕侧栏
 * 播种真实卡片（走 cardWrite 落盘，验证 sixworlds-asset 预览链路）与漫画分镜，
 * 逐项测量并截图。运行：node scripts-dev/capture-works-audit.cjs（SIXWORLDS_TEST=1）
 */
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const OUT = path.join(__dirname, '..', 'output', 'works-audit')
fs.mkdirSync(OUT, { recursive: true })

function gradientPngScript() {
  // 在渲染层用 canvas 生成一张 1024×1536 渐变 PNG（卡面/分镜占位素材）
  return `(function () {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1536
    const d = c.getContext('2d')
    const g = d.createLinearGradient(0, 0, 1024, 1536)
    g.addColorStop(0, '#2b1f3a'); g.addColorStop(.5, '#8a4d3f'); g.addColorStop(1, '#e8a45c')
    d.fillStyle = g; d.fillRect(0, 0, 1024, 1536)
    d.fillStyle = 'rgba(255,255,255,.85)'; d.font = '700 180px serif'; d.textAlign = 'center'
    d.fillText('HOLO', 512, 800)
    return c.toDataURL('image/png')
  })()`
}

async function passSplash(w) {
  try { await w.waitForSelector('#splash.ready', { timeout: 20000, state: 'attached' }) } catch { return }
  try { await w.locator('#splash').click({ force: true, timeout: 5000 }) } catch { }
  await w.waitForTimeout(800)
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

  // ---- 播种：8 张插图的会话 + 漫画分镜（2 已画 / 1 未画）+ 3 张闪卡（真实落盘） ----
  const seed = await win.evaluate(async (pngScript) => {
    const png = eval(pngScript)
    const now = Date.now()
    const ws = JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1'
    const msgs = []
    for (let i = 0; i < 8; i++) {
      msgs.push({ role: 'user', content: '第' + (i + 1) + '回合：继续前进。', at: now - (9 - i) * 36e5 })
      msgs.push({ role: 'assistant', content: '【甲龙历 407.03.0' + (i + 1) + '｜清晨】第 ' + (i + 1) + ' 回合的叙事正文，你沿着村道往前走。', at: now - (9 - i) * 36e5, illust: png, illustAt: now - (9 - i) * 36e5 })
    }
    const comic = {
      version: 1, createdAt: now - 864e5, updatedAt: now,
      cast: [{ name: '主角', look: '黑发少年' }],
      progress: { state: 'done', done: 2, failed: 0 },
      panels: [
        { idx: 0, turn: 1, title: '清晨的到访', sceneLine: '【甲龙历407.03.01｜布耶纳村】', narration: '晨雾还挂在麦田上。', participants: ['主角'], illust: png, illustAsset: null, illustAt: now, illustPending: false, illustError: null },
        { idx: 1, turn: 2, title: '集市上的罗盘', sceneLine: '【甲龙历407.03.02｜集市】', narration: '摊主掀开绒布。', participants: ['主角'], illust: png, illustAsset: null, illustAt: now, illustPending: false, illustError: null },
        { idx: 2, turn: 3, title: '后山的低语', sceneLine: '【甲龙历407.03.03｜后山】', narration: '林子深处有声音。', participants: ['主角'], illust: null, illustAsset: null, illustAt: null, illustPending: false, illustError: null }
      ]
    }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'd1', ws, title: '《布耶纳村的清晨》', createdAt: now - 864e5, updatedAt: now,
      messages: msgs, comic, cards: []
    }]))
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.ifhint-seen.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentSessionId: 'd1', theme: 'dark', palette: 'classic', illustAuto: false }))
    // 3 张真实闪卡落盘（验证 sixworlds-asset://holo/card/<id>/background.png 预览）
    const cards = []
    for (let i = 0; i < 3; i++) {
      const cardId = 'card-works' + i + '-' + Math.random().toString(36).slice(2, 7)
      const cfg = {
        title: ['主角', '灰袍法师', '老锻炉'][i], subtitle: ['转生少年', '北地来客', '村中铁匠'][i],
        technique: ['剑术', '秘法', '锻造'][i], tagline: '命运的相遇', edition: '00' + (i + 1) + ' / 003',
        collection: '六面世界 · 全息典藏', description: '测试卡',
        assets: { model: './card.glb', subject: './subject.png', background: './background.png', text: './text.png' },
        parameters: { subjectScale: 1.25, subjectDepth: 0.28, backgroundDepth: -0.2, foil: 0.6 },
        safeArea: { scale: 1.12, offset: [-0.06, -0.085] }
      }
      const r = await window.api.cardWrite({ cardId, config: cfg, layers: { subject: png, background: png, text: png } })
      if (r && r.ok) cards.push({ cardId, name: cfg.title, rarity: ['SSR', 'SR', 'R'][i], subtitle: cfg.subtitle, layered: true, subjectMode: 'transparent', createdAt: now - i * 36e5 })
    }
    // 把卡片元数据写回会话
    const sessions = JSON.parse(localStorage.getItem('sixworlds.sessions.v2'))
    sessions[0].cards = cards
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify(sessions))
    await window.api.saveSessions(sessions)
    return cards.length
  }, gradientPngScript())
  console.log('seeded cards:', seed)

  await win.reload(); await win.waitForTimeout(600)
  await passSplash(win)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center() })
  await win.waitForTimeout(700)

  const measures = {}
  const shot = async (n) => { await win.screenshot({ path: path.join(OUT, n + '.png') }); console.log('shot ' + n) }

  // ---- 1) 画廊瘦身 + 行高修复 ----
  await win.evaluate(() => document.getElementById('btn-gallery').click())
  await win.waitForTimeout(1200)
  measures.gallery = await win.evaluate(() => {
    const tb = document.querySelector('.gallery-toolbar')
    const body = document.getElementById('gallery-body')
    const media = document.querySelector('.gallery-media')
    const card = document.querySelector('.gallery-card')
    const sel = document.getElementById('gallery-session')
    const rr = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }
    return {
      toolbarChildren: [...tb.children].map((c) => ({ tag: c.tagName, text: (c.textContent || '').trim().slice(0, 12), ...rr(c) })),
      selectW: sel ? Math.round(sel.getBoundingClientRect().width) : null,
      gridAutoRows: getComputedStyle(body).gridAutoRows,
      bodyScroll: { scrollH: body.scrollHeight, clientH: body.clientHeight },
      card: rr(card), media: rr(media),
      mediaAspect: media ? getComputedStyle(media).aspectRatio : null
    }
  })
  console.log('gallery:', JSON.stringify(measures.gallery))
  await shot('01-gallery-classic-dark')
  await win.evaluate(() => document.getElementById('btn-gallery-close').click())
  await win.waitForTimeout(500)

  // ---- 2) 作品菜单 ----
  await win.evaluate(() => document.getElementById('btn-works').click())
  await win.waitForTimeout(400)
  measures.worksPop = await win.evaluate(() => {
    const pop = document.getElementById('works-pop')
    return {
      visible: pop && !pop.classList.contains('hidden'),
      items: [...pop.querySelectorAll('.works-item')].map((b) => ({ name: b.querySelector('.works-item-name').textContent, sub: b.querySelector('.works-item-sub').textContent }))
    }
  })
  console.log('worksPop:', JSON.stringify(measures.worksPop))
  await shot('02-works-pop')

  // ---- 3) 闪卡图鉴独立面板 ----
  await win.evaluate(() => document.getElementById('works-holo').click())
  await win.waitForSelector('.holo-card-item', { timeout: 8000 }).catch(() => { })
  await win.waitForTimeout(1200)
  measures.holo = await win.evaluate(() => {
    const view = document.getElementById('holo-view')
    const imgs = [...document.querySelectorAll('.holo-card-img')]
    return {
      exists: !!view,
      sub: (document.querySelector('.holo-view-sub') || {}).textContent || '',
      cards: document.querySelectorAll('.holo-card-item').length,
      imgLoaded: imgs.map((i) => ({ complete: i.complete, w: i.naturalWidth })),
      wallCols: (() => { const items = [...document.querySelectorAll('.holo-card-item')]; return new Set(items.map((x) => Math.round(x.getBoundingClientRect().x))).size })()
    }
  })
  console.log('holo:', JSON.stringify(measures.holo))
  await shot('03-holo-view')
  // 删除确认框必须盖在面板之上（z-index 回归：曾把面板设 1520 盖住 1150 的确认框）
  await win.locator('.holo-card-actions button.del').first().click()
  await win.waitForTimeout(500)
  measures.holoConfirm = await win.evaluate(() => {
    const cm = document.querySelector('.confirm-mask')
    if (!cm) return { shown: false }
    const r = cm.getBoundingClientRect()
    return { shown: true, z: getComputedStyle(cm).zIndex, topEl: document.elementFromPoint(Math.round(r.width / 2), Math.round(r.height / 2))?.closest('.confirm-mask') ? 'confirm' : 'other' }
  })
  console.log('holoConfirm:', JSON.stringify(measures.holoConfirm))
  await shot('03b-holo-delete-confirm')
  await win.locator('.confirm-foot .cancel').click().catch(() => { })
  await win.waitForTimeout(400)

  // ---- 4) 漫画阅读器（分幕侧栏）----
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  await win.evaluate(() => document.getElementById('btn-works').click())
  await win.waitForTimeout(300)
  await win.evaluate(() => document.getElementById('works-comic').click())
  await win.waitForSelector('#comic-view', { timeout: 8000 }).catch(() => { })
  await win.waitForTimeout(800)
  measures.comic = await win.evaluate(() => ({
    exists: !!document.getElementById('comic-view'),
    rows: document.querySelectorAll('.comic-list-row').length,
    states: [...document.querySelectorAll('.comic-list-state')].map((s) => s.textContent),
    count: (document.querySelector('.comic-sidebar-count') || {}).textContent || '',
    hasSidebar: !!document.querySelector('.comic-sidebar')
  }))
  console.log('comic:', JSON.stringify(measures.comic))
  await shot('04-comic-view')
  // 点第 3 幕（未绘制）→ 跳到该幕
  await win.evaluate(() => { const rows = document.querySelectorAll('.comic-list-row'); if (rows[2]) rows[2].click() })
  await win.waitForTimeout(600)
  measures.comicJump = await win.evaluate(() => ({
    counter: (document.querySelector('.comic-counter') || {}).textContent || '',
    activeRow: (() => { const on = document.querySelector('.comic-list-row.on'); return on ? on.textContent : null })()
  }))
  console.log('comicJump:', JSON.stringify(measures.comicJump))
  await shot('05-comic-jump-3')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)

  // ---- 5) 原型方案：作品菜单 + 闪卡图鉴 ----
  await win.evaluate(() => window.api.setUiScheme('proto'))
  await win.waitForTimeout(2500)
  win = await app.firstWindow()
  await passSplash(win)
  await win.waitForTimeout(600)
  await win.evaluate(() => document.getElementById('btn-works').click())
  await win.waitForTimeout(400)
  await shot('06-proto-works-pop')
  await win.evaluate(() => document.getElementById('works-holo').click())
  await win.waitForSelector('.holo-card-item', { timeout: 8000 }).catch(() => { })
  await win.waitForTimeout(1000)
  await shot('07-proto-holo-view')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  // 空态：切到无卡会话？直接清空 cards 演示空态
  await win.evaluate(async () => {
    const r = await window.api.loadSessions()
    const ss = r.sessions || []
    if (ss[0]) { ss[0].cards = []; await window.api.saveSessions(ss) }
  })
  await win.evaluate(() => { window.api.setUiScheme('classic') })
  await win.waitForTimeout(2200)
  win = await app.firstWindow()
  await passSplash(win)
  await win.waitForTimeout(600)
  await win.evaluate(() => document.getElementById('btn-works').click())
  await win.waitForTimeout(300)
  await win.evaluate(() => document.getElementById('works-holo').click())
  await win.waitForTimeout(700)
  await shot('08-holo-empty')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(measures, null, 2))
  console.log('measures -> ' + path.join(OUT, 'measurements.json'))
  await app.close()
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

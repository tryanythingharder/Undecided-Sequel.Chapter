'use strict'

// 内核设计区布局审查：串行检查两套界面、两种明暗主题、六档宽度和主要流程层。
// 该脚本只使用测试 profile，不读取或输出任何密钥。
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'output', 'kernel-layout-audit')
const WIDTHS = [320, 375, 768, 1024, 1280, 1440]
const DESKTOP_HEIGHT = 820
const MOBILE_HEIGHT = 844
const SCHEME_FILE = path.join(process.env.APPDATA || path.join(require('node:os').homedir(), 'AppData', 'Roaming'), '六面世界', 'test-profile', 'ui-scheme.json')

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function setScheme(win, scheme) {
  const current = await win.evaluate(() => window.api.uiScheme()).catch(() => null)
  if (current === scheme) return win
  await win.evaluate((value) => window.api.setUiScheme(value), scheme).catch(() => {})
  await sleep(1900)
  return win
}

async function setTheme(win, theme) {
  await win.evaluate((value) => {
    const key = 'sixworlds.codex.state.v3'
    let cfg = {}
    try { cfg = JSON.parse(localStorage.getItem(key) || '{}') || {} } catch {}
    cfg.theme = value
    localStorage.setItem(key, JSON.stringify(cfg))
  }, theme)
  await win.reload()
  await sleep(1300)
}

async function openHub(win) {
  if (await win.locator('#kernel-hub').isHidden().catch(() => true)) {
    await win.click('#btn-kernel-hub')
    await sleep(220)
  }
}

async function setStage(win, stage) {
  await openHub(win)
  // 使用 DOM 的可见状态设置阶段；窄屏会隐藏桌面专用的后续步骤，
  // 直接点击会让 Playwright 等待不可见元素而失去审查覆盖率。
  await win.evaluate((value) => {
    const hub = document.querySelector('#kernel-hub')
    if (hub) hub.dataset.kernelStage = value
    const canvas = document.querySelector('.kernel-design-canvas')
    if (canvas) canvas.scrollTop = 0
    document.querySelectorAll('.kernel-rail-step').forEach((step) => step.classList.toggle('active', step.dataset.kernelStage === value))
  }, stage)
  await sleep(120)
}

async function rect(win, selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, display:cs.display, visibility:cs.visibility, position:cs.position, overflowX:cs.overflowX, overflowY:cs.overflowY, scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight }
  }, selector)
}

async function collect(app, win, scheme, theme, width, stage) {
  await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(size.width, size.width <= 600 ? 844 : 820); w.center() }, { width }).catch(() => {})
  await sleep(180)
  await setStage(win, stage)
  const result = await win.evaluate(({ scheme: s, theme: t, width: w, stage: st }) => {
    const names = {
      hub: '#kernel-hub', canvas: '.kernel-design-canvas', rail: '.kernel-design-rail',
      heading: '.kernel-design-heading', welcome: '#kernel-welcome-page', editor: '#kernel-editor-stage',
      progress: '.kernel-progress-track', ai: '.kernel-ai-pane', messages: '.kernel-ai-messages',
      checkpoint: '#kernel-checkpoint', quick: '.kernel-ai-quick', composer: '.kernel-ai-composer',
      textarea: '#kernel-ai-input', send: '#btn-kernel-ai-send', library: '#kernel-library-drawer',
      scrim: '#kernel-layer-scrim', source: '#kernel-editor-pane', sourceBar: '.kernel-source-bar',
      sourceWorkspace: '.kernel-source-workspace', audit: '#kernel-audit-pane'
    }
    const out = { scheme:s, theme:t, width:w, stage:st, viewport:{ width:innerWidth, height:innerHeight }, body:{ scrollWidth:document.body.scrollWidth, clientWidth:document.body.clientWidth, scrollHeight:document.body.scrollHeight, clientHeight:document.body.clientHeight }, elements:{} }
    Object.entries(names).forEach(([key, sel]) => {
      const el = document.querySelector(sel)
      if (!el) return
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      out.elements[key] = { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, display:cs.display, visibility:cs.visibility, position:cs.position, overflowX:cs.overflowX, overflowY:cs.overflowY, scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight }
    })
    const e = out.elements
    const outside = []
    Object.entries(e).forEach(([key, r]) => {
      if (r.display === 'none' || r.visibility === 'hidden' || r.width <= 0 || r.height <= 0) return
      // 普通文档流内容允许超过视口边界，由其父滚动容器承载；只把定位层的越界视为问题。
      if (r.position === 'static') return
      if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) outside.push(key)
    })
    out.outsideViewport = outside
    out.internalOverflow = Object.entries(e).filter(([, r]) => r.display !== 'none' && (r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1)).map(([key]) => key)
    const intersects = (a, b) => a && b && Math.max(a.left,b.left) < Math.min(a.right,b.right) && Math.max(a.top,b.top) < Math.min(a.bottom,b.bottom)
    out.composerCoversCheckpoint = intersects(e.composer, e.checkpoint)
    out.composerCoversQuick = intersects(e.composer, e.quick)
    out.themeAttr = document.documentElement.getAttribute('data-theme')
    out.hubStageAttr = document.querySelector('#kernel-hub')?.dataset.kernelStage || ''
    return out
  }, { scheme, theme, width, stage })
  if ((width === 320 || width === 1280) && (stage === 'welcome' || stage === 'intent')) {
    fs.mkdirSync(OUT, { recursive:true })
    await win.screenshot({ path:path.join(OUT, `${scheme}-${theme}-${width}-${stage}.png`) })
  }
  return result
}

async function main() {
  fs.mkdirSync(OUT, { recursive:true })
  const previousScheme = fs.existsSync(SCHEME_FILE) ? fs.readFileSync(SCHEME_FILE, 'utf8') : null
  const app = await electron.launch({ executablePath:electronExecutable, args:['.'], cwd:ROOT, env:{ ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS:'true', SIXWORLDS_TEST:'1' } })
  let win = await app.firstWindow()
  await sleep(1200)
  const result = []
  for (const scheme of ['classic','proto']) {
    win = await setScheme(win, scheme)
    for (const theme of ['dark','light']) {
      await setTheme(win, theme)
      const stages = scheme === 'classic' ? ['welcome','intent','shape','rules','test','release'] : ['intent']
      for (const stage of stages) {
        for (const width of WIDTHS) result.push(await collect(app, win, scheme, theme, width, stage))
      }
      for (const layer of ['library','source']) {
        await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 820); w.center() }).catch(() => {})
        await sleep(160)
        await openHub(win)
        await win.click(layer === 'library' ? '#btn-kernel-library' : '#btn-kernel-source')
        await sleep(180)
        const snap = await win.evaluate(({ scheme:s, theme:t, layer:l }) => {
          const pick = (sel) => { const el=document.querySelector(sel); if(!el) return null; const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:cs.display,visibility:cs.visibility,position:cs.position,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight} }
          return { scheme:s, theme:t, width:innerWidth, height:innerHeight, layer:l, bodyScrollWidth:document.body.scrollWidth, bodyClientWidth:document.body.clientWidth, hub:pick('#kernel-hub'), scrim:pick('#kernel-layer-scrim'), library:pick('#kernel-library-drawer'), source:pick('#kernel-editor-pane'), workspace:pick('.kernel-source-workspace'), audit:pick('#kernel-audit-pane') }
        }, { scheme, theme, layer })
        result.push(snap)
        await win.keyboard.press('Escape')
      }
    }
  }
  // Restore the previously selected UI scheme when the audit finishes.
  const restore = previousScheme && /"scheme"\s*:\s*"proto"/.test(previousScheme) ? 'proto' : 'classic'
  win = await setScheme(win, restore)
  await app.close()
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(result, null, 2), 'utf8')
  const problems = result.filter((x) => x.outsideViewport?.length || x.composerCoversCheckpoint || x.composerCoversQuick || x.bodyScrollWidth > x.bodyClientWidth + 1)
  console.log(JSON.stringify({ total:result.length, problems:problems.length, report:path.join(OUT,'report.json'), examples:problems.slice(0, 20) }, null, 2))
  process.exit(problems.length ? 2 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })

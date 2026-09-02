'use strict'
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'output', 'kernel-scheme-audit')

async function launch(scheme) {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1200)
  await win.evaluate(async (target) => {
    if ((await window.api.uiScheme()) !== target) await window.api.setUiScheme(target)
  }, scheme).catch(() => {})
  await win.waitForTimeout(1800)
  return { app, win }
}

async function captureScheme(scheme) {
  const { app, win } = await launch(scheme)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 820); w.center() })
  await win.waitForTimeout(250)
  await win.click('#btn-kernel-hub')
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(OUT, `${scheme}-design.png`) })
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(OUT, `${scheme}-library.png`) })
  await win.click('#btn-kernel-library-close')
  await win.click('#btn-kernel-source')
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(OUT, `${scheme}-source.png`) })
  const wide = await win.evaluate(() => ({
    entry: location.pathname.replace(/\\/g, '/'),
    theme: document.documentElement.getAttribute('data-theme'),
    hub: (() => { const r = document.querySelector('#kernel-hub').getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height } })(),
    design: (() => { const r = document.querySelector('.kernel-design-canvas').getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height } })(),
    source: (() => { const r = document.querySelector('#kernel-editor-pane').getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height } })()
  }))
  await win.keyboard.press('Escape')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(390, 844); w.center() })
  await win.waitForTimeout(350)
  await win.click('#btn-kernel-hub')
  await win.waitForTimeout(350)
  await win.screenshot({ path: path.join(OUT, `${scheme}-design-mobile.png`) })
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(OUT, `${scheme}-library-mobile.png`) })
  await win.keyboard.press('Escape')
  await win.click('#btn-kernel-source')
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(OUT, `${scheme}-source-mobile.png`) })
  await win.keyboard.press('Escape')
  const mobile = await win.evaluate(() => ({
    inner: { width: innerWidth, height: innerHeight },
    bodyScrollWidth: document.body.scrollWidth,
    hub: (() => { const r = document.querySelector('#kernel-hub').getBoundingClientRect(); return { left:r.left,right:r.right,width:r.width,height:r.height } })(),
    heading: (() => { const r = document.querySelector('.kernel-design-heading').getBoundingClientRect(); return { left:r.left,right:r.right,width:r.width,height:r.height } })(),
    ai: (() => { const r = document.querySelector('.kernel-ai-pane').getBoundingClientRect(); return { left:r.left,right:r.right,width:r.width,height:r.height } })(),
    send: (() => { const r = document.querySelector('#btn-kernel-ai-send').getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height } })()
  }))
  await app.close()
  return { wide, mobile }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const result = {}
  for (const scheme of ['classic', 'proto']) result[scheme] = await captureScheme(scheme)
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })

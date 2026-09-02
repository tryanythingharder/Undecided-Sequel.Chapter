'use strict'
const path = require('node:path')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')
const ROOT = path.join(__dirname, '..')

async function main() {
  const app = await electron.launch({ executablePath: electronExecutable, args: ['.'], cwd: ROOT, env: { ...process.env, SIXWORLDS_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  let win = await app.firstWindow(); await win.waitForTimeout(1000)
  const out = []
  for (const scheme of ['classic', 'proto']) {
    const current = await win.evaluate(() => window.api.uiScheme()).catch(() => 'classic')
    if (current !== scheme) {
      await win.evaluate((value) => window.api.setUiScheme(value), scheme).catch(() => {})
      await win.waitForTimeout(1800); win = await app.firstWindow()
    }
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 820); w.center() })
    await win.waitForTimeout(220); await win.click('#btn-kernel-hub'); await win.waitForTimeout(180)
    for (const factor of [1, 1.5, 2]) {
      await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), factor)
      await win.waitForTimeout(180)
      await win.evaluate(() => { const canvas = document.querySelector('.kernel-design-canvas'); if (canvas) canvas.scrollTop = 0 })
      out.push(await win.evaluate(({ scheme: s, factor: f }) => {
        const visible = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, display:c.display, visibility:c.visibility } }
        return { scheme:s, factor:f, viewport:{ width:innerWidth, height:innerHeight }, body:{ scrollWidth:document.body.scrollWidth, clientWidth:document.body.clientWidth }, canvas:visible('.kernel-design-canvas'), heading:visible('.kernel-design-heading'), progress:visible('.kernel-progress-track'), ai:visible('.kernel-ai-pane'), composer:visible('.kernel-ai-composer') }
      }, { scheme, factor }))
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await win.keyboard.press('Escape')
  }
  await app.close(); console.log(JSON.stringify(out, null, 2))
}
main().catch((error) => { console.error(error); process.exit(1) })

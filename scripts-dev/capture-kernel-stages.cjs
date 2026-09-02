'use strict'
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'output', 'kernel-stage-review')

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const app = await electron.launch({ executablePath: electronExecutable, args: ['.'], cwd: ROOT, env: { ...process.env, SIXWORLDS_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  let win = await app.firstWindow()
  await win.waitForTimeout(1100)
  const current = await win.evaluate(() => window.api.uiScheme()).catch(() => 'classic')
  if (current !== 'classic') {
    await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
    await win.waitForTimeout(1800)
    win = await app.firstWindow()
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 820); w.center() })
  await win.waitForTimeout(220)
  await win.click('#btn-kernel-hub')
  await win.waitForTimeout(250)
  for (const theme of ['dark', 'light']) {
    await win.evaluate((value) => {
      const key = 'sixworlds.codex.state.v3'; let cfg = {}
      try { cfg = JSON.parse(localStorage.getItem(key) || '{}') || {} } catch {}
      cfg.theme = value; localStorage.setItem(key, JSON.stringify(cfg))
    }, theme)
    await win.reload(); await win.waitForTimeout(700); await win.click('#btn-kernel-hub'); await win.waitForTimeout(220)
    for (const stage of ['welcome', 'intent', 'shape', 'rules', 'test', 'release']) {
      await win.evaluate((value) => {
        const hub = document.querySelector('#kernel-hub'); if (hub) hub.dataset.kernelStage = value
        document.querySelectorAll('.kernel-rail-step').forEach((s) => s.classList.toggle('active', s.dataset.kernelStage === value))
      }, stage)
      await win.waitForTimeout(120)
      await win.screenshot({ path: path.join(OUT, `classic-${theme}-${stage}.png`) })
    }
  }
  await app.close()
}
main().catch((error) => { console.error(error); process.exit(1) })

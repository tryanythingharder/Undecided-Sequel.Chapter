/* 真实测试 · 查看器窗口专项验证（复用已生成的卡，不再花钱生图）
 * 打开沙盒应用 → cardWindow → 捕获查看器 console / WebGL canvas / readPixels 亮像素。 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')

function log(...a) { console.log('[viewer]', ...a) }

async function main() {
  const cardDir = path.join(SANDBOX_APPDATA, '六面世界', 'holo-cards')
  const cards = fs.readdirSync(cardDir).filter((d) => /^card-/.test(d))
  if (!cards.length) throw new Error('沙盒内没有已生成的卡')
  const cardId = cards[0]
  log('复用卡：', cardId)

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(__dirname, 'realtest-entry.cjs'), '--disable-gpu-shader-disk-cache'], cwd: ROOT,
    env: { ...process.env, APPDATA: SANDBOX_APPDATA, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(4000)
  // 等 boot 完（真实路径有 splash）
  await win.locator('#splash').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await win.waitForTimeout(1500)

  // 直接开查看器
  const r = await win.evaluate(async (cid) => window.api.cardWindow({ cardId: cid }), cardId).catch((e) => ({ err: String(e) }))
  log('cardWindow 返回：', JSON.stringify(r).slice(0, 120))

  let viewer = null
  for (let i = 0; i < 60; i++) {
    const ws = app.windows()
    viewer = ws.find((w) => w.url().includes('holo/viewer') || w.url().includes('holo/index.html'))
    if (viewer) break
    await new Promise((s) => setTimeout(s, 250))
  }
  if (!viewer) throw new Error('查看器窗口 15s 未出现')
  log('查看器窗口：', viewer.url().slice(-70))

  // 捕获 console / pageerror
  const errors = []
  viewer.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 200)) })
  viewer.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)))

  // 等到 canvas 出现（最长 30s——首次 Three.js 编译 shader 可能慢）
  let canvasInfo = null
  for (let i = 0; i < 30; i++) {
    const has = await viewer.evaluate(() => {
      const cv = document.querySelector('canvas')
      return cv ? { w: cv.width, h: cv.height, rects: cv.getClientRects().length } : null
    }).catch(() => null)
    if (has && has.w > 0) { canvasInfo = has; break }
    await new Promise((s) => setTimeout(s, 1000))
  }
  log('canvas：', JSON.stringify(canvasInfo), 'console错误数：', errors.length)
  if (errors.length) log('console 前几条：', errors.slice(0, 5).join(' || ').slice(0, 400))

  if (canvasInfo) {
    await viewer.waitForTimeout(3000)
    const px = await viewer.evaluate(() => {
      const cv = document.querySelector('canvas')
      const gl = cv.getContext('webgl2') || cv.getContext('webgl')
      if (!gl) return { err: 'no-gl' }
      const w = Math.min(gl.drawingBufferWidth, 400), h = Math.min(gl.drawingBufferHeight, 400)
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(Math.floor(gl.drawingBufferWidth / 2 - w / 2), Math.floor(gl.drawingBufferHeight / 2 - h / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let lit = 0, rs = 0, gs = 0, bs = 0
      for (let i = 0; i < buf.length; i += 4) {
        const l = buf[i] + buf[i + 1] + buf[i + 2]
        if (l > 30) { lit++; rs += buf[i]; gs += buf[i + 1]; bs += buf[i + 2] }
      }
      return { lit: +(lit / (w * h) * 100).toFixed(1), avg: lit ? [Math.round(rs / lit), Math.round(gs / lit), Math.round(bs / lit)] : null }
    }).catch((e) => ({ err: String(e).slice(0, 100) }))
    log('readPixels：', JSON.stringify(px))
    await viewer.screenshot({ path: path.join(ROOT, 'test-shots', 'realtest-3-viewer.png') }).catch(() => {})
    log('查看器验证', px && px.lit > 1 ? 'PASS（亮像素 ' + px.lit + '%）' : 'FAIL ' + JSON.stringify(px))
  } else {
    log('查看器验证 FAIL：canvas 30s 未出现')
    await viewer.screenshot({ path: path.join(ROOT, 'test-shots', 'realtest-3-viewer-blank.png') }).catch(() => {})
  }
  await app.close().catch(() => {})
  process.exit(0)
}

main().catch((e) => { console.error('[viewer] FATAL', e); process.exit(2) })

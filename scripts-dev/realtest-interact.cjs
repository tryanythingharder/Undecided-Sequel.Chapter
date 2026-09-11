/* 交互探针：沙盒查看器逐个按钮点击 → __holo.getState + readPixels 变化 + 截图，判定按钮是否真的工作 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')
const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')

async function main() {
  const cardDir = path.join(SANDBOX_APPDATA, '六面世界', 'holo-cards')
  const cardId = fs.readdirSync(cardDir).filter((d) => /^card-/.test(d))[0]
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(__dirname, 'realtest-entry.cjs')], cwd: ROOT,
    env: { ...process.env, APPDATA: SANDBOX_APPDATA, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(4000)
  await win.locator('#splash').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await win.evaluate((cid) => window.api.cardWindow({ cardId: cid }), cardId)
  let viewer = null
  for (let i = 0; i < 60; i++) {
    viewer = app.windows().find((w) => w.url().includes('holo/viewer'))
    if (viewer) break
    await new Promise((s) => setTimeout(s, 250))
  }
  await viewer.waitForSelector('canvas', { timeout: 20000 })
  await viewer.waitForTimeout(3000)

  const readPixels = () => viewer.evaluate(() => {
    const cv = document.querySelector('canvas')
    const gl = cv.getContext('webgl2') || cv.getContext('webgl')
    if (!gl) return { err: 'no-gl' }
    const w = Math.min(gl.drawingBufferWidth, 300), h = Math.min(gl.drawingBufferHeight, 300)
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2 - w / 2), Math.floor(gl.drawingBufferHeight / 2 - h / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    let lit = 0, rs = 0, gs = 0, bs = 0
    for (let i = 0; i < buf.length; i += 4) { const l = buf[i] + buf[i + 1] + buf[i + 2]; if (l > 30) { lit++; rs += buf[i]; gs += buf[i + 1]; bs += buf[i + 2] } }
    return { lit: +(lit / (w * h) * 100).toFixed(1), avg: lit ? [Math.round(rs / lit), Math.round(gs / lit), Math.round(bs / lit)] : null }
  })
  const state = () => viewer.evaluate(() => window.__holo && window.__holo.getState ? window.__holo.getState() : null).catch(() => null)

  const results = []
  const snap = async (label) => results.push({ label, state: await state(), px: await readPixels().catch((e) => ({ err: String(e).slice(0, 60) })) })
  await snap('初始')
  await viewer.screenshot({ path: path.join(ROOT, 'test-shots', 'itx-0-initial.png') }).catch(() => {})

  // 1) 翻面按钮
  await viewer.click('#flip')
  await viewer.waitForTimeout(1800)
  await snap('点击flip后')
  await viewer.screenshot({ path: path.join(ROOT, 'test-shots', 'itx-1-flip.png') }).catch(() => {})
  await viewer.click('#flip')
  await viewer.waitForTimeout(1800)
  await snap('再点flip回正')

  // 2) 自动旋转
  await viewer.click('#auto')
  await viewer.waitForTimeout(2500)
  await snap('点击auto后')
  await viewer.screenshot({ path: path.join(ROOT, 'test-shots', 'itx-2-auto.png') }).catch(() => {})

  // 3) 重置
  await viewer.click('#reset')
  await viewer.waitForTimeout(1500)
  await snap('点击reset后')

  // 4) front/back 按钮与 view-label 同步
  await viewer.click('#back')
  await viewer.waitForTimeout(1800)
  const backLabel = await viewer.evaluate(() => document.querySelector('#view-label').textContent).catch(() => null)
  results.push({ label: '点击back后view-label', state: await state(), viewLabel: backLabel })
  await viewer.screenshot({ path: path.join(ROOT, 'test-shots', 'itx-3-back.png') }).catch(() => {})
  await viewer.click('#front')
  await viewer.waitForTimeout(1800)
  results.push({ label: '点击front回正', state: await state() })

  // 5) 参数面板（珠光/银箔）
  const finishBtn = await viewer.$('[data-finish="silver"]').catch(() => null)
  if (finishBtn) {
    await finishBtn.click()
    await viewer.waitForTimeout(1000)
    await snap('切银箔后')
  } else {
    results.push({ label: 'data-finish 按钮', note: '未找到（可能 HTML 无此按钮）' })
  }

  // 6) 拖拽模拟（pointer 序列）
  const before = await state()
  await viewer.mouse.move(500, 400)
  await viewer.mouse.down()
  for (let i = 0; i < 10; i++) await viewer.mouse.move(500 + i * 18, 400 - i * 6)
  await viewer.mouse.up()
  await viewer.waitForTimeout(1200)
  results.push({ label: '拖拽后', state: await state(), before })

  console.log(JSON.stringify(results, null, 1))
  await app.close().catch(() => {})
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })

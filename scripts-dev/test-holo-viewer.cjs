#!/usr/bin/env node
'use strict'
/* holo 查看器渲染冒烟测试(开发工具,不入 run-tests 主套件——headless Chromium 的
 * 截图合成链路读不到 WebGL buffer,但 readPixels 立即读有效;真实 Electron 有 GPU)。
 * 判定:__holo.ready && 帧缓冲中央橙(主体)/蓝(背景)色彩占比 > 阈值。
 * 前置:renderer/holo/card.glb 已由 build-holo-glb.cjs 生成;测试卡由本脚本自造。 */
const { chromium } = require('playwright')
const http = require('http')
const path = require('path')
const fs2 = require('fs')
const zlib = require('zlib')

const REPO = path.join(__dirname, '..')
const CARD_DIR = path.join(REPO, 'test-shots', 'holo-card-test')
const PORT = 8321

/* ---- 无依赖 PNG 写出(4bit 色块测试图层) ---- */
function chunkOf() {
  const t = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const tt = Buffer.from(type, 'ascii')
    let crc = 0xFFFFFFFF
    for (const b of Buffer.concat([tt, data])) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8)
    crc = (crc ^ 0xFFFFFFFF) >>> 0
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc)
    return Buffer.concat([len, tt, data, cb])
  }
}
const chunk = chunkOf()
function png(w, h, pixel) {
  const raw = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4)
    for (let x = 0; x < w; x++) { const p = pixel(x, y); row[1+x*4] = p[0]; row[2+x*4] = p[1]; row[3+x*4] = p[2]; row[4+x*4] = p[3] }
    raw.push(row)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))), chunk('IEND', Buffer.alloc(0))])
}
function makeTestCard() {
  const W = 256, H = 384
  fs2.mkdirSync(CARD_DIR, { recursive: true })
  fs2.writeFileSync(path.join(CARD_DIR, 'subject.png'), png(W, H, (x, y) => (x > W*0.25 && x < W*0.75 && y > H*0.15 && y < H*0.85) ? [200, 120, 60, 255] : [0, 0, 0, 0]))
  fs2.writeFileSync(path.join(CARD_DIR, 'background.png'), png(W, H, () => [40, 60, 120, 255]))
  fs2.writeFileSync(path.join(CARD_DIR, 'text.png'), png(W, H, (x, y) => (y > H*0.7 && x > W*0.1 && x < W*0.9) ? [244, 208, 135, 255] : [0, 0, 0, 0]))
  fs2.writeFileSync(path.join(CARD_DIR, 'lineart.png'), png(W, H, () => [255, 255, 255, 0]))
  fs2.copyFileSync(path.join(REPO, 'renderer', 'holo', 'card.glb'), path.join(CARD_DIR, 'card.glb'))
  fs2.writeFileSync(path.join(CARD_DIR, 'card-config.json'), JSON.stringify({
    title: '测试角色', subtitle: '测试称号', technique: '测试招式', tagline: '测试一句话',
    edition: '001 / 001', collection: '六面世界测试', description: '渲染链路验证卡。',
    assets: { model: './card.glb', subject: './subject.png', background: './background.png', text: './text.png', lineart: './lineart.png' },
    parameters: { subjectScale: 1.25, subjectDepth: 0.28, backgroundDepth: -0.2, foil: 0.65 },
    safeArea: { scale: 1.12, offset: [-0.06, -0.085] }
  }, null, 2))
}

function startServer() {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' }
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0])
    if (p === '/') p = '/renderer/holo/index.html'
    const file = path.join(REPO, p)
    if (!file.startsWith(REPO) || !fs2.existsSync(file) || !fs2.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs2.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

async function main() {
  makeTestCard()
  const server = await startServer()
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
  let failed = false
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('http://127.0.0.1:' + PORT + '/renderer/holo/index.html?card=/test-shots/holo-card-test')
    const ready = await page.waitForFunction(() => window.__holo && window.__holo.ready, null, { timeout: 20000 }).then(() => true).catch(() => false)
    console.log((ready ? 'PASS' : 'FAIL') + '  holo-ready')
    if (!ready) { console.log('errors:', errors.slice(0, 3).join(' | ')); failed = true; process.exitCode = 1; return }
    // 帧缓冲色彩断言:主体橙 / 背景蓝均应可见(视差分层合成生效)
    const px = await page.evaluate(() => {
      const r = window.__holo.renderer
      const gl = r.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let dark = 0, orange = 0, blue = 0, n = 0
      for (let y = Math.floor(h*0.2); y < h*0.8; y += 4) for (let x = Math.floor(w*0.35); x < w*0.65; x += 4) {
        const i = ((y*w)+x)*4
        const rr = buf[i], gg = buf[i+1], bb = buf[i+2]
        n++
        if (rr+gg+bb < 90) dark++
        if (rr>150 && gg>80 && gg<190 && bb<110) orange++
        if (bb>90 && bb>rr+25) blue++
      }
      return { dark: dark/n, orange: orange/n, blue: blue/n }
    })
    console.log('readPixels 中央: dark=' + px.dark.toFixed(2) + ' orange=' + px.orange.toFixed(2) + ' blue=' + px.blue.toFixed(2))
    console.log((px.orange > 0.15 && px.blue > 0.4 ? 'PASS' : 'FAIL') + '  card-rendered(橙主体+蓝背景分层可见)')
    if (!(px.orange > 0.15 && px.blue > 0.4)) { failed = true; process.exitCode = 1 }
  } finally {
    await browser.close()
    server.close()
    if (!failed) console.log('=== holo 查看器渲染冒烟通过 ===')
  }
}
main().catch((e) => { console.error(e); process.exit(1) })

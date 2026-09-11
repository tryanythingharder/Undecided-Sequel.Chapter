/* 给已有真实卡补 lineart 层（不重新生图）：读卡目录 PNG → deriveLineart 同款算法（Node 版）→ 写 lineart.png + 改 config */
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const CARD = path.join(ROOT, 'test-shots', 'realtest-appdata', '六面世界', 'holo-cards', 'card-mtsxyy8v-xaldcn')

// PNG 解码：用 ffmpeg 转灰度 raw（零依赖，机器上已验证可用）
function pngToGray(pngPath, w, h) {
  const out = pngPath + '.gray'
  execSync(`ffmpeg -y -v error -i "${pngPath}" -vf format=gray -frames:v 1 -f rawvideo "${out}"`)
  const b = fs.readFileSync(out)
  return b.slice(0, w * h) // gray8 每像素 1 字节
}

// PNG 尺寸读取
function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

// 最小 PNG 编码器（灰度 → RGBA PNG， zlib 级 0 由 node:zlib 提供）
const zlib = require('node:zlib')
function crc32(buf) {
  let c, table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function grayToPng(gray, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8bit 灰度
  // 行前缀 0（无滤波）+ 灰度数据
  const raw = Buffer.alloc(h * (w + 1))
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; gray.copy(raw, y * (w + 1) + 1, y * w, y * w + w) }
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ])
}

const subjPng = path.join(CARD, 'subject.png')
const { w: W, h: H } = pngSize(subjPng)
console.log('subject.png:', W + 'x' + H)
// alpha 通道：ffmpeg rgba → 取第 4 字节
const rgbaOut = subjPng + '.rgba'
execSync(`ffmpeg -y -v error -i "${subjPng}" -vf format=rgba -frames:v 1 -f rawvideo "${rgbaOut}"`)
const rgba = fs.readFileSync(rgbaOut).slice(0, W * H * 4)

// deriveLineart 的 Node 版（与 shared/holo-card.js 同算法）：Sobel(亮度×alpha) + alpha 边缘
const lum = (p) => (rgba[p * 4] * 0.299 + rgba[p * 4 + 1] * 0.587 + rgba[p * 4 + 2] * 0.114) * (rgba[p * 4 + 3] / 255)
const aAt = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? 0 : rgba[(y * W + x) * 4 + 3]
const gray = Buffer.alloc(W * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = y * W + x
    const i = p * 4
    const gx = -lum(p - 1 - W) - 2 * lum(p - 1) - lum(p - 1 + W) + lum(p + 1 - W) + 2 * lum(p + 1) + lum(p + 1 + W)
    const gy = -lum(p - W) - 2 * lum(p - W + 1) - lum(p - W + 2) + lum(p + W) + 2 * lum(p + W + 1) + lum(p + W + 2)
    let g = Math.sqrt(gx * gx + gy * gy)
    const aEdge = Math.max(Math.abs(aAt(x, y) - aAt(x + 1, y)), Math.abs(aAt(x, y) - aAt(x, y + 1)), Math.abs(aAt(x, y) - aAt(x - 1, y)), Math.abs(aAt(x, y) - aAt(x, y - 1)))
    if (aEdge > 40) g = Math.max(g, 90)
    gray[p] = g > 60 ? 0 : 255
  }
}
fs.writeFileSync(path.join(CARD, 'lineart.png'), grayToPng(gray, W, H))
let dark = 0
for (let i = 0; i < gray.length; i++) if (gray[i] < 128) dark++
console.log('lineart.png 写出，线条像素占比', (dark / gray.length * 100).toFixed(2) + '%（目标 1-8% 稀疏线稿）')

// config 补 lineart 资产
const cfgPath = path.join(CARD, 'card-config.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
cfg.assets.lineart = './lineart.png'
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
console.log('card-config.json 已补 lineart')
// 清理临时
fs.rmSync(subjPng + '.gray', { force: true }); fs.rmSync(rgbaOut, { force: true })
console.log('DONE')

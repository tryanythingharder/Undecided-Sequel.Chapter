// 图标生成（方案3）：离屏窗口里用 <img> 加载 SVG → canvas 绘制 → toDataURL → 多尺寸 PNG → ICO
// 用法：node_modules\.bin\electron.cmd scripts-dev\gen-icon.cjs
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  await app.whenReady()
  // 图标源：build/icon.svg（扁平六面立方体）
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  const imgSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const srcName = 'icon.svg'
  const win = new BrowserWindow({
    show: false, width: 300, height: 300,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const html = '<!doctype html><html><body style="margin:0"><script>\n' +
    'window.__done = new Promise((resolve) => {\n' +
    '  const img = new Image();\n' +
    '  img.onload = () => {\n' +
    '    const out = {};\n' +
    '    for (const s of ' + JSON.stringify(SIZES) + ') {\n' +
    '      const c = document.createElement("canvas");\n' +
    '      c.width = s; c.height = s;\n' +
    '      const ctx = c.getContext("2d");\n' +
    '      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";\n' +
    '      ctx.drawImage(img, 0, 0, s, s);\n' +
    '      out[s] = c.toDataURL("image/png");\n' +
    '    }\n' +
    '    resolve(out);\n' +
    '  };\n' +
    '  img.onerror = () => resolve(null);\n' +
    '  img.src = ' + JSON.stringify(imgSrc) + ';\n' +
    '});\n</script></body></html>'
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const result = await win.webContents.executeJavaScript('window.__done')
  win.destroy()
  if (!result) { console.error('canvas rendering failed'); app.quit(); process.exit(1) }

  const pngs = {}
  for (const s of SIZES) {
    pngs[s] = Buffer.from(String(result[s]).split(',')[1], 'base64')
  }
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), pngs[256])

  // 打包 ICO（Vista+ PNG 帧）
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(SIZES.length, 4)
  const entries = []
  const datas = []
  let offset = 6 + 16 * SIZES.length
  for (const s of SIZES) {
    const data = pngs[s]
    const e = Buffer.alloc(16)
    e.writeUInt8(s >= 256 ? 0 : s, 0)
    e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    datas.push(data)
    offset += data.length
  }
  const ico = Buffer.concat([header, ...entries, ...datas])
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), ico)
  console.log('OK source:', srcName, '| icon.ico bytes:', ico.length, '| icon.png bytes:', pngs[256].length)
  app.quit()
}

main().catch((e) => { console.error(e); app.quit(); process.exit(1) })

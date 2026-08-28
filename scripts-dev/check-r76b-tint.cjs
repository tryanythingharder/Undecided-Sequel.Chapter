// R76b：取样验证浅色主题聊天舞台是否为净白（Codex 式冷白 #fafaf8）
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'

async function main() {
  const { chromium } = require(PLAYWRIGHT)
  const browser = await chromium.launch()
  const page = await browser.newPage()

  async function sample(file) {
    await page.goto('file:///' + file.replace(/\\/g, '/'))
    // 等图加载
    await page.waitForFunction(() => { const i = document.querySelector('img'); return i && i.complete && i.naturalWidth > 0 })
    return await page.evaluate(() => {
      const img = document.querySelector('img')
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      // 消息列在窗口水平中部偏左（侧栏占左侧），取多行多点取样
      const w = c.width, h = c.height
      const pts = [
        [Math.round(w * .52), Math.round(h * .30)],
        [Math.round(w * .60), Math.round(h * .45)],
        [Math.round(w * .52), Math.round(h * .62)],
        [Math.round(w * .45), Math.round(h * .20)],
        [Math.round(w * .70), Math.round(h * .55)],
      ]
      return pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)))
    })
  }

  for (const f of ['r76-main-light.png', 'r76-main-dark.png']) {
    const px = await sample(path.join(__dirname, 'shot-r76', f))
    console.log(f)
    px.forEach((rgb, i) => {
      const warm = rgb[0] - rgb[2] // r-b 差值：>12 视为明显暖色
      console.log(`  pt${i + 1} rgb(${rgb.join(',')})  warmth=${warm}`)
    })
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })

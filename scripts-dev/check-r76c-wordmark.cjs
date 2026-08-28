// R76c：验证 splash 字标「自己的故事」——取样找金色点缀(#d8c486±)与白色流光字
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'

async function main() {
  const { chromium } = require(PLAYWRIGHT)
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const files = process.argv.slice(2)
  for (const f of (files.length ? files : ['r76-splash-2.png'])) {
    await page.goto('file:///' + path.join(__dirname, 'shot-r76', f).replace(/\\/g, '/'))
    await page.waitForFunction(() => { const i = document.querySelector('img'); return i && i.complete && i.naturalWidth > 0 })
    const stats = await page.evaluate(() => {
      const img = document.querySelector('img')
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      // 扫画面中央竖带（lockup 所在区域），统计亮白字像素与金色像素
      let gold = 0, brightText = 0, total = 0
      for (let y = Math.round(c.height * .18); y < c.height * .62; y += 2) {
        for (let x = Math.round(c.width * .22); x < c.width * .88; x += 2) {
          const [r, gg, b] = g.getImageData(x, y, 1, 1).data
          total++
          if (Math.abs(r - 216) < 40 && Math.abs(gg - 196) < 40 && r >= gg && gg - b > 26) gold++
          if (r > 235 && gg > 235 && b > 225) brightText++
        }
      }
      return { gold, brightText, total }
    })
    console.log(f, JSON.stringify(stats), stats.gold > 40 ? 'GOLD:PASS' : 'GOLD:MISS', stats.brightText > 400 ? 'TEXT:PASS' : 'TEXT:MISS')
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })

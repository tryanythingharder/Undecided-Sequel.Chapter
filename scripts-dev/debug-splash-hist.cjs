// 调试：打印 splash-2 中央带颜色直方图
const path = require('node:path')
const { chromium } = require('C:/Users/Administrator/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright')

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('file:///' + path.resolve('scripts-dev/shot-r76/r76-splash-2.png').replace(/\\/g, '/'))
  await page.waitForFunction(() => { const i = document.querySelector('img'); return i && i.complete })
  const s = await page.evaluate(() => {
    const img = document.querySelector('img')
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const buckets = {}
    for (let y = Math.round(c.height * .18); y < c.height * .62; y += 2) {
      for (let x = Math.round(c.width * .30); x < c.width * .70; x += 2) {
        const [r, gg, bb] = g.getImageData(x, y, 1, 1).data
        if (r < 60 && gg < 60 && bb < 70) continue
        const k = Math.round(r / 40) + ',' + Math.round(gg / 40) + ',' + Math.round(bb / 40)
        buckets[k] = (buckets[k] || 0) + 1
      }
    }
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 14)
  })
  console.log(JSON.stringify(s))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })

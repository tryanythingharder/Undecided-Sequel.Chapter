const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const OUT = 'D:\\代码\\测试\\无职转生\\design-prompts\\Design Light Theme\\shots'
require('node:fs').mkdirSync(OUT, { recursive: true })
async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1120, height: 700 }, deviceScaleFactor: 2 })
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  // 主界面浅色（App 直接进 main）
  await page.screenshot({ path: OUT + '/opt-main-light.png' })
  // 触发插图完成态灵动岛
  await page.click('text=岛·插图完成')
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT + '/opt-island-image-light.png' })
  // 触发生成中
  await page.click('text=岛·生成中')
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT + '/opt-island-busy-light.png' })
  // 滚到中部看插图/搜索高亮演示
  const flow = await page.$('.msg-flow')
  if (flow) await flow.evaluate(el => el.scrollTop = 900)
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/opt-mid-light.png' })
  // 深色主题
  await page.click('text=深色模式')
  await page.waitForTimeout(700)
  const flow2 = await page.$('.msg-flow')
  if (flow2) await flow2.evaluate(el => el.scrollTop = 0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT + '/opt-main-dark.png' })
  // 播放入场动画并截关键帧
  await page.click('text=播放入场动画')
  await page.waitForTimeout(700)
  await page.screenshot({ path: OUT + '/opt-splash-1.png' })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: OUT + '/opt-splash-2.png' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: OUT + '/opt-splash-3.png' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT + '/opt-splash-4.png' })
  await page.click('#splash, body') // 点击进入
  await page.mouse.click(560, 350)
  await page.waitForTimeout(900)
  await page.screenshot({ path: OUT + '/opt-after-enter.png' })
  await browser.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })

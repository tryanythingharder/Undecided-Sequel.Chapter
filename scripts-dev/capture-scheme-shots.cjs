// 实机截图：经典方案与原型工作台方案（含主题抽屉的「界面方案」分区）。
// 用法：node scripts-dev/capture-scheme-shots.cjs
const path = require('path')
const fs = require('fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'output', 'ui-scheme')

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1800)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)

  // 经典方案
  await win.screenshot({ path: path.join(OUT, 'classic-content.png') })
  await win.click('#btn-theme')
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(OUT, 'classic-theme-drawer.png') })

  // 切到原型工作台
  await win.click('[data-ui-scheme="proto"]')
  await win.waitForTimeout(2500)
  await win.screenshot({ path: path.join(OUT, 'proto-content.png') })
  await win.click('#btn-theme')
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(OUT, 'proto-theme-drawer.png') })
  // 原型方案切回经典（验证抽屉磁贴工作）
  await win.click('[data-ui-scheme="classic"]')
  await win.waitForTimeout(2500)
  const backClassic = await win.evaluate(() => !!document.querySelector('#sidebar') && !document.querySelector('.command-dock'))
  console.log(backClassic ? 'PASS switch-back-via-drawer' : 'FAIL switch-back-via-drawer')
  // 收尾恢复经典
  await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
  await win.waitForTimeout(1500)
  await app.close()
  console.log('screenshots in ' + OUT)
  process.exit(backClassic ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })

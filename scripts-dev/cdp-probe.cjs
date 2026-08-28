// 验证：stdio:'ignore' 启动 electron + CDP 连接截图（绕过沙盒的管道限制）
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)

const ELECTRON = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
const CWD = path.join(__dirname, '..')
const PORT = 9333

function waitPort(port, timeoutMs) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 500 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error('port timeout'))
        else setTimeout(tick, 300)
      })
    }
    tick()
  })
}

async function main() {
  const child = spawn(ELECTRON, ['--remote-debugging-port=' + PORT, '.'], {
    cwd: CWD, stdio: 'ignore', detached: false,
    env: { ...process.env, SIXWORLDS_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  await waitPort(PORT, 20000)
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT)
  const ctx = browser.contexts()[0]
  const page = ctx.pages().find((p) => p.url().includes('index.html')) || ctx.pages()[0]
  await page.waitForTimeout(1500)
  console.log('TITLE=', await page.title())
  await page.screenshot({ path: path.join(__dirname, 'cdp-probe.png') })
  console.log('PROBE_OK')
  await browser.close()
  child.kill()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

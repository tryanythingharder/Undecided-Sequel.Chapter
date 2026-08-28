// 验证测试档案隔离（优雅退出版）：真实 profile 写标记 → 跑测试脚本（隔离 profile）→ 重开真实 profile 确认标记还在
// 注意：Playwright 的 app.close() 是硬杀进程（不刷盘），必须点应用的 ✕ 按钮优雅退出
const path = require('node:path')
const { spawn } = require('node:child_process')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

function launchReal() {
  return electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } // 不带 SIXWORLDS_TEST → 真实档案
  })
}

// 优雅退出：点窗口 ✕，等待进程自然结束
async function quitGracefully(app, win) {
  const exited = new Promise((resolve) => {
    app.process().once('exit', resolve)
    setTimeout(resolve, 10000)
  })
  await win.click('#btn-close')
  await exited
}

async function main() {
  // 1. 真实档案写入标记
  let app = await launchReal()
  let win = await app.firstWindow()
  await win.waitForTimeout(2000)
  await win.evaluate(() => localStorage.setItem('sixworlds.isolation.check', 'USER-DATA'))
  await quitGracefully(app, win)

  // 2. 跑一个会 clear localStorage 的测试脚本（SIXWORLDS_TEST=1 → test-profile）
  const r = await new Promise((resolve) => {
    const p = spawn('node', [path.join(__dirname, 'test-sessions.cjs')], { stdio: 'pipe' })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('close', (c) => resolve({ code: c, out }))
  })
  console.log('test-sessions exit:', r.code, /ALL_PASS/.test(r.out) ? '(ALL_PASS)' : '(FAIL?)')

  // 3. 重开真实档案：标记必须还在（证明测试没碰真实数据）
  app = await launchReal()
  win = await app.firstWindow()
  await win.waitForTimeout(2000)
  const marker = await win.evaluate(() => localStorage.getItem('sixworlds.isolation.check'))
  console.log('marker after test run:', JSON.stringify(marker))
  // 清理标记
  await win.evaluate(() => localStorage.removeItem('sixworlds.isolation.check'))
  await quitGracefully(app, win)
  console.log(marker === 'USER-DATA' ? 'ISOLATION_OK' : 'ISOLATION_BROKEN')
  process.exit(marker === 'USER-DATA' ? 0 : 1)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

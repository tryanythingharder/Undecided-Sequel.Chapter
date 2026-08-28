// 探针：复现 Playwright electron.launch 失败，转储进程事件与输出
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

async function main() {
  try {
    const app = await electron.launch({
      executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.'], cwd: path.join(__dirname, '..'),
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' },
      timeout: 20000,
    })
    console.log('LAUNCH_OK')
    const win = await app.firstWindow()
    console.log('WINDOW_OK title=' + (await win.title()))
    await app.close()
    console.log('CLOSE_OK')
  } catch (e) {
    console.log('LAUNCH_FAIL: ' + e.message)
    process.exit(1)
  }
}
main()
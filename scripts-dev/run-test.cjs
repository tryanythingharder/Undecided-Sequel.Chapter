// 测试运行器 wrapper：清掉沙箱强制注入的 ELECTRON_RUN_AS_NODE（DSH 会话环境自带，
// 会导致 Playwright 启动的 electron.exe 退化为纯 Node 模式而 "Process failed to launch"）
// 用法: node scripts-dev/run-test.cjs <script.cjs>
const { spawn } = require('node:child_process')
const path = require('node:path')
const script = process.argv[2]
if (!script) { console.error('usage: node scripts-dev/run-test.cjs <script.cjs>'); process.exit(2) }
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const p = spawn(process.execPath, [path.resolve(__dirname, script)], {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
})
p.on('exit', (c) => process.exit(c || 0))

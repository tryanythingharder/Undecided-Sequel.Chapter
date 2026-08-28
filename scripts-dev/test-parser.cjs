const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const SAMPLES = [
  // 格式1 【A】...
  '【甲龙历 407.01.01｜清晨】你醒了。\n【A】接受委托（获报酬人脉但被监视）【B】拒绝\n【C】私下调查',
  // 格式2 【需要决定】 A. ...
  '你叫什么名字？你是什么人？\n【需要决定】 A. 我是本地农户家的孩子 B. 我是商人之子 C. 我是孤儿',
  // 格式3 行首 A. 列表
  '请选择你的天赋：\nA. 普通\nB. 良好\nC. 优秀\nD. 特殊（须附代价）',
]

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(2000)
  // expose parser by reading app.js function through page context is not trivial; instead re-implement by executing the actual function source
  const src = await win.evaluate(() => {
    // parse is inside an IIFE; replicate exact function from file by injecting
    return null
  })
  // Simpler: read the file, strip IIFE wrapper, eval to get parseChoices
  const fs = require('node:fs')
  const file = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8')

  // Extract the parseChoices function source via regex (works since it's a top-level function inside the IIFE)
  const fnMatch = file.match(/function parseChoices\(text\) \{[\s\S]*?\n  \}/)
  if (!fnMatch) { console.log('FAIL parser source not found'); await app.close(); return }
  // evaluate it inside the page context
  const fnSource = fnMatch[0]
  let pass = true
  for (let i = 0; i < SAMPLES.length; i++) {
    const res = await win.evaluate(([fnSrc, text]) => {
      try { const fn = eval('(' + fnSrc + ')'); return { ok: true, data: fn(text) } } catch (e) { return { ok: false, err: String(e) } }
    }, [fnSource, SAMPLES[i]])
    const got = (res && res.ok && res.data) || []
    const keys = got.map((c) => c.key).join('')
    // 第一个样例期待 ABC，第二个至少 C（可能全 3 个），第三个期待 ABCD
    const expect = i === 0 ? 'ABC' : (i === 1 ? 'ABC' : 'ABCD')
    const found = keys === expect || (i === 1 && keys.includes('A') && keys.includes('B'))
    console.log((found ? 'PASS' : 'FAIL') + '  sample' + (i + 1) + '  keys=[' + keys + ']  ' + JSON.stringify(got).slice(0, 140))
    if (!found) pass = false
  }
  await app.close()
  console.log('==== parser ' + (pass ? 'PASS' : 'FAIL') + ' ====')
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

// R77：开场动画「每次启动必出 · 点击进入」真机验证（不用 SIXWORLDS_TEST，等同打包后的真实运行路径）
// 流程：两次冷启动（同一独立 userData 档案，模拟用户日常反复打开）：
//   第 N 次启动 → 启动即可见 #splash 五层舞台 → 等待主词定格(.ready) → 点击画面中心 → 动画离场(#splash 移除) → 主界面输入框可用
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const checks = []
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra || '' })
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

async function once(n, userDataDir) {
  let app = null
  try {
    app = await electron.launch({
      executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
      // 关键：不带 SIXWORLDS_TEST —— 与打包后行为一致；--user-data-dir 隔离档案，绝不触碰真实配置
      args: ['.', '--user-data-dir=' + userDataDir],
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    })
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    // ① 启动即出现开场动画（且未被 e2e 分支移除）
    const early = await win.evaluate(() => {
      const s = document.getElementById('splash')
      return { exists: !!s, testMode: !!(window.api && window.api.isTest), dust: !!document.getElementById('splash-dust') }
    })
    check('第' + n + '次启动：开场动画出现', early.exists && !early.testMode,
      'testMode=' + early.testMode)
    check('第' + n + '次启动：五层舞台粒子画布存在', early.dust)

    fs.mkdirSync(path.join(__dirname, 'shot-r77'), { recursive: true })
    await win.waitForTimeout(900).catch(() => {})
    if (early.exists) {
      try { await win.screenshot({ path: path.join(__dirname, 'shot-r77', 'splash-run' + n + '.png') }) } catch {}
    }

    // ② 主词定格（约 2.6s 加 .ready）前点击不进入：在窗口刚就绪时先点一次中心
    const earlyClickBlocked = await win.evaluate(() => new Promise((res) => {
      const s = document.getElementById('splash')
      if (!s) return res(false)
      const before = s.isConnected
      s.click()
      setTimeout(() => res(before && s.isConnected && !s.classList.contains('exiting')), 300)
    }))
    check('第' + n + '次启动：定格(2.6s)前点击不进入', earlyClickBlocked)

    // ③ 等 .ready 后点击进入
    await win.waitForFunction(() => document.getElementById('splash')?.classList.contains('ready'), null, { timeout: 9000 })
      .catch(() => {})
    const clickRes = await win.evaluate(() => new Promise((res) => {
      const s = document.getElementById('splash')
      if (!s || !s.classList.contains('ready')) return res({ ready: false })
      s.click()
      const t0 = Date.now()
      const timer = setInterval(() => {
        const gone = !document.getElementById('splash')
        const inputReady = !!document.querySelector('#input, .composer-box')
        if ((gone && inputReady) || Date.now() - t0 > 2500) {
          clearInterval(timer)
          res({ gone, inputReady, ms: Date.now() - t0 })
        }
      }, 60)
    }))
    check('第' + n + '次启动：定格后点击触发离场', clickRes.ready === true ? true : clickRes.gone,
      'gone=' + clickRes.gone)
    check('第' + n + '次启动：主界面可达（输入框已挂载）', !!clickRes.inputReady, 'ms=' + clickRes.ms)
  } finally {
    if (app) { try { await app.close() } catch { try { app.process().kill() } catch {} } }
  }
}

;(async () => {
  const dir = path.join(os.tmpdir(), 'sixworlds-r77-splash-profile')
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  await once(1, dir)   // 首次（全新档案）
  await once(2, dir)   // 再次启动（同档案，模拟日常第二次打开）
})().then(() => {
  const pass = checks.filter((c) => c.ok).length
  console.log('\nPROBE R77 SPLASH-EVERY-START: ' + pass + '/' + checks.length +
    (pass === checks.length ? ' RESULT ALL PASS' : ' RESULT FAIL'))
  process.exit(pass === checks.length ? 0 : 1)
}).catch((e) => { console.error('FATAL', e); process.exit(1) })

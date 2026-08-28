// R77b：打包产物真机验证 —— 启动 dist\win-unpacked\六面世界.exe（不带任何测试标记），
// CDP 远程附加，两次冷启动断言「开场动画必出 · 点击进入主界面」。
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn, execSync } = require('node:child_process')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)

const EXE = path.join(__dirname, '..', 'dist', 'win-unpacked', '六面世界.exe')
const PORT = 9799
const checks = []
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra || '' })
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

async function once(n) {
  const userDataDir = path.join(os.tmpdir(), 'sixworlds-r77b-pkg-run' + n)
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  const child = spawn(EXE, ['--user-data-dir=' + userDataDir, '--remote-debugging-port=' + PORT],
    { stdio: 'ignore', detached: false })
  try {
    let browser = null
    for (let i = 0; i < 60 && !browser; i++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    if (!browser) throw new Error('CDP connect failed')
    let win = null
    for (let i = 0; i < 40 && !win; i++) {
      for (const ctx of browser.contexts()) {
        const p = ctx.pages().find((x) => x.url().includes('index.html'))
        if (p) win = p
      }
      if (!win) await new Promise((r) => setTimeout(r, 250))
    }
    if (!win) throw new Error('index.html not found')

    const early = await win.evaluate(() => {
      const s = document.getElementById('splash')
      return { exists: !!s, testMode: !!(window.api && window.api.isTest) }
    })
    check('打包版第' + n + '次启动：开场动画出现', early.exists && !early.testMode, 'testMode=' + early.testMode)

    const blocked = await win.evaluate(() => new Promise((res) => {
      const s = document.getElementById('splash')
      if (!s) return res(false)
      s.click()
      setTimeout(() => res(s.isConnected && !s.classList.contains('exiting')), 300)
    }))
    check('打包版第' + n + '次启动：定格前点击不进入', blocked)

    await win.waitForFunction(() => document.getElementById('splash')?.classList.contains('ready'), null, { timeout: 9000 }).catch(() => {})
    const clickRes = await win.evaluate(() => new Promise((res) => {
      const s = document.getElementById('splash')
      if (!s || !s.classList.contains('ready')) return res({ gone: false, inputReady: false })
      s.click()
      const t0 = Date.now()
      const timer = setInterval(() => {
        const gone = !document.getElementById('splash')
        const inputReady = !!document.querySelector('#input, .composer-box')
        if ((gone && inputReady) || Date.now() - t0 > 2500) { clearInterval(timer); res({ gone, inputReady }) }
      }, 60)
    }))
    check('打包版第' + n + '次启动：点击触发离场', clickRes.gone)
    check('打包版第' + n + '次启动：主界面可达', !!clickRes.inputReady)

    await browser.close().catch(() => {})
  } finally {
    try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }) } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  }
}

;(async () => {
  await once(1)
  await once(2)
})().then(() => {
  const pass = checks.filter((c) => c.ok).length
  console.log('\nPROBE R77B PACKAGED SPLASH: ' + pass + '/' + checks.length +
    (pass === checks.length ? ' RESULT ALL PASS' : ' RESULT FAIL'))
  process.exit(pass === checks.length ? 0 : 1)
}).catch((e) => { console.error('FATAL', e); process.exit(1) })

// R79：验证「系统减动效不再杀死核心动效」——
// 用 CDP 将 prefers-reduced-motion 模拟为 reduce（对应用户 Windows 关闭动画效果的场景），
// 断言：开场动画仍显示、灵动岛呼吸/流光仍播放、过渡未被全局压成 .01ms。
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn, execSync } = require('node:child_process')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)

const ROOT = path.join(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9823
const checks = []
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok, extra: extra || '' })
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''))
}

;(async () => {
  const userDataDir = path.join(os.tmpdir(), 'sixworlds-r79-motion')
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  const child = spawn(ELECTRON, ['.', '--user-data-dir=' + userDataDir, '--remote-debugging-port=' + PORT],
    { cwd: ROOT, stdio: 'ignore', detached: false })
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

    // 模拟系统「关闭动画效果」
    await win.emulateMedia({ reducedMotion: 'reduce' })

    const envCheck = await win.evaluate(() => ({
      matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      testMode: !!(window.api && window.api.isTest)
    }))
    check('模拟环境生效：prefers-reduced-motion=reduce', envCheck.matches)
    check('非测试模式（splash 不被脚本移除）', !envCheck.testMode)

    const splash = await win.evaluate(() => {
      const s = document.getElementById('splash')
      if (!s) return { exists: false }
      const cs = getComputedStyle(s)
      // 容器自身无动画是正常的（词标序列都作用在子元素上），遍历子孙元素+伪元素取样
      const samples = []
      for (const el of [s].concat(Array.from(s.querySelectorAll('*')).slice(0, 40))) {
        const c = getComputedStyle(el)
        if (c.animationName && c.animationName !== 'none') {
          samples.push(c.animationName + '@' + String(c.animationDuration).split(',')[0])
        }
        for (const ps of ['::before', '::after']) {
          const p = getComputedStyle(el, ps)
          if (p.content && p.content !== 'none' && p.animationName && p.animationName !== 'none') {
            samples.push(p.animationName + '@' + String(p.animationDuration).split(',')[0] + ' ' + ps)
          }
        }
        if (samples.length >= 4) break
      }
      return { exists: true, display: cs.display, samples }
    })
    check('开场动画元素存在', splash.exists)
    check('开场动画未被隐藏（display≠none）', splash.exists && splash.display !== 'none',
      splash.exists ? 'display=' + splash.display : '')
    check('开场动画子元素动效仍在运行', splash.exists && splash.samples.length > 0,
      splash.exists ? 'samples=' + splash.samples.join(' | ').slice(0, 200) : '')

    // 灵动岛：注入独立 busy 元素，检查本体呼吸 + ::after 流光
    const island = await win.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'island-busy'
      el.id = 'probe-island'
      document.body.appendChild(el)
      const cs = getComputedStyle(el)
      const after = getComputedStyle(el, '::after')
      const out = {
        bodyAnim: cs.animationName,
        bodyDur: cs.animationDuration,
        afterAnim: after.animationName,
        afterDur: after.animationDuration
      }
      el.remove()
      return out
    })
    check('灵动岛：呼吸动画仍在运行', /island-breath/.test(island.bodyAnim),
      'anim=' + island.bodyAnim + ' dur=' + island.bodyDur)
    check('灵动岛：流光扫描仍在运行', /island-scan/.test(island.afterAnim),
      'anim=' + island.afterAnim + ' dur=' + island.afterDur)

    // 全局封锁已移除：常规按钮过渡时长不再是 .01ms
    const btn = await win.evaluate(() => {
      const b = document.querySelector('.tb-btn') || document.createElement('button')
      return String(getComputedStyle(b).transitionDuration || '')
    })
    check('通用 UI 过渡未被执行 .01ms 全局压缩', !btn.includes('0.01ms'), 'transition-duration=' + btn)

    await browser.close().catch(() => {})
  } finally {
    try { execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }) } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  }
})().then(() => {
  const pass = checks.filter((c) => c.ok).length
  console.log('\nPROBE R79 MOTION: ' + pass + '/' + checks.length +
    (pass === checks.length ? ' ALL-PASS' : ' HAS-FAIL'))
  process.exit(pass === checks.length ? 0 : 1)
}).catch((e) => { console.error('PROBE ERROR:', e.message); process.exit(2) })

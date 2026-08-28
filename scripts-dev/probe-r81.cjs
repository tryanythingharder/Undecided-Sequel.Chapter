/* R81 探针：①设置窗窗控钮几何（min/max/close 应贴右上角、44px 通高）②画廊打开→立即关闭时序 ③预设列表恢复七项 */
const path = require('path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron } = require(PLAYWRIGHT)

async function main() {
  const app = await _electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    env: Object.assign({}, process.env, { SIXWORLDS_TEST: '1' })
  })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(1200)

    // ---- A. 设置窗 ----
    await win.click('#btn-settings')
    await win.waitForTimeout(900)
    let sw = null
    for (const w of app.windows()) {
      if (/settings\.html/.test(w.url())) { sw = w; break }
    }
    if (!sw) throw new Error('设置窗口未找到')

    const openSize = await sw.evaluate(() => window.innerWidth + 'x' + window.innerHeight)
    console.log('OPEN_SIZE ' + openSize)

    const facts = await sw.evaluate(() => {
      const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
      return {
        min: r('btn-win-min'), max: r('btn-win-max'), close: r('btn-win-close'),
        innerW: window.innerWidth, winSize: window.innerWidth + 'x' + window.innerHeight,
        presetOpts: Array.from(document.querySelectorAll('#set-preset option')).map((o) => o.value).join('|')
      }
    })
    console.log('SETTINGS_FACTS ' + JSON.stringify(facts))
    const okClose = facts.close && facts.close.h === 44 && (facts.innerW - (facts.close.x + facts.close.w)) <= 2 && facts.close.y <= 2
    const okMin = facts.min && facts.min.h === 44
    const okOrder = facts.min && facts.max && facts.close && facts.min.x < facts.max.x && facts.max.x < facts.close.x
    console.log((okClose ? 'PASS' : 'FAIL') + ' close flush top-right h=44 (' + JSON.stringify(facts.close) + ')')
    console.log((okMin ? 'PASS' : 'FAIL') + ' min button 44px tall')
    console.log((okOrder ? 'PASS' : 'FAIL') + ' order min<max<close on one row')
    console.log((facts.presetOpts.split('|').length === 7 ? 'PASS' : 'FAIL') + ' presets restored to 7 options: ' + facts.presetOpts)

    // ---- B. 画廊：种子大量插图会话 → 打开 → 立刻关（120ms 内）→ 记录 hidden 耗时 ----
    await sw.evaluate(() => { const b = document.getElementById('btn-win-close'); if (b) b.click() }).catch(() => {})
    await win.waitForTimeout(700)

    // 取真实当前工作区 id
    const wsId = await win.evaluate(() => {
      const wss = JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')
      return (wss[0] && wss[0].id) || null
    })
    if (!wsId) throw new Error('无工作区')

    // 大 SVG base64 在 Node 侧生成，经 arg 传入
    const circles = Array.from({ length: 200 }, (_, i) => `<circle cx="${(i * 37) % 1000}" cy="${(i * 53) % 500}" r="9" fill="#fff3"/>`).join('')
    const bigSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#123"/><stop offset="1" stop-color="#f60"/></linearGradient></defs>' +
      `<rect width="1024" height="576" fill="url(#g)"/>${circles}</svg>`
    const b64 = 'data:image/svg+xml;base64,' + Buffer.from(bigSvg).toString('base64')

    await win.evaluate(([ws, src]) => {
      const msgs = []
      for (let i = 0; i < 12; i++) {
        const m = { role: i % 2 ? 'assistant' : 'user', content: `第${i}段测试文本，包含若干字符以形成摘录内容。` }
        if (i % 2 === 1) m.illust = src
        msgs.push(m)
      }
      const sess = [{ id: 'r81-sess-1', ws, title: 'R81 时序会话', messages: msgs, updatedAt: Date.now(), createdAt: Date.now() }]
      localStorage.setItem('sixworlds.sessions.v2', JSON.stringify(sess))
      return true
    }, [wsId, b64])

    await win.reload().catch(() => {})
    await win.waitForTimeout(1500)

    // 打开画廊并在 120ms 后立即点关闭（真实点击），统计到 [hidden] 的耗时
    const t0 = Date.now()
    await win.click('#btn-gallery')
    await win.waitForSelector('#gallery:not([hidden])', { timeout: 4000 })
    const openMs = Date.now() - t0
    await win.waitForTimeout(120) // 模拟用户“刚打开就点”
    const t1 = Date.now()
    await win.click('#btn-gallery-close').catch(() => {})
    let closedMs = -1
    try {
      await win.waitForSelector('#gallery[hidden]', { state: 'attached', timeout: 6000 })
      closedMs = Date.now() - t1
    } catch {}
    console.log('GALLERY_TIMING ' + JSON.stringify({ openMs, closedMs }))
    console.log((closedMs >= 0 && closedMs < 800 ? 'PASS' : 'FAIL') + ' immediate close works fast (' + closedMs + 'ms)')

    // 复开一次确认取消离场动画逻辑正常
    await win.click('#btn-gallery').catch(() => {})
    await win.waitForSelector('#gallery:not([hidden])', { timeout: 4000 })
    await win.waitForTimeout(400)
    const t2 = Date.now()
    await win.click('#btn-gallery-close').catch(() => {})
    let closed2Ms = -1
    try {
      await win.waitForSelector('#gallery[hidden]', { state: 'attached', timeout: 6000 })
      closed2Ms = Date.now() - t2
    } catch {}
    console.log('GALLERY_TIMING_2ND ' + JSON.stringify({ closed2Ms }))
    console.log((closed2Ms >= 0 && closed2Ms < 800 ? 'PASS' : 'FAIL') + ' reopen+close works fast (' + closed2Ms + 'ms)')

    const errors = []
    win.on('pageerror', (e) => errors.push(String(e)))
    await win.screenshot({ path: path.join(__dirname, '..', 'test-shots', 'r81-final.png') })
    await win.waitForTimeout(200)
    console.log((errors.length ? 'FAIL' : 'PASS') + ' no page errors' + (errors.length ? ': ' + errors.join('; ') : ''))
    console.log('DONE screenshots in test-shots/')
  } finally {
    await app.close().catch(() => {})
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })

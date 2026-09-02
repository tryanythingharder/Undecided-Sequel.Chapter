#!/usr/bin/env node
/*
 * bloub 机器人桌面 e2e：空状态活体机器人 + 生成期思考小机器人（真实 Electron 渲染）。
 * 前置：mock-server.cjs 同源逻辑内联启动（无真实 API key），SIXWORLDS_TEST=1 隔离档案。
 * 验证：
 *   1. 原型方案空会话：引导区挂载 svg.bloub-svg，逐帧动画（两帧 bodyPath 不同）
 *   2. 视线跟随：注入 pointermove 后眼睛矩阵变化
 *   3. 主题联动：body/眼洞填充走 var(--text)/var(--bg)（换主题即变色，不留硬编码色）
 *   4. 忙碌灵动岛：mock 回合期间岛内挂载思考机器人（svg 存在且随帧变化），结束移除
 *   5. 自清理：发起会话后空状态机器人随引导区移除
 * 用法：node scripts-dev/test-bloub-e2e.cjs
 */
const path = require('path')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.error('FAIL  ' + name + (extra ? '  ' + extra : '')) }
}

// 内联 mock 服务端（与 scripts-dev/mock-server.cjs 同语义，取流式叙事分支）
function startMock() {
  const reply = '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。\n\n「打扰了。」他的声音沙哑。\n\n【A】接过石片【B】婉拒'
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] }))
        return
      }
      if (req.url.endsWith('/chat/completions')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        let i = 0
        const timer = setInterval(() => { // 大块慢推：拉宽忙碌窗口，保证灵动岛断言不竞态
          if (i >= reply.length) {
            clearInterval(timer)
            res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          const piece = reply.slice(i, i + 4)
          i += 4
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
        }, 60)
        return
      }
      res.writeHead(404); res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function main() {
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  let win = await app.firstWindow()
  await win.waitForTimeout(2200)
  try { await win.evaluate(() => localStorage.clear()) } catch {}

  // 切到原型工作台（与 e2e 用户路径一致：setUiScheme 会让主进程 loadFile 到新入口，
  // 导航后旧页面句柄失效——需要重新取 firstWindow）
  await win.evaluate(() => window.api.setUiScheme('proto'))
  await win.waitForTimeout(1200)
  win = await app.firstWindow()
  await win.waitForTimeout(2600)

  // 注入可用配置（SIXWORLDS_TEST 下 apiKey 走 localStorage；kernel 用内置）
  await win.evaluate((b) => {
    const KEY = 'sixworlds.codex.state.v3'
    const cur = JSON.parse(localStorage.getItem(KEY) || '{}')
    cur.baseUrl = b; cur.apiKey = 'sk-mock'; cur.model = 'mock-chat'
    localStorage.setItem(KEY, JSON.stringify(cur))
    localStorage.removeItem('sixworlds.sessions.v2')
    localStorage.removeItem('sixworlds.sessions.db-migrated')
  }, base)
  await win.reload()
  await win.waitForTimeout(2600)

  // ---- 1. 空状态机器人挂载 + 逐帧动画 ----
  const sig = await win.evaluate(() => {
    const svg = document.querySelector('.empty-sigil .bloub-svg')
    if (!svg) return null
    const paths = svg.querySelectorAll('path')
    const body = svg.querySelector('defs mask path')
    return { aria: svg.getAttribute('aria-label'), d0: body ? body.getAttribute('d') : null, n: paths.length }
  })
  check('empty-bot-mounted', !!sig, JSON.stringify(sig))
  if (sig) {
    await win.waitForTimeout(600)
    const d1 = await win.evaluate(() => {
      const svg = document.querySelector('.empty-sigil .bloub-svg')
      const body = svg && svg.querySelector('defs mask path')
      return body ? body.getAttribute('d') : null
    })
    check('empty-bot-animates', sig.d0 !== null && d1 !== null && sig.d0 !== d1, '呼吸驱动 mask 主体逐帧变化')
  }

  // ---- 2. 视线跟随 ----
  // 时序敏感：待机循环含 thinking 等无脸段（mask 眼隐藏、不接管视线）——
  // 轮询等「眼睛可见」的 idle 段再派发光标，避免撞上无脸段假失败
  if (sig) {
    let eyeVisible = null
    for (let i = 0; i < 30; i++) {
      eyeVisible = await win.evaluate(() => {
        const svg = document.querySelector('.empty-sigil .bloub-svg')
        const e = svg.querySelector('defs mask path:nth-of-type(2)')
        return e && e.getAttribute('display') !== 'none' ? e.getAttribute('transform') : null
      })
      if (eyeVisible) break
      await win.waitForTimeout(300)
    }
    check('empty-bot-face-phase-reachable', !!eyeVisible, '待机循环出现有脸段（idle/wink/…）')
    if (eyeVisible) {
      await win.evaluate(() => {
        const r = document.querySelector('.empty-sigil').getBoundingClientRect()
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left - 300, clientY: r.top + 40, bubbles: true, pointerType: 'mouse' }))
      })
      // tour 以 1.1s easeOutQuint 推进，且需保持在有脸段——1.2s 后采样
      await win.waitForTimeout(1200)
      const after = await win.evaluate(() => {
        const svg = document.querySelector('.empty-sigil .bloub-svg')
        const e = svg.querySelector('defs mask path:nth-of-type(2)')
        return e ? e.getAttribute('transform') : null
      })
      check('empty-bot-gaze-follows', after !== null && after !== eyeVisible, '眼睛矩阵随光标更新')
    }
  }

  // ---- 3. 主题联动：身体/眼洞颜色随主题（每帧重读 CSS 变量；切主题后下一帧变色）----
  if (sig) {
    const readFills = () => win.evaluate(() => {
      const svg = document.querySelector('.empty-sigil .bloub-svg')
      const rect = svg.querySelector('rect[mask]')
      const body = [...svg.children].find((n) => n.tagName === 'g' && n.querySelector('path[d]'))
      const paper = body ? body.querySelector('path') : null
      const cs = getComputedStyle(document.documentElement)
      return {
        ink: rect ? rect.getAttribute('fill') : null,
        paper: paper ? paper.getAttribute('fill') : null,
        textVar: cs.getPropertyValue('--text').trim(),
        canvasVar: cs.getPropertyValue('--canvas').trim()
      }
    })
    const dark = await readFills()
    // 切浅色主题 → 等两帧 → 颜色应跟随（初始主题不定的环境下，先归一到 dark 再读）
    await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
    await win.waitForTimeout(400)
    const darkAgain = await readFills()
    await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
    await win.waitForTimeout(400)
    const light = await readFills()
    await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
    const themeOk = darkAgain.ink === darkAgain.textVar && darkAgain.paper === darkAgain.canvasVar
      && light.ink === light.textVar && light.paper === light.canvasVar && light.ink !== darkAgain.ink
    check('empty-bot-theme-adapts', themeOk,
      'dark ink=' + darkAgain.ink + '/paper=' + darkAgain.paper + ' → light ink=' + light.ink + '/paper=' + light.paper)
  }

  // ---- 4. mock 回合：忙碌岛思考机器人 ----
  await win.fill('#input', '自由探索清晨的村庄')
  await win.click('#btn-send')
  // 等忙碌岛出现（流式期间）
  let island = null
  for (let i = 0; i < 20; i++) {
    island = await win.evaluate(() => {
      const dot = document.querySelector('#island-busy .island-dot')
      return dot && dot.querySelector('.bloub-svg') ? { svg: true, host: dot.className } : null
    })
    if (island) break
    await win.waitForTimeout(150)
  }
  check('island-bot-mounted', !!(island && island.svg), '思考机器人随忙碌岛挂载 host=' + (island && island.host))
  if (island) {
    const bd0 = await win.evaluate(() => {
      const svg = document.querySelector('#island-busy .island-dot .bloub-svg')
      const body = svg && svg.querySelector('defs mask path')
      return body ? body.getAttribute('d') : null
    })
    await win.waitForTimeout(400)
    const bd1 = await win.evaluate(() => {
      const svg = document.querySelector('#island-busy .island-dot .bloub-svg')
      const body = svg && svg.querySelector('defs mask path')
      return body ? body.getAttribute('d') : null
    })
    check('island-bot-animates', bd0 !== null && bd1 !== null && bd0 !== bd1, 'thinking 三点脉动逐帧变化')
    // thinking 特征：body 变形为小圆点、无眼睛 mask 可见眼（maskEyes display:none 全部）
    const eyeHidden = await win.evaluate(() => {
      const svg = document.querySelector('#island-busy .island-dot .bloub-svg')
      const es = [...svg.querySelectorAll('defs mask path')].slice(1, 3)
      return es.every((e) => e.getAttribute('display') === 'none')
    })
    check('island-bot-thinking-pose', eyeHidden, 'thinking 无眼 + 中间点 morph（打字机三态）')
  }

  // ---- 5. 自清理：回合结束岛收起、空状态机器人随引导区移除 ----
  let done = false
  for (let i = 0; i < 40; i++) {
    done = await win.evaluate(() => !document.querySelector('#island-busy') && !!document.querySelector('.msg.assistant .msg-body'))
    if (done) break
    await win.waitForTimeout(250)
  }
  check('island-closes-after-round', done, '忙碌岛收纳、assistant 消息落账')
  const emptyGone = await win.evaluate(() => !document.querySelector('.empty-sigil .bloub-svg'))
  check('empty-bot-self-cleans', emptyGone, '离开空状态后机器人随引导区移除（rAF 停帧）')

  // ---- 回归：无残留全局循环（页面 rAF 数不应暴涨；通过二次进入空状态再离开验证可重复挂载）----
  await win.evaluate(() => localStorage.removeItem('sixworlds.sessions.v2'))
  await win.evaluate(() => location.reload())
  await win.waitForTimeout(2600)
  const again = await win.evaluate(() => !!document.querySelector('.empty-sigil .bloub-svg'))
  check('empty-bot-remounts', again, '空状态再次出现时机器人重新挂载')

  await app.close()
  mock.server.close()
  console.log('')
  console.log('bloub-e2e：' + pass + ' 通过，' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })

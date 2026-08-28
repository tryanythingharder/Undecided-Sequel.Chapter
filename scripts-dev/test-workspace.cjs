// 工作区体系 + 流式传输双验证
// A. 工作区：创建/切换/隔离/搜索作用域/IF线归属/删除/迁移/专属内核
// B. 流式：mock SSE 服务端分块下发，断言渲染层收到多批增量（逐字效果）
const path = require('node:path')
const http = require('node:http')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

// mock SSE 服务端：把回复拆成 N 块、间隔 120ms 下发
function startMock() {
  const chunks = ['【甲龙历 407.03.01｜清晨｜布耶纳村】', '你睁开眼，', '阳光透过木窗洒进房间，', '母亲在楼下呼唤你的名字。']
  const srv = http.createServer((req, res) => {
    if (req.url.includes('/chat/completions')) {
      let body = ''
      req.on('data', (d) => { body += d })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        let i = 0
        const t = setInterval(() => {
          if (i < chunks.length) {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + '\n\n')
            i++
          } else {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) + '\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
            clearInterval(t)
          }
        }, 120)
      })
    } else if (req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
    } else { res.writeHead(404); res.end() }
  })
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, chunks })))
}

async function main() {
  const mock = await startMock()
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1800)

  // ---- A1. 旧数据迁移：无 ws 的会话归入默认工作区 ----
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', title: '旧世界线一', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始', at: Date.now() }] },
      { id: 's2', title: '旧世界线二', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始', at: Date.now() }] }
    ]))
    localStorage.removeItem('sixworlds.workspaces.v1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ preset: 'custom', baseUrl: 'http://127.0.0.1:' + location.port0, apiKey: 'sk-x', model: 'm', currentWsId: null }))
  })
  await win.reload()
  await win.waitForTimeout(2000)
  check('ws-migration-visible', (await win.locator('.session-item').count()) === 2)
  const wsBtnText = await win.locator('#ws-name').textContent()
  check('ws-default-name', wsBtnText === '默认世界', wsBtnText)

  // ---- A2. 新建工作区（prompt 对话框）----
  await win.locator('#btn-ws').click()
  await win.waitForTimeout(300)
  check('ws-menu-opens', await win.locator('#ws-menu').isVisible())
  await win.locator('#ws-new').click()
  await win.waitForTimeout(400)
  check('ws-prompt-shown', await win.locator('.confirm-input').isVisible())
  await win.locator('.confirm-input').fill('魔法学院线')
  await win.locator('.confirm .primary').click()
  await win.waitForTimeout(600)
  check('ws-switched', (await win.locator('#ws-name').textContent()) === '魔法学院线')
  // 新工作区隔离：只有自动创建的一条新世界线
  check('ws-isolated-empty', (await win.locator('.session-item').count()) === 1)

  // ---- A3. 隔离：新会话只出现在当前工作区 ----
  await win.locator('#btn-new').click()
  await win.waitForTimeout(300)
  check('ws-new-session-added', (await win.locator('.session-item').count()) === 2)

  // ---- A4. 搜索作用域：本工作区没有旧会话的内容 ----
  await win.locator('#sb-search').fill('旧世界线')
  await win.waitForTimeout(300)
  check('ws-search-scoped', (await win.locator('.session-item').count()) === 0)

  // ---- A5. 切回默认工作区：旧会话还在，且工作区上下文恢复 ----
  await win.locator('#sb-search').press('Escape')
  await win.locator('#btn-ws').click()
  await win.waitForTimeout(300)
  await win.locator('#ws-menu-list .ws-menu-item').first().click()
  await win.waitForTimeout(600)
  check('ws-switch-back', (await win.locator('#ws-name').textContent()) === '默认世界')
  check('ws-back-sessions', (await win.locator('.session-item').count()) === 2)

  // ---- A6. 重命名 ----
  await win.locator('#btn-ws').click()
  await win.waitForTimeout(300)
  await win.locator('#ws-rename').click()
  await win.waitForTimeout(400)
  await win.locator('.confirm-input').fill('主线')
  await win.locator('.confirm .primary').click()
  await win.waitForTimeout(400)
  check('ws-renamed', (await win.locator('#ws-name').textContent()) === '主线')

  // ---- A7. IF 线留在母线工作区（数据层验证）----
  await win.evaluate(() => {
    const ss = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]')
    const wsId = JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0].id
    const src = ss.find((x) => x.ws === wsId && x.messages.length)
    const now = Date.now()
    ss.unshift({ id: 'ifline', ws: src.ws, title: 'IF · ' + src.title, messages: src.messages.slice(0), updatedAt: now, createdAt: now, ifFrom: src.id })
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify(ss))
  })
  await win.reload()
  await win.waitForTimeout(2000)
  const ifInRightWs = await win.evaluate(() => {
    const ss = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]')
    const ifLine = ss.find((x) => x.id === 'ifline')
    const shown = Array.from(document.querySelectorAll('.session-item')).map((el) => el.dataset.sid)
    return ifLine && shown.includes('ifline')
  })
  check('ws-if-line-belongs', ifInRightWs)

  // ---- A8. 删除工作区：其会话随之删除，其他工作区不受影响 ----
  await win.locator('#btn-ws').click()
  await win.waitForTimeout(300)
  // 菜单里第二项是魔法学院线
  const items = win.locator('#ws-menu-list .ws-menu-item')
  await items.nth(1).click()
  await win.waitForTimeout(500)
  await win.locator('#btn-ws').click()
  await win.waitForTimeout(300)
  await win.locator('#ws-del').click()
  await win.waitForTimeout(400)
  await win.locator('.confirm .danger, .confirm button.danger').last().click()
  await win.waitForTimeout(600)
  check('ws-deleted-back-to-first', (await win.locator('#ws-name').textContent()) === '主线')
  const afterDel = await win.evaluate(() => {
    const ss = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]')
    const ws = JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')
    return { wsCount: ws.length, remainingWsSessions: ss.filter((x) => x.ws === ws[0].id).length, orphaned: ss.filter((x) => !x.ws || !ws.some((w) => w.id === x.ws)).length }
  })
  check('ws-delete-removes-sessions', afterDel.wsCount === 1 && afterDel.orphaned === 0, JSON.stringify(afterDel))

  // ---- A9. 专属内核：kernel.md 绝对路径 → 状态显示"已加载·工作区" ----
  const kernelAbs = path.join(__dirname, '..', 'kernel.md')
  const fs = require('node:fs')
  if (fs.existsSync(kernelAbs)) {
    await win.evaluate((p) => {
      const ws = JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')
      ws[0].kernelPath = p
      localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify(ws))
    }, kernelAbs.replace(/\\/g, '\\\\'))
    await win.reload()
    await win.waitForTimeout(2200)
    const ks = await win.locator('#kernel-state').textContent()
    check('ws-kernel-override', ks === '已加载·工作区', ks)
    // 清除恢复全局
    await win.locator('#btn-ws').click()
    await win.waitForTimeout(300)
    await win.locator('#ws-kernel').click()
    await win.waitForTimeout(600)
    const ks2 = await win.locator('#kernel-state').textContent()
    check('ws-kernel-clear', ks2 === '已加载', ks2)
  } else {
    console.log('SKIP ws-kernel-override (kernel.md 不存在)')
  }

  // ---- B. 流式传输验证：分块增量到达 ----
  await win.evaluate((port) => {
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ preset: 'custom', baseUrl: 'http://127.0.0.1:' + port, apiKey: 'sk-x', model: 'mock-model', currentWsId: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1'))[0].id }))
  }, mock.port)
  await win.reload()
  await win.waitForTimeout(2000)
  // 发送一条（mock 会分 4 块、每块间隔 120ms 下发）
  const deltas = []
  await win.exposeFunction('__recordDelta', (t) => deltas.push(t))
  await win.evaluate(() => {
    window.__deltaCount = 0
    // 通过监听 DOM 变化近似检测增量渲染（每次 textContent 更新记一次时间）
    const target = document.getElementById('messages')
    window.__obs = new MutationObserver(() => { window.__deltaCount++ })
    window.__obs.observe(target, { childList: true, subtree: true, characterData: true })
  })
  await win.locator('#input').fill('开始冒险')
  await win.locator('#btn-send').click()
  // 等流式进行中采样（总时长 4×120ms + 余量，在 300ms 处应只见部分文本）
  await win.waitForTimeout(350)
  const midText = await win.evaluate(() => {
    const bodies = document.querySelectorAll('.msg.assistant .msg-body')
    const last = bodies[bodies.length - 1]
    return last ? last.textContent : ''
  })
  await win.waitForTimeout(1500)
  const endText = await win.evaluate(() => {
    window.__obs && window.__obs.disconnect()
    return { count: window.__deltaCount, text: (document.querySelectorAll('.msg.assistant .msg-body')[0] || {}).textContent || '' }
  })
  // 中途应已见到部分内容（流式逐字效果），而非一次性出现
  check('stream-partial-visible-early', midText.length > 5 && !midText.includes('呼唤'), 'mid=' + JSON.stringify(midText.slice(0, 30)))
  check('stream-multiple-dom-updates', endText.count >= 3, 'mutations=' + endText.count)
  check('stream-full-text-arrived', endText.text.includes('母亲在楼下呼唤'), endText.text.slice(0, 40))
  // 光标消失（渲染完成）
  check('stream-cursor-gone', !endText.text.includes('▍'))

  await app.close()
  mock.srv.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

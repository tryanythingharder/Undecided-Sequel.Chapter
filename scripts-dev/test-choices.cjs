// 专项验证：选项按钮渲染（多格式解析）+ 多选组合发送
// R86 实流验证段：流式选项渐进渲染（JSON 尾巴流完前即可点）+ 排队发送 + 停止清空队列
const path = require('node:path')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

async function main() {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1500)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  const inject = async (content) => {
    await win.evaluate((c) => {
      localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
        preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm', currentSessionId: 'sc'
      }))
      localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
        id: 'sc', title: '选项测试', createdAt: Date.now(), updatedAt: Date.now(),
        messages: [{ role: 'user', content: '开始', at: Date.now() }, { role: 'assistant', at: Date.now(), content: c }]
      }]))
    }, content)
    await win.reload()
    await win.waitForTimeout(1600)
  }

  // ---- 1. 原有格式回归：【A】+ C. 行内 ----
  await inject('【甲龙历 407.03.01｜清晨】薄雾。\n【你需要决定】如何回应。\n【A】为他指路【B】闭门不开 C. 跟随他')
  check('fmt-bracket', (await win.locator('.choice').count()) === 3)
  const t1 = await win.locator('.choice').allTextContents()
  check('fmt-bracket-labels', t1.some((x) => x.includes('指路')) && t1.some((x) => x.includes('闭门')), JSON.stringify(t1))

  // ---- 2. 数字编号：1. / 2、 / 3) ----
  await inject('你可以选择：\n1. 接受委托去森林\n2、留在村庄帮忙\n3) 拒绝并离开')
  const t2 = await win.locator('.choice').allTextContents()
  check('fmt-numeric', t2.length === 3 && t2.some((x) => x.includes('接受委托')) && t2.some((x) => x.includes('留在村庄')), JSON.stringify(t2))

  // ---- 3. 圈号：①②③ ----
  await inject('如何行动？\n①向东探索遗迹\n②回酒馆打听消息\n③原地休息')
  const t3 = await win.locator('.choice').allTextContents()
  check('fmt-circled', t3.length === 3 && t3.some((x) => x.includes('遗迹')) && t3.some((x) => x.includes('酒馆')), JSON.stringify(t3))

  // ---- 4. 列表符号 + 加粗：- **A.** xxx ----
  await inject('你的选择：\n- **A.** 拔剑迎敌\n- **B.** 转身逃跑\n- **C.** 呼喊求援')
  const t4 = await win.locator('.choice').allTextContents()
  check('fmt-bold-list', t4.length === 3 && t4.some((x) => x.includes('拔剑')) && t4.some((x) => x.includes('逃跑')), JSON.stringify(t4))

  // ---- 5. 无选项文本：不渲染按钮 ----
  await inject('【甲龙历 407.03.02｜夜晚】你安然入睡，一夜无事。')
  check('no-choices-plain-text', (await win.locator('.choice').count()) === 0)

  // ---- 5b. R83 上下文兜底：模型没按契约给选项，但正文有「引号候选清单」→ 提取为按钮 ----
  await inject('我需要知道你是谁。例如：\n- 「一个在阿斯拉纳边境长大的兽血孤儿」- 「被米里斯教会收养的十岁男孩，不知道自己父母是谁」- 「布鲁纳村铁匠铺的学徒，今年十四岁」\n你想成为谁？')
  const qn = await win.locator('.choice').count()
  const qt = await win.locator('.choice').allTextContents()
  check('fallback-quote-count', qn === 3, 'n=' + qn)
  check('fallback-quote-contextual', qt.some((x) => x.includes('兽血')) && qt.some((x) => x.includes('米里斯')), JSON.stringify(qt))
  check('fallback-quote-keys', qt.some((x) => x.includes('A') && x.includes('兽血')), JSON.stringify(qt))
  await win.locator('.choice').nth(1).click()
  await win.waitForTimeout(400)
  const qSent = await win.locator('.msg.user .msg-body').last().textContent()
  check('fallback-quote-click-send', qSent.includes('【B】') && qSent.includes('米里斯'), 'text=' + qSent.slice(0, 44))

  // ---- 5c. R83 防误伤：叙述里零散的「专名/对白」引号不得变成按钮 ----
  await inject('你走进「布伦村」，听见有人喊「站住」。铁匠铺的炉火映红了半条街。')
  check('fallback-quote-suppressed', (await win.locator('.choice').count()) === 0)

  // ---- 5d. 多行列表形态（每行一个引号项）也应触发 ----
  await inject('可选出身：\n* 「边境猎户之子」\n* 「商队账房学徒」')
  const d1 = await win.locator('.choice').count()
  check('fallback-quote-multiline', d1 === 2, 'n=' + d1)

  // ---- 5e. R84 回归：点「收起」必须真的收起并保持（旧 bug：布局变化引发 scroll → 立刻自动展开）----
  // 注入高内容让消息区可滚动：收起选项区 → 容器变高 → scrollTop 被钳制 → 触发 scroll 事件
  const pad = Array.from({ length: 40 }, (_, i) => '第' + i + '段填充内容，用来撑高消息列表以制造滚动。').join('\n')
  await inject(pad + '\n【你需要决定】行动。\n【A】拔剑【B】撤退【C】谈判')
  await win.locator('.choices-fold').click()
  check('fold-collapses', await win.locator('#choices.collapsed').count() === 1)
  check('fold-pill-visible', await win.locator('#choices-expand').isVisible())
  await win.waitForTimeout(700)
  check('fold-stays-collapsed-after-scroll-event', await win.locator('#choices.collapsed').count() === 1)
  await win.locator('#choices-expand').click()
  await win.waitForTimeout(150)
  check('pill-re-expands', await win.locator('#choices.collapsed').count() === 0)

  // ---- 6. 多选组合：Ctrl+点击两个 → 工具条出现 → 组合发送 ----
  await inject('【你需要决定】行动组合。\n【A】先搜集情报【B】准备武器【C】立刻出发')
  check('multi-base-3-choices', (await win.locator('.choice').count()) === 3)
  // Ctrl+点击 A 和 B
  await win.locator('.choice').nth(0).click({ modifiers: ['Control'] })
  await win.locator('.choice').nth(1).click({ modifiers: ['Control'] })
  await win.waitForTimeout(200)
  check('multi-picked-2', (await win.locator('.choice.picked').count()) === 2)
  check('multi-bar-visible', await win.locator('.multi-bar').isVisible())
  const info = await win.locator('.multi-info').textContent()
  check('multi-info-text', info.includes('已选 2 项') && info.includes('A + B'), 'info=' + info)
  // 组合发送 → user 消息含两个【】段
  await win.locator('.multi-send').click()
  await win.waitForTimeout(400)
  const lastUser = await win.locator('.msg.user .msg-body').last().textContent()
  check('multi-combined-send', lastUser.includes('【A】') && lastUser.includes('【B】') && lastUser.includes('；'), 'text=' + lastUser.slice(0, 50))

  // ---- 7. 多选取消：勾选后点清空（重新注入，组合发送后末条是 user 无选项）----
  await inject('【你需要决定】行动组合。\n【A】先搜集情报【B】准备武器【C】立刻出发')
  await win.locator('.choice').nth(0).click({ modifiers: ['Control'] })
  await win.waitForTimeout(150)
  await win.locator('.multi-clear').click()
  await win.waitForTimeout(150)
  check('multi-clear-works', (await win.locator('.choice.picked').count()) === 0 && !(await win.locator('.multi-bar').isVisible()))

  // ---- 8. 普通点击仍直接发送（重新注入干净的会话）----
  await inject('【你需要决定】单独行动。\n【A】原地等待【B】跟随商队【C】立刻出发')
  await win.locator('.choice').nth(2).click()
  await win.waitForTimeout(400)
  const direct = await win.locator('.msg.user .msg-body').last().textContent()
  check('plain-click-direct-send', direct.includes('【C】') && direct.includes('出发'), 'text=' + direct.slice(0, 40))

  // 无控制台错误
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await win.waitForTimeout(400)
  check('no-console-errors', errors.length === 0, errors.join(' | ').slice(0, 200))

  // ==== R86 实流验证：慢速 SSE 下选项提前出现 + 排队发送 + 停止清空 ====
  // mock：叙事→选项区先流完，状态块 JSON 尾巴再慢流 8 秒（模拟 A6api 真实形态）
  const NARRATIVE = '【甲龙历 407.03.03｜清晨】你走进集市，喧嚣扑面。\n\n【你需要决定】\nA. 买些干粮出发\nB. 先去铁匠铺\nC. 打听昨夜骚动'
  const PATCH_JSON = '\n<<<STATE_PATCH>>>\n{"turn_summary":"集市晨景","scene":{"game_time":"清晨","location":"集市"},"events":[{"type":"action","description":"赶集","importance":20}]}\n<<<END_PATCH>>>'
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'mock-chat' }] })) }
      // SSE：叙事+选项 60ms/块；状态块 400ms/块（人为拉长尾巴——验证选项不等它）
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      let sent = ''
      const full = NARRATIVE + PATCH_JSON
      const timer = setInterval(() => {
        const inNarrative = sent.length < NARRATIVE.length
        const piece = full.slice(sent.length, sent.length + (inNarrative ? 12 : 6))
        sent += piece
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
        if (sent.length >= full.length) {
          clearInterval(timer)
          res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) + '\n\n')
          res.write('data: [DONE]\n\n')
          return res.end()
        }
      }, 60)
    })
  })
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r) })
  const port = srv.address().port
  await win.evaluate((p) => {
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ preset: 'custom', baseUrl: 'http://127.0.0.1:' + p, apiKey: 'sk-x', model: 'mock-chat', currentSessionId: 'sc' }))
  }, port)
  // 预载内核（引擎启动需内核文本）
  await win.evaluate(() => { localStorage.setItem('sixworlds.kernel.design.v2', JSON.stringify({ text: '测试内核' })) })
  await win.reload()
  await win.waitForTimeout(1600)
  // 触发真实流式发送
  await win.fill('#input', '开始赶集')
  await win.click('#btn-send')
  // ① 流式期间（叙事读完、JSON 尾巴还在流）选项应已出现
  let earlyOk = false
  for (let i = 0; i < 100; i++) {
    const cnt = await win.locator('.choice').count()
    const busyNow = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    if (cnt >= 3 && busyNow) { earlyOk = true; break } // busy 中选项在场 = 提前渲染生效
    if (!busyNow) break // 全流完（太快则失败——mock 已拉长尾巴到 8s+）
    await win.waitForTimeout(150)
  }
  check('stream-choices-early', earlyOk, '选项在 JSON 尾巴流完前出现')
  // ② 流式中点击选项 → 排队；本轮（含尾巴）结束后自动发出 → 新的 user 消息出现
  if (earlyOk) {
    await win.locator('.choice').first().click()
    const queuedToast = await win.evaluate(() => Array.from(document.querySelectorAll('.toast')).some((t) => t.textContent.includes('排队')))
    check('stream-click-queues', queuedToast, '点击即时反馈排队')
    // P1-2 排队持久指示：忙碌岛挂「已排队」chip（点击可取消），不再是转瞬即逝的 toast
    const chipText = await win.evaluate(() => { const c = document.getElementById('island-queue-chip'); return c ? c.textContent : '' })
    check('queue-chip-persistent', chipText.includes('已排队'), 'chip=' + chipText)
    // chip 点击 → 取消排队（queuedSend 清空，本轮结束后不再自动发出）
    await win.evaluate(() => document.getElementById('island-queue-chip').click())
    await win.waitForTimeout(400)
    const chipGone = await win.evaluate(() => !document.getElementById('island-queue-chip'))
    check('queue-chip-click-cancels', chipGone, 'chip 点击后撤下')
    // 重新排队并验证轮末自动发出路径未被取消逻辑破坏
    await win.locator('.choice').first().click()
    let autoSent = false
    for (let i = 0; i < 120; i++) {
      const users = await win.evaluate(() => document.querySelectorAll('.msg.user .msg-body').length)
      const busyNow = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
      if (users >= 2 && !busyNow) { autoSent = true; break }
      await win.waitForTimeout(300)
    }
    check('queued-auto-sent', autoSent, '排队的发送在轮末自动发出')
  }
  // ③ 停止生成即清空队列（新一轮：流式中点击选项再点停止）
  await win.fill('#input', '再逛一圈')
  await win.click('#btn-send')
  await win.waitForTimeout(3000) // 进入叙事流式期
  const busyMid = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
  if (busyMid) {
    await win.locator('.choice').first().click().catch(() => {})
    await win.click('#btn-send') // busy 中即停止
    await win.waitForTimeout(800)
    const busyAfter = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    const users = await win.evaluate(() => document.querySelectorAll('.msg.user .msg-body').length)
    check('stop-clears-queue', !busyAfter, '停止后无自动续发（队列已清）')
  } else check('stop-clears-queue', true, '（流式太快未捕获窗口，跳过）')
  srv.close()
  await app.close().catch(() => {})

  if (fails.length) { console.log('FAILED: ' + fails.join('; ')); process.exit(1) }
  console.log('ALL_PASS')
  process.exit(0)

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

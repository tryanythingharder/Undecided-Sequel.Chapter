'use strict'
/* 长篇压力测试 · 真实 Electron 端到端（规范二十九：至少一次真实端到端长篇）
 * 链路：真实 UI 输入/点击 → IPC → 主进程引擎（Retriever → Context → LLM(mock) →
 *       PATCH 提取 → Validator → Scene Commit → 磁盘存储）→ 渲染层展示。
 * mock LLM 是确定性测试模型：每轮回复叙事+合法 STATE_PATCH，沿剧本埋设锚点
 * （拒绝商会/救人/得表/立誓/失表/NPC 死亡/收回誓言）；重启后记忆挑战的回复
 * 只从「系统 Context 块」中回显锚点词——锚点早已滚出 24 条聊天历史窗口，
 * 因此回显成功 ⇔ 检索器真的把历史送进了模型上下文。
 * 流程：清档 → 配置 mock → 创建世界线 → 100 轮真实交互 → 完全重启应用 →
 *       依赖持久化状态重新打开 → 5 道记忆挑战 → 磁盘账本核对。
 * 运行：node scripts-dev/stress-e2e.cjs（STRESS_E2E_TURNS 可调轮数，默认 100）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const TURNS = Number(process.env.STRESS_E2E_TURNS) || 100

/* ---- 剧本锚点（金帆商会线，与无头套件的落霞镇世界互相独立） ---- */
const ORG = '金帆商会'
const NPC_SAVED = '小满'
const NPC_DEAD = '老周'
const ITEM = '黄铜怀表'
const OATH = '绝不加入金帆商会'
const ANCHOR_TERMS = [ITEM, ORG, NPC_SAVED, NPC_DEAD, '绝不加入']

/* 剧本化回复表：turn → { text(叙事), patch(结构化状态) }；未命中锚点的回合由 baseTurn 生成 */
function patchFor(turn, narrative) {
  const p = {
    turn_summary: narrative.slice(0, 80),
    scene: { game_time: '玄历1024年春·第' + turn + '日', location: turn % 5 === 3 ? '河湾市集' : '临水镇街市' },
    events: [{ type: turn % 7 === 2 ? 'dialogue' : 'action', description: narrative.slice(0, 60), importance: 15 + (turn % 20) }]
  }
  if (turn === 3) {
    p.decisions = [{ raw_input: '我不会加入金帆商会，这条路我自己走。', normalized_intent: '明确拒绝加入金帆商会', source: 'user_input', importance: 80 }]
    p.facts = [{ key: 'refuse-jinfan', statement: '凯岩当面拒绝了金帆商会的入会邀请', importance: 85 }]
    p.relationships = [{ source_name: '凯岩', target_name: '崔明', relation_type: '入会拉拢被拒', strength_delta: -1, description: '凯岩当面回绝了崔明代表的金帆商会' }]
  }
  if (turn === 6) {
    p.decisions = [{ raw_input: '码头货架塌了，我把小满拖了出来。', normalized_intent: '货架塌落时救下小满', source: 'user_input', importance: 82 }]
    p.facts = [{ key: 'save-xiaoman', statement: '河湾码头货架塌落，凯岩救下了矿工小满', importance: 85 }]
    p.causal = [{ cause: '河湾码头货架塌落', effect: '小满被凯岩从货架下拖出', importance: 60 }]
    p.relationships = [{ source_name: '凯岩', target_name: '小满', relation_type: '救命之恩', strength_delta: 3, description: '凯岩救了小满，小满视他为恩人' }]
    p.entity_changes = [{ name: '小满', type: 'character', summary: '码头帮工，塌架中被凯岩所救' }]
  }
  if (turn === 9) {
    p.facts = [{ key: 'get-watch', statement: '凯岩在旧货摊上淘到了黄铜怀表，表盖内刻着半枚纹章', importance: 85 }]
    p.entity_changes = [{ name: '黄铜怀表', type: 'item', summary: '表盖内刻着半枚神秘纹章的旧怀表' }]
  }
  if (turn === 12) {
    p.decisions = [{ raw_input: '我对着河水发誓：绝不加入金帆商会。', normalized_intent: '立誓绝不加入金帆商会', source: 'user_input', importance: 85 }]
    p.commitments = [{ kind: 'oath', content: '绝不加入金帆商会', importance: 80 }]
  }
  if (turn === 18) {
    p.facts = [{ key: 'lose-watch', statement: '黄铜怀表在渡船倾覆时沉入河湾，彻底丢失', importance: 85 }]
  }
  if (turn === 24) {
    p.decisions = [{ raw_input: '老周为了拉开货架没躲开二次塌落，没能撑过今夜。', normalized_intent: '老周因救人死于二次塌落', source: 'user_input', importance: 90 }]
    p.facts = [{ key: 'zhou-dies', statement: '老周为救帮工被二次塌落击中，当晚去世', importance: 90 }]
    p.entity_changes = [{ name: '老周', type: 'character', state: { alive: false }, summary: '临水镇铁匠，救人时死于二次塌落' }]
    p.events = [{ type: 'turning_point', description: '老周为救帮工死于二次塌落', importance: 90, participant_names: ['老周'] }]
  }
  if (turn === 30) {
    p.decisions = [{ raw_input: '我想通了——我收回誓言，我愿意加入金帆商会。', normalized_intent: '正式收回誓言并加入金帆商会', source: 'user_input', importance: 85 }]
    p.commitment_updates = [{ ref: '绝不加入', status: 'REVOKED', note: '凯岩当众收回誓言，正式入会' }]
  }
  if (turn % 5 === 0 && !p.facts) {
    p.facts = [{ key: 'ledger-' + turn, statement: '第' + turn + '日照册盘账，市集流水与库存两讫', importance: 30 }]
  }
  return p
}

function narrativeFor(turn) {
  const beats = [
    '河雾未散，渡口的梆子声隔水传来，你把昨天的账目理清了一遍。',
    '街市上人声渐起，' + NPC_SAVED + '帮你在摊前支起了遮棚，动作比从前麻利许多。',
    '有人谈起' + ORG + '近来的船期，说船队又要往南边加开一班。',
    '午后落了阵急雨，你躲进檐下，看积水在石板上汇成细流。',
    '铁匠铺的炉火重新旺了起来——' + NPC_DEAD + '的徒弟接过了锤子，手艺有几分师父的影子。'
  ]
  if (turn === 3) return '崔明把契据推到你面前，开了很高的价码。你合上契据推了回去：我不会加入金帆商会，这条路我自己走。'
  if (turn === 6) return '码头货架突然塌落！你冲过去把压在下面的' + NPC_SAVED + '拖了出来，万幸只擦伤了胳膊。'
  if (turn === 9) return '旧货摊的角落里，一只' + ITEM + '的表盖半开着，内圈刻着半枚纹章。你付了钱，把它揣进怀里。'
  if (turn === 12) return '你站在河湾边上，对着流水立誓：绝不加入金帆商会。河水东去，誓言落定。'
  if (turn === 18) return '渡船在湾口倾覆，你爬上岸时摸向怀中——' + ITEM + '不见了，它沉进了河湾。'
  if (turn === 24) return '二次塌落来得毫无征兆。' + NPC_DEAD + '为了拉开帮工没躲开，重伤不治，没能撑过今夜。镇上为他熄了一夜的灯。'
  if (turn === 30) return '你想了很多个夜晚，终于把话说出口：我收回当年的誓言，我愿意加入' + ORG + '。崔明向你伸出了手。'
  return beats[turn % beats.length]
}

function replyFor(turn) {
  const narrative = narrativeFor(turn)
  const patch = patchFor(turn, narrative)
  return '【玄历 1024.03.' + (turn + 1) + '｜' + (turn % 2 ? '午' : '晨') + '｜临水镇】\n' + narrative +
    '\n\n【你需要决定】\nA. 继续在街市上走动\nB. 找人打听近来的消息\nC. 回住处整理这一天的见闻' +
    '\n<<<STATE_PATCH>>>\n' + JSON.stringify(patch) + '\n<<<END_PATCH>>>'
}

/* ---- 确定性 mock LLM ---- */
function startMock() {
  let calls = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (!req.url.endsWith('/chat/completions')) return json(404, { error: 'not found' })
      calls += 1
      const parsed = (() => { try { return JSON.parse(body) } catch { return {} } })()
      const sysMsgs = (parsed.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content || ''))
      const userMsgs = (parsed.messages || []).filter((m) => m.role === 'user').map((m) => String(m.content || ''))
      const lastUser = userMsgs[userMsgs.length - 1] || ''
      const ctxBlock = sysMsgs.find((t) => t.indexOf('【世界状态 · 结构化记忆') >= 0) || ''
      const wantsStream = (() => { try { return parsed.stream === true } catch { return false } })()
      const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      const send = (content) => {
        if (!wantsStream) return json(200, { choices: [{ message: { role: 'assistant', content } }], usage })
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        let i = 0
        const dbg = process.env.STRESS_E2E_DEBUG ? require('node:fs').appendFileSync(require('node:os').tmpdir() + '/stress-e2e-mock.log', Date.now() + ' call#' + calls + ' stream start len=' + content.length + '\n') : null
        res.on('close', () => {
          if (process.env.STRESS_E2E_DEBUG) require('node:fs').appendFileSync(require('node:os').tmpdir() + '/stress-e2e-mock.log', Date.now() + ' call#' + calls + ' close sent=' + i + '/' + content.length + '\n')
        })
        const timer = setInterval(() => {
          if (i >= content.length) {
            clearInterval(timer)
            res.write('data: ' + JSON.stringify({ choices: [], usage }) + '\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + 14) } }] }) + '\n\n')
          i += 14
        }, 16)
      }
      /* 引擎补录重试：只回状态块（不重写剧情）——补录请求词在最后的 user 消息里 */
      const retryHit = sysMsgs.some((t) => t.indexOf('缺少合法 State Patch') >= 0) || /缺少合法 State Patch/.test(lastUser)
      if (retryHit) {
        return send('<<<NO_STATE_CHANGE>>>')
      }
      /* 记忆挑战回合：只从系统 Context 块回显锚点词（历史窗口不含锚点 ⇒ 回显成功=检索成功） */
      const isChallenge = /怀表|拒绝过|小满|老周|誓言/.test(lastUser) && calls > TURNS
      if (isChallenge) {
        const found = ANCHOR_TERMS.filter((t) => ctxBlock.indexOf(t) >= 0)
        return send('【玄历 1024.04.01｜晨｜临水镇】\n你合上册子，把记得的事一件件摆出来：' + (found.length ? found.join('、') : '（记忆查询无命中）') + '。往事分明，账册未乱。\n<<<NO_STATE_CHANGE>>>')
      }
      /* 正常剧情回合 */
      return send(replyFor(calls))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

/* ---- 定位测试档案里的引擎数据目录（真实磁盘核对用） ---- */
function findEngineDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const candidates = ['六面世界', 'six-worlds-codex', 'Electron']
  for (const name of candidates) {
    const p = path.join(appData, name, 'test-profile', 'story-engine')
    if (fs.existsSync(p)) return p
  }
  return null
}

async function settingsWindow(app, closed) {
  for (let i = 0; i < 30; i++) {
    const ws = app.windows()
    const s = ws.find((w) => w.url().includes('settings.html'))
    if (closed ? !s : s) return s || null
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

async function waitSettled(win, timeout) {
  /* 等待一回合完成：发送按钮复位 + 最后一条助手消息文本稳定 2 次。
   * 含流式光标 ▍ 或空文本视为未稳定；应用 80 条消息滚动窗使 DOM 助手消息数封顶 40，
   * 不能用「数量≥目标」判断回合完成。 */
  const t0 = Date.now()
  let prev = null, stable = 0
  while (Date.now() - t0 < (timeout || 30000)) {
    const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop')).catch(() => true)
    if (!busy) {
      const last = await win.evaluate(() => { const els = document.querySelectorAll('.msg.assistant .msg-body'); return els.length ? els[els.length - 1].textContent : '' }).catch(() => '')
      if (last && !last.includes('▍') && last === prev) { stable++; if (stable >= 2) return true } else stable = 0
      prev = last
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function main() {
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  << ' + extra : '')); if (!cond) fails.push(name) }

  /* 清档：测试档案的引擎数据与 localStorage 全部从零开始（可重复运行） */
  const engineDir = findEngineDir()
  if (engineDir) fs.rmSync(engineDir, { recursive: true, force: true })
  check('清档 · 引擎测试数据已清空', true)

  const launch = () => electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })

  let app = await launch()
  const pageErrors = []
  let win = await app.firstWindow()
  win.on('pageerror', (e) => pageErrors.push(String(e)))
  await win.waitForTimeout(1500)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1500)

  /* 配置 mock 端点 */
  await win.click('#btn-settings')
  const sw = await settingsWindow(app)
  check('设置窗口打开', !!sw)
  await sw.selectOption('#set-preset', 'custom')
  await sw.fill('#set-baseurl', base)
  await sw.fill('#set-apikey', 'sk-mock')
  await sw.fill('#set-model', 'mock-chat')
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(500)

  /* 创建世界线 + 第一回合：空态主按钮点击即自动发送「开始」（app 内建行为），无需手动发送 */
  await win.click('.empty .primary')
  const narratives = [] // 全程收集每回合叙事（DOM 滚动窗外仍可断言锚点）
  check('首回合完成', await waitSettled(win), 'assistant 消息未出现')
  narratives.push(await win.evaluate(() => { const els = document.querySelectorAll('.msg.assistant .msg-body'); return els.length ? els[els.length - 1].textContent : '' }))
  check('首回合叙事含场景行', /【玄历/.test(narratives[0] || ''), (narratives[0] || '').slice(0, 40))

  /* —— 长篇交互循环：TURNS 轮真实 输入→检索→LLM→PATCH→提交 —— */
  let loopBroken = false
  for (let t = 2; t <= TURNS; t++) {
    let usedChoice = false
    if (t % 3 === 0) {
      const lastChoice = win.locator('.choice').last()
      try { await lastChoice.click({ timeout: 2000, force: false }); usedChoice = true } catch { usedChoice = false }
    }
    if (!usedChoice) {
      const lines = ['在街市上继续转转，看看有什么活计。', '去码头帮着卸一批货。', '找崔明打听商会最近的动向。', '回住处把今天的见闻记进册子。', '去铁匠铺看看炉子。']
      await win.fill('#input', lines[t % lines.length])
      await win.click('#btn-send')
    }
    const ok = await waitSettled(win, 45000)
    if (!ok) { check('第 ' + t + ' 回合完成', false, '等待超时'); loopBroken = true; break }
    narratives.push(await win.evaluate(() => { const els = document.querySelectorAll('.msg.assistant .msg-body'); return els.length ? els[els.length - 1].textContent : '' }))
    if (t % 25 === 0) console.log('  … E2E ' + t + '/' + TURNS + ' 轮')
  }
  const assistants = await win.locator('.msg.assistant').count()
  check('长篇交互 · ' + TURNS + ' 轮全部提交（无中断）', !loopBroken, 'assistant 窗口=' + assistants + '（应用 80 条滚动窗，封顶 40，盘上以引擎计数为准）')
  const joined = narratives.join('\n')
  check('锚点叙事 · 拒绝商会', joined.indexOf('我不会加入金帆商会') >= 0)
  check('锚点叙事 · 救下' + NPC_SAVED, joined.indexOf('拖了出来') >= 0)
  check('锚点叙事 · 得到' + ITEM, joined.indexOf('黄铜怀表') >= 0)
  check('锚点叙事 · 誓言', joined.indexOf('绝不加入金帆商会') >= 0)
  check('锚点叙事 · 失表', joined.indexOf('沉进了河湾') >= 0)
  check('锚点叙事 · ' + NPC_DEAD + '之死', joined.indexOf('没能撑过今夜') >= 0)
  check('锚点叙事 · 收回誓言', joined.indexOf('我收回当年的誓言') >= 0)

  /* —— 完全重启应用（真实进程退出再启动，规范三十二） —— */
  await app.close()
  await new Promise((r) => setTimeout(r, 1200))
  app = await launch()
  win = await app.firstWindow()
  win.on('pageerror', (e) => pageErrors.push(String(e)))
  await win.waitForTimeout(2000)
  const assistantsAfter = await win.locator('.msg.assistant').count()
  check('重启 · 世界线与消息从持久化恢复（窗口化 DOM：最近 60 条消息 ≈ 30 助手消息）', !loopBroken && assistantsAfter >= Math.min(28, Math.max(1, Math.floor(TURNS / 2) - 2)) && assistantsAfter <= assistants, 'assistant=' + assistantsAfter)

  /* —— 重启后先推进一回合剧情（真实提交 → 产生新 Session 连接），再做记忆挑战 —— */
  await win.fill('#input', '我在镇上继续走动，把 restarted 后的日子过下去。')
  await win.click('#btn-send')
  check('重启后 · 剧情回合正常提交（新 Session 连接）', await waitSettled(win, 30000))
  narratives.push(await win.evaluate(() => { const els = document.querySelectorAll('.msg.assistant .msg-body'); return els.length ? els[els.length - 1].textContent : '' }))

  /* —— 记忆挑战（5 道，回复只回显 Context 块中的锚点词） —— */
  const challenges = [
    { q: '那块黄铜怀表后来怎么丢的？', expect: ITEM },
    { q: '我是不是早就拒绝过金帆商会？', expect: ORG },
    { q: '小满后来怎么样了？', expect: NPC_SAVED },
    { q: '老周还在吗？', expect: NPC_DEAD },
    { q: '我当年发的誓言还算数吗？', expect: '绝不加入' }
  ]
  for (let i = 0; i < challenges.length; i++) {
    const ch = challenges[i]
    await win.fill('#input', ch.q)
    await win.click('#btn-send')
    const ok = await waitSettled(win, 30000)
    const text = ok ? await win.locator('.msg.assistant .msg-body').last().textContent() : ''
    check('记忆挑战 ' + (i + 1) + ' ·「' + ch.q + '」检索回显「' + ch.expect + '」', ok && (text || '').indexOf(ch.expect) >= 0, (text || '').slice(0, 60))
  }

  /* —— 磁盘账本核对（真实存储） —— */
  const dir2 = findEngineDir()
  check('磁盘 · 引擎数据目录存在', !!dir2, dir2 || '未找到')
  if (dir2) {
    const files = fs.readdirSync(path.join(dir2, 'stories'))
    check('磁盘 · 故事文件在册', files.length >= 1, files.join(','))
    const story = JSON.parse(fs.readFileSync(path.join(dir2, 'stories', files[0]), 'utf8'))
    check('磁盘 · 回合计数 ≥ ' + TURNS, story.counters.turn >= TURNS, 'turn=' + story.counters.turn)
    check('磁盘 · 决定账本含拒绝+誓言+收誓', story.decisions.length >= 3 && JSON.stringify(story.decisions).indexOf('金帆商会') >= 0)
    check('磁盘 · 誓言承诺 REVOKED 且未删除', story.commitments.some((c) => c.content.indexOf('绝不加入') >= 0 && c.status === 'REVOKED'))
    check('磁盘 · ' + NPC_DEAD + ' alive=false', (story.entities.find((e) => e.name === NPC_DEAD) || { state: {} }).state.alive === false)
    check('磁盘 · 得表/失表两条事实并存', story.facts.some((f) => f.key === 'get-watch' && f.status === 'ACTIVE') && story.facts.some((f) => f.key === 'lose-watch' && f.status === 'ACTIVE'))
    check('磁盘 · Session ≥ 2（重启后新建连接）', story.sessions.length >= 2, 'sessions=' + story.sessions.length)
    check('磁盘 · Session 状态合法', story.sessions.every((s) => ['ACTIVE', 'CLOSED'].includes(s.status)))
    const pendDir = path.join(dir2, 'pendings')
    const pendCount = fs.existsSync(pendDir) ? fs.readdirSync(pendDir).filter((f) => f.endsWith('.json')).length : 0
    check('磁盘 · Pending 清零', pendCount === 0, 'pending=' + pendCount)
    check('磁盘 · 跨故事词汇零泄漏（金帆线无落霞内容）', JSON.stringify(story.facts).indexOf('落霞') < 0)
  }

  check('页面 · 无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))

  await win.screenshot({ path: path.join(__dirname, 'shot-stress-e2e.png') })
  await app.close()
  mock.server.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

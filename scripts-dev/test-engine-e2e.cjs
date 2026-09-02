// 引擎端到端冒烟（真实 Electron 渲染层 → IPC → 主进程引擎 → 磁盘落盘）
// 覆盖：STATE_PATCH 流式隐藏、协议块剥离、选项解析不受污染、结构化状态落盘、
//       第 2 回合注入状态块 + 协议、无 patch 自动静默补录重试（重试成功提交+Pending 清空）、Inspector 打开。
// 运行：node scripts-dev/test-engine-e2e.cjs（SIXWORLDS_TEST=1 隔离，绝不触碰真实配置）
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const PATCH = {
  turn_summary: '灰袍旅人敲门问路，玩家面临是否指引的决定',
  decisions: [{ raw_input: '灰袍旅人敲门问路', normalized_intent: '回应旅人的问路', source: 'user_input', importance: 50 }],
  facts: [
    { key: 'visitor_grayrobe', statement: '一名灰袍旅人在清晨敲响了家门', importance: 60 },
    { key: 'visitor_secret', statement: '旅人的真名是萝莉丝，来自米里斯教会', importance: 70, visibility: 'secret' }
  ],
  commitments: [{ content: '为旅人指路后，他承诺回报一枚银币', kind: 'promise', importance: 50 }],
  threads: [{ ref: '灰袍旅人的来历', title: '灰袍旅人的来历', detail: '兜帽下的灰眼睛不属于本地人', status: 'OPEN' }]
}
const REPLY1 = '【甲龙历 407.03.01｜清晨｜布耶纳村】灰袍旅人立在门前，兜帽下只露出一双灰眼睛，向你问路。\n【A】为他指路（获得情报）【B】闭门不开' +
  '\n<<<STATE_PATCH>>>\n' + JSON.stringify(PATCH, null, 2) + '\n<<<END_PATCH>>>'
const NARR2 = '【甲龙历 407.03.02｜清晨｜村口】你为旅人指明了道路，他微微颔首，转身没入薄雾。'
const REPLY2 = NARR2 // 第 2 次调用：无 patch 也无 NO_STATE_CHANGE → 渲染层应自动静默重试
const RETRY_PATCH = { turn_summary: '为旅人指路，旅人没入薄雾离去', facts: [{ key: 'road_given', statement: '玩家为灰袍旅人指明了道路', importance: 40 }] }
const REPLY3 = NARR2 + '\n<<<STATE_PATCH>>>\n' + JSON.stringify(RETRY_PATCH) + '\n<<<END_PATCH>>>' // 第 3 次调用：补录成功

function startMock() {
  let calls = 0
  let last = null // { systemCount, hasProtocol, hasStateBlock }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/__last') return json(200, last)
      if (req.url.endsWith('/models')) {
        if (req.headers.authorization !== 'Bearer sk-mock') return json(401, { error: { message: 'bad key' } })
        return json(200, { data: [{ id: 'mock-chat' }] })
      }
      if (req.url.endsWith('/chat/completions')) {
        calls += 1
        try {
          const p = JSON.parse(body)
          const sys = p.messages.filter((m) => m.role === 'system')
          const users = p.messages.filter((m) => m.role === 'user')
          last = {
            systemCount: sys.length,
            hasProtocol: sys.some((m) => String(m.content).includes('<<<STATE_PATCH')),
            hasStateBlock: sys.some((m) => String(m.content).includes('世界状态 · 结构化记忆')),
            hasRetryPrompt: users.some((m) => String(m.content).includes('缺少合法 State Patch')),
            userCount: users.length
          }
        } catch { last = { systemCount: 0 } }
        const reply = calls === 1 ? REPLY1 : (calls === 2 ? REPLY2 : REPLY3)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        let i = 0
        const timer = setInterval(() => {
          if (i >= reply.length) {
            clearInterval(timer)
            res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }) + '\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply.slice(i, i + 12) } }] }) + '\n\n')
          i += 12
        }, 20)
        return
      }
      json(404, { error: 'not found: ' + req.url })
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, calls: () => calls })))
}

// 注意：Electron userData 用 productName（六面世界），而非 npm 包名 six-worlds-codex
const STORIES_DIR = path.join(process.env.APPDATA, '六面世界', 'test-profile', 'story-engine', 'stories')
const LOGS_DIR = path.join(process.env.APPDATA, '六面世界', 'test-profile', 'story-engine', 'logs')
const PENDINGS_DIR = path.join(process.env.APPDATA, '六面世界', 'test-profile', 'story-engine', 'pendings')

function pendingFiles(storyId) {
  try {
    return fs.readdirSync(PENDINGS_DIR).filter((f) => f.endsWith('.json') && (!storyId || f.startsWith(storyId + '.')))
  } catch { return [] }
}

function storyFiles() {
  try { return fs.readdirSync(STORIES_DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
}
function readStoryByName(name) {
  try { return JSON.parse(fs.readFileSync(path.join(STORIES_DIR, name), 'utf8')) } catch { return null }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, timeout) {
  const t0 = Date.now()
  while (Date.now() - t0 < (timeout || 8000)) { const v = await fn(); if (v) return v; await sleep(100) }
  return null
}

async function main() {
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  ' + extra : '')); if (!cond) fails.push(name) }
  let leakSeen = false

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1500)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1500)
  const filesBefore = new Set(storyFiles())

  // 配置 mock 端点
  await win.click('#btn-settings')
  let sw = null
  for (let i = 0; i < 30 && !sw; i++) { sw = app.windows().find((w) => w.url().includes('settings.html')); if (!sw) await sleep(100) }
  await sw.selectOption('#set-preset', 'custom')
  await sw.fill('#set-baseurl', base)
  await sw.fill('#set-apikey', 'sk-mock')
  await sw.fill('#set-model', 'mock-chat')
  await sw.click('#btn-save-settings')
  await sleep(600)

  // ---- 第 1 回合：带 STATE_PATCH 的回复 ----
  await win.fill('#input', '灰袍旅人敲门问路')
  await win.click('#btn-send')
  // 流式期间轮询：协议标记不得泄漏到界面
  for (let i = 0; i < 40; i++) {
    const t = await win.locator('.msg.assistant .msg-body').last().textContent().catch(() => '')
    if (t.includes('<<<STATE')) { leakSeen = true; break }
    const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    if (!busy && t.includes('旅人')) break
    await sleep(50)
  }
  const done = await until(async () => !(await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))), 15000)
  check('turn1-reply-completed', !!done)
  await sleep(800) // 等 engineCommit IPC 回来

  const finalText = await win.locator('.msg.assistant .msg-body').last().textContent()
  check('turn1-no-patch-leak-final', !finalText.includes('<<<STATE_PATCH'), finalText.slice(-120))
  check('turn1-no-patch-leak-streaming', !leakSeen)
  const chips = await win.locator('.choice').count().catch(() => 0)
  check('turn1-choices-parsed-from-narrative', chips === 2, 'chips=' + chips)

  // ---- 磁盘：结构化状态已落盘（只认本次新产生的故事文件） ----
  const newFile = await until(() => { const n = storyFiles().find((f) => !filesBefore.has(f)); return n || null }, 8000)
  const story = newFile ? readStoryByName(newFile) : null
  check('disk-story-file-created', !!story, newFile || 'missing')
  if (story) {
    check('disk-turn-1', story.counters.turn === 1, 'turn=' + story.counters.turn)
    const dec = story.decisions[0]
    check('disk-decision-confirmed-with-raw', dec && dec.status === 'CONFIRMED' && dec.raw_input === '灰袍旅人敲门问路', dec && dec.status)
    const secret = story.facts.find((f) => f.key === 'visitor_secret')
    check('disk-secret-fact-stored', !!secret && secret.secret_from_player === true, secret && String(secret.secret_from_player))
    check('disk-thread-open', story.threads[0] && story.threads[0].status === 'OPEN', story.threads[0] && story.threads[0].status)
    check('disk-commitment-active', story.commitments[0] && story.commitments[0].status === 'ACTIVE')
    check('disk-turn-log-exists', fs.readdirSync(LOGS_DIR).length > 0)
  }

  // ---- 第 2 回合：无 patch 回复 → 自动静默补录重试 → 提交（条款 16/17/25） ----
  await win.fill('#input', '为他指路')
  await win.click('#btn-send')
  await until(async () => {
    const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    const t = await win.locator('.msg.assistant .msg-body').last().textContent().catch(() => '')
    return !busy && t.includes('薄雾')
  }, 20000)
  await sleep(1200) // 等 重试提交 + Pending 处置 IPC 回来
  const callsAfter = mock.calls()
  check('turn2-retry-exactly-once', callsAfter === 3, 'calls=' + callsAfter)
  const info = await until(async () => { try { const r = await fetch(base + '/__last'); const j = await r.json(); return j && j.systemCount >= 3 ? j : null } catch { return null } }, 5000)
  check('turn2-payload-system-count>=3', !!info && info.systemCount >= 3, info && ('n=' + info.systemCount))
  check('turn2-payload-has-state-block', !!info && info.hasStateBlock === true, info && String(info.hasStateBlock))
  check('turn2-payload-has-protocol', !!info && info.hasProtocol === true)
  check('turn2-retry-payload-has-retry-prompt', !!info && info.hasRetryPrompt === true, info && String(info.hasRetryPrompt))
  const story2 = newFile ? readStoryByName(newFile) : null
  check('turn2-retry-committed-advances-engine', story2 && story2.counters.turn === 2, 'turn=' + (story2 && story2.counters.turn))
  check('turn2-retry-state-on-disk', story2 && story2.facts.some((f) => f.key === 'road_given'), story2 && JSON.stringify(story2.facts.map((f) => f.key)))
  const finalText2 = await win.locator('.msg.assistant .msg-body').last().textContent()
  check('turn2-plain-narrative-intact', finalText2.includes('薄雾') && !finalText2.includes('<<<STATE_PATCH'))
  // Pending 处置：重试成功 → 本 story 无待补录残留（条款 17；目录按 story 前缀过滤，隔离历史运行）
  check('turn2-pendings-empty-after-retry', newFile && pendingFiles(newFile.replace(/\.json$/, '')).length === 0, JSON.stringify(pendingFiles(newFile && newFile.replace(/\.json$/, ''))))
  const chipCount = await win.locator('.msg-pending-chip').count().catch(() => 0)
  check('turn2-no-pending-chip', chipCount === 0, 'chips=' + chipCount)

  // ---- Inspector ----
  await win.keyboard.press('Control+Alt+I')
  await sleep(500)
  const inspVisible = await win.evaluate(() => { const el = document.getElementById('inspector'); return el && !el.hidden && el.style.display !== 'none' })
  check('inspector-opens', !!inspVisible)
  if (inspVisible) {
    const inspText = await win.evaluate(() => document.getElementById('inspector').innerText)
    check('inspector-shows-ledgers', inspText.includes('决定') && inspText.includes('事实'))
    await win.keyboard.press('Escape')
    await sleep(300)
  }

  await app.close()
  mock.server.close()
  console.log('==== ' + (fails.length ? fails.length + ' FAILED: ' + fails.join('; ') : 'ALL_PASS') + ' ====')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error('E2E-ERROR', e); process.exit(1) })

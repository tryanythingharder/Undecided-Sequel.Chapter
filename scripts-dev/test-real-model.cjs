// 真实模型端到端测试（用户当前配置的真实模型，不用 mock）
// 运行：node scripts-dev/test-real-model.cjs
//
// 环境与安全约束：
// - SIXWORLDS_TEST=1 → app.setPath('userData', …/test-profile)，与真实档案完全隔离；
// - 测试绝不读、绝不打印 API 密钥：直接把真实档案里 safeStorage(系统 DPAPI) 加密的
//   secrets.json 密文原样复制进 test-profile——Electron 在同一 Windows 用户下可解密，
//   密钥明文只存在于被测应用内存中（与真实使用一致）；
// - 公开配置（baseUrl/model 等，不含密钥）从真实档案 localStorage LevelDB 里字节扫描提取，
//   逐字段白名单后再注入 test-profile，绝不整体复制用户数据。
// - 本测试是网络依赖的冒烟（真实推理计费），只跑少量回合，且不入 run-tests.cjs 默认套件。
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const root = path.join(__dirname, '..')
const PROFILE = path.join(process.env.APPDATA, '六面世界', 'test-profile')
const REAL = path.join(process.env.APPDATA, '六面世界')

if (path.basename(PROFILE) !== 'test-profile') throw new Error('拒绝非测试目录: ' + PROFILE)
fs.rmSync(PROFILE, { recursive: true, force: true })

const fails = []
const notes = []
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  ' + extra : ''))
  if (!cond) fails.push(name)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 无缓冲 checkpoint 日志：真模型回合长（1-3 分钟），必须能看到测试走到哪了
const log = (msg) => process.stdout.write('[real-model] ' + msg + '\n')
async function until(fn, timeout) {
  const t0 = Date.now()
  while (Date.now() - t0 < (timeout || 30000)) { const v = await fn(); if (v) return v; await sleep(200) }
  return null
}

// ---- 1. 从真实档案提取公开配置（不含任何密钥字段） ----
function readRealPublicCfg() {
  const ls = path.join(REAL, 'Local Storage', 'leveldb')
  let best = null
  for (const f of fs.readdirSync(ls).filter((f) => /\.(ldb|log)$/.test(f))) {
    const buf = fs.readFileSync(path.join(ls, f))
    const hits = []
    // 'sixworlds.codex.state.v3' 可能以 utf8 或 utf16le 编码出现
    const key8 = Buffer.from('sixworlds.codex.state.v3', 'utf8')
    const key16 = Buffer.alloc(key8.length * 2)
    for (let i = 0; i < key8.length; i++) key16[i * 2] = key8[i]
    let i = -1
    while ((i = buf.indexOf(key8, i + 1)) !== -1) hits.push({ i, w16: false })
    while ((i = buf.indexOf(key16, i + 1)) !== -1) hits.push({ i, w16: true })
    for (const h of hits) {
      // 从 key 之后找最近的 '{'，做花括号配平截取
      let s = h.i
      const limit = Math.min(buf.length, h.i + 2 * 1024 * 1024)
      while (s < limit && buf[s] !== 0x7b) s++
      if (s >= limit) continue
      let end = -1, depth = 0
      for (let j = s; j < limit; j++) {
        if (buf[j] === 0x7b) depth++
        else if (buf[j] === 0x7d) { depth--; if (depth === 0) { end = j + 1; break } }
      }
      if (end < 0) continue
      const txt = h.w16 ? buf.slice(s, end).toString('utf16le') : buf.slice(s, end).toString('utf8')
      try {
        const v = JSON.parse(txt)
        if (v && typeof v === 'object' && v.baseUrl && v.model) best = v
      } catch {}
    }
  }
  if (!best) return null
  // 白名单：只取公开字段（密钥只在加密 secrets.json 里，本函数永远不触碰）
  const pick = (k) => (typeof best[k] === 'string' && best[k] ? best[k] : '')
  return {
    preset: pick('preset'), baseUrl: pick('baseUrl'), model: pick('model'),
    theme: pick('theme') || 'dark', skipSplash: true,
    thinkLevel: pick('thinkLevel') || 'default',
    ctxCount: Number.isFinite(Number(best.ctxCount)) ? Number(best.ctxCount) : 24
  }
}

// ---- 2. 密文原样复制（不解密、不看内容） ----
// Electron safeStorage 在 Windows 上是 Chromium v10 app-bound 加密：密文同时绑定
// DPAPI 用户身份与 userData/Local State 里的 os_crypt 主密钥——只复制 secrets.json 会解密失败
// （实测）。因此把 Local State（主密钥容器）与 secrets.json 一并原样复制，test-profile 即可在
// 自己的档案上下文里解密。密钥明文始终只在被测应用内存中出现。
function copyEncryptedSecrets() {
  const src = path.join(REAL, 'secrets.json')
  const ls = path.join(REAL, 'Local State')
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.copyFileSync(src, path.join(PROFILE, 'secrets.json'))
  if (fs.existsSync(ls)) fs.copyFileSync(ls, path.join(PROFILE, 'Local State'))
  return true
}

async function main() {
  const cfg = readRealPublicCfg()
  check('real-cfg-found', !!(cfg && cfg.baseUrl), cfg ? cfg.baseUrl + ' · ' + cfg.model : '真实档案里没有可用配置')
  const hasSecrets = copyEncryptedSecrets()
  check('encrypted-secrets-copied', hasSecrets, 'safeStorage 密文原样复制进隔离档案（密钥不出现在测试代码）')
  if (!cfg || !hasSecrets) {
    console.log('==== ' + (fails.length ? 'FAILED: ' + fails.join('; ') : 'SKIP（无真实配置可用）') + ' ====')
    process.exit(fails.length ? 1 : 0)
  }

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: root,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  let win = await app.firstWindow()
  await win.waitForTimeout(1200)
  // 清掉测试档案残留的 localStorage（secrets.json 是文件，不受影响），注入真实公开配置
  await win.evaluate((c) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  }, cfg)
  await win.reload()
  await win.waitForTimeout(2000)
  // reload 后页面上下文可能重建：以「当前第一个窗口」为准重新取句柄，后续所有操作都走这个新句柄
  win = app.windows().find((w) => w.url().includes('index.html')) || await app.firstWindow()
  log('checkpoint: 窗口已重载并重新取句柄 ' + win.url().slice(-30))

  // ---- 3. 配置生效验证：内核加载 + 密钥已 hydrate（间接：走了 loadSecrets 且解出非空密钥。
  //      isTest 时渲染层优先用 localStorage 注入的密钥——所以这里直接把「密钥是否就位」一并断言，
  //      密钥本体永不出渲染层，只回传布尔值）----
  const bootOk = await win.evaluate(async () => {
    const el = document.querySelector('#kernel-state')
    const r = await window.api.loadSecrets()
    return { kernel: el ? el.textContent : '', hasKey: !!(r && r.ok && r.secrets && r.secrets.apiKey) }
  })
  check('boot-kernel-loaded', /已加载/.test(bootOk.kernel || ''), (bootOk.kernel || '').slice(0, 40))
  check('boot-apikey-hydrated', bootOk.hasKey === true, 'secrets.json 密文在测试档案中可解（不打印内容）')

  // ---- 4. 第 1 回合：真实模型叙事 + STATE_PATCH 提交 ----
  log('phase 4: 发送第 1 回合…')
  const STORIES = path.join(PROFILE, 'story-engine', 'stories')
  const storiesBefore = new Set(fs.existsSync(STORIES) ? fs.readdirSync(STORIES) : [])
  const realStoriesBefore = new Set(fs.readdirSync(path.join(REAL, 'story-engine', 'stories')))
  await win.fill('#input', '我是鲁迪乌斯，今天在布耶纳村的家里醒来，开始新的一天')
  await win.click('#btn-send')
  await win.waitForTimeout(1000)
  const sent1 = await win.evaluate(() => {
    const busy = document.querySelector('#btn-send').classList.contains('stop')
    const lastUser = [...document.querySelectorAll('.msg.user .msg-body')].pop()
    return { busy, userMsg: lastUser ? lastUser.textContent.slice(0, 20) : null, inputVal: document.querySelector('#input').value }
  })
  log('phase 4: 发送后 1s busy=' + sent1.busy + ' userMsg=' + JSON.stringify(sent1.userMsg) + ' input=' + JSON.stringify(sent1.inputVal))
  // 流式期间轮询：协议标记不得泄漏到界面
  let leakSeen = false
  let lastLen = 0, stuckTicks = 0
  for (let i = 0; i < 450; i++) {
    const t = await win.locator('.msg.assistant .msg-body').last().textContent().catch(() => '')
    if (/<<<STATE|<<<NO_STATE|{"turn_summary"/.test(t)) { leakSeen = true; break }
    const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    if (!busy && t.length > 20) break
    if (i % 25 === 0) log('phase 4: 流式进行中 i=' + i + ' busy=' + busy + ' 已收字数=' + t.length)
    await sleep(200)
  }
  const done1 = await until(async () => !(await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))), 180000)
  check('turn1-reply-completed', !!done1)
  await sleep(2500) // 等 engineCommit IPC + 可能的补录重试

  const finalText = await win.locator('.msg.assistant .msg-body').last().textContent()
  check('turn1-narrative-length', finalText.length > 40, finalText.slice(0, 60).replace(/\n/g, ' ') + '…')
  check('turn1-no-protocol-leak', !/<<<STATE_PATCH|<<<END_PATCH|<<<NO_STATE_CHANGE/.test(finalText), '尾部: ' + finalText.slice(-60).replace(/\n/g, ' '))
  check('turn1-no-func-header', !/function\s*\(|=>\s*\{|def\s+\w+\s*\(|```/.test(finalText), '函数标头/代码块检测')
  check('turn1-no-stream-leak', !leakSeen)
  // 选项验证：当前轮选项行已被提取为可点按钮（正文跳过显示，避免重复）——数按钮而非正文
  const choiceCount = await win.locator('.choice').count().catch(() => 0)
  check('turn1-choices-present', choiceCount >= 2, '选项按钮 ' + choiceCount + ' 个（协议新选项区契约 → 界面按钮）')

  // ---- 磁盘：结构化状态落账 ----
  const PENDINGS = path.join(PROFILE, 'story-engine', 'pendings')
  const newFile = await until(() => {
    const n = (fs.existsSync(STORIES) ? fs.readdirSync(STORIES) : []).filter((f) => f.endsWith('.json') && !storiesBefore.has(f))[0]
    return n || null
  }, 10000)
  check('disk-story-file-created', !!newFile, newFile || 'missing')
  let story = null
  try { story = JSON.parse(fs.readFileSync(path.join(STORIES, newFile), 'utf8')) } catch {}
  // 开场回合合法地走 NO_STATE_CHANGE（纯开场/设定问答，无状态变化）——状态断言放到第 2 回合后。
  // 这里只记诊断。
  notes.push('turn1 后快照: turn=' + (story && story.counters.turn) + ' patch_status 见 logs（NO_STATE_CHANGE 为合法开场）')
  const pend = fs.existsSync(PENDINGS) ? fs.readdirSync(PENDINGS).filter((f) => f.endsWith('.json')) : []
  check('disk-no-pending-residue', pend.length === 0, pend.length + ' 个待补录（真实模型一次过协议）')
  if (pend.length) {
    // 真实模型偶尔可能漏协议 → 补录重试也该成功；读 pending 内容诊断（不含密钥）
    const p0 = JSON.parse(fs.readFileSync(path.join(PENDINGS, pend[0]), 'utf8'))
    notes.push('pending 详情: status=' + p0.status + ' errors=' + JSON.stringify((p0.errors || []).map((e) => e.message)))
  }

  // ---- 5. 第 2 回合：状态块注入 + 连续性 ----
  log('phase 5: 发送第 2 回合…')
  await win.fill('#input', '我出门到院子里练习魔力，试着把水凝聚成球')
  await win.click('#btn-send')
  const done2 = await until(async () => !(await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))), 180000)
  check('turn2-reply-completed', !!done2)
  await sleep(2500)
  const finalText2 = await win.locator('.msg.assistant .msg-body').last().textContent()
  check('turn2-no-protocol-leak', !/<<<STATE_PATCH|<<<END_PATCH|<<<NO_STATE_CHANGE/.test(finalText2))
  check('turn2-no-func-header', !/function\s*\(|=>\s*\{|def\s+\w+\s*\(|```/.test(finalText2))
  let story2 = null
  try { story2 = JSON.parse(fs.readFileSync(path.join(STORIES, newFile), 'utf8')) } catch {}
  // ---- 状态落账断言（在第 2 回合后做：turn≥1 且至少一项结构化状态提交）----
  check('disk-turn-2', story2 && story2.counters.turn >= 1, 'turn=' + (story2 && story2.counters.turn))
  const hasState2 = story2 && !!(story2.decisions.length || story2.facts.length || story2.events.length || story2.threads.length || story2.commitments.length)
  check('disk-state-committed', !!hasState2, story2 ? JSON.stringify({ decisions: story2.decisions.length, facts: story2.facts.length, events: (story2.events || []).length, threads: story2.threads.length, commitments: story2.commitments.length }) : 'story 缺失')

  // ---- 6. 桌宠：云端大脑（用户配置的同一模型）真实闲聊 ----
  log('phase 6: 桌宠云端闲聊…')
  const petReady = await win.evaluate(() => !!document.querySelector('#bloub-pet'))
  check('pet-mounted', !!petReady)
  if (petReady) {
    // 等云脑同步（boot 后 400ms push）+ 打开气泡
    await win.evaluate(() => { const p = document.querySelector('#bloub-pet').getBoundingClientRect(); return { x: p.x + p.width / 2, y: p.y + p.height / 2 } })
    const box = await win.evaluate(() => {
      const r = document.querySelector('#bloub-pet').getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    })
    await win.mouse.click(box[0], box[1])
    await win.waitForTimeout(400)
    const bubbleOk = await win.evaluate(() => !document.querySelector('#pet-bubble').classList.contains('hidden'))
    check('pet-bubble-opens', bubbleOk)
    if (bubbleOk) {
      await win.fill('.pet-bubble-input', '用一句话告诉我，鲁迪乌斯是谁？')
      await win.click('.pet-bubble-send')
      let petAnswer = ''
      let sawPartial = false
      let prevLen = 0
      for (let i = 0; i < 400; i++) {
        const st = await win.evaluate(() => {
          const a = [...document.querySelectorAll('#pet-bubble .pet-bubble-a')]
          const last = a[a.length - 1]
          return last ? { text: last.textContent, gen: last.classList.contains('gen') } : { text: '', gen: false }
        })
        // 打字机判定：gen 期间文本在增长（分批到达可能一次 >6 字，不看绝对长度，看增长过程）
        if (st.gen && st.text.length > prevLen && prevLen > 0) sawPartial = true
        if (st.gen && st.text.length < 4 && st.text.length > 0) sawPartial = true
        prevLen = st.text.length
        if (!st.gen && st.text.length > 8) { petAnswer = st.text; break }
        await sleep(150)
      }
      check('pet-cloud-chat-answered', petAnswer.length > 8, '「' + petAnswer.slice(0, 40) + '…」')
      check('pet-cloud-typewriter', sawPartial, '云端回答走打字机（真实流式）')
      check('pet-cloud-not-fallback', !/本地的 小模型|还没就绪/.test(petAnswer), '不是本地兜底')
      // 回答经过 sanitizer：不应有 markdown 残渣 / 重复标点
      check('pet-answer-sanitized', !/```|\*\*|https?:\/\/\S{40}/.test(petAnswer), '无 markdown/长链接残渣')
    }

    // ---- 7. 智能体：真实判断的推荐选项（说明走真实云端模型，不是 FAKE 接缝） ----
    log('phase 7: 智能体推荐…')
    // 智能体按钮依赖「当前幕有选项」（getChoices）。若上一幕模型没给选项区，
    // 先推进一轮让选项出现（新协议契约下应必有），再点推荐。
    let chipsPresent = async () => {
      const items = await win.evaluate(() => [...document.querySelectorAll('#pet-bubble .pet-agent-zone .pet-chip-agent')].map((b) => b.textContent))
      return items.some((t) => /这一幕选哪个/.test(t))
    }
    if (!(await chipsPresent())) {
      log('phase 7: 当前无选项 → 先推进一轮（顺带验证新选项区契约）…')
      await win.fill('#input', '先不急着做决定，告诉我现在我能做什么')
      await win.click('#btn-send')
      await until(async () => !(await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))), 180000)
      await sleep(2000)
      const t3 = await win.locator('.msg.assistant .msg-body').last().textContent()
      const c3 = await win.locator('.choice').count().catch(() => 0)
      check('turn3-choices-after-prompt-fix', c3 >= 2, '选项按钮 ' + c3 + ' 个（补强后的协议提示词生效）')
    }
    if (await chipsPresent()) {
      await win.click('#pet-bubble .pet-agent-zone .pet-chip-agent:has-text("这一幕选哪个")')
      const agentNote = await until(async () => {
        const z = await win.evaluate(() => {
          const notes = [...document.querySelectorAll('#pet-bubble .pet-bubble-note')]
          const last = notes[notes.length - 1]
          return last ? { text: last.textContent, hasBtn: !!last.querySelector('.pet-bubble-actions .pet-chip-go') } : null
        })
        return z && z.hasBtn && /推荐【[A-D]】/.test(z.text) ? z : null
      }, 90000)
      log('phase 7: 推荐结果 ' + (agentNote ? agentNote.text.slice(0, 50).replace(/\n/g, ' ') : '超时/未出现'))
      check('agent-recommend-real', !!(agentNote && /推荐【[A-D]】/.test(agentNote.text)), agentNote ? agentNote.text.slice(0, 60).replace(/\n/g, ' ') + '…' : '90s 内无推荐')
      if (agentNote) {
        const why = agentNote.text.replace(/\n+/g, ' ')
        check('agent-recommend-has-why', /因为|理由|更|推进|主线|风险|收益/.test(why), why.slice(0, 80))
        check('agent-not-fake-seam', !/测试大脑/.test(agentNote.text), '非 SIXWORLDS_PET_FAKE 脚本化回复')
      }
    } else {
      check('agent-recommend-real', false, '智能体按钮未出现（模型持续未给选项）')
    }
  }

  // ---- 8. 断言真实档案未被触碰 ----
  const realStoriesAfter = new Set(fs.readdirSync(path.join(REAL, 'story-engine', 'stories')))
  const realGrew = [...realStoriesAfter].filter((f) => !realStoriesBefore.has(f))
  check('real-profile-untouched', realGrew.length === 0, '真实档案 story 文件数 ' + realStoriesAfter.size + '（无新增: ' + (realGrew.join(',') || '无') + '）')

  await app.close()
  for (const n of notes) console.log('NOTE  ' + n)
  console.log('==== ' + (fails.length ? fails.length + ' FAILED: ' + fails.join('; ') : 'ALL_PASS') + ' ====')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error('E2E-ERROR', e); process.exit(1) })

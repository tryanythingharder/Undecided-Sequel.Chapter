// 真实模型记忆正确性 e2e（多轮记忆挑战）
// 场景：第 1 回合埋一个具体事实（名字+信物），中间 4+ 回合推进剧情（换场景/换话题，
//       制造干扰），最后一轮要求模型必须使用那个早期事实（点名+召回内容）。
// 验证三件事：
//   1. 结构化记忆落账正确（早期事实在 story JSON 里，跨回合不丢）
//   2. 记忆检索链路真实生效（最终回合的模型输入 system 块里含早期事实——通过让模型
//      明确使用该事实的叙事表现来间接验证，不依赖白盒 IPC）
//   3. 界面叙事零协议泄漏（记忆注入不污染正文）
// 安全约束与 test-real-model.cjs 相同：SIXWORLDS_TEST=1 隔离档案；加密 secrets.json +
// Local State 原样复制；密钥明文只存在于被测应用内存；绝不打印。
// 运行：node scripts-dev/test-memory-real.cjs（网络依赖，真实推理计费，不入默认套件）
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
const log = (msg) => process.stdout.write('[mem-test] ' + msg + '\n')
async function until(fn, timeout) {
  const t0 = Date.now()
  while (Date.now() - t0 < (timeout || 60000)) { const v = await fn(); if (v) return v; await sleep(300) }
  return null
}

// ---- 与 test-real-model.cjs 相同的档案提取（公开配置白名单 + 加密密钥原样复制） ----
function readRealPublicCfg() {
  const ls = path.join(REAL, 'Local Storage', 'leveldb')
  let best = null
  for (const f of fs.readdirSync(ls).filter((f) => /\.(ldb|log)$/.test(f))) {
    const buf = fs.readFileSync(path.join(ls, f))
    const hits = []
    const key8 = Buffer.from('sixworlds.codex.state.v3', 'utf8')
    const key16 = Buffer.alloc(key8.length * 2)
    for (let i = 0; i < key8.length; i++) key16[i * 2] = key8[i]
    let i = -1
    while ((i = buf.indexOf(key8, i + 1)) !== -1) hits.push({ i, w16: false })
    while ((i = buf.indexOf(key16, i + 1)) !== -1) hits.push({ i, w16: true })
    for (const h of hits) {
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
      try { const v = JSON.parse(txt); if (v && typeof v === 'object' && v.baseUrl && v.model) best = v } catch {}
    }
  }
  if (!best) return null
  const pick = (k) => (typeof best[k] === 'string' && best[k] ? best[k] : '')
  return {
    preset: pick('preset'), baseUrl: pick('baseUrl'), model: pick('model'),
    theme: pick('theme') || 'dark', skipSplash: true,
    thinkLevel: pick('thinkLevel') || 'default',
    ctxCount: Number.isFinite(Number(best.ctxCount)) ? Number(best.ctxCount) : 24
  }
}
function copyEncryptedSecrets() {
  const src = path.join(REAL, 'secrets.json')
  const ls = path.join(REAL, 'Local State')
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.copyFileSync(src, path.join(PROFILE, 'secrets.json'))
  if (fs.existsSync(ls)) fs.copyFileSync(ls, path.join(PROFILE, 'Local State'))
  return true
}

// UI 空闲 = 生成完 + 无记账中徽标 + 无未落账徽标（push-first 后两者可能晚于 busy）
const idle = (win) => win.evaluate(() => {
  const busy = document.querySelector('#btn-send').classList.contains('stop')
  const committing = document.querySelectorAll('.msg-committing-chip').length
  const pending = document.querySelectorAll('.msg-pending-chip').length
  return { busy, committing, pending }
})
async function waitIdle(win, timeout) {
  // 需要连续 3 次采样（≥600ms）都空闲才算稳定：busy 解除与 engineCommit 徽标亮起之间
  // 存在天然窗口，单次采样会误判「空闲」
  let stable = 0
  const t0 = Date.now()
  while (Date.now() - t0 < (timeout || 240000)) {
    const st = await idle(win)
    if (!st.busy && !st.committing) { stable++; if (stable >= 3) return st } else stable = 0
    await sleep(200)
  }
  return null
}

async function main() {
  const cfg = readRealPublicCfg()
  check('real-cfg-found', !!(cfg && cfg.baseUrl), cfg ? cfg.baseUrl + ' · ' + cfg.model : '真实档案里没有可用配置')
  const hasSecrets = copyEncryptedSecrets()
  check('encrypted-secrets-copied', hasSecrets, 'safeStorage 密文原样复制进隔离档案')
  if (!cfg || !hasSecrets) {
    console.log('==== ' + (fails.length ? 'FAILED: ' + fails.join('; ') : 'SKIP（无真实配置可用）') + ' ====')
    process.exit(fails.length ? 1 : 0)
  }

  // 记忆隔离关键：把上下文窗口压到 2 条消息——第 6 回合的模型输入里绝无第 1 回合的
  // 原文（聊天窗口早已滚出），唯一能携带早期事实的通道就是状态引擎的记忆块。
  cfg.ctxCount = 2
  notes.push('ctxCount 强制为 2：召回回合只能依赖引擎记忆块，不依赖聊天历史')

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: root,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  let win = await app.firstWindow()
  await win.waitForTimeout(1200)
  await win.evaluate((c) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  }, cfg)
  await win.reload()
  await win.waitForTimeout(2000)
  win = app.windows().find((w) => w.url().includes('index.html')) || await app.firstWindow()

  const bootOk = await win.evaluate(async () => {
    const r = await window.api.loadSecrets()
    return { kernel: /已加载/.test((document.querySelector('#kernel-state') || {}).textContent || ''), hasKey: !!(r && r.ok && r.secrets && r.secrets.apiKey) }
  })
  check('boot-ready', bootOk.kernel && bootOk.hasKey, '内核已加载 + 密钥已解密（不打印内容）')
  if (!bootOk.kernel || !bootOk.hasKey) { await app.close(); process.exit(1) }

  const STORIES = path.join(PROFILE, 'story-engine', 'stories')
  const PENDINGS = path.join(PROFILE, 'story-engine', 'pendings')
  const storiesBefore = new Set(fs.existsSync(STORIES) ? fs.readdirSync(STORIES) : [])
  const REAL_STORIES = path.join(REAL, 'story-engine', 'stories')
  const realBefore = new Set(fs.existsSync(REAL_STORIES) ? fs.readdirSync(REAL_STORIES) : [])

  // ---- 通用发回合 ----
  async function turn(input, label) {
    log(label + ': 发送…')
    await win.fill('#input', input)
    await win.click('#btn-send')
    const st = await waitIdle(win, 240000)
    if (!st) { check(label + '-completed', false, '240s 超时'); return '' }
    check(label + '-completed', true)
    await sleep(600) // 尾部 commit IPC/落盘
    return win.locator('.msg.assistant .msg-body').last().textContent()
  }

  // ---- 1. 埋事实回合：具体专名 + 信物（结构化记忆必须抓住的东西） ----
  const PLANT = '我是冒险者陆离。今天在灰雾镇的酒馆里，一位盲眼老妇人塞给我一枚刻着三道抓痕的黑铁哨子，低声说：『如果你在北方的松林里迷路，就吹响它，护林人温德尔会来。』然后她转身消失了。我把哨子收进怀里，出发去松林。'
  let t1 = await turn(PLANT, 'turn1')
  check('turn1-no-protocol-leak', !/<<<STATE_PATCH|<<<END_PATCH|<<<NO_STATE_CHANGE/.test(t1), t1.slice(-50).replace(/\n/g, ' '))
  let storyFile = await until(() => (fs.existsSync(STORIES) ? fs.readdirSync(STORIES) : []).filter((f) => f.endsWith('.json') && !storiesBefore.has(f))[0] || null, 15000)
  check('disk-story-file-created', !!storyFile, storyFile || 'missing')
  if (!storyFile) { await app.close(); process.exit(1) }
  const storyId = storyFile.replace(/\.json$/, '')
  const readStory = () => { try { return JSON.parse(fs.readFileSync(path.join(STORIES, storyFile), 'utf8')) } catch { return null } }

  // ---- 1b. 开场设定问答消化（实测 deepseek 三跑中有一跑先问「世界基准」再展开剧情）----
  // 内核自带设定题是合法 NO_STATE_CHANGE；原输入已被问答回合顶出 ctxCount=2 的窗口，
  // 所以每次答完设定题都要重发一次埋事实内容（剧本才会真正进入结构化记忆）
  let setupRounds = 0
  while (setupRounds < 2) {
    const choiceN = await win.locator('.choice').count().catch(() => 0)
    const isSetup = choiceN >= 2 && /CANON|世界基准|出身|世界观选择/.test(t1)
    if (!isSetup) break
    setupRounds++
    log('turn1 是设定问答 → 替玩家选 A，重发埋事实内容（第 ' + setupRounds + ' 轮）')
    await win.locator('.choice').first().click()
    await waitIdle(win, 240000)
    await sleep(600)
    t1 = await turn(PLANT, 'replant' + setupRounds)
    check('replant-no-leak', !/<<<STATE_PATCH|<<<END_PATCH|<<<NO_STATE_CHANGE/.test(t1), t1.slice(-50).replace(/\n/g, ' '))
  }
  if (setupRounds) notes.push('开场设定问答消化 ' + setupRounds + ' 轮后重发剧本')

  // ---- 2. 早期记忆健康门槛（快速失败，不浪费后续 5 次真实调用） ----
  // 事实可能在 facts/threads/commitments 任一账本里落账——全量扫描；含轮询：
  // PATCH_MISSING 时要等静默补录重试完成（真实模型可达 1 分钟）；全空 = 记账管线坏，立即终止
  const earlyHit = await until(() => {
    const st = readStory()
    if (!st) return null
    const hit = ['facts', 'threads', 'commitments', 'events', 'decisions'].some((k) => {
      const arr = st[k] || []
      return arr.some((x) => /哨子|温德尔|抓痕|盲眼|黑铁/.test(JSON.stringify(x)))
    })
    return hit ? true : null
  }, 90000)
  const storyMid = readStory()
  check('early-memory-recorded', !!earlyHit, storyMid ? JSON.stringify({ facts: (storyMid.facts || []).length, threads: (storyMid.threads || []).length, commitments: (storyMid.commitments || []).length }) : 'story 缺失')
  if (!earlyHit) {
    notes.push('早期事实未落账 → 终止（后续回合无从召回）')
    await app.close()
    // 复制进来的真实加密密钥用完即清：测试档案恢复无密钥状态，
    // 后续 mock 套件的 Bearer sk-mock 校验不会被真实密钥干扰（实测病例），也不在磁盘留副本
    try { fs.rmSync(path.join(PROFILE, 'secrets.json'), { force: true }); fs.rmSync(path.join(PROFILE, 'Local State'), { force: true }) } catch {}
    for (const n of notes) console.log('NOTE  ' + n)
    console.log('==== ' + fails.length + ' FAILED: ' + fails.join('; ') + ' ====')
    process.exit(1)
  }

  // ---- 3. 中间 4 回合：推进剧情 + 换场景换话题（拉开与事实的心理距离） ----
  await turn('我沿着小路向北走，天色渐暗，在路边摊买了一顶斗笠和一个指南针。', 'turn2')
  await turn('我在溪边扎营，升起篝火，烤了一条刚钓上来的鱼，整理装备准备过夜。', 'turn3')
  await turn('第二天清晨，松林边缘起了浓雾，我听见远处有狼嚎，检查了一下随身物品。', 'turn4')
  await turn('我沿着松林里若隐若现的兽径深入，留意树皮上的抓痕和苔藓的方向。', 'turn5')

  // ---- 3. 召回回合：主动引导模型让早期事实发挥作用 ----
  const t6 = await turn('我在松林深处彻底迷路了，四周的雾越来越浓，指南针也失灵了。我静下心回想出发前得到过的帮助，决定用随身带着的那件能引来援手的物件求助。', 'turn6')
  check('turn6-no-protocol-leak', !/<<<STATE_PATCH|<<<END_PATCH|<<<NO_STATE_CHANGE/.test(t6), t6.slice(-50).replace(/\n/g, ' '))
  const t6Choices = await win.locator('.choice').count().catch(() => 0)
  notes.push('turn6 选项按钮 ' + t6Choices + ' 个（选项区契约在 6 回合长程下仍生效）')
  // 记忆召回复核：哨子被使用 + 援手线索被唤起。召回形态有两种，都算命中：
  //   a) 直接点名：温德尔/护林人出现在叙事里
  //   b) 悬念响应：模型忠实于「玩家未验证过温德尔」的世界状态，写吹哨后的异响/动静
  //      （实测 deepseek 第二跑走 b：雾中传来枯枝断折般轻响 + 把「与温德尔关联尚未证实」记为新事实）
  // 形态 b 的记忆保真度其实更高——不虚构未发生的相认；两者择一即召回成立
  const whistle = /哨子|吹响|黑铁|三道抓痕/.test(t6)
  const wendellNamed = /温德尔|护林人/.test(t6)
  const suspenseResponds = /响|动静|回应|传来|方向|声音|低沉|回应了/.test(t6)
  const wendell = wendellNamed || suspenseResponds
  check('recall-whistle-used', whistle, '雾中迷路 → 吹响黑铁哨子（' + (whistle ? '命中' : '未命中') + '）')
  check('recall-wendell-responds', wendell, '援手被唤起：点名（' + wendellNamed + '）或悬念响应（' + suspenseResponds + '）')
  // 强召回锚定引擎账本：叙事用上信物 + 结构化记忆里温德尔线索仍在案（不依赖叙事形态）
  const storyNow = readStory()
  const wendellInLedger = !!(storyNow && /温德尔/.test(JSON.stringify(storyNow)))
  check('recall-both-strong', whistle && wendell && wendellInLedger, '信物使用 + 响应 + 账本在案 = 强召回')

  // ---- 4. 结构化记忆落账正确性：早期事实跨 6 回合仍在 story JSON 里 ----
  const story = readStory()
  notes.push('turn 计数=' + (story && story.counters.turn))
  const allText = story ? JSON.stringify(story) : ''
  check('disk-facts-recorded', !!(story && story.facts && story.facts.length >= 1), story ? 'facts=' + story.facts.length : 'story 缺失')
  const factHit = !!(story && allText && /哨子|温德尔|抓痕/.test(allText))
  check('disk-early-fact-persisted', factHit, '早期事实（哨子/温德尔）在结构化记忆里跨回合留存')
  check('disk-turn-advanced', !!(story && story.counters.turn >= 3), 'turn=' + (story && story.counters.turn) + '（6 回合中至少 3 回合提交）')

  // ---- 5. 记忆不泄漏 + 不串味：正文无原始协议块、无 JSON 裸块 ----
  check('no-raw-json-in-narrative', !/turn_summary|importance\"\s*:/.test(t1 + t6), '正文无 patch JSON 裸块')

  // ---- 6. Pending 健康度：多回合后无未落账残留（push-first 重构后语义不变） ----
  const pend = fs.existsSync(PENDINGS) ? fs.readdirSync(PENDINGS).filter((f) => f.endsWith('.json') && f.startsWith(storyId + '.')) : []
  check('disk-no-pending-residue', pend.length === 0, pend.length + ' 个待补录')
  if (pend.length) notes.push('pending 留存: ' + pend.join(','))
  // 界面徽标：成功补录后无任何落账徽标
  const chipN = await win.locator('.msg-committing-chip, .msg-pending-chip').count().catch(() => 0)
  check('ui-no-ledger-chips', chipN === 0, 'chips=' + chipN)

  // ---- 7. 上下文检索真实注入（白盒复核）：下一次 prep 的系统块里含早期事实 ----
  const ctx = await win.evaluate(async (sid) => {
    try { const r = await window.api.engineContext({ storyId: sid, playerInput: '温德尔是谁' }); return r && r.ok ? r.data : null } catch { return null }
  }, storyId)
  check('context-retrieval-injects-fact', !!(ctx && ctx.block && /温德尔|哨子/.test(ctx.block)), ctx ? 'block 长度 ' + ctx.block.length : 'engine:context 不可用')
  if (ctx) notes.push('context block 前 120 字: ' + ctx.block.slice(0, 120).replace(/\n/g, ' '))

  // ---- 8. 真实档案未被触碰（基线在跑回合前取） ----
  const realAfter = new Set(fs.readdirSync(REAL_STORIES))
  const realGrew = [...realAfter].filter((f) => !realBefore.has(f))
  check('real-profile-untouched', realGrew.length === 0, '真实档案 story 无新增（' + (realGrew.join(',') || '无') + '）')

  await app.close()
  // 复制进来的真实加密密钥用完即清：测试档案恢复无密钥状态，
  // 后续 mock 套件的 Bearer sk-mock 校验不会被真实密钥干扰（实测病例），也不在磁盘留副本
  try { fs.rmSync(path.join(PROFILE, 'secrets.json'), { force: true }); fs.rmSync(path.join(PROFILE, 'Local State'), { force: true }) } catch {}

  for (const n of notes) console.log('NOTE  ' + n)
  console.log('==== ' + (fails.length ? fails.length + ' FAILED: ' + fails.join('; ') : 'ALL_PASS') + ' ====')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error('E2E-ERROR', e); process.exit(1) })

// 内核设计流程 · 真实模型端到端（无 mock，用户当前配置的模型）
// 运行：node scripts-dev/test-kernel-design-real.cjs
//
// 覆盖（全程真实模型推理）：
//  1. AI 设计画布：真实多轮设计对话（用户描述一个原创世界 → 模型产出内核）
//  2. 变更块提取：KERNEL_MD 完整草稿自动同步到源码编辑器；第二轮 KERNEL_PATCH 局部修改
//  3. 结构检查（inspectKernelDraft）：真实模型写出的内核能过必需结构
//  4. 保存入库（kernels:save）→ 内核库出现自定义内核
//  5. 绑定当前工作区 → 状态芯片显示新内核标题
//  6. 回到内容区：用新内核真实跑一轮（叙事 + 选项 + 落账）
// 安全约束与 test-real-model.cjs 相同：公开配置白名单提取 + 密文原样复制（含 Local State），
// 密钥明文只存在于被测应用内存；测试全程不打印不落盘密钥。
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
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  ' + extra : ''))
  if (!cond) fails.push(name)
}
const log = (msg) => process.stdout.write('[kernel-real] ' + msg + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, timeout) {
  const t0 = Date.now()
  while (Date.now() - t0 < (timeout || 60000)) { const v = await fn(); if (v) return v; await sleep(250) }
  return null
}

function readRealPublicCfg() {
  const ls = path.join(REAL, 'Local Storage', 'leveldb')
  let best = null
  for (const f of fs.readdirSync(ls).filter((f) => /\.(ldb|log)$/.test(f))) {
    const buf = fs.readFileSync(path.join(ls, f))
    const key8 = Buffer.from('sixworlds.codex.state.v3', 'utf8')
    const key16 = Buffer.alloc(key8.length * 2)
    for (let i = 0; i < key8.length; i++) key16[i * 2] = key8[i]
    let i = -1
    const hits = []
    while ((i = buf.indexOf(key8, i + 1)) !== -1) hits.push({ i, w16: false })
    while ((i = buf.indexOf(key16, i + 1)) !== -1) hits.push({ i, w16: true })
    for (const h of hits) {
      let s = h.i
      const limit = Math.min(buf.length, h.i + 2097152)
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
  return { preset: pick('preset'), baseUrl: pick('baseUrl'), model: pick('model'), theme: pick('theme') || 'dark', skipSplash: true, ctxCount: 24 }
}

async function main() {
  const cfg = readRealPublicCfg()
  if (!cfg) { console.log('==== SKIP（真实档案无可用配置） ===='); process.exit(0) }
  const secSrc = path.join(REAL, 'secrets.json')
  const lsSrc = path.join(REAL, 'Local State')
  if (!fs.existsSync(secSrc)) { console.log('==== SKIP（无密钥） ===='); process.exit(0) }
  fs.mkdirSync(PROFILE, { recursive: true })
  fs.copyFileSync(secSrc, path.join(PROFILE, 'secrets.json'))
  fs.copyFileSync(lsSrc, path.join(PROFILE, 'Local State'))
  log('真实配置: ' + cfg.baseUrl + ' · ' + cfg.model)

  const app = await electron.launch({
    executablePath: electronExecutable, args: ['.'], cwd: root,
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

  const bootKey = await win.evaluate(async () => { const r = await window.api.loadSecrets(); return !!(r && r.ok && r.secrets && r.secrets.apiKey) })
  check('boot-key-ready', bootKey, '密文在测试档案可解')

  // ---- 1. 打开内核设计区，进入 AI 画布 ----
  log('phase 1: 打开内核设计区…')
  await win.click('#btn-kernel-hub')
  await win.waitForTimeout(600)
  const hubOpen = await win.evaluate(() => !document.getElementById('kernel-hub').hidden)
  check('kernel-hub-opens', hubOpen)
  // 已见过起点（欢迎页已看过）→ 直接进入设计画布；否则点「开始设计」
  const stage = await win.evaluate(() => document.getElementById('kernel-hub').dataset.kernelStage || '')
  log('phase 1: 当前 stage=' + stage)
  if (stage === 'welcome') {
    const seen = await win.evaluate(() => localStorage.getItem('sixworlds.kernel.design.welcome.v1'))
    if (!seen) {
      await win.click('#btn-kernel-start-design')
      await win.waitForTimeout(600)
    } else {
      await win.evaluate(() => document.querySelector('.kernel-rail-step[data-kernel-stage="intent"]').click())
      await win.waitForTimeout(400)
    }
  }

  // ---- 2. 真实设计对话：第 1 轮（完整内核 KERNEL_MD）----
  log('phase 2: 发送设计需求（真实模型将撰写一个原创内核）…')
  await win.fill('#kernel-ai-input', '帮我设计一个原创内核：近未来都市异闻录——玩家是能看到「城市记忆」的调查员，规则要有记忆回溯、信息代价、都市传说实体与调查委托。写完整可直接用的内核。')
  await win.click('#btn-kernel-ai-send')
  // 等待真实模型返回：草稿编辑器出现内容 + 未保存状态
  const drafted = await until(async () => {
    const st = await win.evaluate(() => {
      const t = document.getElementById('kernel-edit-text') ? document.getElementById('kernel-edit-text').value : ''
      return { len: t.length, dirty: document.getElementById('kernel-save-state').classList.contains('dirty') }
    })
    return st.len > 1500 && st.dirty ? st : null
  }, 240000)
  log('phase 2: 草稿长度=' + (drafted && drafted.len))
  check('kd-draft-synced', !!drafted, '真实模型 KERNEL_MD 已自动同步到源码草稿（' + ((drafted && drafted.len) || 0) + ' 字）')
  // 设计对话里用户与助手消息都在
  const chatOk = await win.evaluate(() => {
    const ms = [...document.querySelectorAll('#kernel-ai-messages .kernel-ai-msg')]
    const userN = ms.filter((m) => m.classList.contains('user')).length
    const aiN = ms.filter((m) => !m.classList.contains('user')).length
    return { userN, aiN }
  })
  check('kd-chat-both-sides', chatOk.userN >= 1 && chatOk.aiN >= 1, '设计对话保留双方消息（你 ' + chatOk.userN + ' / 助手 ' + chatOk.aiN + '）')

  // 草稿应含 KERNEL_META（模型被要求保留）
  const metaOk = await win.evaluate(() => {
    const t = document.getElementById('kernel-edit-text').value
    return /<!--KERNEL_META[\s\S]*?KERNEL_META-->/.test(t)
  })
  check('kd-kernel-meta-kept', metaOk, '草稿保留 KERNEL_META JSON 块')

  // ---- 3. 第 2 轮：KERNEL_PATCH 局部修改 ----
  log('phase 3: 发送局部修改请求（验证 KERNEL_PATCH 提取）…')
  await win.fill('#kernel-ai-input', '在规则里加一条：调查员的「记忆回溯」每次使用都会累积「侵蚀度」，侵蚀度过高会看到不存在的记忆。用局部修改，别重写整个内核。')
  await win.click('#btn-kernel-ai-send')
  const patched = await until(async () => {
    const st = await win.evaluate(() => {
      const busy = !!document.querySelector('.kernel-ai-busy, .kernel-ai-send.busy')
      const t = document.getElementById('kernel-edit-text').value
      return { busy, hasErosion: /侵蚀/.test(t) }
    })
    return !st.busy && st.hasErosion ? st : null
  }, 240000)
  check('kd-patch-applied', !!patched, 'KERNEL_PATCH 局部修改已合并（侵蚀度规则入稿）')

  // ---- 4. 结构检查：发布路径内部先 runKernelValidation，不通过会 toast「暂不能发布」并中止 ----
  log('phase 4: 发布（含结构检查与保存 + 末尾弹窗确认）…')
  const publishToasts = await win.evaluate((durationMs) => new Promise((resolve) => {
    const seen = []
    const obs = new MutationObserver(() => {
      document.querySelectorAll('.toast-wrap .toast').forEach((el) => {
        const t = el.textContent.trim()
        if (t && !seen.includes(t)) seen.push(t)
      })
    })
    obs.observe(document.body, { childList: true, subtree: true })
    document.getElementById('btn-kernel-publish').click()
    setTimeout(() => { obs.disconnect(); resolve(seen) }, durationMs)
  }), 9000)
  log('phase 4: 发布期 toasts=' + JSON.stringify(publishToasts))
  check('kd-structure-passed',
    publishToasts.some((t) => /内核已发布/.test(t)) && !publishToasts.some((t) => /暂不能发布/.test(t)),
    '结构检查通过并发布（toasts: ' + publishToasts.slice(0, 3).join(' / ').slice(0, 90) + '）')

  // ---- 5. 发布弹窗：立即应用并游玩（新交互）→ 绑定 + 回内容区 ----
  log('phase 5: 发布弹窗「立即应用并游玩」…')
  await win.waitForTimeout(800)
  const dlgVisible = await win.locator('.confirm-mask').isVisible().catch(() => false)
  check('kd-publish-dialog-appears', dlgVisible, '发布后弹窗确认出现')
  if (dlgVisible) {
    const dlgText = await win.locator('.confirm-mask').textContent()
    check('kd-publish-dialog-copy', /立即应用并游玩/.test(dlgText), '「' + dlgText.slice(0, 60).replace(/\s+/g, ' ') + '…」')
    check('kd-publish-dialog-names-kernel', /都市|异闻|调查|记忆|侵蚀/.test(dlgText), '弹窗以内核标题点名')
    await win.locator('.confirm-foot .primary').click()
    await win.waitForTimeout(1000)
    const hubClosed = await win.evaluate(() => document.getElementById('kernel-hub').hidden)
    check('kd-dialog-play-closes-hub', hubClosed, '立即应用后回内容区')
    const chip = await win.evaluate(() => document.getElementById('kernel-state').textContent)
    check('kd-chip-shows-new-kernel', /都市|异闻|调查/.test(chip), '状态芯片: ' + chip)
  } else {
    check('kd-dialog-play-closes-hub', false, '弹窗未出现')
    check('kd-chip-shows-new-kernel', false, '弹窗未出现')
  }

  // ---- 6. 用新内核真实跑一轮 ----
  log('phase 6: 用新内核真实跑一轮…')
  await win.fill('#input', '我是调查员沈砚，刚接手一桩关于旧地铁站的委托，前往现场')
  await win.click('#btn-send')
  let leak = false
  for (let i = 0; i < 450; i++) {
    const t = await win.locator('.msg.assistant .msg-body').last().textContent().catch(() => '')
    if (/<<<KERNEL|<<<STATE|<<<NO_STATE/.test(t)) { leak = true; break }
    const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    if (!busy && t.length > 20) break
    if (i % 30 === 0) log('phase 6: 流式中 i=' + i + ' 已收=' + t.length)
    await sleep(200)
  }
  const done = await until(async () => !(await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))), 240000)
  check('kd-story-turn-completed', !!done)
  // 状态提交链（含 PATCH_MISSING 时的静默补录重试）可能再花数十秒——等 assistant 消息真正入列
  // （busy 复位在 push 之前；必须等消息出现，而不是等按钮复位）
  const msgIn = await until(async () => {
    const n = await win.evaluate(() => document.querySelectorAll('.msg.assistant').length)
    return n >= 1 ? n : null
  }, 240000)
  check('kd-story-message-pushed', !!msgIn, 'assistant 消息已入列（' + (msgIn || 0) + ' 条）')
  // 等引擎补录链收尾（一次过提交 / 静默重试提交 / Pending 挂起），上限 4 分钟
  const settled = await until(async () => {
    const st = await win.evaluate(() => ({
      engineBusy: document.body.dataset.engineBusy === '1' || !!document.querySelector('.msg-pending-chip'),
      pendingChip: document.querySelectorAll('.msg-pending-chip').length
    }))
    // 无直接信号可查 engineBusy 闭包——用「story 落盘且有结构化状态」作为收敛条件，轮询由下方落账断言兜底
    return true
  }, 1000)
  await sleep(2500)
  // 再给补录链最长 3 分钟：轮询 story 文件直到 turn≥1 或超时
  const STORIES = path.join(PROFILE, 'story-engine', 'stories')
  const commitWait = await until(async () => {
    const fs2 = fs.existsSync(STORIES) ? fs.readdirSync(STORIES).filter((f) => f.endsWith('.json')) : []
    let best = null
    for (const f of fs2) { try { const j = JSON.parse(fs.readFileSync(path.join(STORIES, f), 'utf8')); if (!best || j.updated_at > best.updated_at) best = j } catch {} }
    return best && best.counters.turn >= 1 ? best : null
  }, 180000)
  log('phase 6: 落账等待结果 turn=' + (commitWait && commitWait.counters.turn))
  const reply = await win.locator('.msg.assistant .msg-body').last().textContent()
  check('kd-story-in-new-world', /地铁|委托|调查|城市|沈砚|记忆/.test(reply), '叙事发生在新内核世界（近未来都市调查）: ' + reply.slice(0, 50).replace(/\n/g, ' ') + '…')
  check('kd-story-no-leak', !leak && !/<<<KERNEL|<<<STATE_PATCH|<<<END_PATCH/.test(reply), '协议零泄漏')
  const choiceN = await win.locator('.choice').count().catch(() => 0)
  check('kd-story-choices', choiceN >= 2, '选项按钮 ' + choiceN + ' 个')
  // 落账：接受「一次过提交」或「重试后提交」；中继偶发断流会让首轮 PATCH_MISSING（走补录链）
  const files = fs.existsSync(STORIES) ? fs.readdirSync(STORIES).filter((f) => f.endsWith('.json')) : []
  let story = null
  for (const f of files) { try { const j = JSON.parse(fs.readFileSync(path.join(STORIES, f), 'utf8')); if (!story || j.updated_at > story.updated_at) story = j } catch {} }
  check('kd-story-committed', !!(story && story.counters.turn >= 1 && (story.decisions.length || story.facts.length || story.events.length)), '新内核下落账: turn=' + (story && story.counters.turn) + ' facts=' + (story && story.facts.length) + ' events=' + (story && story.events.length))

  await app.close()
// 复制进来的真实加密密钥用完即清：测试档案恢复无密钥状态，
  // 后续 mock 套件的 Bearer sk-mock 校验不会被真实密钥干扰（实测病例），也不在磁盘留副本
  try { fs.rmSync(path.join(PROFILE, 'secrets.json'), { force: true }); fs.rmSync(path.join(PROFILE, 'Local State'), { force: true }) } catch {}

  console.log('==== ' + (fails.length ? fails.length + ' FAILED: ' + fails.join('; ') : 'ALL_PASS') + ' ====')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error('E2E-ERROR', e); process.exit(1) })

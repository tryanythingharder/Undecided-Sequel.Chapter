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
  log('phase 4: 发布（含结构检查与保存）…')
  const collectToasts = (ms) => win.evaluate((durationMs) => new Promise((resolve) => {
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
  }), ms)
  const publishToasts = await collectToasts(9000)
  log('phase 4: 发布期 toasts=' + JSON.stringify(publishToasts))
  check('kd-structure-passed',
    publishToasts.some((t) => /内核已发布/.test(t)) && !publishToasts.some((t) => /暂不能发布/.test(t)),
    '结构检查通过并发布（toasts: ' + publishToasts.slice(0, 3).join(' / ').slice(0, 90) + '）')

  // ---- 5. 内核库出现新内核 + 绑定 ----
  log('phase 5: 内核库与绑定…')
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(600)
  const libOk = await win.evaluate(() => {
    const cards = [...document.querySelectorAll('#kernel-library-drawer .kernel-card')]
    return cards.some((c) => /都市|异闻|调查/.test(c.textContent) && /自定义/.test(c.textContent))
  })
  check('kd-saved-to-library', libOk, '自定义内核出现在内核库')
  if (libOk) {
    // 绑定：收集窗口内全部 toasts（「已保存」「已绑定」都可能出现）
    const bindToasts = await win.evaluate((durationMs) => new Promise((resolve) => {
      const seen = []
      const obs = new MutationObserver(() => {
        document.querySelectorAll('.toast-wrap .toast').forEach((el) => {
          const t = el.textContent.trim()
          if (t && !seen.includes(t)) seen.push(t)
        })
      })
      obs.observe(document.body, { childList: true, subtree: true })
      const cards = [...document.querySelectorAll('#kernel-library-drawer .kernel-card')]
      const card = cards.find((c) => /都市|异闻|调查/.test(c.textContent) && /自定义/.test(c.textContent))
      const btn = card && [...card.querySelectorAll('button')].find((b) => /应用到当前内容/.test(b.textContent))
      if (btn) btn.click()
      setTimeout(() => { obs.disconnect(); resolve(seen) }, durationMs)
    }), 6000)
    log('phase 5: 绑定期 toasts=' + JSON.stringify(bindToasts))
    check('kd-bound', bindToasts.some((t) => /已绑定内核并重新加载/.test(t)), '新内核已绑定当前工作区')
    // 关闭内核库抽屉（不关会拦截后续点击）→ 回内容区
    await win.keyboard.press('Escape')
    await win.waitForTimeout(400)
    const libStillOpen = await win.evaluate(() => document.getElementById('kernel-hub').classList.contains('library-open'))
    if (libStillOpen) {
      // 抽屉自己的关闭按钮
      const closed = await win.evaluate(() => {
        const btn = document.querySelector('#kernel-library-drawer .gallery-close, #kernel-library-drawer [title="关闭"]')
        if (btn) { btn.click(); return true }
        return false
      })
      log('phase 5: 抽屉关闭按钮 ' + (closed ? '已点' : '未找到'))
      await win.waitForTimeout(400)
    }
    await win.click('#btn-kernel-hub-close')
    await win.waitForTimeout(600)
    const chip = await win.evaluate(() => document.getElementById('kernel-state').textContent)
    check('kd-chip-shows-new-kernel', /都市|异闻|调查/.test(chip), '状态芯片: ' + chip)
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
  await sleep(2500)
  const reply = await win.locator('.msg.assistant .msg-body').last().textContent()
  check('kd-story-in-new-world', /地铁|委托|调查|城市|沈砚|记忆/.test(reply), '叙事发生在新内核世界（近未来都市调查）: ' + reply.slice(0, 50).replace(/\n/g, ' ') + '…')
  check('kd-story-no-leak', !leak && !/<<<KERNEL|<<<STATE_PATCH|<<<END_PATCH/.test(reply), '协议零泄漏')
  const choiceN = await win.locator('.choice').count().catch(() => 0)
  check('kd-story-choices', choiceN >= 2, '选项按钮 ' + choiceN + ' 个')
  // 落账
  const STORIES = path.join(PROFILE, 'story-engine', 'stories')
  const files = fs.existsSync(STORIES) ? fs.readdirSync(STORIES).filter((f) => f.endsWith('.json')) : []
  let story = null
  for (const f of files) { try { const j = JSON.parse(fs.readFileSync(path.join(STORIES, f), 'utf8')); if (!story || j.updated_at > story.updated_at) story = j } catch {} }
  check('kd-story-committed', !!(story && story.counters.turn >= 1 && (story.decisions.length || story.facts.length || story.events.length)), '新内核下落账: turn=' + (story && story.counters.turn) + ' facts=' + (story && story.facts.length) + ' events=' + (story && story.events.length))

  await app.close()
  console.log('==== ' + (fails.length ? fails.length + ' FAILED: ' + fails.join('; ') : 'ALL_PASS') + ' ====')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error('E2E-ERROR', e); process.exit(1) })

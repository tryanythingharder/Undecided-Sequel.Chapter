'use strict'
/* 正式产品入口 · 桌面联调（真实 Electron + 真实 ipcMain + 真实 preload + 真实渲染模块）
 *
 * 覆盖三套产品工具的「主进程 register() 契约 + preload 桥 + window.* 渲染模块」真实串联：
 *   1) 作者工具 author*（版本不可变 / 版本差异 / 沙盒与记录重放 / 精选内核预览）
 *   2) 体验工具 experience*（用量聚合 / 报价扩展 / 诊断导出）
 *   3) 内核工作台 kernelWb*（四离线案例 / 真实试玩不可用）
 *
 * 正式入口：electron.launch(args:['.']) —— 与产品完全同一条启动路径（main.cjs / preload.cjs /
 * ui/<scheme>/index.html 都是产品文件）。测试只在 output/ 下新建「每 scheme 独立 profile」，
 * 绝不触碰真实 userData、真实存档与真实 story-engine。
 *
 * 三套界面（classic / proto / d）各跑一轮：每轮独立 workspace/output/playwright/product-tools/run-<id>/<scheme>
 * 作为 userData，SIXWORLDS_TEST=1 + SIXWORLDS_STORAGE_TEST=1 + SIXWORLDS_TEST_USER_DATA。
 *
 * 诊断导出：不注入假 api、不注入假 handler；通过 app.evaluate 临时 stub 原生 dialog.showSaveDialog
 * 选择工件路径，走真实 experience:diagnostics-save 通道落盘。
 *
 * 运行：node scripts-dev/test-product-tools-desktop.cjs
 * 产物：output/playwright/product-tools/run-<id>/<scheme>/（profile、截图、诊断工件；不进版本库）
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright')

const repoRoot = path.join(__dirname, '..')
/* 每轮独立档案与工件，不删除以往产物。 */
const runsRoot = path.join(repoRoot, 'output', 'playwright', 'product-tools')
fs.mkdirSync(runsRoot, { recursive: true })
const outRoot = fs.mkdtempSync(path.join(runsRoot, 'run-'))

const SCHEMES = ['classic', 'proto', 'd']
const sha256 = (value) => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value), 'utf8').digest('hex')
const { DatabaseSync } = require('node:sqlite')

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + '  << ' + (extra === undefined ? '' : JSON.stringify(extra)).slice(0, 500)) }
}

/* 每轮：独立 workspace/output/playwright/product-tools/run-<id>/<scheme> 作为 userData；
 * 不整目录危险删除——只清理本轮自己的 run 目录。 */
function schemePaths(scheme) {
  const base = path.join(outRoot, scheme)
  return {
    base,
    profile: path.join(base, 'profile'),
    shots: path.join(base, 'shots'),
    artifacts: path.join(base, 'artifacts'),
    storyEngine: path.join(base, 'profile', 'story-engine')
  }
}

const KERNEL_A = '# 产品测试内核\n\n规则一：世界由六面构成。\n规则二：记忆不可篡改。\n'
const KERNEL_B = '# 产品测试内核\n\n规则一：世界由六面构成。\n规则二：记忆不可篡改（修订）。\n规则三：新增条款。\n'

function seededLedger() {
  return {
    schema: 'sixworlds.usage-ledger.v1',
    savedAt: Date.now(),
    seq: 3,
    dropped: 0,
    prices: { 'test-model-a': { currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8 } },
    entries: [
      { id: 'EXP-SEED-1', kind: 'chat', model: 'test-model-a', label: 'seed', status: 'succeeded', startedAt: Date.now() - 3000, finishedAt: Date.now() - 2000, durationMs: 1000, tokens: { prompt: 1000, completion: 500, total: 1500, present: true }, images: null, cost: { amount: 0.006, currency: 'CNY', known: true, reason: 'computed' }, meta: {} },
      { id: 'EXP-SEED-2', kind: 'image', model: 'test-model-a', label: 'seed', status: 'succeeded', startedAt: Date.now() - 2000, finishedAt: Date.now() - 1000, durationMs: 1000, tokens: { prompt: null, completion: null, total: null, present: false }, images: 2, cost: { amount: null, currency: null, known: false, reason: 'no-price' }, meta: {} },
      { id: 'EXP-SEED-3', kind: 'chat', model: 'test-model-a', label: 'seed', status: 'failed', startedAt: Date.now() - 1000, finishedAt: Date.now(), durationMs: 1000, tokens: { prompt: null, completion: null, total: null, present: false }, images: null, cost: { amount: null, currency: null, known: false, reason: 'no-usage' }, errorCode: 'timeout', meta: {} }
    ]
  }
}

const waitText = async (win, selector, text, timeout = 20000) => {
  await win.waitForFunction(({ selector, text }) => {
    const el = document.querySelector(selector)
    return !!el && el.textContent.includes(text)
  }, { selector, text }, { timeout })
}

/* 隔离 profile 的玩家引擎：普通文件逐字节比较；SQLite 用只读逻辑快照，
 * 不把正常的 WAL checkpoint / SHM 锁字节当成业务写入。所有实际表（含虚表影子表）均覆盖。 */
function fingerprintDir(dir) {
  const out = {}
  const walk = (rel) => {
    const full = path.join(dir, rel)
    const entries = fs.readdirSync(full, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? rel + '/' + entry.name : entry.name
      if (entry.isDirectory()) { walk(childRel); continue }
      if (!entry.isFile() || /^memory\.db(?:-wal|-shm)?$/.test(childRel)) continue
      out[childRel] = sha256(fs.readFileSync(path.join(dir, childRel)))
    }
  }
  walk('')
  const dbFile = path.join(dir, 'memory.db')
  if (fs.existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true })
    try {
      db.exec('BEGIN')
      const schema = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all()
      const tables = schema.filter((row) => row.type === 'table' && !/^CREATE VIRTUAL TABLE/i.test(row.sql || ''))
      const encode = (value) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)
      const rows = tables.map(({ name }) => {
        const query = db.prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"')
        query.setReadBigInts(true)
        return { name, rows: query.all().map(encode).sort() }
      })
      out['memory.db:logical'] = sha256(encode({ schema, rows }))
    } finally { db.close() }
  }
  return out
}

/* 每个真实窗口都监听，包括方案切换后重建的窗口；同一句柄不重复监听。 */
function watchWindows(app, errors) {
  const seen = new WeakSet()
  const watch = (win) => {
    if (seen.has(win)) return
    seen.add(win)
    win.on('pageerror', (error) => errors.push(error.message))
    win.on('console', (msg) => {
      if (msg.type() === 'error' || (msg.type() === 'warning' && msg.text().startsWith('[author-tools]'))) errors.push('console:' + msg.text())
    })
    win.on('crash', () => errors.push('renderer-crash'))
  }
  app.on('window', watch)
  for (const win of app.windows()) watch(win)
}

async function runScheme(scheme) {
  console.log('\n== 界面方案 ' + scheme + ' ==')
  /* 跨重启要复用的状态（未登记草稿内核的复跑回归） */
  const draftState = { recordId: null, kernelId: null }
  const P = schemePaths(scheme)
  /* 本轮唯一根目录下的全新子目录：无需清理，也不删除任何以往 run 的产物 */
  fs.mkdirSync(P.profile, { recursive: true })
  fs.mkdirSync(P.shots, { recursive: true })
  fs.mkdirSync(P.artifacts, { recursive: true })
  /* 不手写孤儿故事文件：窗口启动后通过正式会话/引擎 API 建立关联夹具。 */

  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    SIXWORLDS_TEST: '1',
    SIXWORLDS_STORAGE_TEST: '1',
    SIXWORLDS_TEST_USER_DATA: P.profile,
    SIXWORLDS_UI_SCHEME: scheme
  }
  let app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot, env })
  try {
    const errors = []
    watchWindows(app, errors)
    let win = await app.firstWindow()
    await win.waitForSelector('#input', { timeout: 30000 })
    await win.waitForTimeout(1500)

    /* 只认正式入口与持久化方案，不把测试环境变量当作已切换的证据。 */
    const current = await win.evaluate(() => window.api.uiScheme())
    if (current !== scheme) await win.evaluate((s) => window.api.setUiScheme(s), scheme)
    await win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.waitForSelector('#btn-author-tools')

    /* 干净状态：清 localStorage 后重载（避免上一轮残留配置串味） */
    await win.evaluate(() => {
      localStorage.clear()
      localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ skipSplash: true, theme: 'dark', palette: 'classic' }))
    })
    await win.reload()
    await win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.waitForSelector('#input', { timeout: 30000 })
    await win.waitForTimeout(1500)
    check(scheme + ' / 实际入口与正式方案值一致', await win.evaluate(() => window.api.uiScheme()) === scheme)
    check(scheme + ' / 正式入口已加载共享焦点管理', await win.evaluate(() => typeof window.A11y?.trapTab === 'function' && typeof window.A11y?.restore === 'function'))

    const fixture = await win.evaluate(async (text) => {
      const loaded = await window.api.loadSessions()
      if (!loaded.ok || !loaded.sessions.length) throw new Error('隔离夹具需要正式会话正本')
      const session = loaded.sessions[0]
      const ensured = await window.api.engineEnsure({ storyId: session.id, title: session.title, kernelId: 'fixture', kernelText: text })
      if (!ensured.ok) throw new Error('夹具建档失败：' + ensured.error)
      for (let turn = 1; turn <= 7; turn++) {
        const committed = await window.api.engineCommit({ storyId: session.id, sessionId: session.id, playerInput: '隔离夹具', raw: '<<<STATE_PATCH>>>' + JSON.stringify({ turn_summary: '隔离测试回合 ' + turn }) + '<<<END_PATCH>>>' })
        if (!committed.ok || !committed.data.committed) throw new Error('夹具回合提交失败')
      }
      return { storyId: session.id, overview: await window.api.engineOverview({ storyId: session.id }) }
    }, KERNEL_A)
    const realStory = path.join(P.storyEngine, 'stories', fixture.storyId + '.json')
    const storyBytes = fs.readFileSync(realStory)
    check(scheme + ' / 隔离玩家夹具关联正式会话且含七个回合', JSON.parse(storyBytes).counters.turn === 7)
    const storyBefore = fingerprintDir(P.storyEngine)

    /* ---------------- 1. 入口按钮存在（正式产品挂载） ---------------- */
    /* 入口由父代理在 app.js 里挂载（ui/shared/{author,experience,kernel-workbench}-tools.js）。
     * 未接线时给出明确阻塞提示，而不是抛裸超时——本测试允许「先写测试、待接线后再跑」。 */
    const mountOk = await win.waitForSelector('#btn-author-tools', { timeout: 20000 }).then(() => true).catch(() => false)
    if (!mountOk) {
      const missing = []
      if (await win.locator('#btn-author-tools').count() === 0) missing.push('#btn-author-tools')
      if (await win.locator('#btn-experience-tools').count() === 0) missing.push('#btn-experience-tools')
      if (await win.locator('#btn-kernel-workbench').count() === 0) missing.push('#btn-kernel-workbench')
      throw new Error('产品工具入口未接线（缺少 ' + missing.join(' / ') + '）：需父代理在 ui/<scheme>/index.html 引入 '
        + 'ui/shared/{author,experience,kernel-workbench}-tools.js 并在 app.js 调用对应 mount()。本测试待接线后再跑。')
    }
    check(scheme + ' / 作者入口 #btn-author-tools 已挂载', await win.locator('#btn-author-tools').count() === 1)
    const hasLibrary = await win.locator('#btn-author-library').count()
    const hasExperience = await win.locator('#btn-experience-tools').count()
    const hasKernelWb = await win.locator('#btn-kernel-workbench').count()
    check(scheme + ' / 体验入口 #btn-experience-tools 已挂载', hasExperience === 1, hasExperience)
    check(scheme + ' / 内核工作台入口 #btn-kernel-workbench 已挂载', hasKernelWb === 1, hasKernelWb)
    console.log('    （#btn-author-library 计数=' + hasLibrary + '，由父代理决定是否单独提供；不单独断言）')

    /* ---------------- 2. 作者工具：版本不可变 / 差异 / 沙盒 / 记录重放 / 精选预览 ---------------- */
    const KID = 'user:product-tools-' + scheme
    await win.click('#btn-author-tools')
    await waitText(win, '.product-panel [role="alert"]', '请先在内核设计区选择或新建一个内核')
    /* 打开正式按钮并截图 */
    await win.screenshot({ path: path.join(P.shots, 'author-tools.png') })

    /* 版本登记：写入真实主进程不可变版本文件（走真实 author:version-register 通道） */
    const reg1 = await win.evaluate(([kernelId, text]) => window.api.authorVersionRegister({ kernelId, name: '产品测试内核', text }), [KID, KERNEL_A])
    check(scheme + ' / 版本登记经真实 IPC 返回 created/immutable', reg1 && reg1.ok === true && reg1.data.created === true && reg1.data.immutable === true,
      reg1 && reg1.ok ? reg1.data : reg1)
    const versions1 = await win.evaluate((kernelId) => window.api.authorVersions({ kernelId }), KID)
    check(scheme + ' / authorVersions 返回数组', versions1 && versions1.ok === true && Array.isArray(versions1.data), versions1 && versions1.ok)
    const list1 = versions1.ok ? versions1.data : []
    check(scheme + ' / 已登记 1 个不可变版本', list1.length === 1, list1.length)

    /* 版本内容读取：不可变内容回读一致（intact=true，文本逐字相同） */
    const firstHash = list1[0] && list1[0].hash
    const read1 = await win.evaluate(([kernelId, hash]) => window.api.authorVersionRead({ kernelId, hash }), [KID, firstHash])
    check(scheme + ' / authorVersionRead 回读内容且校验通过', read1 && read1.ok === true && read1.data.intact === true && read1.data.text === KERNEL_A,
      read1 && read1.ok ? { intact: read1.data.intact, same: read1.data.text === KERNEL_A } : read1)

    /* 第二版：内容不同 → 新建版本，旧版本保留 */
    const reg2 = await win.evaluate(([kernelId, text]) => window.api.authorVersionRegister({ kernelId, name: '产品测试内核', text }), [KID, KERNEL_B])
    check(scheme + ' / 第二版登记成功（内容不同则新建）', reg2 && reg2.ok === true && reg2.data.created === true, reg2 && reg2.ok ? reg2.data : reg2)
    const versions2 = await win.evaluate((kernelId) => window.api.authorVersions({ kernelId }), KID)
    const list2 = versions2.ok ? versions2.data : []
    check(scheme + ' / 版本数增长到 2（旧版本保留）', list2.length === 2, list2.length)

    /* 版本不可变：再次登记相同内容不得新增、不得覆盖既有版本 */
    const regDup = await win.evaluate(([kernelId, text]) => window.api.authorVersionRegister({ kernelId, name: '产品测试内核', text }), [KID, KERNEL_B])
    check(scheme + ' / 相同内容重复登记返回 immutable 且 created=false',
      regDup && regDup.ok === true && regDup.data.created === false && regDup.data.immutable === true, regDup && regDup.ok ? regDup.data : regDup)
    const versions3 = await win.evaluate((kernelId) => window.api.authorVersions({ kernelId }), KID)
    const list3 = versions3.ok ? versions3.data : []
    check(scheme + ' / 重复登记后版本数仍为 2', list3.length === 2, list3.length)

    /* 差异：真实行级差异统计 */
    const hashes = list3.map((v) => v.hash)
    const diff = await win.evaluate(([kernelId, from, to]) => window.api.authorDiff({ kernelId, from, to }), [KID, hashes[0], hashes[1]])
    check(scheme + ' / authorDiff 返回真实差异统计', diff && diff.ok === true && diff.data && diff.data.stats && Array.isArray(diff.data.hunks), diff && diff.ok)
    const diffRows = diff.ok && diff.data ? (diff.data.hunks || []).flatMap((hunk) => hunk.rows) : []
    check(scheme + ' / 差异含新增与删除行',
      diffRows.some((row) => row.type === 'add') && diffRows.some((row) => row.type === 'del'),
      diff.ok ? diff.data.stats : diff.error)

    /* 版本文件落在本轮 profile（不写真实档案） */
    const versionDir = path.join(P.profile, 'author-tools', 'versions')
    check(scheme + ' / 不可变版本文件落在本轮独立 profile', fs.existsSync(versionDir), versionDir)

    /* 沙盒：创建 → 离线回合 → 列表 → 关闭 */
    const sandboxOpen = await win.evaluate(([kernelId, text]) => window.api.authorSandboxOpen({ kernelId, text, label: '产品联调沙盒' }), [KID, KERNEL_A])
    check(scheme + ' / 沙盒创建成功', sandboxOpen && sandboxOpen.ok === true && sandboxOpen.data && sandboxOpen.data.sandboxId, sandboxOpen && sandboxOpen.ok ? sandboxOpen.data : sandboxOpen)
    const sandboxId = sandboxOpen.data.sandboxId
    const sandboxTurn = await win.evaluate((id) => window.api.authorSandboxTurn({ sandboxId: id, input: '我在沙盒里观察四周' }), sandboxId)
    check(scheme + ' / 沙盒离线回合提交（不调用模型）', sandboxTurn && sandboxTurn.ok === true && sandboxTurn.data.mock === true, sandboxTurn && sandboxTurn.ok ? sandboxTurn.data.mock : sandboxTurn)
    const sandboxList = await win.evaluate(() => window.api.authorSandboxList())
    check(scheme + ' / authorSandboxList 列出沙盒', sandboxList && sandboxList.ok === true && sandboxList.data.length === 1, sandboxList && sandboxList.ok)
    check(scheme + ' / 沙盒回合数已记录', sandboxList.ok && sandboxList.data[0].turns === 1, sandboxList.ok ? sandboxList.data[0].turns : sandboxList.error)

    /* 记录：运行结构测试 → 读取记录 → 复跑比对 */
    const suite = await win.evaluate(([kernelId, text]) => window.api.authorSuiteRun({ kernelId, name: '产品测试内核', text }), [KID, KERNEL_A])
    check(scheme + ' / authorSuiteRun 结构测试返回记录', suite && suite.ok === true && suite.data && suite.data.recordId, suite && suite.ok ? suite.data.recordId : suite)
    const recordId = suite.data.recordId
    check(scheme + ' / 结构测试不涉及模型（modelInvolved=false）', suite.ok && suite.data.modelInvolved === false, suite.ok ? suite.data.modelInvolved : suite.error)
    const records = await win.evaluate((kernelId) => window.api.authorRecords({ kernelId }), KID)
    check(scheme + ' / authorRecords 列出记录', records && records.ok === true && records.data.length >= 1, records && records.ok)
    const record = await win.evaluate((id) => window.api.authorRecord({ recordId: id }), recordId)
    check(scheme + ' / authorRecord 读取详情', record && record.ok === true && record.data.recordId === recordId, record && record.ok)
    const replay = await win.evaluate((id) => window.api.authorReplay({ recordId: id }), recordId)
    check(scheme + ' / authorReplay 复跑并返回一致性比对',
      replay && replay.ok === true && replay.data.original && replay.data.replay && typeof replay.data.replay.ok === 'boolean', replay && replay.ok)
    check(scheme + ' / 复跑脚本指纹与原记录一致（可重现）',
      replay.ok && replay.data.original.scriptHash === replay.data.replay.scriptHash, replay.ok ? replay.data : replay.error)

    /* 精选内核：来源（内置内核库）与预览 */
    const curated = await win.evaluate(() => window.api.authorCurated())
    check(scheme + ' / authorCurated 返回精选列表', curated && curated.ok === true && Array.isArray(curated.data), curated && curated.ok)
    const builtin = curated.ok ? curated.data.find((item) => String(item.kernelId).startsWith('builtin:')) : null
    check(scheme + ' / 精选列表含内置内核来源（真实内核库）', !!builtin, curated.ok ? curated.data.map((x) => x.kernelId) : curated.error)
    check(scheme + ' / 内置精选内核在真实内核库中可读', builtin && builtin.readable === true, builtin && builtin.readable)
    if (builtin) {
      /* 作者面板四个导航视图：正常点击（真实可见按钮），验证标题 / 内容，再回 versions */
      const navCases = [
        ['sandbox', '沙盒试玩'],
        ['records', '测试记录'],
        ['library', '精选内核'],
        ['versions', '内核版本与差异']
      ]
      for (const [view, title] of navCases) {
        const navBtn = win.locator('.product-panel [data-author-view="' + view + '"]')
        check(scheme + ' / 作者导航「' + title + '」按钮存在且可见', await navBtn.isVisible(), view)
        await navBtn.click()
        await waitText(win, '.product-panel .product-head', title)
        const headText = await win.locator('.product-panel .product-head').textContent()
        check(scheme + ' / 作者导航切到「' + title + '」标题正确', headText.includes(title), headText.slice(0, 120))
        await win.keyboard.press('Shift+Tab')
        check(scheme + ' / 作者页「' + title + '」焦点留在弹层内', await win.evaluate(() => !!document.activeElement.closest('.product-panel')))
      }
      /* 未选内核时沙盒视图须给出清晰提示，而不是停在「尚无版本」 */
      const sandboxBtn = await win.$('.product-panel [data-author-view="sandbox"]')
      if (sandboxBtn) {
        await sandboxBtn.click()
        await win.waitForTimeout(500)
        const sandboxText = await win.evaluate(() => {
          const el = document.querySelector('.product-panel .product-body')
          return el ? el.textContent : ''
        })
        check(scheme + ' / 沙盒视图在未选内核时给出明确提示（不空等）', sandboxText.includes('请先在内核设计区选择或新建一个内核'), sandboxText.slice(0, 200))
      }
      const backBtn = await win.$('.product-panel [data-author-view="versions"]')
      if (backBtn) { await backBtn.click(); await win.waitForTimeout(400) }
    }
    /* 关闭与焦点归还走真实键盘，不因导航替换面板而丢失原始入口。 */
    await win.keyboard.press('Escape')
    check(scheme + ' / 作者面板遮罩已关闭（避免遮挡后续入口）', (await win.$('.product-mask')) === null)
    check(scheme + ' / 作者面板关闭后焦点回到入口', await win.evaluate(() => document.activeElement.id) === 'btn-author-tools')

    if (builtin) {
      const preview = await win.evaluate((id) => window.api.authorPreview({ kernelId: id }), builtin.kernelId)
      /* 真实契约：engine/author-tools.cjs 的 preview() 返回 { kernelId, info, preview:{available,bytes,lineCount,headings,excerpt,...}, versions, records }
       * —— 正文摘要在 data.preview.excerpt，不存在 data.text。 */
      const pv = preview && preview.ok ? preview.data : null
      check(scheme + ' / authorPreview 返回可用预览（preview.available 为真）',
        !!(pv && pv.preview && pv.preview.available === true), preview && preview.ok ? pv && pv.preview : preview)
      check(scheme + ' / authorPreview 摘要非空（preview.excerpt，不是 data.text）',
        !!(pv && pv.preview && typeof pv.preview.excerpt === 'string' && pv.preview.excerpt.length > 0),
        pv && pv.preview ? { excerptLen: String(pv.preview.excerpt || '').length, hasText: 'text' in pv } : preview)
      check(scheme + ' / authorPreview 不返回 data.text（防止契约漂移）', !!(pv && !('text' in pv)))
      check(scheme + ' / authorPreview 摘要与内核库读取一致（真实来源，不是界面编造）', await win.evaluate(async (id) => {
        /* 正式 preload 是 kernelLibRead(id)；excerpt 规则 = 正文按 \r\n? → \n 归一后取前 40 行（author-tools:811 + splitLines:89） */
        const read = await window.api.kernelLibRead(id)
        const text = read && read.ok && typeof read.text === 'string' ? read.text : ''
        if (!text) return false
        const expected = text.replace(/\r\n?/g, '\n').split('\n').slice(0, 40).join('\n')
        const p = await window.api.authorPreview({ kernelId: id })
        return !!(p && p.ok && p.data && p.data.preview && p.data.preview.excerpt === expected)
      }, builtin.kernelId))
    }

    /* 复跑 bug 回归：不同「未登记」kernelId 走 inline text 建 suite → 重启 → replay(recordId)。
     * 之前先登记同 text 会掩盖「runSuite 未先 registerVersion」的 bug，这里刻意不登记。 */
    const DRAFT_KID = 'user:product-tools-draft-' + scheme
    const suiteDraft = await win.evaluate(([kernelId, text]) => window.api.authorSuiteRun({ kernelId, name: '未登记草稿内核', text }), [DRAFT_KID, KERNEL_A])
    check(scheme + ' / 未登记草稿内核可直接跑结构测试（inline text 先登记版本）',
      suiteDraft && suiteDraft.ok === true && suiteDraft.data && suiteDraft.data.recordId, suiteDraft && suiteDraft.ok ? suiteDraft.data : suiteDraft)
    const draftRecordId = suiteDraft && suiteDraft.ok && suiteDraft.data ? suiteDraft.data.recordId : null
    const draftVersions = await win.evaluate((kernelId) => window.api.authorVersions({ kernelId }), DRAFT_KID)
    check(scheme + ' / 草稿内核的版本已随 suite 登记（runSuite 内部先 registerVersion）',
      draftVersions && draftVersions.ok === true && Array.isArray(draftVersions.data) && draftVersions.data.length === 1,
      draftVersions && draftVersions.ok ? draftVersions.data.length : draftVersions)
    draftState.recordId = draftRecordId
    draftState.kernelId = DRAFT_KID

    /* 沙盒清理（保持环境干净，不残留测试数据） */
    await win.evaluate((id) => window.api.authorSandboxClose({ sandboxId: id }), sandboxId)

    /* 作者完整 UI 闭环：正常新建并保存内核，不绑定/更改玩家世界线。 */
    await win.click('#btn-kernel-hub')
    await win.click('#btn-kernel-library')
    const libraryBeforeCreate = await win.evaluate(() => window.api.kernelLibList())
    if (!libraryBeforeCreate.ok || libraryBeforeCreate.kernels.length < 2) throw new Error('正式内核库缺少内置夹具')
    const initialKernelCount = libraryBeforeCreate.kernels.length
    await win.waitForFunction((count) => document.querySelectorAll('.kernel-card').length === count, initialKernelCount)
    check(scheme + ' / 首次打开内核库列出真实 IPC 全部内核', await win.locator('.kernel-card').count() === initialKernelCount)
    if (scheme === 'proto') {
      await win.click('[data-kernel-filter="published"]')
      await win.waitForFunction((count) => document.querySelectorAll('.kernel-card[data-status="published"]').length === count, initialKernelCount)
      check(scheme + ' / 已发布筛选列出内置内核', await win.locator('.kernel-card').count() === initialKernelCount && await win.locator('[data-kernel-filter="published"]').getAttribute('aria-pressed') === 'true')
      await win.click('[data-kernel-filter="draft"]')
      await waitText(win, '#kernel-cards', '没有匹配的内核')
      check(scheme + ' / 草稿空筛选不误报内核库为空', await win.locator('.kernel-card').count() === 0 && await win.locator('#kernel-library-count').textContent() === initialKernelCount + ' 个内核')
      await win.click('[data-kernel-filter="all"]')
      await win.waitForFunction((count) => document.querySelectorAll('.kernel-card').length === count, initialKernelCount)
      check(scheme + ' / 切回全部恢复列表与筛选按钮状态', await win.locator('[data-kernel-filter="all"]').getAttribute('aria-pressed') === 'true' && await win.locator('[data-kernel-filter="draft"]').getAttribute('aria-pressed') === 'false')
    }
    await win.click('#btn-kernel-new')
    // proto 新建后回到设计画布；从真实「源码」入口继续，不向隐藏字段注值。
    if (scheme === 'proto') await win.click('#btn-kernel-source')
    await win.fill('#kernel-edit-name', '作者界面验收-' + scheme)
    assert.equal(await win.locator('#kernel-edit-name').inputValue(), '作者界面验收-' + scheme, '名称输入不得被延迟聚焦转发到正文')
    await win.fill('#kernel-edit-text', KERNEL_A)
    assert.equal(await win.locator('#kernel-edit-name').inputValue(), '作者界面验收-' + scheme, '保存前名称必须完整保留')
    assert.equal(await win.locator('#kernel-edit-text').inputValue(), KERNEL_A, '保存前正文必须完整保留')
    await win.click('#btn-kernel-source-save')
    await waitText(win, '#kernel-save-state', '已保存')
    await win.click('#btn-kernel-source-done')
    await win.click('#btn-kernel-hub-close')
    await win.click('#btn-author-tools')
    await waitText(win, '.product-panel', '尚无已登记版本')
    await win.getByRole('button', { name: '登记当前内核版本', exact: true }).click()
    await waitText(win, '.product-panel .product-row', 'hash ')
    await win.getByRole('button', { name: '查看内容', exact: true }).click()
    await waitText(win, '.product-panel pre', '世界由六面构成')
    check(scheme + ' / 作者 UI 登记并查看不可变正文', await win.locator('.product-panel pre').textContent() === KERNEL_A)
    await win.click('.product-close')
    await win.click('#btn-kernel-hub')
    await win.click('#btn-kernel-library')
    await win.locator('.kernel-card', { hasText: '作者界面验收-' + scheme }).getByRole('button', { name: '编辑', exact: true }).click()
    await win.waitForFunction((name) => document.querySelector('#kernel-edit-name').value === name, '作者界面验收-' + scheme)
    await win.fill('#kernel-edit-text', KERNEL_B)
    await win.click('#btn-kernel-source-save')
    await waitText(win, '#kernel-save-state', '已保存')
    await win.click('#btn-kernel-source-done')
    await win.click('#btn-kernel-hub-close')
    await win.click('#btn-author-tools')
    await win.getByRole('button', { name: '登记当前内核版本', exact: true }).click()
    await win.waitForFunction(() => document.querySelectorAll('.product-panel .product-row').length === 2)
    await win.getByRole('button', { name: '比较版本', exact: true }).click()
    await win.getByRole('button', { name: '开始比较', exact: true }).click()
    await waitText(win, '.product-panel', '新增 ')
    check(scheme + ' / 作者 UI 展示真实版本增删差异', await win.locator('[data-diff="add"]').count() > 0 && await win.locator('[data-diff="del"]').count() > 0)
    await win.click('[data-author-view="sandbox"]')
    await win.getByRole('button', { name: '创建独立沙盒', exact: true }).click()
    await win.getByRole('textbox', { name: '沙盒行动', exact: true }).fill('观察离线测试世界')
    await win.getByRole('button', { name: '提交离线回合（不调用模型）', exact: true }).click()
    await waitText(win, '.product-panel .chapter-section small', ' · 回合 1 · ')
    check(scheme + ' / 作者 UI 离线回合提交并刷新回合数', (await win.locator('.product-panel .chapter-section small').first().textContent()).includes(' · 回合 1 · '))
    await win.getByRole('button', { name: '结束沙盒', exact: true }).click()
    await win.locator('.confirm-mask').getByRole('button', { name: '删除沙盒', exact: true }).click()
    await waitText(win, '.product-panel', '当前没有沙盒')
    await win.click('[data-author-view="records"]')
    await win.getByRole('button', { name: '运行内核测试', exact: true }).click()
    await win.getByRole('button', { name: '查看详情', exact: true }).first().click()
    await waitText(win, '.product-panel h3', '测试记录 ')
    await win.getByRole('button', { name: '返回记录列表', exact: true }).click()
    await win.getByRole('button', { name: '复跑比对', exact: true }).first().click()
    await waitText(win, '.product-panel h3', '复跑一致')
    check(scheme + ' / 作者 UI 运行、详情和复跑一致闭环', await win.locator('.product-panel h3').first().textContent() === '复跑一致')
    await win.click('[data-author-view="library"]')
    await win.getByRole('button', { name: '预览', exact: true }).first().click()
    await win.waitForSelector('.product-panel pre')
    check(scheme + ' / 精选内核可通过 UI 预览正文', (await win.locator('.product-panel pre').textContent()).length > 0)
    await win.screenshot({ path: path.join(P.shots, 'author-ui-complete.png') })
    await win.click('.product-close')

    /* ---------------- 3. 体验工具：用量聚合 / 报价 / 诊断导出 ---------------- */
    /* experience 通道为扁平返回（{ok, ...}），不是 {ok,data} */
    await win.click('#btn-experience-tools')
    await waitText(win, '.product-panel', '真实调用数')
    await win.screenshot({ path: path.join(P.shots, 'experience-tools.png') })
    const storage = await win.evaluate(() => window.api.experienceStorage())
    check(scheme + ' / experienceStorage 经真实 IPC 返回统计', storage && storage.ok === true && storage.stats, storage && storage.ok)
    check(scheme + ' / 存储统计不含任何路径 / 文件名', storage.ok && !/[\\/]/.test(JSON.stringify(storage.stats)), storage.ok ? storage.stats : storage.error)

    const diagInfo = await win.evaluate(() => window.api.experienceDiagnosticsInfo())
    check(scheme + ' / experienceDiagnosticsInfo 返回版本与阶段', diagInfo && diagInfo.ok === true && typeof diagInfo.version === 'string' && typeof diagInfo.stage === 'string', diagInfo && diagInfo.ok)
    check(scheme + ' / 诊断信息含聚合存储统计', diagInfo.ok && diagInfo.storage && typeof diagInfo.storage.available === 'boolean', diagInfo.ok ? diagInfo.storage : diagInfo.error)
    /* 阶段枚举经 payload 提交（正式 main 传 stage:(p)=>p&&p.stage）；渲染层由自身配置推导 */
    const stageInfo = await win.evaluate(() => window.api.experienceDiagnosticsInfo({ stage: 'illust-ready' }))
    check(scheme + ' / 提交的 stage 枚举经 info 通道回传', stageInfo && stageInfo.ok === true && stageInfo.stage === 'illust-ready', stageInfo && stageInfo.ok ? stageInfo.stage : stageInfo)
    const stageEvil = await win.evaluate(() => window.api.experienceDiagnosticsInfo({ stage: 'sk-live-abcdef' }))
    check(scheme + ' / 恶意 stage 回落 unknown（不泄漏密钥）', stageEvil && stageEvil.ok === true && stageEvil.stage === 'unknown', stageEvil && stageEvil.ok ? stageEvil.stage : stageEvil)
    check(scheme + ' / 诊断信息不含密钥 / 路径 / URL', diagInfo.ok && !/sk-|[A-Za-z]:[\\/]|https?:\/\//.test(JSON.stringify(diagInfo)), diagInfo.ok ? JSON.stringify(diagInfo).slice(0, 200) : diagInfo.error)

    /* 未提供渲染层账本时，主进程不得凭空生成零用量：如实「无用量字段」 */
    const reportBare = await win.evaluate(() => window.api.experienceReport({ extended: true }))
    check(scheme + ' / experienceReport 返回脱敏报告与文本', reportBare && reportBare.ok === true && typeof reportBare.text === 'string' && reportBare.report, reportBare && reportBare.ok)
    check(scheme + ' / 报告 schema 正确', reportBare.ok && reportBare.report.schema === 'sixworlds.experience-diagnostics.v1', reportBare.ok ? reportBare.report.schema : reportBare.error)
    check(scheme + ' / 未提供账本时不伪造用量（无 usage 字段，而非 usage.calls=0）',
      reportBare.ok && !('usage' in reportBare.report), reportBare.ok ? reportBare.report.usage : reportBare.error)
    check(scheme + ' / 报告不含密钥 / 路径 / URL', reportBare.ok && !/sk-|[A-Za-z]:[\\/]|https?:\/\//.test(reportBare.text), reportBare.ok ? reportBare.text.slice(0, 200) : reportBare.error)

    /* 任意 content 被导出闸门拒绝（白名单最小修复的产品级验证） */
    const evilSave = await win.evaluate(() => window.api.experienceDiagnosticsSave({ defaultName: 'x.json', content: '任意内容 sk-live-abcdef C:\\\\Users\\\\ellen' }))
    check(scheme + ' / 任意 content 被导出闸门拒绝（产品级）', evilSave && evilSave.ok === false, evilSave && evilSave.ok)

    /* 错误上报：只传短码（不落路径 / 原文） */
    const errReport = await win.evaluate(() => window.api.experienceRecordError({ code: 'Error: connect ECONNREFUSED 127.0.0.1' }))
    check(scheme + ' / experienceRecordError 归一为短码', errReport && errReport.ok === true && errReport.code === 'refused', errReport && errReport.ok ? errReport.code : errReport)
    { const c = await win.$('.product-panel .product-close'); if (c) await c.click(); await win.waitForTimeout(300) }

    /* ---------------- 3b. 真实账本聚合：预置脱敏主进程账本 → 正常启动恢复 → 正式诊断页导出 ----------------
     * 账本唯一真源在隔离 profile 的 runtime/usage-ledger.json；不再使用无效的 renderer localStorage 夹具。
     * 先正常退出，再写入本轮专属 profile，随后重启由正式 runtime-service 加载并经真实 IPC/UI 读取。 */
    await app.close()
    app = null
    const ledgerFile = path.join(P.profile, 'runtime', 'usage-ledger.json')
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
    fs.writeFileSync(ledgerFile, JSON.stringify(seededLedger(), null, 2), 'utf8')
    app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot, env })
    watchWindows(app, errors)
    win = await app.firstWindow()
    await win.waitForURL('**/ui/' + scheme + '/index.html')
    await win.waitForSelector('#input', { timeout: 30000 })
    await win.waitForTimeout(1500)
    const restoredLedger = await win.evaluate(() => window.api.runtimeLedgerLoad())
    check(scheme + ' / 正式主进程从隔离 profile 恢复三笔账目', restoredLedger && restoredLedger.ok === true && restoredLedger.data.entries.length === 3, restoredLedger && restoredLedger.ok ? restoredLedger.data.entries.length : restoredLedger)
    /* 经正式 UI 打开诊断页（不是直接调 api），读取账本聚合后导出 */
    await win.click('#btn-experience-tools')
    await win.waitForSelector('.product-panel', { timeout: 20000 })
    await win.waitForTimeout(500)
    /* 真实点击标签页（可见按钮），不用 evaluate 掩盖隐藏元素 */
    const usageTab = await win.$('.exp-tabs .exp-tab[data-tab="usage"]')
    check(scheme + ' / 体验面板提供可见的「用量与估计」标签页（正式 UI）', !!(usageTab && await usageTab.isVisible()))
    if (usageTab) { await usageTab.click(); await win.waitForTimeout(300) }
    const usageText = await win.evaluate(() => {
      const box = document.querySelector('.exp-content')
      return box ? box.textContent : ''
    })
    check(scheme + ' / 正式 UI 用量页读到预置账本（真实调用数 = 3）', /真实调用数/.test(usageText) && /3/.test(usageText), usageText.slice(0, 300))
    check(scheme + ' / 未返回用量的调用显示为「未知」而非 0', /未知/.test(usageText), usageText.slice(0, 400))

    /* 报价/估计输入的模型名不能随诊断导出；覆盖真实输入事件而非仅种账本。 */
    await win.getByLabel('模型名（与调用时一致，用于取报价）', { exact: true }).fill('private-ui-model-canary')

    /* 经正式诊断页导出：写入账本聚合后的报告 */
    const seededArtifact = path.join(P.artifacts, 'diagnostics-seeded-' + scheme + '.json')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, seededArtifact)
    const diagTab = await win.$('.exp-tabs .exp-tab[data-tab="diag"]')
    check(scheme + ' / 体验面板提供可见的「脱敏诊断」标签页（正式 UI）', !!(diagTab && await diagTab.isVisible()))
    if (diagTab) { await diagTab.click(); await win.waitForTimeout(400) }
    const exportBtn = await win.$('.exp-content .product-actions button:has-text("导出脱敏诊断包")')
    check(scheme + ' / 诊断页导出按钮可见（正式 UI）', !!(exportBtn && await exportBtn.isVisible()))
    if (exportBtn) { await exportBtn.click() }
    await win.waitForTimeout(1200)
    check(scheme + ' / 经正式 UI 导出的诊断工件已落盘', fs.existsSync(seededArtifact), seededArtifact)
    if (fs.existsSync(seededArtifact)) {
      const seededDoc = JSON.parse(fs.readFileSync(seededArtifact, 'utf8'))
      check(scheme + ' / 导出报告聚合了真实账本调用数（calls=3）', seededDoc.usage && seededDoc.usage.calls === 3, seededDoc.usage)
      check(scheme + ' / 导出报告区分文本 / 图像调用（chat=2 / image=1）',
        seededDoc.usage && seededDoc.usage.chatCalls === 2 && seededDoc.usage.imageCalls === 1, seededDoc.usage)
      check(scheme + ' / 导出报告只累计真实返回的 token（1500）', seededDoc.usage && seededDoc.usage.totalTokens === 1500, seededDoc.usage)
      check(scheme + ' / 未返回用量的调用计入未知而非 0', seededDoc.usage && seededDoc.usage.usageUnknownCalls === 2, seededDoc.usage)
      check(scheme + ' / 导出报告记录失败调用数', seededDoc.usage && seededDoc.usage.failed === 1, seededDoc.usage)
      check(scheme + ' / 导出报告为合法白名单形状', (() => {
        const v = require('../engine/experience-tools.cjs').validateDiagnosticsReport(seededDoc)
        return v.ok === true
      })(), seededDoc.schema)
      const exportedText = fs.readFileSync(seededArtifact, 'utf8')
      check(scheme + ' / 导出工件不含密钥 / 路径 / URL / 模型名 / 内核正文',
        !/sk-|[A-Za-z]:[\\/]|https?:\/\//.test(exportedText) && !exportedText.includes('test-model-a') && !exportedText.includes('private-ui-model-canary') && !exportedText.includes('世界由六面构成'), seededDoc.schema)
      check(scheme + ' / 正式 UI 导出阶段贯通为 first-run', seededDoc.app && seededDoc.app.stage === 'first-run', seededDoc.app)
    }
    /* 阶段由渲染层配置推导（本 profile 未配模型 → first-run） */
    const seededStage = await win.evaluate(() => window.api.experienceDiagnosticsInfo({ stage: 'first-run' }))
    check(scheme + ' / 诊断阶段为白名单枚举', seededStage && seededStage.ok === true && ['first-run', 'text-ready', 'illust-ready', 'unknown'].includes(seededStage.stage), seededStage && seededStage.ok ? seededStage.stage : seededStage)
    { const c = await win.$('.product-panel .product-close'); if (c) await c.click(); await win.waitForTimeout(300) }

    /* ---------------- 4. 内核工作台：四离线案例 + 真实不可用 ---------------- */
    /* 打开工作台：正式入口按钮（三套界面均由产品挂载） */
    await win.click('#btn-kernel-hub')
    await win.waitForSelector('#kernel-hub', { state: 'visible' })
    await win.click('#btn-kernel-workbench')
    check(scheme + ' / 内核工作台入口可见且正常点击打开', await win.locator('#btn-kernel-workbench').isVisible())
    await win.waitForSelector('.kwb-panel', { timeout: 20000 })
    await win.screenshot({ path: path.join(P.shots, 'kernel-workbench.png') })

    /* 工作台 UI 闭环使用独立引用，不与下方四案例 IPC 契约断言混淆。 */
    await win.getByLabel('内核引用（与内核库 id 一致，如 user:我的世界）').fill('user:ui-workbench-' + scheme)
    await win.getByLabel('要发布的完整内核正文（默认取当前设计页编辑器内容，可改）').fill(KERNEL_A)
    await win.getByRole('button', { name: '发布为新版本', exact: true }).click()
    await waitText(win, '.kwb-live-status', '已发布 v1')
    const uiRelease = await win.evaluate((ref) => window.api.kernelWbRead({ ref, version: 'v1' }), 'user:ui-workbench-' + scheme)
    check(scheme + ' / 工作台 UI 发布正文和 hash 准确落盘', uiRelease.ok && uiRelease.text === KERNEL_A && uiRelease.meta.hash === sha256(KERNEL_A), uiRelease.meta)
    await win.click('.kwb-tab[data-tab="cases"]')
    await win.getByRole('button', { name: '在此版本上运行', exact: true }).first().click()
    await waitText(win, '.kwb-run-result', '试跑完成')
    const uiRecords = await win.evaluate((ref) => window.api.kernelWbRecords({ ref }), 'user:ui-workbench-' + scheme)
    check(scheme + ' / 工作台 UI 试跑确实生成一条记录', uiRecords.ok === true && uiRecords.records.length === 1, uiRecords)
    await win.click('.kwb-tab[data-tab="records"]')
    await win.waitForSelector('.kwb-records tbody tr')
    const uiRecord = uiRecords.records[0]
    const uiRecordPath = path.resolve(P.profile, uiRecord.file)
    if (!uiRecordPath.startsWith(path.resolve(P.profile) + path.sep)) throw new Error('工作台记录越过隔离 profile')
    const uiRecordDoc = JSON.parse(fs.readFileSync(uiRecordPath, 'utf8'))
    check(scheme + ' / 工作台 UI 试跑绑定已发布内容并提交两幕', uiRecordDoc.case.id === 'basic-loop' && uiRecordDoc.kernel.version === 'v1' && uiRecordDoc.kernel.hash === sha256(KERNEL_A) && uiRecordDoc.summary.turns === 2 && uiRecordDoc.summary.committed === 2 && uiRecordDoc.summary.engine_turn === 2, uiRecordDoc.summary)
    const recordCells = await win.locator('.kwb-records tbody tr').first().locator('td').allTextContents()
    check(scheme + ' / 工作台记录表展示本次用例、版本、摘要和文件', recordCells[0] === uiRecord.caseId && recordCells[1] === uiRecord.version && recordCells[2] === uiRecord.digest.slice(0, 19) && recordCells[5] === uiRecord.file, recordCells)
    await win.screenshot({ path: path.join(P.shots, 'kernel-workbench-complete.png') })

    /* kernel-wb 通道同为扁平返回（{ok, ...}） */
    const caps = await win.evaluate(() => window.api.kernelWbCapabilities())
    check(scheme + ' / kernelWbCapabilities 声明离线模式', caps && caps.ok === true && caps.offlineMock === true && caps.network === 'none', caps && caps.ok)
    check(scheme + ' / 工作台声明真实试玩不可用', caps.ok && caps.realPlaytest === false && caps.realPlaytestStatus && caps.realPlaytestStatus.available === false,
      caps.ok ? caps.realPlaytestStatus : caps.error)
    const realStatus = await win.evaluate(() => window.api.kernelWbRealStatus())
    check(scheme + ' / kernelWbRealStatus 标注需显式授权且不联网', realStatus && realStatus.available === false && realStatus.requiresAuthorization === true && realStatus.network === 'none', realStatus)

    /* 发布一版内核 → 四离线案例全部跑通 */
    const wbRef = 'user:product-tools-' + scheme
    const pub = await win.evaluate(([ref, text]) => window.api.kernelWbPublish({ ref, name: '产品测试内核', text }), [wbRef, KERNEL_A])
    check(scheme + ' / kernelWbPublish 发布不可变版本', pub && pub.ok === true && pub.version === 'v1', pub && pub.ok ? pub.version : pub)
    const cases = await win.evaluate(() => window.api.kernelWbCases())
    check(scheme + ' / kernelWbCases 返回四个离线案例', cases && cases.ok === true && cases.cases.length === 4, cases && cases.ok ? cases.cases.length : cases.error)
    const caseIds = cases.ok ? cases.cases.map((c) => c.id) : []
    for (const caseId of caseIds) {
      const run = await win.evaluate(([ref, id]) => window.api.kernelWbRun({ ref, caseId: id }), [wbRef, caseId])
      check(scheme + ' / 离线案例 ' + caseId + ' 试跑通过', run && run.ok === true && run.digest, run && run.ok ? run.digest : run)
      check(scheme + ' / 案例 ' + caseId + ' 标注离线模拟（realPlaytest=false）', run.ok && run.record.realPlaytest === false && run.record.network === 'none', run.ok ? run.record.mode : run.error)
    }
    const wbRecords = await win.evaluate((ref) => window.api.kernelWbRecords({ ref }), wbRef)
    check(scheme + ' / kernelWbRecords 记录四个案例', wbRecords && wbRecords.ok === true && wbRecords.records.length === 4, wbRecords && wbRecords.ok ? wbRecords.records.length : wbRecords)
    const wbVerify = await win.evaluate((ref) => window.api.kernelWbVerify({ ref }), wbRef)
    check(scheme + ' / kernelWbVerify 版本完整性通过', wbVerify && wbVerify.ok === true && wbVerify.intact === true, wbVerify && wbVerify.ok)
    const wbDiff = await win.evaluate((ref) => window.api.kernelWbDiff({ ref }), wbRef)
    check(scheme + ' / 单版本差异请求返回可读错误（不崩溃）', wbDiff && wbDiff.ok === false, wbDiff && wbDiff.ok)
    await win.click('.kwb-panel .kwb-close')

    /* ---------------- 5. 隔离：真实 story-engine 未被改写 ---------------- */
    const storyAfter = fingerprintDir(P.storyEngine)
    check(scheme + ' / 真实 story-engine 内容未变', JSON.stringify(storyBefore) === JSON.stringify(storyAfter),
      { before: Object.keys(storyBefore), after: Object.keys(storyAfter) })
    check(scheme + ' / 隔离玩家世界线档逐字节未变', fs.existsSync(realStory) && fs.readFileSync(realStory).equals(storyBytes))
    check(scheme + ' / 无渲染进程未捕获异常', errors.length === 0, errors.slice(0, 3))

    /* ---------------- 6. 重启持久化：版本与工作台记录仍在 ---------------- */
    await app.close()
    const app2 = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot, env })
    try {
      const errors2 = []
      watchWindows(app2, errors2)
      const win2 = await app2.firstWindow()
      await win2.waitForURL('**/ui/' + scheme + '/index.html')
      await win2.waitForSelector('#input', { timeout: 30000 })
      await win2.waitForTimeout(1500)
      // 重启不得用再次切换来掩盖方案持久化失败。
      check(scheme + ' / 重启直接恢复正确的正式入口', await win2.evaluate(() => window.api.uiScheme()) === scheme)
      const versionsAfterRestart = await win2.evaluate((kernelId) => window.api.authorVersions({ kernelId }), KID)
      const listRestart = versionsAfterRestart && versionsAfterRestart.ok && Array.isArray(versionsAfterRestart.data) ? versionsAfterRestart.data : []
      check(scheme + ' / 重启后作者版本仍为 2（不可变版本持久化）', listRestart.length === 2, listRestart.length)
      check(scheme + ' / 重启后首个版本 hash 未变（不可变）', listRestart.length === 2 && listRestart.some((v) => v.hash === firstHash), listRestart.map((v) => v.hash))
      const wbRecordsAfterRestart = await win2.evaluate((ref) => window.api.kernelWbRecords({ ref }), wbRef)
      check(scheme + ' / 重启后工作台记录仍在', wbRecordsAfterRestart && wbRecordsAfterRestart.ok === true && wbRecordsAfterRestart.records.length === 4,
        wbRecordsAfterRestart.ok ? wbRecordsAfterRestart.records.length : wbRecordsAfterRestart)
      const wbVerifyAfterRestart = await win2.evaluate((ref) => window.api.kernelWbVerify({ ref }), wbRef)
      check(scheme + ' / 重启后工作台版本完整性仍通过', wbVerifyAfterRestart && wbVerifyAfterRestart.ok === true && wbVerifyAfterRestart.intact === true, wbVerifyAfterRestart && wbVerifyAfterRestart.ok)

      /* 复跑 bug 回归：不同「未登记」kernelId 的 suite 记录，重启后按 recordId 复跑必须可重现。
       * 之前先登记同 text 会掩盖「runSuite 未先 registerVersion / 记录里缺 kernel hash」的 bug。 */
      if (draftState.recordId) {
        const draftReplay = await win2.evaluate((id) => window.api.authorReplay({ recordId: id }), draftState.recordId)
        /* 真实契约：compare() 返回 { original, replay, reproduced, rows }，reproduced 在 data 根级 */
        const dr = draftReplay && draftReplay.ok ? draftReplay.data : null
        check(scheme + ' / 重启后未登记草稿内核记录可复跑', !!(dr && dr.rows && dr.rows.length > 0), draftReplay && draftReplay.ok ? dr : draftReplay)
        check(scheme + ' / 草稿内核复跑判定为可重现（reproduced 在 data 根级）', !!(dr && dr.reproduced === true), dr)
        check(scheme + ' / 草稿内核复跑 kernel hash 一致', !!(dr && dr.original && dr.replay && dr.original.kernelHash === dr.replay.kernelHash),
          dr ? { o: dr.original.kernelHash, r: dr.replay.kernelHash } : draftReplay)
        check(scheme + ' / 草稿内核复跑脚本指纹一致', !!(dr && dr.original && dr.replay && dr.original.scriptHash === dr.replay.scriptHash), dr)
        check(scheme + ' / 草稿内核复跑逐案例一致', !!(dr && dr.rows.every((row) => row.same === true)), dr ? dr.rows : draftReplay)
      } else {
        check(scheme + ' / 重启后未登记草稿内核记录可复跑（缺少 recordId，视为失败）', false, draftState)
      }
      /* 等启动孤儿清理定时器实际走过，验证会话关联跨启动仍有效。 */
      await win2.waitForTimeout(8500)
      const fixtureAfter = await win2.evaluate((storyId) => window.api.engineOverview({ storyId }), fixture.storyId)
      const sessionsAfter = await win2.evaluate(() => window.api.loadSessions())
      check(scheme + ' / 重启清理后夹具仍关联会话正本', sessionsAfter.ok && sessionsAfter.sessions.some((session) => session.id === fixture.storyId))
      check(scheme + ' / 重启后夹具引擎概览不变', JSON.stringify(fixtureAfter) === JSON.stringify(fixture.overview))
      const storyAfterRestart = fingerprintDir(P.storyEngine)
      check(scheme + ' / 重启前后隔离玩家引擎文件和 SQLite 逻辑内容未变', JSON.stringify(storyBefore) === JSON.stringify(storyAfterRestart), { before: storyBefore, after: storyAfterRestart })
      check(scheme + ' / 重启后无渲染进程未捕获异常（真实 pageerror 监听）', errors2.length === 0, errors2.slice(0, 3))
    } finally {
      await app2.close()
    }
  } catch (error) {
    for (const [index, page] of app.windows().entries()) {
      try {
        await page.screenshot({ path: path.join(P.shots, 'failure-' + index + '.png') })
        fs.writeFileSync(path.join(P.artifacts, 'failure-' + index + '.txt'), await page.locator('body').innerText(), 'utf8')
      } catch { /* 保留原始失败原因 */ }
    }
    throw error
  } finally {
    try { await app.close() } catch { /* 已关闭 */ }
  }
}

async function main() {
  console.log('正式工具回归工件：' + outRoot)
  for (const scheme of SCHEMES) await runScheme(scheme)
  console.log('\n== 产品工具桌面验证: ' + pass + ' 通过, ' + fail + ' 失败 ==')
  console.log('（产物：' + path.relative(repoRoot, outRoot) + '）')
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

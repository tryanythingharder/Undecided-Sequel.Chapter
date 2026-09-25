// 进度包导出→导入往返 + 防护拒绝 + 冲突策略 + 回滚（主进程级 e2e，走真实 Electron IPC）。
// 每轮使用独立 userData，并显式开启磁盘正本读取，避免测试态 localStorage 创建默认世界线污染断言。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'sixworlds-progress-profile-'))
const ENGINE_DIR = path.join(PROFILE, 'story-engine')
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-import-'))
let app = null
let win = null
let sequence = 0

const launch = (extraEnv) => electron.launch({
  executablePath: electronExecutable,
  args: ['.'],
  cwd: ROOT,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    SIXWORLDS_TEST: '1',
    SIXWORLDS_STORAGE_TEST: '1',
    SIXWORLDS_TEST_USER_DATA: PROFILE,
    ...(extraEnv || {})
  }
})

async function closeApp() {
  if (!app) return
  try { await app.close() } catch {}
  app = null
  win = null
}

async function openApp(extraEnv) {
  await closeApp()
  app = await launch(extraEnv)
  win = await app.firstWindow()
  await win.waitForSelector('#btn-archives', { timeout: 30000 })
  await win.waitForTimeout(900)
}

async function writeInput(doc) {
  const p = path.join(STAGE, 'in-' + (++sequence) + '.json')
  fs.writeFileSync(p, JSON.stringify(doc))
  return p
}

async function importVia(doc, extraEnv, options) {
  const p = await writeInput(doc)
  await openApp({ SIXWORLDS_TEST_IMPORT_PATH: p, ...(extraEnv || {}) })
  return win.evaluate((opts) => window.api.importProgress(opts || {}), options || {})
}

function checkFactory(fails) {
  return (name, cond, extra) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''))
    if (!cond) fails.push(name)
  }
}

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function rewriteStoryOwner(value, owner) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach((item) => rewriteStoryOwner(item, owner)); return }
  for (const key of Object.keys(value)) {
    if (key === 'story_id') value[key] = owner
    else rewriteStoryOwner(value[key], owner)
  }
}

async function main() {
  const fails = []
  const check = checkFactory(fails)

  // ---- 1. 造引擎数据（真实引擎 IPC）→ 导出进度包 ----
  await openApp()
  const ensure = async (id) => win.evaluate(async (sid) => {
    const r = await window.api.engineEnsure({ storyId: sid, title: '故事' + sid, kernelId: 'k', kernelText: '# K' })
    await window.api.engineContext({ storyId: sid, playerInput: '薇拉在旧桥救了我一命', accessLevel: 'PLAYER' })
    return r
  }, id)
  await ensure('story-exp-1')
  await ensure('story-exp-2')
  const exportedPath = path.join(STAGE, 'progress.json')
  const exp = await win.evaluate((p) => window.api.exportProgress({ __testPath: p, sessions: [], workspaces: [] }), exportedPath)
  check('export-writes-bundle', exp && exp.ok === true && fs.existsSync(exportedPath))
  const bundle = JSON.parse(fs.readFileSync(exportedPath, 'utf8'))
  check('bundle-shape', bundle.type === 'sixworlds-progress' && bundle.engine && bundle.engine.files && Object.keys(bundle.engine.files).length > 0,
    'engine files=' + Object.keys(bundle.engine.files || {}).length)
  check('bundle-engine-files-under-whitelist', Object.keys(bundle.engine.files).every((k) => ['stories/', 'snapshots/', 'pendings/', 'logs/'].some((r) => k.startsWith(r))))
  const base = () => clone(bundle)

  // ---- 2. 防护拒绝：type / 路径 / 文件类型 / 非白名单目录 / 版本 / 结构 ----
  let r = await importVia({ ...base(), type: 'not-a-bundle', v: 1 })
  check('reject-wrong-type', r.ok === false && /不是有效的进度包/.test(r.error || ''), JSON.stringify(r && r.error))
  let doc = base(); doc.engine.files['stories/../../evil.json'] = '{}'
  r = await importVia(doc)
  check('reject-path-traversal', r.ok === false && /非法片段|越界|层级不正确/.test(r.error || ''), JSON.stringify(r && r.error))
  check('traversal-not-written', !fs.existsSync(path.join(PROFILE, 'evil.json')))
  doc = base(); doc.engine.files['stories/x.exe'] = '{}'
  r = await importVia(doc)
  check('reject-bad-file-type', r.ok === false && /不支持的引擎文件类型/.test(r.error || ''), JSON.stringify(r && r.error))
  doc = base(); doc.engine.files['tmp/x.json'] = '{}'
  r = await importVia(doc)
  check('reject-non-whitelisted-root', r.ok === false && /不支持的引擎文件目录/.test(r.error || ''), JSON.stringify(r && r.error))
  doc = base(); doc.v = 2
  r = await importVia(doc)
  check('reject-unsupported-version', r.ok === false && /版本不支持/.test(r.error || ''), JSON.stringify(r && r.error))
  doc = base(); doc.sessions = 'not-an-array'
  r = await importVia(doc)
  check('reject-bad-sessions', r.ok === false && /世界线数据不正确/.test(r.error || ''), JSON.stringify(r && r.error))
  doc = base(); doc.engine.files['memory.db'] = 'legacy-bytes'
  r = await importVia(doc)
  check('legacy-memory-db-skipped', r.ok === true, '旧包 memory.db 应跳过而非整包拒绝: ' + JSON.stringify(r && r.error))

  // ---- 3. 预览冻结与释放：延迟期间页面不可操作，预览返回后必须解冻 ----
  const previewInput = await writeInput(base())
  await openApp({ SIXWORLDS_TEST_IMPORT_PATH: previewInput, SIXWORLDS_TEST_IMPORT_DELAY_MS: '700' })
  const previewPending = win.evaluate(() => window.api.importProgress({ preview: true }))
  await win.waitForTimeout(150)
  const frozen = await win.evaluate(() => ({ inert: document.body.inert, busy: document.body.getAttribute('aria-busy') }))
  const previewResult = await previewPending
  const released = await win.evaluate(() => ({ inert: document.body.inert, busy: document.body.getAttribute('aria-busy') }))
  check('preview-freezes-renderer', frozen.inert === true && frozen.busy === 'true', JSON.stringify(frozen))
  check('preview-releases-renderer', previewResult.ok === true && previewResult.preview === true && released.inert === false && released.busy === null, JSON.stringify({ previewResult, released }))

  // ---- 4. 建立确定性的本机旧状态和上下文 ----
  const sessA = { id: 'sess-a', ws: 'ws-1', title: '桌面已有（旧）', messages: [{ role: 'user', content: '旧' }], updatedAt: 1000, createdAt: 900 }
  const sessANew = { id: 'sess-a', ws: 'ws-1', title: '包内同名（新）', messages: [{ role: 'user', content: '新' }], updatedAt: 2000, createdAt: 900 }
  const sessB = { id: 'sess-b', ws: 'ws-1', title: '包内新增', messages: [{ role: 'user', content: 'b' }], updatedAt: 3000, createdAt: 3000 }
  const sessE1 = { id: 'story-exp-1', ws: 'ws-1', title: '引擎线一', messages: [], updatedAt: 3100, createdAt: 3100 }
  const sessE2 = { id: 'story-exp-2', ws: 'ws-1', title: '引擎线二', messages: [], updatedAt: 3200, createdAt: 3200 }
  const ws = { id: 'ws-1', name: '默认世界', createdAt: 1, kernelId: 'k' }
  await win.evaluate(async ({ s, context }) => {
    await window.api.clearSessions()
    return window.api.saveSessions([s], context)
  }, { s: sessA, context: { workspaces: [ws], current: { currentWsId: 'ws-1', currentSessionId: 'sess-a' } } })

  // ---- 5. 默认 keep：冲突绝不因 updatedAt 自动替换；显式新增仍可导入 ----
  doc = base()
  doc.sessions = [sessANew, sessB, sessE1, sessE2]
  doc.workspaces = [ws]
  const e1 = JSON.parse(doc.engine.files['stories/story-exp-1.json'])
  e1.counters.turn = Number(e1.counters.turn || 0) + 10
  doc.engine.files['stories/story-exp-1.json'] = JSON.stringify(e1)
  r = await importVia(doc)
  check('default-keep-import-succeeds', r.ok === true && r.count === 4, JSON.stringify(r && { ok: r.ok, count: r.count, error: r.error }))
  check('default-keep-preserves-local-conflict', r.sessions.find((s) => s.id === 'sess-a').title === '桌面已有（旧）', '无 choices 时冲突应固定 keep')
  check('default-keep-adds-new-lines', r.sessions.some((s) => s.id === 'sess-b') && r.sessions.some((s) => s.id === 'story-exp-1'))
  check('import-engine-files-written', fs.existsSync(path.join(ENGINE_DIR, 'stories', 'story-exp-1.json')) && JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'stories', 'story-exp-1.json'), 'utf8')).counters.turn === e1.counters.turn)
  const mirror = path.join(PROFILE, 'session-data', 'sessions.json')
  check('import-writes-mirror', fs.existsSync(mirror) && JSON.parse(fs.readFileSync(mirror, 'utf8')).sessions.length === 4)
  const contextFile = path.join(PROFILE, 'desktop-context.json')
  const contextAfterImport = JSON.parse(fs.readFileSync(contextFile, 'utf8'))
  check('import-writes-desktop-context', contextAfterImport.workspaces.length === 1 && contextAfterImport.current.currentWsId === 'ws-1' && contextAfterImport.current.currentSessionId === 'sess-a')

  await win.reload()
  await win.waitForSelector('#btn-archives')
  await win.waitForTimeout(900)
  const disk = await win.evaluate(() => window.api.loadSessions())
  check('renderer-sees-imported', disk.ok && disk.sessions.some((s) => s.title === '包内新增') && disk.sessions.some((s) => s.title === '桌面已有（旧）'),
    'disk titles=' + disk.sessions.map((s) => s.title).join('/'))

  // ---- 6. 旧包选择 keep 时不得回退本机较新的记忆 ----
  await win.evaluate(async () => {
    await window.api.engineEnsure({ storyId: 'sess-a', title: 'new state', kernelText: '# K' })
    await window.api.engineCommit({ storyId: 'sess-a', raw: '<<<STATE_PATCH>>> {"turn_summary":"newer","player_state":{"resources_add":{"gold":99}}} <<<END_PATCH>>>' })
  })
  doc = base()
  doc.sessions = [sessA]
  doc.workspaces = [ws]
  doc.engine.files['stories/sess-a.json'] = JSON.stringify({ story_id: 'sess-a', invalid: true })
  r = await importVia(doc)
  const newer = await win.evaluate(() => window.api.engineOverview({ storyId: 'sess-a' }))
  check('stale-import-keeps-newer-memory', r.ok && newer.data && newer.data.player.resources.gold === 99, JSON.stringify(newer && newer.data && newer.data.player && newer.data.player.resources))

  // ---- 7. 显式 replace：替换聊天与记忆，并清理本机同线旧状态 ----
  const replaceStory = JSON.parse(base().engine.files['stories/story-exp-1.json'])
  rewriteStoryOwner(replaceStory, 'sess-a')
  replaceStory.counters.turn = 88
  const replaceDoc = base()
  replaceDoc.sessions = [{ ...sessANew, updatedAt: 9000, title: '明确采用的包内线' }]
  replaceDoc.workspaces = [ws]
  replaceDoc.engine.files = {
    'stories/sess-a.json': JSON.stringify(replaceStory),
    'stories/sess-a.meta.json': JSON.stringify({ story_id: 'sess-a', title: '明确采用的包内线' })
  }
  r = await importVia(replaceDoc, null, { choices: { 'sess-a': 'replace' } })
  check('explicit-replace-succeeds', r.ok === true && r.sessions.find((s) => s.id === 'sess-a').title === '明确采用的包内线', JSON.stringify(r && r.error))
  check('explicit-replace-writes-memory', JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'), 'utf8')).counters.turn === 88)

  // ---- 8. 显式 branch：新 id / 新文件，原世界线正文与状态不变 ----
  const originalBeforeBranch = fs.readFileSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'), 'utf8')
  const branchStory = JSON.parse(originalBeforeBranch)
  branchStory.counters.turn = 99
  const branchDoc = base()
  branchDoc.sessions = [{ ...sessANew, updatedAt: 10000, title: '另开分支' }]
  branchDoc.workspaces = [ws]
  branchDoc.engine.files = {
    'stories/sess-a.json': JSON.stringify(branchStory),
    'stories/sess-a.meta.json': JSON.stringify({ story_id: 'sess-a', title: '另开分支' })
  }
  r = await importVia(branchDoc, null, { choices: { 'sess-a': 'branch' } })
  const branch = r.sessions && r.sessions.find((s) => s.ifFrom === 'sess-a')
  check('explicit-branch-succeeds', r.ok === true && branch && branch.id !== 'sess-a' && /^导入分支 · /.test(branch.title), JSON.stringify(r && r.error))
  check('explicit-branch-preserves-original', fs.readFileSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'), 'utf8') === originalBeforeBranch && branch && fs.existsSync(path.join(ENGINE_DIR, 'stories', branch.id + '.json')))

  // ---- 9. 每个提交阶段失败都回滚 SQLite、JSON、引擎文件和 desktop-context ----
  const failureSource = clone(replaceDoc)
  failureSource.sessions[0].title = '失败注入不应留下'
  const failureStages = ['engine-files', 'sessions-db', 'sessions-file', 'desktop-context']
  for (const stage of failureStages) {
    const before = await win.evaluate(() => window.api.loadSessions())
    const beforeContext = JSON.parse(fs.readFileSync(contextFile, 'utf8'))
    const beforeEngine = fs.existsSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'))
      ? fs.readFileSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'), 'utf8') : null
    r = await importVia(failureSource, { SIXWORLDS_TEST_IMPORT_FAIL: stage }, { choices: { 'sess-a': 'replace' } })
    const after = await win.evaluate(() => window.api.loadSessions())
    const afterContext = JSON.parse(fs.readFileSync(contextFile, 'utf8'))
    const afterEngine = fs.existsSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'))
      ? fs.readFileSync(path.join(ENGINE_DIR, 'stories', 'sess-a.json'), 'utf8') : null
    const sameSessions = JSON.stringify(after.sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })).sort((a, b) => a.id.localeCompare(b.id))) ===
      JSON.stringify(before.sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })).sort((a, b) => a.id.localeCompare(b.id)))
    check('rollback-' + stage, r.ok === false && /已恢复/.test(r.error || '') && sameSessions && JSON.stringify(afterContext) === JSON.stringify(beforeContext) && afterEngine === beforeEngine,
      JSON.stringify({ error: r.error, released: await win.evaluate(() => ({ inert: document.body.inert, busy: document.body.getAttribute('aria-busy') })) }))
    check('rollback-' + stage + '-releases-renderer', await win.evaluate(() => document.body.inert === false && document.body.getAttribute('aria-busy') === null))
  }

  // ---- 10. 纯文件降级路径：禁用 SQLite 也保留原有世界线 ----
  doc = base()
  doc.sessions = [{ id: 'sess-c', ws: 'ws-1', title: 'file fallback', messages: [], updatedAt: 12000, createdAt: 12000 }]
  doc.workspaces = [ws]
  r = await importVia(doc, { SIXWORLDS_SESSIONS_DB: 'off' })
  check('file-fallback-import-preserves-existing', r.ok && ['sess-a', 'sess-b', 'sess-c'].every((id) => r.sessions.some((s) => s.id === id)),
    JSON.stringify(r && r.sessions && r.sessions.map((s) => s.id)))

  await closeApp()
  fs.rmSync(STAGE, { recursive: true, force: true })
  fs.rmSync(PROFILE, { recursive: true, force: true })
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
  process.exit(fails.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await closeApp()
  try { fs.rmSync(STAGE, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch {}
  process.exit(1)
})

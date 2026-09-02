// 进度包导出→导入往返 + 防护拒绝（主进程级 e2e，走真实 IPC + 测试接缝注入路径）。
// 覆盖：progress:import 的三道防线（限额/路径白名单/越界）与移动端 EngineImportPolicy 对齐、
// 会话合并语义（按 id 保留较新 updatedAt）、引擎文件真实落盘、引擎句柄重建后可继续使用。
// 用法：SIXWORLDS_TEST_IMPORT_PATH 注入由 node scripts-dev/test-progress-import.cjs 自行管理
const path = require('path')
const fs = require('fs')
const os = require('os')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const PROFILE = path.join(process.env.APPDATA, '六面世界', 'test-profile')
const ENGINE_DIR = path.join(PROFILE, 'story-engine')
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-import-'))

const launch = (extraEnv) => electron.launch({
  executablePath: electronExecutable,
  args: ['.'],
  cwd: ROOT,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1', ...(extraEnv || {}) }
})

async function main() {
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }
  fs.rmSync(PROFILE, { recursive: true, force: true })

  // ---- 1. 造引擎数据（真实引擎 IPC 写两条故事）→ 导出进度包（接缝路径） ----
  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForTimeout(1600)
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

  // ---- 2. 防护拒绝：type 不符 / 路径穿越 / 坏文件类型 / 非白名单目录 ----
  const tryImport = async (mutator) => {
    const bad = path.join(STAGE, 'bad.json')
    const doc = JSON.parse(fs.readFileSync(exportedPath, 'utf8'))
    mutator(doc)
    fs.writeFileSync(bad, JSON.stringify(doc))
    app // 同一实例：env 注入需重启才生效——改为重启内联
    return null
  }
  const importVia = async (doc) => {
    const p = path.join(STAGE, 'in.json')
    fs.writeFileSync(p, JSON.stringify(doc))
    await app.close()
    app = await launch({ SIXWORLDS_TEST_IMPORT_PATH: p })
    win = await app.firstWindow()
    await win.waitForTimeout(1600)
    return win.evaluate(() => window.api.importProgress())
  }
  const base = () => JSON.parse(fs.readFileSync(exportedPath, 'utf8'))

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

  // ---- 3. 正常导入：引擎文件落盘 + 会话合并（按 id 保留较新） ----
  const sessA = { id: 'sess-a', ws: 'ws-1', title: '桌面已有（旧）', messages: [{ role: 'user', content: '旧' }], updatedAt: 1000, createdAt: 900 }
  const sessANew = { id: 'sess-a', ws: 'ws-1', title: '包内同名（新）', messages: [{ role: 'user', content: '新' }], updatedAt: 2000, createdAt: 900 }
  const sessB = { id: 'sess-b', ws: 'ws-1', title: '包内新增', messages: [{ role: 'user', content: 'b' }], updatedAt: 3000, createdAt: 3000 }
  // 先落一条桌面旧会话
  await win.evaluate(async (s) => { await window.api.clearSessions(); await window.api.saveSessions([s]) }, sessA)
  await win.waitForTimeout(400)
  doc = base()
  doc.sessions = [sessANew, sessB]
  doc.workspaces = [{ id: 'ws-1', name: '默认世界', createdAt: 1 }]
  r = await importVia(doc)
  check('import-succeeds', r.ok === true && r.count === 2, JSON.stringify(r && { ok: r.ok, count: r.count, error: r.error }))
  check('import-merges-by-id-keeps-newer', r.sessions.find((s) => s.id === 'sess-a').title === '包内同名（新）', '同名会话应保留较新 updatedAt')
  check('import-engine-files-written', fs.existsSync(path.join(ENGINE_DIR, 'stories', 'story-exp-1.json')) && fs.existsSync(path.join(ENGINE_DIR, 'stories', 'story-exp-2.json')))
  // 引擎句柄已重建：新会话能继续走引擎 IPC
  await win.waitForTimeout(600)
  const ensureOk = await win.evaluate(async () => {
    // safeHandle 信封：engine IPC 返回 { ok, data: { story_id, created, ... } }——断言用解包后的形状
    try {
      const e = await window.api.engineEnsure({ storyId: 'story-exp-1', title: '故事', kernelId: 'k', kernelText: '# K' })
      return { ok: e.ok === true, sid: e.data && e.data.story_id, created: e.data && e.data.created }
    } catch (err) { return { ok: false, err: String(err) } }
  })
  check('engine-reusable-after-import', ensureOk.ok === true && ensureOk.sid === 'story-exp-1' && ensureOk.created === false, JSON.stringify(ensureOk))

  // ---- 4. 双写镜像同步：导入合并结果也写 sessions.json（兼容面） ----
  const mirror = path.join(PROFILE, 'session-data', 'sessions.json')
  check('import-writes-mirror', fs.existsSync(mirror) && JSON.parse(fs.readFileSync(mirror, 'utf8')).sessions.length === 2)

  // ---- 5. reload 后世界线在渲染层可见 ----
  await win.reload()
  await win.waitForTimeout(1800)
  const titles = await win.evaluate(() => (JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]')).map((s) => s.title).join('|') || window.__sessTitles || '')
  const disk = await win.evaluate(() => window.api.loadSessions())
  check('renderer-sees-imported', disk.ok && disk.sessions.some((s) => s.title === '包内同名（新）') && disk.sessions.some((s) => s.title === '包内新增'),
    'disk titles=' + disk.sessions.map((s) => s.title).join('/'))
  await app.close()

  fs.rmSync(STAGE, { recursive: true, force: true })
  await new Promise((res) => setTimeout(res, 700))
  fs.rmSync(PROFILE, { recursive: true, force: true })
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch(async (e) => { console.error(e); try { fs.rmSync(STAGE, { recursive: true, force: true }) } catch {} process.exit(1) })

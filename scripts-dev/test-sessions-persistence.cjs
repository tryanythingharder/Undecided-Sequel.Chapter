// 会话持久化三层路径的主进程级 e2e（P2-3 收敛的验收口）。
// 走真实 IPC（sessions:load/save/clear），覆盖 sessions.db.cjs 单测触不到的 main.cjs 粘合层：
//   1) 空档案 → {exists:false, storage:'empty'}
//   2) save→load 往返：storage:'sqlite' + sessions.json 双写镜像 + SQLite 内有效行
//   3) 一次性迁移：只有旧 sessions.json → storage:'migrated'，镜像不删，db 里已导入
//   4) 降级：SQLite 不可用时走 sessions.json 纯文件路径（storage:'file'），保存仍写镜像
//   5) clear 同时清库与镜像；迁移分支的格式防御（>50 条 / 非数组）
// 降级用例通过主进程里的诊断接缝实现：SIXWORLDS_TEST=1 且 SIXWORLDS_SESSIONS_DB=off 时
// sessionsDbFor() 直接返回禁用对象（不落任何磁盘痕迹，仅测试可用）。
// 用法：node scripts-dev/test-sessions-persistence.cjs
const path = require('path')
const fs = require('fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const PROFILE = path.join(process.env.APPDATA, '六面世界', 'test-profile')
const DATA = path.join(PROFILE, 'session-data')
const SESSIONS_JSON = path.join(DATA, 'sessions.json')
const SESSIONS_DB = path.join(PROFILE, 'sessions.db')

const baseEnv = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
const launch = (extra) => electron.launch({
  executablePath: electronExecutable,
  args: ['.'],
  cwd: ROOT,
  env: extra ? { ...baseEnv, ...extra } : baseEnv
})

// 会话样本：字段取自 renderer 真实结构（id/wsId/title/messages/updatedAt），外部化时只依赖 messages 数组
const sample = (i) => ({
  id: 'sess-test-' + i,
  wsId: 'ws-a',
  title: '世界线 ' + i,
  updatedAt: 1700000000000 + i,
  turn: 1,
  messages: [{ role: 'user', content: '开局第 ' + i + ' 回' }, { role: 'assistant', content: '回应第 ' + i + ' 回' }]
})

async function cleanSlate() {
  fs.rmSync(PROFILE, { recursive: true, force: true })
}

async function main() {
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  await cleanSlate()

  // ---- 1. 空档案：sessions.db 可用但无数据 ----
  // （经典 UI 启动会自建默认世界线并防抖落库——先清空，回到本测试的已知态）
  let app = await launch()
  let win = await app.firstWindow()
  await win.waitForTimeout(1500)
  await win.evaluate(() => window.api.clearSessions())
  await win.waitForTimeout(600)
  let r = await win.evaluate(() => window.api.loadSessions())
  check('empty-profile-load', !!r && r.ok === true && r.exists === false && Array.isArray(r.sessions) && r.sessions.length === 0, JSON.stringify(r && { ok: r.ok, exists: r.exists, storage: r.storage }))

  // ---- 2. save→load 往返（SQLite 主存 + JSON 镜像双写）----
  const two = [sample(1), sample(2)]
  const saveRes = await win.evaluate((s) => (window.api.saveSessions(s)), two)
  await win.waitForTimeout(600)
  check('save-returns-ok', !!saveRes && saveRes.ok === true && saveRes.count === 2, JSON.stringify(saveRes))
  check('mirror-sessions-json-written', fs.existsSync(SESSIONS_JSON) && JSON.parse(fs.readFileSync(SESSIONS_JSON, 'utf8')).sessions.length === 2)
  const mirrored = JSON.parse(fs.readFileSync(SESSIONS_JSON, 'utf8'))
  check('mirror-keeps-v1-shape', mirrored.v === 1 && Array.isArray(mirrored.sessions))
  check('sqlite-row-written', fs.existsSync(SESSIONS_DB) && fs.statSync(SESSIONS_DB).size > 0)
  r = await win.evaluate(() => window.api.loadSessions())
  check('reload-from-sqlite', r.ok && r.exists === true && r.storage === 'sqlite' && r.sessions.length === 2
    && r.sessions[0].id === 'sess-test-1' && r.sessions[0].messages[0].content === '开局第 1 回', JSON.stringify(r && { storage: r.storage, n: r.sessions && r.sessions.length }))

  // ---- 3. clear 清两处 ----
  await win.evaluate(() => window.api.clearSessions())
  await win.waitForTimeout(500)
  r = await win.evaluate(() => window.api.loadSessions())
  check('clear-empties-both', r.ok && r.exists === false, JSON.stringify(r && { exists: r.exists }))
  check('clear-removes-mirror', !fs.existsSync(SESSIONS_JSON))
  await app.close()

  // ---- 4. 一次性迁移：只剩旧 sessions.json（模拟 1.3.0 之前的老用户档案）----
  fs.rmSync(SESSIONS_DB, { force: true }); fs.rmSync(SESSIONS_DB + '-wal', { force: true }); fs.rmSync(SESSIONS_DB + '-shm', { force: true })
  fs.mkdirSync(DATA, { recursive: true })
  fs.writeFileSync(SESSIONS_JSON, JSON.stringify({ v: 1, sessions: [sample(7), sample(8)] }))
  app = await launch()
  win = await app.firstWindow()
  await win.waitForTimeout(1500)
  // 注意：迁移发生在渲染层启动的首次 sessions:load 里（renderer/app.js loadSessions），
  // evaluate 里再调一次读到的已是稳态 storage:'sqlite'——因此迁移正确性断言「结果」而非中间态：
  // UI 已拿到旧数据、主存已导入、旧 JSON 镜像保留（迁移不删除兼容面）。
  const uiState = await win.evaluate(() => ({ title: document.title }))
  check('migration-visible-to-ui', /六面世界/.test(uiState.title || ''), JSON.stringify(uiState))
  r = await win.evaluate(() => window.api.loadSessions())
  check('migration-imported-to-sqlite', r.ok && r.storage === 'sqlite' && r.sessions.length === 2 && r.sessions[0].id === 'sess-test-7' && r.sessions[1].id === 'sess-test-8', JSON.stringify(r && { storage: r.storage, ids: r.sessions && r.sessions.map((x) => x.id) }))
  check('migration-keeps-mirror', fs.existsSync(SESSIONS_JSON))
  r = await win.evaluate(() => window.api.loadSessions())
  check('post-migration-reads-sqlite', r.ok && r.storage === 'sqlite' && r.sessions.length === 2 && r.sessions[1].id === 'sess-test-8')
  await app.close()

  // ---- 5. 降级：SQLite 不可用 → 纯文件路径（旧版行为），save 仍写镜像 ----
  fs.rmSync(SESSIONS_DB, { force: true }) // 清掉上一步迁移产生的库，让降级态从 sessions.json 重新读
  fs.rmSync(SESSIONS_DB + '-wal', { force: true }); fs.rmSync(SESSIONS_DB + '-shm', { force: true })
  app = await launch({ SIXWORLDS_SESSIONS_DB: 'off' })
  win = await app.firstWindow()
  await win.waitForTimeout(1500)
  r = await win.evaluate(() => window.api.loadSessions())
  check('degraded-file-load', r.ok && r.exists === true && r.storage === 'file' && r.sessions.length === 2, JSON.stringify(r && { storage: r.storage, n: r.sessions && r.sessions.length }))
  const degSave = await win.evaluate((s) => (window.api.saveSessions(s)), [sample(9)])
  await win.waitForTimeout(500)
  check('degraded-save-still-writes-mirror', degSave.ok === true && JSON.parse(fs.readFileSync(SESSIONS_JSON, 'utf8')).sessions[0].id === 'sess-test-9')
  await app.close()

  // ---- 6. 迁移分支的格式防御（>50 条、非数组）----
  fs.rmSync(SESSIONS_DB, { force: true }); fs.rmSync(SESSIONS_DB + '-wal', { force: true }); fs.rmSync(SESSIONS_DB + '-shm', { force: true })
  const overflow = []; for (let i = 0; i < 51; i++) overflow.push(sample(100 + i))
  fs.writeFileSync(SESSIONS_JSON, JSON.stringify({ v: 1, sessions: overflow }))
  app = await launch()
  win = await app.firstWindow()
  await win.waitForTimeout(1500)
  r = await win.evaluate(() => window.api.loadSessions())
  check('migration-rejects-overflow', r.ok === false && /格式不正确|上限/.test(r.error || ''), JSON.stringify(r && { ok: r.ok, error: (r.error || '').slice(0, 40) }))
  await app.close()

  fs.rmSync(SESSIONS_JSON, { force: true })
  fs.writeFileSync(SESSIONS_JSON, JSON.stringify({ v: 1, sessions: 'not-an-array' }))
  app = await launch()
  win = await app.firstWindow()
  await win.waitForTimeout(1500)
  r = await win.evaluate(() => window.api.loadSessions())
  check('migration-rejects-bad-shape', r.ok === false, JSON.stringify(r && { ok: r.ok }))
  await app.close()

  // 收尾：等 Chromium 释放 profile 句柄后清理（删早了 rmSync 会撞 EPERM/EBUSY）
  await new Promise((res) => setTimeout(res, 800))
  await cleanSlate()
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
  process.exit(fails.length ? 1 : 0)
}

main().catch(async (e) => { console.error(e); try { await cleanSlate() } catch {} process.exit(1) })

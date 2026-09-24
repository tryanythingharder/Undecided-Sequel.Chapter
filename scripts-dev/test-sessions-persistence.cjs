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

  // ---- 2.5 漫画回放分镜的外置/水合（session.comic.panels 与消息插图同管线）----
  // 1x1 PNG（透明）的 base64 data URL：save 后应外置为 session-data/images 文件，
  // 消息内只留 asset 引用；load 时水合回 sixworlds-asset:// 协议地址。
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const comicSession = {
    id: 'sess-test-comic', wsId: 'ws-a', title: '漫画线', updatedAt: 1700000000090, turn: 1,
    messages: [
      { role: 'user', content: '开局' },
      { role: 'assistant', content: '多图回应', illusts: ['data:image/png;base64,' + PNG_B64, 'data:image/png;base64,' + PNG_B64] }
    ],
    comic: {
      version: 1, createdAt: 1700000000090, updatedAt: 1700000000090,
      cast: [{ name: '主角', look: 'young man' }],
      panels: [
        { idx: 0, turn: 1, title: '开场', narration: '故事开始', participants: ['主角'], sceneLine: '【历｜清晨｜村】', prompt: '', illusts: ['data:image/png;base64,' + PNG_B64, 'data:image/png;base64,' + PNG_B64], illustAt: 1700000000100 },
        { idx: 1, turn: 2, title: '第二幕', narration: '继续', participants: ['主角'], sceneLine: '', prompt: '', illust: null, illustPending: false, illustError: null }
      ],
      progress: { state: 'done', done: 2, failed: 0 }
    }
  }
  const comicSave = await win.evaluate((s) => (window.api.saveSessions(s)), [comicSession])
  await win.waitForTimeout(600)
  check('comic-save-ok', !!(comicSave && comicSave.ok), JSON.stringify(comicSave))
  // 外置后：磁盘上出现图片文件；加载水合回 asset URL；未绘制的 panel 2 不产生文件
  r = await win.evaluate(() => window.api.loadSessions())
  const cs = r.sessions && r.sessions.find((x) => x.id === 'sess-test-comic')
  const multiMessage = cs && cs.messages.find((m) => m.role === 'assistant')
  check('message-multi-image-hydrated', !!multiMessage && Array.isArray(multiMessage.illusts) && multiMessage.illusts.length === 2 && multiMessage.illusts.every((u) => /^sixworlds-asset:\/\/image\//.test(String(u))),
    JSON.stringify(multiMessage && { count: multiMessage.illusts && multiMessage.illusts.length, first: String(multiMessage.illusts?.[0] || '').slice(0, 40) }))
  check('message-first-image-compat-alias', !!multiMessage && multiMessage.illust === multiMessage.illusts[0])
  const multiPanel = cs && cs.comic && cs.comic.panels[0]
  check('comic-panel-multi-image-hydrated', !!multiPanel && Array.isArray(multiPanel.illusts) && multiPanel.illusts.length === 2 && multiPanel.illusts.every((u) => /^sixworlds-asset:\/\/image\//.test(String(u))),
    JSON.stringify(multiPanel && { count: multiPanel.illusts && multiPanel.illusts.length, first: String(multiPanel.illusts?.[0] || '').slice(0, 40) }))
  check('comic-panel-first-image-compat-alias', !!multiPanel && multiPanel.illust === multiPanel.illusts[0])
  check('comic-panel-structure-kept', !!(cs && cs.comic.cast.length === 1 && cs.comic.panels.length === 2 && cs.comic.panels[1].illust == null),
    JSON.stringify(cs && cs.comic && { cast: cs.comic.cast.length, panels: cs.comic.panels.length }))
  // 二次保存（水合后的 asset URL 再落盘）：不产生新文件、引用仍有效（幂等）
  const comicSave2 = await win.evaluate((s) => (window.api.saveSessions(s)), r.sessions)
  await win.waitForTimeout(600)
  check('comic-asset-roundtrip-idempotent', !!(comicSave2 && comicSave2.ok), JSON.stringify(comicSave2))

  // 历史引用超过原累计上限后，仍须允许全量保存和重启读取。
  const repeatedUrl = 'data:image/png;base64,' + PNG_B64
  const longSession = {
    ...sample('long-images'),
    messages: Array.from({ length: 1001 }, (_, i) => ({ role: 'assistant', content: '回合 ' + i, illusts: [repeatedUrl, repeatedUrl] }))
  }
  const longSave = await win.evaluate((s) => window.api.saveSessions(s), [longSession])
  check('long-session-over-2000-image-references-saves', longSave.ok === true, JSON.stringify(longSave))
  r = await win.evaluate(() => window.api.loadSessions())
  const loadedLong = r.sessions?.find((s) => s.id === 'sess-test-long-images')
  check('long-session-over-2000-image-references-loads', loadedLong?.messages.length === 1001 && loadedLong.messages.every((m) => m.illusts?.length === 2),
    JSON.stringify(loadedLong && { messages: loadedLong.messages.length, firstImages: loadedLong.messages[0].illusts?.length }))
  const longSaveAgain = await win.evaluate((s) => window.api.saveSessions(s), r.sessions)
  check('long-session-over-2000-historical-references-resaves', longSaveAgain.ok === true, JSON.stringify(longSaveAgain))

  const countFiles = (dir) => !fs.existsSync(dir) ? 0 : fs.readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => {
    const full = path.join(dir, entry.name)
    return n + (entry.isDirectory() ? countFiles(full) : 1)
  }, 0)
  const imageFilesBeforeRejectedSave = countFiles(path.join(DATA, 'images'))
  const tooManyNewImages = {
    ...sample('too-many-new-images'),
    messages: [{ role: 'assistant', content: '超限新图', illusts: Array.from({ length: 2001 }, (_, i) => 'data:image/png;base64,' + Buffer.from('new-image-' + i).toString('base64')) }]
  }
  const rejectedImages = await win.evaluate((s) => window.api.saveSessions(s), [tooManyNewImages])
  check('over-2000-new-images-rejected-explicitly', rejectedImages.ok === false && /新增插图超过上限/.test(rejectedImages.error || ''), JSON.stringify(rejectedImages))
  check('rejected-image-save-leaves-no-partial-files', countFiles(path.join(DATA, 'images')) === imageFilesBeforeRejectedSave)

  // 批量导出跨越原单批 100 张限制：preload 分批调用真实主进程 IPC。
  const imageExportDir = path.join(PROFILE, 'image-export')
  fs.mkdirSync(imageExportDir, { recursive: true })
  const imageBatch = await win.evaluate(({ dataUrl, directory }) => window.api.saveAllImages({
    items: Array.from({ length: 101 }, () => ({ dataUrl })), nameBase: 'batch-regression', __testDirectory: directory
  }), { dataUrl: repeatedUrl, directory: imageExportDir })
  const exportedNames = fs.readdirSync(imageExportDir)
  const expectedNames = Array.from({ length: 101 }, (_, i) => 'batch-regression-' + String(i + 1).padStart(2, '0') + '.png')
  check('image-save-all-over-100-succeeds-through-real-ipc', imageBatch.ok === true && imageBatch.saved === 101 && imageBatch.failed.length === 0, JSON.stringify(imageBatch))
  check('image-save-all-over-100-writes-contiguous-files', exportedNames.length === 101 && expectedNames.every((name) => exportedNames.includes(name)), JSON.stringify({ count: exportedNames.length, missing: expectedNames.filter((name) => !exportedNames.includes(name)).slice(0, 5) }))

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

  // ---- 6. 迁移分支的格式防御（P2 上限治理：>200 条不拒载而是截旧保新；非数组仍拒）----
  fs.rmSync(SESSIONS_DB, { force: true }); fs.rmSync(SESSIONS_DB + '-wal', { force: true }); fs.rmSync(SESSIONS_DB + '-shm', { force: true })
  const overflow = []; for (let i = 0; i < 201; i++) overflow.push(sample(100 + i))
  fs.writeFileSync(SESSIONS_JSON, JSON.stringify({ v: 1, sessions: overflow }))
  app = await launch()
  win = await app.firstWindow()
  await win.waitForTimeout(1500)
  r = await win.evaluate(() => window.api.loadSessions())
  const ids = (r.sessions || []).map((s) => s.id)
  check('migration-overflow-truncates-keeps-newest', r.ok === true && r.sessions.length === 200 && ids.includes('sess-test-300') && !ids.includes('sess-test-100'), JSON.stringify(r && { ok: r.ok, n: r.sessions && r.sessions.length }))
  await app.close()

  // 上一步溢出迁移成功后库里有数据——先清库，坏形状才会真正走到 JSON 迁移分支
  fs.rmSync(SESSIONS_DB, { force: true }); fs.rmSync(SESSIONS_DB + '-wal', { force: true }); fs.rmSync(SESSIONS_DB + '-shm', { force: true })
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

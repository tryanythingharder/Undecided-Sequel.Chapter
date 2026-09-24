'use strict'
/* 完整存档（Archive Store）—— 独立单元测试（无需 Electron，不触真实存档、不调收费服务）
 * 运行：node scripts-dev/test-archives.cjs
 * 临时数据只写在工作区 output/archive-tests/unit/ 内（结束即清理），不使用 os.tmpdir。
 * 覆盖：1000 回合 + 插图往返、导出/导入、路径格式（反斜杠/NUL/ADS/尾随点空格/保留设备名/白名单外）、
 *       符号链接与目录联接拒绝、大小与条目硬闸、manifest 角色校验、恢复前自动存档保留 10 份且
 *       目标存档不被清理误删、恢复覆盖真实资料（作品/内核/闪卡）但不含密钥、故障回滚。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createArchiveStore } = require('../engine/archive-store')

const root = path.join(__dirname, '..', 'output', 'archive-tests', 'unit')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

const checks = []
function check(name, fn) {
  const dir = path.join(root, 'case-' + String(checks.length + 1).padStart(2, '0'))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  try {
    fn(dir)
    checks.push({ name, pass: true })
    console.log('  PASS ' + name)
  } catch (error) {
    checks.push({ name, pass: false, error })
    console.log('  FAIL ' + name + '  << ' + (error && error.message))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const context = (sessions) => ({ sessions, workspaces: [{ id: 'world', name: 'World' }], current: { currentWsId: 'world', currentSessionId: 'story' } })
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data) }
const read = (file) => fs.readFileSync(file, 'utf8')
/* 用给定 file.path 覆盖归档内的清单，返回被篡改的存档编号。
 * 每次都从 pristine（新建时的原始清单）出发，避免上一项篡改残留影响下一项的判定顺序。 */
function tamperManifest(dir, store, id, mutate, pristine) {
  const file = path.join(dir, 'archives', id, 'manifest.json')
  const doc = JSON.parse(pristine || read(file))
  mutate(doc)
  fs.writeFileSync(file, JSON.stringify(doc))
  return id
}
function pristineManifest(dir, id) { return read(path.join(dir, 'archives', id, 'manifest.json')) }

// ---- 1. 1000 回合 + 插图：归档、导出/导入、恢复、校验和、路径边界（兼容面回归） ----
check('1000 回合 / 插图 / 导出导入 / 恢复 / 校验和 / 路径边界', (dir) => {
  const store = createArchiveStore(dir)
  const image = Buffer.from('test image bytes')
  write(path.join(dir, 'session-data/images/abc/one.png'), image)
  write(path.join(dir, 'story-engine/stories/story.json'), JSON.stringify({ story_id: 'story', turn: 1000 }))
  const sessions = [{ id: 'story', messages: Array.from({ length: 2000 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', content: 'Message ' + n })) }]
  const ctx = context(sessions)
  const first = store.create({ ...ctx, label: '1000 rounds' })
  assert.equal(first.messages, 2000)
  const out = path.join(dir, 'story.swarchive')
  store.exportFile(first.id, out)
  const imported = store.importFile(out)
  assert.equal(store.inspect(imported.id).sessions[0].messages.length, 2000)
  write(path.join(dir, 'session-data/images/abc/one.png'), 'new image')
  let committed
  const restored = store.restore(imported.id, ctx, (doc) => { committed = doc }, () => {})
  assert.deepEqual(fs.readFileSync(path.join(dir, 'session-data/images/abc/one.png')), image)
  assert.equal(committed.sessions[0].messages[1999].content, 'Message 1999')
  assert.ok(store.list().some((item) => item.id === restored.rollbackId))
  write(path.join(dir, 'session-data/images/abc/one.png'), 'keep after rollback')
  let fail = true
  assert.throws(() => store.restore(first.id, ctx, () => { if (fail) { fail = false; throw new Error('commit failure') } }, () => {}), /commit failure/)
  assert.equal(read(path.join(dir, 'session-data/images/abc/one.png')), 'keep after rollback')
  write(path.join(dir, 'archives', first.id, 'session-data/images/abc/one.png'), 'tampered')
  assert.throws(() => store.restore(first.id, ctx, () => {}, () => {}), /损坏/)
  assert.equal(read(path.join(dir, 'session-data/images/abc/one.png')), 'keep after rollback')
  assert.throws(() => store.inspect('../escape'), /无效/)
  assert.throws(() => store.inspect('ARC-nope'), /无效/)
})

// ---- 2. 路径格式：反斜杠 / NUL / ADS / 尾随点空格 / 保留设备名 / 白名单外 / 越界 ----
check('路径格式与 Windows ADS 拒绝', (dir) => {
  const store = createArchiveStore(dir)
  write(path.join(dir, 'session-data/images/abc/one.png'), 'x')
  const id = store.create({ ...context([{ id: 'story', messages: [{ role: 'user', content: 'hi' }] }]), label: 'ok' }).id
  const pristine = pristineManifest(dir, id)
  const bad = [
    '../escape', 'session-data/images/../../escape',
    'session-data\\images\\abc\\one.png',                 // 反斜杠
    'session-data/images/abc/one.png\u0000.png',          // NUL
    'session-data/images/abc/one.png:ads',                // Windows ADS
    'session-data/images/abc/one.png.',                   // 尾随点
    'session-data/images/abc/one.png ',                   // 尾随空格
    'session-data/images/CON', 'session-data/images/com1.png', 'session-data/images/nul.png',
    'story-engine/memory.db',                             // 派生索引：不归档
    'story-engine/tmp/x.json',                            // 临时目录：不归档
    'pet-model/pet-model.gguf',                           // 模型权重：不归档
    'secrets.json', 'session-data/images/secrets.json',   // 密钥：绝不归档
    'kernels/embedder.json',
    '/etc/passwd', 'C:/Windows/win.ini',
    'session-data/images/abc/'                            // 空段
  ]
  for (const p of bad) {
    tamperManifest(dir, store, id, (doc) => { doc.files = [{ path: p, bytes: 1, sha256: 'a'.repeat(64) }] }, pristine)
    assert.throws(() => store.inspect(id), /非法存档路径|不支持的数据目录|不得包含密钥/, '应拒绝：' + p)
    assert.throws(() => store.restore(id, context([]), () => {}, () => {}), /非法存档路径|不支持的数据目录|不得包含密钥/, '恢复也应拒绝：' + p)
  }
  // 正常路径仍可读（反证夹具有效：篡改本身不导致误判）
  tamperManifest(dir, store, id, (doc) => { doc.files = [{ path: 'session-data/images/abc/one.png', bytes: 1, sha256: require('node:crypto').createHash('sha256').update('x').digest('hex') }] }, pristine)
  assert.equal(store.inspect(id).files.length, 1)
})

// ---- 3. 符号链接 / 目录联接：归档内与数据目录链路一律拒绝 ----
check('符号链接与目录联接拒绝', (dir) => {
  if (process.platform !== 'win32' && typeof fs.symlinkSync !== 'function') return
  const store = createArchiveStore(dir)
  const outside = path.join(dir, 'outside')
  write(path.join(outside, 'secret.txt'), 'outside data')
  write(path.join(dir, 'session-data/images/abc/one.png'), 'x')
  const linkDir = path.join(dir, 'session-data/images/link')
  try { fs.symlinkSync(outside, linkDir, 'junction') } catch (e) { console.log('    （跳过：本环境不允许创建符号链接 ' + e.code + '）'); return }
  assert.throws(() => store.create({ ...context([]), label: 'should fail' }), /符号链接/)
  fs.rmSync(linkDir, { recursive: true, force: true })
  // 归档目录内的符号链接：校验阶段拒绝（不穿链读取）
  const id = store.create({ ...context([]), label: 'ok' }).id
  const linkInArchive = path.join(dir, 'archives', id, 'session-data/images/abc/link')
  try { fs.symlinkSync(outside, linkInArchive, 'junction') } catch (e) { return }
  assert.throws(() => store.restore(id, context([]), () => {}, () => {}), /符号链接/)
  assert.equal(fs.existsSync(path.join(outside, 'secret.txt')), true, '链外数据不得被删除')
})

// ---- 4. 大小与条目硬闸 ----
check('大小与条目上限', (dir) => {
  const store = createArchiveStore(dir)
  const id = store.create({ ...context([{ id: 'story', messages: [] }]), label: 'ok' }).id
  const pristine = pristineManifest(dir, id)
  tamperManifest(dir, store, id, (doc) => { doc.files = [{ path: 'session-data/images/a.png', bytes: 600 * 1024 * 1024, sha256: 'a'.repeat(64) }] }, pristine)
  assert.throws(() => store.inspect(id), /上限|清单不正确/)
  tamperManifest(dir, store, id, (doc) => { doc.files = Array.from({ length: 30001 }, (_, n) => ({ path: 'session-data/images/' + n + '.png', bytes: 0, sha256: 'a'.repeat(64) })) }, pristine)
  assert.throws(() => store.inspect(id), /条目过多/)
  tamperManifest(dir, store, id, (doc) => { doc.sessions = Array.from({ length: 201 }, (_, n) => ({ id: 's' + n, messages: [] })) }, pristine)
  assert.throws(() => store.inspect(id), /世界线过多/)
  tamperManifest(dir, store, id, (doc) => { doc.workspaces = Array.from({ length: 201 }, (_, n) => ({ id: 'w' + n, name: 'w' })) }, pristine)
  assert.throws(() => store.inspect(id), /工作区过多/)
  tamperManifest(dir, store, id, (doc) => { doc.files = [{ path: 'session-data/images/a.png', bytes: 1, sha256: 'not-a-hash' }] }, pristine)
  assert.throws(() => store.inspect(id), /清单不正确/)
})

// ---- 4.5 manifest 精确 512 MiB 元数据边界（不分配大文件，不代表实际 I/O 压力） ----
check('512 MiB 清单元数据精确边界', (dir) => {
  const store = createArchiveStore(dir)
  const digest = require('node:crypto').createHash('sha256').update('x').digest('hex')
  const id = store.create({ ...context([{ id: 'story', messages: [] }]), label: 'ok' }).id
  const pristine = pristineManifest(dir, id)
  const limit = 512 * 1024 * 1024
  tamperManifest(dir, store, id, (doc) => { doc.files = [{ path: 'session-data/images/a.png', bytes: limit, sha256: digest }] }, pristine)
  assert.equal(store.inspect(id).files[0].bytes, limit, '恰好 512 MiB 的清单应通过元数据校验')
  tamperManifest(dir, store, id, (doc) => { doc.files = [{ path: 'session-data/images/a.png', bytes: limit + 1, sha256: digest }] }, pristine)
  assert.throws(() => store.inspect(id), /上限|清单不正确/, '超过 512 MiB 1 字节必须拒绝')
})

// ---- 5. manifest 角色校验：形状 / 编号 / 标签 / 时间 / 世界线 / 消息角色 ----
check('manifest 角色校验', (dir) => {
  const store = createArchiveStore(dir)
  const sessions = [{ id: 'story', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }] }]
  const id = store.create({ ...context(sessions), label: 'ok' }).id
  const pristine = pristineManifest(dir, id)
  const cases = [
    [(doc) => { doc.type = 'other' }, /格式不正确/],
    [(doc) => { doc.v = 2 }, /格式不正确/],
    [(doc) => { doc.id = 'ARC-someone-else' }, /编号与目录不一致/],
    [(doc) => { doc.id = 'not-an-archive' }, /编号不正确/],
    [(doc) => { doc.label = 'x'.repeat(121) }, /标签不正确/],
    [(doc) => { doc.kind = '' }, /类型不正确/],
    [(doc) => { doc.createdAt = 0 }, /时间不正确/],
    [(doc) => { doc.current = null }, /当前状态不正确/],
    [(doc) => { doc.workspaces = [{ id: '', name: 'x' }] }, /工作区数据不正确/],
    [(doc) => { doc.sessions = [{ id: '', messages: [] }] }, /世界线数据不正确/],
    [(doc) => { doc.sessions = [{ id: 'a', messages: [] }, { id: 'a', messages: [] }] }, /世界线数据不正确/],
    [(doc) => { doc.sessions = [{ id: 'a', messages: 'nope' }] }, /世界线数据不正确/],
    [(doc) => { doc.sessions = [{ id: 'a', messages: [{ role: 'hacker', content: 'x' }] }] }, /消息角色不正确/],
    [(doc) => { doc.sessions = [{ id: 'a', messages: [null] }] }, /消息数据不正确/],
    [(doc) => { doc.sessions = [{ id: 'a', messages: Array.from({ length: 50001 }, () => ({ role: 'user' })) }] }, /消息过多/]
  ]
  for (const [mutate, pattern] of cases) {
    tamperManifest(dir, store, id, mutate, pristine)
    assert.throws(() => store.inspect(id), pattern)
  }
  // 合法角色仍通过（反证夹具有效）
  tamperManifest(dir, store, id, (doc) => { doc.sessions = [{ id: 'a', messages: [{ role: 'system', content: 's' }, { role: 'tool', content: 't' }, { content: 'no role' }] }] }, pristine)
  assert.equal(store.inspect(id).sessions.length, 1)
})

// ---- 6. 恢复：自动存档保留 10 份，且目标存档绝不被清理误删 ----
check('恢复前自动存档保留 10 份且不删目标', (dir) => {
  const store = createArchiveStore(dir)
  const ctx = context([{ id: 'story', messages: [{ role: 'user', content: 'hi' }] }])
  write(path.join(dir, 'session-data/images/abc/one.png'), 'target-content')
  // 目标本身就是自动档，且是现有 10 份里最旧的一份：恢复时新建「恢复前自动存档」会让自动档变 11 份，
  // 若清理按时间淘汰就会先把目标删掉——这正是要防的回归。
  const keeper = store.create({ ...ctx, label: '待恢复目标', kind: 'before-restore' })
  for (let n = 0; n < 9; n++) store.create({ ...ctx, label: '自动 ' + n, kind: 'before-restore' })
  const before = store.list().filter((item) => item.kind !== 'manual')
  assert.equal(before.length, 10, '自动档应只保留 10 份')
  assert.equal(before[before.length - 1].id, keeper.id, '目标应为最旧的一份（夹具前提）')
  write(path.join(dir, 'session-data/images/abc/one.png'), 'live-changed')
  const restored = store.restore(keeper.id, ctx, () => {}, () => {})
  const after = store.list().filter((item) => item.kind !== 'manual')
  assert.equal(after.some((item) => item.id === keeper.id), true, '恢复目标存档不得被清理删掉')
  assert.equal(after.some((item) => item.id === restored.rollbackId), true, '回滚存档应保留')
  assert.equal(after.length, 10, '恢复后自动档仍为 10 份（实际 ' + after.length + '）')
  assert.equal(read(path.join(dir, 'session-data/images/abc/one.png')), 'target-content', '恢复应还原目标存档内的数据')
})

// ---- 7. 恢复完整真实资料（作品/内核/闪卡/快照）且绝不含密钥 ----
check('恢复真实资料（含作品）但不含密钥', (dir) => {
  const store = createArchiveStore(dir)
  const image = Buffer.from('panel image')
  const card = Buffer.from('card background')
  write(path.join(dir, 'session-data/images/6f2fc5c4074b8b005a2d29cb/a.png'), image)   // 消息插图 / 漫画分幕（作品图）
  write(path.join(dir, 'story-engine/stories/s1.json'), JSON.stringify({ story_id: 's1', counters: { turn: 1000 } }))
  write(path.join(dir, 'story-engine/stories/s1.meta.json'), JSON.stringify({ story_id: 's1' }))
  write(path.join(dir, 'story-engine/snapshots/s1/SNP-000001.json'), JSON.stringify({ snapshot_id: 'SNP-000001' }))
  write(path.join(dir, 'story-engine/pendings/s1.PC-000001.json'), JSON.stringify({ pending_id: 'PC-000001' }))
  write(path.join(dir, 'story-engine/logs/s1/turn-TRN-000001.json'), JSON.stringify({ turn_id: 'TRN-000001' }))
  write(path.join(dir, 'kernels/我的内核.md'), '# 内核')
  write(path.join(dir, 'holo-cards/card-mtu7a0yk-pbjudy/background.png'), card)
  write(path.join(dir, 'holo-cards/card-mtu7a0yk-pbjudy/card-config.json'), JSON.stringify({ name: '角色' }))
  // 密钥与非资料文件：存在，但绝不进归档
  write(path.join(dir, 'secrets.json'), JSON.stringify({ v: 1, payload: 'ENCRYPTED-SECRET' }))
  write(path.join(dir, 'embedder.json'), JSON.stringify({ embedder: 'api-v1', keySaved: true }))
  write(path.join(dir, 'sessions.db'), 'SQLITE')
  write(path.join(dir, 'session-data/sessions.json'), JSON.stringify({ v: 1, sessions: [] }))
  write(path.join(dir, 'story-engine/memory.db'), 'DERIVED-INDEX')
  write(path.join(dir, 'story-engine/tmp/x.tmp'), 'tmp')
  write(path.join(dir, 'pet-model/pet-model.gguf'), 'WEIGHTS')
  const sessions = [{ id: 's1', messages: Array.from({ length: 40 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', content: '第 ' + n + ' 回合' })), comic: { panels: [{ illustAsset: '6f2fc5c4074b8b005a2d29cb/a.png' }] } }]
  const ctx = context(sessions)
  const archive = store.create({ ...ctx, label: '完整资料' })
  const paths = store.inspect(archive.id).files.map((f) => f.path).sort()
  assert.deepEqual(paths, [
    'holo-cards/card-mtu7a0yk-pbjudy/background.png',
    'holo-cards/card-mtu7a0yk-pbjudy/card-config.json',
    'kernels/我的内核.md',
    'session-data/images/6f2fc5c4074b8b005a2d29cb/a.png',
    'story-engine/logs/s1/turn-TRN-000001.json',
    'story-engine/pendings/s1.PC-000001.json',
    'story-engine/snapshots/s1/SNP-000001.json',
    'story-engine/stories/s1.json',
    'story-engine/stories/s1.meta.json'
  ])
  const manifestText = read(path.join(dir, 'archives', archive.id, 'manifest.json'))
  assert.equal(manifestText.includes('ENCRYPTED-SECRET'), false, '归档清单不得包含密钥')
  // 现场被改动后恢复：全部资料回到归档状态，密钥/派生库/模型权重原样不动
  fs.rmSync(path.join(dir, 'holo-cards'), { recursive: true, force: true })
  fs.rmSync(path.join(dir, 'kernels'), { recursive: true, force: true })
  write(path.join(dir, 'session-data/images/6f2fc5c4074b8b005a2d29cb/a.png'), 'changed')
  write(path.join(dir, 'story-engine/stories/s1.json'), JSON.stringify({ story_id: 's1', counters: { turn: 1 } }))
  const restored = store.restore(archive.id, ctx, () => {}, () => {})
  assert.deepEqual(fs.readFileSync(path.join(dir, 'session-data/images/6f2fc5c4074b8b005a2d29cb/a.png')), image)
  assert.deepEqual(fs.readFileSync(path.join(dir, 'holo-cards/card-mtu7a0yk-pbjudy/background.png')), card)
  assert.equal(read(path.join(dir, 'kernels/我的内核.md')), '# 内核')
  assert.equal(JSON.parse(read(path.join(dir, 'story-engine/stories/s1.json'))).counters.turn, 1000)
  assert.ok(restored.doc.files.length === paths.length)
  assert.equal(read(path.join(dir, 'secrets.json')).includes('ENCRYPTED-SECRET'), true, '密钥不得被恢复流程触碰')
  assert.equal(read(path.join(dir, 'embedder.json')).includes('api-v1'), true)
  assert.equal(read(path.join(dir, 'story-engine/memory.db')), 'DERIVED-INDEX', '派生索引不归档也不删')
  assert.equal(read(path.join(dir, 'pet-model/pet-model.gguf')), 'WEIGHTS', '模型权重不归档也不删')
  assert.equal(fs.existsSync(path.join(dir, 'story-engine/tmp/x.tmp')), true, 'tmp 不归档也不删')
})

// ---- 8. 故障回滚：提交失败回到恢复前现场，回滚存档保留 ----
check('故障回滚保留现场与回滚存档', (dir) => {
  const store = createArchiveStore(dir)
  const ctx = context([{ id: 'story', messages: [{ role: 'user', content: 'hi' }] }])
  write(path.join(dir, 'session-data/images/abc/one.png'), 'archived')
  const archive = store.create({ ...ctx, label: '存档' })
  write(path.join(dir, 'session-data/images/abc/one.png'), 'live')
  write(path.join(dir, 'holo-cards/card-a/bg.png'), 'live-card')
  let committed = 0
  assert.throws(() => store.restore(archive.id, ctx, () => { committed++; throw new Error('commit failure') }, () => {}), /commit failure/)
  assert.equal(committed, 2, '失败后应尝试用回滚档恢复一次')
  assert.equal(read(path.join(dir, 'session-data/images/abc/one.png')), 'live', '失败后现场应回到恢复前')
  assert.equal(read(path.join(dir, 'holo-cards/card-a/bg.png')), 'live-card')
  const auto = store.list().find((item) => item.kind === 'before-restore')
  assert.ok(auto, '回滚存档应保留供人工恢复')
})

const failed = checks.filter((c) => !c.pass)
fs.rmSync(root, { recursive: true, force: true })
console.log('==== ' + checks.length + ' 项：' + (failed.length ? failed.length + ' 失败（' + failed.map((f) => f.name).join('; ') + '）' : '全部通过') + ' ====')
process.exit(failed.length ? 1 : 0)

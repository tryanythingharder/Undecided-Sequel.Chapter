'use strict'
/* sessions-db（P2-3 会话 SQLite 主存）测试
 * 覆盖：空库/导入/往返/覆盖/清理/重开持久化/损坏自愈/JSON 镜像不被触碰。
 * 运行时要求：node:sqlite；缺失则跳过。 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createSessionsDb } = require('../sessions-db.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-sessions-db-'))
const fails = []
const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

const DOC1 = { v: 1, sessions: [{ id: 's1', title: '第一幕', messages: [{ role: 'user', content: '你好' }] }] }
const DOC2 = { v: 1, sessions: [{ id: 's1', title: '第一幕', messages: [] }, { id: 's2', title: '第二幕', messages: [] }] }

const db = createSessionsDb(dir)
if (!db.enabled) {
  console.log('SKIP  当前运行时无 node:sqlite，sessions-db 测试跳过')
  process.exit(0)
}

// 1. 空库
check('empty-load-null', db.load() === null)

// 2. 导入 + 往返
db.importDoc(DOC1)
const r1 = db.load()
check('roundtrip-doc', !!r1 && r1.doc.v === 1 && r1.doc.sessions.length === 1 && r1.doc.sessions[0].id === 's1')
check('roundtrip-timestamp', typeof r1.updatedAt === 'number' && r1.updatedAt > 0)

// 3. 覆盖写
db.importDoc(DOC2)
const r2 = db.load()
check('overwrite-latest-wins', r2.doc.sessions.length === 2 && r2.doc.sessions[1].id === 's2')

// 4. 清理
db.clear()
check('clear-empties', db.load() === null)

// 5. 重开持久化（含 WAL 落盘）
db.importDoc(DOC2)
db.close()
const db2 = createSessionsDb(dir)
check('persist-across-reopen', db2.enabled && db2.load() !== null && db2.load().doc.sessions.length === 2)

// 6. JSON 镜像不被模块触碰（镜像由 main.cjs 原子写，兼容面不受影响）
const mirror = path.join(dir, 'sessions.json')
fs.writeFileSync(mirror, '{"legacy":true}', 'utf8')
db2.importDoc(DOC1)
check('mirror-untouched-by-module', fs.readFileSync(mirror, 'utf8') === '{"legacy":true}')
db2.close()

// 7. 损坏自愈：写垃圾 → 重建为空库（main.cjs 随后从 JSON 镜像迁移回来）
fs.writeFileSync(path.join(dir, 'sessions.db'), Buffer.from('garbage not a database'.repeat(50)), 'utf8')
const db3 = createSessionsDb(dir)
check('corruption-selfheal', db3.enabled === true && db3.load() === null)
db3.importDoc(DOC1)
check('corruption-selfheal-usable', db3.load() !== null && db3.load().doc.sessions[0].id === 's1')
db3.close()

// 8. 降级路径：目录被文件占位 → disabled
const blocker = path.join(dir, 'blocked')
fs.writeFileSync(blocker, 'x', 'utf8')
const dbBlocked = createSessionsDb(blocker)
check('disabled-when-unavailable', dbBlocked.enabled === false && typeof dbBlocked.load === 'function')

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)

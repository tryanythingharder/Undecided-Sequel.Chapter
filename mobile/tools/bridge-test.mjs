#!/usr/bin/env node
/* 引擎桥仿真测试 —— 在 Node 里以与安卓完全相同的契约驱动 engine-bridge.js：
 *   1. 宿主把 engine/*.js 源码注入 globalThis.__files（安卓由 Kotlin 读 assets 注入）
 *   2. __engineInit({dataDir, files}) 以磁盘现状做 seed
 *   3. 每次引擎调用后 __fsFlushJson() 取脏文件由宿主落盘（安卓为 Kotlin 原子写）
 *   4. 重新 __engineInit(磁盘现状) 模拟进程重启
 * 覆盖：CommonJS 加载器 / 虚拟 fs / 纯 JS SHA-1（对照 node:crypto）/ 引擎全流程。
 * 运行：node tools/bridge-test.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, renameSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const mobileRoot = resolve(here, '..')
const repoRoot = resolve(mobileRoot, '..')

/* ---- 1. 收集引擎源码 ---- */
const engineSrcDir = join(repoRoot, 'engine')
const engineFiles = {}
for (const f of readdirSync(engineSrcDir).sort()) {
  if (f.endsWith('.js')) engineFiles['engine/' + f] = readFileSync(join(engineSrcDir, f), 'utf8')
}
assert.ok(engineFiles['engine/index.js'], 'engine sources collected')

/* ---- 2. 临时状态目录（统一正斜杠，模拟安卓 Linux 路径） ---- */
const tmpBase = join(tmpdir(), 'sw-engine-test-' + Date.now()).replace(/\\/g, '/')
const dataDir = tmpBase + '/story-engine'
mkdirSync(dataDir, { recursive: true })

/* ---- 3. 宿主侧持久化（等价于 Kotlin EngineRuntime.applyFlush） ---- */
let flushCount = 0
function applyFlush(flushJson) {
  flushCount++
  const dirty = JSON.parse(flushJson)
  for (const [abs, content] of Object.entries(dirty)) {
    assert.ok(abs.startsWith(dataDir + '/') || abs === dataDir, 'flush path escapes dataDir: ' + abs)
    const rel = abs.slice(dataDir.length)
    const target = join(dataDir, rel)
    if (content === null) {
      rmSync(target, { force: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    const tmpFile = target + '.tmp' + Date.now()
    writeFileSync(tmpFile, content, 'utf8')
    renameSync(tmpFile, target)
  }
  return Object.keys(dirty).length
}

/* ---- 4. 载入 bootstrap（与安卓 assets/bridge/engine-bridge.js 同一文件） ---- */
const bootstrapSrc = readFileSync(join(mobileRoot, 'app/src/main/assets/bridge/engine-bridge.js'), 'utf8')
new Function(bootstrapSrc)()
assert.equal(globalThis.__engineApi, 'function' ? globalThis.__engineApi : null)
assert.ok(typeof globalThis.__engineApi === 'function', 'bridge exposes __engineApi')
assert.ok(typeof globalThis.__engineInit === 'function', 'bridge exposes __engineInit')
assert.ok(typeof globalThis.__fsFlushJson === 'function', 'bridge exposes __fsFlushJson')

/* ---- 5. 宿主调用辅助（模拟 Kotlin EngineRuntime.call：调用 + 落盘） ---- */
function call(name, payload) {
  const res = JSON.parse(globalThis.__engineApi(name, JSON.stringify(payload || {})))
  applyFlush(globalThis.__fsFlushJson())
  assert.equal(res.ok, true, name + ' failed: ' + (res.error || 'unknown'))
  return res.data
}

/* 启动序列（与 Kotlin 一致）：注入 __files → bootstrap（已加载）→ __engineInit */
function bootEngine(seedFiles) {
  globalThis.__files = JSON.parse(JSON.stringify(engineFiles))
  new Function(bootstrapSrc)() // 幂等：已加载则跳过（真机重启等价于整个 VM 重建）
  const r = JSON.parse(globalThis.__engineInit(JSON.stringify({ dataDir, files: seedFiles || {} })))
  assert.equal(r.ok, true, '__engineInit failed: ' + (r.error || ''))
  applyFlush(globalThis.__fsFlushJson())
}

function readDiskSeed() {
  const seed = {}
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else seed[dir.replace(/\\/g, '/') + '/' + name] = readFileSync(full, 'utf8')
    }
  }
  if (existsSync(dataDir)) walk(dataDir)
  return seed
}

const KERNEL = '# 测试内核 v1 🐱\n\n你是六面世界的叙事内核。所有实体名使用中文。'

/* ================= 测试场景 ================= */

/* ---- 启动 ---- */
bootEngine({})

/* ---- ensure + 内核版本绑定（纯 JS SHA-1 对照 node:crypto，含中文与 emoji） ---- */
const expectVer = 'sha1:' + createHash('sha1').update(KERNEL).digest('hex').slice(0, 12)
const en1 = call('ensure', { storyId: 'S-TEST-1', title: '测试世界线', kernelId: 'builtin:kernel.md', kernelText: KERNEL })
assert.equal(en1.created, true, 'story created')
assert.equal(en1.kernel_version, expectVer, 'kernel version sha1 matches node:crypto (' + en1.kernel_version + ' vs ' + expectVer + ')')
assert.equal(en1.turn, 0, 'new story turn=0')
const en2 = call('ensure', { storyId: 'S-TEST-1', title: '测试世界线', kernelId: 'builtin:kernel.md', kernelText: KERNEL })
assert.equal(en2.created, false, 'second ensure idempotent')
assert.equal(en2.kernel_match, true, 'kernel match')

/* ---- 首次落盘：故事文件存在、无孤儿 tmp（虚拟 fs 空目录不物化，缺失即等价于空） ---- */
assert.ok(existsSync(join(dataDir, 'stories', 'S-TEST-1.json')), 'story file persisted')
function countDiskFiles(dir) { try { return readdirSync(dir).length } catch { return 0 } }
assert.equal(countDiskFiles(join(dataDir, 'tmp')), 0, 'no orphan tmp files')

/* ---- 输出协议说明书 ---- */
const proto = call('protocol', {})
assert.ok(typeof proto === 'string' && proto.includes('<<<STATE_PATCH>>>') && proto.length > 400, 'protocol prompt ok')

/* ---- 回合 1：带状态块的叙事 → 正式提交 ---- */
const RAW1 = [
  '夜色像浸了水的墨，李长歌推开山门时，檐角的铜铃响了一声。',
  '守阁的老者抬眼看了看她，又垂下眼皮。',
  '',
  '<<<STATE_PATCH>>>',
  '{',
  '  "turn_summary": "李长歌夜入宗门，被守阁老者默许进入",',
  '  "scene": {"game_time": "入夜·戌时", "location": "青云宗·山门", "participants": ["李长歌", "守阁老者"], "ended": false},',
  '  "player_state": {"location": "青云宗·山门", "status_add": ["夜行"], "resources_add": {"灵石": -10}},',
  '  "entity_changes": [',
  '    {"op": "upsert", "name": "李长歌", "type": "character", "state": {"境界": "炼气一层"}, "tags": ["主角"], "summary": "初入青云宗的少女"},',
  '    {"op": "upsert", "name": "青云宗", "type": "faction", "state": {}, "tags": [], "summary": "东洲第一大宗"}',
  '  ],',
  '  "decisions": [{"raw_input": "我推开了山门", "normalized_intent": "进入青云宗", "importance": 40, "reversible": true, "source": "user_input"}],',
  '  "facts": [{"key": "gate_open_night", "statement": "李长歌于戌时推开青云宗山门", "secret_from_player": false, "importance": 30, "entity_names": ["李长歌", "青云宗"]}],',
  '  "events": [{"type": "arrival", "description": "李长歌抵达青云宗山门并获准进入", "importance": 35, "participant_names": ["李长歌", "守阁老者"]}],',
  '  "knowledge": [{"content": "守阁老者似乎认得自己", "how_learned": "observed"}]',
  '}',
  '<<<END_PATCH>>>'
].join('\n')
const storySess = 'SES-test-0001'
const c1 = call('commit', {
  storyId: 'S-TEST-1', sessionId: storySess, playerInput: '我推开了山门', intent: '我推开了山门',
  model: 'test-model', raw: RAW1, retrievedIds: [], contextSize: 0, retryCount: 0
})
assert.equal(c1.ok, true, 'commit1 ok: ' + JSON.stringify(c1.errors))
assert.equal(c1.committed, true, 'commit1 committed')
assert.equal(c1.turn_id, 'TRN-000001', 'commit1 turn id')
assert.ok(c1.narrative.includes('夜色'), 'narrative kept')
assert.ok(!c1.narrative.includes('STATE_PATCH'), 'protocol block stripped from narrative')
assert.ok(!c1.narrative.includes('END_PATCH'), 'protocol end marker stripped')

/* ---- 提交后：上下文块 + 概览 ---- */
const cx = call('context', { storyId: 'S-TEST-1', playerInput: '我继续往里走' })
assert.ok(cx.overview && cx.overview.engine_turn === 1, 'engine_turn=1 after commit')
assert.ok(cx.block.length > 0, 'context block non-empty')
assert.ok(Array.isArray(cx.retrieved_ids), 'retrieved_ids array')

/* ---- 回合 2：显式无状态变化 ---- */
const c2 = call('commit', {
  storyId: 'S-TEST-1', sessionId: storySess, playerInput: '（静默行进）', intent: '静默行进',
  model: 'test-model', raw: '她沿着石阶无声上行。\n\n<<<NO_STATE_CHANGE>>>', retrievedIds: [], contextSize: 0, retryCount: 0
})
assert.equal(c2.patch_status, 'NO_STATE_CHANGE', 'no-state-change recognized')
assert.equal(c2.committed, false, 'nsc not committed')

/* ---- 回合 3：模型漏掉状态块 → PATCH_MISSING → Pending Commit ---- */
const c3 = call('commit', {
  storyId: 'S-TEST-1', sessionId: storySess, playerInput: '我再次尝试推门', intent: '再次推门',
  model: 'test-model', raw: '门纹丝不动。', retrievedIds: [], contextSize: 0, retryCount: 0
})
assert.equal(c3.patch_status, 'PATCH_MISSING', 'patch missing detected')
assert.equal(c3.pending_recorded, true, 'pending recorded')
assert.ok(c3.pending_id, 'pending id present: ' + c3.pending_id)
const pend1 = call('pendings', { storyId: 'S-TEST-1' })
assert.equal(pend1.length, 1, 'one pending listed')

/* ---- 补录：resolvePending 用合法状态块补交 ---- */
const rs = call('resolvePending', {
  storyId: 'S-TEST-1', pendingId: c3.pending_id,
  raw: '门纹丝不动。\n\n<<<STATE_PATCH>>>\n{"turn_summary":"推门失败","scene":{"game_time":"戌时","location":"青云宗·山门","participants":["李长歌"],"ended":false},"decisions":[{"raw_input":"再次推门","normalized_intent":"强行推门","importance":20,"reversible":true,"source":"user_input"}]}\n<<<END_PATCH>>>'
})
assert.equal(rs.resolved, true, 'pending resolved: ' + JSON.stringify(rs.result && rs.result.errors))
assert.equal(call('pendings', { storyId: 'S-TEST-1' }).length, 0, 'pendings cleared')

/* ---- 快照 / 恢复 ---- */
const snap = call('snapshot', { storyId: 'S-TEST-1', label: '山门夜' })
assert.ok(snap.snapshot_id, 'snapshot id: ' + snap.snapshot_id)
const snaps = call('snapshots', { storyId: 'S-TEST-1' })
assert.equal(snaps.length, 1, 'one snapshot listed')
const turnBefore = call('overview', { storyId: 'S-TEST-1' }).engine_turn
call('restore', { storyId: 'S-TEST-1', snapshotId: snap.snapshot_id })
const turnAfter = call('overview', { storyId: 'S-TEST-1' }).engine_turn
assert.equal(turnBefore, turnAfter, 'restore keeps turn counter consistent')

/* ---- 回合诊断日志 ---- */
const logs = call('logs', { storyId: 'S-TEST-1' })
assert.ok(logs.length >= 3, 'turn logs kept: ' + logs.length)

/* ---- 被抛弃叙事留痕 ---- */
const disc = call('discardTurn', { storyId: 'S-TEST-1', reason: 'regen', excerpt: '被重生成丢弃的一版叙事……' })
assert.equal(disc.recorded, true, 'discardTurn recorded')

/* ---- 进程重启：磁盘 seed → 状态完整恢复 ---- */
const seed = readDiskSeed()
assert.ok(Object.keys(seed).length >= 3, 'disk seed non-empty')
bootEngine(seed)
const ovAfterRestart = call('overview', { storyId: 'S-TEST-1' })
assert.equal(ovAfterRestart.engine_turn, turnAfter, 'engine_turn survives restart')
const enAfter = call('ensure', { storyId: 'S-TEST-1', title: '测试世界线', kernelId: 'builtin:kernel.md', kernelText: KERNEL })
assert.equal(enAfter.created, false, 'story exists after restart')
assert.equal(enAfter.kernel_match, true, 'kernel version binding survives restart')
assert.ok(call('logs', { storyId: 'S-TEST-1' }).length >= 3, 'turn logs survive restart')

/* ---- flush 全程无越界、无孤儿 tmp ---- */
assert.equal(countDiskFiles(join(dataDir, 'tmp')), 0, 'no orphan tmp after full run')
assert.ok(flushCount > 10, 'flush called throughout: ' + flushCount)

console.log('✅ 引擎桥仿真测试全部通过（flush ' + flushCount + ' 次，seed 文件 ' + Object.keys(seed).length + ' 个）')
console.log('   kernel_version = ' + expectVer)
console.log('   engine_turn = ' + turnAfter + '，快照 ' + snap.snapshot_id)

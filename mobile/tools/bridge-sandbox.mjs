#!/usr/bin/env node
/* 引擎桥「裸 V8」沙箱回归 —— 桥仿真测试（bridge-test.mjs）在 Node 主域跑，process/structuredClone/console
 * 都是 Node 免费提供的，恰好绕过了移动端 Javet 裸 V8 的真实缺口（2026-09 审计病例：
 *   vector-store.js 顶层 process.env 引用 → 加载即抛；store.js structuredClone → commit 必抛；
 *   vector 降级分支 console.warn → 二次抛把优雅降级变整库崩溃）。
 * 本脚本把同一条 ensure→commit→pending→补录→重启链路放进 vm 沙箱——全局只有 V8 内建 +
 * 宿主注入的 __files/桥 API，没有 process/structuredClone/console/require ——任何对宿主 API 的
 * 隐式依赖都会在这里现形。运行：node tools/bridge-sandbox.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, renameSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const bootstrapPath = join(repoRoot, 'mobile/app/src/main/assets/bridge/engine-bridge.js')

/* ---- 1. 收集引擎源码（与安卓构建 prepareEngineAssets 同源） ---- */
const engineFiles = {}
for (const f of readdirSync(join(repoRoot, 'engine')).sort()) {
  if (f.endsWith('.js')) engineFiles['engine/' + f] = readFileSync(join(repoRoot, 'engine', f), 'utf8')
}
assert.ok(engineFiles['engine/index.js'], 'engine sources collected')

/* ---- 2. 沙箱上下文：只有 V8 内建 + 显式注入项。
 * Node vm 默认会塞 console——真机 Javet 裸 V8 没有，删掉它才等价（正是 2026-09 审计中
 * 「降级分支 console.warn 二次抛错」病例的复现条件）。process/structuredClone/require 则
 * 本就不随 contextization 进入。 */
const ctx = vm.createContext({})
vm.runInContext('delete globalThis.console', ctx)
const ctxConsole = vm.runInContext('typeof console', ctx)
assert.equal(ctxConsole, 'undefined', 'console removed from sandbox')
const bootstrapSrc = readFileSync(bootstrapPath, 'utf8')
function bootSandbox(seedFiles) {
  ctx.__files = { ...engineFiles }
  vm.runInContext(bootstrapSrc, ctx)
  // 桥契约：宿主（Kotlin）传 JSON 字符串；沙箱侧同构
  const r = JSON.parse(vm.runInContext('globalThis.__engineInit(' + JSON.stringify(JSON.stringify({ dataDir, files: seedFiles || {} })) + ')', ctx))
  assert.equal(r.ok, true, '__engineInit failed: ' + (r.error || ''))
  return r.data
}

/* ---- 3. 宿主侧落盘（等价 Kotlin EngineRuntime.applyFlush 的原子写） ---- */
const tmpBase = join(tmpdir(), 'sw-bridge-sandbox-' + Date.now()).replace(/\\/g, '/')
const dataDir = tmpBase + '/story-engine'
function callSandbox(name, payload) {
  const args = JSON.stringify(name) + ', ' + JSON.stringify(JSON.stringify(payload || {}))
  const res = JSON.parse(vm.runInContext('globalThis.__engineApi(' + args + ')', ctx))
  assert.equal(res.ok, true, name + ' failed: ' + (res.error || 'unknown'))
  return res.data
}
function applyFlush(flushJson) {
  const dirty = JSON.parse(flushJson)
  for (const [abs, content] of Object.entries(dirty)) {
    assert.ok(abs.startsWith(dataDir + '/') || abs === dataDir, 'flush path escapes dataDir: ' + abs)
    if (content === null) { try { rmSync(abs, { force: true }) } catch {} continue }
    const dir = dirname(abs)
    mkdirSync(dir, { recursive: true })
    const tmpFile = abs + '.tmp' + Date.now()
    writeFileSync(tmpFile, content, 'utf8')
    renameSync(tmpFile, abs)
  }
}
function call(name, payload) {
  const d = callSandbox(name, payload)
  applyFlush(vm.runInContext('globalThis.__fsFlushJson()', ctx))
  return d
}
function diskSeed() {
  const seed = {}
  if (!existsSync(dataDir)) return seed
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else seed[full.replace(/\\/g, '/')] = readFileSync(full, 'utf8')
    }
  }
  walk(dataDir)
  return seed
}

/* ---- 4. 场景：全链路跑在无 Node 全局的裸 V8 上 ---- */
bootSandbox({})
const KERNEL = '# 沙箱内核 v1\n\n你是六面世界的叙事内核。'
const en = call('ensure', { storyId: 'S-SANDBOX-1', title: '沙箱世界线', kernelId: 'builtin:kernel.md', kernelText: KERNEL })
assert.equal(en.created, true, 'story created in bare V8')

/* 带状态块的提交：走 beginTransaction → 无 structuredClone 环境必须走 JSON 回退而非抛错 */
const RAW = [
  '檐下灯笼晃了一下。',
  '<<<STATE_PATCH>>>',
  '{',
  '  "turn_summary": "进入废墟",',
  '  "decisions": [{"raw_input": "探索废墟", "normalized_intent": "探索", "importance": 40, "reversible": true, "source": "user_input"}],',
  '  "facts": [{"key": "ruin_entered", "statement": "玩家进入了废墟", "importance": 30}]',
  '}',
  '<<<END_PATCH>>>'
].join('\n')
const c1 = call('commit', { storyId: 'S-SANDBOX-1', sessionId: 'SES-san', playerInput: '探索废墟', intent: '探索', model: 't', raw: RAW, retrievedIds: [], contextSize: 0, retryCount: 0 })
assert.equal(c1.committed, true, 'commit with patch succeeds without structuredClone (JSON fallback)')
assert.equal(c1.turn_id, 'TRN-000001', 'turn id assigned')

/* 漏状态块 → PATCH_MISSING → Pending；补录成功闭环 */
const c2 = call('commit', { storyId: 'S-SANDBOX-1', sessionId: 'SES-san', playerInput: '继续', intent: '继续', model: 't', raw: '风声掠过。', retrievedIds: [], contextSize: 0, retryCount: 0 })
assert.equal(c2.patch_status, 'PATCH_MISSING', 'pending detected')
assert.ok(c2.pending_id, 'pending id recorded')
const RAW2 = '<<<STATE_PATCH>>>\n{"turn_summary":"补录","facts":[{"key":"wind","statement":"废墟里有风声","importance":10}]}\n<<<END_PATCH>>>'
const c3 = call('resolvePending', { storyId: 'S-SANDBOX-1', pendingId: c2.pending_id, raw: RAW2 })
assert.equal(c3.resolved, true, 'pending resolved in bare V8')

/* 快照 + 上下文 */
const snap = call('snapshot', { storyId: 'S-SANDBOX-1', label: '沙箱点' })
assert.ok(snap.snapshot_id, 'snapshot created')
const cx = call('context', { storyId: 'S-SANDBOX-1', playerInput: '废墟里有什么' })
assert.ok(cx.overview && cx.overview.engine_turn === 2, 'overview turn=2 after commit+resolve')

/* 重启：磁盘现状重新 seed（等价进程死亡后 VM 重建） */
bootSandbox(diskSeed())
const after = call('overview', { storyId: 'S-SANDBOX-1' })
assert.equal(after.engine_turn, 2, 'state survives bare-V8 restart')

/* 沙箱自证：上下文里绝不该有 Node 全局（防止测试自身失效——有全局泄漏时上面的通过是假绿） */
const leakCheck = vm.runInContext('[typeof process, typeof structuredClone, typeof console, typeof require].join(",")', ctx)
assert.equal(leakCheck, 'undefined,undefined,undefined,undefined', 'sandbox must not expose Node globals: ' + leakCheck)

console.log('✅ 裸 V8 沙箱回归通过（无 process/structuredClone/console/require 全链路：commit/补录/快照/重启）')
console.log('   engine_turn = ' + after.engine_turn + '，快照 ' + snap.snapshot_id + '，vector 索引按预期降级为纯词面通道')
rmSync(tmpBase, { recursive: true, force: true })

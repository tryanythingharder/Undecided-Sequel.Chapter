'use strict'
/* 故事引擎性能基准（Performance Baseline · 规范二/三/三十九）
 *
 * 【真实长跑】：每回合走完整引擎管线（Retriever → Context → Patch → Validator → Commit → Persist），
 *   剧本为确定性生成的真实状态演进（事件/事实/决定/承诺/伏笔/因果/关系/实体混合推进），
 *   非空操作刷数据；不含 LLM 调用（LLM 层时延由 E2E 另测）。
 * 【Synthetic Benchmark】：单独标注的持久化微基准——直接构造指定规模的账本数据
 *   测量 flushStory 全量重写成本，不冒充真实长跑。
 *
 * 用法：node scripts-dev/bench.cjs 100 500 1000 3000 5000 [--json <out>]
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')
const { buildContextBlock } = require('../engine/context-builder')

/* ---------- 确定性伪随机 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOD = ['晨', '午', '黄昏', '夜']
const NPCS = ['林晚', '赵石', '阿萝', '周聋子', '白先生', '钱掌柜', '孙捕头', '小满']
const PLACES = ['临水镇街市', '河湾码头', '北山矿洞', '旧货巷', '城隍庙', '驿道']
const GOODS = ['铁矿样', '蜂蜡', '皮料', '药草', '盐引', '铜锭', '松脂', '布匹']
const ORGS = ['金帆商会', '铁线帮', '漕运公所']

/* ---------- 基准剧本生成：真实状态演进（每回合都有正式记录） ---------- */
function buildSteps(n, seed) {
  const rnd = mulberry32(seed || 42)
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length]
  const num = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const steps = []
  for (let i = 1; i <= n; i++) {
    const npc = NPCS[i % NPCS.length]
    const npc2 = NPCS[(i * 3 + 1) % NPCS.length]
    const place = PLACES[i % PLACES.length]
    const good = GOODS[(i * 5 + 2) % GOODS.length]
    const org = ORGS[i % ORGS.length]
    const slot = i % 10
    const patch = {
      turn_summary: '第' + i + '回合：' + npc + '在' + place + '与凯岩同行',
      scene: { game_time: '玄历1024年·第' + (i * 2) + '日', location: i % 4 === 0 ? place : '' },
      events: [{
        type: slot === 3 ? 'dialogue' : (slot === 7 ? 'conflict' : 'action'),
        description: npc + '在' + place + '谈起' + org + '的' + good + '生意，凯岩应对沉稳。',
        importance: 15 + (i % 30),
        participant_names: [npc, i % 4 === 0 ? npc2 : npc]
      }]
    }
    if (slot === 1 || slot === 6) patch.facts = [{ key: 'b-fact-' + i, statement: npc + '的' + good + '在' + place + '验了成色，登记入册（第' + i + '条）', importance: 40 + (i % 40) }]
    if (slot === 2 || slot === 8) patch.decisions = [{ raw_input: '我决定和' + npc + '合作' + good + '的生意。', normalized_intent: '与' + npc + '达成' + good + '合作', source: 'user_input', importance: 65 + (i % 20) }]
    if (slot === 4) patch.causal = [{ cause: '凯岩帮' + npc + '在' + place + '摆平了' + org + '的刁难', effect: npc + '成为凯岩在' + place + '的眼线', importance: 40 }]
    if (slot === 5) patch.relationships = [{ source_name: '凯岩', target_name: npc, relation_type: '生意伙伴', strength_delta: 1, description: '凯岩与' + npc + '在' + place + '的长期合作' }]
    if (slot === 9) patch.entity_changes = [{ name: npc, type: 'character', state: { standing: '第' + i + '回合提升' }, summary: npc + '（基准剧本人物）' }]
    if (slot === 3) patch.commitments = [{ kind: 'quest', content: '帮' + npc + '把' + good + '送到' + place, importance: 60 }]
    if (slot === 7 && i > 20) patch.commitment_updates = [{ ref: '把' + GOODS[(i - 4) % GOODS.length] + '送到', status: 'FULFILLED', note: '第' + i + '回合交付完成' }]
    steps.push({ input: '我去' + place + '找' + npc + '谈' + good + '的生意。', patch })
  }
  return steps
}

/* ---------- 计时器 ---------- */
function stats(samples) {
  if (!samples.length) return { avg: 0, p50: 0, p95: 0, max: 0 }
  const s = samples.slice().sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { avg: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] }
}
const ms3 = (v) => Number(v).toFixed(2)

/* ---------- 单档基准：n 回合真实长跑 ---------- */
function runBench(n, seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-bench-'))
  const engine = createEngine(dir)
  const STORY = 'benchA'
  engine.ensureStory({ storyId: STORY, title: '基准故事', kernelId: 'bench', kernelText: '【基准内核】临水镇的世界。' })

  /* 包一层持久化计时（不改产品代码，仅测量） */
  let persistMs = 0, persistBytes = 0
  const store = engine.store
  const origWrite = store._atomicWrite.bind(store)
  store._atomicWrite = function (p, data) {
    const t0 = process.hrtime.bigint()
    const r = origWrite(p, data)
    persistMs += Number(process.hrtime.bigint() - t0) / 1e6
    persistBytes += Buffer.byteLength(String(data))
    return r
  }
  /* 同时测量事务深拷贝成本（beginTransaction 的 JSON 克隆） */
  let cloneMs = 0
  const origBegin = store.beginTransaction.bind(store)
  store.beginTransaction = function (id) {
    const t0 = process.hrtime.bigint()
    const r = origBegin(id)
    cloneMs += Number(process.hrtime.bigint() - t0) / 1e6
    return r
  }

  const steps = buildSteps(n, seed)
  engine.openSession({ storyId: STORY, sessionId: 'B1', label: '基准' })
  const tRetrieve = [], tContext = [], tCommit = [], tTurn = [], ctxSizes = [], blockChars = []
  let committed = 0

  const t0 = Date.now()
  for (const step of steps) {
    const tt0 = process.hrtime.bigint()
    const r0 = engine.retrieve(STORY, { playerInput: step.input })
    tRetrieve.push(Number(process.hrtime.bigint() - tt0) / 1e6)
    const story = engine.getStory(STORY)
    const tc0 = process.hrtime.bigint()
    const block = buildContextBlock(story, r0, 'PLAYER')
    tContext.push(Number(process.hrtime.bigint() - tc0) / 1e6)
    blockChars.push(block.length)
    const p0 = persistMs, c0 = cloneMs
    const tk0 = process.hrtime.bigint()
    const r = engine.commitPatch(step.patch, { storyId: STORY, sessionId: 'B1', playerInput: step.input })
    tCommit.push(Number(process.hrtime.bigint() - tk0) / 1e6)
    tTurn.push(Number(process.hrtime.bigint() - tt0) / 1e6)
    if (r.ok && r.committed) committed++
    ctxSizes.push({ persist: persistMs - p0, clone: cloneMs - c0 })
    ctxSizes[ctxSizes.length - 1].persist_bytes = persistBytes
  }
  const wallMs = Date.now() - t0

  /* 打开故事（模拟重启后首开：全新引擎 + 全量加载） */
  const engine2 = createEngine(dir)
  const tOpen0 = process.hrtime.bigint()
  const story2 = engine2.getStory(STORY)
  const openMs = Number(process.hrtime.bigint() - tOpen0) / 1e6
  const jsonBytes = fs.statSync(path.join(dir, 'stories', 'benchA.json')).size

  const out = {
    turns: n, committed, wall_s: Number((wallMs / 1000).toFixed(1)),
    turn_total: stats(tTurn), retrieve: stats(tRetrieve), context: stats(tContext),
    commit: stats(tCommit),
    persist_avg_ms: Number((persistMs / Math.max(1, committed)).toFixed(2)),
    clone_avg_ms: Number((cloneMs / Math.max(1, committed)).toFixed(2)),
    persist_bytes_avg: Math.round(persistBytes / Math.max(1, committed)),
    open_story_ms: Number(openMs.toFixed(1)),
    story_json_mb: Number((jsonBytes / 1048576).toFixed(2)),
    heap_mb: Number((process.memoryUsage().heapUsed / 1048576).toFixed(1)),
    ctx_block_chars: stats(blockChars),
    ledgers: { decisions: story2.decisions.length, facts: story2.facts.length, events: story2.events.length, commitments: story2.commitments.length, entities: story2.entities.length, relationships: story2.relationships.length, causal: story2.causal.length, threads: story2.threads.length }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  return out
}

/* ---------- Synthetic：持久化微基准（直接构造账本规模测 flushStory） ---------- */
function benchPersistScale(sizes) {
  const out = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-bench-persist-'))
  const engine = createEngine(dir)
  const STORY = 'persistBench'
  engine.ensureStory({ storyId: STORY, title: '持久化微基准', kernelId: 'bench', kernelText: 'x' })
  for (const nEvents of sizes) {
    const story = engine.getStory(STORY)
    story.events = []
    for (let i = 0; i < nEvents; i++) {
      story.events.push({ event_id: 'EVT-' + String(i).padStart(6, '0'), story_id: STORY, type: 'action', description: '基准事件第' + i + '条：' + NPCS[i % NPCS.length] + '在' + PLACES[i % PLACES.length] + '活动，账目流水与人物关系若干。', participants: [], location: PLACES[i % PLACES.length], game_time: '第' + i + '日', importance: 20, turn: i, created_at: Date.now(), updated_at: Date.now() })
    }
    story.counters.turn = nEvents
    const t0 = process.hrtime.bigint()
    engine.store.flushStory(STORY)
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    const bytes = fs.statSync(path.join(dir, 'stories', 'persistBench.json')).size
    out.push({ events: nEvents, flush_ms: Number(ms.toFixed(1)), file_mb: Number((bytes / 1048576).toFixed(2)) })
  }
  fs.rmSync(dir, { recursive: true, force: true })
  return out
}

/* ---------- 主流程 ---------- */
function main() {
  const sizes = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number).filter(Boolean)
  const Ns = sizes.length ? sizes : [100, 500, 1000, 3000, 5000]
  const results = []
  console.log('===== 故事引擎性能基准（真实长跑 · 确定性演进剧本，无 LLM） =====')
  for (const n of Ns) {
    process.stdout.write('跑 ' + n + ' 回合 … ')
    const r = runBench(n, 42 + n)
    results.push(r)
    console.log('done ' + r.wall_s + 's')
    console.log('  回合耗时 ms   avg ' + ms3(r.turn_total.avg) + ' · p50 ' + ms3(r.turn_total.p50) + ' · p95 ' + ms3(r.turn_total.p95) + ' · max ' + ms3(r.turn_total.max))
    console.log('  检索 retrieve avg ' + ms3(r.retrieve.avg) + ' · p95 ' + ms3(r.retrieve.p95) + ' | Context 组装 avg ' + ms3(r.context.avg) + ' · p95 ' + ms3(r.context.p95) + ' | Commit avg ' + ms3(r.commit.avg) + ' · p95 ' + ms3(r.commit.p95))
    console.log('  持久化 flush ' + r.persist_avg_ms + 'ms/回合 · 事务克隆 ' + r.clone_avg_ms + 'ms/回合 · 写盘 ' + (r.persist_bytes_avg / 1024).toFixed(0) + 'KB/回合')
    console.log('  打开故事 ' + r.open_story_ms + 'ms · Story JSON ' + r.story_json_mb + 'MB · heap ' + r.heap_mb + 'MB · Context块 ' + Math.round(r.ctx_block_chars.avg) + ' 字符(p95 ' + Math.round(r.ctx_block_chars.p95) + ')')
    console.log('  账本: 决定 ' + r.ledgers.decisions + ' · 事实 ' + r.ledgers.facts + ' · 事件 ' + r.ledgers.events + ' · 承诺 ' + r.ledgers.commitments + ' · 实体 ' + r.ledgers.entities + ' · 关系 ' + r.ledgers.relationships + ' · 因果 ' + r.ledgers.causal)
  }
  console.log('\n===== Synthetic 持久化微基准（直接构造事件规模 → flushStory 全量重写） =====')
  const ps = benchPersistScale([1000, 5000, 10000, 20000])
  for (const p of ps) console.log('  事件 ' + p.events + ' 条: flush ' + p.flush_ms + 'ms · 文件 ' + p.file_mb + 'MB')
  const jsonOut = process.argv.indexOf('--json')
  if (jsonOut > 0 && process.argv[jsonOut + 1]) {
    fs.writeFileSync(process.argv[jsonOut + 1], JSON.stringify({ runs: results, persist_scale: ps }, null, 2))
    console.log('已写出 ' + process.argv[jsonOut + 1])
  }
}

main()

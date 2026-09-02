'use strict'
/* 语义检索 A/B 基准（P2-1 评测闭环）
 *
 * 同一语料、同一组查询，分别以「纯词面+实体基线」与「词面+语义(sqlite-vec)」两种模式检索：
 *   baseline = 直调 retriever 且 _vec 注入禁用（独立缓存槽，避免命中向量版的查询缓存）
 *   semantic = engine.retrieve 正常管线（向量 KNN + BM25 与词面融合）
 * 指标：目标记录进入检索结果的命中率（HitRate）与 Top-3 命中；按 直接/改述 两类分组报告。
 *   改述类 = 与目标文本共享部分字词但不含完整关键词的问法（语义通道的主战场）。
 * 门槛（门槛不满足即退出码 1）：语义组总体 ≥ 基线组，且 直接类 不得回退。
 * 运行：node scripts-dev/bench-vector.cjs [回合数=260] [EMBEDDER=hash-v1|hash-v2]
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')
const { retrieve } = require('../engine/retriever')

/* ---------- 锚点语料（与 bench-recall 同源，保证真实性） ---------- */
const ANCHORS = [
  { tag: 'refuse-org', at: 30, patch: { decisions: [{ raw_input: '我当众回绝了黑鸦商会的入会邀请，分文未取。', normalized_intent: '明确拒绝加入黑鸦商会', source: 'user_input', importance: 85 }], facts: [{ key: 'refuse-crow', statement: '凯岩当众拒绝黑鸦商会的入会拉拢', importance: 85 }] } },
  { tag: 'save-npc', at: 32, patch: { decisions: [{ raw_input: '货架塌了，我把沈青禾拖了出来。', normalized_intent: '塌架时救下沈青禾', source: 'user_input', importance: 82 }], facts: [{ key: 'save-shen', statement: '河湾码头货架塌落，凯岩救下了绣娘沈青禾', importance: 85 }], causal: [{ cause: '河湾码头货架塌落', effect: '沈青禾被凯岩从货架下拖出', importance: 70 }], entity_changes: [{ name: '沈青禾', type: 'character', summary: '绣娘，塌架中被凯岩所救' }] } },
  { tag: 'get-item', at: 34, patch: { facts: [{ key: 'get-tally', statement: '凯岩在旧货摊淘到一枚玄铁哨，哨身刻着漕帮暗记', importance: 85 }] } },
  { tag: 'lose-item', at: 38, patch: { facts: [{ key: 'lose-tally', statement: '玄铁哨在渡船倾覆时沉入河湾，彻底丢失', importance: 85 }] } },
  { tag: 'expose-official', at: 42, patch: { facts: [{ key: 'expose-magistrate', statement: '凯岩把县令私吞河工银的两本假账公之于众', importance: 86 }], decisions: [{ raw_input: '我把县令的假账摊在了衙门口。', normalized_intent: '公开县令贪腐罪证', source: 'user_input', importance: 84 }] } },
  { tag: 'help-npc', at: 46, patch: { decisions: [{ raw_input: '我替柳三儿垫付了药钱，还教他认了半年账目。', normalized_intent: '资助并教导柳三儿', source: 'user_input', importance: 80 }], causal: [{ cause: '凯岩垫药钱并教柳三儿识字记账', effect: '柳三儿成为粮行的记账先生，脱离苦力行当', importance: 65 }] } },
  { tag: 'plague-end', at: 50, patch: { facts: [{ key: 'plague-end-s', statement: '南塘村时疫彻底平息，官府颁了奖谕', importance: 80 }] } }
]

/* ---------- 查询组：exact=词面强（防回归）；para=改述（语义主战场）；hard=零关键词难例（记录未解极限） ---------- */
const QUERIES = [
  { cls: 'exact', q: '我之前拒绝过什么组织？', targets: [{ kind: 'decisions', pred: (x) => String(x.raw_input || '').includes('黑鸦') }] },
  { cls: 'exact', q: '为什么县令最后会被革职查办？', targets: [{ kind: 'facts', pred: (x) => x.key === 'expose-magistrate' }] },
  { cls: 'exact', q: '南塘村的时疫后来怎么样了？', targets: [{ kind: 'facts', pred: (x) => x.key === 'plague-end-s' }] },
  { cls: 'para', q: '那枚刻着暗记的哨子后来丢在哪儿了？', targets: [{ kind: 'facts', pred: (x) => x.key === 'lose-tally' }, { kind: 'facts', pred: (x) => x.key === 'get-tally' }] },
  { cls: 'para', q: '码头出事的时候被我拖出来的那个人是谁？', targets: [{ kind: 'facts', pred: (x) => x.key === 'save-shen' }, { kind: 'causal', pred: (x) => String(x.effect || '').includes('沈青禾') }] },
  { cls: 'para', q: '当年欠下人情的那位绣娘，跟我什么关系？', targets: [{ kind: 'facts', pred: (x) => x.key === 'save-shen' }] },
  { cls: 'para', q: '我资助过学费的那个学徒后来出息了吗？', targets: [{ kind: 'causal', pred: (x) => String(x.effect || '').includes('柳三儿') }] },
  { cls: 'hard', q: '我之前是不是落下了什么随身物件？', targets: [{ kind: 'facts', pred: (x) => x.key === 'lose-tally' }] },
  { cls: 'hard', q: '帮我回忆一下有人送过我东西的情节。', targets: [{ kind: 'facts', pred: (x) => x.key === 'get-tally' }] }
]

/* ---------- 填充回合 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + (t ^ (t >>> 14)) >>> 0) / 4294967296; return t }
}
const NPCS = ['林晚', '赵石', '阿萝', '周聋子', '何九', '崔梨']
const GOODS = ['铁矿', '布匹', '漕盐', '茶砖']

function fillerPatch(i, rnd) {
  const npc = NPCS[Math.floor(rnd() * NPCS.length)]
  const good = GOODS[Math.floor(rnd() * GOODS.length)]
  const p = { turn_summary: '第' + i + '回合', scene: { game_time: '玄历1024年·第' + (i * 2) + '日', location: '临水镇街市' }, events: [{ type: 'action', description: npc + '在临水镇街市盘点' + good + '的账目流水（第' + i + '条）。', importance: 12 + Math.floor(rnd() * 20), participant_names: [npc] }] }
  if (i % 5 === 0) p.facts = [{ key: 'filler-f-' + i, statement: npc + '的' + good + '账目在临水镇街市核讫无误（第' + i + '条）', importance: 30 + Math.floor(rnd() * 25) }]
  if (i % 7 === 0) p.decisions = [{ raw_input: '我决定按' + npc + '的章程办。', normalized_intent: '按' + npc + '章程行事', source: 'user_input', importance: 62 }]
  return p
}

function buildStory(engine, storyId, n) {
  const rnd = mulberry32(7)
  engine.ensureStory({ storyId, title: 'VecBench', kernelId: 'b', kernelText: '【基准内核】临水镇。' })
  engine.openSession({ storyId, sessionId: 'R1', label: 'bench' })
  for (let i = 1; i <= n; i++) {
    let patch = fillerPatch(i, rnd)
    for (const a of ANCHORS) {
      if (a.at === i) { patch = JSON.parse(JSON.stringify(a.patch)); patch.turn_summary = '锚点 ' + a.tag; patch.scene = { game_time: '玄历1024年·第' + (i * 2) + '日' } }
    }
    const r = engine.commitPatch(patch, { storyId, sessionId: 'R1', playerInput: '第' + i + '步' })
    if (!r.ok || !r.committed) throw new Error('T' + i + ' 提交失败: ' + JSON.stringify(r.errors))
  }
}

/* ---------- A/B 运行 ---------- */
const NO_VEC = { enabled: false, sync() {}, search() { return null } }

function runCase(engine, storyId, q, mode) {
  const story = engine.getStory(storyId)
  if (mode === 'baseline') {
    return retrieve(story, { storyId, playerInput: q, _retr: { slot: engine.store.retrSlot(storyId + '::base') }, _vec: NO_VEC })
  }
  return engine.retrieve(storyId, { playerInput: q })
}

function evaluate(engine, storyId, mode) {
  const rows = []
  for (const Q of QUERIES) {
    const ret = runCase(engine, storyId, Q.q, mode)
    let hit = 0
    let top3 = 0
    let rr = 0
    const ranks = []
    for (const t of Q.targets) {
      const list = (ret[t.kind] || []).slice().sort((a, b) => b.score - a.score)
      const idx = list.findIndex((it) => t.pred(it.rec))
      if (idx >= 0) {
        hit++; ranks.push(idx + 1); if (idx < 3) top3++
        rr += 1 / (idx + 1) // MRR：排名质量（语义通道的真正价值在竞争中的排名）
      }
    }
    rows.push({ cls: Q.cls, q: Q.q, total: Q.targets.length, hit, top3, mrr: Q.targets.length ? rr / Q.targets.length : 0, ranks })
  }
  return rows
}

function summarize(rows, label) {
  const byCls = {}
  let hit = 0, total = 0, top3 = 0, mrrSum = 0
  for (const r of rows) {
    byCls[r.cls] = byCls[r.cls] || { hit: 0, total: 0, top3: 0, mrr: 0, n: 0 }
    byCls[r.cls].hit += r.hit; byCls[r.cls].total += r.total; byCls[r.cls].top3 += r.top3
    byCls[r.cls].mrr += r.mrr; byCls[r.cls].n++
    hit += r.hit; total += r.total; top3 += r.top3; mrrSum += r.mrr
  }
  for (const cls of Object.keys(byCls)) {
    byCls[cls].rate = Math.round(100 * byCls[cls].hit / byCls[cls].total)
    byCls[cls].mrr = Number((byCls[cls].mrr / byCls[cls].n).toFixed(3))
  }
  return { label, rows, hit, total, top3, rate: Math.round(100 * hit / total), mrr: Number((mrrSum / rows.length).toFixed(3)), byCls }
}

function main() {
  const n = Number(process.argv[2]) || 1000
  const embedder = process.env.SIXWORLDS_EMBEDDER || 'hash-v1'
  process.env.SIXWORLDS_EMBEDDER = embedder
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-vec-bench-'))
  const engine = createEngine(dir)
  buildStory(engine, 'benchA', n)
  const t0 = Date.now()
  const base = evaluate(engine, 'benchA', 'baseline')
  const sem = evaluate(engine, 'benchA', 'semantic')
  const dt = Date.now() - t0
  const stats = engine.vectorStore.stats()

  const b = summarize(base, 'baseline(纯词面)')
  const s = summarize(sem, 'semantic(词面+语义)')
  console.log('\n===== 语义检索 A/B @ ' + n + ' 回合 · embedder=' + embedder + ' · 索引 ' + stats.chunks + ' 块 · 查询耗时 ' + dt + 'ms =====')
  console.log('  逐条 [基线 → 语义]（排名=目标在分类内的名次，-- 表示未命中）:')
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]
    const fmt = (r) => r.hit ? r.ranks.join('/') : '--'
    console.log('    [' + q.cls + '] ' + fmt(b.rows[i]) + ' → ' + fmt(s.rows[i]) + '  ' + q.q)
  }
  console.log('  基线:  Hit ' + b.hit + '/' + b.total + ' (' + b.rate + '%) · Top3 ' + b.top3 + ' · MRR ' + b.mrr)
  console.log('  语义:  Hit ' + s.hit + '/' + s.total + ' (' + s.rate + '%) · Top3 ' + s.top3 + ' · MRR ' + s.mrr)
  for (const cls of ['exact', 'para', 'hard']) {
    console.log('  [' + cls + '] 基线 Hit ' + b.byCls[cls].hit + '/' + b.byCls[cls].total + ' MRR ' + b.byCls[cls].mrr + ' → 语义 Hit ' + s.byCls[cls].hit + '/' + s.byCls[cls].total + ' MRR ' + s.byCls[cls].mrr)
  }
  console.log('  ΔHit ' + (s.hit - b.hit >= 0 ? '+' : '') + (s.hit - b.hit) + ' · ΔTop3 ' + (s.top3 - b.top3 >= 0 ? '+' : '') + (s.top3 - b.top3) + ' · ΔMRR ' + (Number((s.mrr - b.mrr).toFixed(3)) >= 0 ? '+' : '') + Number((s.mrr - b.mrr).toFixed(3)))

  /* 门槛：语义总体不劣于基线（Hit/Top3/MRR）；exact 类不得回退；hard 难例解决数如实上报 */
  let fails = 0
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  << ' + extra : '')); if (!cond) fails++ }
  check('总体 Hit · 语义 ≥ 基线', s.hit >= b.hit, b.hit + ' → ' + s.hit)
  check('总体 Top3 · 语义 ≥ 基线', s.top3 >= b.top3, b.top3 + ' → ' + s.top3)
  check('总体 MRR · 语义 ≥ 基线', s.mrr >= b.mrr, b.mrr + ' → ' + s.mrr)
  check('exact 类无回退', s.byCls.exact.hit >= b.byCls.exact.hit, b.byCls.exact.hit + ' → ' + s.byCls.exact.hit)
  const solvedHard = s.byCls.hard.hit - b.byCls.hard.hit
  console.log('  难例解决数（基线未中→语义命中）: ' + (solvedHard >= 0 ? '+' : '') + solvedHard + '；未解难例 ' + (s.byCls.hard.total - s.byCls.hard.hit) + '（真模型嵌入的升级空间）')

  engine.vectorStore.close() // 释放 SQLite 句柄（Windows 下目录可删）
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(fails === 0 ? '\nVEC_BENCH_PASS' : '\nVEC_BENCH_FAILED: ' + fails)
  process.exitCode = fails ? 1 : 0
}

main()

'use strict'
/* 长期 Recall 分层基准（规范四十/四十一/四十五）
 *
 * 分层定义：
 *   Retrieval Recall —— 正确记录进入检索结果（分类截断后）；
 *   Context Recall   —— 正确记录的内容进入最终 Context 块（会被预算/截断进一步筛选）；
 *   LLM Recall       —— 模型是否正确使用（由 stress-e2e 的 mock 回显链路实测，另行报告）。
 *
 * 七类查询（直接/实体/模糊/因果/关系/时间/间接）× 距离梯队（锚点 @T30 / @T500 → 查询 @T1000/@T5000）。
 * 三故事交错隔离：A/B/C 各自词汇，同查询跨故事 + 缓存开启，断言零串线（规范二十六/四十五）。
 * 运行：node scripts-dev/bench-recall.cjs 1000 5000
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------- 锚点与查询（七类） ---------- */
const ANCHORS = [
  { tag: 'refuse-org', at: 30, kind: 'decision', patch: { decisions: [{ raw_input: '我当众回绝了黑鸦商会的入会邀请，分文未取。', normalized_intent: '明确拒绝加入黑鸦商会', source: 'user_input', importance: 85 }], facts: [{ key: 'refuse-crow', statement: '凯岩当众拒绝黑鸦商会的入会拉拢', importance: 85 }], relationships: [{ source_name: '凯岩', target_name: '乌魁', relation_type: '入会拉拢被拒', strength_delta: -1, description: '凯岩当面回绝乌魁代表的黑鸦商会' }] } },
  { tag: 'save-npc', at: 32, kind: 'causal', patch: { decisions: [{ raw_input: '货架塌了，我把沈青禾拖了出来。', normalized_intent: '塌架时救下沈青禾', source: 'user_input', importance: 82 }], facts: [{ key: 'save-shen', statement: '河湾码头货架塌落，凯岩救下了绣娘沈青禾', importance: 85 }], causal: [{ cause: '河湾码头货架塌落', effect: '沈青禾被凯岩从货架下拖出', importance: 70 }], entity_changes: [{ name: '沈青禾', type: 'character', summary: '绣娘，塌架中被凯岩所救' }], relationships: [{ source_name: '凯岩', target_name: '沈青禾', relation_type: '救命之恩', strength_delta: 3, description: '凯岩救了沈青禾，她视他为恩人' }] } },
  { tag: 'get-item', at: 34, kind: 'fact', patch: { facts: [{ key: 'get-tally', statement: '凯岩在旧货摊淘到一枚玄铁哨，哨身刻着漕帮暗记', importance: 85 }], entity_changes: [{ name: '玄铁哨', type: 'item', summary: '刻有漕帮暗记的旧哨子' }] } },
  { tag: 'lose-item', at: 38, kind: 'fact', patch: { facts: [{ key: 'lose-tally', statement: '玄铁哨在渡船倾覆时沉入河湾，彻底丢失', importance: 85 }] } },
  { tag: 'expose-official', at: 42, kind: 'causal', patch: { facts: [{ key: 'expose-magistrate', statement: '凯岩把县令私吞河工银的两本假账公之于众', importance: 86 }], causal: [{ cause: '两本假账当众公开', effect: '县令被革职查办，河工银追缴回库', importance: 70 }], decisions: [{ raw_input: '我把县令的假账摊在了衙门口。', normalized_intent: '公开县令贪腐罪证', source: 'user_input', importance: 84 }] } },
  { tag: 'grudge-scout', at: 46, kind: 'relationship', patch: { events: [{ type: 'conflict', description: '镖头铁面在市集拦住凯岩，两人因旧账撕破脸。', importance: 70, participant_names: ['铁面'] }], relationships: [{ source_name: '凯岩', target_name: '铁面', relation_type: '结怨敌对', strength_delta: -3, description: '铁面替黑鸦商会警告凯岩，双方结怨' }] } },
  { tag: 'plague-thread', at: 50, kind: 'thread', patch: { threads: [{ op: 'add', title: '南塘村的时疫', detail: '南塘村高热时疫蔓延，病倒的人一天比一天多', importance: 75 }], facts: [{ key: 'plague-south', statement: '南塘村爆发高热时疫', importance: 80 }] } },
  { tag: 'help-npc', at: 500, kind: 'causal', patch: { decisions: [{ raw_input: '我替柳三儿垫付了药钱，还教他认了半年账目。', normalized_intent: '资助并教导柳三儿', source: 'user_input', importance: 80 }], causal: [{ cause: '凯岩垫药钱并教柳三儿识字记账', effect: '柳三儿成为粮行的记账先生，脱离苦力行当', importance: 65 }], entity_changes: [{ name: '柳三儿', type: 'character', summary: '受凯岩资助读书记账，后为粮行记账先生' }] } },
  { tag: 'plague-end', at: 520, kind: 'thread', patch: { threads: [{ op: 'update', ref: '南塘村的时疫', status: 'RESOLVED', detail: '时疫经隔离与汤药 control 住，南塘村痊愈' }], facts: [{ key: 'plague-end-s', statement: '南塘村时疫彻底平息，官府颁了奖谕', importance: 80 }] } }
]

/* 七类查询（规范四十）→ 断言目标（tag + 账本种类 + 文本标记） */
const QUERIES = [
  { cls: '直接回忆', q: '我之前拒绝过什么组织？', targets: [{ tag: 'refuse-org', kind: 'decisions' }], text: ['黑鸦'] },
  { cls: '实体回忆', q: '那个曾经救过我的人，后来怎么样了？', targets: [{ tag: 'save-npc', kind: 'entities' }, { tag: 'save-npc', kind: 'causal' }], text: ['沈青禾'] },
  { cls: '模糊回忆', q: '那件后来丢掉的东西，最后去哪了？', targets: [{ tag: 'lose-item', kind: 'facts' }, { tag: 'get-item', kind: 'facts' }], text: ['玄铁哨'] },
  { cls: '因果回忆', q: '为什么县令最后会被革职查办？', targets: [{ tag: 'expose-official', kind: 'causal' }, { tag: 'expose-official', kind: 'facts' }], text: ['假账'] },
  { cls: '关系回忆', q: '我和那个跟我结过怨的镖头之间发生过什么？', targets: [{ tag: 'grudge-scout', kind: 'relationships' }], text: ['铁面'] },
  { cls: '时间回忆', q: '几年前那场时疫后来怎么样了？', targets: [{ tag: 'plague-end', kind: 'facts' }], text: ['时疫'] },
  { cls: '间接回忆', q: '不就是那个之前帮过我的人吗？他现在如何？', targets: [{ tag: 'help-npc', kind: 'causal' }, { tag: 'help-npc', kind: 'entities' }], text: ['柳三儿'] }
]

/* ---------- 基准故事填充（背景演进，非锚点回合也走真实管线） ---------- */
function fillerPatch(i, storyTag, vocab) {
  const npc = vocab.npcs[i % vocab.npcs.length]
  const good = vocab.goods[i % vocab.goods.length]
  const p = {
    turn_summary: storyTag + ' 第' + i + '回合',
    scene: { game_time: '玄历1024年·第' + (i * 2) + '日', location: i % 4 === 0 ? vocab.place : '' },
    events: [{ type: 'action', description: npc + '在' + vocab.place + '与' + vocab.hero + '盘点' + good + '的账目流水（' + storyTag + '第' + i + '条）。', importance: 12 + (i % 20), participant_names: [npc] }]
  }
  if (i % 5 === 0) p.facts = [{ key: storyTag + '-f-' + i, statement: npc + '的' + good + '账目在' + vocab.place + '核讫无误（' + storyTag + '第' + i + '条）', importance: 30 + (i % 25) }]
  if (i % 7 === 0) p.decisions = [{ raw_input: '我决定按' + npc + '的章程办。', normalized_intent: '按' + npc + '章程行事', source: 'user_input', importance: 62 }]
  return p
}

/* 三故事各自独立词汇（隔离测试判据：A 独有词不得出现在 B/C，反之亦然） */
const VOCAB = {
  isoA: { npcs: ['林晚', '赵石', '阿萝', '周聋子'], goods: ['铁矿', '布匹'], place: '临水镇街市', hero: '凯岩' },
  isoB: { npcs: ['周渔', '何九', '崔梨', '孟大川'], goods: ['漕盐', '桐油'], place: '银鸥埠码头', hero: '李棠' },
  isoC: { npcs: ['吴大娘', '郑火旺', '冯春枣', '吕半仙'], goods: ['茶砖', '瓷坯'], place: '飞鱼渡口', hero: '韩潮' }
}

function buildStory(engine, storyId, n, seed, opts) {
  const o = opts || {}
  const vocab = VOCAB[storyId] || VOCAB.isoA
  const rnd = mulberry32(seed)
  engine.ensureStory({ storyId, title: 'Recall-' + storyId, kernelId: 'b', kernelText: '【' + storyId + ' 内核】' + vocab.place + '。' })
  engine.openSession({ storyId, sessionId: 'R1', label: 'recall' })
  for (let i = 1; i <= n; i++) {
    let patch = fillerPatch(i, storyId, vocab)
    for (const a of (o.plantAnchors === false ? [] : ANCHORS)) {
      if (a.at === i) {
        patch = JSON.parse(JSON.stringify(a.patch))
        patch.turn_summary = '锚点 ' + a.tag
        patch.scene = { game_time: '玄历1024年·第' + (i * 2) + '日' }
        patch.events = patch.events || [{ type: 'turning_point', description: '锚点事件 ' + a.tag, importance: 80 }]
      }
    }
    const r = engine.commitPatch(patch, { storyId, sessionId: 'R1', playerInput: '第' + i + '步' })
    if (!r.ok || !r.committed) throw new Error(storyId + ' T' + i + ' 提交失败: ' + JSON.stringify(r.errors))
  }
}

/* ---------- 判定 ---------- */
function findTagRecord(story, tag, kind) {
  const want = {
    'refuse-org': { decisions: (x) => x.raw_input.indexOf('黑鸦') >= 0, facts: (x) => x.key === 'refuse-crow', relationships: (x) => x.relation_type === '入会拉拢被拒' },
    'save-npc': { entities: (x) => x.name === '沈青禾', causal: (x) => (x.effect || '').indexOf('沈青禾') >= 0, decisions: (x) => x.raw_input.indexOf('沈青禾') >= 0 },
    'get-item': { facts: (x) => x.key === 'get-tally' },
    'lose-item': { facts: (x) => x.key === 'lose-tally' },
    'expose-official': { causal: (x) => (x.effect || '').indexOf('革职查办') >= 0, facts: (x) => x.key === 'expose-magistrate', decisions: (x) => x.raw_input.indexOf('假账') >= 0 },
    'grudge-scout': { relationships: (x) => x.relation_type === '结怨敌对' },
    'plague-thread': { threads: (x) => x.title === '南塘村的时疫' },
    'plague-end': { facts: (x) => x.key === 'plague-end-s', threads: (x) => x.title === '南塘村的时疫' },
    'help-npc': { causal: (x) => (x.effect || '').indexOf('柳三儿') >= 0, entities: (x) => x.name === '柳三儿', decisions: (x) => x.raw_input.indexOf('柳三儿') >= 0 }
  }[tag] || {}
  const list = { decisions: story.decisions, facts: story.facts, entities: story.entities, causal: story.causal, relationships: story.relationships, threads: story.threads }[kind] || []
  const pred = want[kind]
  return pred ? list.find(pred) : null
}

function runQueries(engine, storyId, n) {
  const story = engine.getStory(storyId)
  const rows = []
  for (const Q of QUERIES) {
    const ctx = engine.buildContext(storyId, { playerInput: Q.q })
    const dist = n - Math.min.apply(null, ANCHORS.filter((a) => Q.targets.some((t) => t.tag === a.tag)).map((a) => a.at))
    let ret = 0, ctxc = 0
    const misses = []
    for (const t of Q.targets) {
      const rec = findTagRecord(story, t.tag, t.kind)
      if (!rec) { misses.push(t.tag + '(账本缺失)'); continue }
      const inRetrieval = (ctx.retrieved[t.kind] || []).some((it) => it.rec === rec)
      if (inRetrieval) ret++
      else misses.push(t.kind + ':' + t.tag + '(未入检索)')
    }
    for (const term of Q.text) {
      if (ctx.block.indexOf(term) >= 0) ctxc++
      else misses.push('文本「' + term + '」不在 Context')
    }
    rows.push({ cls: Q.cls, q: Q.q, dist, ret_total: Q.targets.length, ret_hit: ret, ctx_total: Q.text.length, ctx_hit: ctxc, misses })
  }
  return rows
}

/* ---------- 主流程 ---------- */
function main() {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean)
  const Ns = sizes.length ? sizes : [1000, 5000]
  const all = { runs: [] }
  for (const n of Ns) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-recall-'))
    const engine = createEngine(dir)
    buildStory(engine, 'recallA', n, 7)
    const rows = runQueries(engine, 'recallA', n)
    console.log('\n===== Recall @ ' + n + ' 回合（真实管线长跑后查询） =====')
    let rHit = 0, rTot = 0, cHit = 0, cTot = 0
    for (const r of rows) {
      rHit += r.ret_hit; rTot += r.ret_total; cHit += r.ctx_hit; cTot += r.ctx_total
      console.log('  [' + r.cls + '] 距离 ' + r.dist + ' · Retrieval ' + r.ret_hit + '/' + r.ret_total + ' · Context ' + r.ctx_hit + '/' + r.ctx_total + (r.misses.length ? ' · 未中: ' + r.misses.join(', ') : ''))
    }
    console.log('  合计 Retrieval Recall: ' + rHit + '/' + rTot + ' (' + Math.round(100 * rHit / rTot) + '%) · Context Recall: ' + cHit + '/' + cTot + ' (' + Math.round(100 * cHit / cTot) + '%)')
    all.runs.push({ n, rows, rHit, rTot, cHit, cTot })
    try { engine.close() } catch {}
    fs.rmSync(dir, { recursive: true, force: true })
  }

  /* ---- 三故事交错隔离 + 缓存隔离（规范四十五/二十六） ---- */
  console.log('\n===== 三故事交错隔离 + 缓存隔离 =====')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-iso-'))
  const engine = createEngine(dir)
  buildStory(engine, 'isoA', 200, 11) // 主故事：植入全部锚点
  buildStory(engine, 'isoB', 200, 23, { plantAnchors: false })
  buildStory(engine, 'isoC', 200, 37, { plantAnchors: false })
  /* 三故事同词汇骨架、不同锚点：给 B/C 各自植入同结构锚点（换词） */
  const mark = (storyId, key, statement) => {
    const s = engine.getStory(storyId)
    const r = engine.commitPatch({ turn_summary: '标记', scene: { game_time: '第1日' }, facts: [{ key, statement, importance: 85 }] }, { storyId, sessionId: 'R1', playerInput: '标记' + key })
    if (!r.ok) throw new Error('mark fail ' + storyId)
  }
  mark('isoB', 'refuse-crow', '李棠当众拒绝银鸥商会的入会拉拢')
  mark('isoC', 'refuse-crow', '韩潮当众拒绝飞鱼帮的入会拉拢')
  let fails = 0
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  << ' + extra : '')); if (!cond) fails++ }
  const PROBE = '我之前拒绝过什么组织？'
  const res = { A: engine.buildContext('isoA', { playerInput: PROBE }), B: engine.buildContext('isoB', { playerInput: PROBE }), C: engine.buildContext('isoC', { playerInput: PROBE }) }
  check('隔离 · A 含自身词汇（黑鸦/铁矿），不含 B/C 独有词汇', res.A.block.indexOf('黑鸦') >= 0 && res.A.block.indexOf('银鸥') < 0 && res.A.block.indexOf('飞鱼') < 0 && res.A.block.indexOf('漕盐') < 0 && res.A.block.indexOf('茶砖') < 0)
  check('隔离 · B 含自身词汇（银鸥/漕盐），不含 A/C 独有词汇', res.B.block.indexOf('银鸥') >= 0 && res.B.block.indexOf('黑鸦') < 0 && res.B.block.indexOf('铁矿') < 0 && res.B.block.indexOf('飞鱼') < 0 && res.B.block.indexOf('茶砖') < 0)
  check('隔离 · C 含自身词汇（飞鱼/茶砖），不含 A/B 独有词汇', res.C.block.indexOf('飞鱼') >= 0 && res.C.block.indexOf('黑鸦') < 0 && res.C.block.indexOf('茶砖') >= 0 && res.C.block.indexOf('铁矿') < 0 && res.C.block.indexOf('漕盐') < 0)
  /* 同一查询交错 20 轮（缓存全开）再验证 */
  for (let k = 0; k < 20; k++) {
    engine.buildContext('isoA', { playerInput: PROBE })
    engine.buildContext('isoB', { playerInput: PROBE })
    engine.buildContext('isoC', { playerInput: PROBE })
  }
  const res2 = { A: engine.buildContext('isoA', { playerInput: PROBE }), B: engine.buildContext('isoB', { playerInput: PROBE }), C: engine.buildContext('isoC', { playerInput: PROBE }) }
  check('缓存隔离 · 交错 20 轮后 A/B/C 结果仍各自正确', res2.A.block.indexOf('黑鸦') >= 0 && res2.B.block.indexOf('银鸥') >= 0 && res2.C.block.indexOf('飞鱼') >= 0 && res2.A.block.indexOf('银鸥') < 0 && res2.B.block.indexOf('黑鸦') < 0)
  /* 提交新记录后版本失效：缓存不得返回旧结果 */
  mark('isoA', 'post-cache-probe', '凯岩战后拜入了黑鸦商会执事堂')
  const res3 = engine.buildContext('isoA', { playerInput: PROBE })
  check('缓存一致性 · 状态变更后缓存失效（新记录可见）', res3.block.indexOf('执事堂') >= 0)
  /* 缓存命中路径：同查询二次调用返回一致结果 */
  const res4a = engine.buildContext('isoA', { playerInput: PROBE })
  const res4b = engine.buildContext('isoA', { playerInput: PROBE })
  check('缓存 · 同版本重复查询结果一致', JSON.stringify(res4a.retrieved.retrieved_ids) === JSON.stringify(res4b.retrieved.retrieved_ids))
  /* 快照恢复后缓存不得读旧 */
  engine.snapshot('isoA', '恢复测试点')
  mark('isoA', 'after-snap-probe', '凯岩在恢复点之后立了新功')
  const snap = engine.listSnapshots('isoA')[0]
  engine.restoreSnapshot('isoA', snap.snapshot_id)
  const res5 = engine.buildContext('isoA', { playerInput: PROBE })
  check('快照恢复 · 缓存失效（恢复点后的记录不可见）', res5.block.indexOf('恢复点之后立了新功') < 0)
  try { engine.close() } catch {}
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(fails === 0 ? '\nISO_ALL_PASS' : '\nISO_FAILED: ' + fails)
  process.exitCode = fails ? 1 : 0
}

main()

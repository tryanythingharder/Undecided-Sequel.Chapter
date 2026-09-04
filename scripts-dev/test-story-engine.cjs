'use strict'
/* 故事状态引擎自动化测试（11 项，对应需求条款 48）
 * 纯 Node 运行，无需 Electron：node scripts-dev/test-story-engine.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')

const results = []
let failures = 0
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra })
  if (!cond) failures++
  const extraStr = extra === undefined ? '' : '  << ' + JSON.stringify(extra).slice(0, 400)
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond ? '' : extraStr))
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-engine-test-'))
const engine = createEngine(tmp)
const enginesCreated = [engine] // 统一收口：收尾时释放各引擎的 SQLite 句柄
const KERNEL = '示例内核 v1：无职转生系风格。'
const patchOf = (o) => Object.assign({ turn_summary: 't' }, o)

// ============ 准备：故事 A/B（同内核） + 故事 C（隔离用） ============
engine.ensureStory({ storyId: 'storyA', title: '故事A', kernelId: 'k1', kernelText: KERNEL })
engine.ensureStory({ storyId: 'storyB', title: '故事B', kernelId: 'k1', kernelText: KERNEL })
engine.ensureStory({ storyId: 'storyC', title: '故事C', kernelId: 'k2', kernelText: KERNEL + '变体' })

// ============ 测试 1+6：长期记忆（第 1 回合决定在第 1000 回合仍可检索）+ 自由输入留痕 ============
{
  const raw = '世界回应……\n<<<STATE_PATCH>>>\n' + JSON.stringify({
    turn_summary: '玩家在雾镇北门与守卫交谈',
    decisions: [{ raw_input: '我要去北面的雾林寻找失踪的妹妹', normalized_intent: '前往雾林寻妹', importance: 60, source: 'user_input' }],
    facts: [{ key: 'sister_missing', statement: '玩家的妹妹在雾林失踪', importance: 70 }],
    threads: [{ op: 'add', title: '妹妹失踪之谜', detail: '北门守卫提到过夜半的哭声', importance: 65 }]
  }) + '\n<<<END_PATCH>>>'
  const r = engine.commitFromRaw(raw, { storyId: 'storyA', sessionId: 'SES-test1', playerInput: '我要去北面的雾林寻找失踪的妹妹' })
  check('t1: 首回合提交成功', r.ok === true, r.errors)
  check('t1: decision raw_input 原样保留（自由输入留痕）', r.ok && (engine.getStory('storyA').decisions[0].raw_input === '我要去北面的雾林寻找失踪的妹妹'))
  check('t1: 协议块已从叙事剥离', r.ok && !r.narrative.includes('STATE_PATCH') && r.narrative.startsWith('世界回应'))

  // 快进 1000 回合（琐事级）
  for (let i = 0; i < 1000; i++) {
    engine.commitPatch({ events: [{ type: 'action', description: '路过第' + i + '个路标', importance: 3 }] }, { storyId: 'storyA', playerInput: '继续走' })
  }
  const ctx = engine.buildContext('storyA', { playerInput: '雾林 妹妹 失踪' })
  const ids = ctx.retrieved.retrieved_ids
  const hasDecision = engine.getStory('storyA').decisions[0].decision_id
  check('t1: 第1000回合后，第1回合的重大决定仍被检索命中', ids.includes(hasDecision), ids.slice(0, 10))
  check('t1: 第1000回合后，伏笔仍开放且被检索', ctx.retrieved.threads.some((t) => t.rec.title === '妹妹失踪之谜'))
  check('t1: 琐事事件未淹没重大记忆（事件截断生效）', ctx.retrieved.events.length <= 12)
}

// ============ 测试 2+3：Story 隔离（同内核 storyB 查不到 storyA 的记忆） ============
{
  const dec = engine.getStory('storyA').decisions[0]
  const ctxB = engine.buildContext('storyB', { playerInput: '雾林 妹妹 失踪 守卫 哭声' })
  const allIds = [].concat(ctxB.retrieved.retrieved_ids)
  check('t2: storyB 检索不到 storyA 的决定', !allIds.includes(dec.decision_id))
  const facA = engine.getStory('storyA').facts.find((f) => f.key === 'sister_missing')
  check('t2: storyB 检索不到 storyA 的事实', !allIds.includes(facA.fact_id))
  check('t2: storyB 回合计数独立（仍为 0）', engine.getStory('storyB').counters.turn === 0)
  // 跨故事写/读硬闸
  let blocked = false
  try { engine.retrieve('storyB', { storyId: 'storyA', playerInput: 'x' }) } catch { blocked = true }
  check('t3: 跨故事 retrieve 调用被硬闸拒绝', blocked)
  const turnA = engine.getStory('storyA').counters.turn
  engine.commitPatch(patchOf({ commitments: [{ content: 'storyB 自己的承诺', kind: 'goal', importance: 40 }] }), { storyId: 'storyB', sessionId: 'SES-b1', playerInput: 'x' })
  check('t3: 同内核不同故事提交互不影响（storyB 记了自己的，storyA 回合数未变）', engine.getStory('storyA').counters.turn === turnA && engine.getStory('storyB').counters.turn === 1)
}

// ============ 测试 4：Session 隔离与延续（Session 结束，Story 记忆仍在） ============
{
  engine.commitPatch(patchOf({ commitments: [{ content: '答应铁匠三天内送来铁矿', kind: 'promise', importance: 55 }] }), { storyId: 'storyC', sessionId: 'SES-day1', playerInput: '答应铁匠' })
  engine.closeSession({ storyId: 'storyC', sessionId: 'SES-day1' })
  const r = engine.commitPatch(patchOf({ commitments: [{ content: '答应酒馆老板打听消息', kind: 'promise', importance: 45 }] }), { storyId: 'storyC', sessionId: 'SES-day2', playerInput: '答应老板' })
  check('t4: 新 Session 中旧 Session 的承诺仍被检索（跨 Session 记忆延续）', r.ok && engine.buildContext('storyC', { playerInput: '铁矿 铁匠 承诺' }).retrieved.commitments.length >= 2)
  const story = engine.getStory('storyC')
  check('t4: Session 登记簿正确（2 个 session，day1 已关闭）', story.sessions.length === 2 && story.sessions[0].status === 'CLOSED')
}

// ============ 测试 5：选项 ≠ 决定（AI 选项不得成为 CONFIRMED，整体不丢） ============
{
  const r = engine.commitPatch(patchOf({
    decisions: [
      { raw_input: 'A. 询问旅店价格', normalized_intent: '询问旅店价格', source: 'ai_option', importance: 30 },
      { raw_input: '我要了最便宜的房间', normalized_intent: '订最便宜的房间', source: 'user_input', importance: 30 }
    ]
  }), { storyId: 'storyC', sessionId: 'SES-opt', playerInput: '我要了最便宜的房间' })
  check('t5: 含 AI 选项的 patch 仍提交成功（降级而非丢弃整回合）', r.ok === true, r.errors)
  check('t5: 校验层给出降级警告', r.warnings.some((w) => w.code === 'DECISION_AI_OPTION_DOWNGRADED'), r.warnings)
  const story = engine.getStory('storyC')
  const ai = story.decisions.find((d) => d.source === 'ai_option')
  const user = story.decisions.find((d) => d.source === 'user_input' && d.normalized_intent === '订最便宜的房间')
  check('t5: AI 选项被强制降为 PROPOSED', ai && ai.status === 'PROPOSED', ai)
  check('t5: 玩家真实输入为 CONFIRMED', user && user.status === 'CONFIRMED', user)
}

// ============ 测试 6：无 patch 回合静默降级（不推进引擎回合，条款 26） ============
{
  const before = engine.getStory('storyC').counters.turn
  const r = engine.commitFromRaw('纯叙事文本，没有任何状态块。', { storyId: 'storyC', sessionId: 'SES-nopatch', playerInput: '随便走走' })
  check('t6: 无 patch 回合提交 ok（降级不报错）', r.ok === true && r.committed === false, r.warnings)
  check('t6: 引擎回合未推进', engine.getStory('storyC').counters.turn === before)
  check('t6: 给出 PATCH_ABSENT 警告', r.warnings.some((w) => w.code === 'PATCH_ABSENT'))
  check('t6: 空回合计入诊断日志', engine.turnLogs('storyC').some((t) => String(t).endsWith('-np')), engine.turnLogs('storyC').slice(-3))
}

// ============ 测试 7：删除摘要导航层后，账本仍在、检索照常 ============
{
  const story = engine.getStory('storyA')
  story.scene.summary = '' // 摘要清零（模拟"摘要层被删光"）
  const ctx = engine.buildContext('storyA', { playerInput: '妹妹 雾林' })
  check('t7: 摘要清空后，决定/事实检索照常', ctx.retrieved.decisions.length > 0 && ctx.retrieved.facts.length > 0)
  check('t7: 摘要清空后，开放伏笔仍在', ctx.retrieved.threads.length > 0)
}

// ============ 测试 8：快照创建与恢复（含 story 归属校验） ============
{
  const before = engine.getStory('storyA').counters.turn
  const snap = engine.snapshot('storyA', '千回合纪念')
  // 再推进几个回合
  engine.commitPatch(patchOf({ facts: [{ key: 'later_fact', statement: '后来发生的事', importance: 40 }] }), { storyId: 'storyA', playerInput: '推进' })
  const after = engine.getStory('storyA').counters.turn
  check('t8: 快照前有新增回合', after === before + 1)
  engine.restoreSnapshot('storyA', snap.snapshot_id)
  const restored = engine.getStory('storyA')
  check('t8: 恢复后回合数回到快照点', restored.counters.turn === before)
  check('t8: 恢复后 later_fact 不存在', !restored.facts.some((f) => f.key === 'later_fact'))
  check('t8: 恢复后第1回合决定仍在', restored.decisions[0] && restored.decisions[0].raw_input.includes('雾林'))
  let blocked = false
  try { engine.restoreSnapshot('storyB', snap.snapshot_id) } catch { blocked = true }
  check('t8: 跨故事快照恢复被拒绝', blocked)
}

// ============ 测试 9：冲突 patch 被拒绝（不合法不提交，事务回滚） ============
{
  const before = engine.getStory('storyC').counters.turn
  const r1 = engine.commitPatch(patchOf({ commitment_updates: [{ ref: 'CMT-999999', status: 'FULFILLED' }] }), { storyId: 'storyC', sessionId: 'SES-conflict', playerInput: '兑现' })
  check('t9: 引用不存在的承诺 → 提交失败', r1.ok === false && r1.errors.some((e) => e.code === 'COMMITMENT_REF_MISSING'), r1.errors)
  check('t9: 失败后状态未变（回滚生效）', engine.getStory('storyC').counters.turn === before)
  // AI 选项已被降级放行（t5 覆盖）；此处验证降级不污染决定状态
  const r3 = engine.commitFromRaw('叙事文本\n<<<STATE_PATCH>>>\n{"turn_summary":"中断", "facts": [{"key":"trunc","statement":"截断测试", "importance": 20', { storyId: 'storyC', sessionId: 'SES-trunc', playerInput: '截断' })
  check('t9: 截断 JSON 被容错修复并成功提交', r3.ok === true, r3.errors)
}

// ============ 测试 10：知识隔离（秘密事实不进玩家上下文） ============
{
  engine.commitPatch(patchOf({
    facts: [
      { key: 'guard_secret', statement: '北门守卫其实是魔族卧底', secret_from_player: true, importance: 80 },
      { key: 'guard_name', statement: '北门守卫名叫罗恩', importance: 30 }
    ],
    knowledge: [{ content: '玩家得知守卫叫罗恩', how_learned: 'told_by' }]
  }), { storyId: 'storyC', sessionId: 'SES-secret', playerInput: '和守卫聊天' })
  const ctx = engine.buildContext('storyC', { playerInput: '守卫 罗恩 秘密' })
  const factsVisible = ctx.retrieved.facts.map((f) => f.rec.key)
  check('t10: 秘密事实不在玩家检索结果中', !factsVisible.includes('guard_secret'), factsVisible)
  check('t10: 公开事实正常可见', factsVisible.includes('guard_name'))
  const blockText = ctx.block
  check('t10: 上下文文本不含秘密内容', !blockText.includes('魔族卧底'))
}

// ============ 测试 11：1000 回合长跑（状态一致 + 隔离不破 + 性能） ============
{
  const t0 = Date.now()
  const story = engine.getStory('storyA')
  const decCount = story.decisions.length
  const factCount = story.facts.length
  for (let i = 0; i < 1000; i++) {
    const r = engine.commitPatch(patchOf({
      decisions: [{ raw_input: '长跑行动 ' + i, normalized_intent: '长跑' + i, importance: i % 50 === 0 ? 70 : 8, source: 'user_input' }],
      facts: [{ key: 'run_' + (i % 100), statement: '长跑事实 ' + (i % 100), importance: 20 }],
      events: [{ type: 'action', description: '长跑事件 ' + i, importance: i % 100 === 0 ? 60 : 5 }]
    }), { storyId: 'storyA', sessionId: 'SES-long', playerInput: '长跑 ' + i })
    if (!r.ok) { check('t11: 长跑中途提交失败 @' + i, false, r.errors); break }
  }
  const dt = Date.now() - t0
  const s2 = engine.getStory('storyA')
  // storyA 回合合计：t1 1 + 1000 琐事 + t8 快照后推进 1（随后恢复回 1001）+ t11 1000 = 2001
  check('t11: 1000 回合全部成功', s2.counters.turn === 2001, s2.counters.turn)
  check('t11: 决定账本完整（1000 条新增）', s2.decisions.length === decCount + 1000, s2.decisions.length - decCount)
  check('t11: 事实取代机制（同 key 只留 ACTIVE）', s2.facts.filter((f) => f.status === 'ACTIVE').length <= 100 + factCount)
  check('t11: 重大决定（每50回合）仍在账本', s2.decisions.filter((d) => d.importance >= 70).length >= 20)
  // 隔离仍在：storyB 只有自己的 1 条承诺，没有任何 storyA 的记忆
  const idsA = engine.getStory('storyA').decisions.map((d) => d.decision_id).concat(engine.getStory('storyA').facts.map((f) => f.fact_id))
  const ctxB = engine.buildContext('storyB', { playerInput: '长跑 雾林 妹妹' })
  check('t11: 长跑后 storyB 仍完全隔离（无任何 storyA 记忆命中）', ctxB.retrieved.retrieved_ids.every((id) => !idsA.includes(id)), ctxB.retrieved.retrieved_ids)
  // 性能：平均每回合 < 300ms（文件存储；实测随账本体量增长（新故事 ~13ms，2000+ 记录 ~25-40ms），
  // 本机（Defender 实时扫描）波动 25→77ms，GitHub CI 共享 vCPU runner 实测 134ms（77f3bf7 误杀）。
  // 阈值只用于捕捉算法级劣化（O(n)/O(n²) 在 2000 回合账本下会到数百 ms~秒级）；真实值打印供人工审阅）
  check('t11: 性能 合格（平均 ' + (dt / 1000).toFixed(2) + 'ms/回合 < 300ms）', dt / 1000 < 300, dt)
  // 持久化：重新加载引擎（模拟重启）后记忆仍在
  const engine2 = createEngine(tmp)
  enginesCreated.push(engine2)
  const s3 = engine2.getStory('storyA')
  check('t11: 重启后（重新 createEngine）状态完整恢复', s3 && s3.counters.turn === engine.getStory('storyA').counters.turn)
  const ctx3 = engine2.buildContext('storyA', { playerInput: '雾林 妹妹' })
  check('t11: 重启后第1回合决定仍可检索', ctx3.retrieved.decisions.length > 0)
}

// ============ 汇总 ============
console.log('\n===== 故事状态引擎测试结果 =====')
for (const group of ['t1', 't2', 't3', 't4', 't5', 't7', 't8', 't9', 't10', 't11']) {
  const g = results.filter((r) => r.name.startsWith(group + ':'))
  if (!g.length) continue
  const pass = g.every((r) => r.pass)
  console.log(group + ' ' + (pass ? 'OK ' : 'FAIL') + '  (' + g.filter((r) => r.pass).length + '/' + g.length + ')')
}
console.log('总计: ' + (results.length - failures) + '/' + results.length + ' 通过')
// 释放语义索引的 SQLite 句柄（Windows 下目录可删）；engine2 在 t11 作用域内，
// 通过其 store 所在引擎列表统一关闭
for (const e of enginesCreated) { try { e.close() } catch {} }
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)

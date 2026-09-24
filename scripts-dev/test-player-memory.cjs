'use strict'
/* 玩家可读记忆 / 章节回顾 / 纠错 —— 独立单元测试（无需 Electron，不触真实存档、不调收费服务）
 * 运行：node scripts-dev/test-player-memory.cjs
 * 临时数据只写在工作区 output/player-memory-tests/unit/ 内（用例级子目录，结束即清理，
 * 不触碰 output/player-memory-tests 下的 UI 校验产物）。
 * 覆盖：权限（秘密事实/秘密实体/隐藏目标/历史与修正记录不得泄露）、来源回合、纠错历史链、
 *       写盘失败回滚（前端状态不被留在已提交态）、章节回顾为账本原文摘录且可定位、边界（越权级别、非法入参）。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createEngine } = require('../engine/index')
const { readMemory, correctMemory, chapterRecap } = require('../engine/player-memory')

const root = path.join(__dirname, '..', 'output', 'player-memory-tests', 'unit')
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

let seq = 0
const checks = []
function check(name, fn) {
  const dir = path.join(root, 'case-' + String(++seq).padStart(2, '0'))
  fs.mkdirSync(dir, { recursive: true })
  const engine = createEngine(dir)
  try {
    fn(engine, dir)
    checks.push({ name, pass: true })
    console.log('  PASS ' + name)
  } catch (error) {
    checks.push({ name, pass: false, error })
    console.log('  FAIL ' + name + '  << ' + (error && error.message))
  } finally {
    try { engine.close() } catch {}
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const textOf = (memory) => JSON.stringify(memory)
const story = (engine, id) => engine.getStory(id)
function commit(engine, storyId, patch, input) {
  const raw = '叙事…\n<<<STATE_PATCH>>>\n' + JSON.stringify(Object.assign({ turn_summary: 't' }, patch)) + '\n<<<END_PATCH>>>'
  const r = engine.commitFromRaw(raw, { storyId, sessionId: 'SES-test', playerInput: input || '行动' })
  assert.equal(r.ok, true, 'commit failed: ' + JSON.stringify(r.errors))
  return r
}
/* 构造：密探实体只被秘密事实引用；公开人物与公开事实/事件 */
function seed(engine, storyId) {
  engine.ensureStory({ storyId, title: '测试世界线', kernelId: 'k', kernelText: '内核' })
  commit(engine, storyId, {
    entity_changes: [
      { name: '露西', type: 'character', summary: '村里的少女' },
      { name: '密探', type: 'character', summary: '暗中监视的人' }
    ],
    facts: [
      { key: 'village_seen', statement: '露西在村口等玩家', importance: 30, entity_names: ['露西'] },
      { key: 'spy_secret', statement: '密探是米里斯教会的眼线', importance: 70, secret_from_player: true, entity_names: ['密探'] },
      { key: 'alt_hidden', statement: '密探早已与贵族交易', importance: 60, visibility: 'secret', entity_names: ['密探'] }
    ],
    events: [{ type: 'action', description: '露西递给玩家一块面包', participant_names: ['露西'], importance: 30 }],
    commitments: [
      { content: '替露西寻找失散的兄长', kind: 'goal', due_hint: '三日内', importance: 60 },
      { content: '暗中保护密探（隐藏目标）', kind: 'quest', importance: 80 }
    ],
    relationships: [{ source_name: '玩家', target_name: '露西', relation_type: 'friend', strength_delta: 10, description: '互相照应' }],
    knowledge: [{ content: '玩家知道露西在村口', how_learned: 'observed' }],
    threads: [{ op: 'add', title: '兄长的下落', detail: '据说往北去了', importance: 50 }]
  }, '去村口')
}
/* 隐藏承诺（含秘密实体名）直接落账本，绕过 patch（模拟外部/历史数据） */
function injectHiddenCommitment(engine, storyId) {
  const s = story(engine, storyId)
  s.commitments.push({
    commitment_id: 'CMT-900001', story_id: storyId, kind: 'quest', content: '为密探传递密信',
    status: 'ACTIVE', counterpart: null, importance: 80, due_hint: '', turn: 1,
    created_at: Date.now(), updated_at: Date.now()
  })
  engine.store.saveStory(storyId)
}
/* 隐藏人物（刺客）：无任何公开叙事证据，只在隐藏事件/隐藏承诺/隐藏关系里出现。
 * 全部记录都带隐藏标记，名字仍不得经由实体列表/关系标题/承诺对象泄露。 */
function injectHiddenCharacter(engine, storyId) {
  const s = story(engine, storyId)
  const now = Date.now()
  s.entities.push({ entity_id: 'ENT-900001', story_id: storyId, name: '刺客', type: 'character', state: {}, tags: [], summary: '夜行的人', first_seen_turn: 1, status: 'ACTIVE', created_at: now, updated_at: now })
  s.events.push({ event_id: 'EVT-900001', story_id: storyId, type: 'action', description: '夜里有人翻墙', participants: ['ENT-900001'], location: '', game_time: '', importance: 50, turn: 1, secret_from_player: true, created_at: now, updated_at: now })
  s.commitments.push({ commitment_id: 'CMT-900002', story_id: storyId, kind: 'quest', content: '替组织送信', status: 'ACTIVE', counterpart: 'ENT-900001', importance: 50, due_hint: '', turn: 1, created_at: now, updated_at: now })
  s.relationships.push({ relationship_id: 'REL-900002', story_id: storyId, source: s.entities[0].entity_id, target: 'ENT-900001', relation_type: 'enemy', strength: -10, description: '露西被人盯上', status: 'ACTIVE', turn: 1, created_at: now, updated_at: now })
  engine.store.saveStory(storyId)
}

// ---- 1. 权限：秘密事实与秘密实体名不得出现在任何类别 ----
check('秘密事实/秘密实体名对所有类别不可见', (engine) => {
  seed(engine, 's1')
  injectHiddenCommitment(engine, 's1')
  const s = story(engine, 's1')
  // 关系把玩家↔密探连起来（外部注入），关系名也必须被过滤
  s.relationships.push({ relationship_id: 'REL-900001', story_id: 's1', source: s.entities[0].entity_id, target: s.entities[1].entity_id, relation_type: 'enemy', strength: -20, description: '密探监视玩家', status: 'ACTIVE', turn: 1, created_at: Date.now(), updated_at: Date.now() })
  engine.store.saveStory('s1')
  const m = readMemory(s, { accessLevel: 'PLAYER' })
  const dump = textOf(m)
  assert.equal(dump.includes('密探'), false, '实体名泄露：密探')
  assert.equal(dump.includes('眼线'), false, '秘密事实泄露')
  assert.equal(dump.includes('贵族交易'), false, 'visibility:secret 事实泄露')
  assert.equal(dump.includes('暗中保护'), false, '隐藏目标泄露')
  assert.equal(dump.includes('传递密信'), false, '隐藏承诺泄露')
  assert.equal(m.accessLevel, 'PLAYER')
  assert.equal(m.facts.some((f) => f.id === 'FAC-000001'), true, '可见事实应保留')
  assert.equal(m.entities.some((e) => e.name === '露西'), true, '可见人物应保留')
  assert.equal(m.relationships.length, 1, '玩家↔露西的关系应保留')
  assert.equal(m.relationships[0].title.includes('密探'), false)
  assert.equal(m.events.every((e) => !String(e.text).includes('密探')), true)
  assert.equal(m.corrections.length, 0)
})
/* 隐藏人物：无公开叙事证据，只在隐藏事件/隐藏承诺/隐藏关系里出现。
 * 名字不得经由实体列表、事件参与者、承诺对象、关系两端泄露；反证：公开人物仍可见。 */
check('隐藏人物不因隐藏事件/承诺/关系现身', (engine) => {
  seed(engine, 's2b')
  injectHiddenCharacter(engine, 's2b')
  const m = readMemory(story(engine, 's2b'), { accessLevel: 'PLAYER' })
  const dump = textOf(m)
  for (const secret of ['刺客', '翻墙', '组织送信', '被人盯上']) assert.equal(dump.includes(secret), false, '泄露：' + secret)
  assert.equal(m.entities.some((e) => e.name === '露西'), true, '公开人物应保留')
  assert.equal(m.entities.some((e) => e.name === '刺客'), false, '隐藏人物不得出现在实体列表')
  assert.equal(m.characters.some((c) => c.name === '刺客'), false)
  assert.equal(m.relationships.some((r) => String(r.title).includes('刺客')), false)
  // 隐藏事件/承诺/关系本身也不得出现
  assert.equal(m.events.every((e) => !String(e.text).includes('翻墙')), true)
  assert.equal(m.commitments.every((c) => !String(c.text).includes('组织送信')), true)
  assert.equal(m.commitments.every((c) => !String(c.text).includes('刺客')), true)
  assert.equal(m.relationships.every((r) => !String(r.title).includes('盯上')), true)
  // 一旦该人物获得公开证据（公开事实引用），即可正常可见
  commit(engine, 's2b', { facts: [{ key: 'assassin_met', statement: '刺客在白天露面了', importance: 30, entity_names: ['刺客'] }] })
  const after = readMemory(story(engine, 's2b'), { accessLevel: 'PLAYER' })
  assert.equal(after.facts.some((f) => f.text.includes('白天露面')), true, '公开事实应可读')
  assert.equal(after.entities.some((e) => e.name === '刺客'), true, '公开后人物应可见')
})
/* 索引重建：JSON 往返把 _nameIndex 由 Map 退化成普通对象（truthy 但非 Map）后，
 * 读记忆入口应重建索引，实体匹配不静默漏配。 */
check('退化实体名索引在读写入口重建', (engine) => {
  seed(engine, 's2c')
  const s = story(engine, 's2c')
  s._nameIndex = {} // 模拟结构化克隆 / 快照恢复后的退化索引
  const before = readMemory(s, { accessLevel: 'PLAYER' })
  assert.equal(s._nameIndex instanceof Map, true, '读记忆入口应重建为 Map')
  assert.equal(before.entities.some((e) => e.name === '露西'), true)
  s._nameIndex = {} // 再退化一次，验证纠错入口同样重建
  const target = before.facts.find((f) => f.text.includes('露西'))
  const corrected = correctMemory(engine, { storyId: 's2c', kind: 'facts', id: target.id, text: '露西已经离开村口', reason: '剧情推进' })
  assert.equal(s._nameIndex instanceof Map, true, '纠错入口应重建为 Map')
  assert.equal(corrected.corrections.length >= 1, true)
})
check('未知/越权级别 fail-closed 为 PLAYER', (engine) => {
  seed(engine, 's2')
  for (const level of [undefined, null, '', 'ADMIN', 'ROOT', 7, {}]) {
    const m = readMemory(story(engine, 's2'), { accessLevel: level })
    assert.equal(m.accessLevel, 'PLAYER', 'level=' + JSON.stringify(level))
    assert.equal(textOf(m).includes('密探'), false, 'level=' + JSON.stringify(level))
  }
  // 大小写归一（PLAYER 语义不变）
  assert.equal(readMemory(story(engine, 's2'), { accessLevel: 'player' }).accessLevel, 'PLAYER')
  // 只有显式 DEBUG/SYSTEM 才放行秘密（内部路径）
  assert.equal(readMemory(story(engine, 's2'), { accessLevel: 'DEBUG' }).facts.some((f) => f.id === 'FAC-000002'), true)
})

// ---- 2. 来源回合与原文定位 ----
check('记忆条目带来源回合，可回原文', (engine) => {
  seed(engine, 's3')
  commit(engine, 's3', { facts: [{ key: 'north_road', statement: '北面的路被雪封了', importance: 20, entity_names: ['露西'] }] }, '继续走')
  const m = readMemory(story(engine, 's3'))
  const fact = m.facts.find((f) => f.text.includes('北面的路'))
  assert.ok(fact, '第 2 回合事实应可读')
  assert.equal(fact.turn, 2, '事实应带来源回合')
  assert.equal(fact.kind, 'facts')
  const goal = m.goals.find((g) => g.text.includes('失散的兄长'))
  assert.equal(goal.turn, 1)
  assert.equal(goal.dueHint, '三日内')
  assert.equal(m.characters.find((c) => c.name === '露西').facts.length >= 1, true)
  assert.equal(m.knowledge.some((k) => k.turn === 1), true)
})

// ---- 3. 纠错：来源回合 + 历史链 + 事实取代留痕 ----
check('纠错保留来源回合与历史链（事实取代不覆盖）', (engine) => {
  seed(engine, 's4')
  const before = story(engine, 's4').facts.find((f) => f.key === 'village_seen')
  const m1 = correctMemory(engine, { storyId: 's4', kind: 'facts', id: before.fact_id, text: '露西在村口等玩家（清晨）', reason: '时间记错' })
  const corrected = m1.facts.find((f) => f.text.includes('清晨'))
  assert.ok(corrected, '修正后的事实应可读')
  assert.notEqual(corrected.id, before.fact_id, '事实纠错走取代（新 id）')
  assert.equal(m1.corrections.length, 1)
  assert.equal(m1.corrections[0].before, '露西在村口等玩家')
  assert.equal(m1.corrections[0].sourceTurn, before.turn, '修正记录保留来源回合')
  assert.equal(m1.corrections[0].history.length, 1)
  assert.equal(m1.lastCorrection.sourceTurn, before.turn)
  // 二次纠错：同一条记忆（取代链）的历史链累积
  const m2 = correctMemory(engine, { storyId: 's4', kind: 'facts', id: corrected.id, text: '露西在村口等玩家（清晨，带伞）', reason: '补细节' })
  const latest = m2.corrections[0]
  assert.equal(latest.lineage, before.fact_id, '取代链应归到同一谱系根')
  assert.equal(latest.history.length, 2, '同一记忆历史链应累积')
  assert.equal(latest.history[0].before, '露西在村口等玩家')
  assert.equal(latest.history[1].after, '露西在村口等玩家（清晨，带伞）')
  // 承诺纠错：原地改写 + 留痕
  const goal = story(engine, 's4').commitments.find((c) => c.content.includes('失散的兄长'))
  const m3 = correctMemory(engine, { storyId: 's4', kind: 'commitments', id: goal.commitment_id, text: '替露西寻找失散的姐姐', reason: '性别记错' })
  assert.equal(m3.commitments.some((c) => c.text.includes('姐姐')), true)
  assert.equal(m3.corrections.some((c) => c.kind === 'commitments' && c.before.includes('兄长')), true)
  // 原记录仍在账本中（不静默覆盖）
  assert.equal(story(engine, 's4').facts.some((f) => f.fact_id === before.fact_id && f.status === 'SUPERSEDED'), true)
  // 反证夹具本身有效：DEBUG 级应能看到被取代的原文，否则上面的隐私断言是空的
  const dbg = readMemory(story(engine, 's4'), { accessLevel: 'DEBUG' })
  assert.equal(dbg.corrections.length, 3, 'DEBUG 级应看到全部修正记录（夹具有效性反证）')
  assert.equal(dbg.facts.some((f) => f.text.includes('清晨')), true)
})

// ---- 4. 纠错权限：秘密记录不可纠正，也不得出现在修正记录里 ----
check('纠错不越权：秘密记录不可修正', (engine) => {
  seed(engine, 's5')
  const secret = story(engine, 's5').facts.find((f) => f.key === 'spy_secret')
  assert.throws(() => correctMemory(engine, { storyId: 's5', kind: 'facts', id: secret.fact_id, text: '改写秘密', reason: 'x' }), /不可修改/)
  assert.throws(() => correctMemory(engine, { storyId: 's5', kind: 'facts', id: 'FAC-999999', text: 'x', reason: 'y' }), /已变化/)
  assert.throws(() => correctMemory(engine, { storyId: 's5', kind: 'decisions', id: 'DEC-1', text: 'x', reason: 'y' }), /不支持/)
  assert.throws(() => correctMemory(engine, { storyId: 's5', kind: 'facts', id: 'FAC-000001', text: '', reason: 'y' }), /修正内容/)
  assert.throws(() => correctMemory(engine, { storyId: 'no-such', kind: 'facts', id: 'FAC-1', text: 'x', reason: 'y' }), /世界线不存在/)
  // 纠错不得引入秘密实体名：整条修正记录不可读（记录仍在账本，DEBUG 可见）
  const ok = story(engine, 's5').facts.find((f) => f.key === 'village_seen')
  assert.throws(() => correctMemory(engine, { storyId: 's5', kind: 'facts', id: ok.fact_id, text: '露西是密探的同伴', reason: '新情报' }), /不可修改/)
  const s5 = story(engine, 's5')
  assert.equal((s5.memory_corrections || []).length, 0, '越权纠错不得留下记录')
  assert.equal(s5.facts.some((f) => String(f.statement || '').includes('密探的同伴')), false, '越权纠错不得落库')
  // 修正文本提到可见人物（非秘密）仍可正常纠错，但秘密实体名绝不会随任何类别出现
  const m = correctMemory(engine, { storyId: 's5', kind: 'facts', id: ok.fact_id, text: '露西在村口（清晨）', reason: '补时间' })
  assert.equal(m.facts.some((f) => f.text.includes('清晨')), true)
  assert.equal(textOf(m).includes('密探'), false)
  assert.equal(m.corrections.length, 1)
})

// ---- 4b. 读改一致：读不到的记录同样改不动（承诺对象 / 关系端点为秘密实体） ----
/* 关键点：正文干净但「对象是秘密实体」的承诺，在 readMemory / chapterRecap 里不可见；
 * 旧实现只按正文与隐藏标记判权限，correctMemory 会放行 —— 造成「读不到却改得动」的越权缝隙。 */
check('读改一致：秘密对象的承诺不可读也不可改', (engine) => {
  seed(engine, 's5b')
  injectHiddenCharacter(engine, 's5b')
  const s = story(engine, 's5b')
  const hidden = s.commitments.find((c) => c.commitment_id === 'CMT-900002')
  assert.ok(hidden, '夹具应含「对象为秘密实体」的承诺')
  const m = readMemory(s, { accessLevel: 'PLAYER' })
  assert.equal(m.commitments.some((c) => c.id === 'CMT-900002'), false, '秘密对象的承诺不得出现在承诺列表')
  assert.equal(m.goals.some((g) => g.id === 'CMT-900002'), false, '秘密对象的承诺不得出现在未完成目标')
  assert.equal(m.characters.some((c) => c.name === '刺客'), false)
  // 章节回顾与记忆读取共用同一可见性判定，同样不得收录
  const recap = chapterRecap(s, { fromTurn: 1, toTurn: 1 }, { accessLevel: 'PLAYER' })
  assert.equal(recap.excerpts.some((x) => x.id === 'CMT-900002'), false, '回顾不得收录秘密对象的承诺')
  assert.equal(textOf(recap).includes('组织送信'), false)
  // 越权闸门：读不到就改不动（内容本身干净，仍须拒绝）
  assert.throws(() => correctMemory(engine, { storyId: 's5b', kind: 'commitments', id: 'CMT-900002', text: '改写秘密目标', reason: 'x' }), /不可修改/)
  const live = story(engine, 's5b')
  assert.equal((live.memory_corrections || []).length, 0, '越权纠错不得留下记录')
  assert.equal(live.commitments.find((c) => c.commitment_id === 'CMT-900002').content, '替组织送信', '越权纠错不得落库')
  // 关系端点为秘密实体：同样不可读、不可改
  const rel = live.relationships.find((r) => r.relationship_id === 'REL-900002')
  assert.equal(readMemory(live, { accessLevel: 'PLAYER' }).relationships.some((r) => r.id === 'REL-900002'), false)
  assert.throws(() => correctMemory(engine, { storyId: 's5b', kind: 'relationships', id: rel.relationship_id, text: '改成朋友', reason: 'x' }), /不可修改/)
  // 对照：可见承诺仍可正常纠错，证明上面的拒绝来自权限而非入参
  const open = live.commitments.find((c) => c.content.includes('失散的兄长'))
  const ok = correctMemory(engine, { storyId: 's5b', kind: 'commitments', id: open.commitment_id, text: '替露西寻找失散的姐姐', reason: '性别记错' })
  assert.equal(ok.goals.some((g) => g.text.includes('姐姐')), true)
})

// ---- 5. 写盘失败：整体回滚，前端状态不被留在已提交态 ----
check('写盘失败回滚（内存与磁盘保持一致）', (engine) => {
  seed(engine, 's6')
  const fact = story(engine, 's6').facts.find((f) => f.key === 'village_seen')
  const diskBefore = fs.readFileSync(path.join(engine.store.storiesDir, 's6.json'), 'utf8')
  const original = engine.store._atomicWrite
  engine.store._atomicWrite = () => { throw new Error('EPERM: 磁盘写入失败') }
  let error = null
  try { correctMemory(engine, { storyId: 's6', kind: 'facts', id: fact.fact_id, text: '失败的修正', reason: '测试' }) } catch (e) { error = e }
  engine.store._atomicWrite = original
  assert.ok(error && /EPERM/.test(error.message), '写盘失败应抛错：' + (error && error.message))
  const live = story(engine, 's6')
  assert.equal(live.facts.some((f) => f.text === '失败的修正'), false, '内存不得留下半提交')
  assert.equal((live.memory_corrections || []).length, 0, '内存不得留下修正记录')
  assert.equal(engine.store.inTransaction('s6'), false, '事务应已回滚')
  assert.equal(fs.readFileSync(path.join(engine.store.storiesDir, 's6.json'), 'utf8'), diskBefore, '磁盘文件不得被改写')
  assert.equal(readMemory(live).facts.find((f) => f.id === fact.fact_id).text, '露西在村口等玩家')
  // 故障恢复后仍可正常纠错
  const m = correctMemory(engine, { storyId: 's6', kind: 'facts', id: fact.fact_id, text: '恢复后的修正', reason: '重试' })
  assert.equal(m.facts.some((f) => f.text === '恢复后的修正'), true)
})

// ---- 6. 章节回顾：账本原文摘录 + 来源回合 + 范围 ----
check('章节回顾为原文摘录并可按范围定位', (engine) => {
  seed(engine, 's7')
  commit(engine, 's7', { events: [{ type: 'action', description: '玩家在雪地留下脚印', importance: 20 }], facts: [{ key: 'snow', statement: '昨夜下了大雪', importance: 20, entity_names: ['露西'] }] }, '出门')
  const s = story(engine, 's7')
  const all = chapterRecap(s, { fromTurn: 1, toTurn: 2 }, { accessLevel: 'PLAYER' })
  assert.equal(all.source, 'ledger-excerpts')
  assert.equal(all.fromTurn, 1)
  assert.equal(all.toTurn, 2)
  assert.equal(all.excerpts.length >= 3, true, '范围内摘录应包含事件/事实/承诺')
  assert.equal(all.excerpts.every((x) => x.turn >= 1 && x.turn <= 2), true)
  assert.equal(all.excerpts.every((x) => x.source === 'ledger'), true)
  assert.equal(all.note.includes('原文摘录'), true, '必须标明为原文摘录而非 AI 总结')
  assert.equal(textOf(all).includes('密探'), false, '回顾同样不得泄露秘密')
  const only1 = chapterRecap(s, { fromTurn: 1, toTurn: 1 }, { accessLevel: 'PLAYER' })
  assert.equal(only1.excerpts.every((x) => x.turn === 1), true)
  assert.equal(only1.excerpts.some((x) => String(x.text).includes('雪地')), false, '范围外事件不得出现')
  // 回顾可挂进记忆（range 生效）
  const m = readMemory(s, { accessLevel: 'PLAYER', fromTurn: 1, toTurn: 2 })
  assert.ok(m.recap && m.recap.excerpts.length >= 3)
  assert.equal(m.scope.range.toTurn, 2)
  assert.equal(readMemory(s).recap, null, '未给范围时不生成回顾')
  // 纠错后的原文同样进入回顾（含 before/reason）
  const fact = s.facts.find((f) => f.key === 'snow')
  correctMemory(engine, { storyId: 's7', kind: 'facts', id: fact.fact_id, text: '昨夜下了大雪，路被封了', reason: '补充' })
  const after = chapterRecap(story(engine, 's7'), { fromTurn: 1, toTurn: 2 }, { accessLevel: 'PLAYER' })
  const mc = after.excerpts.find((x) => x.kind === 'correction')
  assert.ok(mc, '修正记录应进入回顾')
  assert.equal(mc.before, '昨夜下了大雪')
  assert.equal(mc.reason, '补充')
  assert.ok(mc.sourceTurn >= 1)
})

// ---- 8. 落盘往返：纠错与权限过滤在重开引擎后仍成立 ----
check('落盘往返：修正记录与权限过滤保持', (engine, dir) => {
  seed(engine, 's9')
  const fact = story(engine, 's9').facts.find((f) => f.key === 'village_seen')
  correctMemory(engine, { storyId: 's9', kind: 'facts', id: fact.fact_id, text: '露西在村口（清晨）', reason: '补时间' })
  engine.close()
  const reopened = createEngine(dir)
  try {
    const m = readMemory(reopened.getStory('s9'), { accessLevel: 'PLAYER' })
    assert.equal(m.corrections.length, 1, '修正记录应随世界线落盘')
    assert.equal(m.corrections[0].sourceTurn, fact.turn)
    assert.equal(m.facts.some((f) => f.text.includes('清晨')), true)
    assert.equal(textOf(m).includes('密探'), false, '重开后仍不得泄露秘密')
    assert.equal(m.goals.some((g) => g.text.includes('失散的兄长')), true)
    assert.equal(reopened.getStory('s9').facts.some((f) => f.fact_id === fact.fact_id && f.status === 'SUPERSEDED'), true)
  } finally { try { reopened.close() } catch {} }
})

// ---- 9. 边界：空故事 / 未知 kind / 超大入参 ----
check('边界与容错', (engine) => {
  assert.equal(readMemory(null).facts.length, 0)
  assert.equal(readMemory(null).accessLevel, 'PLAYER')
  assert.equal(chapterRecap(null, { fromTurn: 1, toTurn: 1 }).excerpts.length, 0)
  seed(engine, 's8')
  assert.throws(() => correctMemory(engine, { storyId: 's8', kind: 'facts', id: 'FAC-000001', text: 'x'.repeat(801), reason: 'y' }), /800/)
  assert.throws(() => correctMemory(engine, { storyId: 's8', kind: 'facts', id: 'FAC-000001', text: 'x', reason: 'y'.repeat(301) }), /300/)
  const s = story(engine, 's8')
  const same = s.facts.find((f) => f.key === 'village_seen')
  assert.throws(() => correctMemory(engine, { storyId: 's8', kind: 'facts', id: same.fact_id, text: same.statement, reason: '无变化' }), /相同/)
  assert.equal(readMemory(s, { accessLevel: 'PLAYER' }).scope.turn, 1)
})

const failed = checks.filter((c) => !c.pass)
fs.rmSync(root, { recursive: true, force: true })
console.log('==== ' + checks.length + ' 项：' + (failed.length ? failed.length + ' 失败（' + failed.map((f) => f.name).join('; ') + '）' : '全部通过') + ' ====')
process.exit(failed.length ? 1 : 0)

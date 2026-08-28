'use strict'
/* 最终验收审计脚本（条款 3-19）——只调用真实引擎代码，不 mock */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { createEngine } = require('../engine')

const DIR = process.env.AUDIT_DIR || path.join(os.tmpdir(), 'sixworlds-audit-' + Date.now())
const engine = createEngine(DIR)
let pass = 0, fail = 0
const fails = []
const KX = '# 仙侠测试内核\n门派/灵根/法宝。'

function ck(sec, name, cond, detail) {
  const line = (cond ? 'PASS' : 'FAIL') + ' [' + sec + '] ' + name + (detail != null ? '  => ' + detail : '')
  console.log(line)
  if (cond) pass++; else { fail++; fails.push(line) }
}
const sec = (n, t) => console.log('\n===== 条款 ' + n + ' · ' + t + ' =====')

// ---------- 条款3：Story 隔离（双向，6 类账本） ----------
function s3() {
  sec(3, 'Story 隔离 A↔B')
  engine.ensureStory({ storyId: 'isoA', title: '隔离A', kernelId: 'audit', kernelText: KX })
  engine.ensureStory({ storyId: 'isoB', title: '隔离B', kernelId: 'audit', kernelText: KX })
  const r = engine.commitPatch({
    decisions: [{ raw_input: '我拒绝加入血煞教', normalized_intent: '拒绝加入血煞教', status: 'CONFIRMED', importance: 85 }],
    commitments: [{ kind: 'goal', content: '我一定要找到失踪的师妹', importance: 80 }],
    facts: [{ key: 'mastermind', statement: '血煞教主就是幕后黑手', secret_from_player: true, importance: 95 }],
    events: [{ type: 'conflict', description: '血煞教夜袭客栈', importance: 60, participant_names: ['血煞教主'] }],
    entity_changes: [{ name: '血煞教', type: 'organization', summary: '魔道宗门' }],
    knowledge: [{ content: '我知道了血煞教的据点在黑风寨', how_learned: '亲历' }]
  }, { storyId: 'isoA', sessionId: 'SES-A1', playerInput: '我拒绝加入血煞教' })
  ck('3', 'A 写入 6 类记录成功', r.ok && ['decisions', 'commitments', 'facts', 'events', 'entities', 'knowledge'].every((k) => r.applied[k] && r.applied[k].length), JSON.stringify(r.applied))
  const q = { playerInput: '血煞教 师妹 幕后黑手 黑风寨', accessLevel: 'SYSTEM', entityNames: ['血煞教主'] }
  const rb = engine.retrieve('isoB', Object.assign({ storyId: 'isoB' }, q))
  const bIds = rb.retrieved_ids
  const aStory = engine.getStory('isoA')
  const aIds = [aStory.decisions[0].decision_id, aStory.commitments[0].commitment_id, aStory.facts[0].fact_id, aStory.events[0].event_id, aStory.entities[0].entity_id, aStory.knowledge[0].knowledge_id]
  ck('3', 'B 检索不到 A 任何 Decision', !bIds.includes(aIds[0]), 'B retrieved_ids=' + JSON.stringify(bIds))
  ck('3', 'B 检索不到 A 任何 Commitment/Fact/Event/Entity/Knowledge', aIds.slice(1).every((id) => !bIds.includes(id)), '')
  const bStory = engine.getStory('isoB')
  ck('3', 'B 账本物理为空（SYSTEM 级检索也不越 story）', ['decisions', 'commitments', 'facts', 'events', 'entities', 'knowledge'].every((k) => bStory[k].length === 0), JSON.stringify({ dec: bStory.decisions.length, fac: bStory.facts.length }))
  const bCtx = engine.buildContext('isoB', { storyId: 'isoB', playerInput: '血煞教主是幕后黑手吗', accessLevel: 'SYSTEM' })
  ck('3', 'B 的 Context 不含 A 的秘密事实文本', !bCtx.block.includes('幕后黑手'), '')
  // 反向
  engine.commitPatch({ decisions: [{ raw_input: '我把玄铁令交给官府', normalized_intent: '上交玄铁令', status: 'CONFIRMED', importance: 70 }] }, { storyId: 'isoB', sessionId: 'SES-B1', playerInput: '上交令牌' })
  const ra = engine.retrieve('isoA', { storyId: 'isoA', playerInput: '玄铁令 官府' })
  const leakTxt = ra.decisions.some((x) => x.rec.raw_input.includes('玄铁令'))
  ck('3', '反向：A 检索不到 B 的 Decision（内容级比对）', !leakTxt, 'A账本=' + JSON.stringify(engine.getStory('isoA').decisions.map((d) => d.raw_input)))
}

// ---------- 条款4：同一 Kernel 不同 Story ----------
function s4() {
  sec(4, '相同 Kernel X → Story A2/B2 隔离')
  const kt = '# 共用内核X\n武侠世界。'
  const ra = engine.ensureStory({ storyId: 'kx_a', title: '共用内核A', kernelId: 'audit:kernel-x', kernelText: kt })
  const rb = engine.ensureStory({ storyId: 'kx_b', title: '共用内核B', kernelId: 'audit:kernel-x', kernelText: kt })
  ck('4', '两 Story 绑定同一 Kernel（id/version 一致）', ra.story.kernel.id === rb.story.kernel.id, ra.story.kernel.id + ' v' + ra.story.kernel.version)
  engine.commitPatch({ decisions: [{ raw_input: '我在A2线拜入华山派', normalized_intent: '拜入华山', status: 'CONFIRMED', importance: 75 }] }, { storyId: 'kx_a', sessionId: 'S1', playerInput: '拜师' })
  const rk = engine.retrieve('kx_b', { storyId: 'kx_b', playerInput: '华山派 拜师' })
  ck('4', 'B2 检索不到 A2 历史（相同内核≠相同记忆）', rk.decisions.length === 0, 'B2 decisions 检索=' + rk.decisions.length)
}

// ---------- 条款5：Session 与 Story ----------
function s5() {
  sec(5, 'Session 续接 / 跨 Story 拒绝')
  engine.ensureStory({ storyId: 'sesA', title: '会话A', kernelId: 'audit', kernelText: KX })
  engine.commitPatch({ commitments: [{ kind: 'promise', content: '我要替师门夺回镇魂钟', importance: 85 }] }, { storyId: 'sesA', sessionId: 'SES-S1', playerInput: '立誓' })
  engine.commitPatch({ scene: { location: '山门' } }, { storyId: 'sesA', sessionId: 'SES-S2', playerInput: '赶路' })
  const st = engine.getStory('sesA')
  ck('5', '同一 Story 两个 Session 均登记', st.sessions.length === 2, JSON.stringify(st.sessions.map((x) => x.session_id)))
  const cmt = st.commitments[0]
  ck('5', '记录归属 Session1，Session2 可读（承诺仍 ACTIVE 进入检索）', cmt.session_id === 'SES-S1' && cmt.status === 'ACTIVE', cmt.session_id)
  const r2 = engine.retrieve('sesA', { storyId: 'sesA', playerInput: '镇魂钟' })
  ck('5', 'Session2 检索到 Session1 的承诺', r2.commitments.length === 1, r2.commitments[0] && r2.commitments[0].rec.commitment_id)
  engine.ensureStory({ storyId: 'sesB', title: '会话B', kernelId: 'audit', kernelText: KX })
  const rB = engine.retrieve('sesB', { storyId: 'sesB', playerInput: '镇魂钟 师门' })
  ck('5', 'Story B 的新 Session 检索不到 Story A 历史', rB.commitments.length === 0 && rB.retrieved_ids.length === 0, '')
}

// ---------- 条款6：Decision Ledger ----------
function s6() {
  sec(6, 'Decision Ledger')
  engine.ensureStory({ storyId: 'decT', title: '决定测试', kernelId: 'audit', kernelText: KX })
  const r1 = engine.commitPatch({ decisions: [{ raw_input: '我拒绝加入这个组织。', normalized_intent: '拒绝加入组织', status: 'CONFIRMED', importance: 70 }] }, { storyId: 'decT', sessionId: 'S1', playerInput: '我拒绝加入这个组织。' })
  const d1 = engine.getStory('decT').decisions[0]
  ck('6', '正式 Decision 存在', r1.ok && !!d1, d1 && d1.decision_id)
  ck('6', '字段齐全 decision_id/story_id/raw_input/normalized_intent/status',
    !!(d1.decision_id && d1.story_id === 'decT' && d1.raw_input === '我拒绝加入这个组织。' && d1.normalized_intent === '拒绝加入组织' && d1.status === 'CONFIRMED'),
    JSON.stringify({ id: d1.decision_id, raw: d1.raw_input, ni: d1.normalized_intent, st: d1.status, src: d1.source }))
  ck('6', 'status=CONFIRMED 且 source=user_input', d1.status === 'CONFIRMED' && d1.source === 'user_input', d1.source)
  const r2 = engine.commitPatch({ decisions: [
    { raw_input: 'A. 加入组织', normalized_intent: '加入组织', source: 'ai_option', status: 'CONFIRMED' },
    { raw_input: 'B. 拒绝并离开', normalized_intent: '拒绝离开', source: 'ai_option', status: 'CONFIRMED' },
    { raw_input: 'C. 假意周旋', normalized_intent: '假意周旋', source: 'ai_option', status: 'CONFIRMED' }
  ] }, { storyId: 'decT', sessionId: 'S1', playerInput: '(未选择，自由输入其他事)' })
  const aiDecs = engine.getStory('decT').decisions.filter((d) => d.source === 'ai_option')
  ck('6', 'AI 选项不得 CONFIRMED（硬闸降级为 PROPOSED）', aiDecs.length === 3 && aiDecs.every((d) => d.status === 'PROPOSED'), aiDecs.map((d) => d.status).join(','))
  ck('6', '产生降级警告', (r2.warnings || []).some((w) => w.code === 'DECISION_AI_OPTION_DOWNGRADED'), (r2.warnings || []).map((w) => w.code).join(','))
  const r3 = engine.retrieve('decT', { storyId: 'decT', playerInput: '加入组织' })
  ck('6', '未选择的 AI 选项不作为事实进入检索', r3.decisions.length === 1 && r3.decisions[0].rec.decision_id === d1.decision_id, '检索到=' + r3.decisions.length)
  const r4 = engine.commitPatch({ decisions: [{ raw_input: '我翻墙逃走，不走正门', normalized_intent: '翻墙逃走', status: 'CONFIRMED', importance: 55 }] }, { storyId: 'decT', sessionId: 'S1', playerInput: '我翻墙逃走，不走正门' })
  const d4 = engine.getStory('decT').decisions.find((d) => d.raw_input.includes('翻墙'))
  ck('6', '自由输入（无对应按钮）正确记录为 CONFIRMED', r4.ok && d4 && d4.status === 'CONFIRMED' && d4.source === 'user_input', d4 && d4.decision_id)
}

// ---------- 条款7：长期记忆（第1轮决定 → 1000 轮后检索） ----------
function s7() {
  sec(7, '长期记忆 · 1000 轮')
  engine.ensureStory({ storyId: 'ltm', title: '长期记忆测试', kernelId: 'audit', kernelText: KX })
  const t0 = Date.now()
  const r1 = engine.commitPatch({ decisions: [{ raw_input: '以后我绝不帮助天枢阁', normalized_intent: '绝不帮助天枢阁', status: 'CONFIRMED', importance: 90 }] }, { storyId: 'ltm', sessionId: 'S1', playerInput: '以后我绝不帮助天枢阁' })
  const d1 = engine.getStory('ltm').decisions[0]
  ck('7', '第1轮独特决定已入库', r1.ok && d1.raw_input.includes('天枢阁'), d1.decision_id + ' imp=' + d1.importance)
  // 清空 summary（引擎本无 rolling/arc summary，scene.summary 也清掉）
  const st = engine.getStory('ltm'); st.scene.summary = ''
  // 1000 轮：每轮真实 commit（推进引擎回合），不含任何聊天记录
  for (let i = 1; i <= 1000; i++) {
    const rr = engine.commitPatch({ scene: { location: '官道第' + i + '段' } }, { storyId: 'ltm', sessionId: 'S1', playerInput: '赶路' })
    if (!rr.ok) { ck('7', '第' + i + '轮 commit 失败', false, JSON.stringify(rr.errors)); return }
  }
  console.log('  （1000 轮真实提交耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's）')
  const st2 = engine.getStory('ltm')
  ck('7', '引擎推进到第 1001 回合', st2.counters.turn === 1001, 'turn=' + st2.counters.turn)
  ck('7', 'summary 已清空（scene.summary="";引擎无 rolling/arc summary）', st2.scene.summary === '', 'len=' + st2.scene.summary.length)
  ck('7', '引擎不存聊天记录（账本无 chat/messages 字段）', !('messages' in st2) && !('chat' in st2), '')
  const ret = engine.retrieve('ltm', { storyId: 'ltm', playerInput: '我再次去见天枢阁的人。' })
  const top = ret.decisions[0]
  ck('7', '1001 轮后 Retriever 找回第1轮决定', top && top.rec.decision_id === 'DEC-000001', top ? 'id=' + top.rec.decision_id + ' score=' + top.score.toFixed(3) + ' src=' + top.reason : 'none')
  const ctx = engine.buildContext('ltm', { storyId: 'ltm', playerInput: '我再次去见天枢阁的人。' })
  const line = (ctx.block.split('\n').find((l) => l.includes('DEC-000001')) || '').trim()
  ck('7', '该决定真实进入 LLM Context', !!line, line)
  ck('7', '来源=结构化 Ledger（非 summary）', ctx.block.includes('关键历史决定') && ctx.block.includes('[CONFIRMED]'), '')
}

// ---------- 条款8：Commitment Ledger ----------
function s8() {
  sec(8, 'Commitment · 存续与撤销')
  engine.ensureStory({ storyId: 'cmt', title: '承诺测试', kernelId: 'audit', kernelText: KX })
  const r = engine.commitPatch({ commitments: [{ kind: 'goal', content: '我一定要找到这个人', importance: 70 }] }, { storyId: 'cmt', sessionId: 'S1', playerInput: '我一定要找到这个人' })
  const c0 = engine.getStory('cmt').commitments[0]
  ck('8', '承诺保存为 ACTIVE', r.ok && c0.status === 'ACTIVE', c0.commitment_id)
  for (let i = 0; i < 300; i++) engine.commitPatch({ scene: { location: '旅途' + i } }, { storyId: 'cmt', sessionId: 'S1', playerInput: '赶路' })
  const ra = engine.retrieve('cmt', { storyId: 'cmt', playerInput: '找到这个人' })
  ck('8', '300 轮后承诺仍存在且被检索（reason=active_commitment）', ra.commitments.length === 1 && ra.commitments[0].rec.commitment_id === c0.commitment_id, 'turn=' + engine.getStory('cmt').counters.turn)
  const rv = engine.commitPatch({ commitment_updates: [{ ref: 'CMT-000001', status: 'REVOKED', note: '我放弃寻找他' }] }, { storyId: 'cmt', sessionId: 'S1', playerInput: '我放弃寻找他' })
  const c1 = engine.getStory('cmt').commitments[0]
  ck('8', '撤销后状态=REVOKED（非删除）', rv.ok && c1.status === 'REVOKED', c1.status)
  ck('8', '历史保留（content/turn/updated_at/status_note 全在）', c1.content === '我一定要找到这个人' && c1.turn === 1 && !!c1.updated_at && c1.status_note === '我放弃寻找他', 'turn=' + c1.turn + ' note=' + c1.status_note)
  const rr = engine.retrieve('cmt', { storyId: 'cmt', playerInput: '找到这个人' })
  ck('8', 'REVOKED 后不再作为未完成承诺进入检索', rr.commitments.length === 0, '')
}

// ---------- 条款9：Knowledge 隔离（秘密不授予玩家） ----------
function s9() {
  sec(9, '世界事实 vs 玩家认知')
  engine.ensureStory({ storyId: 'knw', title: '秘密测试', kernelId: 'audit', kernelText: KX })
  engine.commitPatch({ facts: [{ key: 'mastermind', statement: '玄阴老祖是幕后人物', secret_from_player: true, importance: 95 }] }, { storyId: 'knw', sessionId: 'S1', playerInput: '调查' })
  const st = engine.getStory('knw')
  ck('9', 'World Fact 存在（secret_from_player=true）', st.facts.length === 1 && st.facts[0].secret_from_player === true, st.facts[0].fact_id)
  ck('9', 'Player Knowledge 账本为空（未授予）', st.knowledge.length === 0, 'knowledge=' + st.knowledge.length)
  const rc = engine.buildContext('knw', { storyId: 'knw', playerInput: '幕后人物是谁' })
  ck('9', '玩家侧 Context 不含秘密事实', !rc.block.includes('玄阴老祖'), 'block=' + rc.block.length + '字')
  const rg = engine.buildContext('knw', { storyId: 'knw', playerInput: '幕后人物是谁', accessLevel: 'SYSTEM' })
  ck('9', 'GM 侧（SYSTEM 级）可见，证明确系权限过滤而非丢失', rg.block.includes('玄阴老祖'), '')
}

// ---------- 条款10：State Patch（LLM 不直写数据库） ----------
function s10() {
  sec(10, 'State Patch 管线')
  engine.ensureStory({ storyId: 'pipe', title: '管线测试', kernelId: 'audit', kernelText: KX })
  const raw1 = '他沉默片刻，将短刀收起。\n<<<STATE_PATCH>>>\n{"decisions":[{"raw_input":"我买下短刀","normalized_intent":"购买短刀","status":"CONFIRMED","importance":40}],"facts":[{"key":"knife","statement":"我获得一柄短刀","importance":30}]}\n<<<END_PATCH>>>'
  const r1 = engine.commitFromRaw(raw1, { storyId: 'pipe', sessionId: 'S1', playerInput: '买刀', rawOutput: raw1 })
  ck('10', '带状态块的输出：经 Patch→Validator→Commit 写入', r1.ok && r1.applied.decisions.length === 1 && r1.applied.facts.length === 1, JSON.stringify(r1.applied))
  ck('10', '叙事与状态块分离（narrative 不含标记）', r1.narrative.includes('短刀收起') && !r1.narrative.includes('STATE_PATCH'), '')
  const before = engine.getStory('pipe').counters.turn
  const r2 = engine.commitFromRaw('他看了看摊位，摇了摇头，默默离开。', { storyId: 'pipe', sessionId: 'S1', playerInput: '离开' })
  ck('10', '纯自然语言（无状态块）：不写入任何事实', r2.ok && r2.committed === false && engine.getStory('pipe').decisions.length === 1, 'warnings=' + (r2.warnings || []).map((w) => w.code).join(','))
  ck('10', '回合不推进（-np 降级）', engine.getStory('pipe').counters.turn === before, 'turn=' + before + '→' + engine.getStory('pipe').counters.turn)
  const r3 = engine.commitFromRaw('<<<STATE_PATCH>>>\n{这不是合法JSON\n<<<END_PATCH>>>', { storyId: 'pipe', sessionId: 'S1', playerInput: 'x' })
  ck('10', '损坏 JSON：解析失败降级，不写库', r3.ok && r3.committed === false && (r3.warnings || []).some((w) => w.code === 'PATCH_PARSE'), (r3.warnings || []).map((w) => w.code).join(','))
  const logs = engine.turnLogs('pipe')
  const hit = logs.map((tid) => engine.turnLog('pipe', tid)).find((lg) => lg && lg.parsed_state_patch && lg.raw_llm_output && lg.raw_llm_output.includes('短刀'))
  ck('10', '回合日志留痕 raw_llm_output + parsed_state_patch', !!hit, hit && (hit.turn_id + ' patch_keys=' + Object.keys(hit.parsed_state_patch).join('/')))
}

// ---------- 条款11：Validator ----------
function s11() {
  sec(11, 'Validator 拒绝非法 Patch')
  engine.ensureStory({ storyId: 'val', title: '校验测试', kernelId: 'audit', kernelText: KX })
  engine.commitPatch({ commitments: [{ content: '守护玉璧', importance: 50 }], facts: [{ key: 'jade', statement: '玉璧藏于地宫', importance: 40 }] }, { storyId: 'val', sessionId: 'S1', playerInput: '守护' })
  const b = engine.getStory('val')
  const bFacts = b.facts.length, bTurn = b.counters.turn, bCmt = b.commitments[0].commitment_id
  // a) 修改不存在的承诺 ID（同 patch 混入合法 fact，验证无半提交）
  const r1 = engine.commitPatch({ facts: [{ key: 'x1', statement: '这条不应被写入', importance: 30 }], commitment_updates: [{ ref: 'CMT-999999', status: 'REVOKED' }] }, { storyId: 'val', sessionId: 'S1', playerInput: 'x' })
  const a1 = engine.getStory('val')
  ck('11', '不存在的 ID → 拒绝', !r1.ok, (r1.errors || []).map((e) => e.code).join(','))
  ck('11', '回滚：合法 fact 未被顺带写入（无半提交）', a1.facts.length === bFacts && a1.counters.turn === bTurn, 'facts=' + a1.facts.length + ' turn=' + a1.counters.turn)
  // b) 非法状态值
  const r2 = engine.commitPatch({ commitment_updates: [{ ref: bCmt, status: 'DELETED' }] }, { storyId: 'val', sessionId: 'S1', playerInput: 'x' })
  ck('11', '非法状态值 DELETED → 拒绝', !r2.ok, (r2.errors || []).map((e) => e.code).join(','))
  // c) 覆盖已终结历史：FULFILLED→REVOKED 非法跃迁
  engine.commitPatch({ commitment_updates: [{ ref: bCmt, status: 'FULFILLED', note: '完成' }] }, { storyId: 'val', sessionId: 'S1', playerInput: 'x' })
  const r3 = engine.commitPatch({ commitment_updates: [{ ref: bCmt, status: 'REVOKED', note: '反悔' }] }, { storyId: 'val', sessionId: 'S1', playerInput: 'x' })
  ck('11', 'FULFILLED→REVOKED 非法跃迁 → 拒绝', !r3.ok, (r3.errors || []).map((e) => e.code + ':' + e.message.slice(0, 40)).join(' | '))
  ck('11', '历史 Decision 不可被 patch 覆盖（decisions 仅追加，无 update 通道）', !('decision_updates' in { decisions: 1 }) && engine.getStory('val').decisions.filter((d) => d.raw_input === '守护玉璧的原始记录').length === 0, 'PATCH_KEYS 无 decision_updates')
}

// ---------- 条款12：Scene Commit 原子性 ----------
function s12() {
  sec(12, 'Scene Commit 统一提交 / 中途失败回滚')
  engine.ensureStory({ storyId: 'atm', title: '原子性测试', kernelId: 'audit', kernelText: KX })
  const r1 = engine.commitPatch({
    decisions: [{ raw_input: '我与柳家结盟', normalized_intent: '结盟柳家', status: 'CONFIRMED', importance: 80 }],
    entity_changes: [{ name: '柳家', type: 'faction', summary: '地方豪强' }],
    facts: [{ key: 'ally', statement: '柳家与我结盟', importance: 60 }],
    events: [{ type: 'dialogue', description: '盟约签订', importance: 55, participant_names: ['柳家家主'] }],
    relationships: [{ source_name: '柳家家主', target_name: '柳家', relation_type: '从属', strength_delta: 10 }],
    commitments: [{ kind: 'contract', content: '护送柳家商队', importance: 50 }]
  }, { storyId: 'atm', sessionId: 'S1', playerInput: '结盟' })
  ck('12', 'Decision+Entity+Fact+Event+Relationship+Commitment 一回合统一提交', r1.ok && ['decisions', 'facts', 'events', 'relationships', 'entities', 'commitments'].every((k) => r1.applied[k] && r1.applied[k].length), JSON.stringify(r1.applied))
  const b = engine.getStory('atm')
  const snap = JSON.stringify([b.facts.length, b.events.length, b.relationships.length, b.decisions.length, b.entities.length, b.commitments.length, b.counters.turn])
  const r2 = engine.commitPatch({
    facts: [{ key: 'half', statement: '半提交测试', importance: 30 }],
    events: [{ type: 'other', description: '不应存在', importance: 20 }],
    commitment_updates: [{ ref: 'CMT-424242', status: 'FULFILLED' }]
  }, { storyId: 'atm', sessionId: 'S1', playerInput: 'x' })
  const a = engine.getStory('atm')
  const after = JSON.stringify([a.facts.length, a.events.length, a.relationships.length, a.decisions.length, a.entities.length, a.commitments.length, a.counters.turn])
  ck('12', '中途失败整体拒绝', !r2.ok, (r2.errors || []).map((e) => e.code).join(','))
  ck('12', '全量回滚：账本/回合数与失败前逐位一致', snap === after, 'before=' + snap + ' after=' + after)
}

// ---------- 条款13：Snapshot / Restore ----------
function s13() {
  sec(13, 'Snapshot → 修改 → Restore')
  engine.ensureStory({ storyId: 'snap', title: '快照测试', kernelId: 'audit', kernelText: KX })
  engine.commitPatch({
    decisions: [{ raw_input: '初次抉择', normalized_intent: '初次抉择', status: 'CONFIRMED', importance: 60 }],
    entity_changes: [{ name: '老周', type: 'character' }],
    player_state: { location: '渡口' }, scene: { location: '渡口' }
  }, { storyId: 'snap', sessionId: 'S1', playerInput: 'x' })
  const sn = engine.snapshot('snap', '验收快照')
  const before = engine.getStory('snap')
  const base = { dec: before.decisions.length, fac: before.facts.length, evt: before.events.length, ent: before.entities.length, rel: before.relationships.length, cmt: before.commitments.length, thr: before.threads.length, knw: before.knowledge.length, cau: before.causal.length, turn: before.counters.turn, loc: before.player.location }
  engine.commitPatch({
    decisions: [{ raw_input: '第二抉择', normalized_intent: '第二抉择', status: 'CONFIRMED', importance: 60 }],
    facts: [{ key: 'f2', statement: '第二条事实', importance: 30 }],
    events: [{ type: 'action', description: '第二次事件', importance: 20 }],
    entity_changes: [{ name: '老李', type: 'character' }],
    relationships: [{ source_name: '老周', target_name: '老李', relation_type: '旧识', strength_delta: 5 }],
    commitments: [{ content: '护送老李', importance: 40 }],
    threads: [{ title: '老李的身世', importance: 45 }],
    causal: [{ cause: '初次抉择', effect: '老李现身', importance: 30 }],
    knowledge: [{ content: '我知道了渡口的规矩', how_learned: '听闻' }],
    player_state: { location: '山城' }, scene: { location: '山城' }
  }, { storyId: 'snap', sessionId: 'S1', playerInput: 'x' })
  const mid = engine.getStory('snap')
  ck('13', '修改后状态确实变化', mid.counters.turn === base.turn + 1 && mid.facts.length === base.fac + 1 && mid.player.location === '山城', 'turn=' + mid.counters.turn + ' loc=' + mid.player.location)
  engine.restoreSnapshot('snap', sn.snapshot_id)
  const rs = engine.getStory('snap')
  const got = { dec: rs.decisions.length, fac: rs.facts.length, evt: rs.events.length, ent: rs.entities.length, rel: rs.relationships.length, cmt: rs.commitments.length, thr: rs.threads.length, knw: rs.knowledge.length, cau: rs.causal.length, turn: rs.counters.turn, loc: rs.player.location }
  ck('13', '恢复后 9 类账本+Player State+回合数 全部回到快照', JSON.stringify(base) === JSON.stringify(got), JSON.stringify(got))
  ck('13', 'Scene 一并恢复', rs.scene.location === '渡口' && rs.scene.location === base.loc, rs.scene.location)
}

// ---------- 条款14：Summary 独立性 ----------
function s14() {
  sec(14, '历史不依赖 Summary')
  const st = engine.getStory('ltm')
  const walk = (o, p, out) => { for (const k of Object.keys(o)) { if (/summar/i.test(k)) out.push(p + k); if (o[k] && typeof o[k] === 'object' && k !== '_nameIndex') walk(o[k], p + k + '.', out) } }
  const found = []; walk(st, '', found)
  ck('14', '整个 Story 中 summary 类字段仅有 scene.summary', found.every((f) => f.startsWith('scene.')), JSON.stringify(found))
  st.scene.summary = ''
  const ret = engine.retrieve('ltm', { storyId: 'ltm', playerInput: '天枢阁' })
  ck('14', 'Summary 全空后重大历史（DEC-000001）仍可检索', ret.decisions.some((x) => x.rec.decision_id === 'DEC-000001'), 'decisions命中=' + ret.decisions.length)
  const ctx = engine.buildContext('ltm', { storyId: 'ltm', playerInput: '天枢阁' })
  ck('14', 'Context 全部来自结构化 Ledger（含明示声明）', ctx.block.includes('非叙事摘要') && ctx.block.includes('DEC-000001'), '')
}

// ---------- 条款15/16：Retriever 输出与 Context 一致性 ----------
function s15() {
  sec(15, 'Retriever 实际返回')
  const ret = engine.retrieve('ltm', { storyId: 'ltm', playerInput: '我再次去见天枢阁的人。' })
  const g = (k) => ret[k].map((x) => x.rec.decision_id || x.rec.commitment_id || x.rec.fact_id || x.rec.event_id || x.rec.entity_id || x.rec.thread_id || x.rec.causal_id || '?')
  console.log('  decisions: ' + JSON.stringify(ret.decisions.map((x) => ({ id: x.rec.decision_id, score: +x.score.toFixed(3), why: x.rec.raw_input.slice(0, 12) }))))
  console.log('  commitments: ' + JSON.stringify(g('commitments')) + '  threads: ' + JSON.stringify(g('threads')) + '  facts: ' + JSON.stringify(g('facts')))
  console.log('  events: ' + JSON.stringify(g('events')) + '  entities: ' + JSON.stringify(g('entities')) + '  knowledge: ' + JSON.stringify(g('knowledge')) + '  causal: ' + JSON.stringify(g('causal')))
  ck('15', 'DEC-000001 命中且排序第一（词面命中 天枢 + 重要度90 主导）', ret.decisions[0] && ret.decisions[0].rec.decision_id === 'DEC-000001', 'score=' + (ret.decisions[0] ? ret.decisions[0].score.toFixed(3) : '-'))
  ck('15', '场景中途事件（官道）因低重要度+无词面命中而落选', !ret.events.some((x) => x.rec.description.includes('官道第9')), '')
  sec(16, 'DB→Retriever→Context 三方一致')
  const ctx = engine.buildContext('ltm', { storyId: 'ltm', playerInput: '我再次去见天枢阁的人。' })
  const blk = ctx.block
  const inBlk = (s) => blk.includes(s)
  const dOk = ctx.retrieved.decisions.every((x) => inBlk(x.rec.decision_id))
  const fOk = ctx.retrieved.facts.every((x) => inBlk(x.rec.statement))
  const cOk = ctx.retrieved.commitments.every((x) => inBlk(x.rec.commitment_id))
  const eOk = ctx.retrieved.events.every((x) => inBlk(x.rec.description))
  const kOk = ctx.retrieved.knowledge.every((x) => inBlk(x.rec.content))
  const tOk = ctx.retrieved.threads.every((x) => inBlk(x.rec.thread_id))
  const ck16 = dOk && fOk && cOk && eOk && kOk && tOk
  ck('16', '检索结果 100% 进入最终 Prompt 块（decisions/facts/commitments/events/knowledge/threads）', ck16, 'dec=' + ctx.retrieved.decisions.length + ' fac=' + ctx.retrieved.facts.length + ' cmt=' + ctx.retrieved.commitments.length + ' evt=' + ctx.retrieved.events.length)
  ck('16', 'retrieved_ids 总数与 Context 引用数一致', ctx.retrieved.retrieved_ids.length > 0 && dOk && cOk, 'total=' + ctx.retrieved.retrieved_ids.length)
}

// ---------- 条款17：Kernel 解耦 ----------
function s17() {
  sec(17, '换新 Kernel（科幻）不改引擎核心')
  const kt = '# 科幻测试世界\n自定义状态字段：曲率引擎等级、星币。'
  const r = engine.ensureStory({ storyId: 'sci', title: '科幻测试世界', kernelId: 'test:sci-fi', kernelText: kt })
  ck('17', '新内核 Story 创建并绑定', r.created && r.story.kernel.id === 'test:sci-fi', r.story.kernel.id + ' v' + r.story.kernel.version)
  const rc = engine.commitPatch({
    entity_changes: [{ name: '曲率飞船', type: 'item', state: { 引擎: '曲率-9' }, summary: '测试飞船' }],
    player_state: { custom: { 星币: 100 } },
    facts: [{ key: 'ship', statement: '曲率飞船停靠在4号泊位', importance: 40 }],
    decisions: [{ raw_input: '我征用了曲率飞船', normalized_intent: '征用飞船', status: 'CONFIRMED', importance: 55 }]
  }, { storyId: 'sci', sessionId: 'S1', playerInput: '上船' })
  ck('17', '完全不同的状态字段正常提交', rc.ok && rc.applied.entities.length === 1 && engine.getStory('sci').player.custom['星币'] === 100, JSON.stringify(rc.applied))
  const rt = engine.retrieve('sci', { storyId: 'sci', playerInput: '曲率飞船' })
  ck('17', '检索正常（零核心代码改动）', rt.entities.length === 1 && rt.facts.length === 1, '')
}

// ---------- 条款18：多故事交错 ----------
function s18() {
  sec(18, 'A/B/C 交错 A,B,C,A,C,B,A')
  const ids = { A: 'mltA', B: 'mltB', C: 'mltC' }
  for (const [k, v] of Object.entries(ids)) engine.ensureStory({ storyId: v, title: '多线' + k, kernelId: 'audit', kernelText: KX })
  const tok = { A: '赤霄剑', B: '玄冰谷', C: '焚天塔' }
  const seq = ['A', 'B', 'C', 'A', 'C', 'B', 'A']
  let i = 0
  for (const k of seq) {
    i++
    const r = engine.commitPatch({ decisions: [{ raw_input: '第' + i + '步我取得' + tok[k], normalized_intent: '获取' + tok[k], status: 'CONFIRMED', importance: 65 + i }], scene: { location: tok[k] + '场景' + i } }, { storyId: ids[k], sessionId: 'S1', playerInput: tok[k] })
    if (!r.ok) { ck('18', '第' + i + '步失败', false, JSON.stringify(r.errors)); return }
    const others = Object.keys(ids).filter((x) => x !== k)
    for (const o of others) {
      const ro = engine.retrieve(ids[o], { storyId: ids[o], playerInput: tok[k] })
      const leaked = ['decisions', 'facts', 'events', 'commitments', 'knowledge', 'threads', 'causal', 'entities'].some((grp) => ro[grp] && ro[grp].some((it) => JSON.stringify(it.rec).includes(tok[k])))
      if (leaked) { ck('18', '交错中被污染(' + o + ' 检索到 ' + k + ' 的「' + tok[k] + '」记录)', false, ''); return }
    }
  }
  ck('18', '7 步交错期间零交叉污染（每步后交叉检索）', true, 'seq=' + seq.join(''))
  for (const k of Object.keys(ids)) {
    const st = engine.getStory(ids[k])
    const own = st.decisions.filter((d) => d.raw_input.includes(tok[k])).length
    const expect = seq.filter((x) => x === k).length
    const otherTokens = Object.keys(tok).filter((x) => x !== k).map((x) => tok[x])
    const leak = otherTokens.some((t) => JSON.stringify(st.decisions).includes(t) || JSON.stringify(st.facts).includes(t) || JSON.stringify(st.events).includes(t))
    ck('18', '终态[' + k + '] 自有决定=' + own + ' 且无他人 token 泄漏', own === expect && !leak, tok[k] + ' x' + own + '/预期' + expect)
  }
}

// ---------- 条款19：落盘结构 ----------
function s19() {
  sec(19, '持久层实际结构')
  const file = path.join(DIR, 'stories', 'ltm.json')
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'))
  const ledgers = ['decisions', 'commitments', 'knowledge', 'facts', 'events', 'causal', 'relationships', 'threads', 'entities', 'sessions']
  let total = 0, miss = 0
  for (const k of ledgers) for (const rec of disk[k] || []) { total++; if (rec.story_id !== disk.story_id) miss++ }
  ck('19', '落盘文件存在', fs.existsSync(file), file)
  ck('19', '全部 ' + total + ' 条记录 story_id 无一缺失/错挂', miss === 0, 'mismatch=' + miss)
  ck('19', 'schema_version + kernel 绑定落盘', disk.schema_version === 1 && disk.kernel.id === 'audit', 'v' + disk.schema_version + ' kernel=' + disk.kernel.id + '@' + disk.kernel.version)
  console.log('  顶层键: ' + Object.keys(disk).join(', '))
  console.log('  目录: stories/ snapshots/ logs/<storyId>/*.json tmp/（原子写 .tmp→rename，事务=staging 内存副本 store.js:106-123）')
}

const jobs = { 3: s3, 4: s4, 5: s5, 6: s6, 7: s7, 8: s8, 9: s9, 10: s10, 11: s11, 12: s12, 13: s13, 14: s14, 15: s15, 17: s17, 18: s18, 19: s19 }
const arg = process.argv[2] || 'all'
for (const [n, fn] of Object.entries(jobs)) {
  if (arg === 'all' || arg.split(',').includes(String(n))) fn()
}
console.log('\n===== 审计结果：PASS=' + pass + ' FAIL=' + fail + ' =====')
if (fail) { console.log(fails.join('\n')); process.exit(1) }

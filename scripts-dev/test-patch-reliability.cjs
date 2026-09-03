'use strict'
/* State Patch 可靠性自动化测试（条款 32 测试 1-9；测试 10 在 test-engine-e2e.cjs）
 * 运行：node scripts-dev/test-patch-reliability.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) pass++
  else fail++
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond ? '' : '  << ' + JSON.stringify(extra).slice(0, 400)))
}
const wrap = (patch) => '叙事正文。\n<<<STATE_PATCH>>>\n' + JSON.stringify(patch) + '\n<<<END_PATCH>>>'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-patch-test-'))
const engine = createEngine(tmp)
const KERNEL = '可靠性测试内核。'

// ============ 测试 1：LLM 返回正常 Patch → COMMITTED ============
{
  engine.ensureStory({ storyId: 'pr1', title: 'T1', kernelId: 'k', kernelText: KERNEL })
  const r = engine.commitFromRaw(wrap({
    turn_summary: '拾取钥匙',
    decisions: [{ raw_input: '拿起钥匙', normalized_intent: '拾取钥匙', importance: 50, source: 'user_input' }],
    facts: [{ key: 'has_key', statement: '玩家拿到了铜钥匙', importance: 60 }]
  }), { storyId: 'pr1', sessionId: 'SES-p1', playerInput: '拿起钥匙' })
  check('t1: committed=true', r.ok && r.committed === true, { status: r.patch_status, errors: r.errors })
  check('t1: patch_status=PATCH_PRESENT', r.patch_status === 'PATCH_PRESENT')
  check('t1: 引擎回合推进', engine.getStory('pr1').counters.turn === 1)
}

// ============ 测试 2：第一次无 Patch → PATCH_MISSING；Retry 后合法 → COMMITTED ============
{
  engine.ensureStory({ storyId: 'pr2', title: 'T2', kernelId: 'k', kernelText: KERNEL })
  // 第一次：纯叙事，无协议块，无 NO_STATE_CHANGE
  const r1 = engine.commitFromRaw('你推开了酒馆的门。', { storyId: 'pr2', sessionId: 'SES-p2', playerInput: '走进酒馆' })
  check('t2: 首次 patch_status=PATCH_MISSING', r1.patch_status === 'PATCH_MISSING', r1)
  check('t2: 未提交、回合未推进', r1.committed === false && engine.getStory('pr2').counters.turn === 0)
  check('t2: 带 retryable 标记', r1.retryable === true)
  // 模拟重试：只补状态块
  const r2 = engine.commitFromRaw(wrap({
    turn_summary: '进入酒馆',
    scene: { location: '酒馆' },
    events: [{ type: 'arrival', description: '玩家走进酒馆', importance: 30 }]
  }), { storyId: 'pr2', sessionId: 'SES-p2', playerInput: '走进酒馆' })
  check('t2: 重试后 committed=true', r2.ok && r2.committed === true && r2.patch_status === 'PATCH_PRESENT', r2.errors)
  check('t2: 回合推进到 1', engine.getStory('pr2').counters.turn === 1)
}

// ============ 测试 3：两次都没有 Patch → PENDING_COMMIT（不能正常结束） ============
{
  engine.ensureStory({ storyId: 'pr3', title: 'T3', kernelId: 'k', kernelText: KERNEL })
  const r1 = engine.commitFromRaw('风起。', { storyId: 'pr3', sessionId: 'SES-p3', playerInput: '看天' })
  const pc = engine.recordPending({ storyId: 'pr3', sessionId: 'SES-p3', playerInput: '看天', narrative: r1.narrative, patchError: r1.patch_status, retryCount: 0, turnId: r1.turn_id })
  check('t3: Pending 已落盘', pc && pc.pending_id === 'PC-000001' && pc.status === 'PENDING_COMMIT')
  check('t3: 字段齐全（条款 19）', ['pending_id', 'story_id', 'session_id', 'player_input', 'narrative', 'patch_error', 'retry_count', 'current_state_version', 'created_at'].every((k) => pc[k] !== undefined))
  check('t3: listPendings 可见', engine.listPendings('pr3').length === 1)
}

// ============ 测试 4：NO_STATE_CHANGE 标记 → 正常结束（无警告、非静默猜测） ============
{
  engine.ensureStory({ storyId: 'pr4', title: 'T4', kernelId: 'k', kernelText: KERNEL })
  const r = engine.commitFromRaw('“哈哈。”\n“确实有点意思。”\n<<<NO_STATE_CHANGE>>>', { storyId: 'pr4', sessionId: 'SES-p4', playerInput: '哈哈' })
  check('t4: patch_status=NO_STATE_CHANGE', r.patch_status === 'NO_STATE_CHANGE')
  check('t4: ok=true 且无错误警告', r.ok === true && r.committed === false && r.errors.length === 0 && r.warnings.length === 0)
  check('t4: 标记已从叙事剥离', !r.narrative.includes('NO_STATE_CHANGE') && r.narrative.includes('确实有点意思'))
  check('t4: 回合未推进', engine.getStory('pr4').counters.turn === 0)
  check('t4: 非 PATCH_MISSING（不触发重试语义）', r.patch_status !== 'PATCH_MISSING' && !r.retryable)
}

// ============ 测试 5：非法 JSON → PATCH_INVALID；Retry 后合法 → COMMITTED ============
{
  engine.ensureStory({ storyId: 'pr5', title: 'T5', kernelId: 'k', kernelText: KERNEL })
  const bad = '叙事。\n<<<STATE_PATCH>>>\n{"decisions": [ <<-坏JSON\n<<<END_PATCH>>>'
  const r1 = engine.commitFromRaw(bad, { storyId: 'pr5', sessionId: 'SES-p5', playerInput: '尝试记录' })
  check('t5: patch_status=PATCH_INVALID', r1.patch_status === 'PATCH_INVALID', r1.patch_status)
  check('t5: 未提交', r1.committed === false && engine.getStory('pr5').counters.turn === 0)
  const r2 = engine.commitFromRaw(wrap({ turn_summary: '重试成功', knowledge: [{ content: '得知酒馆地下有密道', how_learned: 'told_by' }] }), { storyId: 'pr5', sessionId: 'SES-p5', playerInput: '尝试记录' })
  check('t5: 重试后 committed=true', r2.ok && r2.committed === true, r2.errors)
}

// ============ 测试 6：与历史冲突的 Patch → Validator 拒绝 ============
{
  engine.ensureStory({ storyId: 'pr6', title: 'T6', kernelId: 'k', kernelText: KERNEL })
  engine.commitFromRaw(wrap({
    turn_summary: '立誓',
    commitments: [{ content: '护送商队到王都', kind: 'promise', importance: 70 }],
    events: [{ type: 'action', description: '玩家接下护送任务', importance: 50 }]
  }), { storyId: 'pr6', sessionId: 'SES-p6', playerInput: '接下护送任务' })
  // 引用不存在的承诺编号 → 冲突
  const bad = engine.commitFromRaw(wrap({ turn_summary: 'x', commitment_updates: [{ ref: 'CMT-000099', status: 'FULFILLED' }] }), { storyId: 'pr6', sessionId: 'SES-p6', playerInput: '完成护送' })
  check('t6: 冲突被拒绝（ok=false）', bad.ok === false && bad.committed === false, bad.errors)
  check('t6: patch_status=PATCH_CONFLICT', bad.patch_status === 'PATCH_CONFLICT', bad.patch_status)
  // 引擎回合不因失败提交推进（commitment_updates 引用错误在中途抛出→回滚）
  check('t6: 历史承诺仍在且未被篡改', engine.getStory('pr6').commitments.some((c) => c.content.includes('护送') && c.status === 'ACTIVE'))
}

// ============ 测试 7：Commit 中途失败 → Rollback，无半提交 ============
{
  engine.ensureStory({ storyId: 'pr7', title: 'T7', kernelId: 'k', kernelText: KERNEL })
  const before = engine.getStory('pr7')
  const snap0 = JSON.stringify({ e: before.entities.length, t: before.threads.length, f: before.facts.length, turn: before.counters.turn })
  // 实体先写入成功，随后 thread update 引用缺失 → 整体回滚
  const bad = engine.commitFromRaw(wrap({
    turn_summary: 'x',
    entity_changes: [{ op: 'upsert', name: '莉露', type: 'character', state: { mood: '警惕' } }],
    threads: [{ op: 'update', ref: 'THR-000042', status: 'RESOLVED' }]
  }), { storyId: 'pr7', sessionId: 'SES-p7', playerInput: '行动' })
  const after = engine.getStory('pr7')
  const snap1 = JSON.stringify({ e: after.entities.length, t: after.threads.length, f: after.facts.length, turn: after.counters.turn })
  check('t7: 提交失败（ok=false）', bad.ok === false)
  check('t7: 七维状态逐位一致（无半提交）', snap0 === snap1, { snap0, snap1 })
  check('t7: 实体未被留下', !after.entities.some((e) => e.name === '莉露'))
}

// ============ 测试 8：程序重启 → Pending Commit 仍然存在 ============
{
  engine.ensureStory({ storyId: 'pr8', title: 'T8', kernelId: 'k', kernelText: KERNEL })
  const r1 = engine.commitFromRaw('断章。', { storyId: 'pr8', sessionId: 'SES-p8', playerInput: '等待' })
  engine.recordPending({ storyId: 'pr8', sessionId: 'SES-p8', playerInput: '等待', narrative: r1.narrative, patchError: 'PATCH_MISSING', retryCount: 1, turnId: r1.turn_id })
  // 重启 = 重新 createEngine（同 dataDir）
  const engine2 = createEngine(tmp)
  const list = engine2.listPendings('pr8')
  check('t8: 重启后 Pending 仍存在', list.length === 1 && list[0].status === 'PENDING_COMMIT', list)
  check('t8: retry_count 保留', list[0].retry_count === 1)
  // 重启后补录成功 → Pending 消除
  const res = engine2.resolvePending({ storyId: 'pr8', pendingId: list[0].pending_id, raw: wrap({ turn_summary: '补录完成', facts: [{ key: 'late_note', statement: '迟到的批注', importance: 20 }] }) })
  check('t8: 重启后补录成功', res.resolved === true && res.result.committed === true, res.result && res.result.errors)
  check('t8: 补录后 Pending 清除', engine2.listPendings('pr8').length === 0)
}

// ============ 测试 9：Story A Pending，Story B 不能读取/恢复 ============
{
  engine.ensureStory({ storyId: 'prA', title: 'TA', kernelId: 'k', kernelText: KERNEL })
  engine.ensureStory({ storyId: 'prB', title: 'TB', kernelId: 'k', kernelText: KERNEL })
  engine.recordPending({ storyId: 'prA', sessionId: 'SES-pA', playerInput: 'A 的行动', narrative: 'A 叙事', patchError: 'PATCH_MISSING' })
  check('t9: B 列表为空', engine.listPendings('prB').length === 0)
  check('t9: B 读 A 的 Pending 得 null', engine.getPending('prB', 'PC-000001') === null)
  let threw = false
  try { engine.resolvePending({ storyId: 'prB', pendingId: 'PC-000001', raw: wrap({ turn_summary: 'x' }) }) } catch (e) { threw = true }
  check('t9: B 恢复 A 的 Pending 被硬闸拒绝', threw)
  const listA = engine.listPendings('prA')
  check('t9: A 的 Pending 原样保留', listA.length === 1 && listA[0].story_id === 'prA')
  // resolvePending 成功路径（同 story）复核
  const res = engine.resolvePending({ storyId: 'prA', pendingId: listA[0].pending_id, raw: wrap({ turn_summary: 'A 补录', events: [{ type: 'action', description: 'A 的行动落地', importance: 30 }] }) })
  check('t9: 同 Story 补录成功并清除', res.resolved === true && engine.listPendings('prA').length === 0)
  // resolvePending 失败路径：retry_count 递增
  engine.recordPending({ storyId: 'prA', sessionId: 'SES-pA', playerInput: '再次行动', narrative: '叙事', patchError: 'PATCH_MISSING' })
  const bad = engine.resolvePending({ storyId: 'prA', pendingId: 'PC-000002', raw: wrap({ commitment_updates: [{ ref: 'CMT-999999', status: 'FULFILLED' }] }) })
  check('t9: 补录失败 retry_count 递增且记录保留', bad.resolved === false && engine.getPending('prA', 'PC-000002').retry_count === 1, engine.getPending('prA', 'PC-000002'))
  // discardPending 清除
  engine.discardPending({ storyId: 'prA', pendingId: 'PC-000002' })
  check('t9: discardPending 生效', engine.listPendings('prA').length === 0)
}

// ============ 附加：commit 日志含 patch_status（条款 31） ============
{
  const log = engine.turnLog('pr1', 'TRN-000001')
  check('log: 回合日志记录 patch_status', log && log.patch_status === 'PATCH_PRESENT', log && log.patch_status)
  const log2 = engine.turnLogs('pr3')
  const d = engine.turnLog('pr3', log2[0])
  check('log: PATCH_MISSING 也有日志留痕', d && d.patch_status === 'PATCH_MISSING')
}


// ============ 测试 N：容错标记变体 + 尾部裸 JSON 兜底（真实弱模型容错链） ============
{
  const { extractPatch } = require('../engine/patch')
  const e1 = extractPatch('叙事。＜＜＜STATE_PATCH＞＞＞{"turn_summary":"a"}＜＜＜END_PATCH＞＞＞')
  check('容错: 全角标记识别', e1.found === true && e1.patch && e1.patch.turn_summary === 'a', e1)
  const e2 = extractPatch('叙事。\n<<< STATE_PATCH >>\n{"turn_summary":"b"}\n<<< end_patch >>\n')
  check('容错: 空格/少箭头/小写标记识别', e2.found === true && e2.patch && e2.patch.turn_summary === 'b', e2)
  const e3 = extractPatch('闲聊。＜＜＜NO_STATE_CHANGE＞＞＞')
  check('容错: NO_STATE_CHANGE 全角变体', e3.noChange === true && e3.found === false, e3)
  engine.ensureStory({ storyId: 'pr-bare', title: 'T-bare', kernelId: 'k', kernelText: KERNEL })
  const bare = '夜色渐深，你回到了旅店。\n{"turn_summary":"回到旅店歇息","scene":{"game_time":"第2日·夜","location":"旅店"},"events":[{"type":"action","description":"回旅店歇息","importance":10}]}'
  const r1 = engine.commitFromRaw(bare, { storyId: 'pr-bare', sessionId: 'SES-bare', playerInput: '回旅店' })
  check('容错: 尾部裸 JSON 被兜底采纳', r1.ok && r1.committed === true, { status: r1.patch_status })
  check('容错: 采纳带 PATCH_UNMARKED 警告', (r1.warnings || []).some((w) => w.code === 'PATCH_UNMARKED'), r1.warnings)
  check('容错: 叙事与 JSON 正确剥离', r1.narrative.indexOf('夜色渐深') === 0 && r1.narrative.indexOf('turn_summary') < 0, r1.narrative)
  const mid = '开头。{"turn_summary":"假"}\n\n然后是一大段跟状态毫无关系的叙事文本，继续描写风声、街道与人群，足够长到让这段 JSON 不处于回复尾部，因此不应被当作状态块兜底识别。'.repeat(3)
  const e4 = extractPatch(mid)
  check('容错: 中段裸 JSON 不误采纳', e4.found === false && e4.unmarked !== true, e4.found)
  const e5 = extractPatch('叙事。\n```json\n<<<STATE_PATCH>>>\n{"turn_summary":"c",}\n<<<END_PATCH>>>\n```')
  check('容错: 围栏包裹 + 尾逗号', e5.found === true && e5.patch && e5.patch.turn_summary === 'c', e5)
  // ---- v1.4.2 加固病例：函数标头泄漏（用户实测形态）与更宽松的兜底 ----
  const e6 = extractPatch('叙事正文……\n<<STATE_PATCH>>\n```json\n{"turn_summary":"今天","scene":{"location":"村口"}}\n```\n<<END_PATCH>>')
  check('容错: 两箭头标记 + 围栏夹层', e6.found === true && e6.patch && e6.patch.turn_summary === '今天' && !/```|STATE_PATCH/.test(e6.narrative), e6.narrative)
  const e7 = extractPatch('剧情推进。\nupdate_state(\n{"turn_summary":"一天","events":[{"type":"action","description":"x"}]}\n)')
  check('容错: 函数调用包装（无标记）被剥开', e7.found === true && e7.unmarked === true && e7.patch && e7.patch.turn_summary === '一天' && !/update_state/.test(e7.narrative), e7.narrative)
  const e8 = extractPatch('故事。\n{"scene":{"location":"城"},"facts":[{"key":"k","statement":"s"}]}')
  check('容错: 缺 turn_summary 但 ≥2 协议键仍兜底', e8.found === true && e8.patch && e8.patch.scene && e8.patch.facts, { found: e8.found })
  const e9 = extractPatch('正文。\nupdate_state(\n{"turn_summary":"z"}\n) 之后又写了一句收尾的话。')
  check('容错: 函数包装后带中文长尾注 → 不采纳（可能只是叙事举例）', e9.found === false, e9.found)
  const { scrubNarrative } = require('../engine/patch')
  check('清洗: 尾部围栏/引导语/函数行逐层剥净', scrubNarrative('正文结束。\n\n```json\n状态块：\n') === '正文结束。' && scrubNarrative('他推开门。\nupdate_state(') === '他推开门。', 'ok')
  check('清洗: 正常结尾一个字都不动', scrubNarrative('正常一句话结尾。') === '正常一句话结尾。' && scrubNarrative('含 { 引号的正常叙事。') === '含 { 引号的正常叙事。', 'ok')
}

console.log('\n== Patch 可靠性测试: ' + pass + ' 通过, ' + fail + ' 失败 ==')
process.exit(fail ? 1 : 0)

'use strict'
/* State Patch —— LLM 输出的解析与修复（容错链第一环：Parse → Schema Validation） */

const { PATCH_KEYS } = require('./schema')

const PATCH_BEGIN = '<<<STATE_PATCH>>>'
const PATCH_END = '<<<END_PATCH>>>'
const NO_STATE_CHANGE = '<<<NO_STATE_CHANGE>>>' // 条款 21/23：纯聊天回合的合法显式标记

/* 从模型原始输出中提取 patch 块。
 * 返回 { found, narrative, patch, raw, noChange } —— narrative 为剥离协议块后的纯叙事。
 * noChange=true 表示模型显式声明本回合无状态变化（两种合法结尾之一）。 */
function extractPatch(rawText) {
  const text = String(rawText || '')
  // 先剥 NO_STATE_CHANGE 标记（可与叙事共存，出现即视为显式声明）
  let noChange = false
  let work = text
  if (work.indexOf(NO_STATE_CHANGE) !== -1) {
    noChange = true
    work = work.split(NO_STATE_CHANGE).join('').trim()
  }
  const begin = work.indexOf(PATCH_BEGIN)
  if (begin === -1) return { found: false, noChange, narrative: work.trim(), patch: null, raw: work }
  const narrative = work.slice(0, begin).trim()
  const rest = work.slice(begin + PATCH_BEGIN.length)
  const end = rest.indexOf(PATCH_END)
  const rawPatch = end === -1 ? rest : rest.slice(0, end)
  const parsed = tolerantParse(rawPatch)
  return { found: true, noChange, narrative, patch: parsed.ok ? parsed.value : null, parse_error: parsed.ok ? null : parsed.error, raw: rawPatch }
}

/* 容错 JSON 解析：剥 markdown 围栏 → 尾逗号清除 → 智能引号归一 → 截断补全 → 首尾大括号裁剪 */
function tolerantParse(s) {
  let t = String(s || '').trim()
  if (!t) return { ok: false, error: 'empty patch' }
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  // 智能引号归一（避免模型/输入法产生全角引号）
  t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
  const attempts = [t]
  attempts.push(t.replace(/,(\s*[}\]])/g, '$1')) // 尾逗号
  // 截断补全：逐层闭合未闭合的括号（流式中断场景）
  attempts.push(closeBrackets(t.replace(/,(\s*[}\]])/g, '$1')))
  for (const cand of attempts) {
    try { return { ok: true, value: JSON.parse(cand) } } catch (e) { /* next */ }
  }
  // 最后手段：裁剪到首个 { 与末个 } 之间再试
  const a = cand0(t)
  try { return { ok: true, value: JSON.parse(a) } } catch (e) {
    try { return { ok: true, value: JSON.parse(closeBrackets(a)) } } catch (e2) { return { ok: false, error: e2.message } }
  }
  function cand0(x) { const i = x.indexOf('{'); const j = x.lastIndexOf('}'); return i >= 0 && j > i ? x.slice(i, j + 1) : x }
}

function closeBrackets(s) {
  const stack = []
  let inStr = false, esc = false
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let out = s
  if (inStr) out += '"'
  // 修剪悬挂逗号
  out = out.replace(/,\s*$/, '')
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']'
  return out
}

/* 规范化：过滤未知键、类型纠偏（字符串数组化、数字化），返回干净 patch */
function normalizePatch(p) {
  const out = {}
  if (!p || typeof p !== 'object') return out
  for (const k of PATCH_KEYS) {
    if (p[k] === undefined || p[k] === null) continue
    out[k] = p[k]
  }
  // 类型纠偏
  if (out.turn_summary != null) out.turn_summary = String(out.turn_summary).slice(0, 500)
  if (out.scene && typeof out.scene !== 'object') delete out.scene
  if (out.player_state && typeof out.player_state !== 'object') delete out.player_state
  const arrKeys = ['entity_changes', 'decisions', 'commitments', 'commitment_updates', 'facts', 'events', 'relationships', 'knowledge', 'threads', 'causal']
  for (const k of arrKeys) {
    if (out[k] === undefined) continue
    if (!Array.isArray(out[k])) out[k] = [out[k]] // 单对象 → 数组
    out[k] = out[k].filter((x) => x && typeof x === 'object')
  }
  if (out.scene && Array.isArray(out.scene.participants)) {
    out.scene.participants = out.scene.participants.map(String).slice(0, 30)
  }
  // 修复层：秘密事实的常见别名写法归一为 secret_from_player（条款 17 容错链）
  if (Array.isArray(out.facts)) {
    for (const f of out.facts) {
      if (f && typeof f === 'object' && (f.secret === true || f.visibility === 'secret' || f.hidden_from_player === true)) f.secret_from_player = true
    }
  }
  return out
}

/* 生成给 LLM 的输出协议说明书（拼入 system 上下文） */
function patchProtocolPrompt() {
  return [
    '【状态记录协议 · 必须遵守】',
    '你在推进叙事之后，必须在回复的最末尾输出一个状态记录块，格式严格如下：',
    '<<<STATE_PATCH>>>',
    '{"turn_summary":"本回合剧情一句话概括",',
    ' "scene":{"game_time":"故事内时间文本","location":"当前地点","participants":["出场角色名"],"ended":false},',
    ' "player_state":{"location":"","status_add":[],"resources_add":{},"flags_add":{}},',
    ' "entity_changes":[{"op":"upsert","name":"实体名","type":"character|location|organization|item|creature|concept|faction|object|other","state":{},"tags":[],"summary":""}],',
    ' "decisions":[{"raw_input":"玩家原话或所选选项原文","normalized_intent":"规范化意图","importance":30,"reversible":true,"source":"user_input|user_pick"}],',
    ' "commitments":[{"content":"新承诺/目标/约定内容","kind":"goal|promise|quest|contract","importance":50,"due_hint":""}],',
    ' "commitment_updates":[{"ref":"CMT-000001 或内容关键词","status":"FULFILLED|REVOKED|BROKEN|SUPERSEDED","note":"原因"}],',
    ' "facts":[{"key":"唯一英文或拼音键，如 lucy_mood","statement":"一句可核查的世界事实","secret_from_player":false,"importance":30,"entity_names":["相关实体名"]}],',
    ' "events":[{"type":"action|dialogue|discovery|conflict|turning_point|arrival|departure|offscreen","description":"发生事件","importance":30,"participant_names":["实体名"]}],',
    ' "relationships":[{"source_name":"A","target_name":"B","relation_type":"friend|rival|ally|enemy|family|master_servant|romantic|other","strength_delta":5,"description":"关系变化"}],',
    ' "knowledge":[{"content":"玩家角色新得知的信息","how_learned":"observed|told_by|inferred"}],',
    ' "threads":[{"op":"add","title":"新伏笔/长线标题","detail":"细节","importance":50},{"op":"update","ref":"THR-000001 或标题关键词","status":"RESOLVED|ABANDONED","detail":"进展"}],',
    ' "causal":[{"cause":"因","effect":"可预见的果","importance":50}]}',
    '<<<END_PATCH>>>',
    '若本回合确实完全没有产生任何状态变化（例如纯寒暄、无新信息、无场景变动），则不要输出状态块，改为在回复最末尾输出一行：',
    '<<<NO_STATE_CHANGE>>>',
    '协议规则：',
    '1. 叙事正文里绝不要提及本协议、JSON 或任何字段名；状态块（或 NO_STATE_CHANGE 标记）必须放在回复最末尾，读者不可见。',
    '2. 只记录「本回合新发生的」状态变化；没有变化的类别可省略整个键。',
    '3. decisions 只记录玩家真实做出的选择/输入（source 用 user_input 或 user_pick）；你给出的选项本身不是决定。',
    '4. facts 是客观世界事实；玩家不知道的（秘密）用 secret_from_player:true 标记，且不要写进 knowledge。',
    '5. 所有 importance 用 1~100：100 世界级转折，80+ 主线重大，50+ 重要，20+ 一般，<10 琐事。',
    '6. 引用既有实体一律用名字（引擎负责匹配）；引用既有伏笔/承诺若知道编号用编号，否则用内容关键词。'
  ].join('\n')
}

module.exports = { PATCH_BEGIN, PATCH_END, NO_STATE_CHANGE, extractPatch, tolerantParse, normalizePatch, patchProtocolPrompt, closeBrackets }

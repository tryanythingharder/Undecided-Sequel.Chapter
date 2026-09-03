'use strict'
/* State Patch —— LLM 输出的解析与修复（容错链第一环：Parse → Schema Validation） */

const { PATCH_KEYS } = require('./schema')

const PATCH_BEGIN = '<<<STATE_PATCH>>>'
const PATCH_END = '<<<END_PATCH>>>'
const NO_STATE_CHANGE = '<<<NO_STATE_CHANGE>>>' // 条款 21/23：纯聊天回合的合法显式标记

/* 容错标记匹配（真实模型常见变体：全角括号/少一个 >/内部空格/大小写/下划线/两个箭头） */
const RE_BEGIN = /(?:<<<|＜＜＜|＜<<?|<<<?)\s*(?:STATE[_ ]?PATCH|state_patch)\s*(?:>{2,3}|＞＞?＞?)/i
const RE_END = /(?:<<<|＜＜＜|＜<<?|<<<?)\s*END[_ ]?PATCH\s*(?:>{2,3}|＞＞?＞?)/i
const RE_NO_CHANGE = /(?:<<<|＜＜＜|＜<<?|<<<?)\s*NO[_ ]?STATE[_ ]?CHANGE\s*(?:>{2,3}|＞＞?＞?)/i

/* 从模型原始输出中提取 patch 块。
 * 返回 { found, narrative, patch, raw, noChange, unmarked }
 * —— narrative 为剥离协议块后的纯叙事；noChange=true 表示显式声明无状态变化；
 * unmarked=true 表示模型没写标记、但按「尾部裸 JSON（含 turn_summary）」兜底识别成功。 */
function extractPatch(rawText) {
  const text = String(rawText || '')
  // 先剥 NO_STATE_CHANGE 标记（可与叙事共存，出现即视为显式声明；含全角/少箭头变体）
  let noChange = false
  let work = text
  if (RE_NO_CHANGE.test(work)) {
    noChange = true
    work = work.replace(RE_NO_CHANGE, '').trim()
  }
  const beginMatch = work.match(RE_BEGIN)
  if (beginMatch) {
    const begin = beginMatch.index
    let narrative = work.slice(0, begin).trim()
    const rest = work.slice(begin + beginMatch[0].length)
    const endMatch = rest.match(RE_END)
    const rawPatch = endMatch ? rest.slice(0, endMatch.index) : rest
    const parsed = tolerantParse(rawPatch)
    return { found: true, noChange, narrative: scrubNarrative(narrative), patch: parsed.ok ? parsed.value : null, parse_error: parsed.ok ? null : parsed.error, raw: rawPatch }
  }
  /* 兜底：无标记但回复末尾是状态形状的裸 JSON（弱模型常见失误：丢标记/写函数包装/围栏包裹）。
   * 采纳条件见 looksLikeStatePatch；命中标记 unmarked=true，由提交层记警告。 */
  if (!noChange) {
    const cand = findTailJson(work)
    if (cand) {
      const parsed = tolerantParse(cand.json)
      if (parsed.ok && looksLikeStatePatch(parsed.value)) {
        return { found: true, noChange, narrative: scrubNarrative(work.slice(0, cand.start)), patch: parsed.value, raw: cand.json, unmarked: true }
      }
    }
  }
  return { found: false, noChange, narrative: scrubNarrative(work), patch: null, raw: work }
}

/* 状态块形状判定：turn_summary 直收；否则要求 ≥2 个协议键（模型漏写 turn_summary 的常见病） */
function looksLikeStatePatch(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  if (v.turn_summary != null) return true
  let n = 0
  for (const k of PATCH_KEYS) if (v[k] !== undefined) n++
  return n >= 2
}

/* 剥离叙事尾部的协议残渣：孤立的代码围栏行、```json、函数调用包装行（update_state( 等）、
 * 「状态块：」类引导语——模型把协议写进正文的痕迹，读者不可见。逐行从尾往头剥，不动正文。 */
function scrubNarrative(text) {
  let t = String(text || '').trim()
  const residueLine = /^\s*(?:```+[a-z]*|`+|＜{0,3}<{0,3}\s*(?:STATE[_ ]?PATCH|END[_ ]?PATCH|NO[_ ]?STATE[_ ]?CHANGE)\s*>{0,3}＞{0,3}|「?(?:状态块|状态记录|State\s*Patch)」?\s*[：:]?)\s*$/i
  const funcWrap = /(?:^|\n)\s*[A-Za-z_][\w.]*\s*\(\s*$/   // update_state( 函数包装行
  for (let guard = 0; guard < 12; guard++) {
    const m = t.match(/\n([^\n]*)$/)
    const lastLine = m ? m[1] : t
    if (residueLine.test(lastLine)) { t = (m ? t.slice(0, m.index) : '').trim(); continue }
    const fw = t.match(funcWrap)
    if (fw && (m ? lastLine : t).match(/^[A-Za-z_][\w.]*\s*\(\s*$/)) { t = t.slice(0, fw.index).trim(); continue }
    break
  }
  return t
}

/* 在文本尾部找最后一个平衡的 JSON 对象：起点须在 tail 窗口内，其后允许短尾注
 * （含函数调用的右括号 `})`、闭合围栏、一句收束话——都是真实模型的常见尾巴） */
function findTailJson(text) {
  const window = 3000
  const tailStart = Math.max(0, text.length - window)
  let i = text.lastIndexOf('{')
  while (i >= tailStart) {
    const depth = scanDepth(text, i)
    if (depth.end > i) {
      const json = text.slice(i, depth.end + 1)
      /* 必须是状态块形状（turn_summary 或 ≥2 个协议键）才采纳；否则继续向前回溯更大的平衡对象 */
      if (looksLikeStatePatchLoose(json)) {
        const after = text.slice(depth.end + 1).trim()
          .replace(/^[)）\]]+/, '')                                  // 函数调用包装的右括号
          .replace(/^(```+|｀｀｀+)\s*/, '')                         // 闭合围栏
          .replace(/^(?:<{1,3}|＜{1,3})\s*(?:END[_ ]?PATCH|NO[_ ]?STATE[_ ]?CHANGE)\s*(?:>{1,3}|＞{1,3})/i, '') // 残余结束标记
          .trim()
      /* 短尾注只接受「协议尾巴」（标点/短英文/短中文收束 ≤10 字）。大段中文叙事跟在 JSON 后面
         * 说明这是叙事中段的示例 JSON，绝不能当状态块（尾部窗口内的正文回头扫会命中）。 */
        if (after.length > 80) return null
        const cjk = after.match(/[\u4e00-\u9fff]/g)
        if (cjk && cjk.length > 10) return null
        return { start: i, json }
      }
    }
    i = text.lastIndexOf('{', i - 1)
  }
  return null
}
/* 廉价预检：JSON 文本里出现协议键才值得 parse（避免对大段叙事 JSON 白做配平） */
function looksLikeStatePatchLoose(jsonText) {
  return /turn_summary|"scene"|"player_state"|"entity_changes"|"decisions"|"commitments"|"commitment_updates"|"relationships"|"threads"|"knowledge"|"causal"|"facts"|"events"|"commitment_updates"/.test(jsonText)
}
/* 从 start 的 '{' 起做括号配平（字符串感知），返回匹配 '}' 的下标；未闭合则返回 -1 */
function scanDepth(text, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return { end: i } }
  }
  return { end: -1 }
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
    '2. 状态块不要用 Markdown 代码围栏（``` 或 ```json）包裹，也不要写成函数调用（如 update_state(...)）——只用 <<<STATE_PATCH>>> 和 <<<END_PATCH>>> 两行标记夹住原始 JSON。',
    '3. 只记录「本回合新发生的」状态变化；没有变化的类别可省略整个键。',
    '4. decisions 只记录玩家真实做出的选择/输入（source 用 user_input 或 user_pick）；你给出的选项本身不是决定。',
    '5. facts 是客观世界事实；玩家不知道的（秘密）用 secret_from_player:true 标记，且不要写进 knowledge。',
    '6. 所有 importance 用 1~100：100 世界级转折，80+ 主线重大，50+ 重要，20+ 一般，<10 琐事。',
    '7. 引用既有实体一律用名字（引擎负责匹配）；引用既有伏笔/承诺若知道编号用编号，否则用内容关键词。'
  ].join('\n')
}

module.exports = { PATCH_BEGIN, PATCH_END, NO_STATE_CHANGE, extractPatch, tolerantParse, normalizePatch, patchProtocolPrompt, closeBrackets, findTailJson, scrubNarrative, looksLikeStatePatch }

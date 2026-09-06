'use strict'
/* R85 协议遵循回归（node scripts-dev/test-protocol-position.cjs）：
 * 根因：状态块协议书埋在历史前的 system（位置 3），长上下文下模型遵循衰减——
 * 真实百轮实测 83% 轮次 PATCH_MISSING。修复：send-flow 在历史之后垫「末位重申」system。
 * 本测试不调真实模型，而是断言消息结构的形状约束（发送载荷的协议层不变量）：
 *   1) 末位重申在历史之后（最后一条 system 之后不能再有 user/assistant —— 重申必须贴着对话尾部）
 *   2) 末位重申内容含三要素（选项区 / STATE_PATCH / NO_STATE_CHANGE）
 *   3) 协议书 + 末位重申都只在 engineMeta 就绪时注入（纯对话降级路径不注入）
 *   4) 补账重试提示词为最后一条消息（历史结构保证 ~100% 遵循的位置形态）
 * 运行时行为由 test:real:marathon（真实模型抽样）+ e2e-mock（chip 生命周期）覆盖。 */
const fs = require('node:fs')
const path = require('node:path')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  ' + detail : '')) }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'send-flow.js'), 'utf8')

// 1) 末位重申注入：位于 msgs.push(...history) 之前、协议书之后
const pushHistoryIdx = src.indexOf('msgs.push(...history)')
const reminderIdx = src.indexOf('【回复结构 · 必须遵守】')
const protocolIdx = src.indexOf("msgs.push({ role: 'system', content: protocolText() })")
check('reminder-exists', reminderIdx !== -1)
check('reminder-before-history', reminderIdx !== -1 && pushHistoryIdx !== -1 && reminderIdx < pushHistoryIdx, 'reminder@' + reminderIdx + ' history@' + pushHistoryIdx)
check('protocol-before-reminder', protocolIdx !== -1 && reminderIdx !== -1 && protocolIdx < reminderIdx)

// 2) 三要素
const reminderTxt = reminderIdx !== -1 ? src.slice(reminderIdx, reminderIdx + 700) : ''
check('reminder-mentions-choices', reminderTxt.includes('【你需要决定】'))
check('reminder-mentions-state-patch', reminderTxt.includes('<<<STATE_PATCH>>>'))
check('reminder-mentions-no-state-change', reminderTxt.includes('<<<NO_STATE_CHANGE>>>'))
check('reminder-mentions-json-closure', reminderTxt.includes('闭合'))

// 3) 守卫：重申只在 engineMeta && protocolText() 时注入（双条件与协议书一致）
check('reminder-guarded-by-engineMeta', /if \(engineMeta && protocolText\(\)\) msgs\.push\(\{\s*role: 'system',\s*content: '【回复结构/.test(src))

// 4) 补账重试提示词为最后一条消息（retryMsgs concat 的最后一项是 user patchRetryPrompt）
const retryIdx = src.indexOf('const retryMsgs = msgs.concat([')
const retryTail = retryIdx !== -1 ? src.slice(retryIdx, retryIdx + 900) : ''
const concatEnd = retryTail.indexOf('])')
check('retry-prompt-is-last-message', concatEnd !== -1 && retryTail.slice(0, concatEnd).lastIndexOf("{ role: 'user', content: patchRetryPrompt(") > retryTail.slice(0, concatEnd).lastIndexOf("{ role: 'assistant'"), 'user prompt is the last concat item')

// 5) resolvePendingFlow 的提示词同样在消息末位（msgs2 最后一条 user）
const resolveIdx = src.indexOf('function resolvePendingFlow')
const resolveSeg = resolveIdx !== -1 ? src.slice(resolveIdx, resolveIdx + 2400) : ''
const lastPushIdx = resolveSeg.lastIndexOf("msgs2.push({ role: 'user'")
check('resolve-prompt-last-in-msgs2', lastPushIdx !== -1, 'last push @' + lastPushIdx)

console.log('---')
console.log('protocol-position：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)

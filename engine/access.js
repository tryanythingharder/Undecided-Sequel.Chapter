'use strict'
/* Context Access Policy（条款 A / 三 / 十二）
 * 统一 Context 权限模型：PLAYER / SYSTEM / DEBUG 三级。
 * 原则：
 *  - includeSecrets 一律不作为权限依据（条款 7）：PLAYER + includeSecrets=true 仍然拒绝秘密。
 *  - 未知 accessLevel 按最严格的 PLAYER 处理（fail-closed）。
 *  - 未列出的数据类型默认各级别可读，但 story_id 隔离另行在 retriever 硬闸强制（条款 9）。
 */

const ACCESS_LEVELS = ['PLAYER', 'SYSTEM', 'DEBUG']

/* 归一化访问级别；非法/缺省一律降级为 PLAYER */
function normalizeAccessLevel(level) {
  const l = String(level || 'PLAYER').toUpperCase()
  return ACCESS_LEVELS.includes(l) ? l : 'PLAYER'
}

/* 受限数据类型 × 级别矩阵（显式 deny，缺省即不可读）
 *  secrets        —— secret_from_player 事实 / 隐藏目标（PLAYER 禁止）
 *  debug          —— 检索调试信息 / 回合日志 / 内部诊断（仅 DEBUG）
 *  discarded      —— 被抛弃叙事（内部留痕；仅 DEBUG/SYSTEM 视需要）
 */
const RESTRICTED = {
  secrets: { PLAYER: false, SYSTEM: true, DEBUG: true },
  debug: { PLAYER: false, SYSTEM: false, DEBUG: true },
  discarded: { PLAYER: false, SYSTEM: true, DEBUG: true }
}

/* 判断某级别能否读取某类数据（条款 12：canRead） */
function canRead(accessLevel, dataType) {
  const level = normalizeAccessLevel(accessLevel)
  const rule = RESTRICTED[String(dataType || '')]
  if (!rule) return true // 普通数据：三级可读（story 隔离由 retriever 强制）
  return rule[level] === true
}

/* includeSecrets 兼容检查：该参数已彻底失去授权作用（条款 7） */
function legacyIncludeSecretsIgnored(opts) {
  return !!(opts && opts.includeSecrets)
}

module.exports = { ACCESS_LEVELS, normalizeAccessLevel, canRead, legacyIncludeSecretsIgnored, RESTRICTED }

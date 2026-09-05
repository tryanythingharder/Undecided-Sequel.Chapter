'use strict'
/* State Validator —— Patch 合法性校验（不合法不提交，条款 22）
 * 校验在 resolve（名字→ID 解析）之后进行；输出 { ok, errors, warnings }。
 */

const {
  canTransition, DECISION_TRANSITIONS, COMMITMENT_TRANSITIONS,
  THREAD_TRANSITIONS, IMPORTANCE_LEVELS, ENTITY_TYPES, EVENT_TYPES
} = require('./schema')

function err(list, code, msg) { list.errors.push({ code, message: msg }) }
function warn(list, code, msg) { list.warnings.push({ code, message: msg }) }

/* 校验已解析的 patch（未 resolve 前做结构层校验；resolve 后的引用校验由 commit 前置检查完成） */
function validatePatch(patch, ctx) {
  const out = { ok: true, errors: [], warnings: [] }
  ctx = ctx || {}
  if (!patch || typeof patch !== 'object') {
    err(out, 'PATCH_EMPTY', 'patch 为空或非对象')
    out.ok = false
    return out
  }
  const keys = Object.keys(patch)
  if (!keys.length) {
    warn(out, 'PATCH_NOOP', 'patch 无任何状态变化（允许：纯叙事回合）')
    return out
  }

  // ---- decisions：条款 10/31 —— 选项≠决定 ----
  for (const d of patch.decisions || []) {
    const src = d.source || 'user_input'
    if (src === 'ai_option') {
      // 降级而非整体拒绝：提交继续，但该决定由 Repos 硬闸强制 PROPOSED（条款 10）
      warn(out, 'DECISION_AI_OPTION_DOWNGRADED', 'AI 提供的选项不得成为玩家决定，已强制降级为 PROPOSED：' + JSON.stringify(d).slice(0, 120))
    }
    if (!String(d.raw_input || '').trim() && !String(d.normalized_intent || '').trim()) {
      err(out, 'DECISION_EMPTY', 'decision 缺少 raw_input 与 normalized_intent')
    }
    if (d.importance !== undefined && !Number.isFinite(Number(d.importance))) {
      warn(out, 'IMPORTANCE_NAN', 'decision.importance 非数字，已回退默认')
    }
  }

  // ---- commitments ----
  for (const c of patch.commitments || []) {
    if (!String(c.content || '').trim()) err(out, 'COMMITMENT_EMPTY', 'commitment 缺少 content')
  }
  for (const cu of patch.commitment_updates || []) {
    if (!String(cu.ref || '').trim()) err(out, 'COMMITMENT_UPDATE_REF', 'commitment_updates 缺少 ref（编号或关键词）')
    // 状态归一化：与 threads 对称——模型会把 commitments 写成 threads 的 OPEN/DONE（合法值 ACTIVE|FULFILLED|REVOKED|BROKEN|SUPERSEDED）
    if (cu.status) {
      const cnorm = { OPEN: 'ACTIVE', DONE: 'FULFILLED', CLOSED: 'FULFILLED', FINISHED: 'FULFILLED', COMPLETE: 'FULFILLED', CANCELLED: 'REVOKED', CANCELED: 'REVOKED' }[String(cu.status).toUpperCase()]
      if (cnorm) {
        warn(out, 'COMMITMENT_STATUS_NORMALIZED', 'commitment 状态 ' + cu.status + ' 按 ' + cnorm + ' 归一（commitments 用 ACTIVE/FULFILLED/REVOKED/BROKEN/SUPERSEDED）')
        cu.status = cnorm
      }
    }
    if (cu.status && !canTransition(COMMITMENT_TRANSITIONS, 'ACTIVE', cu.status)) {
      err(out, 'COMMITMENT_BAD_STATUS', 'commitment 目标状态非法：' + cu.status)
    }
  }

  // ---- facts ----
  const seenKeys = new Set()
  for (const f of patch.facts || []) {
    if (!String(f.statement || '').trim()) err(out, 'FACT_EMPTY', 'fact 缺少 statement')
    if (f.key) {
      if (seenKeys.has(f.key)) warn(out, 'FACT_DUP_KEY', '同回合重复 fact key：' + f.key)
      seenKeys.add(f.key)
    }
  }

  // ---- events ----
  for (const e of patch.events || []) {
    if (!String(e.description || '').trim()) err(out, 'EVENT_EMPTY', 'event 缺少 description')
    if (e.type && !EVENT_TYPES.includes(e.type)) warn(out, 'EVENT_TYPE_UNKNOWN', '未知事件类型 ' + e.type + '，按 other 处理')
  }

  // ---- entities ----
  for (const e of patch.entity_changes || []) {
    if (!String(e.name || '').trim()) err(out, 'ENTITY_NAME_EMPTY', 'entity_changes 缺少 name')
    if (e.type && !ENTITY_TYPES.includes(e.type)) warn(out, 'ENTITY_TYPE_UNKNOWN', '未知实体类型 ' + e.type + '，按 other 处理')
  }

  // ---- relationships ----
  for (const r of patch.relationships || []) {
    if (!String(r.source_name || '').trim() || !String(r.target_name || '').trim()) {
      err(out, 'RELATION_ENDPOINTS', 'relationship 缺少 source_name/target_name')
    }
    // relation_type 同义归一：模型常写 friendship/hostility 等协议外语（合法集见协议提示词）；
    // 归一到既有集合可保检索代称推断的词面一致性；完全未知的值不拒收（自由文本是设计决定，只告警）
    if (r.relation_type) {
      const rt = String(r.relation_type)
      const rnorm = {
        friendship: 'friend', friend: 'friend', friendly: 'friend', ally: 'ally', allied: 'ally', alliance: 'ally',
        hostility: 'enemy', hostile: 'enemy', foe: 'enemy', adversary: 'enemy', rival: 'rival', rivalry: 'rival',
        kin: 'family', kinship: 'family', relative: 'family', servant: 'master_servant', master: 'master_servant',
        romance: 'romantic', lover: 'romantic', love: 'romantic', acquaintance: 'acquaintance'
      }[rt.toLowerCase()]
      if (rnorm && rnorm !== rt) {
        warn(out, 'RELATION_TYPE_NORMALIZED', 'relation_type ' + rt + ' 按 ' + rnorm + ' 归一')
        r.relation_type = rnorm
      } else if (!rnorm && !['friend', 'rival', 'ally', 'enemy', 'family', 'master_servant', 'romantic', 'other', 'acquaintance'].includes(rt.toLowerCase())) {
        warn(out, 'RELATION_TYPE_FREE_TEXT', 'relation_type「' + rt + '」不在协议集合（friend|rival|ally|enemy|family|master_servant|romantic|other），按原样保留')
      }
    }
  }

  // ---- threads ----
  for (const t of patch.threads || []) {
    const op = t.op || 'add'
    if (op === 'add' && !String(t.title || '').trim()) err(out, 'THREAD_TITLE_EMPTY', 'threads[add] 缺少 title')
    // 状态归一化（add/update 通用）：模型高频把 thread 写成 commitments 的 ACTIVE
    // （threads 合法值 OPEN/RESOLVED/ABANDONED）。实测 deepseek 在 6 回合长程补录里写 ACTIVE
    // 且拒绝原因未回传时原样重蹈——可预期的同义偏差归一为警告（容忍格式、拒绝语义），不再让整回合记忆落不了账
    if (t.status) {
      const norm = { ACTIVE: 'OPEN', DONE: 'RESOLVED', CLOSED: 'RESOLVED', FINISHED: 'RESOLVED', DROPPED: 'ABANDONED' }[String(t.status).toUpperCase()]
      if (norm) {
        warn(out, 'THREAD_STATUS_NORMALIZED', 'thread 状态 ' + t.status + ' 按 ' + norm + ' 归一（threads 用 OPEN/RESOLVED/ABANDONED）')
        t.status = norm
      }
    }
    if (op === 'update') {
      if (!String(t.ref || '').trim()) err(out, 'THREAD_UPDATE_REF', 'threads[update] 缺少 ref')
      if (t.status && !canTransition(THREAD_TRANSITIONS, 'OPEN', t.status)) err(out, 'THREAD_BAD_STATUS', 'thread 目标状态非法：' + t.status + '（threads 用 OPEN/RESOLVED/ABANDONED）')
    }
  }

  // ---- knowledge：世界秘密不得自动进入玩家认知（条款 13） ----
  const secretKeys = new Set((patch.facts || []).filter((f) => f.secret_from_player).map((f) => f.key).filter(Boolean))
  for (const k of patch.knowledge || []) {
    if (k.fact_key && secretKeys.has(k.fact_key)) {
      err(out, 'KNOWLEDGE_LEAK', '玩家不可知的秘密事实被写入 knowledge：' + k.fact_key)
    }
    if (!String(k.content || '').trim() && !k.fact_ref && !k.fact_key) err(out, 'KNOWLEDGE_EMPTY', 'knowledge 缺少 content/fact 引用')
  }

  // ---- causal ----
  for (const c of patch.causal || []) {
    if (!String(c.cause || '').trim() || !String(c.effect || '').trim()) err(out, 'CAUSAL_INCOMPLETE', 'causal 缺少 cause/effect')
  }
  for (const cu of patch.causal_updates || []) {
    if (!String(cu.ref || '').trim()) err(out, 'CAUSAL_UPDATE_REF', 'causal_updates 缺少 ref（编号或关键词）')
    // 状态归一：常见同义偏差（HAPPENED/DONE/CONFIRMED → RESOLVED；ABANDONED/DROPPED/FAILED/VOID → CANCELLED）
    if (cu.status) {
      const cnorm = { HAPPENED: 'RESOLVED', DONE: 'RESOLVED', CONFIRMED: 'RESOLVED', OCCURRED: 'RESOLVED', ABANDONED: 'CANCELLED', DROPPED: 'CANCELLED', FAILED: 'CANCELLED', VOID: 'CANCELLED', NEGATED: 'CANCELLED' }[String(cu.status).toUpperCase()]
      if (cnorm) {
        warn(out, 'CAUSAL_STATUS_NORMALIZED', 'causal 状态 ' + cu.status + ' 按 ' + cnorm + ' 归一（causal_updates 用 RESOLVED/CANCELLED）')
        cu.status = cnorm
      }
    }
    if (cu.status && !['RESOLVED', 'CANCELLED'].includes(String(cu.status).toUpperCase())) {
      err(out, 'CAUSAL_BAD_STATUS', 'causal_updates 目标状态非法：' + cu.status + '（只有 RESOLVED/CANCELLED）')
    } else if (cu.status) cu.status = String(cu.status).toUpperCase()
  }

  // ---- scene ----
  if (patch.scene && patch.scene.ended !== undefined && typeof patch.scene.ended !== 'boolean') {
    warn(out, 'SCENE_ENDED_TYPE', 'scene.ended 应为布尔值')
  }

  if (out.errors.length) out.ok = false
  return out
}

/* 引用解析层校验：resolve 结果里未找到的引用要么自动建（实体）要么报错 */
function validateResolved(patch, resolved) {
  const out = { ok: true, errors: [], warnings: [] }
  for (const miss of resolved.missing || []) {
    if (miss.hard) { out.errors.push({ code: 'REF_MISSING', message: '引用不存在且无法创建：' + miss.kind + ' ' + miss.ref }); }
    else out.warnings.push({ code: 'REF_CREATED', message: miss.kind + ' ' + miss.ref + ' 已自动创建' })
  }
  if (out.errors.length) out.ok = false
  return out
}

module.exports = { validatePatch, validateResolved }

'use strict'
/* Scene Commit —— 状态提交管线（条款 21/22/45）
 * 流程：resolve（名字→ID）→ validate → 事务内应用 → 提交 / 回滚
 * 全部写入发生在 store 的事务 staging 上；任何一步失败整体回滚，不留半提交。
 */

const { Repos } = require('./repositories')
const { normalizePatch, extractPatch } = require('./patch')
const { validatePatch, validateResolved } = require('./validator')
const { clampImportance, IMPORTANCE_FLOOR, DECISION_EFFECTIVE } = require('./schema')

/* 从模型原始输出提取并提交。
 * raw: 模型完整输出文本；meta: { storyId, sessionId, playerInput, intent, ... }
 * 返回 { ok, committed, patch_status, narrative, applied, errors, warnings, turn_id, ... }
 * patch_status: PATCH_PRESENT | NO_STATE_CHANGE | PATCH_MISSING | PATCH_INVALID | PATCH_CONFLICT | COMMIT_FAILED（条款 15/22） */
function commitFromRaw(engine, raw, meta) {
  const ex = extractPatch(raw)
  return commitPatch(engine, ex.patch, Object.assign({ parse_error: ex.parse_error, patch_found: ex.found, noChange: ex.noChange, unmarked: ex.unmarked }, meta || {}), ex.narrative)
}

/* 提交规范化后的 patch */
function commitPatch(engine, rawPatch, meta, narrativeOverride) {
  const store = engine.store
  const storyId = meta.storyId
  const story0 = store.getStory(storyId)
  if (!story0) return { ok: false, committed: false, patch_status: null, errors: [{ code: 'STORY_MISSING', message: 'story not found: ' + storyId }], warnings: [], applied: {}, narrative: narrativeOverride != null ? narrativeOverride : '', turn_id: 'TRN-000000', story_id: storyId, session_id: meta.sessionId || null }
  const now = Date.now()
  const patch = normalizePatch(rawPatch)

  const result = { ok: false, committed: false, patch_status: null, errors: [], warnings: [], applied: {}, turn_id: 'TRN-' + String(story0.counters.turn + 1).padStart(6, '0'), story_id: storyId, session_id: meta.sessionId || null, narrative: narrativeOverride != null ? narrativeOverride : '' }
  if (meta.parse_error) result.warnings.push({ code: 'PATCH_PARSE', message: 'patch 解析失败已降级：' + meta.parse_error })
  if (meta.unmarked) result.warnings.push({ code: 'PATCH_UNMARKED', message: '模型未输出协议标记，已按回复尾部裸 JSON 兜底识别（建议提示模型遵守状态记录协议）' })

  // ---- 空 patch / 显式无变化（条款 15/21/22）：三类严格区分，不再统一静默 ----
  if (!Object.keys(patch).length) {
    result.ok = true
    result.committed = false
    if (meta.noChange) {
      // 显式声明无状态变化：合法正常结束，不告警
      result.patch_status = 'NO_STATE_CHANGE'
      result.turn_id = result.turn_id + '-nsc'
    } else if (meta.patch_found === false) {
      // 模型没输出协议块（也没有 NO_STATE_CHANGE）：不可静默放行（条款 16/24）
      result.patch_status = 'PATCH_MISSING'
      result.retryable = true
      result.warnings.push({ code: 'PATCH_ABSENT', message: '模型未输出状态块且未声明 NO_STATE_CHANGE，本回合未写入结构化状态' })
      result.turn_id = result.turn_id + '-np'
    } else {
      // 有协议块但解析为空/损坏
      result.patch_status = 'PATCH_INVALID'
      result.retryable = true
      result.warnings.push({ code: 'PATCH_EMPTY', message: '状态块存在但内容为空或无法解析' })
      result.turn_id = result.turn_id + '-pi'
    }
    logTurn(store, story0, result, Object.assign({}, meta, { patch_found: meta.patch_found !== false }), patch, null)
    return result
  }

  // ---- 结构校验（resolve 前） ----
  const v = validatePatch(patch, { story: story0 })
  if (!v.ok) {
    result.patch_status = 'PATCH_CONFLICT' // 与历史状态/引用冲突（条款 15）
    result.errors = v.errors; result.warnings = v.warnings
    logTurn(store, story0, result, meta, patch, null)
    return result
  }
  result.warnings.push(...v.warnings)

  // ---- 开事务：所有改动发生在 staging 副本 ----
  const story = store.beginTransaction(storyId)
  try {
    // Session 登记 + Turn 递增
    story._currentSessionId = meta.sessionId || null
    if (meta.sessionId) Repos.openSession(story, { session_id: meta.sessionId }, now)
    story.counters.turn += 1
    const turnNo = story.counters.turn

    // ---- resolve：实体名 → id（缺失自动建），fact key → id，thread 引用 ----
    const resolved = { missing: [] }
    const entityByName = {}
    for (const e of patch.entity_changes || []) {
      const rec = Repos.upsertEntity(story, { name: e.name, type: e.type, state: e.state, tags: e.tags, summary: e.summary }, now)
      entityByName[String(e.name).toLowerCase()] = rec.entity_id
      ;(result.applied.entities = result.applied.entities || []).push(rec.entity_id)
    }
    const ensureEntity = (name) => {
      if (!name) return null
      const key = String(name).toLowerCase()
      if (entityByName[key]) return entityByName[key]
      const found = Repos.findEntity(story, { name })
      if (found) { entityByName[key] = found.entity_id; return found.entity_id }
      const rec = Repos.upsertEntity(story, { name, type: 'character' }, now)
      entityByName[key] = rec.entity_id
      resolved.missing.push({ kind: 'entity', ref: name, hard: false })
      return rec.entity_id
    }

    // facts（先于 knowledge/causal/decision 关联）
    const factByKey = {}
    for (const f of patch.facts || []) {
      const rec = Repos.addFact(story, {
        key: f.key, statement: f.statement,
        entity_ids: (f.entity_names || []).map(ensureEntity).filter(Boolean),
        secret_from_player: !!f.secret_from_player, importance: f.importance
      }, now)
      if (f.key) factByKey[f.key] = rec.fact_id
      ;(result.applied.facts = result.applied.facts || []).push(rec.fact_id)
    }

    // decisions（条款 10：source 硬闸在 Repos.addDecision 内）
    const newDecisionIds = []
    for (const d of patch.decisions || []) {
      const rec = Repos.addDecision(story, d, now)
      newDecisionIds.push(rec.decision_id)
      ;(result.applied.decisions = result.applied.decisions || []).push(rec.decision_id)
    }

    // commitments
    for (const c of patch.commitments || []) {
      const rec = Repos.addCommitment(story, {
        kind: c.kind, content: c.content, importance: c.importance, due_hint: c.due_hint,
        source_decision: newDecisionIds[0] || null,
        counterpart: c.counterpart_name ? ensureEntity(c.counterpart_name) : null
      }, now)
      ;(result.applied.commitments = result.applied.commitments || []).push(rec.commitment_id)
    }
    // commitment updates（编号精确 → 关键词模糊）
    for (const cu of patch.commitment_updates || []) {
      const c = resolveRef(story.commitments, cu.ref, 'commitment_id', (x) => x.content)
      if (!c) { result.errors.push({ code: 'COMMITMENT_REF_MISSING', message: '承诺未找到：' + cu.ref }); throw new Error('commitment ref missing') }
      Repos.updateCommitmentStatus(story, c.commitment_id, cu.status || 'FULFILLED', cu.note || '', now)
      ;(result.applied.commitment_updates = result.applied.commitment_updates || []).push(c.commitment_id)
    }

    // events
    for (const e of patch.events || []) {
      const rec = Repos.addEvent(story, {
        type: e.type, description: e.description, importance: e.importance,
        participants: (e.participant_names || []).map(ensureEntity).filter(Boolean),
        location: (patch.scene && patch.scene.location) || story.scene.location || '', game_time: (patch.scene && patch.scene.game_time) || story.scene.game_time || ''
      }, now)
      ;(result.applied.events = result.applied.events || []).push(rec.event_id)
    }

    // relationships
    for (const r of patch.relationships || []) {
      const sid = ensureEntity(r.source_name), tid = ensureEntity(r.target_name)
      const rec = Repos.upsertRelationship(story, { source: sid, target: tid, relation_type: r.relation_type, strength_delta: r.strength_delta, description: r.description }, now)
      ;(result.applied.relationships = result.applied.relationships || []).push(rec.relationship_id)
    }

    // knowledge（玩家认知；秘密泄漏已在 validator 拦截）
    for (const k of patch.knowledge || []) {
      const rec = Repos.addKnowledge(story, {
        fact_ref: k.fact_key ? (factByKey[k.fact_key] || k.fact_ref || null) : (k.fact_ref || null),
        content: k.content, how_learned: k.how_learned
      }, now)
      ;(result.applied.knowledge = result.applied.knowledge || []).push(rec.knowledge_id)
    }

    // threads
    for (const t of patch.threads || []) {
      const op = t.op || 'add'
      if (op === 'add') {
        const rec = Repos.addThread(story, { title: t.title, detail: t.detail, importance: t.importance }, now)
        ;(result.applied.threads = result.applied.threads || []).push(rec.thread_id)
      } else {
        const th = resolveRef(story.threads, t.ref, 'thread_id', (x) => x.title)
        if (!th) { result.errors.push({ code: 'THREAD_REF_MISSING', message: '伏笔未找到：' + t.ref }); throw new Error('thread ref missing') }
        Repos.updateThread(story, th.thread_id, { status: t.status, detail: t.detail }, now)
        ;(result.applied.thread_updates = result.applied.thread_updates || []).push(th.thread_id)
      }
    }

    // causal（默认挂本回合全部有效决定）
    for (const c of patch.causal || []) {
      const rec = Repos.addCausal(story, {
        cause: c.cause, effect: c.effect, importance: c.importance,
        source_decision: c.source_decision || (newDecisionIds.find((id) => { const d = Repos.getDecision(story, id); return d && DECISION_EFFECTIVE(d.status) }) || null)
      }, now)
      ;(result.applied.causal = result.applied.causal || []).push(rec.causal_id)
    }

    // scene
    if (patch.scene) {
      const sc = patch.scene
      if (sc.game_time != null) story.scene.game_time = String(sc.game_time).slice(0, 120)
      if (sc.location != null) { story.scene.location = String(sc.location).slice(0, 120); story.player.location = story.scene.location }
      if (Array.isArray(sc.participants)) story.scene.participants = sc.participants.map(ensureEntity).filter(Boolean)
      if (sc.summary != null) story.scene.summary = String(sc.summary).slice(0, 300)
      if (patch.turn_summary) story.scene.summary = String(patch.turn_summary).slice(0, 300)
      story.scene.turn_started = turnNo
    }

    // player state
    if (patch.player_state) {
      const ps = patch.player_state
      if (ps.location) story.player.location = String(ps.location).slice(0, 120)
      if (Array.isArray(ps.status_add)) story.player.status = Array.from(new Set(story.player.status.concat(ps.status_add.map(String)))).slice(0, 20)
      if (Array.isArray(ps.status_remove)) story.player.status = story.player.status.filter((s) => !ps.status_remove.includes(s))
      if (ps.resources_add && typeof ps.resources_add === 'object') {
        for (const [k, val] of Object.entries(ps.resources_add)) {
          const cur = Number(story.player.resources[k] || 0)
          const dv = Number(val)
          story.player.resources[k] = Number.isFinite(dv) && typeof val !== 'string' ? cur + dv : val
        }
      }
      if (ps.flags_add && typeof ps.flags_add === 'object') story.player.flags = Object.assign({}, story.player.flags, ps.flags_add)
      if (ps.custom && typeof ps.custom === 'object') story.player.custom = Object.assign({}, story.player.custom, ps.custom)
      if (ps.name) story.player.name = String(ps.name).slice(0, 60)
    }

    // resolved 校验（缺失实体已自动建，无 hard miss）
    const rv = validateResolved(patch, resolved)
    if (!rv.ok) { result.patch_status = 'PATCH_CONFLICT'; result.errors.push(...rv.errors); throw new Error('resolve validation failed') }

    // ---- 提交 ----
    story.updated_at = now
    if (meta.sessionId) Repos.touchSession(story, meta.sessionId, now)
    store.commitTransaction(storyId)
    result.ok = true
    result.committed = true
    result.patch_status = 'PATCH_PRESENT'
    logTurn(store, story, result, meta, patch, story)
    return result
  } catch (e) {
    // ---- 全回滚（条款 22：不合法不提交） ----
    store.rollbackTransaction(storyId)
    // 确定性冲突（引用未命中 / 非法状态迁移 / resolve 校验失败）归为 PATCH_CONFLICT；其余归为 COMMIT_FAILED（条款 15/22）
    const deterministicConflict = /ref missing|illegal .+ transition|resolve validation failed/.test(e.message)
    if (result.patch_status !== 'PATCH_CONFLICT') result.patch_status = deterministicConflict ? 'PATCH_CONFLICT' : 'COMMIT_FAILED'
    result.errors.push({ code: result.patch_status === 'PATCH_CONFLICT' ? 'PATCH_CONFLICT' : 'COMMIT_FAILED', message: e.message })
    logTurn(store, story0, result, meta, patch, null)
    return result
  }
}

/* ref 解析：优先精确编号，其次关键词包含匹配 */
function resolveRef(list, ref, idField, textField) {
  if (!ref) return null
  const r = String(ref).trim()
  const up = r.toUpperCase()
  let hit = list.find((x) => x[idField].toUpperCase() === up)
  if (hit) return hit
  const low = r.toLowerCase()
  hit = list.find((x) => (textField(x) || '').toLowerCase().includes(low))
  return hit && hit.status === 'ACTIVE' ? hit : (hit || null)
}

/* 回合诊断日志（条款 45 字段全覆盖） */
function logTurn(store, story, result, meta, patch, committedStory) {
  try {
    store.appendTurnLog(story.story_id, {
      turn_id: result.turn_id,
      story_id: story.story_id,
      session_id: result.session_id,
      timestamp: Date.now(),
      player_input: String(meta.playerInput || '').slice(0, 2000),
      intent: String(meta.intent || '').slice(0, 500),
      current_state_version: committedStory ? committedStory.counters.turn : story.counters.turn,
      patch_status: result.patch_status || null,
      patch_found: meta.patch_found !== false,
      retrieved_ids: meta.retrieved_ids || [],
      context_size: meta.contextSize || 0,
      model: meta.model || '',
      raw_llm_output: String(meta.rawOutput || '').slice(0, 4000),
      parsed_state_patch: patch,
      validation_result: { ok: result.ok, errors: result.errors, warnings: result.warnings },
      commit_result: { ok: result.ok, applied: result.applied },
      changed_state_ids: result.applied ? Object.values(result.applied).flat() : []
    })
  } catch { /* 日志失败不阻断主流程 */ }
}

module.exports = { commitPatch, commitFromRaw }

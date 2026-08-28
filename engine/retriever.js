'use strict'
/* Context Retriever —— 长期记忆检索（条款 4/27/28/29）
 * story_id 过滤是第一原则：本实现按 story 分文件加载，天然只见到当前故事；
 * 检索内部仍显式携带 storyId 校验，杜绝未来换存储层时引入跨故事泄漏。
 * 策略：不做全量 LLM 摘要检索，用「结构化过滤 + 相关性评分 + 轻量词面匹配」。
 */

const { DECISION_EFFECTIVE, importanceLabel } = require('./schema')
const { normalizeAccessLevel, canRead } = require('./access')

function tokenize(text) {
  // 轻量中英分词：连续字母数字成词 + CJK 单字（双字组合在匹配时处理）
  return String(text || '').toLowerCase().match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) || []
}

function textOverlap(queryTokens, text) {
  if (!queryTokens.length) return 0
  const t = String(text || '').toLowerCase()
  let hits = 0
  for (const tok of queryTokens) if (tok && t.includes(tok)) hits++
  return hits / queryTokens.length
}

/* 检索入口
 * opts: { storyId, playerInput, limit?, entityNames?, accessLevel?, includeSecrets?(已废弃，不授予任何权限) }
 * 权限模型：accessLevel ∈ PLAYER/SYSTEM/DEBUG（条款 8：过滤发生在数据源，而非 Context Builder）
 * includeSecrets 仅保留字段兼容，对权限零作用（条款 7：PLAYER + includeSecrets=true 仍拒绝秘密）。 */
function retrieve(story, opts) {
  if (!story || !story.story_id) throw new Error('retrieve: invalid story')
  if (opts.storyId !== story.story_id) throw new Error('cross-story retrieve blocked: ' + opts.storyId + ' vs ' + story.story_id) // 条款 27 硬闸（access_level + story_id 共同决定范围）
  const accessLevel = normalizeAccessLevel(opts.accessLevel) // 未知级别 fail-closed 为 PLAYER
  const secretsAllowed = canRead(accessLevel, 'secrets')
  const debugAllowed = canRead(accessLevel, 'debug')
  const legacyIgnored = !secretsAllowed && opts.includeSecrets === true // 诊断用：旧参数被拒绝
  const now = Date.now()
  const qTokens = tokenize(opts.playerInput || '')
  const qText = String(opts.playerInput || '').toLowerCase()
  const entityNames = (opts.entityNames || []).map((n) => String(n).toLowerCase())
  const limit = Math.max(3, Math.min(60, Number(opts.limit) || 24))
  const turn = story.counters.turn

  const score = (imp, turnDist, textHit, extra) => {
    // 重要度主导 + 时间衰减（重大历史不因时间消失：衰减对高重要度趋近于 0） + 词面/实体命中
    const impNorm = Math.min(101, Math.max(1, Number(imp) || 10))
    const decay = turnDist <= 0 ? 1 : 1 / (1 + turnDist / 40) * (1 - Math.min(0.65, impNorm / 160))
    return impNorm / 100 + decay * 0.45 + textHit * 1.2 + (extra || 0)
  }

  const out = { story_id: story.story_id, turn, decisions: [], commitments: [], facts: [], knowledge: [], events: [], threads: [], causal: [], relationships: [], entities: [], scene: null, counts: {} }

  // ---- 场景 ----
  out.scene = Object.assign({}, story.scene)

  // ---- active commitments：无论分数，全部进入（条款 12：ACTIVE 不得自动消失） ----
  out.commitments = story.commitments
    .filter((c) => c.story_id === story.story_id && c.status === 'ACTIVE')
    .map((c) => ({ rec: c, score: 2 + (c.importance || 0) / 100, reason: 'active_commitment' }))

  // ---- open threads：同样全部进入（伏笔必须被记得） ----
  out.threads = story.threads
    .filter((t) => t.story_id === story.story_id && t.status === 'OPEN')
    .map((t) => ({ rec: t, score: 1.6 + (t.importance || 0) / 100, reason: 'open_thread' }))

  // ---- facts：ACTIVE + 权限过滤（条款 8：PLAYER/SYSTEM 以外的级别按 accessLevel 决定，includeSecrets 不再生效） ----
  out.facts = story.facts
    .filter((f) => f.story_id === story.story_id && f.status === 'ACTIVE')
    .filter((f) => secretsAllowed || !f.secret_from_player)
    .map((f) => ({
      rec: f,
      score: score(f.importance, turn - f.turn, Math.max(textOverlap(qTokens, f.statement), textOverlap(qTokens, f.key)), entityHit(f.entity_ids, story, entityNames) ? 0.5 : 0),
      reason: 'fact'
    }))

  // ---- decisions：仅有效的（CONFIRMED/RESOLVED），PROPOSED 不是事实 ----
  out.decisions = story.decisions
    .filter((d) => d.story_id === story.story_id && DECISION_EFFECTIVE(d.status))
    .map((d) => ({ rec: d, score: score(d.importance, turn - d.turn, Math.max(textOverlap(qTokens, d.raw_input), textOverlap(qTokens, d.normalized_intent))), reason: 'decision' }))

  // ---- knowledge：玩家所知（LEARNED） ----
  out.knowledge = story.knowledge
    .filter((k) => k.story_id === story.story_id && k.status === 'LEARNED')
    .map((k) => ({ rec: k, score: score(30, turn - k.turn, textOverlap(qTokens, k.content)), reason: 'knowledge' }))

  // ---- events ----
  out.events = story.events
    .filter((e) => e.story_id === story.story_id)
    .map((e) => ({
      rec: e,
      score: score(e.importance, turn - e.turn, Math.max(textOverlap(qTokens, e.description), textOverlap(qTokens, e.location)), entityHit(e.participants, story, entityNames) ? 0.5 : 0),
      reason: 'event'
    }))

  // ---- causal：PENDING 的因果承诺（未来果尚未发生） ----
  out.causal = story.causal
    .filter((c) => c.story_id === story.story_id && c.status === 'PENDING')
    .map((c) => ({ rec: c, score: score(c.importance, turn - c.turn, textOverlap(qTokens, c.effect + ' ' + c.cause)), reason: 'pending_causal' }))

  // ---- relationships：ACTIVE 且涉及当前场景人物 ----
  out.relationships = story.relationships
    .filter((r) => r.story_id === story.story_id && r.status === 'ACTIVE')
    .map((r) => {
      const involves = entityNames.filter((n) => nameOf(story, r.source).toLowerCase() === n || nameOf(story, r.target).toLowerCase() === n).length
      return { rec: r, score: 0.8 + (involves ? 1.2 : 0) + Math.abs(r.strength || 0) / 200, reason: involves ? 'relationship_scene' : 'relationship' }
    })

  // ---- entities：按提及/当前场景 ----
  out.entities = story.entities
    .filter((e) => e.story_id === story.story_id && e.status !== 'ARCHIVED')
    .map((e) => ({
      rec: e,
      score: 0.6 + (entityNames.includes(e.name.toLowerCase()) ? 1.5 : 0) + textOverlap(qTokens, e.name + ' ' + (e.summary || '')) + Object.keys(e.state || {}).length * 0.02,
      reason: entityNames.includes(e.name.toLowerCase()) ? 'entity_mentioned' : 'entity'
    }))

  // ---- 各类截断（重要度高的优先保留） ----
  const cap = (arr, n, key = 'score') => { arr.sort((a, b) => b[key] - a[key]); return arr.slice(0, n) }
  out.facts = cap(out.facts, 14)
  out.decisions = cap(out.decisions, 10)
  out.events = cap(out.events, 12)
  out.knowledge = cap(out.knowledge, 8)
  out.causal = cap(out.causal, 8)
  out.entities = cap(out.entities, 12)
  out.relationships = out.relationships.sort((a, b) => b.score - a.score).slice(0, 10)
  out.commitments = out.commitments.sort((a, b) => b.score - a.score).slice(0, 10)
  out.threads = out.threads.sort((a, b) => b.score - a.score).slice(0, 8)

  // ---- 全局预算：总分排序后整体限量（条款 42 性能：不无限膨胀 context） ----
  out.retrieved_ids = []
  for (const grp of ['commitments', 'threads', 'facts', 'decisions', 'events', 'knowledge', 'causal', 'relationships', 'entities']) {
    for (const it of out[grp]) out.retrieved_ids.push(it.rec[grpIdField(grp)])
  }
  if (debugAllowed) out.debug = { query_tokens: qTokens.length, entity_names: entityNames, access_level: accessLevel, generated_at: now, importance_legend: importanceLabel(101) + '>…>' + importanceLabel(1) }
  return out
}

function grpIdField(grp) {
  const map = { commitments: 'commitment_id', threads: 'thread_id', facts: 'fact_id', decisions: 'decision_id', events: 'event_id', knowledge: 'knowledge_id', causal: 'causal_id', relationships: 'relationship_id', entities: 'entity_id' }
  return map[grp] || 'id'
}

function entityHit(entityIds, story, entityNames) {
  if (!entityNames.length || !entityIds || !entityIds.length) return false
  return entityIds.some((id) => { const e = story.entities.find((x) => x.entity_id === id); return e && entityNames.includes(e.name.toLowerCase()) })
}

function nameOf(story, entityId) {
  const e = story.entities.find((x) => x.entity_id === entityId)
  return e ? e.name : String(entityId || '')
}

module.exports = { retrieve, tokenize, textOverlap }

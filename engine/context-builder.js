'use strict'
/* Context Builder —— 把检索结果组装为可拼入 system 的文本块（条款 28）
 * 原则：Summary 是导航层，不是真相源（条款 20）——这里输出的全部来自 Ledger 原始记录。
 */

const { DECISION_EFFECTIVE, importanceLabel } = require('./schema')
const { normalizeAccessLevel, canRead } = require('./access')

function relName(story, entityId) {
  const e = story.entities.find((x) => x.entity_id === entityId)
  return e ? e.name : String(entityId || '?')
}

/* 生成「世界状态上下文」文本块。retrieved = retriever.retrieve() 的结果
 * accessLevel：二次权限校验（条款 10）——即使 Retriever 已过滤，这里仍复核一次；
 * PLAYER 级 Context 中发现任何秘密数据 → 拒绝生成（抛错，调用方不得继续调 LLM）。 */
function buildContextBlock(story, retrieved, accessLevel) {
  const level = normalizeAccessLevel(accessLevel)
  // ---- Context Permission Check（条款 10）----
  const secretHits = (retrieved.facts || []).filter((it) => it.rec && it.rec.secret_from_player && !canRead(level, 'secrets'))
  if (secretHits.length) {
    throw new Error('CONTEXT_PERMISSION_DENIED: PLAYER context 包含 ' + secretHits.length + ' 条秘密事实（' + secretHits.map((x) => x.rec.fact_id).join(',') + '）')
  }
  if (retrieved.debug && !canRead(level, 'debug')) {
    throw new Error('CONTEXT_PERMISSION_DENIED: ' + level + ' context 不允许携带调试数据')
  }
  const L = []
  const scene = retrieved.scene || story.scene
  L.push('【世界状态 · 结构化记忆（程序维护，非叙事摘要，须严格遵守）】')
  L.push('当前回合：第 ' + (story.counters.turn + 1) + ' 回合' + (scene && scene.game_time ? ' · 故事时间：' + scene.game_time : '') + (scene && scene.location ? ' · 地点：' + scene.location : ''))

  // 玩家状态
  const p = story.player
  const pBits = []
  if (p.location) pBits.push('位置:' + p.location)
  if (p.status && p.status.length) pBits.push('状态:' + p.status.join('/'))
  const resKeys = Object.keys(p.resources || {})
  if (resKeys.length) pBits.push('资源:' + resKeys.map((k) => k + '=' + p.resources[k]).join(', '))
  if (pBits.length) L.push('玩家状态：' + pBits.join('；'))

  // 场内实体
  if (retrieved.entities.length) {
    const lines = retrieved.entities.slice(0, 10).map((it) => {
      const e = it.rec
      const st = e.state && Object.keys(e.state).length ? ' 状态:' + JSON.stringify(e.state).slice(0, 160) : ''
      const sm = e.summary ? ' ' + String(e.summary).slice(0, 80) : ''
      return '  - ' + e.name + '（' + e.type + '）' + sm + st
    })
    L.push('相关实体：\n' + lines.join('\n'))
  }

  // 活跃承诺（必须被记住，不得自动消失）
  if (retrieved.commitments.length) {
    const lines = retrieved.commitments.slice(0, 8).map((it) => '  - [' + it.rec.commitment_id + '][' + it.rec.kind + '] ' + it.rec.content + (it.rec.due_hint ? '（' + it.rec.due_hint + '）' : ''))
    L.push('未完成承诺/目标（不得凭空消失，推进后须在状态块中了结）：\n' + lines.join('\n'))
  }

  // 开放伏笔
  if (retrieved.threads.length) {
    const lines = retrieved.threads.slice(0, 6).map((it) => '  - [' + it.rec.thread_id + '] ' + it.rec.title + (it.rec.detail ? '：' + String(it.rec.detail).slice(0, 100) : ''))
    L.push('开放伏笔/长线：\n' + lines.join('\n'))
  }

  // 待兑现因果
  if (retrieved.causal.length) {
    const lines = retrieved.causal.slice(0, 6).map((it) => '  - [' + it.rec.causal_id + '] ' + it.rec.cause + ' → ' + it.rec.effect)
    L.push('已埋因果（果尚未发生，择机兑现）：\n' + lines.join('\n'))
  }

  // 世界事实
  if (retrieved.facts.length) {
    const lines = retrieved.facts.slice(0, 12).map((it) => '  - [' + importanceLabel(it.rec.importance) + '] ' + it.rec.statement)
    L.push('世界事实（不可与之矛盾）：\n' + lines.join('\n'))
  }

  // 玩家已知信息
  if (retrieved.knowledge.length) {
    const lines = retrieved.knowledge.slice(0, 6).map((it) => '  - ' + it.rec.content)
    L.push('玩家角色已知：\n' + lines.join('\n'))
  }

  // 重要历史决定（条款式：AI 不得发明历史）
  if (retrieved.decisions.length) {
    const lines = retrieved.decisions.slice(0, 8).map((it) => {
      const d = it.rec
      return '  - [T' + d.turn + '][' + d.decision_id + '][' + d.status + '] ' + (d.normalized_intent || d.raw_input).slice(0, 100)
    })
    L.push('关键历史决定（已确认，不得否认或篡改）：\n' + lines.join('\n'))
  }

  // 近期重要事件
  if (retrieved.events.length) {
    const lines = retrieved.events.slice(0, 8).map((it) => '  - [T' + it.rec.turn + '] ' + it.rec.description.slice(0, 100))
    L.push('相关历史事件：\n' + lines.join('\n'))
  }

  // 关系
  if (retrieved.relationships.length) {
    const lines = retrieved.relationships.slice(0, 8).map((it) => {
      const r = it.rec
      return '  - ' + relName(story, r.source) + ' ↔ ' + relName(story, r.target) + '：' + r.relation_type + '（强度 ' + (r.strength > 0 ? '+' : '') + (r.strength || 0) + '）' + (r.description ? ' ' + r.description.slice(0, 60) : '')
    })
    L.push('人物关系：\n' + lines.join('\n'))
  }

  L.push('（以上记忆由引擎从结构化账本检索生成。与叙事摘要冲突时，以本块为准。）')
  return L.filter(Boolean).join('\n')
}

/* 快照/恢复时的状态总览（供 Inspector 与测试断言） */
function stateOverview(story) {
  return {
    story_id: story.story_id, title: story.title, engine_turn: story.counters.turn,
    kernel: story.kernel,
    scene: story.scene,
    player: story.player,
    counts: {
      entities: story.entities.length, decisions: story.decisions.filter((d) => DECISION_EFFECTIVE(d.status)).length,
      decisions_total: story.decisions.length,
      commitments_active: story.commitments.filter((c) => c.status === 'ACTIVE').length,
      facts_active: story.facts.filter((f) => f.status === 'ACTIVE').length,
      knowledge: story.knowledge.filter((k) => k.status === 'LEARNED').length,
      events: story.events.length, causal_pending: story.causal.filter((c) => c.status === 'PENDING').length,
      relationships: story.relationships.filter((r) => r.status === 'ACTIVE').length,
      threads_open: story.threads.filter((t) => t.status === 'OPEN').length,
      sessions: story.sessions.length
    }
  }
}

module.exports = { buildContextBlock, stateOverview }

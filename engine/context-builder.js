'use strict'
/* Context Builder —— 把检索结果组装为可拼入 system 的文本块（条款 28）
 * 原则：Summary 是导航层，不是真相源（条款 20）——这里输出的全部来自 Ledger 原始记录。
 *
 * v2：硬预算（规范三十七/三十八）——分节装配，超预算时按「价值优先级」从低到高裁剪条目，
 * ACTIVE 承诺/OPEN 伏笔保留合同最低配额（条款 12：不得自动消失）；预算内输出与旧版逐字节一致。
 * metaOut（可选）：回填 { budget_chars, used_chars, per_kind, truncated } 供 Context Debugger 与回合日志使用。
 */

const { DECISION_EFFECTIVE, importanceLabel } = require('./schema')
const { normalizeAccessLevel, canRead } = require('./access')

/* Context 硬上限（字符）：实测 5000 Turn 常态 ~2.5K，此上限只为防极端膨胀，不改变常态输出 */
const CONTEXT_CHAR_BUDGET = 16000

function relName(story, entityId) {
  const e = story.entities.find((x) => x.entity_id === entityId)
  return e ? e.name : String(entityId || '?')
}

/* 生成「世界状态上下文」文本块。retrieved = retriever.retrieve() 的结果
 * accessLevel：二次权限校验（条款 10）——即使 Retriever 已过滤，这里仍复核一次；
 * PLAYER 级 Context 中发现任何秘密数据 → 拒绝生成（抛错，调用方不得继续调 LLM）。 */
function buildContextBlock(story, retrieved, accessLevel, metaOut) {
  const level = normalizeAccessLevel(accessLevel)
  // ---- Context Permission Check（条款 10）----
  const secretHits = (retrieved.facts || []).filter((it) => it.rec && it.rec.secret_from_player && !canRead(level, 'secrets'))
  if (secretHits.length) {
    throw new Error('CONTEXT_PERMISSION_DENIED: PLAYER context 包含 ' + secretHits.length + ' 条秘密事实（' + secretHits.map((x) => x.rec.fact_id).join(',') + '）')
  }
  if (retrieved.debug && !canRead(level, 'debug')) {
    throw new Error('CONTEXT_PERMISSION_DENIED: ' + level + ' context 不允许携带调试数据')
  }

  /* 分节定义：prio = 裁剪优先级（数值大者先裁）；min = 合同保留配额 */
  const S = []
  const sec = (key, prio, min, header, items) => S.push({ key, prio, min, header, items: items || [] })

  // 头部（当前状态/场景）：永不裁剪
  const scene = retrieved.scene || story.scene
  const head = []
  head.push('当前回合：第 ' + (story.counters.turn + 1) + ' 回合' + (scene && scene.game_time ? ' · 故事时间：' + scene.game_time : '') + (scene && scene.location ? ' · 地点：' + scene.location : ''))

  // 玩家状态
  const p = story.player
  const pBits = []
  if (p.location) pBits.push('位置:' + p.location)
  if (p.status && p.status.length) pBits.push('状态:' + p.status.join('/'))
  const resKeys = Object.keys(p.resources || {})
  if (resKeys.length) pBits.push('资源:' + resKeys.map((k) => k + '=' + p.resources[k]).join(', '))
  if (pBits.length) head.push('玩家状态：' + pBits.join('；'))

  // 场内实体
  sec('entities', 2, 0, '相关实体：\n', (retrieved.entities || []).slice(0, 10).map((it) => {
    const e = it.rec
    const st = e.state && Object.keys(e.state).length ? ' 状态:' + JSON.stringify(e.state).slice(0, 160) : ''
    const sm = e.summary ? ' ' + String(e.summary).slice(0, 80) : ''
    return '  - ' + e.name + '（' + e.type + '）' + sm + st
  }))

  // 活跃承诺（必须被记住，不得自动消失）
  sec('commitments', 1, 6, '未完成承诺/目标（不得凭空消失，推进后须在状态块中了结）：\n', (retrieved.commitments || []).slice(0, 8).map((it) => '  - [' + it.rec.commitment_id + '][' + it.rec.kind + '] ' + it.rec.content + (it.rec.due_hint ? '（' + it.rec.due_hint + '）' : '')))

  // 开放伏笔
  sec('threads', 1, 4, '开放伏笔/长线：\n', (retrieved.threads || []).slice(0, 6).map((it) => '  - [' + it.rec.thread_id + '] ' + it.rec.title + (it.rec.detail ? '：' + String(it.rec.detail).slice(0, 100) : '')))

  // 待兑现因果
  sec('causal', 8, 0, '已埋因果（果尚未发生，择机兑现）：\n', (retrieved.causal || []).slice(0, 6).map((it) => '  - [' + it.rec.causal_id + '] ' + it.rec.cause + ' → ' + it.rec.effect))

  // 世界事实
  sec('facts', 5, 0, '世界事实（不可与之矛盾）：\n', (retrieved.facts || []).slice(0, 12).map((it) => '  - [' + importanceLabel(it.rec.importance) + '] ' + it.rec.statement))

  // 玩家已知信息
  sec('knowledge', 6, 0, '玩家角色已知：\n', (retrieved.knowledge || []).slice(0, 6).map((it) => '  - ' + it.rec.content))

  // 重要历史决定（条款式：AI 不得发明历史）
  sec('decisions', 3, 0, '关键历史决定（已确认，不得否认或篡改）：\n', (retrieved.decisions || []).slice(0, 12).map((it) => {
    const d = it.rec
    return '  - [T' + d.turn + '][' + d.decision_id + '][' + d.status + '] ' + (d.normalized_intent || d.raw_input).slice(0, 100)
  }))

  // 近期重要事件
  sec('events', 4, 0, '相关历史事件：\n', (retrieved.events || []).slice(0, 12).map((it) => '  - [T' + it.rec.turn + '] ' + it.rec.description.slice(0, 100)))

  // 关系
  sec('relationships', 7, 0, '人物关系：\n', (retrieved.relationships || []).slice(0, 8).map((it) => {
    const r = it.rec
    return '  - ' + relName(story, r.source) + ' ↔ ' + relName(story, r.target) + '：' + r.relation_type + '（强度 ' + (r.strength > 0 ? '+' : '') + (r.strength || 0) + '）' + (r.description ? ' ' + r.description.slice(0, 60) : '')
  }))

  /* ---- 预算装配：先全量，超预算则按 prio 从高到低、条目从尾到头裁剪（不低于 min 配额） ---- */
  const meta = { budget_chars: CONTEXT_CHAR_BUDGET, used_chars: 0, per_kind: {}, truncated: {} }
  const render = () => {
    const parts = ['【世界状态 · 结构化记忆（程序维护，非叙事摘要，须严格遵守）】'].concat(head)
    for (const s of S) {
      if (!s.items.length) continue
      parts.push(s.header + s.items.slice(0, s.keep != null ? s.keep : s.items.length).join('\n'))
    }
    parts.push('（以上记忆由引擎从结构化账本检索生成。与叙事摘要冲突时，以本块为准。）')
    return parts.filter(Boolean).join('\n')
  }
  let text = render()
  if (text.length > CONTEXT_CHAR_BUDGET) {
    for (;;) {
      // 找可裁节：keep 未到 min 且还有剩余条目，prio 最大者优先
      let victim = null
      for (const s of S) {
        const kept = s.keep != null ? s.keep : s.items.length
        if (kept > s.min) { if (!victim || s.prio > victim.prio) victim = s }
      }
      if (!victim) break
      victim.keep = (victim.keep != null ? victim.keep : victim.items.length) - 1
      text = render()
      meta.truncated[victim.key] = (meta.truncated[victim.key] || 0) + 1
      if (text.length <= CONTEXT_CHAR_BUDGET) break
    }
  }
  for (const s of S) meta.per_kind[s.key] = s.keep != null ? s.keep : s.items.length
  meta.used_chars = text.length
  if (metaOut) Object.assign(metaOut, meta)
  return text
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
    },
    /* 轻量清单（各截尾 30 条）：供移动端状态面板列表展示；附加字段，不影响既有消费方 */
    entities: story.entities.slice(-30).map((e) => ({ name: e.name })),
    facts: story.facts.filter((f) => f.status === 'ACTIVE').slice(-30).map((f) => ({ statement: f.statement })),
    commitments: story.commitments.filter((cm) => cm.status === 'ACTIVE').slice(-30).map((cm) => ({ content: cm.content, kind: cm.kind })),
    threads: story.threads.filter((t) => t.status === 'OPEN').slice(-30).map((t) => ({ title: t.title, detail: t.detail }))
  }
}

module.exports = { buildContextBlock, stateOverview, CONTEXT_CHAR_BUDGET }

'use strict'
/* Repository 层 —— 九大 Ledger + 实体库的领域接口
 * 规则：所有写操作必须在传入的 story 对象上进行（事务内的 staging 副本），
 *       所有读操作强制 story_id 过滤（条款 4/27，虽然文件级隔离已保证，仍显式校验）。
 */
const {
  nextId, canTransition, clampImportance,
  DECISION_TRANSITIONS, COMMITMENT_TRANSITIONS, THREAD_TRANSITIONS,
  FACT_TRANSITIONS, KNOWLEDGE_TRANSITIONS, IMPORTANCE_FLOOR
} = require('./schema')

function assertStory(story) {
  if (!story || !story.story_id) throw new Error('invalid story object')
  return story.story_id
}
function check(story, rec) {
  if (rec.story_id !== story.story_id) throw new Error('cross-story write blocked: ' + rec.story_id + ' -> ' + story.story_id)
}
function stamp(rec, story, now) {
  rec.story_id = story.story_id
  rec.created_at = rec.created_at || now
  rec.updated_at = now
  return rec
}

// ---- 实体名索引（name+type → id），懒重建 ----
function nameIndex(story) {
  if (!(story._nameIndex instanceof Map)) { // JSON 克隆会把 Map 退化成 {}（truthy 但非 Map），必须 instanceof 判定
    const m = new Map()
    for (const e of story.entities) m.set(e.type + '|' + e.name.toLowerCase(), e.entity_id)
    story._nameIndex = m
  }
  return story._nameIndex
}

const Repos = {
  // ================= 实体 =================
  findEntity(story, { name, type, entity_id }) {
    assertStory(story)
    if (entity_id) return story.entities.find((e) => e.entity_id === entity_id) || null
    if (!name) return null
    const key = (type || 'other') + '|' + String(name).toLowerCase()
    const id = nameIndex(story).get(key)
    if (id) return story.entities.find((e) => e.entity_id === id) || null
    // 类型不匹配时退化按名找（模型给错 type 是常态）
    return story.entities.find((e) => e.name.toLowerCase() === String(name).toLowerCase()) || null
  },
  upsertEntity(story, { name, type, state, tags, summary }, now) {
    if (!name || !String(name).trim()) throw new Error('entity name required')
    const ex = Repos.findEntity(story, { name, type })
    if (ex) {
      if (state && typeof state === 'object') ex.state = Object.assign({}, ex.state, state)
      if (Array.isArray(tags)) ex.tags = Array.from(new Set((ex.tags || []).concat(tags)))
      if (summary) ex.summary = summary
      ex.updated_at = now
      return ex
    }
    const rec = stamp({
      entity_id: nextId(story, 'entity'), name: String(name).trim(),
      type: type || 'other', state: state || {}, tags: tags || [], summary: summary || '',
      first_seen_turn: story.counters.turn, status: 'ACTIVE'
    }, story, now)
    story.entities.push(rec)
    nameIndex(story).set(rec.type + '|' + rec.name.toLowerCase(), rec.entity_id)
    return rec
  },

  // ================= Decision =================
  addDecision(story, d, now) {
    const rec = stamp({
      decision_id: nextId(story, 'decision'),
      raw_input: String(d.raw_input != null ? d.raw_input : '').slice(0, 2000), // 条款 9：保留原始输入
      normalized_intent: String(d.normalized_intent || d.action || '').slice(0, 500),
      status: d.status === 'PROPOSED' ? 'PROPOSED' : 'CONFIRMED',
      source: d.source === 'ai_option' ? 'ai_option' : 'user_input', // 条款 10：AI 选项不得直通 CONFIRMED
      importance: clampImportance(d.importance, IMPORTANCE_FLOOR.decision),
      reversible: d.reversible !== false,
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    if (rec.source === 'ai_option' && rec.status === 'CONFIRMED') rec.status = 'PROPOSED' // 硬闸
    story.decisions.push(rec)
    return rec
  },
  getDecision(story, id) {
    return story.decisions.find((d) => d.decision_id === id) || null
  },
  updateDecisionStatus(story, id, to, note, now) {
    const d = Repos.getDecision(story, id)
    if (!d) throw new Error('decision not found: ' + id)
    check(story, d)
    if (!canTransition(DECISION_TRANSITIONS, d.status, to)) {
      throw new Error('illegal decision transition ' + d.status + ' -> ' + to + ' (' + id + ')')
    }
    d.status = to
    d.status_note = note || ''
    d.updated_at = now
    return d
  },

  // ================= Commitment =================
  addCommitment(story, c, now) {
    const rec = stamp({
      commitment_id: nextId(story, 'commitment'),
      kind: c.kind || 'goal', // goal / promise / quest / contract
      content: String(c.content || '').slice(0, 800),
      status: 'ACTIVE',
      source_decision: c.source_decision || null,
      counterpart: c.counterpart || null, // 对象实体 id
      importance: clampImportance(c.importance, IMPORTANCE_FLOOR.commitment),
      due_hint: c.due_hint || '',
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    story.commitments.push(rec)
    return rec
  },
  getCommitment(story, id) { return story.commitments.find((c) => c.commitment_id === id) || null },
  updateCommitmentStatus(story, id, to, note, now) {
    const c = Repos.getCommitment(story, id)
    if (!c) throw new Error('commitment not found: ' + id)
    check(story, c)
    if (!canTransition(COMMITMENT_TRANSITIONS, c.status, to)) throw new Error('illegal commitment transition ' + c.status + ' -> ' + to + ' (' + id + ')')
    c.status = to; c.status_note = note || ''; c.updated_at = now
    return c
  },
  activeCommitments(story) { return story.commitments.filter((c) => c.status === 'ACTIVE') },

  // ================= Knowledge（玩家所知） =================
  addKnowledge(story, k, now) {
    const rec = stamp({
      knowledge_id: nextId(story, 'knowledge'),
      fact_ref: k.fact_ref || null,        // 若源自世界 Fact
      content: String(k.content || '').slice(0, 800),
      status: 'LEARNED',
      how_learned: k.how_learned || 'narrative', // narrative / told_by / observed / inferred
      confidence: k.confidence || 'normal',
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    story.knowledge.push(rec)
    return rec
  },
  getKnowledge(story, id) { return story.knowledge.find((k) => k.knowledge_id === id) || null },
  updateKnowledgeStatus(story, id, to, now) {
    const k = Repos.getKnowledge(story, id)
    if (!k) throw new Error('knowledge not found: ' + id)
    check(story, k)
    if (!canTransition(KNOWLEDGE_TRANSITIONS, k.status, to)) throw new Error('illegal knowledge transition ' + k.status + ' -> ' + to)
    k.status = to; k.updated_at = now
    return k
  },

  // ================= Fact（世界真实） =================
  addFact(story, f, now) {
    const key = f.key ? String(f.key).slice(0, 120) : ''
    // 幂等：同 key 同值不重复记
    if (key) {
      const dup = story.facts.find((x) => x.key === key && x.status === 'ACTIVE' && x.statement === f.statement)
      if (dup) return dup
      // 同 key 异值：旧 fact 自动取代（永不覆盖，SUPERSEDED 留痕 —— 条款 31）
      const old = story.facts.find((x) => x.key === key && x.status === 'ACTIVE')
    }
    const rec = stamp({
      fact_id: nextId(story, 'fact'),
      key, statement: String(f.statement || '').slice(0, 800),
      entity_ids: Array.isArray(f.entity_ids) ? f.entity_ids.slice(0, 20) : [],
      secret_from_player: !!f.secret_from_player, // 条款 13：世界真实 vs 玩家所知
      importance: clampImportance(f.importance, IMPORTANCE_FLOOR.fact),
      status: 'ACTIVE', superseded_by: null,
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    if (key) {
      for (const x of story.facts) {
        if (x.key === key && x.status === 'ACTIVE') { x.status = 'SUPERSEDED'; x.superseded_by = rec.fact_id; x.updated_at = now }
      }
    }
    story.facts.push(rec)
    return rec
  },
  getFact(story, id) { return story.facts.find((f) => f.fact_id === id) || null },
  updateFactStatus(story, id, to, now) {
    const f = Repos.getFact(story, id)
    if (!f) throw new Error('fact not found: ' + id)
    check(story, f)
    if (!canTransition(FACT_TRANSITIONS, f.status, to)) throw new Error('illegal fact transition ' + f.status + ' -> ' + to)
    f.status = to; f.updated_at = now
    return f
  },

  // ================= Event =================
  addEvent(story, e, now) {
    const rec = stamp({
      event_id: nextId(story, 'event'),
      type: e.type || 'other',
      description: String(e.description || '').slice(0, 800),
      participants: Array.isArray(e.participants) ? e.participants.slice(0, 20) : [], // entity ids
      location: e.location || '',
      game_time: e.game_time || '',
      importance: clampImportance(e.importance, IMPORTANCE_FLOOR.event),
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    story.events.push(rec)
    return rec
  },
  getEvent(story, id) { return story.events.find((e) => e.event_id === id) || null },

  // ================= Causal =================
  addCausal(story, c, now) {
    const rec = stamp({
      causal_id: nextId(story, 'causal'),
      cause: String(c.cause || '').slice(0, 400),
      effect: String(c.effect || '').slice(0, 400),
      source_decision: c.source_decision || null,   // decision id
      source_event: c.source_event || null,
      future_event: c.future_event || null,         // 事件真发生后回填
      status: 'PENDING',                            // PENDING / RESOLVED / CANCELLED
      importance: clampImportance(c.importance, IMPORTANCE_FLOOR.causal),
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    story.causal.push(rec)
    return rec
  },
  getCausal(story, id) { return story.causal.find((c) => c.causal_id === id) || null },
  updateCausalStatus(story, id, to, now) {
    const c = Repos.getCausal(story, id)
    if (!c) throw new Error('causal not found: ' + id)
    check(story, c)
    if (!['PENDING', 'RESOLVED', 'CANCELLED'].includes(to)) throw new Error('illegal causal status ' + to)
    c.status = to; c.updated_at = now
    return c
  },

  // ================= Relationship（多维） =================
  findRelationship(story, { source, target, relation_type }) {
    return story.relationships.find((r) => r.source === source && r.target === target && r.relation_type === relation_type && r.status === 'ACTIVE') || null
  },
  upsertRelationship(story, r, now) {
    if (!r.source || !r.target) throw new Error('relationship requires source & target entity ids')
    const ex = Repos.findRelationship(story, r)
    const delta = Number(r.strength_delta) || 0
    if (ex) {
      ex.strength = Math.min(100, Math.max(-100, (ex.strength || 0) + delta))
      if (r.description) ex.description = String(r.description).slice(0, 300)
      ex.updated_at = now
      return ex
    }
    const rec = stamp({
      relationship_id: nextId(story, 'relationship'),
      source: r.source, target: r.target,
      relation_type: r.relation_type || 'acquaintance',
      strength: Math.min(100, Math.max(-100, delta)),
      description: String(r.description || '').slice(0, 300),
      status: 'ACTIVE',
      turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    story.relationships.push(rec)
    return rec
  },

  // ================= Thread（伏笔/长线） =================
  addThread(story, t, now) {
    const rec = stamp({
      thread_id: nextId(story, 'thread'),
      title: String(t.title || '').slice(0, 200),
      detail: String(t.detail || '').slice(0, 600),
      status: 'OPEN',
      importance: clampImportance(t.importance, IMPORTANCE_FLOOR.thread),
      opened_turn: story.counters.turn,
      session_id: story._currentSessionId || null
    }, story, now)
    story.threads.push(rec)
    return rec
  },
  getThread(story, id) { return story.threads.find((t) => t.thread_id === id) || null },
  updateThread(story, id, patch, now) {
    const t = Repos.getThread(story, id)
    if (!t) throw new Error('thread not found: ' + id)
    check(story, t)
    if (patch.status) {
      if (!canTransition(THREAD_TRANSITIONS, t.status, patch.status)) throw new Error('illegal thread transition ' + t.status + ' -> ' + patch.status)
      t.status = patch.status
      if (patch.status === 'RESOLVED' || patch.status === 'ABANDONED') t.closed_turn = story.counters.turn
    }
    if (patch.detail) t.detail = String(patch.detail).slice(0, 600)
    t.updated_at = now
    return t
  },
  openThreads(story) { return story.threads.filter((t) => t.status === 'OPEN') },

  // ================= Session 登记簿 =================
  openSession(story, { session_id, label }, now) {
    let s = story.sessions.find((x) => x.session_id === session_id)
    if (s) { s.status = 'ACTIVE'; s.last_active = now; return s }
    s = stamp({ session_id, label: label || '', status: 'ACTIVE', opened_at: now, last_active: now, turn_started: story.counters.turn }, story, now)
    story.sessions.push(s)
    return s
  },
  touchSession(story, session_id, now) {
    const s = story.sessions.find((x) => x.session_id === session_id)
    if (s) s.last_active = now
    return s
  },
  closeSession(story, session_id, now) {
    const s = story.sessions.find((x) => x.session_id === session_id)
    if (s && s.status === 'ACTIVE') { s.status = 'CLOSED'; s.closed_at = now }
    return s
  }
}

module.exports = { Repos, nameIndex, assertStory }

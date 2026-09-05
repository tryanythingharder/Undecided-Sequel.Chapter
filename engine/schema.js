'use strict'
/* 六面世界 · 通用故事状态引擎 —— Schema 与常量
 * 分层：Kernel（模板）/ Story（世界实例）/ Session（交互连接）/ Turn（一次提交）
 * 本文件只含规则与工厂函数，不含 I/O。
 */

// ---- 通用 ID 段（九大 Ledger + 实体 + 快照 + 回合） ----
const ID_PREFIX = {
  story: 'STO',
  decision: 'DEC',
  commitment: 'CMT',
  knowledge: 'KNW',
  fact: 'FAC',
  event: 'EVT',
  causal: 'CAU',
  relationship: 'REL',
  thread: 'THR',
  entity: 'ENT',
  snapshot: 'SNP',
  turn: 'TRN',
  session: 'SES'
}

// ---- Decision 生命周期 ----
const DECISION_STATUS = ['PROPOSED', 'CONFIRMED', 'RESOLVED', 'SUPERSEDED', 'INVALIDATED']
// 合法跃迁表（漏列即非法）
const DECISION_TRANSITIONS = {
  PROPOSED: ['CONFIRMED', 'INVALIDATED', 'SUPERSEDED'],
  CONFIRMED: ['RESOLVED', 'SUPERSEDED', 'INVALIDATED'],
  RESOLVED: ['SUPERSEDED', 'INVALIDATED'],
  SUPERSEDED: [],
  INVALIDATED: []
}
// Decision 有效性判断：只有 CONFIRMED（以及历史性的 RESOLVED）算真实发生
const DECISION_EFFECTIVE = (s) => s === 'CONFIRMED' || s === 'RESOLVED'

// ---- Commitment 生命周期 ----
const COMMITMENT_STATUS = ['ACTIVE', 'FULFILLED', 'REVOKED', 'BROKEN', 'SUPERSEDED']
const COMMITMENT_TRANSITIONS = {
  ACTIVE: ['FULFILLED', 'REVOKED', 'BROKEN', 'SUPERSEDED'],
  FULFILLED: [],
  REVOKED: [],
  BROKEN: [],
  SUPERSEDED: []
}

// ---- Thread（伏笔/长线）生命周期 ----
const THREAD_STATUS = ['OPEN', 'RESOLVED', 'ABANDONED']
const THREAD_TRANSITIONS = {
  OPEN: ['RESOLVED', 'ABANDONED'],
  RESOLVED: [],
  ABANDONED: []
}

// ---- Fact 生命周期（仅取代，不删除） ----
const FACT_STATUS = ['ACTIVE', 'SUPERSEDED', 'INVALIDATED']
const FACT_TRANSITIONS = {
  ACTIVE: ['SUPERSEDED', 'INVALIDATED'],
  SUPERSEDED: [],
  INVALIDATED: []
}

// ---- Knowledge 生命周期 ----
const KNOWLEDGE_STATUS = ['LEARNED', 'RETRACTED', 'SUPERSEDED']
const KNOWLEDGE_TRANSITIONS = {
  LEARNED: ['RETRACTED', 'SUPERSEDED'],
  RETRACTED: ['LEARNED'],
  SUPERSEDED: []
}

// ---- Event ----
const EVENT_TYPES = ['action', 'dialogue', 'discovery', 'conflict', 'turning_point', 'arrival', 'departure', 'offscreen', 'other']

// ---- Entity ----
const ENTITY_TYPES = ['character', 'location', 'organization', 'item', 'creature', 'concept', 'faction', 'object', 'other']

// ---- Relationship（多维度，非单值） ----
const RELATION_STATUS = ['ACTIVE', 'ENDED', 'DORMANT']

// ---- 重要度分档（100=世界级不可磨灭 … 1=寒暄） ----
const IMPORTANCE_LEVELS = [
  { min: 100, max: 101, label: 'worldline', desc: '改变整个世界走向的重大事件' },
  { min: 80, max: 99, label: 'major', desc: '重大转折/核心人物死亡/主线关键' },
  { min: 50, max: 79, label: 'significant', desc: '重要决定、承诺、关系变化、新伏笔' },
  { min: 20, max: 49, label: 'notable', desc: '值得记住但非主线（结识、小冲突、新地点）' },
  { min: 5, max: 19, label: 'minor', desc: '细节、背景信息、临时状态' },
  { min: 1, max: 4, label: 'chitchat', desc: '寒暄、闲聊、无长期影响' }
]
const IMPORTANCE_FLOOR = { thread: 30, decision: 20, commitment: 20, fact: 10, causal: 10, event: 1, relationship: 10, knowledge: 1 }

// ---- Turn / Session ----
const SESSION_STATUS = ['ACTIVE', 'CLOSED']

// ---- StatePatch（LLM 输出协议）顶层键 ----
const PATCH_KEYS = [
  'turn_summary', 'scene', 'player_state', 'entity_changes', 'decisions',
  'commitments', 'commitment_updates', 'facts', 'events', 'relationships', 'knowledge', 'threads', 'causal',
  'causal_updates' // 因果闭环：已埋的因兑现/落空时把 PENDING → RESOLVED/CANCELLED（与 threads 对称）
]

// ---- 引擎版本（Story 文件内记录，向后迁移用） ----
const ENGINE_VERSION = 1

// ---- 工厂：全新 Story 骨架（不写盘，由 store 负责） ----
function createStory({ storyId, title, kernelId, kernelVersion, createdAt }) {
  return {
    schema_version: ENGINE_VERSION,
    story_id: storyId,
    title: title || '未命名故事',
    created_at: createdAt,
    updated_at: createdAt,
    // 内核绑定：创建时锁定版本；换版本需显式迁移（规则 39）
    kernel: { id: kernelId || 'default', version: kernelVersion || 'unknown', bound_at: createdAt },
    // 计数器：per-story ID 分配
    counters: { decision: 0, commitment: 0, knowledge: 0, fact: 0, event: 0, causal: 0, relationship: 0, thread: 0, entity: 0, snapshot: 0, turn: 0, session: 0 },
    // 当前场景
    scene: { game_time: '', location: '', participants: [], summary: '', turn_started: null },
    // 玩家状态
    player: { name: '', location: '', status: [], resources: {}, flags: {}, custom: {} },
    // Session 登记簿
    sessions: [],
    // 九大 Ledger（每条记录含 story_id 冗余字段，查询层强制过滤）
    decisions: [],
    commitments: [],
    knowledge: [],
    facts: [],
    events: [],
    causal: [],
    relationships: [],
    threads: [],
    // 实体库（通用，非仅人物）
    entities: [],
    // 软删除的重演记录（regen 时上一版叙事被丢弃的痕迹，永不静默覆盖）
    discarded_turns: [],
    // 索引缓存：name+type → entity_id（加载时重建）
    _nameIndex: null
  }
}

function nextId(story, kind) {
  const n = (story.counters[kind] || 0) + 1
  story.counters[kind] = n
  const p = ID_PREFIX[kind] || kind.toUpperCase()
  return p + '-' + String(n).padStart(6, '0')
}

// 状态跃迁合法性
function canTransition(table, from, to) {
  if (from === to) return true // 幂等无操作
  const allowed = table[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

function clampImportance(v, floor) {
  let n = Math.round(Number(v))
  if (!Number.isFinite(n)) n = 10
  if (floor && n < floor) n = floor
  return Math.min(101, Math.max(1, n))
}

function importanceLabel(v) {
  const n = Number(v)
  for (const lv of IMPORTANCE_LEVELS) if (n >= lv.min && n <= lv.max) return lv.label
  return 'minor'
}

module.exports = {
  ID_PREFIX, DECISION_STATUS, DECISION_TRANSITIONS, DECISION_EFFECTIVE,
  COMMITMENT_STATUS, COMMITMENT_TRANSITIONS, THREAD_STATUS, THREAD_TRANSITIONS,
  FACT_STATUS, FACT_TRANSITIONS, KNOWLEDGE_STATUS, KNOWLEDGE_TRANSITIONS,
  EVENT_TYPES, ENTITY_TYPES, RELATION_STATUS, IMPORTANCE_LEVELS, IMPORTANCE_FLOOR,
  SESSION_STATUS, PATCH_KEYS, ENGINE_VERSION,
  createStory, nextId, canTransition, clampImportance, importanceLabel
}

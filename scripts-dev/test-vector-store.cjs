'use strict'
/* sqlite-vec 语义索引（engine/vector-store.js）测试
 * 覆盖：建库/同步幂等/改述语义召回/故事隔离/增删改同步/检索管线集成/降级路径。
 * 运行时要求：node:sqlite + sqlite-vec（Node ≥22.13 / Electron 内置 Node）；缺失则跳过。 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createVectorStore, embed, semScore } = require('../engine/vector-store')
const { createEngine } = require('../engine/index')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-test-'))
const fails = []
const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

const vs = createVectorStore(dir)
if (!vs.enabled) {
  console.log('SKIP  当前运行时无 node:sqlite / sqlite-vec，向量索引测试跳过')
  process.exit(0)
}

function mkStory(id) {
  return {
    story_id: id,
    counters: { turn: 12 },
    facts: [
      { fact_id: 'F1', story_id: id, statement: '薇拉在旧桥救了玩家一命，从此欠下人情', key: '救命之恩', importance: 90, turn: 3, status: 'ACTIVE', entity_ids: [], secret_from_player: false },
      { fact_id: 'F2', story_id: id, statement: '集市的铜价三个月内翻了一倍', key: '物价', importance: 40, turn: 6, status: 'ACTIVE', entity_ids: [], secret_from_player: false },
      { fact_id: 'F3', story_id: id, statement: '旅人的印章来自被查禁的旧约教团', key: '印章来历', importance: 75, turn: 9, status: 'ACTIVE', entity_ids: [], secret_from_player: false }
    ],
    events: [
      { event_id: 'E1', story_id: id, description: '雾夜河谷的钟声第三次响起', location: '河谷北岸', importance: 55, turn: 4, participants: [] }
    ],
    decisions: [
      { decision_id: 'D1', story_id: id, raw_input: '我决定留下旧约的另一半', normalized_intent: '保留信物', importance: 70, turn: 10, status: 'CONFIRMED' }
    ]
  }
}

function mkStoryB(id) {
  // 内容与 S1 完全不同的第二个故事（用于隔离与计数断言）
  return {
    story_id: id,
    counters: { turn: 5 },
    facts: [
      { fact_id: 'F1', story_id: id, statement: '星舰的跃迁引擎需要冷却三个小时', key: '引擎冷却', importance: 50, turn: 2, status: 'ACTIVE', entity_ids: [], secret_from_player: false }
    ],
    events: [],
    decisions: []
  }
}

// 1. 同步 + 幂等
vs.sync(mkStory('S1'))
const st1 = vs.stats()
check('chunks-indexed', st1.chunks === 5, JSON.stringify(st1))
vs.sync(mkStory('S1'))
check('sync-idempotent', vs.stats().chunks === 5)

// 2. 改述语义召回：查询与 F1 的 key 共享「救命之恩」但表述不同（真实玩家问法）
const q1 = vs.search('S1', '我还没报答救命之恩，恩人是谁', 40)
const sF1 = q1.get('f|F1') || 0
const sF2 = q1.get('f|F2') || 0
check('semantic-recalls-paraphrase', sF1 > 0.25, 'F1=' + sF1.toFixed(3))
check('semantic-ranks-relevant-first', sF1 > sF2, 'F1=' + sF1.toFixed(3) + ' F2=' + sF2.toFixed(3))

// 3. 无关查询基线：不产生高分
const qNoise = vs.search('S1', '今天晚饭吃什么', 40)
check('unrelated-query-low-score', (qNoise.get('f|F1') || 0) < 0.1, 'F1=' + (qNoise.get('f|F1') || 0).toFixed(3))

// 4. 故事隔离：S2 与 S1 的 rec_id 同名（F1 各自存在），但 S1 独有的记录不得被 S2 查询召回
vs.sync(mkStoryB('S2'))
const q2 = vs.search('S2', '跃迁引擎冷却要多久', 40)
check('story-isolation', !q2.has('f|F2') && !q2.has('f|F3') && !q2.has('e|E1') && !q2.has('d|D1'), 'S2 查询不得召回 S1 独有记录')
check('isolation-keeps-own-hit', (q2.get('f|F1') || 0) > 0.2, 'S2 自身 F1=' + (q2.get('f|F1') || 0).toFixed(3))

// 5. 修改与删除同步
const s1b = mkStory('S1')
s1b.facts[0].statement = '薇拉托玩家把一封信带到南方渡口'
s1b.facts = s1b.facts.filter((f) => f.fact_id !== 'F3') // F3 被删除
vs.sync(s1b)
check('reindex-after-edit', vs.stats().chunks === 4 + 1, JSON.stringify(vs.stats())) // S1 剩 4 条 + S2 的 1 条
const q3 = vs.search('S1', '送信去南方渡口', 40)
check('updated-text-searchable', (q3.get('f|F1') || 0) > 0.25, 'F1=' + (q3.get('f|F1') || 0).toFixed(3))
const q4 = vs.search('S1', '印章 旧约教团', 40)
check('deleted-record-dropped', !q4.has('f|F3'))

// 6. 删除清理：forgetStory 移除该故事全部索引残留并清水位
vs.sync(mkStory('S1'))
const beforeForget = vs.stats().chunks
vs.forgetStory('S1')
check('forget-story-clears-rows', vs.stats().chunks === beforeForget - 5, JSON.stringify(vs.stats()))
check('forget-story-empty-search', (vs.search('S1', '救命之恩', 40) || new Map()).size === 0)
vs.sync(mkStory('S1')) // 水位已清：重新同步应完整恢复
check('forget-story-resync-rebuilds', vs.stats().chunks >= 5)

// 6.5 短词查询：trigram 无法匹配的 1~2 字词不得拖垮整次检索（双通道隔离回归）
const qShort = vs.search('S1', '薇拉 救', 40)
check('short-token-search-safe', qShort instanceof Map, '短词查询不返回 null/异常')
const qShortName = vs.search('S1', '薇拉在旧桥', 40)
check('short-query-vec-hits', (qShortName.get('f|F1') || 0) > 0.3, '名字+地点短查 F1=' + (qShortName.get('f|F1') || 0).toFixed(3))

// 7. 损坏自愈：关闭后把 memory.db 写成垃圾 → 重新打开应自动重建并可用
vs.close()
const dbPath = path.join(dir, 'memory.db')
fs.writeFileSync(dbPath, Buffer.from('this is not a sqlite database at all'.repeat(40)), 'utf8')
const vs2 = createVectorStore(dir)
check('corruption-selfheal-reopens', vs2.enabled === true)
vs2.sync(mkStory('S1'))
const qHeal = vs2.search('S1', '我还没报答救命之恩，恩人是谁', 40)
check('corruption-selfheal-usable', (qHeal.get('f|F1') || 0) > 0.2, 'F1=' + (qHeal.get('f|F1') || 0).toFixed(3))

// 8. 检索管线集成（createEngine 注入 _vec）
const engDir = path.join(dir, 'engine')
const engine = createEngine(engDir)
check('engine-vector-store-enabled', engine.vectorStore.enabled)
engine.ensureStory({ storyId: 'storyA', title: '测试故事', kernelId: 'k', kernelText: '# K' })
const story = engine.getStory('storyA')
story.counters.turn = 12
Object.assign(story, mkStory('storyA'), { story_id: 'storyA', counters: story.counters, kernel: story.kernel, entities: story.entities, scene: story.scene, sessions: story.sessions, knowledge: story.knowledge, commitments: story.commitments, threads: story.threads, causal: story.causal, relationships: story.relationships })
story.facts.forEach((f) => { f.story_id = 'storyA' })
story.events.forEach((e) => { e.story_id = 'storyA' })
story.decisions.forEach((d) => { d.story_id = 'storyA' })
engine.store.saveStory('storyA')
const r = engine.retrieve('storyA', { playerInput: '我还没报答救命之恩，恩人是谁', accessLevel: 'PLAYER' })
const hitF1 = r.facts.find((x) => x.rec.fact_id === 'F1')
check('retriever-uses-semantic-signal', !!hitF1 && hitF1._hit > 0.3, hitF1 ? 'hit=' + hitF1._hit.toFixed(3) : 'missing')
check('retriever-facts-present', r.facts.length > 0 && r.facts[0].rec.fact_id === 'F1')

// 8.1 deleteStory 联动清理语义索引
engine.ensureStory({ storyId: 'storyB', title: '删除测试', kernelId: 'k', kernelText: '# K' })
const sb = engine.getStory('storyB')
Object.assign(sb, mkStory('storyB'), { story_id: 'storyB', counters: sb.counters, kernel: sb.kernel, entities: [], scene: null, sessions: [], knowledge: [], commitments: [], threads: [], causal: [], relationships: [] })
sb.facts.forEach((f) => { f.story_id = 'storyB' })
engine.store.saveStory('storyB')
engine.retrieve('storyB', { playerInput: '引擎冷却', accessLevel: 'PLAYER' })
const storiesBeforeDel = engine.vectorStore.stats().stories
engine.deleteStory('storyB')
check('delete-story-cleans-index', engine.vectorStore.stats().stories === storiesBeforeDel - 1, storiesBeforeDel + '->' + engine.vectorStore.stats().stories)

// 10. 嵌入器机制：实例级选择 + 版本水位自动重嵌 + 向量随模型变化
const { EMBEDDERS } = require('../engine/vector-store')
check('embedder-registry', !!EMBEDDERS['hash-v1'] && !!EMBEDDERS['hash-v2'] && EMBEDDERS['hash-v1'].dim === 256)

const dirV2 = path.join(dir, 'v2-a')
const vsV2 = createVectorStore(dirV2, { embedder: 'hash-v2' })
vsV2.sync(mkStory('S1'))
check('embedder-selected', vsV2.stats().embedder === 'hash-v2', JSON.stringify(vsV2.stats()))
check('embedder-v2-search-works', ((vsV2.search('S1', '救命之恩恩人是谁', 40) || new Map()).get('f|F1') || 0) > 0.2)

// 版本水位：同一目录换嵌入器重开 → 检测到不一致自动全量重嵌
const vsReopen = createVectorStore(dirV2, { embedder: 'hash-v1' })
vsReopen.sync(mkStory('S1'))
check('watermark-rebuilds-on-model-change', vsReopen.stats().embedder === 'hash-v1' && vsReopen.stats().chunks === 5, JSON.stringify(vsReopen.stats()))
check('watermark-rebuilt-search-usable', ((vsReopen.search('S1', '救命之恩恩人是谁', 40) || new Map()).get('f|F1') || 0) > 0.2)
vsReopen.close()
vsV2.close()

// v1/v2 向量确有差异（同一文本不同模型 → 非同一向量）
const { embed: embedDispatch } = require('../engine/vector-store')
const eV1 = EMBEDDERS['hash-v1'].fn('救命之恩')
const eV2v = EMBEDDERS['hash-v2'].fn('救命之恩')
let dotVV = 0
for (let i = 0; i < eV1.length; i++) dotVV += eV1[i] * eV2v[i]
check('embedder-versions-differ', dotVV < 0.999, 'cos=' + dotVV.toFixed(3))
void embedDispatch

// 11. 降级路径：不可用的注入对象不破坏管线
const r2 = engine.retrieve('storyA', { playerInput: '救命之恩', accessLevel: 'PLAYER', _vec: { enabled: false, sync() {}, search() { return null } } })
check('fallback-without-vec', r2.facts.length > 0)

// 8. 不可用环境降级为 disabled（目录被文件占位 → 建库失败）
const blocker = path.join(dir, 'blocked')
fs.writeFileSync(blocker, 'x', 'utf8')
const vsBlocked = createVectorStore(blocker)
check('disabled-when-db-unavailable', vsBlocked.enabled === false && typeof vsBlocked.search === 'function')

// 9. 嵌入基础性质：单位化 + 确定性 + 分维
const e1 = embed('薇拉 救命之恩')
const e2 = embed('薇拉 救命之恩')
const e3 = embed('集市 铜价')
let dot11 = 0, dot13 = 0, norm = 0
for (let i = 0; i < e1.length; i++) { dot11 += e1[i] * e2[i]; dot13 += e1[i] * e3[i]; norm += e1[i] * e1[i] }
check('embedding-deterministic', Math.abs(dot11 - 1) < 1e-5)
check('embedding-normalized', Math.abs(norm - 1) < 1e-4)
check('embedding-differentiates', Math.abs(dot13) < 0.5, 'cos=' + dot13.toFixed(3))
check('semScore-calibration', semScore(1.5) === 0 && semScore(0.1) > 0.5)

vs.close()
engine.close() // 释放 engine 内部向量库句柄
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS')
process.exit(fails.length ? 1 : 0)

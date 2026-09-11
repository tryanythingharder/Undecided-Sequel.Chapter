'use strict'
/* 漫画回放（Comic Replay）引擎侧单测：素材整编器 buildComicSource
 * 覆盖：范围过滤 / 实体 id → 名翻译 / importance 压缩 / 转场保留 / patch 素材合入 /
 * cast 去重与 character 过滤。无 I/O（store 用桩替代）。
 * 运行：node scripts-dev/test-engine-comic.cjs
 */
const assert = require('node:assert')
const { buildComicSource } = require('../engine/index.js')

function mkStory() {
  return {
    story_id: 's1', title: '测试故事', counters: { turn: 8 },
    player: { name: '鲁迪', location: '布耶纳村' },
    entities: [
      { entity_id: 'E1', name: '鲁迪', type: 'character', summary: '转生少年' },
      { entity_id: 'E2', name: '洛琪希', type: 'character', summary: '魔术师傅', state: { hair: 'blue' } },
      { entity_id: 'L1', name: '布耶纳村', type: 'location', summary: '村庄' }
    ],
    events: [
      { turn: 1, type: 'action', description: '鲁迪诞生', participants: ['E1'], location: '布耶纳村', game_time: '甲龙历407.03.01', importance: 90 },
      { turn: 2, type: 'arrival', description: '洛琪希到访', participants: ['E2'], location: '布耶纳村', importance: 40 },
      { turn: 2, type: 'dialogue', description: '初次对话', participants: ['E1', 'E2'], location: '布耶纳村', importance: 30 },
      { turn: 4, type: 'turning_point', description: '拜师', participants: ['E1', 'E2'], location: '家', importance: 85 },
      { turn: 4, type: 'minor', description: '日常闲聊甲', participants: ['E1'], importance: 3 },
      { turn: 4, type: 'minor', description: '日常闲聊乙', participants: ['E1'], importance: 2 },
      { turn: 4, type: 'minor', description: '日常闲聊丙', participants: ['E1'], importance: 1 },
      { turn: 4, type: 'minor', description: '日常闲聊丁', participants: ['E1'], importance: 1 },
      { turn: 4, type: 'minor', description: '日常闲聊戊', participants: ['E1'], importance: 1 },
      { turn: 8, type: 'action', description: '学会魔术', participants: ['E1'], location: '野外', importance: 70 },
      { turn: 99, type: 'action', description: '范围外', participants: ['E1'], importance: 99 }
    ]
  }
}
const fakeStore = {
  listTurnLogs: () => ['TRN-000004'],
  readTurnLog: (_sid, tid) => tid === 'TRN-000004'
    ? { turn: 4, parsed_state_patch: { turn_summary: '鲁迪拜洛琪希为师', scene: { location: '家中', game_time: '夜晚', participants: ['鲁迪', '洛琪希'] } } }
    : null
}

let passed = 0
function ok(name, cond) { assert.ok(cond, name); passed++; console.log('  ✓ ' + name) }

console.log('== buildComicSource 素材整编 ==')
const r = buildComicSource(mkStory(), 1, 8, fakeStore)

ok('范围过滤：范围内回合 1/2/4/8', r.turns.map((t) => t.turn).join(',') === '1,2,4,8')
ok('范围外事件不泄漏（turn 99）', !r.turns.some((t) => t.turn === 99))
ok('实体 id → 名翻译', r.turns[1].participants.includes('洛琪希'))
ok('location 实体不进 turn participants', r.turns[0].participants.every((n) => n !== '布耶纳村'))

const t4 = r.turns[2]
ok('importance 压缩：turn 4 事件 ≤ 6 条（4 picked + 转场）', t4.events.length <= 6)
ok('压缩保留最高 importance（拜师 85 在列）', t4.events.some((e) => e.description === '拜师'))
ok('patch 素材合入（turn_summary）', t4.summary === '鲁迪拜洛琪希为师')
ok('patch scene 合入', t4.scene && t4.scene.location === '家中' && t4.scene.participants.length === 2)

ok('cast 只含 character（布耶纳村不在）', !r.cast.some((c) => c.name === '布耶纳村'))
ok('cast 玩家与实体同名去重', r.cast.filter((c) => c.name === '鲁迪').length === 1)
ok('cast 实体 state 序列化', r.cast.find((c) => c.name === '洛琪希').state.includes('hair'))
ok('total_turns 回传', r.total_turns === 8)

console.log('== 空范围 / 无事件 ==')
const r2 = buildComicSource(mkStory(), 50, 60, fakeStore)
ok('范围无事件 → turns 为空', r2.turns.length === 0)
ok('cast 仍然可用', r2.cast.length >= 2)

console.log('== 玩家名与实体不同名（无重复条目） ==')
const story2 = mkStory()
story2.player = { name: '保罗' }
const r3 = buildComicSource(story2, 1, 8, fakeStore)
ok('玩家无同名实体时补进 cast', r3.cast.some((c) => c.name === '保罗'))

console.log('\ntest-engine-comic: ' + passed + ' 项断言全部通过')

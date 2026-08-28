'use strict'
/* Context 权限模型自动化测试（条款 13 七项 + 策略单元检查）
 * 运行：node scripts-dev/test-access.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')
const { canRead, normalizeAccessLevel } = require('../engine/access')
const { buildContextBlock } = require('../engine/context-builder')

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) pass++
  else fail++
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond ? '' : '  << ' + JSON.stringify(extra).slice(0, 300)))
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-access-test-'))
const engine = createEngine(tmp)
const KERNEL = '权限测试内核。'

engine.ensureStory({ storyId: 'secA', title: '秘密故事A', kernelId: 'k', kernelText: KERNEL })
engine.ensureStory({ storyId: 'secB', title: '普通故事B', kernelId: 'k', kernelText: KERNEL })

// ============ 准备：storyA 写入公开事实 + 秘密事实（幕后黑手） ============
{
  const raw = '叙事。\n<<<STATE_PATCH>>>\n' + JSON.stringify({
    turn_summary: '村口初遇',
    facts: [
      { key: 'village_gate', statement: '村口的石门是三百年前所建', importance: 30 },
      { key: 'mastermind', statement: '血煞教主是幕后黑手', secret_from_player: true, importance: 90 }
    ],
    entities: void 0
  }) + '\n<<<END_PATCH>>>'
  const r = engine.commitFromRaw(raw, { storyId: 'secA', sessionId: 'SES-acc1', playerInput: '打量村口' })
  check('准备: 提交成功', r.ok === true, r.errors)
  check('准备: 秘密事实已入账（secret_from_player=true）', engine.getStory('secA').facts.some((f) => f.key === 'mastermind' && f.secret_from_player === true))
}

// ============ 测试 1：PLAYER 查询 Secret → 拒绝 ============
{
  const ctx = engine.buildContext('secA', { storyId: 'secA', playerInput: '幕后黑手 血煞教主', accessLevel: 'PLAYER' })
  const allText = JSON.stringify(ctx.retrieved.facts.map((f) => f.rec.statement)) + ctx.block
  check('t1: PLAYER 检索不含秘密事实', !allText.includes('幕后黑手') && !ctx.retrieved.retrieved_ids.includes('FAC-000002'), ctx.retrieved.facts.map((f) => f.rec.key))
  check('t1: PLAYER 可见公开事实', ctx.retrieved.facts.some((f) => f.rec.key === 'village_gate'))
}

// ============ 测试 2：PLAYER + includeSecrets=true → 仍然拒绝（条款 7） ============
{
  const r = engine.retrieve('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'PLAYER', includeSecrets: true })
  check('t2: includeSecrets=true 对 PLAYER 无效', !r.facts.some((f) => f.rec.key === 'mastermind'), r.facts.map((f) => f.rec.key))
  const ctx = engine.buildContext('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'PLAYER', includeSecrets: true })
  check('t2: buildContext 同样拒绝', !ctx.block.includes('幕后黑手'))
}

// ============ 测试 3：SYSTEM 查询允许的隐藏状态 → 通过 ============
{
  const r = engine.retrieve('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'SYSTEM' })
  check('t3: SYSTEM 可见秘密事实', r.facts.some((f) => f.rec.key === 'mastermind'))
  check('t3: SYSTEM 不可见 debug 数据（debug 仅 DEBUG 级）', !r.debug)
  // SYSTEM 也不受 includeSecrets 影响与否——不依赖它
  const r2 = engine.retrieve('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'SYSTEM', includeSecrets: false })
  check('t3: SYSTEM 权限来自 accessLevel 而非 includeSecrets', r2.facts.some((f) => f.rec.key === 'mastermind'))
}

// ============ 测试 4：DEBUG 查询完整状态 → 通过 ============
{
  const r = engine.retrieve('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'DEBUG' })
  check('t4: DEBUG 可见秘密事实', r.facts.some((f) => f.rec.key === 'mastermind'))
  check('t4: DEBUG 携带调试信息', r.debug && r.debug.access_level === 'DEBUG')
  const ctx = engine.buildContext('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'DEBUG' })
  check('t4: DEBUG Context 包含秘密', ctx.block.includes('幕后黑手'))
}

// ============ 测试 5：Story A PLAYER 不能读取 Story B Secret（跨故事） ============
{
  let threw = false
  try { engine.retrieve('secB', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'PLAYER' }) } catch (e) { threw = String(e.message).includes('cross-story') }
  check('t5: 跨 story 检索硬闸（PLAYER）', threw)
  const ctxB = engine.buildContext('secB', { storyId: 'secB', playerInput: '幕后黑手 血煞教主', accessLevel: 'PLAYER' })
  check('t5: Story B 的 PLAYER Context 不含 Story A 秘密', !ctxB.block.includes('幕后黑手'))
}

// ============ 测试 6：Story A DEBUG 不能读取 Story B DEBUG 数据 ============
{
  let threw = false
  try { engine.retrieve('secB', { storyId: 'secA', playerInput: 'x', accessLevel: 'DEBUG' }) } catch (e) { threw = String(e.message).includes('cross-story') }
  check('t6: 跨 story 检索硬闸（DEBUG 同样受限）', threw)
  const ctxB = engine.buildContext('secB', { storyId: 'secB', playerInput: '幕后黑手', accessLevel: 'DEBUG' })
  check('t6: Story B DEBUG Context 不含 Story A 数据', !ctxB.block.includes('幕后黑手'))
}

// ============ 测试 7：PLAYER Context Builder 人为注入 Secret → 拒绝生成 Context ============
{
  // 绕过 retriever（模拟未来调用路径的错误）：用 SYSTEM 检索结果直接喂给 PLAYER 级 buildContextBlock
  const rSystem = engine.retrieve('secA', { storyId: 'secA', playerInput: '幕后黑手', accessLevel: 'SYSTEM' })
  const story = engine.getStory('secA')
  let threw = false, msg = ''
  try { buildContextBlock(story, rSystem, 'PLAYER') } catch (e) { threw = true; msg = String(e.message) }
  check('t7: 二次权限校验拒绝（CONTEXT_PERMISSION_DENIED）', threw && msg.includes('CONTEXT_PERMISSION_DENIED'), msg)
  // debug 数据注入同样拒绝
  let threw2 = false
  try { buildContextBlock(story, Object.assign({}, rSystem, { debug: { x: 1 } }), 'PLAYER') } catch (e) { threw2 = String(e.message).includes('CONTEXT_PERMISSION_DENIED') }
  check('t7: debug 数据注入 PLAYER Context 同样拒绝', threw2)
  // 正常路径不受影响
  const rPlayer = engine.retrieve('secA', { storyId: 'secA', playerInput: '村口 石门', accessLevel: 'PLAYER' })
  const block = buildContextBlock(story, rPlayer, 'PLAYER')
  check('t7: 正常 PLAYER Context 生成不受影响', block.includes('世界状态') && !block.includes('幕后黑手'))
}

// ============ 策略单元检查（fail-closed 原则） ============
{
  check('p1: 未知级别降级为 PLAYER', normalizeAccessLevel('GOD') === 'PLAYER' && normalizeAccessLevel(undefined) === 'PLAYER')
  check('p2: 大小写不敏感', normalizeAccessLevel('debug') === 'DEBUG')
  check('p3: canRead 矩阵', canRead('PLAYER', 'secrets') === false && canRead('SYSTEM', 'secrets') === true && canRead('DEBUG', 'secrets') === true)
  check('p4: debug 仅 DEBUG', canRead('PLAYER', 'debug') === false && canRead('SYSTEM', 'debug') === false && canRead('DEBUG', 'debug') === true)
  check('p5: 普通数据三级可读', canRead('PLAYER', 'decisions') === true && canRead('SYSTEM', 'entities') === true)
}

console.log('\n== 权限测试: ' + pass + ' 通过, ' + fail + ' 失败 ==')
process.exit(fail ? 1 : 0)

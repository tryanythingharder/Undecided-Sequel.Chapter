#!/usr/bin/env node
/*
 * bloub 机器人单元测试：引擎快照确定性 + 挂载层契约（纯 JS，无 DOM 依赖部分）
 * 覆盖：
 *   1. shared/bloub.js 引擎快照——同一状态序列、同一采样时刻，两轮输出逐字节一致
 *      （上游核心承诺：sample(t) 是时间的纯函数；转译不得破坏这一点）
 *   2. 15 个状态各自产出合法 path（M...Z）且眼睛/粒子/弧线数量与状态定义吻合
 *   3. 挂载层脚本可被脚本化加载（IIFE 语义）且导出面存在
 * 运行：node scripts-dev/test-bloub.cjs（无外部依赖）
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
let pass = 0, fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.error('  ✗ ' + name) }
}

// ---- 装载引擎（浏览器 IIFE → vm 沙箱，等价于 <script> 标签加载）----
const src = fs.readFileSync(path.join(ROOT, 'shared', 'bloub.js'), 'utf8')
const sandbox = { console, Math, Date }
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(src, sandbox)
const B = sandbox.Bloub

console.log('bloub 引擎（转译自 jeremy-prt/bloub）')

// ---- 1. API 面 ----
ok(typeof B === 'object' && B, '全局 Bloub 存在')
ok(typeof B.BotEngine === 'function', 'BotEngine 可构造')
ok(typeof B.lookTarget === 'function', 'lookTarget 导出')
ok(typeof B.defaultCycle === 'function', 'defaultCycle 导出')
ok(Array.isArray(B.BLOUD_STATE_IDS) && B.BLOUD_STATE_IDS.length === 15, '15 个状态 id（14 序列 + swirl）')

// ---- 2. 逐状态合法性 ----
// 期望值来自上游 states.ts 的定义（eyes 是可见眼数、dots 粒子/装饰数、arcs 弧线数）
const EXPECT = {
  idle: { eyes: 2, dots: 0, arcs: 0 },
  thinking: { eyes: 0, dots: 2, arcs: 0 },
  wink: { eyes: 2, dots: 0, arcs: 0 },
  wide: { eyes: 2, dots: 0, arcs: 0 },
  alert: { eyes: 0, dots: 1, arcs: 0 },
  notify: { eyes: 2, dots: 0, arcs: 0 },
  exclaim: { eyes: 0, dots: 1, arcs: 0 },
  sleep: { eyes: 0, dots: 0, arcs: 0 },
  egg: { eyes: 2, dots: 0, arcs: 0 },
  hexagon: { eyes: 2, dots: 0, arcs: 0 },
  play: { eyes: 2, dots: 0, arcs: 4 },
  orbit: { eyes: 2, dots: 0, arcs: 6 },
  burst: { eyes: 0, dots: 3, arcs: 0 },
  comet: { eyes: 0, dots: 0, arcs: 4 },
  swirl: { eyes: 2, dots: 0, arcs: 3 }
}
for (const [st, exp] of Object.entries(EXPECT)) {
  const e = new B.BotEngine(100, st)
  const f = e.sample(1)
  const pathOk = f.bodyPath.startsWith('M') && f.bodyPath.endsWith('Z') && f.bodyPath.length > 20
  ok(pathOk, st + '：bodyPath 为合法闭合路径')
  ok(f.eyes.length === exp.eyes && f.dots.length === exp.dots && f.arcs.length === exp.arcs,
    st + '：要素数量吻合（eyes ' + f.eyes.length + '/' + exp.eyes + '，dots ' + f.dots.length + '/' + exp.dots + '，arcs ' + f.arcs.length + '/' + exp.arcs + '）')
}

// ---- 3. 快照确定性（时间纯函数承诺）----
// 同一状态序列、同一时刻序列，跑两轮：bodyPath/matrix/alpha 必须逐字节一致
function runTimeline() {
  const seq = B.BLOUD_STATE_IDS.filter((s) => s !== 'swirl')
  const e = new B.BotEngine(100, 'idle')
  let t = 0
  const out = []
  for (let n = 0; n < 3000; n++) {
    e.setState(seq[Math.floor(n / 215) % seq.length], t)
    const f = e.sample(t)
    out.push(f.bodyPath)
    out.push(f.eyes.map((x) => x.matrix + ':' + x.alpha).join(','))
    out.push(f.dots.map((x) => x.x + ',' + x.y + ',' + x.r).join(','))
    out.push(String(f.arcs.length))
    t += 1 / 60
  }
  return out
}
const a = runTimeline()
const b = runTimeline()
let diffs = 0
for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++
ok(diffs === 0, '3000 帧两轮重放零差异（sample(t) 确定性）')

// 眨眼日历：idle 采样应出现 y 轴压缩（blinkScale 压 matrix 的 b/d 分量；alpha 只管深度淡出）
{
  const e = new B.BotEngine(100, 'idle')
  let minB = 1
  for (let t = 1.0; t < 12; t += 1 / 60) {
    const f = e.sample(t)
    for (const eye of f.eyes) {
      const m = eye.matrix.match(/matrix\(([^)]+)\)/)
      if (m) minB = Math.min(minB, Math.abs(Number(m[1].split(',')[1])))
    }
  }
  ok(minB < 0.9, '12s idle 内出现眨眼压缩（liveliness 活体感，|b|min=' + minB.toFixed(2) + '）')
}

// ---- 4. 挂载层脚本语法 + 导出面（无 DOM 下只验证可解析、IIFE 不立即执行 DOM 操作）----
const mountSrc = fs.readFileSync(path.join(ROOT, 'shared', 'bloub-mount.js'), 'utf8')
new (require('node:vm').Script)(mountSrc) // 语法解析（不执行）
ok(true, 'bloub-mount.js 语法可解析')
const probe = { window: {} }
probe.window = probe
vm.createContext(probe)
vm.runInContext(mountSrc.replace(/document\.createElementNS/g, 'undefined && document.createElementNS'), probe)
ok(typeof probe.window.BloubMount === 'object' && typeof probe.window.BloubMount.mount === 'function', 'BloubMount.mount 导出（IIFE 顶层无 DOM 依赖）')
ok(Array.isArray(probe.window.BloubMount.IDLE_CYCLE) && probe.window.BloubMount.IDLE_CYCLE.length === 8, 'IDLE_CYCLE 为 8 段待机循环')

// ---- 5. 桌宠（renderer-proto/bloub-pet.js）：语法 + 规则问答契约 ----
const petSrc = fs.readFileSync(path.join(ROOT, 'shared', 'bloub-pet.js'), 'utf8')
new (require('node:vm').Script)(petSrc)
ok(true, 'bloub-pet.js 语法可解析')
const petProbe = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, console }
petProbe.window = petProbe
vm.createContext(petProbe)
vm.runInContext(petSrc, petProbe)
const Pet = petProbe.window.BloubPet
ok(typeof Pet === 'object' && typeof Pet.init === 'function' && typeof Pet.event === 'function', 'BloubPet 导出 init/event（IIFE 顶层无 DOM 依赖）')
ok(typeof Pet.ask === 'function', 'BloubPet.ask 规则问答可直调')
// 规则库契约：每个关键主题都有非空回答
const QUESTIONS = ['怎么开始', '快捷键', '主题', '未落账', '进度包', '内核', 'IF 分歧', '密钥', '报错', '搜索', '你是谁', '帮助']
for (const q of QUESTIONS) {
  const a = Pet.ask(q)
  ok(typeof a === 'string' && a.length > 10, '问答「' + q + '」命中（' + (a ? a.length : 0) + ' 字）')
}
// 兜底：无关问题不给规则答案（phase-1 由本地小模型接手的边界）
ok(Pet.ask('量子力学怎么入门') === null, '无关问题返回 null（兜底话术走气泡层）')
ok(/世界之灵/.test(Pet.systemPrompt), 'systemPrompt 预置人设（本地小模型接入时复用）')

// ---- 6. 回复清洗管线（shared/pet-reply.cjs）：主进程出口统一清洗 ----
const reply = require(path.join(ROOT, 'shared', 'pet-reply.cjs'))
ok(typeof reply.sanitizePetReply === 'function' && typeof reply.timeContextLine === 'function', 'pet-reply 导出 sanitizePetReply/timeContextLine')
{
  const out = reply.sanitizePetReply('好的。\n\n[点击后显示一个插画]\n\n**加粗**、*斜体*、# 标题都该被清掉。')
  ok(!/\[|\]|\*\*|^#/m.test(out), '方括号幻觉 UI 与 markdown 渣被剥离')
  ok(/加粗/.test(out) && /斜体/.test(out), '加粗/斜体文字本身保留')
  const messy = reply.sanitizePetReply('好。好。。好！！！\n\n\n\n一句话呀')
  ok(!/。{2,}/.test(messy) && !/！{2,}/.test(messy) && !/\n{3,}/.test(messy), '重复标点与多余换行被收束')
  const long = reply.sanitizePetReply('这是第一句。这是第二句！这是第三句？这是第四句。' + '很长很长'.repeat(80) + '。收尾。')
  ok(long.length <= 220, '超长回复收束到 220 字内（实际 ' + long.length + '）')
  ok(/第一句/.test(long) && !/收尾/.test(long), '收束保留开头整句、丢弃尾部')
  ok(reply.sanitizePetReply('') === '' && reply.sanitizePetReply(null) === '', '空输入安全返回')
  const tc = reply.timeContextLine()
  ok(/（现在是 \d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}，星期[日一二三四五六]）/.test(tc), '时间上下文格式（' + tc + '）')
}
// 大脑路由导出面：setCloudBrain / brain（有效路由 cloud → local → null）
ok(typeof Pet.setCloudBrain === 'function' && typeof Pet.brain === 'function', 'BloubPet 导出 setCloudBrain/brain')
ok(Pet.brain() === null, '无云端无本地时 brain() 为 null（气泡走兜底话术）')
Pet.setCloudBrain({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'big-model' })
ok(Pet.brain() === 'cloud', '仅云端可用时 brain() = cloud')
Pet.setCloudBrain(null)
ok(Pet.brain() === null, '清空云端后 brain() 回到 null')

console.log('')
console.log('bloub：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)

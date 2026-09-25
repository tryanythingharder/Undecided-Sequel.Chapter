#!/usr/bin/env node
/*
 * bloub 机器人单元测试：引擎快照确定性 + 挂载层契约（纯 JS，无 DOM 依赖部分）
 * 覆盖：
 *   1. ui/shared/bloub.js 引擎快照——同一状态序列、同一采样时刻，两轮输出逐字节一致
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
const src = fs.readFileSync(path.join(ROOT, 'ui', 'shared', 'bloub.js'), 'utf8')
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
const mountSrc = fs.readFileSync(path.join(ROOT, 'ui', 'shared', 'bloub-mount.js'), 'utf8')
new (require('node:vm').Script)(mountSrc) // 语法解析（不执行）
ok(true, 'bloub-mount.js 语法可解析')
const probe = { window: {} }
probe.window = probe
vm.createContext(probe)
vm.runInContext(mountSrc.replace(/document\.createElementNS/g, 'undefined && document.createElementNS'), probe)
ok(typeof probe.window.BloubMount === 'object' && typeof probe.window.BloubMount.mount === 'function', 'BloubMount.mount 导出（IIFE 顶层无 DOM 依赖）')
ok(Array.isArray(probe.window.BloubMount.IDLE_CYCLE) && probe.window.BloubMount.IDLE_CYCLE.length === 8, 'IDLE_CYCLE 为 8 段待机循环')

// ---- 5. 桌宠（ui/shared/bloub-pet.js）：语法 + 规则问答契约 ----
const petSrc = fs.readFileSync(path.join(ROOT, 'ui', 'shared', 'bloub-pet.js'), 'utf8')
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

// ---- 6. 回复清洗管线（ui/shared/pet-reply.cjs）：主进程出口统一清洗 ----
const reply = require(path.join(ROOT, 'ui', 'shared', 'pet-reply.cjs'))
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

// 智能体意图路由：自然语言 → 四种任务（路由命中即不闲聊直接做事）
ok(typeof Pet.agentIntent === 'function', 'BloubPet 导出 agentIntent（意图路由可直测）')
{
  const T = (q) => JSON.stringify(Pet.agentIntent(q))
  ok(Pet.agentIntent('选哪个好呀') && JSON.parse(T('选哪个好呀')).task === 'recommend', '「选哪个」→ recommend')
  ok(JSON.parse(T('帮我推荐选择')).task === 'recommend', '「推荐选择」→ recommend')
  const auto1 = Pet.agentIntent('托管帮我先选接下来的几轮')
  ok(auto1 && auto1.task === 'autopilot' && auto1.rounds === 3, '「托管几轮」无数字 → 默认 3 轮')
  const auto2 = Pet.agentIntent('替我选 5 轮')
  ok(auto2 && auto2.task === 'autopilot' && auto2.rounds === 5, '「替我选 5 轮」→ 5 轮')
  const auto3 = Pet.agentIntent('帮我选 9 轮')
  ok(auto3 && auto3.rounds === 5, '轮数上限 5（9 → 5）')
  ok(JSON.parse(T('哪一幕插图最好看')).task === 'illust', '「哪一幕插图最好看」→ illust')
  ok(JSON.parse(T('在那一幕回复生成插图最好看的是哪个')).task === 'illust', '「插图哪个幕」→ illust')
  ok(JSON.parse(T('帮我优化生图的提示词')).task === 'prompt', '「优化生图提示词」→ prompt')
  ok(Pet.agentIntent('今天天气怎么样') === null, '普通闲聊不进智能体路由（null → 双大脑闲聊）')
  ok(Pet.agentIntent('快捷键') === null, '规则库问题不进智能体路由')
}

// 主进程 pet:agent 容错提取（petAgentExtractPlan：JSON 围栏/杂文/非法键防护）——通过 main.cjs 源内函数直测
{
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8')
  new (require('node:vm').Script)(mainSrc) // 语法可解析
  // 提取 petAgentExtractPlan 函数体做沙箱直测（独立纯函数，无 Electron 依赖）
  const m = mainSrc.match(/function petAgentExtractPlan[\s\S]*?\n}/)
  ok(!!m, 'main.cjs 含 petAgentExtractPlan 纯函数')
  if (m) {
    const sandbox = { Number, Array, String }
    vm.createContext(sandbox)
    const extract = vm.runInContext('(' + m[0] + ')', sandbox)
    const choices = [{ key: 'A', label: '甲' }, { key: 'B', label: '乙' }, { key: 'C', label: '丙' }]
    ok(extract('choice', '{"recommend":"B","why":"更稳"}', { choices }).recommend === 'B', '裸 JSON 提取成功')
    ok(extract('choice', '```json\n{"recommend":"A","why":"x"}\n```', { choices }).recommend === 'A', 'markdown 围栏被剥')
    ok(extract('choice', '好的我认为：{"recommend":"C","why":"z"} 以上。', { choices }).recommend === 'C', '杂文包裹 JSON 提取')
    ok(extract('choice', '{"recommend":"Z","why":"x"}', { choices }) === null, '推荐键不在选项内 → 拒绝')
    ok(extract('choice', '完全不是 JSON', { choices }) === null, '非 JSON → null')
    const alt = extract('choice', '{"recommend":"A","alternates":["B","Z","A"]}', { choices })
    ok(alt.alternates.join('') === 'B', '备选过滤非法键与重复键（' + alt.alternates.join(',') + '）')
    const il = extract('illust', '{"idx":1,"why":"w","visual":"dawn"}', { illustCount: 3 })
    ok(il && il.idx === 1, 'illust idx 边界内通过')
    ok(extract('illust', '{"idx":9,"why":"w"}', { illustCount: 3 }) === null, 'illust idx 越界 → 拒绝')
    const pr = extract('prompt', '{"prompt":"a calm village at dawn, golden light, masterpiece","why":"w"}', {})
    ok(pr && pr.prompt.length > 8, 'prompt 提取成功')
    ok(extract('prompt', '{"prompt":"short","why":"w"}', {}) === null, '过短 prompt → 拒绝')

    // Comic layout hints must survive normalization and stay attached after turn sorting.
    const cast = [{ name: '旅人', look: 'brown hair, travel cloak' }]
    const panel = (turn, hints = {}) => ({ turn, title: '旅途', narration: '继续前行。', participants: ['旅人'], ...hints })
    const comic = extract('comic', JSON.stringify({ cast, panels: [
      panel(3, { size: 'tall', pageBreak: true }),
      panel(1, { size: 'hero' }),
      panel(2, { size: 'wide', pageBreak: false }),
      panel(4, { size: 'square', pageBreak: true })
    ] }), {})
    ok(comic && comic.panels.map(q => q.turn).join(',') === '1,2,3,4', 'comic 保留按回合排序')
    ok(comic.panels.map(q => q.size).join(',') === 'hero,wide,tall,square', 'comic 四种节奏尺寸均保留')
    ok(!Object.hasOwn(comic.panels[0], 'pageBreak'), 'comic 旧数据不凭空插入换页提示')
    ok(comic.panels[1].pageBreak === false && comic.panels[2].pageBreak === true && comic.panels[3].pageBreak === true, 'comic 布尔换页提示随对应分镜保留')
    const malformed = extract('comic', JSON.stringify({ cast, panels:
      ['true', 'false', 1, 0, null, {}, []].map((pageBreak, i) => panel(i + 1, { size: 'invalid', pageBreak }))
    }), {})
    ok(malformed.panels.every(q => !Object.hasOwn(q, 'pageBreak')), 'comic 非布尔换页提示被忽略（不做 truthy 转换）')
    ok(malformed.panels.every(q => q.size === 'square'), 'comic 非法尺寸仍回退为 square')
    const legacy = extract('comic', JSON.stringify({ cast, panels: [panel(1)] }), {})
    ok(legacy.panels[0].size === 'square' && !Object.hasOwn(legacy.panels[0], 'pageBreak'), 'comic 缺省尺寸与换页兼容旧规划')

    // New plans keep the storage key but each entry is one complete generated page.
    const beat = (turn, hints = {}) => ({ turn, description: '旅人走向晨光。', size: 'wide', dialogue: [], ...hints })
    const page = (beats, hints = {}) => panel(999, {
      fullPage: true, sceneLine: '【清晨｜村口】', composition: '斜向分格，人物跨框叠压，背景融合。', beats, ...hints
    })
    const extractPages = (panels) => extract('comic', JSON.stringify({ cast, panels }), {})
    // A full character bible must survive both legacy and fused-page extraction.
    const bible = 'A woman of thirty, with a narrow face, straight brows and short black hair tucked behind her ears. Her compact silhouette is defined by square shoulders and a practical upright posture. She wears a plain linen shirt beneath a charcoal wool coat, with soft creases at the elbows and simple leather shoes. Keep her short blunt fringe, dark coat and square shoulder line consistent across pages. These quiet features distinguish her without ornamental weapons, invented insignia or exaggerated proportions.'
    ok(bible.split(/\s+/).length >= 60 && bible.split(/\s+/).length <= 90 && bible.length > 300 && bible.length < 900, 'comic 测试角色设定为 60~90 英文词且超过旧 300 字符上限')
    for (const sample of [panel(1), page([beat(1)])]) {
      for (const look of [cast[0].look, bible, 'x'.repeat(899), 'x'.repeat(900), 'x'.repeat(901), 'x'.repeat(1600)]) {
        const result = extract('comic', JSON.stringify({ cast: [{ name: '旅人', look }], panels: [sample] }), {})
        ok(result && result.cast[0].name === '旅人' && result.cast[0].look === look.slice(0, 900), 'comic 新旧规划外貌完整保留至 900 字符，越界精确截断（' + look.length + '）')
      }
    }
    const instant = 'Eye-level medium shot: the traveler stands at frame left facing right, one hand resting on the closed door, lips pressed and eyes lowered; soft morning window light falls across the quiet wooden room.'
    const preserved = extractPages([page([beat(1, { description: instant, dialogue: [{ speaker: '旅人', line: '我再想一想。', tone: 'whisper' }], caption: '清晨。' })], { composition: 'Exactly one panel: a still medium shot with generous negative space.' })]).panels[0]
    ok(preserved.beats[0].description === instant && preserved.beats[0].dialogue[0].line === '我再想一想。' && preserved.beats[0].caption === '清晨。' && preserved.composition === 'Exactly one panel: a still medium shot with generous negative space.', 'comic 英文镜头描述、构图及中文对白旁白不被改写')
    const pages = extractPages([
      page([beat(8), beat(5, { size: 'hero', caption: ' 清晨。 ', dialogue: [{ speaker: '旅人', line: '走吧！', tone: 'shout' }] })]),
      page([beat(2), beat('3', { size: 'tall' }), beat(3, { size: 'square' })], { turn: -1 })
    ])
    ok(pages && Object.keys(pages).sort().join(',') === 'cast,panels', 'comic 整页保留顶层 cast/panels 存储契约')
    ok(pages.panels.every(q => q.fullPage === true) && pages.panels.map(q => q.turn).join(',') === '3,8', 'comic 整页 turn 取有效 beats 最大回合并排序，不信任页码')
    ok(pages.panels[1].beats.map(b => b.turn).join(',') === '8,5', 'comic 整页保留导演指定的 beats 阅读顺序')
    const fused = pages.panels[1]
    ok(fused.composition.includes('叠压') && fused.sceneLine === '【清晨｜村口】' && fused.narration === '继续前行。' && fused.participants[0] === '旅人', 'comic 整页布局、场景、梗概与角色保留')
    ok(fused.beats[1].caption === '清晨。' && fused.beats[1].dialogue[0].line === '走吧！' && fused.beats[1].dialogue[0].tone === 'shout', 'comic 格内对白、语气与可选旁白保留')
    ok(!Object.hasOwn(fused, 'size') && !Object.hasOwn(fused, 'dialogue') && !Object.hasOwn(fused, 'pageBreak'), 'comic 新整页不混入旧单格尺寸、对白与换页字段')
    ok(!Object.hasOwn(fused.beats[0], 'caption'), 'comic 未提供格内旁白时不凭空插入 caption')
    for (const beats of [undefined, null, {}, 'bad', [], [null, {}, beat(0), beat(-2), beat(1.5), beat(true), beat('Infinity'), beat(2, { description: {} }), beat(2, { description: '  ' })]]) {
      ok(extractPages([page(beats)]) === null, 'comic fullPage:true 缺失或无有效 beats 时拒绝，不能退化为单格')
    }
    const sanitized = extractPages([page([
      null, beat('Infinity'), beat(0), beat(4, {
        description: ' ' + '画'.repeat(650) + ' ', size: 'invalid', caption: '旁'.repeat(180),
        dialogue: [null, { speaker: {}, line: 'bad' }, { speaker: '旅人', line: {} },
          ...Array.from({ length: 6 }, () => ({ speaker: '人'.repeat(40), line: '话'.repeat(90), tone: 'invalid' }))]
      })
    ], { title: '题'.repeat(50), sceneLine: '景'.repeat(100), narration: '梗'.repeat(180),
      composition: '图'.repeat(1300), participants: [null, {}, 1, '', ' 旅人 ', ...Array(10).fill('人'.repeat(70))] })]).panels[0]
    ok(sanitized.beats.length === 1 && sanitized.turn === 4 && sanitized.beats[0].size === 'square', 'comic 过滤坏 beats 并回退非法格尺寸')
    ok(sanitized.title.length === 40 && sanitized.sceneLine.length === 80 && sanitized.narration.length === 160 && sanitized.composition.length === 1200, 'comic 整页文本字段按上限清洗')
    ok(sanitized.participants.length === 8 && sanitized.participants[0] === '旅人' && sanitized.participants[1].length === 60, 'comic 角色过滤非字符串、去空白并限制长度数量')
    const cleanedBeat = sanitized.beats[0]
    ok(cleanedBeat.description.length === 600 && cleanedBeat.caption.length === 160 && cleanedBeat.dialogue.length === 4 && cleanedBeat.dialogue.every(d => d.speaker.length === 30 && d.line.length === 80 && d.tone === 'normal'), 'comic beats 描述、旁白、对白长度数量与语气清洗')
    const badText = extractPages([page([beat(1, { caption: {} })], { title: {}, sceneLine: [], composition: 42, participants: {} })]).panels[0]
    ok(badText.title === '' && badText.sceneLine === '' && badText.composition === '' && badText.participants.length === 0 && !Object.hasOwn(badText.beats[0], 'caption'), 'comic 新字段不把对象或数字转成文字')
    for (const fullPage of [false, 'true', 'false', 1, 0, null, {}, [], undefined]) {
      const unmarked = extractPages([page([beat(2)], { fullPage, turn: 1 })]).panels[0]
      ok(!Object.hasOwn(unmarked, 'fullPage') && !Object.hasOwn(unmarked, 'beats') && unmarked.turn === 1 && unmarked.size === 'square', 'comic 只有严格布尔 true 启用整页，其他值仍走旧提取')
    }
    const mixed = extractPages([page([]), panel(2), page([beat(3)])])
    ok(mixed.panels.length === 2 && mixed.panels[0].size === 'square' && mixed.panels[1].fullPage === true, 'comic 新旧混合规划保留有效条目并丢弃坏整页')
    ok(extractPages([page([beat(1)], { narration: {} })]) === null, 'comic 整页仍要求非空剧情梗概')

    const specMatch = mainSrc.match(/function petAgentSpec[\s\S]*?\n}/)
    ok(!!specMatch, 'main.cjs 含 petAgentSpec 纯函数')
    if (specMatch) {
      const makeSpec = vm.runInContext('(' + specMatch[0] + ')', sandbox)
      const spec = makeSpec('comic', { pageCount: 5, panelCount: 12, story: '剧情', castText: '角色档案' })
      ok(spec.system.includes('每页只生成一张图片') && spec.system.includes('禁止为每格单独生成图片') && spec.system.includes('禁止用 CSS 或前端气泡拼装漫画页'), 'comic 提示词明确唯一整页图片而非分格图片/CSS 拼装')
      ok(spec.system.includes('所有中文对白、气泡与旁白文字') && spec.system.includes('必须由图像模型直接画进该页唯一图片'), 'comic 提示词要求图像模型绘制全部对白与旁白')
      ok(spec.system.includes('panels 的每个条目是一整页，不是单格') && spec.system.includes('fullPage:true（布尔值）') && ['"composition"', '"beats"', '"description"', '"caption"'].every(key => spec.system.includes(key)), 'comic 提示词定义完整新 schema 与严格布尔 fullPage')
      ok(['hero(', 'wide(', 'tall(', 'square('].every(size => spec.system.includes(size)), 'comic 提示词保留格内四种尺寸契约')
      ok(spec.system.includes('优先每页 2~6 个') && spec.system.includes('不要固定四宫格') && spec.system.includes('完整的叙事落点'), 'comic 提示词要求可变格数与完整叙事落点')
      ok(['本页准确格数', '必须与 beats.length 完全一致', '布局逐格对应 beats', '不添加额外分格', '或新剧情'].every(text => spec.system.includes(text)), 'comic composition 必须与 beats 数量及内容逐格一致，不额外插格或加戏')
      ok(['平稳镜头、留白和规整分格', '不强迫斜向分格、动作姿势或夸张透视', '只有剧情确有运动或冲突时', '安静场景保持安静'].every(text => spec.system.includes(text)), 'comic 融合构图服务剧情，安静场景不被强制动作化')
      ok(['60~90 个英文单词', '不超过 900 字符', 'character bible', '已知年龄或年龄阶段', '脸部特征', '发型发色', '身体轮廓与比例', '服装剪裁和材质', '2~3 个', '稳定视觉锚点'].every(text => spec.system.includes(text)) && !spec.system.includes('look 为 40 词内'), 'comic 角色设定扩展为有辨识度的 60~90 词英文视觉档案')
      ok(['以给定角色档案和剧情为依据', '不得凭角色名或模型记忆编造原作设定', '不得更改已知年龄、族裔、种族、性别', '不得把儿童画成成人', '未知年龄不猜具体岁数', '只对素材未说明的视觉细节', '克制合理设计', '不将补足当作原作事实'].every(text => spec.system.includes(text)), 'comic 角色设计尊重素材与身份事实，仅克制补足未知细节')
      ok(['复用其固定外貌和稳定锚点', '不重新设计', '只在对应 beat 中准确体现'].every(text => spec.system.includes(text)), 'comic 续画复用已绘角色，剧情外观变化局限对应 beat')
      ok(['beats.description 必须用英文', '一个可直接画出的瞬间', '镜头景别和视角', 'blocking', '动作或静止姿态', '细微表情与视线', '光源与明暗', '不要在一格中串联先后多个动作', '不用抽象心理或剧情总结', '不凭空添加打斗、奔跑、魔法或夸张动作'].every(text => spec.system.includes(text)), 'comic 英文 description 明确单一可画瞬间的镜头、站位、动作、表情与光照')
      ok(spec.system.includes('look 与 description 使用英文，dialogue.line 与 caption 保持中文'), 'comic 视觉提示使用英文而对白旁白保留中文')
      ok(spec.system.includes('本页剧情梗概') && spec.system.includes('不是需要印在画面上的旁白') && spec.system.includes('beats 的最大 turn') && spec.system.includes('不能填页码'), 'comic 提示词区分页梗概与格内旁白，并定义页结束回合')
      ok(spec.system.includes('接近 5 页') && spec.user.includes('目标 5 页') && spec.user.includes('剧情') && spec.user.includes('角色档案'), 'comic pageCount 优先于 panelCount，素材仍传递')
      const bounded = makeSpec('comic', { story: 's'.repeat(24001), castText: 'c'.repeat(6001) })
      ok(bounded.user.includes('s'.repeat(24000)) && !bounded.user.includes('s'.repeat(24001)) && bounded.user.includes('c'.repeat(6000)) && !bounded.user.includes('c'.repeat(6001)), 'comic 剧情 24000 与角色输入 6000 字符上限保持不变')
      const prior = '【已绘角色设定】旅人：' + bible + '\n【当前角色档案】旅人安静地等候。'
      ok(makeSpec('comic', { castText: prior }).user.includes(prior), 'comic 上限内已绘设定与当前角色档案原样传入')
      const fallback = makeSpec('comic', { panelCount: 12 })
      ok(fallback.system.includes('接近 12 页') && fallback.user.includes('目标 12 页'), 'comic 旧 panelCount 输入回退为页数目标')
      ok(makeSpec('comic', {}).user.includes('目标 16 页') && makeSpec('comic', { pageCount: 'bad', panelCount: 4 }).user.includes('目标 4 页'), 'comic 缺省 16 页且非法 pageCount 回退')
    }
  }
}

console.log('')
console.log('bloub：' + pass + ' 通过，' + fail + ' 失败')
process.exit(fail ? 1 : 0)

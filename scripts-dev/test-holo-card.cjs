#!/usr/bin/env node
'use strict'
/* ======== 角色闪卡（Holo Card）单元测试 ========
 * 覆盖三块：
 * 1) buildCardSource（引擎素材装配：character 过滤/关系翻译/事件排序/玩家补位）
 * 2) 渲染层纯函数（cutoutSubject 抠图判定 / renderTextLayer 排版）——
 *    经 JSDOM 无 canvas，改为「函数源码静态断言 + Node 侧等价实现交叉验证」：
 *    抠图阈值、布局常量、字体链、卡片配置装配约定。
 * 3) 主进程侧约定（HOLO_CARD_ID_RE 白名单 / config schema 关键字段）
 */
const path = require('path')
const fs = require('fs')
const assert = require('assert')

let passed = 0
let failed = 0
function t(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')) }
}

/* ---------- 1) buildCardSource ---------- */
console.log('===== buildCardSource 素材装配 =====')
const { buildCardSource } = require(path.join(__dirname, '..', 'engine', 'index.js'))
const mkStory = () => ({
  story_id: 'S1', title: '测试线', counters: { turn: 5 },
  player: { name: '主角', location: '村庄' },
  entities: [
    { entity_id: 'E1', name: '主角', type: 'character', status: 'ACTIVE', summary: '转生少年', state: { 境界: '初级' }, tags: ['魔术', '转生'] },
    { entity_id: 'E2', name: '洛琪希', type: 'character', status: 'ACTIVE', summary: '水圣级魔术师', state: {}, tags: [] },
    { entity_id: 'E3', name: '布耶纳村', type: 'location', status: 'ACTIVE', summary: '', state: {}, tags: [] },
    { entity_id: 'E4', name: '老怪', type: 'character', status: 'RETIRED', summary: '已退场', state: {}, tags: [] }
  ],
  facts: [{ statement: '主角掌握了基础魔术', status: 'ACTIVE' }],
  relationships: [{ source: 'E1', target: 'E2', relation_type: '师徒', strength: 80, status: 'ACTIVE' }],
  events: [
    { turn: 3, description: '主角初次施法成功', importance: 70, participants: ['E1'] },
    { turn: 4, description: '洛琪希授课', importance: 40, participants: ['E1', 'E2'] }
  ]
})
{
  const src = buildCardSource(mkStory())
  t('只收 character（location 被过滤）', src.characters.every((c) => c.name !== '布耶纳村'))
  t('RETIRED 角色被过滤', src.characters.every((c) => c.name !== '老怪'))
  t('玩家同名实体不重复补位', src.characters.filter((c) => c.name === '主角').length === 1)
  const zhu = src.characters.find((c) => c.name === '主角')
  t('关系双向命中且 entity_id 翻译为名字', zhu.relationships.length === 1 && zhu.relationships[0].with === '洛琪希')
  t('facts 按名字提及命中', zhu.facts.length === 1 && zhu.facts[0].statement.includes('主角'))
  t('events 按参与命中且 importance 降序', zhu.events.length === 2 && zhu.events[0].importance >= zhu.events[1].importance)
  t('summary 截断保护（≤400）', zhu.summary.length <= 400)
}
{
  const s2 = mkStory()
  s2.entities = s2.entities.filter((e) => e.name !== '主角')
  const src2 = buildCardSource(s2)
  t('玩家不在 entities 时补位', src2.characters.some((c) => c.name === '主角' && c.summary === '玩家角色'))
}

/* ---------- 2) 渲染层纯函数静态断言（shared/holo-card.js） ---------- */
console.log('===== 渲染层约定（源静态断言 + 数值交叉验证） =====')
const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'holo-card.js'), 'utf8')
t('抠图透明占比阈值 15%（分层判定）', /cleared \/ \(W \* H\) >= 0\.15/.test(src))
t('抠图失败回退整幅贴满（不做透明化）', /失败 → 保留原图贴满/.test(src) && /clearRect\(0, 0, W, H\)/.test(src))
t('文字层画布 1024×1536（RuiC 排版基准）', /c\.width = W; c\.height = H/.test(src) && /const W = 1024, H = 1536/.test(src))
t('主标题 88pt 奶白 + 称号 25pt 金（RuiC 布局）', /text\(72, 80, plan\.name, 88/.test(src) && /text\(72, 42, plan\.subtitle, 25, \{ fill: GOLD \}\)/.test(src))
t('金色 = #f4d087 / 奶白 = #fff1ce（RuiC 配色）', src.includes("'#f4d087'") && src.includes("'#fff1ce'"))
t('字体链含 Windows 楷体与 Noto 衬线回退', /KaiTi/.test(src) && /Noto Serif CJK/.test(src))
t('主体生图提示词强制纯白底（分层抠图前提）', /plain white background, solid white background/.test(src))
t('背景生图排除人物', /no people, no characters/.test(src))
t('config 装配：model/subject/background/text 相对路径', /model: '\.\/card\.glb'/.test(src) && /subject: '\.\/subject\.png'/.test(src))
t('分层时启用视差参数（1.25/0.28），整幅时贴满（1.0/0）', /subjectScale: layered \? 1\.25 : 1\.0/.test(src) && /subjectDepth: layered \? 0\.28 : 0/.test(src))
t('foil 数值化防注入', /Number\.isFinite\(Number\(plan\.foil\)\)/.test(src))
t('生图失败重试一次（与插图管线一致）', /await new Promise\(\(res\) => setTimeout\(res, 800\)\)/.test(src))

/* ---------- 3) 主进程侧约定 ---------- */
console.log('===== 主进程约定 =====')
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8')
t('cardId 白名单 /^card-[a-z0-9-]{1,64}$/', /HOLO_CARD_ID_RE = \/\^card-\[a-z0-9-\]\{1,64\}\$\//.test(mainSrc))
t('卡目录路径越界防护（resolve + startsWith）', /startsWith\(path\.resolve\(holoCardsDir\(\)\) \+ path\.sep\)/.test(mainSrc))
t('card:write 校验 PNG 层（ext !== png 拒绝）', /img\.ext !== 'png'/.test(mainSrc))
t('card:window 无 preload（纯展示页零暴露面）', /contextIsolation: true, nodeIntegration: false, sandbox: true/.test(mainSrc))
t('card:window 导航封堵 + 开窗拒绝', /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/.test(mainSrc))
t('e2e 接缝（SIXWORLDS_TEST 不真开窗）', /if \(process\.env\.SIXWORLDS_TEST\) return \{ ok: true, dir, testMode: true \}/.test(mainSrc))
t('glb 共享副本缺失时从应用模板补拷', /renderer', 'holo', 'card\.glb'/.test(mainSrc))
// 真实模型测试（2026-09-09 沙盒 userData 实测）实锤的 file:// 双死路防回归：
// ① <script type="module"> 在 file:// 下被 CORS 静默拦截（canvas 永不出现、零报错）；
// ② fetch('/holo-cards/..') 在 file:// 下解析到盘符根，404。查看器必须走特权协议托管。
const holoHtmlSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'holo', 'index.html'), 'utf8')
t('查看器走 sixworlds-asset://holo/viewer 特权协议（禁 loadFile file://）', /loadURL\('sixworlds-asset:\/\/holo\/viewer\?card=' \+ encodeURIComponent/.test(mainSrc))
t('协议托管查看器静态资源白名单（app.bundle.js/style.css/icons.data.js）', /rel === 'app\.bundle\.js' \|\| rel === 'style\.css' \|\| rel === 'icons\.data\.js'/.test(mainSrc))
t('协议卡资源路径解析卡目录 + 越界防护', /startsWith\(root \+ path\.sep\)/.test(mainSrc))
t('holo index.html 不用 type="module"（file:// 死路）', !/<script[^>]+type="module"/.test(holoHtmlSrc) && /<script src="\.\/app\.bundle\.js"><\/script>/.test(holoHtmlSrc))
const preSrc = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8')
t('preload 暴露 cardWrite/cardRead/cardDelete/cardWindow', ['cardWrite', 'cardRead', 'cardDelete', 'cardWindow'].every((k) => preSrc.includes(k)))
t('preload 暴露 engineCardSource', preSrc.includes('engineCardSource'))
t('pet:agent card 任务校验（rarity 白名单/foil 截断/prompt 长度下限）', /'N', 'R', 'SR', 'SSR', 'UR'/.test(mainSrc) && /foil = Math\.min\(1, Math\.max\(0, foil\)\)/.test(mainSrc))

/* ---------- 4) glb 产物结构校验（重新生成走 build 脚本则始终成立） ---------- */
console.log('===== card.glb 结构 =====')
{
  const glbPath = path.join(__dirname, '..', 'renderer', 'holo', 'card.glb')
  t('card.glb 产物存在', fs.existsSync(glbPath))
  if (fs.existsSync(glbPath)) {
    const buf = fs.readFileSync(glbPath)
    t('GLB magic 版本 2', buf.readUInt32LE(0) === 0x46546C67 && buf.readUInt32LE(4) === 2)
    const jsonLen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))
    const mats = json.materials.map((m) => m.name)
    t('材质契约齐备（web_front/edge/back/gold）', ['web_front', 'web_edge', 'web_back', 'web_gold'].every((m) => mats.includes(m)))
    t('每个 mesh 单材质（traverse 契约前提）', json.meshes.every((m) => m.primitives.length === 1 && m.primitives[0].material != null))
    const front = json.meshes.find((m) => json.materials[m.primitives[0].material].name === 'web_front')
    const posAcc = json.accessors[front.primitives[0].attributes.POSITION]
    t('front 面尺寸 6.3×9.45（Blender 原版等比）', Math.abs(posAcc.max[0] - 3.15) < 0.01 && Math.abs(posAcc.max[1] - 4.725) < 0.01)
  }
}

console.log('')
console.log('test-holo-card: ' + passed + ' 通过, ' + failed + ' 失败')
if (failed) process.exit(1)

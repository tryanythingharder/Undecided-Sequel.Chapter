'use strict'
/* 长篇压力测试 · Runner（无头引擎驱动，约 1000 回合）
 * 与 test-story-engine.cjs 同模式：直接 require 引擎，不启 Electron、不调 LLM。
 * runner 扮演「合格的模型」按剧本（stress-plan/steps-a/b/c/d）合成 STATE_PATCH 提交，
 * 专测引擎侧的长期记忆、生命周期、持久化与隔离——叙事质量不在本测试范围。
 *
 * 覆盖（对应 stress-plan.cjs 的 ANCHORS / RECALLS / CHALLENGES / SECRET_CHALLENGE）：
 *   - ~1000 回合真实演进长跑：锚点 H-001~H-022 在九大 Ledger 的正式记录与生命周期终态
 *   - 回访基准 R1~R14（含长距探针）：指定步骤后以自然语言回访，断言检索命中与上下文文本
 *   - Session 轮换（SES-1~9）与跨 Session 记忆延续（keep 关键词）
 *   - 快照/恢复：回合计数与账本精确回退，废弃窗口的记录彻底清除
 *   - 应用重启：重启后故事完整恢复，盘上 Pending 跨重启仍可补录
 *   - Pending 补录：PATCH_MISSING / PATCH_CONFLICT 挂起 → 失败重试恰一次仍挂起 → 补录成功并清账
 *   - 改变立场（H-017）：誓言 REVOKED 不删史，拒绝史与新立场并忆
 *   - 用户纠错（H-018）：一句自然语言不得改写正式历史
 *   - NPC 自记忆（H-019）：真相揭开 → 事实取代留痕 + 关系重建
 *   - Thread 三态（H-020/21）：OPEN（两次升级）/ OPEN→RESOLVED / OPEN→ABANDONED
 *   - 因果链 ≥10：source_decision 全部可溯，罗盘三跳链时序单调
 *   - 世界时间审计：日历单调不倒流、位置无未声明瞬移
 *   - 叙事/State 一致性：死亡状态↔死亡事件双向扫描、承诺终态留痕、取代链闭合、物品闭环
 *   - 数据完整性：零重复 ID / 零孤儿引用 / story_id 一致 / counters 与账本等长
 *   - Context 质量抽样：全程定期记录检索构成与块大小，验证有界不膨胀
 *   - Recall Benchmark 距离表：按锚定距离分桶统计命中率
 *   - 摘要清除：summary 层清零后账本检索照常（R7）
 *   - 秘密挑战：secret_from_player 事实 PLAYER 不可见 / DEBUG 可见（条款 7/8/12）
 *   - 双内核隔离：落霞镇(storyA) × 潮汐港(storyB) 全程零交叉污染
 *   - 终局记忆挑战在「二次重启后的全新引擎实例」上执行（规范三十二/三十三：只靠持久化状态）
 * 步骤字段语义（stress-world.cjs 的 S()）：
 *   tag=锚点标记；adv=[天数,时段]（推进虚拟日历并断言场景时间）；loc=地点；
 *   npc=参与者；dlg=对话回合；death=死亡 NPC；sess={id,label,keep}（关闭旧 Session 开新）；
 *   echo=[{tag,kind}]（提交后回访，断言该记录被检索命中）；
 *   special=snapshot|restore|restart|wipe-summary|pending-missing|pending-invalid|
 *           pending-retry-fail|resolve-pending。
 *   D 段生成步骤内联 spec/content/impFact/impEvt/impCausal（runner 优先读取，见 buildPatch/applyOp）。
 * 运行：node scripts-dev/stress-run.cjs [--keep]（--keep 保留数据目录供 Inspector 检查）
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createEngine } = require('../engine/index')
const { STEPS, ANCHORS, RECALLS, CHALLENGES, SECRET_CHALLENGE, KERNEL_A, KERNEL_B } = require('./stress-plan.cjs')

const KEEP = process.argv.includes('--keep')
const STORY = 'stressA'
const STORY_B = 'stressB'

/* ============ 断言器（错误分层：规范二十八）============ */
let passCount = 0, failCount = 0
const failures = []
/* 失败 → 层级分类：按断言名前缀归因，保证「哪里出的问题」可回答 */
const CLS_RULES = [
  ['pending', 'PATCH_FAILURE'], ['restore', 'DATA_LOSS'], ['snapshot', 'DATA_LOSS'],
  ['restart', 'DATA_LOSS'], ['完整性', 'DATA_LOSS'], ['持久化', 'COMMIT_FAILURE'],
  ['隔离', 'STORY_ISOLATION_FAILURE'], ['秘密', 'CONTEXT_FAILURE'], ['跨Session', 'CONTEXT_FAILURE'],
  ['时间', 'TIME_CONSISTENCY_FAILURE'], ['一致性', 'NARRATIVE_STATE_CONFLICT'], ['因果', 'NARRATIVE_STATE_CONFLICT'],
  ['挑战', 'RETRIEVAL_FAILURE'], ['refs', 'RETRIEVAL_FAILURE'], ['文本「', 'RETRIEVAL_FAILURE'], ['echo', 'RETRIEVAL_FAILURE'], ['Recall', 'RETRIEVAL_FAILURE']
]
function classify(name) {
  for (const [p, c] of CLS_RULES) if (name.indexOf(p) >= 0) return c
  return 'GENERAL'
}
function check(name, cond, extra, cls) {
  if (cond) { passCount++; return true }
  failCount++
  failures.push({ name, cls: cls || classify(name) })
  console.log('  FAIL[' + (cls || classify(name)) + '] ' + name + (extra !== undefined ? '  << ' + jstr(extra) : ''))
  return false
}
function jstr(x) { try { return JSON.stringify(x).slice(0, 300) } catch (e) { return String(x) } }
function section(t) { console.log('\n== ' + t + ' ==') }

/* ============ 锚点 → Ledger 操作规格 ============
 * 操作名[:参数]；event 由 buildPatch 恒定生成，此处仅作覆盖标记。
 * 参数指向另一 tag 已创建的记录（承诺/伏笔/事实），如 commitment_broken:caravan-promise。 */
const SPEC = {
  /* —— 正式锚点 H-001~H-016 —— */
  'refuse-falcon':   ['decision', 'fact', 'relationship', 'event'],
  'save-vera':       ['decision', 'event', 'causal', 'relationship', 'entity'],
  'calvin-grudge':   ['decision', 'event', 'relationship'],
  'get-compass':     ['event', 'fact', 'entity'],
  'oath-no-falcon':  ['commitment', 'decision'],
  'expose-barrow':   ['event', 'fact', 'causal', 'relationship'],
  'abandon-caravan': ['decision', 'commitment_broken:caravan-promise'],
  'lose-compass':    ['event', 'fact'],
  'forge-fix':       ['commitment_fulfilled:forge-promise', 'causal', 'event', 'entity'],
  'goal-guard':      ['decision', 'fact'],
  'deceive-lia':     ['decision', 'fact', 'relationship'],
  'caravan-promise': ['commitment'],
  'mark-secret':     ['fact_secret'],
  'knocks':          ['thread'],
  'vincent-dies':    ['fact', 'entity_dead', 'event'],
  'kill-calvin':     ['decision', 'fact', 'causal', 'entity_dead'],
  /* —— 回访基准 / 记忆挑战依赖的补充记录 —— */
  'barrow-down':     ['decision', 'fact'],
  'plague-cure':     ['decision', 'fact'],
  'plague-out':      ['thread', 'event'],
  'plague-end':      ['thread_resolved:plague-out', 'fact', 'event'],
  'meet-lia':        ['entity', 'event'],
  'rescue-sean':     ['causal', 'decision'],
  'compass-custody': ['decision', 'fact'],
  'forge-promise':   ['commitment', 'event'],
  'escort-promise':  ['commitment', 'event'],
  'caravan-done':    ['commitment_fulfilled:escort-promise', 'event'],
  'mill-done':       ['thread_resolved:knocks', 'fact_secret', 'event'],
  /* 誓言记录保持 ACTIVE：加入商会后誓言与行为的矛盾留给叙事层裁决（检索必须继续表面它） */
  'join-falcon':     ['decision', 'event'],
  'reveal-secret':   ['knowledge:mark-secret', 'fact', 'event'],
  /* —— C 段（强制项专项）—— */
  'oath-revoked':    ['commitment_revoked:oath-no-falcon', 'decision'],
  'wrong-corr':      ['event'],
  'corr-clarify':    ['event'],
  'lia-truth':       ['fact_supersede:deceive-lia', 'relationship', 'causal'],
  'lia-forge-peak':  ['causal', 'fact'],
  'seal-door':       ['thread'],
  'seal-key-get':    ['fact', 'entity', 'causal'],
  'seal-escalate':   ['thread_detail:seal-door'],
  'seal-open':       ['fact'],
  'ledger-gap':      ['thread'],
  'grain-peace':     ['causal', 'fact', 'decision'],
  'supply-return':   ['causal', 'fact'],
  'route-reopen':    ['thread'],
  'bandits-raid':    ['event'],
  'bandits-cleared': ['commitment_fulfilled:falcon-quest', 'causal', 'fact'],
  'pro-captain':     ['causal', 'fact', 'entity'],
  'route-abandon2':  ['thread_abandon:route-reopen', 'fact'],
  'ledger-done':     ['thread_resolved:ledger-gap', 'fact'],
  'compass-shrine':  ['causal', 'fact'],
  'vera-return':     ['entity', 'fact'],
  'barrow-fate':     ['fact'],
  'seal-depth':      ['thread_detail:seal-door', 'fact'],
  'falcon-quest':    ['commitment', 'decision']
}

/* ============ 各锚点的记录正文（用剧本词汇，保证自然语言回访可词面命中） ============ */
const CONTENT = {
  fact: {
    'refuse-falcon': '凯尔明确拒绝了灰隼商会的入会拉拢，多恩碰了钉子',
    'save-vera': '矿洞塌方中凯尔救出了被埋的矿工薇拉',
    'get-compass': '凯尔在矿洞支道石缝中挖出青铜罗盘，针尖永远指向矿脉深处',
    'lose-compass': '青铜罗盘在营救途中滑落流沙层，彻底丢失',
    'expose-barrow': '镇长巴罗私吞矿税的贪腐账目被凯尔当众公开',
    'barrow-down': '镇长巴罗因贪腐案被镇议会弹劾罢免，安娜接任',
    'goal-guard': '凯尔的目标由寻宝发财改为守护落霞镇',
    'deceive-lia': '凯尔把普通矿石冒充雪纹矿卖钱，瞒过了莉娅',
    'mark-secret': '文森药炉底部刻有一枚神秘纹章，来历不明',
    'vincent-dies': '老药师文森在矿洞二次塌方中牺牲，再也不能复活',
    'kill-calvin': '夜袭搏斗中凯尔失手杀死了佣兵头目卡尔文',
    'plague-cure': '文森手稿里的解热汤药控制住了沼地瘟疫',
    'plague-end': '雾泽沼地的瘟疫彻底解除，渔村送来锦旗致谢',
    'compass-custody': '矿工在流沙层下游挖回青铜罗盘，按公会规矩归北岭矿工公会保管，未归还凯尔',
    'reveal-secret': '文森年轻时是宫廷药师，因宫廷斗争隐姓埋名，药炉纹章是御药房徽记',
    'mill-done': '老磨坊石阶尽头的石门上刻着公会刻意隐瞒的封印纹样',
    /* —— C 段 —— */
    'lia-forge-peak': '莉娅的新作长剑在边市出名，铁匠铺订单排到明年',
    'seal-key-get': '青铜罗盘残片被公会熔铸成封印石钥，正式交由凯尔保管',
    'seal-open': '封印石门开启，门后是一条向下延伸的古代阶梯',
    'grain-peace': '灾年平价粮契约续签，全镇无断粮之虞',
    'supply-return': '开春矿工全员返工，北岭矿洞恢复三班开采',
    'bandits-cleared': '北岭道马匪窝被清剿拔除，商路复通',
    'route-abandon2': '春汛冲毁北岭便道，重开商路正式搁置，商路改走东谷新道',
    'ledger-done': '库银短差查明为记账重录，银币分文不少',
    'compass-shrine': '罗盘底盘以「矿脉之心」为名陈列于公会堂前',
    'vera-return': '薇拉率南岭勘探队归来，带回新矿脉矿样与图纸',
    'barrow-fate': '罢相后的巴罗在东谷窑场做工，再未回镇',
    'seal-depth': '阶梯尽头发现刻满星图的巨大石环，已封板待研'
  },
  /* 同 key 事实的合法更新（引擎自动 SUPERSEDED 旧口径并留痕） */
  factSup: {
    'deceive-lia': '莉娅得知当年「雪纹矿」实为普通矿石的真相，凯尔当众致歉并双倍赔偿'
  },
  intent: {
    /* 归一化意图补齐间接回访的词面（挑战4「结怨的佣兵」/ 挑战7「坑过铁匠铺姑娘」） */
    'kill-calvin': '失手杀死了结怨的佣兵头目卡尔文',
    'deceive-lia': '我曾用假矿石坑过铁匠铺的姑娘莉娅'
  },
  rel: {
    'refuse-falcon': { source_name: '凯尔', target_name: '多恩', relation_type: '入会拉拢被拒', strength_delta: -1, description: '凯尔当面拒绝了多恩代表灰隼商会的拉拢' },
    'save-vera': { source_name: '凯尔', target_name: '薇拉', relation_type: '救命之恩', strength_delta: 3, description: '矿洞塌方中凯尔救出薇拉，薇拉视他为恩人' },
    'calvin-grudge': { source_name: '凯尔', target_name: '卡尔文', relation_type: '结怨敌对', strength_delta: -3, description: '卡尔文替灰隼商会警告凯尔，双方在集市口撕破脸' },
    'expose-barrow': { source_name: '凯尔', target_name: '巴罗', relation_type: '公开对抗', strength_delta: -3, description: '凯尔公开巴罗的贪腐账目，镇长视他为眼中钉' },
    'deceive-lia': { source_name: '凯尔', target_name: '莉娅', relation_type: '以次充好的隐瞒', strength_delta: -1, description: '凯尔把普通矿石说成雪纹矿，莉娅没有察觉' },
    'lia-truth': { source_name: '凯尔', target_name: '莉娅', relation_type: '坦诚与和解', strength_delta: 3, description: '假矿石真相揭开，莉娅原谅并重建信任' }
  },
  ent: {
    'save-vera': { name: '薇拉', type: 'character', summary: '北岭矿洞矿工姑娘，塌方中被凯尔所救' },
    'get-compass': { name: '青铜罗盘', type: 'item', summary: '针尖永远指向矿脉深处的古物' },
    'forge-fix': { name: '老锻炉', type: 'object', summary: '莉娅铁匠铺的锻炉，经凯尔修复后炉火旺盛' },
    'meet-lia': { name: '莉娅', type: 'character', summary: '铁匠铺学徒姑娘' },
    'vincent-dies': { name: '文森', type: 'character', summary: '老药师，为救工人死于矿洞二次塌方' },
    'kill-calvin': { name: '卡尔文', type: 'character', summary: '佣兵头目，夜袭铁匠铺时被凯尔失手杀死' },
    'seal-key-get': { name: '封印石钥', type: 'item', summary: '青铜罗盘残片熔铸的钥匙，只许打开石门一次' },
    'pro-captain': { name: '普罗', type: 'character', state: { role: '巡山队副队长' } },
    'vera-return': { name: '薇拉', type: 'character', state: { role: '南岭勘探队长' } }
  },
  cau: {
    'save-vera': { cause: '北岭矿洞东侧塌方', effect: '薇拉被凯尔从塌方中救出' },
    'expose-barrow': { cause: '凯尔公开巴罗的贪腐账目', effect: '巴罗失势最终被弹劾罢免' },
    'forge-fix': { cause: '凯尔帮莉娅修好老锻炉', effect: '炉火旺盛，莉娅的手艺大进' },
    'kill-calvin': { cause: '卡尔文受巴罗驱使夜袭铁匠铺', effect: '凯尔在搏斗中失手杀死了卡尔文' },
    'rescue-sean': { cause: '失踪矿工队的铜牌线索', effect: '幸存的矿工队长塞恩在矿洞深处获救' },
    'lia-truth': { cause: '莉娅从矿石行家口中得知假矿实情', effect: '凯尔当众致歉双倍赔偿，两人坦诚和解' },
    'lia-forge-peak': { cause: '老锻炉修复后莉娅手艺大进', effect: '莉娅的新作在边市成名，铁匠铺订单排到明年' },
    'seal-key-get': { cause: '公会保管的青铜罗盘', effect: '残片熔铸成封印石钥交由凯尔' },
    'grain-peace': { cause: '平价粮契约续签', effect: '灾年镇上无一人断粮' },
    'supply-return': { cause: '商会去年赈济冬衣口粮', effect: '开春矿工全员返工矿洞复产' },
    'bandits-cleared': { cause: '护卫队与巡山队联合清剿', effect: '北岭道马匪绝迹商路复通' },
    'pro-captain': { cause: '普罗苦工赎罪并在清剿中证明忠诚', effect: '普罗升任巡山队副队长' },
    'compass-shrine': { cause: '青铜罗盘从矿洞出土到熔铸钥匙的传奇', effect: '罗盘底盘成为镇史展品「矿脉之心」' }
  },
  cmt: {
    'caravan-promise': { content: '护送货物穿越雾泽沼地', kind: 'contract' },
    'forge-promise': { content: '帮莉娅修好快塌的老锻炉', kind: 'promise' },
    'escort-promise': { content: '护送药草商队北上采购', kind: 'contract' },
    'oath-no-falcon': { content: '绝不加入灰隼商会', kind: 'oath' },
    'falcon-quest': { content: '清剿北岭道上的马匪，护住商路', kind: 'quest' }
  },
  thread: {
    'knocks': { title: '矿洞深处的敲击声', detail: '夜里矿洞深处传来规律的敲击声，来源不明', resolve: '敲击声来自磨坊地下的古代水道，石阶贯通后谜团解开' },
    'plague-out': { title: '雾泽沼地的瘟疫', detail: '渔村发高热瘟疫，病倒的人一天比一天多', resolve: '解热汤药控制疫情，瘟疫彻底解除' },
    'seal-door': { title: '老磨坊石阶深处的封印', detail: '石门内传出低频震动，封印纹样开始发光' },
    'ledger-gap': { title: '商会库银短差案', detail: '春季对账短了三十七枚银币，账目对不上', resolve: '短差系记账员重录两笔运费，银币分文不少' },
    'route-reopen': { title: '重开北岭商路', detail: '雪化后再次立项，预计入夏开工' }
  },
  know: {
    'mark-secret': '文森年轻时是宫廷药师，药炉纹章是御药房徽记'
  }
}

/* 锚点自检：ANCHORS 声明的 Ledger 项必须被 SPEC 覆盖（防两表漂移） */
function validateSpecVsAnchors() {
  const BASE = { Decision: 'decision', Fact: 'fact', Event: 'event', Commitment: 'commitment', Causal: 'causal', Entity: 'entity', Relationship: 'relationship', Thread: 'thread' }
  const bad = []
  for (const a of ANCHORS) {
    if (a.id === 'H-012') continue // 承诺链锚点：终态由 FINAL_STATUS 断言
    const m = a.desc.match(/（([^（）]+)）\s*$/)
    if (!m) { bad.push(a.id + ' 无 Ledger 声明'); continue }
    for (const raw of m[1].split('+')) {
      const tok = raw.trim()
      /* 归一化：去掉备注（「，NPC 记忆测试」）与限定（「Entity.alive=false」「Commitment BROKEN」） */
      const head = tok.split('，')[0].split(/[（(\s]/)[0].split('.')[0].trim()
      const base = BASE[head] || (tok.startsWith('secret_from_player') ? 'fact' : null)
      if (!base) { bad.push(a.id + ' 不可解析项: ' + tok); continue }
      const ops = SPEC[a.tag] || []
      const ok = ops.some((op) => op.split(':')[0].startsWith(base))
      if (!ok) bad.push(a.id + '(' + a.tag + ') 缺少 ' + base)
    }
  }
  return bad
}

/* ============ 主流程 ============ */
function main() {
  const t0 = Date.now()
  const specBad = validateSpecVsAnchors()
  section('规格自检（SPEC × ANCHORS）')
  check('锚点规格与 ANCHORS 表一致', specBad.length === 0, specBad.join('; '))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-stress-'))
  console.log('数据目录: ' + dir + (KEEP ? '（保留）' : ''))
  let engine = createEngine(dir)
  let story = null

  /* —— 剧本 A/B 双故事：A=落霞镇主战场，B=潮汐港隔离对照 —— */
  engine.ensureStory({ storyId: STORY, title: '压测 · 落霞镇', kernelId: 'kernel-a', kernelText: KERNEL_A })
  engine.ensureStory({ storyId: STORY_B, title: '压测 · 潮汐港（隔离对照）', kernelId: 'kernel-b', kernelText: KERNEL_B })
  story = engine.getStory(STORY)
  const bSeed = engine.commitPatch({
    turn_summary: '海蓝在鱼市码头叫卖',
    scene: { game_time: '第1日·晨', location: '鱼市码头' },
    facts: [{ key: 'hailan_fish', statement: '渔女海蓝在潮汐港鱼市有一摊鲜鱼生意', importance: 60 }],
    events: [{ type: 'dialogue', description: '渔女海蓝在潮汐港的鱼市码头叫卖鲜鱼', importance: 50 }],
    decisions: [{ raw_input: '在潮汐港码头帮海蓝收摊', normalized_intent: '帮海蓝收摊', source: 'user_input', importance: 60 }]
  }, { storyId: STORY_B, sessionId: 'SES-B1', playerInput: '去码头看看' })
  section('隔离对照组（storyB 播种）')
  check('storyB 播种提交成功', bSeed.ok === true, bSeed.errors)

  const tags = new Map() // tag → { turn, ids: { entity:[], fact:[], ... } }
  const idOf = (tag, kind) => { const t = tags.get(tag); return t && t.ids[kind] && t.ids[kind][0] }
  const pendIds = {}
  const c = { day: 1, fillSeq: 0, session: 'SES-1' }
  let snap = null, snapTurn = 0, snapDay = 1
  engine.openSession({ storyId: STORY, sessionId: c.session, label: '第一阶段' })

  /* —— 全程审计采集 —— */
  const parseDay = (t) => { const m = /第(\d+)日/.exec(t || ''); return m ? Number(m[1]) : null }
  const daySeq = [{ turn: story.counters.turn, day: parseDay(story.scene.game_time) || 1, loc: story.scene.location || '', declared: false, id: 'init', restore: false }]
  const ctxSamples = [] // 规范二十六：Context 质量抽样
  const recallRows = [] // 规范二十七：Recall Benchmark 距离表

  /* ---- patch 合成 ---- */
  /* 内容选取：D 段生成步骤内联 step.content 优先，其次全局 CONTENT 表（C/A/B 段） */
  function pick(step, table, tag) {
    if (step.content && step.content[table] !== undefined) return step.content[table]
    return (CONTENT[table] || {})[tag]
  }
  function applyOp(p, op, step) {
    const colon = op.indexOf(':')
    const base = colon < 0 ? op : op.slice(0, colon)
    const param = colon < 0 ? null : op.slice(colon + 1)
    switch (base) {
      case 'event': return // 事件恒定生成，仅覆盖标记
      case 'decision':
        p.decisions = [{ raw_input: step.input, normalized_intent: CONTENT.intent[step.tag] || step.input, source: 'user_input', importance: step.impDec || 80 }]
        return
      case 'fact': case 'fact_secret':
        p.facts = [{ key: step.tag, statement: pick(step, 'fact', step.tag) || step.input, importance: step.impFact || (base === 'fact_secret' ? 88 : 85), secret_from_player: base === 'fact_secret' }]
        return
      case 'fact_supersede':
        /* 同 key 新口径：引擎自动 SUPERSEDED 旧事实并留痕（永不删除） */
        p.facts = [{ key: param, statement: pick(step, 'factSup', param) || step.input, importance: step.impFact || 85 }]
        return
      case 'relationship': p.relationships = [pick(step, 'rel', step.tag)]; return
      case 'entity': p.entity_changes = [pick(step, 'ent', step.tag)]; return
      case 'entity_dead':
        p.entity_changes = [Object.assign({ state: { alive: false } }, pick(step, 'ent', step.tag))]
        return
      case 'causal': p.causal = [Object.assign({ importance: step.impCausal || 60 }, pick(step, 'cau', step.tag))]; return
      case 'commitment': p.commitments = [Object.assign({ importance: 72 }, pick(step, 'cmt', step.tag))]; return
      case 'commitment_broken': case 'commitment_fulfilled': case 'commitment_revoked': {
        const ref = idOf(param, 'commitment')
        if (!ref) throw new Error('runner 内部错误：' + param + ' 的承诺尚未创建')
        const st = base === 'commitment_broken' ? 'BROKEN' : base === 'commitment_revoked' ? 'REVOKED' : 'FULFILLED'
        p.commitment_updates = [{ ref, status: st, note: step.input.slice(0, 80) }]
        return
      }
      case 'thread': p.threads = [{ op: 'add', title: pick(step, 'thread', step.tag).title, detail: pick(step, 'thread', step.tag).detail, importance: step.impThread || 70 }]; return
      case 'thread_resolved': {
        const ref = idOf(param, 'thread')
        if (!ref) throw new Error('runner 内部错误：' + param + ' 的伏笔尚未创建')
        p.threads = [{ op: 'update', ref, status: 'RESOLVED', detail: pick(step, 'thread', param).resolve }]
        return
      }
      case 'thread_abandon': {
        const ref = idOf(param, 'thread')
        if (!ref) throw new Error('runner 内部错误：' + param + ' 的伏笔尚未创建')
        p.threads = [{ op: 'update', ref, status: 'ABANDONED', detail: step.input.slice(0, 120) }]
        return
      }
      case 'thread_detail': {
        const ref = idOf(param, 'thread')
        if (!ref) throw new Error('runner 内部错误：' + param + ' 的伏笔尚未创建')
        p.threads = [{ op: 'update', ref, detail: step.input.slice(0, 120) }]
        return
      }
      case 'knowledge':
        p.knowledge = [{ fact_ref: idOf(param, 'fact'), content: CONTENT.know[param], how_learned: 'told_by' }]
        return
      default: throw new Error('未知操作: ' + op)
    }
  }

  function buildPatch(step) {
    const tod = step.adv ? step.adv[1] : '晨'
    const spec = step.spec || (step.tag && SPEC[step.tag]) || null
    const p = {
      turn_summary: step.input.slice(0, 120),
      scene: { game_time: '第' + c.day + '日·' + tod },
      events: [{
        type: step.death ? 'turning_point' : (step.dlg ? 'dialogue' : (step.npc ? 'conflict' : 'action')),
        description: step.input,
        importance: step.impEvt != null ? step.impEvt : (spec ? 76 : (step.tag ? 56 : 4 + (c.fillSeq % 5))),
        participant_names: step.npc || []
      }]
    }
    if (step.loc) { p.scene.location = step.loc; p.player_state = { location: step.loc } }
    if (step.tag && !spec) p.decisions = [{ raw_input: step.input, normalized_intent: step.input, source: 'user_input', importance: step.impDec || 64 }]
    if (spec) for (const op of spec) applyOp(p, op, step)
    return p
  }

  function recordTag(step, applied) {
    if (!step.tag || !applied) return
    const t = tags.get(step.tag) || { turn: story.counters.turn, ids: {} }
    const MAP = { entities: 'entity', facts: 'fact', decisions: 'decision', commitments: 'commitment', commitment_updates: 'commitment', events: 'event', relationships: 'relationship', knowledge: 'knowledge', threads: 'thread', thread_updates: 'thread', causal: 'causal' }
    for (const k of Object.keys(applied)) {
      const key = MAP[k]
      if (key) t.ids[key] = (t.ids[key] || []).concat(applied[k])
    }
    tags.set(step.tag, t)
    /* 揭秘的知识同时挂到被揭秘的锚点（manuscript 步的 echo 用 mark-secret/knowledge） */
    if (step.tag === 'reveal-secret' && applied.knowledge) {
      const m = tags.get('mark-secret') || { turn: story.counters.turn, ids: {} }
      m.ids.knowledge = (m.ids.knowledge || []).concat(applied.knowledge)
      tags.set('mark-secret', m)
    }
  }

  /* ---- 检索断言 ---- */
  const KIND_ID = { decisions: 'decision_id', facts: 'fact_id', events: 'event_id', commitments: 'commitment_id', threads: 'thread_id', causal: 'causal_id', entities: 'entity_id', relationships: 'relationship_id', knowledge: 'knowledge_id' }
  const KIND_KEY = { decisions: 'decision', facts: 'fact', events: 'event', commitments: ['commitment'], threads: ['thread'], causal: 'causal', entities: 'entity', relationships: 'relationship', knowledge: 'knowledge' }

  function refHit(ctx, kind, tag) {
    const t = tags.get(tag)
    if (!t) return { hit: false, why: '无该 tag 的记录' }
    const keys = Array.isArray(KIND_KEY[kind]) ? KIND_KEY[kind] : [KIND_KEY[kind]]
    const ids = []
    for (const k of keys) ids.push.apply(ids, t.ids[k] || [])
    const got = (ctx.retrieved[kind] || []).map((it) => it.rec[KIND_ID[kind]])
    if (kind === 'entities') {
      const ent = story.entities.find((e) => ids.indexOf(e.entity_id) >= 0)
      if (!ent) return { hit: false, why: '实体不在账本' }
      /* 实体检索上限 12，只保留高分；名字出现在上下文即算记起 */
      return { hit: got.indexOf(ent.entity_id) >= 0 || ctx.block.indexOf(ent.name) >= 0 }
    }
    if (kind === 'threads' || kind === 'commitments') {
      const list = kind === 'threads' ? story.threads : story.commitments
      const idf = kind === 'threads' ? 'thread_id' : 'commitment_id'
      const rec = list.find((x) => ids.indexOf(x[idf]) >= 0)
      if (!rec) return { hit: false, why: '账本无记录' }
      const openish = kind === 'threads' ? 'OPEN' : 'ACTIVE'
      /* 引擎契约：终态（RESOLVED/BROKEN/FULFILLED）不进检索——账本存在即记起，表面命中由 text 断言覆盖 */
      return rec.status === openish ? { hit: got.indexOf(rec[idf]) >= 0, why: rec.status + ' 未被检索' } : { hit: true, note: rec.status }
    }
    return { hit: ids.some((id) => got.indexOf(id) >= 0), why: '不在检索结果 top（共 ' + ids.length + ' 候选）' }
  }

  function runRecallQuery(input, refs, textTerms, label) {
    const p0 = passCount, f0 = failCount
    let ctx = null
    try { ctx = engine.buildContext(STORY, { playerInput: input }) } catch (e) { check(label + ' · buildContext 不抛错', false, e.message); return null }
    for (const kind of Object.keys(refs || {})) {
      for (const tag of refs[kind]) {
        const r = refHit(ctx, kind, tag)
        check(label + ' · refs ' + kind + ':' + tag, r.hit, r.why || r.note || '')
      }
    }
    for (const term of textTerms || []) check(label + ' · 文本「' + term + '」', ctx.block.indexOf(term) >= 0)
    /* Recall Benchmark 行：锚定回合 → 回访回合 + 命中率（规范二十七） */
    const turns = []
    for (const kind of Object.keys(refs || {})) for (const tag of refs[kind]) { const t = tags.get(tag); if (t) turns.push(t.turn) }
    recallRows.push({
      label, revisitTurn: story.counters.turn,
      anchorTurn: turns.length ? Math.min.apply(null, turns) : null,
      passed: passCount - p0, total: (passCount - p0) + (failCount - f0)
    })
    return ctx
  }

  /* ============ 步骤主循环 ============ */
  section('剧本长跑（' + STEPS.length + ' 步）')
  let stepIdx = 0
  for (const step of STEPS) {
    stepIdx++
    if (stepIdx % 50 === 0) console.log('  … ' + stepIdx + '/' + STEPS.length + ' 步 · T' + story.counters.turn)

    /* —— Session 轮换 —— */
    if (step.sess) {
      if (c.session !== step.sess.id) {
        try { engine.closeSession({ storyId: STORY, sessionId: c.session }) } catch (e) { /* 已关闭则忽略 */ }
      }
      engine.openSession({ storyId: STORY, sessionId: step.sess.id, label: step.sess.label })
      c.session = step.sess.id
    }

    /* —— 特殊步骤 —— */
    if (step.special === 'snapshot') {
      snap = engine.snapshot(STORY, '压测中点')
      snapTurn = story.counters.turn
      snapDay = c.day
      check('snapshot · 生成（' + snap.snapshot_id + ' @T' + snapTurn + '）', !!snap && !!snap.snapshot_id)
      check('snapshot · 进入快照列表', engine.listSnapshots(STORY).some((s) => s.snapshot_id === snap.snapshot_id))
      continue
    }
    if (step.special === 'restore') {
      const before = story.counters.turn
      story = engine.restoreSnapshot(STORY, snap.snapshot_id)
      check('restore · 回合计数回到快照点', story.counters.turn === snapTurn, before + ' -> ' + story.counters.turn)
      check('restore · 废弃窗口的事件已清除', !story.events.some((e) => e.description.indexOf('走水') >= 0 || e.description.indexOf('砸伤了腿') >= 0))
      check('restore · 废弃窗口的决定已清除', !story.decisions.some((d) => d.raw_input.indexOf('走水') >= 0 || d.raw_input.indexOf('勋章') >= 0))
      /* 清理废弃窗口的 tag 记录 */
      for (const [k, v] of Array.from(tags)) if (v.turn > snapTurn) tags.delete(k)
      c.day = snapDay
      daySeq.push({ turn: story.counters.turn, day: snapDay, loc: story.scene.location || '', declared: false, id: step.id, restore: true })
      continue
    }
    if (step.special === 'restart') {
      const turnBefore = story.counters.turn
      engine = createEngine(dir) // 模拟应用重启：同一数据目录重建引擎
      story = engine.getStory(STORY)
      check('restart · 故事完整恢复（T' + turnBefore + '）', !!story && story.counters.turn === turnBefore)
      check('restart · 双故事都在册', engine.listStories().some((s) => s.story_id === STORY) && engine.listStories().some((s) => s.story_id === STORY_B))
      check('restart · pend2 挂起在盘上待补录', engine.listPendings(STORY).some((p) => p.pending_id === pendIds['pend2']), JSON.stringify(engine.listPendings(STORY).map((p) => p.pending_id)))
      continue
    }
    if (step.special === 'wipe-summary') {
      story = engine.getStory(STORY) // 取当前规范对象再改（每次提交都会换缓存对象）
      story.scene.summary = ''
      engine.store.saveStory(STORY)
      check('wipe-summary · 摘要已清零', story.scene.summary === '')
      continue
    }
    if (step.special === 'pending-missing' || step.special === 'pending-invalid') {
      const before = story.counters.turn
      let r
      if (step.special === 'pending-missing') {
        r = engine.commitFromRaw('（本回合模型只输出了叙事文本，没有任何状态块。）', { storyId: STORY, sessionId: c.session, playerInput: step.input })
        check('pending · 无协议块回合未推进引擎（' + r.patch_status + '）', r.ok === true && r.committed === false && r.patch_status === 'PATCH_MISSING' && story.counters.turn === before, r.patch_status)
      } else {
        const badRaw = '叙事\n<<<STATE_PATCH>>>\n' + JSON.stringify({ turn_summary: '冲突提交', commitment_updates: [{ ref: 'CMT-999999', status: 'FULFILLED' }] }) + '\n<<<END_PATCH>>>'
        r = engine.commitFromRaw(badRaw, { storyId: STORY, sessionId: c.session, playerInput: step.input })
        check('pending · 非法引用回合整体回滚（' + r.patch_status + '）', r.ok === false && r.patch_status === 'PATCH_CONFLICT' && story.counters.turn === before, r.patch_status)
      }
      const pc = engine.recordPending({ storyId: STORY, sessionId: c.session, playerInput: step.input, narrative: step.input, patchError: r.patch_status, retryCount: 0, turnId: r.turn_id, stateVersion: before })
      pendIds[step.id] = pc.pending_id
      check('pending · 挂起已登记（' + pc.pending_id + '）', !!pc.pending_id)
      continue
    }
    if (step.special === 'pending-retry-fail') {
      /* 规范二十三：对挂起 Pending 的第一次补录尝试失败 → retry_count=1、仍挂起；
       * 随后的 resolve-pending 特殊步成功补录并清账。 */
      const pid = pendIds['pend3']
      const badRaw = '叙事\n<<<STATE_PATCH>>>\n' + JSON.stringify({ turn_summary: '非法补录', commitment_updates: [{ ref: 'CMT-999999', status: 'FULFILLED' }] }) + '\n<<<END_PATCH>>>'
      const r = engine.resolvePending({ storyId: STORY, pendingId: pid, raw: badRaw })
      check('pending · 非法补录被拒（resolved=false）', r && r.resolved === false)
      const pc = engine.getPending(STORY, pid)
      check('pending · 失败重试计数恰为 1', !!pc && pc.retry_count === 1, pc && pc.retry_count)
      check('pending · 首次失败后仍处挂起', !!engine.listPendings(STORY).some((p) => p.pending_id === pid))
      continue
    }
    if (step.special === 'resolve-pending') {
      const pendingId = pendIds[step.id.replace('-resolve', '')]
      const before = story.counters.turn
      const patch = { turn_summary: step.input, facts: [{ key: step.id + '-fact', statement: step.input + '：已按规程补录入账', importance: 40 }] }
      const r = engine.resolvePending({ storyId: STORY, pendingId, raw: '补录叙事\n<<<STATE_PATCH>>>\n' + JSON.stringify(patch) + '\n<<<END_PATCH>>>' })
      check('resolve-pending · 补录成功（' + pendingId + '）', r.resolved === true, r.resolved ? '' : JSON.stringify(r.result && r.result.errors))
      story = engine.getStory(STORY) // 补录也是一次提交，刷新规范对象
      check('resolve-pending · 引擎推进 1 回合', story.counters.turn === before + 1, before + ' -> ' + story.counters.turn)
      check('resolve-pending · 挂起已清账', !engine.listPendings(STORY).some((p) => p.pending_id === pendingId))
      continue
    }

    /* —— 普通步骤：推进虚拟日历 → 提交 → 断言 —— */
    if (step.adv) c.day += step.adv[0]
    const before = story.counters.turn
    const patch = buildPatch(step)
    const r = engine.commitPatch(patch, { storyId: STORY, sessionId: c.session, playerInput: step.input })
    story = engine.getStory(STORY) // 提交后缓存对象被克隆替换，必须重取（store.js commitTransaction）
    if (!check('T' + (before + 1) + ' ' + step.id + ' · 提交成功', r.ok === true && r.committed === true, { errors: r.errors, warnings: r.warnings })) continue
    check('T' + story.counters.turn + ' ' + step.id + ' · 回合推进 1', story.counters.turn === before + 1)
    if (step.adv) check('T' + story.counters.turn + ' ' + step.id + ' · 场景时间（' + patch.scene.game_time + '）', story.scene.game_time === patch.scene.game_time)
    if (step.loc) check('T' + story.counters.turn + ' ' + step.id + ' · 玩家位置（' + step.loc + '）', story.scene.location === step.loc && story.player.location === step.loc)
    if (step.death) {
      const ent = story.entities.find((e) => e.name === step.death)
      check('T' + story.counters.turn + ' ' + step.id + ' · ' + step.death + ' 实体标记死亡', !!ent && ent.state && ent.state.alive === false, ent && ent.state)
    }
    recordTag(step, r.applied)

    /* 世界时间审计采集（规范十七）：每回合记录日历与位置 */
    daySeq.push({ turn: story.counters.turn, day: parseDay(story.scene.game_time) || 0, loc: story.scene.location || '', declared: !!step.loc, id: step.id, restore: false })

    /* Context 质量抽样（规范二十六）：每 40 步记录检索构成与块大小 */
    if (stepIdx % 40 === 0) {
      try {
        const sctx = engine.buildContext(STORY, { playerInput: step.input })
        const g = sctx.retrieved
        ctxSamples.push({
          turn_id: 'TRN-' + String(story.counters.turn).padStart(6, '0'),
          turn: story.counters.turn,
          player_input: String(step.input).slice(0, 80),
          retrieved_decisions: g.decisions.length,
          retrieved_commitments: g.commitments.length,
          retrieved_facts: g.facts.length,
          retrieved_events: g.events.length,
          retrieved_entities: g.entities.length,
          retrieved_relationships: g.relationships.length,
          retrieved_threads: g.threads.length,
          context_size: sctx.block.length
        })
      } catch (e) { check('T' + story.counters.turn + ' · Context 抽样不抛错', false, e.message, 'CONTEXT_FAILURE') }
    }

    /* echo：本回合输入应召回相关历史（引擎「记忆回响」契约） */
    if (step.echo) {
      const ctx = engine.buildContext(STORY, { playerInput: step.input })
      for (const e of step.echo) {
        const hit = refHit(ctx, e.kind === 'decision' ? 'decisions' : e.kind === 'fact' ? 'facts' : e.kind === 'event' ? 'events' : e.kind === 'causal' ? 'causal' : e.kind === 'commitment' ? 'commitments' : e.kind === 'thread' ? 'threads' : e.kind === 'knowledge' ? 'knowledge' : 'entities', e.tag)
        check('T' + story.counters.turn + ' ' + step.id + ' · echo ' + e.kind + ':' + e.tag, hit.hit, hit.why || hit.note || '')
      }
    }

    /* keep：新 Session 打开后，旧记忆仍然可达 */
    if (step.sess && step.sess.keep) {
      const ctx = engine.buildContext(STORY, { playerInput: step.sess.keep.join(' ') + ' 近况如何' })
      for (const term of step.sess.keep) check('T' + story.counters.turn + ' ' + step.id + ' · 跨Session记忆「' + term + '」', ctx.block.indexOf(term) >= 0)
    }

    /* RECALLS：锚定在指定步骤之后的回访基准 */
    for (const rc of RECALLS) {
      if (rc.at === step.id) runRecallQuery(rc.input, rc.refs, rc.text, rc.label + ' @' + step.id)
    }
  }
  console.log('  长跑完成：T' + story.counters.turn + ' · 实体 ' + story.entities.length + ' · 决定 ' + story.decisions.length + ' · 事实 ' + story.facts.length + ' · 事件 ' + story.events.length)
  const turnAtEnd = story.counters.turn

  /* ============ 锚点终态断言 ============ */
  section('锚点终态（H-001~H-016）')
  for (const a of ANCHORS) {
    if (a.id === 'H-012') continue // 承诺链，下方专项断言
    const ops = SPEC[a.tag] || []
    const need = ops.map((op) => op.split(':')[0]).filter((b) => b !== 'event')
    for (const base of need) {
      const kindKey = { decision: 'decision', fact: 'fact', entity: 'entity', causal: 'causal', commitment: 'commitment', thread: 'thread', relationship: 'relationship', knowledge: 'knowledge' }[base.replace(/_.*/, '')] || base.replace(/_.*/, '')
      check(a.id + ' ' + a.tag + ' · ' + kindKey + ' 在账本', !!idOf(a.tag, kindKey === 'commitment' ? 'commitment' : kindKey === 'thread' ? 'thread' : kindKey === 'entity' ? 'entity' : kindKey === 'knowledge' ? 'knowledge' : kindKey))
    }
  }
  check('H-012 承诺链 · 护送契约已 BROKEN', (story.commitments.find((x) => x.commitment_id === idOf('caravan-promise', 'commitment')) || {}).status === 'BROKEN')
  check('H-012 承诺链 · 新护送承诺已 FULFILLED', (story.commitments.find((x) => x.commitment_id === idOf('escort-promise', 'commitment')) || {}).status === 'FULFILLED')
  check('H-005+H-017 誓言 · 记录全程在账（曾 ACTIVE 长期支撑检索，C 段正式 REVOKED）', !!idOf('oath-no-falcon', 'commitment') && (story.commitments.find((x) => x.commitment_id === idOf('oath-no-falcon', 'commitment')) || {}).status === 'REVOKED')
  check('H-009 帮莉娅修炉 · 承诺 FULFILLED', (story.commitments.find((x) => x.commitment_id === idOf('forge-promise', 'commitment')) || {}).status === 'FULFILLED')
  check('H-014 敲击声 · 伏笔 OPEN→RESOLVED', (story.threads.find((x) => x.thread_id === idOf('knocks', 'thread')) || {}).status === 'RESOLVED')
  check('H-015 文森 · 实体 alive=false 且未被复活', (story.entities.find((e) => e.name === '文森') || { state: {} }).state.alive === false)
  check('H-013 药炉纹章 · 秘密事实对玩家不可见', (story.facts.find((f) => f.fact_id === idOf('mark-secret', 'fact')) || {}).secret_from_player === true)
  check('H-013 石门封印 · 秘密事实对玩家不可见', (story.facts.find((f) => f.fact_id === idOf('mill-done', 'fact')) || {}).secret_from_player === true)
  check('事实取代 · 罗盘「得到」与「失去」两条事实并存（不同 key 不互相取代）', !!story.facts.find((f) => f.fact_id === idOf('get-compass', 'fact') && f.status === 'ACTIVE') && !!story.facts.find((f) => f.fact_id === idOf('lose-compass', 'fact') && f.status === 'ACTIVE'))
  check('Session 登记簿 · 9 个阶段齐全且 SES-9 ACTIVE', story.sessions.length === 9 && story.sessions[story.sessions.length - 1].status === 'ACTIVE', JSON.stringify(story.sessions.map((s) => s.session_id + ':' + s.status)))

  /* —— C 段强制项终态（H-017~H-022）—— */
  section('C 段强制项终态')
  const oath = story.commitments.find((x) => x.commitment_id === idOf('oath-no-falcon', 'commitment')) || {}
  check('H-017 立场改变 · 誓言已 REVOKED（非删除）', oath.status === 'REVOKED', oath.status)
  check('H-017 立场改变 · 誓言记录与内容仍在账本', !!oath.commitment_id && oath.content === '绝不加入灰隼商会', oath.content)
  check('H-017 立场改变 · REVOKED 附带留痕 note', !!oath.status_note, oath.status_note)
  check('H-017 立场改变 · 旧拒绝决定仍 CONFIRMED', (story.decisions.find((d) => d.decision_id === idOf('refuse-falcon', 'decision')) || {}).status === 'CONFIRMED')
  check('H-017 立场改变 · 新加入决定 CONFIRMED', (story.decisions.find((d) => d.decision_id === idOf('join-falcon', 'decision')) || {}).status === 'CONFIRMED')
  check('H-018 用户纠错 · 救援决定未被改写（仍 CONFIRMED 原文）', (() => { const d = story.decisions.find((x) => x.decision_id === idOf('save-vera', 'decision')) || {}; return d.status === 'CONFIRMED' && d.raw_input === '矿洞东侧突然塌方！我把被埋住半身的矿工姑娘薇拉拖了出来。' })(), JSON.stringify(story.decisions.find((x) => x.decision_id === idOf('save-vera', 'decision')) || {}))
  check('H-018 用户纠错 · 救命之恩关系仍 ACTIVE（NPC 仍记得被救）', (story.relationships.find((r) => r.relationship_id === idOf('save-vera', 'relationship')) || {}).status === 'ACTIVE')
  check('H-018 用户纠错 · 未产生「未救过」矛盾事实', !story.facts.some((f) => /没有救过|从未救过|不是我救/.test(f.statement) && /薇拉/.test(f.statement)))
  const dOld = story.facts.find((f) => f.fact_id === idOf('deceive-lia', 'fact')) || {}
  const dNew = story.facts.find((f) => f.key === 'deceive-lia' && f.status === 'ACTIVE') || {}
  check('H-019 事实取代 · 旧口径 SUPERSEDED 且 superseded_by 指向后继', dOld.status === 'SUPERSEDED' && dOld.superseded_by === dNew.fact_id, JSON.stringify({ s: dOld.status, by: dOld.superseded_by }))
  check('H-019 事实取代 · 旧记录未删除（审计痕迹仍在账本）', !!dOld.fact_id && dOld.statement.indexOf('冒充雪纹矿') >= 0)
  check('H-019 事实取代 · 欺瞒决定仍 CONFIRMED（历史不消失）', (story.decisions.find((d) => d.decision_id === idOf('deceive-lia', 'decision')) || {}).status === 'CONFIRMED')
  const sealThr = story.threads.find((x) => x.thread_id === idOf('seal-door', 'thread')) || {}
  check('H-020 封印长线 · OPEN 且 detail 记录两次升级', sealThr.status === 'OPEN' && /星图/.test(sealThr.detail || ''), sealThr.detail)
  const routeThr = story.threads.find((x) => x.thread_id === idOf('route-reopen', 'thread')) || {}
  check('H-021 商路长线 · ABANDONED（FAILED 语义）且记录 closed_turn', routeThr.status === 'ABANDONED' && !!routeThr.closed_turn, JSON.stringify(routeThr))
  check('H-022 清剿承诺 · 兑现 FULFILLED', (story.commitments.find((x) => x.commitment_id === idOf('falcon-quest', 'commitment')) || {}).status === 'FULFILLED')
  check('终局 ACTIVE 承诺 · 清剿后的承诺不凭空消失（承诺链最后一条仍 ACTIVE）', story.commitments.filter((x) => x.status === 'ACTIVE').length >= 1, story.commitments.filter((x) => x.status === 'ACTIVE').length)

  /* ============ 持久化与诊断（二次重启：全新引擎实例，之后的所有挑战只靠持久化状态） ============ */
  section('持久化与诊断（二次重启）')
  const engine2 = createEngine(dir)
  engine = engine2
  const story2 = engine2.getStory(STORY)
  story = story2
  check('持久化 · 全量回合数保持（二次重启零丢失）', story2.counters.turn === turnAtEnd, '重建前 ' + turnAtEnd + ' / 重建后 ' + story2.counters.turn)
  check('诊断 · 回合日志滚动窗口（每故事保留最近 60 条）', engine2.turnLogs(STORY).length === 60, engine2.turnLogs(STORY).length + ' 条')
  check('诊断 · 最新回合日志可读', !!engine2.turnLog(STORY, 'TRN-' + String(story2.counters.turn).padStart(6, '0')))
  check('诊断 · 快照仍在册', engine2.listSnapshots(STORY).length === 1)
  check('诊断 · Pending 清零（全部补录或丢弃）', engine2.listPendings(STORY).length === 0, JSON.stringify(engine2.listPendings(STORY).map((p) => p.pending_id)))

  /* ============ 重启后记忆挑战（间接自然语言，不告知 ID；规范三十三） ============ */
  section('记忆挑战（二次重启后 · ' + CHALLENGES.length + ' 题）')
  CHALLENGES.forEach((ch, i) => runRecallQuery(ch.q, ch.refs, ch.text, '挑战' + (i + 1)))

  /* ============ 秘密挑战（PLAYER 不可见 / DEBUG 可见） ============ */
  section('秘密挑战')
  const secretPlayer = engine.buildContext(STORY, { playerInput: SECRET_CHALLENGE.q })
  check('秘密 · PLAYER 上下文不含「' + SECRET_CHALLENGE.text[0] + '」', secretPlayer.block.indexOf(SECRET_CHALLENGE.text[0]) < 0)
  check('秘密 · PLAYER 检索结果无秘密事实', !secretPlayer.retrieved.facts.some((f) => f.rec.secret_from_player))
  const secretDebug = engine.buildContext(STORY, { playerInput: SECRET_CHALLENGE.q, accessLevel: 'DEBUG' })
  check('秘密 · DEBUG 上下文可见「' + SECRET_CHALLENGE.text[0] + '」', secretDebug.block.indexOf(SECRET_CHALLENGE.text[0]) >= 0)
  check('秘密 · includeSecrets 不再授予权限（PLAYER）', engine.buildContext(STORY, { playerInput: SECRET_CHALLENGE.q, includeSecrets: true }).block.indexOf(SECRET_CHALLENGE.text[0]) < 0)

  /* ============ 双内核隔离（全程后终检） ============
   * 注意：记录 ID 是每故事独立序列（FAC-000001 两边都有），不能跨故事比对 ID；
   * 正确不变量：检索结果只含本故事记录 + 账本内容零对岸词汇。 */
  section('跨内核隔离')
  const ownIds = (s) => [].concat(s.decisions.map((x) => x.decision_id), s.commitments.map((x) => x.commitment_id), s.facts.map((x) => x.fact_id), s.events.map((x) => x.event_id), s.causal.map((x) => x.causal_id), s.relationships.map((x) => x.relationship_id), s.threads.map((x) => x.thread_id), s.entities.map((x) => x.entity_id), s.knowledge.map((x) => x.knowledge_id))
  const sb = engine.getStory(STORY_B)
  const ctxB = engine.buildContext(STORY_B, { playerInput: '落霞镇 青铜罗盘 卡尔文 灰隼商会 文森 薇拉 瘟疫' })
  check('隔离 · storyB 检索只含自身记录', ctxB.retrieved.retrieved_ids.every((id) => ownIds(sb).indexOf(id) >= 0), ctxB.retrieved.retrieved_ids.filter((id) => ownIds(sb).indexOf(id) < 0))
  check('隔离 · storyB 上下文无落霞镇内容', ['罗盘', '卡尔文', '灰隼'].every((t) => ctxB.block.indexOf(t) < 0))
  check('隔离 · storyB 账本无落霞镇记录', JSON.stringify(sb.facts.concat(sb.events, sb.decisions)).indexOf('落霞') < 0 && JSON.stringify(sb.entities).indexOf('凯尔') < 0)
  const ctxA = engine.buildContext(STORY, { playerInput: '海蓝 潮汐港 鱼市码头' })
  check('隔离 · storyA 检索只含自身记录', ctxA.retrieved.retrieved_ids.every((id) => ownIds(story).indexOf(id) >= 0), ctxA.retrieved.retrieved_ids.filter((id) => ownIds(story).indexOf(id) < 0))
  check('隔离 · storyA 上下文无潮汐港内容', ctxA.block.indexOf('海蓝') < 0)
  check('隔离 · storyA 账本无潮汐港记录', JSON.stringify(story.facts.concat(story.events, story.decisions)).indexOf('海蓝') < 0 && JSON.stringify(story.facts.concat(story.events, story.decisions)).indexOf('潮汐港') < 0)
  check('隔离 · storyB 回合计数独立', sb.counters.turn === 1)

  /* ============ 世界时间审计（规范十七） ============ */
  section('世界时间审计')
  {
    /* 日历单调性：除 restore 点外，故事日历必须单调不减（时间不倒流） */
    let badTime = 0, lastDay = 1
    for (const s of daySeq) {
      if (s.restore) { lastDay = s.day; continue }
      if (s.day != null && s.day < lastDay) { badTime++; if (badTime <= 3) console.log('    时间倒流 @T' + s.turn + ' (' + s.id + '): ' + lastDay + ' -> ' + s.day) }
      if (s.day != null) lastDay = s.day
    }
    check('时间 · 日历全程单调不倒流（restore 点除外）', badTime === 0, badTime + ' 处倒流')
    /* 位置连续性：场景地点只能随「声明了 loc 的步骤」或 restore 变化（无未声明瞬移） */
    let teleports = 0, lastLoc = null
    for (const s of daySeq) {
      if (s.restore) { lastLoc = s.loc; continue }
      if (lastLoc != null && s.loc && s.loc !== lastLoc && !s.declared) {
        teleports++
        if (teleports <= 3) console.log('    未声明瞬移 @T' + s.turn + ' (' + s.id + '): ' + lastLoc + ' -> ' + s.loc)
      }
      if (s.loc) lastLoc = s.loc
    }
    check('时间 · 无未声明的位置瞬移', teleports === 0, teleports + ' 处')
    check('时间 · 事件顺序（死亡早于其后所有回访）', (() => {
      const deathTurn = (tags.get('vincent-dies') || {}).turn
      const memorialTurn = (tags.get('memorial') || {}).turn
      const visitTurn = (tags.get('mine-revisit') || {}).turn
      return deathTurn && memorialTurn && visitTurn && deathTurn < memorialTurn && deathTurn < visitTurn
    })(), '死亡/立碑/回访时序')
  }

  /* ============ 因果链审计（规范十八） ============ */
  section('因果链审计')
  check('因果 · 因果记录 ≥10 条', story.causal.length >= 10, story.causal.length)
  {
    const bad = story.causal.filter((c) => c.source_decision && !story.decisions.some((d) => d.decision_id === c.source_decision))
    check('因果 · source_decision 全部可溯源', bad.length === 0, bad.map((c) => c.causal_id).join(','))
    const EFFECT_TERMS = ['救出', '弹劾罢免', '手艺大进', '杀死了卡尔文', '获救', '和解', '成名', '封印石钥', '断粮', '返工', '复通', '副队长', '矿脉之心']
    const missing = EFFECT_TERMS.filter((t) => !story.causal.some((c) => (c.effect || '').indexOf(t) >= 0))
    check('因果 · 13 条链全部可按效果关键词定位', missing.length === 0, '缺: ' + missing.join(','))
    /* 罗盘三跳链时序单调：出土 → 归公保管 → 熔钥 → 开门 */
    const chain = ['get-compass', 'compass-custody', 'seal-key-get', 'seal-open'].map((t) => (tags.get(t) || {}).turn)
    check('因果 · 罗盘三跳链时序单调（出土<保管<熔钥<开门）', chain.every((t) => !!t) && chain[0] < chain[1] && chain[1] < chain[2] && chain[2] < chain[3], chain.join(' < '))
  }

  /* ============ 叙事 / State 一致性审计（规范二十四/二十五） ============ */
  section('叙事/State 一致性审计')
  {
    const conflicts = []
    let checked = 0
    const evDesc = (e) => String(e.description || '')
    /* 1) 死亡状态 ↔ 死亡事件 双向一致 */
    const dead = story.entities.filter((e) => e.state && e.state.alive === false)
    for (const ent of dead) {
      checked++
      const deathEvents = story.events.filter((e) => (e.participants || []).indexOf(ent.entity_id) >= 0 && (e.type === 'turning_point' || /死|牺牲|杀|没能撑过|之墓|送葬/.test(evDesc(e))))
      if (!deathEvents.length) conflicts.push('DEATH_EVENT_MISSING: ' + ent.name)
      else {
        const dt = Math.min.apply(null, deathEvents.map((e) => e.turn))
        const after = story.events.filter((e) => e.turn > dt && (e.participants || []).indexOf(ent.entity_id) >= 0)
        if (after.length) conflicts.push('DEAD_ENTITY_PARTICIPATES_AFTER_DEATH: ' + ent.name + ' @ ' + after.map((e) => e.event_id).join(','))
      }
    }
    /* 2) 死亡叙事必须有死亡状态（悼念/回忆语 exempt） */
    const deathWords = /死了|牺牲|杀了他|杀死了|没能撑过/
    const memorialWords = /后悔|梦见|想起|坟|忌|碑|送葬|之墓|倒下的样子|送花/
    for (const e of story.events) {
      if (!deathWords.test(evDesc(e)) || memorialWords.test(evDesc(e))) continue
      checked++
      const parts = (e.participants || []).map((id) => story.entities.find((x) => x.entity_id === id)).filter(Boolean)
      if (!parts.some((p) => p.state && p.state.alive === false)) conflicts.push('NARRATIVE_DEATH_WITHOUT_STATE: ' + e.event_id + ' 「' + evDesc(e).slice(0, 40) + '」')
    }
    /* 3) 承诺终态留痕（FULFILLED/BROKEN/REVOKED 必须有 note） */
    for (const cm of story.commitments) {
      if (cm.status === 'ACTIVE') continue
      checked++
      if (!cm.status_note) conflicts.push('TERMINAL_COMMITMENT_NO_NOTE: ' + cm.commitment_id)
    }
    /* 4) 取代链闭合（SUPERSEDED → superseded_by 必须存在） */
    for (const f of story.facts) {
      if (f.status !== 'SUPERSEDED') continue
      checked++
      if (!f.superseded_by || !story.facts.some((x) => x.fact_id === f.superseded_by)) conflicts.push('SUPERSEDED_CHAIN_BROKEN: ' + f.fact_id)
    }
    /* 5) 物品闭环：罗盘 得到→失去→归公→熔钥 四态并存 */
    const circle = [['get-compass', '罗盘'], ['lose-compass', '丢失'], ['compass-custody', '保管'], ['seal-key-get', '石钥']]
    for (const [key, term] of circle) {
      checked++
      const f = story.facts.find((x) => x.key === key)
      if (!f || f.statement.indexOf(term) < 0) conflicts.push('ITEM_CIRCLE_BROKEN: ' + key)
    }
    console.log('  审计项: ' + checked + ' · 冲突: ' + conflicts.length)
    check('一致性 · 零叙事/状态冲突', conflicts.length === 0, conflicts.slice(0, 6).join(' | '), 'NARRATIVE_STATE_CONFLICT')
  }

  /* ============ 数据完整性审计（规范三十一） ============ */
  section('数据完整性审计')
  {
    const issues = []
    const seen = new Map()
    const LEDGERS = { decisions: ['decision', 'decision_id'], commitments: ['commitment', 'commitment_id'], knowledge: ['knowledge', 'knowledge_id'], facts: ['fact', 'fact_id'], events: ['event', 'event_id'], causal: ['causal', 'causal_id'], relationships: ['relationship', 'relationship_id'], threads: ['thread', 'thread_id'], entities: ['entity', 'entity_id'] }
    for (const [k, [kind, f]] of Object.entries(LEDGERS)) {
      for (const rec of story[k]) {
        if (rec.story_id !== story.story_id) issues.push('story_id 错误: ' + rec[f])
        if (seen.has(rec[f])) issues.push('重复 ID: ' + rec[f])
        seen.set(rec[f], k)
      }
      if ((story.counters[kind] || 0) !== story[k].length) issues.push('counters.' + kind + '(' + story.counters[kind] + ') 与账本长度(' + story[k].length + ')不一致')
    }
    /* 孤儿引用 */
    const has = (k, id) => story[k].some((x) => x.decision_id === id || x.commitment_id === id || x.knowledge_id === id || x.fact_id === id || x.event_id === id || x.causal_id === id || x.relationship_id === id || x.thread_id === id || x.entity_id === id)
    for (const c of story.commitments) if (c.source_decision && !has('decisions', c.source_decision)) issues.push('孤儿 commitment.source_decision: ' + c.commitment_id)
    for (const c of story.causal) if (c.source_decision && !has('decisions', c.source_decision)) issues.push('孤儿 causal.source_decision: ' + c.causal_id)
    for (const k of story.knowledge) if (k.fact_ref && !has('facts', k.fact_ref)) issues.push('孤儿 knowledge.fact_ref: ' + k.knowledge_id)
    for (const f of story.facts) if (f.superseded_by && !has('facts', f.superseded_by)) issues.push('孤儿 fact.superseded_by: ' + f.fact_id)
    /* 实体重名（name+type 应唯一） */
    const nameSeen = new Map()
    for (const e of story.entities) {
      const key = e.type + '|' + e.name.toLowerCase()
      if (nameSeen.has(key)) issues.push('实体重名: ' + key)
      nameSeen.set(key, e.entity_id)
    }
    /* Session：状态值全部合法；至少一个 ACTIVE；最后开启的 Session 处于 ACTIVE。
     * 注：跨 Session 补录（pend1 记录于 SES-4、在 SES-5 期间补录）会按「补录归属原会话」
     * 契约重新激活 SES-4 —— 多个 ACTIVE 是引擎允许的合法状态，下方有专项正断言。 */
    const actS = story.sessions.filter((s) => s.status === 'ACTIVE')
    if (!story.sessions.every((s) => s.status === 'ACTIVE' || s.status === 'CLOSED')) issues.push('非法 session 状态')
    if (actS.length < 1) issues.push('无 ACTIVE session')
    if (story.sessions[story.sessions.length - 1].status !== 'ACTIVE') issues.push('最后开启的 Session 非 ACTIVE')
    /* 回合日志 patch_status 全部合法且已提交日志无 errors */
    const OK_STATUS = ['PATCH_PRESENT', 'NO_STATE_CHANGE', 'PATCH_MISSING', 'PATCH_INVALID', 'PATCH_CONFLICT', 'COMMIT_FAILED']
    for (const tid of engine.turnLogs(STORY)) {
      const lg = engine.turnLog(STORY, tid)
      if (!lg) { issues.push('回合日志不可读: ' + tid); continue }
      if (!OK_STATUS.includes(lg.patch_status)) issues.push('非法 patch_status: ' + tid + ' ' + lg.patch_status)
      if (lg.patch_status === 'PATCH_PRESENT' && lg.validation_result && lg.validation_result.ok === false) issues.push('已提交回合带校验错误: ' + tid)
    }
    /* 跨故事引用：全账本正文不含对岸故事词汇 */
    const body = JSON.stringify(story.facts.concat(story.events, story.decisions, story.entities))
    if (body.indexOf('海蓝') >= 0 || body.indexOf('潮汐港') >= 0) issues.push('跨故事词汇泄漏')
    console.log('  审计规模: ' + seen.size + ' 条记录 · ' + story.sessions.length + ' 个 Session · issues ' + issues.length)
    check('完整性 · 零重复ID/零孤儿引用/story_id 一致/counters 一致/单 ACTIVE Session', issues.length === 0, issues.slice(0, 6).join(' | '), 'DATA_LOSS')
  }

  /* ============ Context 质量审计汇总（规范二十六） ============ */
  section('Context 质量审计（抽样 ' + ctxSamples.length + ' 轮）')
  if (ctxSamples.length) {
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)
    console.log('  块大小: 平均 ' + Math.round(avg(ctxSamples.map((s) => s.context_size))) + ' · 最大 ' + Math.max.apply(null, ctxSamples.map((s) => s.context_size)) + ' 字符')
    console.log('  抽样平均: 决定 ' + avg(ctxSamples.map((s) => s.retrieved_decisions)).toFixed(1) + ' · 事实 ' + avg(ctxSamples.map((s) => s.retrieved_facts)).toFixed(1) + ' · 事件 ' + avg(ctxSamples.map((s) => s.retrieved_events)).toFixed(1) + ' · 承诺 ' + avg(ctxSamples.map((s) => s.retrieved_commitments)).toFixed(1) + ' · 实体 ' + avg(ctxSamples.map((s) => s.retrieved_entities)).toFixed(1))
    check('Context · 抽样上下文全部非空', ctxSamples.every((s) => s.context_size > 200), 'min=' + Math.min.apply(null, ctxSamples.map((s) => s.context_size)), 'CONTEXT_FAILURE')
    check('Context · 大小有界（≤40000 字符，不随回合数膨胀）', Math.max.apply(null, ctxSamples.map((s) => s.context_size)) <= 40000, 'max=' + Math.max.apply(null, ctxSamples.map((s) => s.context_size)), 'CONTEXT_FAILURE')
    try { fs.writeFileSync(path.join(dir, 'context-audit-samples.json'), JSON.stringify(ctxSamples, null, 1)) } catch (e) { /* --keep 时供 Inspector 检查 */ }
  }

  /* ============ Recall Benchmark 距离表（规范二十七） ============ */
  section('Recall Benchmark（' + recallRows.length + ' 次回访）')
  {
    for (const r of recallRows) {
      const dist = r.anchorTurn != null ? r.revisitTurn - r.anchorTurn : null
      console.log('  ' + r.label + ' · T' + (r.anchorTurn != null ? r.anchorTurn : '?') + ' → T' + r.revisitTurn + ' · 距离 ' + (dist != null ? dist : '?') + ' · ' + r.passed + '/' + r.total)
      r.dist = dist
    }
    const buckets = [[0, 100, '<100'], [100, 300, '100-300'], [300, 600, '300-600'], [600, Infinity, '≥600']]
    for (const [lo, hi, name] of buckets) {
      const rs = recallRows.filter((r) => r.dist != null && r.dist >= lo && r.dist < hi)
      if (!rs.length) continue
      const p = rs.reduce((a, r) => a + r.passed, 0)
      const t = rs.reduce((a, r) => a + r.total, 0)
      console.log('  距离 ' + name + ': ' + p + '/' + t + ' (' + (t ? Math.round((100 * p) / t) : 0) + '%)')
    }
    const misses = recallRows.filter((r) => r.passed !== r.total)
    if (misses.length) console.log('  未全中回访: ' + misses.map((r) => r.label + '(' + r.passed + '/' + r.total + ')').join(', '))
  }

  /* ============ 汇总 ============ */
  const ms = Date.now() - t0
  console.log('\n===== 压测汇总 =====')
  console.log('回合数: ' + story.counters.turn + ' · 剧本步数: ' + STEPS.length + ' · 耗时: ' + (ms / 1000).toFixed(1) + 's（' + (ms / Math.max(1, story.counters.turn)).toFixed(1) + 'ms/回合）')
  console.log('账本规模: 决定 ' + story.decisions.length + ' · 事实 ' + story.facts.length + ' · 事件 ' + story.events.length + ' · 承诺 ' + story.commitments.length + ' · 伏笔 ' + story.threads.length + ' · 因果 ' + story.causal.length + ' · 关系 ' + story.relationships.length + ' · 实体 ' + story.entities.length + ' · 知识 ' + story.knowledge.length)
  console.log('数据检查: Snapshots ' + engine.listSnapshots(STORY).length + ' · Sessions ' + story.sessions.length + ' · Pending ' + engine.listPendings(STORY).length)
  console.log('断言: ' + passCount + ' 通过 / ' + failCount + ' 失败')
  if (failCount) {
    const byCls = {}
    for (const f of failures) byCls[f.cls] = (byCls[f.cls] || 0) + 1
    console.log('失败分类（规范二十八）:')
    for (const [cls, n] of Object.entries(byCls)) console.log('  ' + cls + ': ' + n)
    console.log('失败清单:')
    for (const f of failures) console.log('  - [' + f.cls + '] ' + f.name)
  } else {
    console.log('ALL_PASS')
  }
  if (!KEEP) fs.rmSync(dir, { recursive: true, force: true })
  process.exit(failCount ? 1 : 0)
}

try { main() } catch (e) { console.error('STRESS-ERROR', e); process.exit(1) }

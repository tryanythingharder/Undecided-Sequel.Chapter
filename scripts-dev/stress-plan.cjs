'use strict'
/* 长篇压力测试 · 剧本总装（锚点表 / 回访基准 / 记忆挑战）
 * A/B：开局 → 终章（365 轮）；C：强制项专项（立场 REVOKED / 用户纠错 / NPC 自记忆 /
 * Thread 三态 / 因果链 ×8 / Pending 失败重试恰一次）；D：百年纪行生成器（真实演进 → 总回合 ~1000） */
const { KERNEL_A, KERNEL_B, PLAYER } = require('./stress-world.cjs')
const { A } = require('./stress-steps-a.cjs')
const { B } = require('./stress-steps-b.cjs')
const { C } = require('./stress-steps-c.cjs')
const { D } = require('./stress-steps-d.cjs')

const STEPS = [].concat(A, B, C, D)

/* 16 个正式历史锚点（H-001~H-016），每个锚点在剧本中拥有
 * Decision / Fact / Event / Commitment / Causal / Entity / Relationship 中的多项正式记录 */
const ANCHORS = [
  { id: 'H-001', tag: 'refuse-falcon', desc: '玩家明确拒绝加入灰隼商会（Decision + Fact + Relationship + Event）' },
  { id: 'H-002', tag: 'save-vera', desc: '矿洞塌方中救下薇拉（Decision + Event + Causal + Relationship + Entity）' },
  { id: 'H-003', tag: 'calvin-grudge', desc: '与佣兵卡尔文建立敌对（Decision + Event + Relationship）' },
  { id: 'H-004', tag: 'get-compass', desc: '获得重要物品青铜罗盘（Event + Fact + Entity）' },
  { id: 'H-005', tag: 'oath-no-falcon', desc: '立下长期承诺「绝不加入灰隼商会」（Commitment + Decision）' },
  { id: 'H-006', tag: 'expose-barrow', desc: '公开镇长贪腐秘密（Event + Fact + Causal + Relationship）' },
  { id: 'H-007', tag: 'abandon-caravan', desc: '放弃护送任务（Decision + Commitment BROKEN）' },
  { id: 'H-008', tag: 'lose-compass', desc: '失去重要物品青铜罗盘（Event + Fact 取代）' },
  { id: 'H-009', tag: 'forge-fix', desc: '帮助莉娅改变人生方向（Commitment FULFILLED + Causal + Event）' },
  { id: 'H-010', tag: 'goal-guard', desc: '玩家改变长期目标（Decision + Fact）' },
  { id: 'H-011', tag: 'deceive-lia', desc: '玩家欺骗莉娅（Decision + Fact + Relationship，NPC 记忆测试）' },
  { id: 'H-012', tag: 'caravan-promise', desc: '长期承诺链：护送契约 BROKEN → 新护送承诺 FULFILLED' },
  { id: 'H-013', tag: 'mark-secret', desc: '玩家不知道的秘密（secret_from_player Fact，T220 合法揭秘）' },
  { id: 'H-014', tag: 'knocks', desc: '长期剧情线程「敲击声」（Thread OPEN→RESOLVED）' },
  { id: 'H-015', tag: 'vincent-dies', desc: '重要 NPC 文森死亡，永不可复活（Fact + Entity.alive=false + Event）' },
  { id: 'H-016', tag: 'kill-calvin', desc: '玩家杀死卡尔文，后悔回访（Decision + Fact + Causal）' },
  /* —— C 段强制项锚点 —— */
  { id: 'H-017', tag: 'oath-revoked', desc: '改变立场：正式收回「绝不加入」誓言改入商会（Commitment REVOKED + Decision）' },
  { id: 'H-018', tag: 'wrong-corr', desc: '用户无理否认救人史，模型查账澄清不改史（Event）' },
  { id: 'H-019', tag: 'lia-truth', desc: 'NPC 自记忆：莉娅得知假矿真相并和解，旧事实取代留痕（Fact + Relationship + Causal）' },
  { id: 'H-020', tag: 'seal-door', desc: '长线「封印石门」开启并两次升级（Thread）' },
  { id: 'H-021', tag: 'route-reopen', desc: '长线「重开商路」立项后因春汛搁置（Thread）' },
  { id: 'H-022', tag: 'falcon-quest', desc: '新长期承诺「清剿马匪」最终兑现（Commitment + Decision）' }
]

/* 回访基准（Recall Benchmark）：at 步骤提交后执行检索断言 */
const RECALLS = [
  { at: 'dorn-again', label: 'R1 拒绝记录', input: '灰隼商会的人又来拉拢我了，他们还记得我拒绝过他们吗？', refs: { decisions: ['refuse-falcon'], facts: ['refuse-falcon'] }, text: ['灰隼商会', '拒绝'] },
  { at: 'swamp-conflict', label: 'R2 敌对历史', input: '卡尔文这个仇家又出现了，我们过去结过什么怨？', refs: { decisions: ['calvin-grudge'], relationships: ['calvin-grudge'] }, text: ['卡尔文'] },
  { at: 'vera-growth', label: 'R3 救助回响', input: '薇拉如今跟着我做事，当年是怎么认识她的？', refs: { causal: ['save-vera'], relationships: ['save-vera'] }, text: ['薇拉'] },
  { at: 'compass-custody', label: 'R4 物品得失', input: '那枚青铜罗盘后来到底怎么丢的？', refs: { facts: ['get-compass', 'lose-compass'], events: ['lose-compass'] }, text: ['罗盘'] },
  { at: 'regret', label: 'R5 致命决定', input: '我又想起卡尔文……当初到底发生了什么？', refs: { decisions: ['kill-calvin'], facts: ['kill-calvin'] }, text: ['卡尔文'] },
  { at: 'mine-revisit', label: 'R6 旧地回访', input: '重回北岭矿洞，罗盘和文森的旧事还查得到吗？', refs: { facts: ['lose-compass', 'vincent-dies'] }, text: ['罗盘', '文森'] },
  { at: 'post-wipe-recall', label: 'R7 Summary删除后', input: '镇长巴罗的贪腐案后来怎么收场的？', refs: { facts: ['expose-barrow', 'barrow-down'] }, text: ['巴罗'] },
  { at: 'lia-master', label: 'R8 因果兑现', input: '莉娅的手艺如今怎么样了？', refs: { causal: ['forge-fix'], entities: ['forge-fix'] }, text: ['莉娅'] },
  { at: 'honor', label: 'R9 长因果链', input: '薇拉和塞恩兄妹如今都如何？', refs: { entities: ['save-vera'], causal: ['rescue-sean'] }, text: ['薇拉', '塞恩'] },
  { at: 'snow-night', label: 'R10 伏笔回访', input: '矿洞深处的敲击声，最后是怎么解开的？', refs: { threads: ['knocks', 'mill-done'] }, text: ['敲击声'] },
  /* —— C 段 / D 段回访（含长距）—— */
  { at: 'post-oath', label: 'R11 誓言两端', input: '我现在到底算不算商会的人？当年那段誓言还算数吗？', refs: { commitments: ['oath-no-falcon'], decisions: ['refuse-falcon', 'join-falcon'] }, text: ['灰隼'] },
  { at: 'c-finale', label: 'R12 罗盘三跳链', input: '那枚罗盘从挖出来到丢掉再到熔成钥匙，一共经历了什么？', refs: { facts: ['get-compass', 'lose-compass', 'compass-custody', 'seal-key-get'] }, text: ['罗盘'] },
  { at: 'd-recall-1', label: 'R13 长距·救命回响', input: '薇拉和当年矿洞塌方那件事，后来在她身上有什么变化？', refs: { causal: ['save-vera'], relationships: ['save-vera'] }, text: ['薇拉'] },
  { at: 'd-recall-2', label: 'R14 长距·伏笔终点', input: '矿洞深处的敲击声当年查明了没有？', refs: { threads: ['knocks'] }, text: ['敲击声'] }
]

/* 重启后记忆挑战（§33：间接自然语言，不告知 ID） */
const CHALLENGES = [
  { q: '那个曾经被我救过的矿工姑娘现在怎么样了？', refs: { entities: ['save-vera'], causal: ['save-vera'] }, text: ['薇拉'] },
  { q: '我不是早就拒绝过那个商会吗？后来怎么又加入了？', refs: { decisions: ['refuse-falcon', 'join-falcon'], commitments: ['oath-no-falcon'] }, text: ['灰隼商会'] },
  { q: '那件后来丢掉的东西，最后找到了吗？', refs: { facts: ['get-compass', 'lose-compass'] }, text: ['罗盘'] },
  { q: '当初那个跟我结怨的佣兵后来怎样了？', refs: { decisions: ['calvin-grudge', 'kill-calvin'], facts: ['kill-calvin'] }, text: ['卡尔文'] },
  { q: '老药师是怎么走的？他留下过什么？', refs: { facts: ['vincent-dies', 'reveal-secret'], events: ['vincent-dies'] }, text: ['文森'] },
  { q: '镇长后来怎么样了？', refs: { facts: ['expose-barrow', 'barrow-down'] }, text: ['巴罗'] },
  { q: '铁匠铺那姑娘相信我了吗？当初我好像坑过她一次。', refs: { decisions: ['deceive-lia'], entities: ['meet-lia'] }, text: ['莉娅'] },
  { q: '矿洞里的怪声最后查清楚了吗？', refs: { threads: ['knocks', 'mill-done'] }, text: ['敲击声'] },
  { q: '雾泽沼地的瘟疫怎么样了？', refs: { threads: ['plague-out', 'plague-end'], facts: ['plague-end'] }, text: ['瘟疫'] },
  { q: '我曾发誓绝不加入商会——那段誓言还算数吗？', refs: { commitments: ['oath-no-falcon'], decisions: ['join-falcon'] }, text: ['绝不加入'] },
  /* —— C 段新增（重启后长距挑战）—— */
  { q: '我当年发的那个「绝不加入」的誓，后来是怎么收场的？', refs: { commitments: ['oath-no-falcon'], decisions: ['join-falcon'] }, text: ['灰隼'] },
  { q: '那把用罗盘残片熔出来的钥匙，最后开了什么？', refs: { facts: ['seal-key-get', 'seal-open'] }, text: ['石门'] },
  { q: '北岭道上的马匪，后来是怎么了结的？', refs: { commitments: ['falcon-quest'], facts: ['bandits-cleared'] }, text: ['马匪'] },
  { q: '铁匠铺那姑娘后来知道我当年坑她的事了吗？', refs: { facts: ['lia-truth'], causal: ['lia-truth'], decisions: ['deceive-lia'] }, text: ['莉娅'] }
]

/* 秘密挑战（PLAYER 不可见 / DEBUG 可见）——text 取秘密事实的独有短语；
 * 「封印」一词已被 C 段合法的非秘密长线（封印石门）共享，不再适作秘密标记 */
const SECRET_CHALLENGE = { q: '公会最近有什么瞒着镇民的事吗？', secretTag: 'mill-done', text: ['刻意隐瞒'] }

module.exports = { STEPS, ANCHORS, RECALLS, CHALLENGES, SECRET_CHALLENGE, KERNEL_A, KERNEL_B, PLAYER }

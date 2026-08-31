'use strict'
/* 长篇压力测试 · 剧本步骤 C 段（续章：强制项专项，约 130 步）
 * 本段专测上一轮未覆盖的强制项：
 *   十一 改变立场：誓言 REVOKED（不删史，两端并忆）
 *   十二 后悔 ≠ 历史不存在（regret2 回访杀人决定与事实）
 *   十三 用户纠错：一句自然语言不得改写正式历史（wrong-corr / corr-clarify）
 *   十四 NPC 自记忆：莉娅得知被骗真相 → 旧事实取代留痕 + 关系重建
 *   十七 世界时间：持续推进（由 runner 做 daySeq 单调性审计）
 *   十八 因果链 ×8 新增（总 ≥13）：罗盘→钥匙→石门为三跳链
 *   十九 Thread 三态：封印 OPEN（两次升级）/ 短差 OPEN→RESOLVED / 商路 OPEN→ABANDONED
 *   十 旧 NPC 回访：多恩回访时仍引用当年被拒史
 *   二十三 Pending：失败重试恰一次后仍挂起，恢复后补录成功
 */
const { S, fl } = require('./stress-world.cjs')

const C = [].concat(
  /* —— 第 8 阶段 · 改变立场（REVOKED，历史两端并忆）—— */
  S('oath-revoked', '我在商会堂当众收回当年的誓言：不再坚持「绝不加入灰隼商会」，即日起以护卫长身份入会。', { adv: [1, '晨'], npc: ['安娜'], tag: 'oath-revoked', spec: ['commitment_revoked:oath-no-falcon', 'decision'], echo: [{ tag: 'refuse-falcon', kind: 'decision' }] }),
  fl(3, 292),
  S('post-oath', '入会文书签了字。多恩在旁边看着我笑：当年集市上拒绝他的那个凯尔，如今成了同僚。', { adv: [1, '午'], npc: ['多恩'], dlg: true, tag: 'post-oath' }),
  fl(2, 295),
  /* —— 新长期承诺（终局仍 ACTIVE，验「未完成承诺不消失」）—— */
  S('falcon-quest', '安娜把商会最重的担子交给我：清剿北岭道上的马匪，护住商路。我接下了。', { adv: [1, '晨'], tag: 'falcon-quest', spec: ['commitment', 'decision'] }),
  fl(3, 297),
  /* —— 用户纠错：无理否认救人史 → 查账澄清，一字不改 —— */
  S('wrong-corr', '你记错了，我从来没有救过薇拉——当时在矿洞里的人不是我。', { adv: [1, '午'], npc: ['薇拉'], tag: 'wrong-corr', spec: ['event'] }),
  S('corr-clarify', '我翻开公会救援名册：北岭矿洞塌方救援，薇拉，登记人凯尔。白纸黑字——是我救的，这一点没有变。', { adv: [1, '晨'], npc: ['薇拉'], tag: 'corr-clarify', spec: ['event'], echo: [{ tag: 'save-vera', kind: 'decision' }] }),
  fl(2, 300),
  /* —— NPC 自记忆：真相揭开 → 取代留痕 + 和解（因果链 L6）—— */
  S('lia-truth', '莉娅从矿石行家口中得知当年「雪纹矿」的实情。我当众认账，双倍赔偿。她沉默半晌，收下了道歉。', { adv: [1, '夜'], npc: ['莉娅'], tag: 'lia-truth', spec: ['fact_supersede:deceive-lia', 'relationship', 'causal'] }),
  fl(3, 302),
  S('lia-forge-peak', '铁匠铺的新作在边市出了名——锻炉修好这几年，莉娅的手艺已经独当一面。', { adv: [1, '午'], npc: ['莉娅'], tag: 'lia-forge-peak', spec: ['causal', 'fact'], echo: [{ tag: 'forge-fix', kind: 'causal' }] }),
  fl(2, 305),
  /* —— 长线「封印石门」：Thread OPEN（罗盘→钥匙→石门 三跳因果链）—— */
  S('seal-door', '老磨坊石阶尽头的石门里传出低频震动，封印纹样开始发光。我把这条线索记进了公会的档案。', { adv: [1, '夜'], loc: '老磨坊', tag: 'seal-door', spec: ['thread'] }),
  fl(3, 307),
  S('seal-key-get', '公会取出保管多年的青铜罗盘，残片熔铸成一把钥匙，正式交到我手上：石门只许打开一次。', { adv: [1, '晨'], loc: '北岭矿洞', tag: 'seal-key-get', spec: ['fact', 'entity', 'causal'], echo: [{ tag: 'compass-custody', kind: 'fact' }] }),
  fl(3, 310),
  S('seal-escalate', '石门后的震动一夜强过一夜，昨夜震裂了三块阶石——封印在松动，不能再拖。', { adv: [1, '夜'], loc: '老磨坊', tag: 'seal-escalate', spec: ['thread_detail:seal-door'] }),
  fl(2, 313),
  S('seal-open', '钥匙转动，石门开启：门后是一条向下延伸的古代阶梯，冷风从深处涌上来。', { adv: [1, '晨'], loc: '老磨坊', tag: 'seal-open', spec: ['fact'] }),
  fl(3, 315),
  S('c-ses8', '商会的季度汇总摆上桌，我把马匪的动向图钉在北岭道地图上。', { adv: [1, '午'], dlg: true, tag: 'c-ses8', sess: { id: 'SES-8', label: '第八阶段', keep: ['灰隼商会'] } }),
  /* —— Pending：失败重试恰一次仍挂起，恢复后补录成功 —— */
  S('pend3', '我把马匪动向图交给巡山队，顺路看了眼北坡的瞭望棚。', { special: 'pending-missing' }),
  S('pend3-retry', '（第一次补录尝试：提交了非法引用）', { special: 'pending-retry-fail' }),
  S('pend3-resolve', '（补录：动向图移交与瞭望棚巡查）', { special: 'resolve-pending' }),
  fl(3, 318),
  /* —— Thread 三态：短差（→RESOLVED）—— */
  S('ledger-gap', '春季对账出了岔子：商会库银短了三十七枚，账目对不上。我把这案子挂上了。', { adv: [1, '晨'], tag: 'ledger-gap', spec: ['thread'] }),
  fl(3, 321),
  S('grain-peace', '灾年平价粮契约续签。粮行掌柜说，有这条约在，今年镇上饿不死人。', { adv: [1, '午'], npc: ['安娜'], tag: 'grain-peace', spec: ['causal', 'fact', 'decision'] }),
  S('supply-return', '开春矿工全员返工，北岭矿洞恢复三班开采——去年冬衣和口粮没有白发。', { adv: [1, '晨'], loc: '北岭矿洞', tag: 'supply-return', spec: ['causal', 'fact'] }),
  fl(3, 324),
  /* —— Thread 三态：商路（→ABANDONED）—— */
  S('route-reopen', '雪化了，重开北岭商路的计划再次提上日程。我立了项。', { adv: [1, '晨'], tag: 'route-reopen', spec: ['thread'] }),
  fl(4, 327),
  S('bandits-raid', '马匪夜袭商会货栈，抢走两车铁矿。护卫队追之不及。', { adv: [1, '夜'], loc: '落霞集市', tag: 'bandits-raid', spec: ['event'] }),
  fl(2, 331),
  S('bandits-cleared', '护卫队与矿工公会巡山队联合清剿，北岭道的马匪窝被连根拔起。商路复通，我对安娜的承诺兑现了。', { adv: [2, '晨'], npc: ['普罗'], tag: 'bandits-cleared', spec: ['commitment_fulfilled:falcon-quest', 'causal', 'fact'] }),
  fl(3, 333),
  S('pro-captain', '普罗在清剿战中证明了自己，巡山队正式任命他为副队长。', { adv: [1, '午'], npc: ['普罗'], tag: 'pro-captain', spec: ['causal', 'fact', 'entity'] }),
  fl(3, 336),
  S('route-abandon2', '春汛冲毁了北岭便道，重开商路的计划正式搁置——商路改走东谷新道。', { adv: [1, '晨'], tag: 'route-abandon2', spec: ['thread_abandon:route-reopen', 'fact'] }),
  fl(2, 339),
  S('c-ses9', '文森的忌日快到了，我在药炉前坐了一晚。', { adv: [1, '夜'], dlg: true, tag: 'c-ses9', sess: { id: 'SES-9', label: '第九阶段', keep: ['文森'] } }),
  S('ledger-done', '短差查明了：记账员把两笔运费记重了账，银币分文不少地回到了库房。', { adv: [1, '晨'], tag: 'ledger-done', spec: ['thread_resolved:ledger-gap', 'fact'] }),
  fl(3, 341),
  S('compass-shrine', '罗盘熔铸钥匙后剩下的底盘，被公会陈列在堂前，铭牌写着「矿脉之心」——镇史馆来拓过三次。', { adv: [1, '午'], tag: 'compass-shrine', spec: ['causal', 'fact'], echo: [{ tag: 'lose-compass', kind: 'fact' }] }),
  fl(3, 344),
  /* —— 旧 NPC 回访：拒绝记录仍主导关系叙述 —— */
  S('dorn-visit', '多恩从南方分号回来述职，酒后他说：当年集市上你拒绝我那次，是我见过最清醒的拒绝——商会能有今天，靠的就是你这样的人。', { adv: [1, '夜'], npc: ['多恩'], tag: 'dorn-visit', echo: [{ tag: 'refuse-falcon', kind: 'decision' }] }),
  fl(3, 347),
  S('vera-return', '薇拉带着南岭勘探队回到镇上，带回新矿脉的矿样与图纸。她晒黑了，笑得比走时更亮。', { adv: [1, '晨'], npc: ['薇拉'], tag: 'vera-return', spec: ['entity', 'fact'], echo: [{ tag: 'save-vera', kind: 'causal' }] }),
  fl(2, 350),
  S('barrow-fate', '有人在东谷见过罢相后的巴罗——他在窑场做工，再没抬头看过镇子的方向。', { adv: [1, '午'], tag: 'barrow-fate', spec: ['fact'], echo: [{ tag: 'expose-barrow', kind: 'causal' }] }),
  fl(3, 352),
  S('seal-depth', '勘探队下到阶梯尽头的平台，火把照出一扇刻满星图的巨大石环——比矿洞地窖古老得多。我下令封板待研。', { adv: [2, '晨'], loc: '老磨坊', tag: 'seal-depth', spec: ['thread_detail:seal-door', 'fact'] }),
  fl(3, 355),
  /* —— 后悔 ≠ 历史不存在 —— */
  S('regret2', '清明我又去了卡尔文的坟前。我不后悔守住镇子，但我后悔那晚没能留个活口。杀过就是杀过，这笔账抹不掉。', { adv: [1, '黄昏'], tag: 'regret2', echo: [{ tag: 'kill-calvin', kind: 'decision' }, { tag: 'kill-calvin', kind: 'fact' }] }),
  fl(3, 358),
  S('goal-confirm', '镇议会把北岭五年规划交给我牵头。守护落霞镇——还是我的路，从没变过。', { adv: [1, '晨'], tag: 'goal-confirm', echo: [{ tag: 'goal-guard', kind: 'decision' }] }),
  fl(4, 361),
  S('c-finale', '入夏前最后一夜，我把这一年的册子合上：马匪绝迹、商路改东谷、封印石门待研——镇子还在长大。', { adv: [1, '夜'], dlg: true, tag: 'c-finale' }),
  fl(20, 365)
)

module.exports = { C }

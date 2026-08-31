'use strict'
/* 长篇压力测试 · 剧本步骤 D 段生成器（「百年纪行」，把总回合推至 ~1000）
 * 规范三十要求 1000 Turn 必须是真实状态演进、禁止空操作刷数据。
 * 生成器用固定种子的确定性伪随机，把 12 类「纪行模板」轮转展开：
 *   贸易 / 勘探 / NPC 成长 / 设施修缮 / 调停 / 承诺开立 / 承诺兑现 / 见闻 /
 *   对账 / 天候 / 演练 / 封印观测——每步都有唯一的正式记录（事实/关系/实体/
 *   承诺/因果/伏笔），并推进虚拟日历；每 48 步一次旧锚点回响（echo），
 *   两个 designated 回访探针（d-recall-1/2）供 RECALLS 长距锚定。
 * 每步的 spec/content 内联在步骤对象上（runner 优先读取），不污染全局 SPEC/CONTENT。
 */

/* 固定种子伪随机（mulberry32）——两次运行生成完全相同的剧本 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOD = ['晨', '午', '黄昏', '夜']
const KNOWN = ['薇拉', '莉娅', '塞恩', '普罗', '安娜', '多恩'] // 既有关系网
const NEWBIES = ['铁蛋', '春杏', '石岚', '白桦', '桑格', '秋叔', '杜五', '纪云'] // 新次要人物（引擎自动建实体）
const PLACES = ['北岭矿洞', '落霞集市', '老磨坊', '雾泽沼地', '东谷新道', '南岭工棚', '河湾渡口', '窑场']
const GOODS = ['云母矿样', '雪纹矿', '蜂蜡', '皮料', '药草', '铁锭', '盐包', '松脂', '铜锭', '羊毛']
const WEATHER = ['秋雨', '大雪', '浓雾', '大风', '酷暑', '连阴雨']

/* 旧锚点回响轮换表：让「百年纪行」期间始终定期触碰最老的记忆 */
const ECHO_POOL = [
  { tag: 'refuse-falcon', kind: 'decision', term: '灰隼商会', line: '翻起旧册子，想起当年在集市上回绝灰隼商会的那个午后。' },
  { tag: 'save-vera', kind: 'causal', term: '薇拉', line: '路过矿工工棚，想起当年从塌方里把薇拉拖出来的那个早晨。' },
  { tag: 'get-compass', kind: 'fact', term: '罗盘', line: '公会堂前的「矿脉之心」前站了站，想起罗盘刚出土那天的光。' },
  { tag: 'kill-calvin', kind: 'decision', term: '卡尔文', line: '雨夜又梦见卡尔文。有些账，一辈子都在册子上。' },
  { tag: 'knocks', kind: 'thread', term: '敲击声', line: '夜里静得能听见风，忽然想起矿洞深处的敲击声——谜底早已归档。' },
  { tag: 'vincent-dies', kind: 'fact', term: '文森', line: '药炉上的纹章擦了又擦。文森走后，这炉子就是纪念碑。' },
  { tag: 'oath-no-falcon', kind: 'commitment', term: '誓言', line: '整理文书时翻到当年那页誓言——收回了，但纸还在。' },
  { tag: 'expose-barrow', kind: 'causal', term: '巴罗', line: '东谷方向起了炊烟。想起巴罗倒台那天集市的欢呼。' }
]

function buildD(n, seed) {
  const rnd = mulberry32(seed || 20260828)
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length]
  const num = (min, max) => min + Math.floor(rnd() * (max - min + 1))
  const steps = []
  const promiseQ = [] // 已开立未兑现的承诺 tag 队列
  let day = 0
  for (let i = 0; i < n; i++) {
    const id = 'd-' + i
    const slot = i % 12
    const cyc = Math.floor(i / 12)
    const npc = cyc % 2 === 0 ? KNOWN[(cyc / 2) % KNOWN.length | 0] : NEWBIES[(cyc / 2 | 0) % NEWBIES.length]
    const place = PLACES[(i * 3 + cyc) % PLACES.length]
    const good = GOODS[(i * 7 + 1) % GOODS.length]
    const cnt = num(2, 9)
    day += num(1, 3)
    const base = { id, tag: id, adv: [day, TOD[i % 4]], day }
    day = 0
    /* 每 9 步左右 declared-loc 移动一次（位置审计的合法移动） */
    const move = i % 9 === 4 ? { loc: place } : {}

    let step
    switch (slot) {
      case 0: // 贸易
        step = Object.assign(base, move, {
          input: '和' + npc + '谈成了' + good + '的生意，' + cnt + '驮货发往' + place + '。',
          spec: ['fact'], impFact: 40, impEvt: 20,
          content: { fact: '凯尔与' + npc + '的' + good + '生意谈成，' + cnt + '驮货发往' + place + '（纪行第' + i + '笔）' }
        })
        break
      case 1: // 勘探（因果链：勘探→登记）
        step = Object.assign(base, move, {
          input: '勘探队从' + place + '带回第' + cnt + '批矿样，验出含银痕迹，登记入册。',
          spec: ['fact', 'causal', 'decision'], impFact: 42, impEvt: 30, impCausal: 35,
          content: {
            fact: '第' + cnt + '批' + place + '矿样验出含银痕迹，已登记入册',
            cau: { cause: '勘探队持续勘探' + place, effect: '第' + cnt + '批矿样验出含银，矿脉档案更新', importance: 35 }
          }
        })
        break
      case 2: // NPC 成长
        step = Object.assign(base, move, {
          input: npc + '如今能独当一面了，接手了' + place + '的日常事务。',
          spec: ['entity', 'relationship'], impEvt: 28,
          content: {
            rel: { source_name: '凯尔', target_name: npc, relation_type: '共事', strength_delta: 1, description: npc + '接手' + place + '事务，与凯尔配合熟练' },
            ent: { name: npc, type: 'character', state: { role: place + '事务管办' } }
          }
        })
        break
      case 3: // 设施修缮
        step = Object.assign(base, move, {
          input: place + '入冬前修缮了' + cnt + '处设施，工料账目入册。',
          spec: ['fact'], impFact: 30, impEvt: 15,
          content: { fact: place + '修缮了' + cnt + '处设施，工料账目入册' }
        })
        break
      case 4: // 调停
        step = Object.assign(base, move, {
          input: place + '的两家摊贩起了口角，' + npc + '来找我评理，各让一步，事情说开了。',
          dlg: true, spec: ['relationship'], impEvt: 22,
          content: { rel: { source_name: '凯尔', target_name: npc, relation_type: '调停与信任', strength_delta: 1, description: '凯尔在' + place + '为' + npc + '评理，公道人设又深一层' } }
        })
        break
      case 5: // 承诺开立
        step = Object.assign(base, move, {
          input: '答应' + npc + '，下月' + good + '到货后优先留' + cnt + '份给他。',
          spec: ['commitment', 'decision'], impEvt: 40,
          content: { cmt: { content: '下月' + good + '到货后优先留' + cnt + '份给' + npc, kind: 'promise' } }
        })
        promiseQ.push(id)
        break
      case 6: // 承诺兑现（兑现上一轮开立的；末段留一条 ACTIVE 到终局，验「未完成承诺不消失」）
        if (promiseQ.length && i < n - 16) {
          const ptag = promiseQ.shift()
          step = Object.assign(base, move, {
            input: good + '到货了。我兑现了答应' + npc + '的那句留货的话，' + cnt + '份如数交割。',
            spec: ['commitment_fulfilled:' + ptag], impEvt: 36
          })
        } else {
          step = Object.assign(base, move, {
            input: good + '到货入库，' + cnt + '份登记造册。',
            spec: ['fact'], impFact: 30, impEvt: 15,
            content: { fact: good + '到货' + cnt + '份入库登记' }
          })
        }
        break
      case 7: // 见闻（事件 only）
        step = Object.assign(base, move, {
          input: '旅人说起' + place + '的传闻，真假难辨，我只记了一笔。',
          dlg: true, spec: ['event'], impEvt: 10
        })
        break
      case 8: // 对账（事件 only）
        step = Object.assign(base, move, {
          input: '核对完' + (cnt * 11) + '笔往来账，分毫不差。',
          spec: ['event'], impEvt: 8
        })
        break
      case 9: // 天候
        step = Object.assign(base, move, {
          input: place + '连日' + pick(WEATHER) + '，商队行程改期两天。',
          spec: ['fact'], impFact: 24, impEvt: 10, adv: [day + 2, TOD[i % 4]], day: 0,
          content: { fact: place + '连日恶候，商队改期（纪行第' + i + '条）' }
        })
        break
      case 10: // 演练
        step = Object.assign(base, move, {
          input: '带搜救队在' + place + '演练绳索救援，' + npc + '带队，新人上来了' + cnt + '个。',
          spec: ['relationship', 'entity'], impEvt: 24,
          content: {
            rel: { source_name: '凯尔', target_name: npc, relation_type: '搜救同袍', strength_delta: 1, description: '搜救演练中' + npc + '带队有方' },
            ent: { name: npc, type: 'character', state: { skill: '绳索救援教官' } }
          }
        })
        break
      case 11: // 封印观测（长期伏笔持续演化）
        step = Object.assign({ id, tag: id, adv: [day, '夜'], day: 0, loc: '老磨坊' }, {
          input: '石环星图在夜里又亮了一格，我把观测记录归档，仍按兵不动。',
          spec: ['thread_detail:seal-door', 'fact'], impFact: 38, impEvt: 30,
          content: { fact: '石环星图第' + (cyc + 1) + '格亮起，观测记录已归档封存' }
        })
        break
    }

    /* 每 48 步（4 轮）一次旧锚点回响；两个长距回访探针 */
    if (i > 0 && i % 48 === 20) {
      const e = ECHO_POOL[(i / 48) % ECHO_POOL.length | 0]
      step.echo = [{ tag: e.tag, kind: e.kind }]
      step.input = e.line
      step.dlg = true
    }
    if (i === Math.floor(n * 0.4)) { step.id = 'd-recall-1'; step.tag = 'd-recall-1'; step.input = '工棚里又见薇拉，当年矿洞塌方把她拖出来的事，她还在跟新人讲。' }
    if (i === Math.floor(n * 0.75)) { step.id = 'd-recall-2'; step.tag = 'd-recall-2'; step.input = '路过矿洞口，想起当年深处的敲击声——谜底归档多年，石阶还在。' }
    steps.push(step)
  }
  return steps
}

const DEFAULT_D_COUNT = 512
const D = buildD(DEFAULT_D_COUNT)

module.exports = { buildD, D, DEFAULT_D_COUNT }

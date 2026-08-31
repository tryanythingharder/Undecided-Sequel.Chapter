// validate-kernel-xianxia.cjs —— 校验修仙内核的结构与格式契约
const fs = require('fs')
const path = require('path')
const file = path.join(__dirname, '..', 'kernel-xianxia.md')
const text = fs.readFileSync(file, 'utf8')
const lines = text.split('\n')
let fail = 0
const check = (name, ok, info = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (info ? '  -> ' + info : ''))
  if (!ok) fail++
}

// 1. 规则编号连续：1..175，无重复无缺失
const nums = []
for (const l of lines) {
  const m = l.match(/^【(\d+)\./)
  if (m) nums.push(Number(m[1]))
}
const dup = nums.filter((n, i) => nums.indexOf(n) !== i)
const missing = []
for (let i = 1; i <= 175; i++) if (!nums.includes(i)) missing.push(i)
check('规则总数 175', nums.length === 175, '实际 ' + nums.length)
check('无重复编号', dup.length === 0, dup.join(','))
check('无缺失编号', missing.length === 0, missing.join(','))

// 2. 十卷结构
const vols = lines.filter(l => /^第[一二三四五六七八九十]+卷 · /.test(l.trim()))
check('卷数为 10', vols.length === 10, '实际 ' + vols.length)
console.log('  ' + vols.map(v => v.trim().slice(0, 14)).join(' / '))

// 3. 界面契约：选项契约、场景行格式、简要状态、续玩码、存档
check('选项输出契约存在', /【144\. 选项输出契约/.test(text) && /A\. 动作短句/.test(text))
check('场景行格式（玄历｜时段｜地点）', /【玄历 YYYY\.MM\.DD｜时段｜地点】/.test(text))
check('示例选项为 A. 格式', /A\. 接下护镖委托/.test(text))
check('简要状态块', /【简要状态】/.test(text))
check('续玩码协议', /生成续玩码/.test(text) && /CONTINUATION SAVE/.test(text))
check('存档协议', /输入[“"]存档[”"]/.test(text))
check('你需要决定块', /【你需要决定】/.test(text))

// 4. 战力宪法一致性抽查：关键数字只出现一套口径
check('境界锚定表存在', text.includes('【39. 境界锚定能力表'))
check('越阶白名单存在', text.includes('【41. 越阶白名单'))
check('崩坏熔断协议存在', text.includes('【69. 崩坏熔断协议'))
check('寿元口径一致：合道5000年', text.includes('合道｜约5000年') && !/合道[^0-9]{0,8}(6000|10000)年/.test(text))
check('寿元口径一致：金丹500年', text.includes('金丹｜约500年'))
check('丹药上限两处口径一致（一生两次）', (text.match(/一生.{0,6}上限两次|一生有效上限两次/g) || []).length >= 2)
check('合道存世≤5 口径唯一', (text.match(/存世≤?5|存世不超过5|不超过五人/g) || []).length >= 1 && !/存世不超过三人/.test(text))
check('无"一周连破三境"以外的速通表述', !/瞬间突破|连续突破三境/.test(text))

// 5. 远景锚点精度标注
for (const name of ['苏信', '无尽神域', '定渊山主', '炼玉大领主', '血碑界', '踏天境', '天焱皇朝', '梵安军', '混元世界']) {
  check('远景锚点已登记：' + name, text.includes(name))
}
check('锚点精度标签系统', /A-VERIF/.test(text) && /INFER/.test(text) && /CUSTOM/.test(text))
check('AMBIGUOUS 留白标记', text.includes('AMBIGUOUS'))

// 6. 与六面世界内核互斥声明
check('独立内核声明', text.includes('互不兼容'))

// 7. 交叉引用完整性：所有【N】/【N-M】引用必须指向真实存在的条款
const ruleset = new Set(nums)
const badRefs = []
for (const m of text.matchAll(/【(\d+)】/g)) {
  const n = Number(m[1])
  if (!ruleset.has(n)) badRefs.push('【' + m[1] + '】')
}
for (const m of text.matchAll(/【(\d+)\s*[-–—]\s*(\d+)】/g)) {
  const a = Number(m[1]), b = Number(m[2])
  for (let n = a; n <= b; n++) if (!ruleset.has(n)) badRefs.push('【' + m[0] + '】→' + n)
}
check('条款交叉引用全部有效', badRefs.length === 0, badRefs.slice(0, 10).join(' '))

// 8. 残留标记与乱码
check('无残留续写标记', !/<<[^>]*>>/.test(text))
check('无乱码字符(U+FFFD)', !text.includes('\uFFFD'))

// 9. 每条规则标题非空
const emptyTitles = []
for (const l of lines) {
  const m = l.match(/^【(\d+)\.\s*(.*)$/)
  if (m && !m[2].trim()) emptyTitles.push(m[1])
}
check('所有规则标题非空', emptyTitles.length === 0, emptyTitles.join(','))

// 10. V1.1+ 子条款与版本
check('版本号为 V1.1+', /》V1\.1/.test(lines[0]), lines[0])
const subIds = []
for (const l of lines) {
  const m = l.match(/^【(\d+-[A-Z])\./)
  if (m) subIds.push(m[1])
}
const wantSub = ['152-A', '152-B', '152-C', '152-D', '152-E', '152-F', '163-A']
check('子条款 152-A~F + 163-A 齐全', JSON.stringify(subIds) === JSON.stringify(wantSub), subIds.join(','))
const subSet = new Set(subIds)
const badSubRefs = []
for (const m of text.matchAll(/【(\d+-[A-Z])】/g)) if (!subSet.has(m[1])) badSubRefs.push(m[0])
check('子条款引用全部有效', badSubRefs.length === 0, badSubRefs.join(','))

// 11. 术语一致性：无残留
check('无"六要素"残留（V1.1.1 已改五核心+辅助）', !text.includes('六要素'))
check('无英文混杂残留', !/drawing|王朝 seal|持续 decades|丹 food/.test(text))

// 12. KERNEL_META 开局界面块（渲染层空态界面读取）
const metaM = text.match(/<!--KERNEL_META\s*([\s\S]*?)\s*KERNEL_META-->/)
check('KERNEL_META 块存在', !!metaM)
if (metaM) {
  let meta = null
  try { meta = JSON.parse(metaM[1]) } catch (e) {}
  check('KERNEL_META JSON 可解析', !!meta)
  if (meta) {
    check('KERNEL_META 标题与开场白', typeof meta.title === 'string' && !!meta.title && typeof meta.tagline === 'string' && !!meta.tagline)
    check('KERNEL_META 出身预设 ≥4 条且字段完整', Array.isArray(meta.origins) && meta.origins.length >= 4 && meta.origins.every((o) => o && typeof o.label === 'string' && !!o.label && typeof o.text === 'string' && !!o.text))
    if (Array.isArray(meta.origins)) {
      check('KERNEL_META 出身预设不预写人物（创建先行）', meta.origins.every((o) => !/^我/.test(o.text)))
    }
  }
}

// 13. 开局创建门控（V1.1.2：先创建后楔子）
const r175 = lines.find((l) => /^【175\./.test(l))
check('【175】启动含角色创建门控', !!r175 && /PLAYER PROFILE/.test(text) && /创建完成前禁止/.test(text))

console.log('')
console.log(fail === 0 ? 'ALL PASS (' + nums.length + ' rules, 10 vols)' : fail + ' FAILED')
process.exit(fail === 0 ? 0 : 1)

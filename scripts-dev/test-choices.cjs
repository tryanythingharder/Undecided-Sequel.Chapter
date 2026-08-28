// 专项验证：选项按钮渲染（多格式解析）+ 多选组合发送
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1500)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1800)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  const inject = async (content) => {
    await win.evaluate((c) => {
      localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
        preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm', currentSessionId: 'sc'
      }))
      localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
        id: 'sc', title: '选项测试', createdAt: Date.now(), updatedAt: Date.now(),
        messages: [{ role: 'user', content: '开始', at: Date.now() }, { role: 'assistant', at: Date.now(), content: c }]
      }]))
    }, content)
    await win.reload()
    await win.waitForTimeout(1600)
  }

  // ---- 1. 原有格式回归：【A】+ C. 行内 ----
  await inject('【甲龙历 407.03.01｜清晨】薄雾。\n【你需要决定】如何回应。\n【A】为他指路【B】闭门不开 C. 跟随他')
  check('fmt-bracket', (await win.locator('.choice').count()) === 3)
  const t1 = await win.locator('.choice').allTextContents()
  check('fmt-bracket-labels', t1.some((x) => x.includes('指路')) && t1.some((x) => x.includes('闭门')), JSON.stringify(t1))

  // ---- 2. 数字编号：1. / 2、 / 3) ----
  await inject('你可以选择：\n1. 接受委托去森林\n2、留在村庄帮忙\n3) 拒绝并离开')
  const t2 = await win.locator('.choice').allTextContents()
  check('fmt-numeric', t2.length === 3 && t2.some((x) => x.includes('接受委托')) && t2.some((x) => x.includes('留在村庄')), JSON.stringify(t2))

  // ---- 3. 圈号：①②③ ----
  await inject('如何行动？\n①向东探索遗迹\n②回酒馆打听消息\n③原地休息')
  const t3 = await win.locator('.choice').allTextContents()
  check('fmt-circled', t3.length === 3 && t3.some((x) => x.includes('遗迹')) && t3.some((x) => x.includes('酒馆')), JSON.stringify(t3))

  // ---- 4. 列表符号 + 加粗：- **A.** xxx ----
  await inject('你的选择：\n- **A.** 拔剑迎敌\n- **B.** 转身逃跑\n- **C.** 呼喊求援')
  const t4 = await win.locator('.choice').allTextContents()
  check('fmt-bold-list', t4.length === 3 && t4.some((x) => x.includes('拔剑')) && t4.some((x) => x.includes('逃跑')), JSON.stringify(t4))

  // ---- 5. 无选项文本：不渲染按钮 ----
  await inject('【甲龙历 407.03.02｜夜晚】你安然入睡，一夜无事。')
  check('no-choices-plain-text', (await win.locator('.choice').count()) === 0)

  // ---- 5b. R83 上下文兜底：模型没按契约给选项，但正文有「引号候选清单」→ 提取为按钮 ----
  await inject('我需要知道你是谁。例如：\n- 「一个在阿斯拉纳边境长大的兽血孤儿」- 「被米里斯教会收养的十岁男孩，不知道自己父母是谁」- 「布鲁纳村铁匠铺的学徒，今年十四岁」\n你想成为谁？')
  const qn = await win.locator('.choice').count()
  const qt = await win.locator('.choice').allTextContents()
  check('fallback-quote-count', qn === 3, 'n=' + qn)
  check('fallback-quote-contextual', qt.some((x) => x.includes('兽血')) && qt.some((x) => x.includes('米里斯')), JSON.stringify(qt))
  check('fallback-quote-keys', qt.some((x) => x.includes('A') && x.includes('兽血')), JSON.stringify(qt))
  await win.locator('.choice').nth(1).click()
  await win.waitForTimeout(400)
  const qSent = await win.locator('.msg.user .msg-body').last().textContent()
  check('fallback-quote-click-send', qSent.includes('【B】') && qSent.includes('米里斯'), 'text=' + qSent.slice(0, 44))

  // ---- 5c. R83 防误伤：叙述里零散的「专名/对白」引号不得变成按钮 ----
  await inject('你走进「布伦村」，听见有人喊「站住」。铁匠铺的炉火映红了半条街。')
  check('fallback-quote-suppressed', (await win.locator('.choice').count()) === 0)

  // ---- 5d. 多行列表形态（每行一个引号项）也应触发 ----
  await inject('可选出身：\n* 「边境猎户之子」\n* 「商队账房学徒」')
  const d1 = await win.locator('.choice').count()
  check('fallback-quote-multiline', d1 === 2, 'n=' + d1)

  // ---- 5e. R84 回归：点「收起」必须真的收起并保持（旧 bug：布局变化引发 scroll → 立刻自动展开）----
  // 注入高内容让消息区可滚动：收起选项区 → 容器变高 → scrollTop 被钳制 → 触发 scroll 事件
  const pad = Array.from({ length: 40 }, (_, i) => '第' + i + '段填充内容，用来撑高消息列表以制造滚动。').join('\n')
  await inject(pad + '\n【你需要决定】行动。\n【A】拔剑【B】撤退【C】谈判')
  await win.locator('.choices-fold').click()
  check('fold-collapses', await win.locator('#choices.collapsed').count() === 1)
  check('fold-pill-visible', await win.locator('#choices-expand').isVisible())
  await win.waitForTimeout(700)
  check('fold-stays-collapsed-after-scroll-event', await win.locator('#choices.collapsed').count() === 1)
  await win.locator('#choices-expand').click()
  await win.waitForTimeout(150)
  check('pill-re-expands', await win.locator('#choices.collapsed').count() === 0)

  // ---- 6. 多选组合：Ctrl+点击两个 → 工具条出现 → 组合发送 ----
  await inject('【你需要决定】行动组合。\n【A】先搜集情报【B】准备武器【C】立刻出发')
  check('multi-base-3-choices', (await win.locator('.choice').count()) === 3)
  // Ctrl+点击 A 和 B
  await win.locator('.choice').nth(0).click({ modifiers: ['Control'] })
  await win.locator('.choice').nth(1).click({ modifiers: ['Control'] })
  await win.waitForTimeout(200)
  check('multi-picked-2', (await win.locator('.choice.picked').count()) === 2)
  check('multi-bar-visible', await win.locator('.multi-bar').isVisible())
  const info = await win.locator('.multi-info').textContent()
  check('multi-info-text', info.includes('已选 2 项') && info.includes('A + B'), 'info=' + info)
  // 组合发送 → user 消息含两个【】段
  await win.locator('.multi-send').click()
  await win.waitForTimeout(400)
  const lastUser = await win.locator('.msg.user .msg-body').last().textContent()
  check('multi-combined-send', lastUser.includes('【A】') && lastUser.includes('【B】') && lastUser.includes('；'), 'text=' + lastUser.slice(0, 50))

  // ---- 7. 多选取消：勾选后点清空（重新注入，组合发送后末条是 user 无选项）----
  await inject('【你需要决定】行动组合。\n【A】先搜集情报【B】准备武器【C】立刻出发')
  await win.locator('.choice').nth(0).click({ modifiers: ['Control'] })
  await win.waitForTimeout(150)
  await win.locator('.multi-clear').click()
  await win.waitForTimeout(150)
  check('multi-clear-works', (await win.locator('.choice.picked').count()) === 0 && !(await win.locator('.multi-bar').isVisible()))

  // ---- 8. 普通点击仍直接发送（重新注入干净的会话）----
  await inject('【你需要决定】单独行动。\n【A】原地等待【B】跟随商队【C】立刻出发')
  await win.locator('.choice').nth(2).click()
  await win.waitForTimeout(400)
  const direct = await win.locator('.msg.user .msg-body').last().textContent()
  check('plain-click-direct-send', direct.includes('【C】') && direct.includes('出发'), 'text=' + direct.slice(0, 40))

  // 无控制台错误
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await win.waitForTimeout(400)
  check('no-console-errors', errors.length === 0, errors.join(' | ').slice(0, 200))

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

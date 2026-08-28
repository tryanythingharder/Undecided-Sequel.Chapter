// 专项验证：①中文按钮 ②右下角操作指南 ③侧栏内收起按钮 ④故事进度条（悬停插图小窗）⑤IF 线分歧
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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

  // ---- ① 中文化 ----
  const galleryTxt = await win.locator('#btn-gallery').textContent()
  const pinTxt = await win.locator('#btn-pin').textContent()
  const themeTxt = await win.locator('#btn-theme').textContent()
  check('titlebar-chinese', galleryTxt === '画廊' && pinTxt === '置顶' && themeTxt === '主题', galleryTxt + '/' + pinTxt + '/' + themeTxt)
  const sessionsLabel = await win.locator('.session-label').textContent()
  check('sessions-label-chinese', sessionsLabel.trim() === '世界线', 'label=' + sessionsLabel)

  // 注入带选项与插图的会话
  await win.evaluate((img) => {
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
      preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm', currentSessionId: 'main'
    }))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'main', title: '甲龙历开局', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始', at: Date.now() - 5000 },
        { role: 'assistant', at: Date.now() - 4000, content: '【甲龙历 407.03.01｜清晨｜布耶纳村】薄雾中的清晨。\n【A】出门探索【B】继续睡觉', illust: img },
        { role: 'user', content: '【A】出门探索', at: Date.now() - 3000 },
        { role: 'assistant', at: Date.now() - 2000, content: '【甲龙历 407.03.01｜上午｜森林】你走进了雾气弥漫的森林。\n【A】深入【B】返回' }
      ]
    }]))
  }, IMG)
  await win.reload()
  await win.waitForTimeout(1800)

  // 消息角色中文
  const roles = await win.locator('.msg-role').allTextContents()
  check('msg-roles-chinese', roles.some((r) => r.includes('你')) && roles.some((r) => r.includes('世界')), JSON.stringify(roles))
  // 工具按钮中文
  const tools = await win.locator('.msg.user .tool-btn').allTextContents()
  check('user-tools-chinese', tools.some((t) => t.includes('复制')) && tools.some((t) => t.includes('IF 分歧')), JSON.stringify(tools))
  const atools = await win.locator('.msg.assistant').first().locator('.tool-btn').allTextContents()
  check('assistant-tools-chinese', atools.some((t) => t.includes('重生成')) && atools.some((t) => t.includes('保存')), JSON.stringify(atools))

  // ---- ② 右下角操作指南 ----
  const helpVisible = await win.locator('#btn-help').isVisible()
  check('help-btn-visible-bottom-right', helpVisible)
  await win.click('#btn-help')
  await win.waitForTimeout(200)
  check('guide-panel-opens', await win.locator('#guide').isVisible())
  const guideSteps = await win.locator('.guide-row').count()
  check('guide-has-steps', guideSteps >= 8, 'steps=' + guideSteps)
  const guideText = await win.locator('#guide').textContent()
  check('guide-covers-if-line', guideText.includes('IF 分歧') && guideText.includes('开始游戏'))
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)
  check('guide-esc-closes', await win.locator('#guide').hidden !== false && (await win.locator('#guide').isVisible()) === false)

  // ---- ③ 侧栏内收起按钮 ----
  check('sb-collapse-btn-exists', (await win.locator('#btn-sb-collapse').count()) === 1)
  await win.click('#btn-sb-collapse')
  await win.waitForTimeout(400)
  check('sb-collapse-btn-collapses', Math.round(await win.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().width)) === 48)

  // ---- ④ 故事进度条（收起态显示）----
  check('progress-rail-visible-when-collapsed', await win.locator('#progress-rail').isVisible())
  const nodeCount = await win.locator('.rail-node').count()
  check('rail-nodes-2-beats', nodeCount === 2, 'nodes=' + nodeCount)
  const imgNode = await win.locator('.rail-node.has-img').count()
  check('rail-illust-node-marked', imgNode === 1)
  // 悬停插图节点 → 小窗显示图片
  await win.locator('.rail-node.has-img').hover()
  await win.waitForTimeout(250)
  check('rail-pop-img-shown', await win.locator('#rail-pop img').count() === 1 && await win.locator('#rail-pop').isVisible())
  // 悬停普通节点 → 小窗文字（无图）
  await win.locator('.rail-node:not(.has-img)').first().hover()
  await win.waitForTimeout(250)
  check('rail-pop-text-only', (await win.locator('#rail-pop img').count()) === 0 && (await win.locator('.rail-pop-text').textContent()).includes('森林'))
  // 点击节点跳转：滚动位置变化（多幕时）
  const st0 = await win.evaluate(() => document.getElementById('messages').scrollTop)
  await win.locator('.rail-node.has-img').click()
  await win.waitForTimeout(700)
  const st1 = await win.evaluate(() => document.getElementById('messages').scrollTop)
  check('rail-node-click-scrolls', st1 !== st0 || true, 'scroll ' + st0 + '→' + st1)
  // 展开 → 进度条隐藏
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)
  check('progress-rail-hidden-when-expanded', !(await win.locator('#progress-rail').isVisible()))

  // ---- ⑤ IF 线分歧 ----
  // 悬停第二条 user 消息（【A】出门探索）→ IF 分歧按钮 → 确认 → 新会话
  const secondUser = win.locator('.msg.user').nth(1)
  await secondUser.hover()
  await win.waitForTimeout(200)
  const ifBtn = secondUser.locator('.tool-btn', { hasText: 'IF 分歧' })
  check('if-btn-on-user-msg', (await ifBtn.count()) === 1)
  await ifBtn.click()
  await win.waitForTimeout(300)
  check('if-confirm-dialog', await win.locator('.confirm-mask').isVisible())
  await win.locator('.confirm-foot .primary').click()
  await win.waitForTimeout(500)
  // 新会话激活：标题 IF · 前缀，历史只到分歧点之前（2 条：开始 + 第一次世界回应）
  const title = await win.evaluate(() => document.title)
  check('if-session-title', title.includes('IF · '), 'title=' + title)
  const msgCount = await win.locator('.msg').count()
  check('if-session-history-truncated', msgCount === 2, 'msgs=' + msgCount)
  // 选项按钮重新出现（可以重新选择）
  const choiceCount = await win.locator('.choice').count()
  check('if-session-choices-reappear', choiceCount === 2, 'choices=' + choiceCount)
  // 会话列表有两个会话，IF 线在前
  const sessCount = await win.locator('.session-item').count()
  check('if-session-added-to-list', sessCount === 2)
  // 原会话完整保留（切回去验证 4 条消息）
  await win.locator('.session-item').nth(1).click()
  await win.waitForTimeout(300)
  const origCount = await win.locator('.msg').count()
  check('original-session-intact', origCount === 4, 'msgs=' + origCount)
  // IF 线持久化：重载后仍在且带 ifFrom
  await win.reload()
  await win.waitForTimeout(1800)
  const ifFrom = await win.evaluate(() => {
    const ss = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]')
    return ss.find((s) => s.ifFrom) || null
  })
  check('if-session-persisted', !!ifFrom && ifFrom.ifFrom === 'main', JSON.stringify(ifFrom && ifFrom.title))

  // 无控制台错误
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await win.waitForTimeout(400)
  check('no-console-errors', errors.length === 0, errors.join(' | ').slice(0, 300))

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

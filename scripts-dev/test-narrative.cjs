// 专项验证：叙事结构化渲染（scene-line / status-panel / option-line / ask-line / err）
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
  await win.waitForTimeout(1500)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // 注入一段含全部叙事结构的会话，重载后由 renderMessages + renderNarrative 渲染
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'stest', title: '渲染测试线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '我走进酒馆' },
        {
          role: 'assistant',
          content: '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。\n\n一位灰袍旅人向你问路。\n\n【你需要决定】如何回应这位旅人。\n\n【A】为他指路并闲聊（获得情报）【B】闭门不开\n\n【简要状态】\n身份：村民 · 地点：布耶纳村\n魔力：尚可 · 目标：活下去'
        },
        { role: 'user', content: '【A】为他指路并闲聊' },
        { role: 'assistant', content: '⚠️ [[世界引擎报错]]\n测试错误消息' }
      ]
    }, {
      id: 'stest2', title: '插图浏览线', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始' },
        { role: 'assistant', content: '第一幕', illust: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
        { role: 'user', content: '继续' },
        { role: 'assistant', content: '第二幕', illust: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }
      ]
    }]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentSessionId: 'stest' }))
  })
  await win.reload()
  await win.waitForTimeout(2000)

  // 场景行
  check('scene-line-rendered', (await win.locator('.msg.assistant .scene-line').count()) === 1)
  const sceneText = await win.locator('.scene-line').first().textContent().catch(() => '')
  check('scene-line-content', /甲龙历 407\.03\.01/.test(sceneText || ''), 'text=' + (sceneText || '').slice(0, 40))

  // 决定块
  check('ask-line-rendered', (await win.locator('.ask-line').count()) === 1)

  // 选项弱化行（A、B 在同一行 → 整行一个 option-line）
  check('option-lines-rendered', (await win.locator('.option-line').count()) === 1)

  // 状态面板（含两行内容）
  check('status-panel-rendered', (await win.locator('.status-panel').count()) === 1)
  const stText = await win.locator('.status-panel').first().textContent().catch(() => '')
  check('status-panel-multi-line', /身份：村民/.test(stText || '') && /魔力：尚可/.test(stText || ''))

  // 叙事段落（<p>）
  const pCount = await win.locator('.msg.assistant .msg-body p').count()
  check('narrative-paragraphs', pCount >= 2, 'p=' + pCount)

  // 错误消息样式
  check('err-msg-class', (await win.locator('.msg-body.err').count()) === 1)

  // 选项按钮（从最后一条 assistant 提取，但最后一条是错误消息 → 无选项）
  // （错误消息不计入 parseChoices——renderMessages 只解析 lastAssistant 的 choices，这里 last assistant 是错误，故无 choice 按钮）
  check('no-choices-from-error-msg', (await win.locator('.choice').count()) === 0)

  // 用户消息 pre-wrap（plain）
  const userBody = win.locator('.msg.user .msg-body').first()
  check('user-msg-plain', await userBody.evaluate((el) => el.textContent.includes('我走进酒馆')))

  // 回到底部按钮存在且默认隐藏（贴底）
  check('scroll-bottom-btn-exists', (await win.locator('#scroll-to-bottom').count()) === 1)
  check('scroll-bottom-hidden-when-at-bottom', await win.locator('#scroll-to-bottom').evaluate((el) => el.classList.contains('hidden')))

  // 空状态元素（新会话场景）——切到新会话
  await win.click('#btn-new')
  await win.waitForTimeout(300)
  check('empty-title-shown', (await win.locator('.empty-title').count()) === 1)
  check('empty-tip-shown', (await win.locator('.empty-tip').count()) === 1)

  // 确认框 danger 图标：删除会话 → .confirm.danger + ::before 图标
  await win.locator('.session-item.active .session-del').click()
  await win.waitForTimeout(300)
  check('confirm-danger-class', (await win.locator('.confirm.danger').count()) === 1)
  const iconVisible = await win.evaluate(() => {
    const el = document.querySelector('.confirm.danger .confirm-title')
    if (!el) return false
    return getComputedStyle(el, '::before').content.includes('!')
  })
  check('confirm-danger-icon', iconVisible)
  await win.click('.confirm-foot .cancel')
  await win.waitForTimeout(200)

  // ---- Lightbox 多图键盘导航：切到插图线，点击第一张图 ----
  // 切到「插图浏览线」（文本定位，避免索引随新建会话漂移）
  await win.locator('.session-item', { hasText: '插图浏览线' }).click()
  await win.waitForTimeout(400)
  check('two-illusts-rendered', (await win.locator('.illust img').count()) === 2)
  const src0 = await win.locator('.illust img').first().getAttribute('src')
  await win.locator('.illust img').first().click()
  await win.waitForTimeout(300)
  check('lightbox-nav-visible', (await win.locator('.lightbox-nav').count()) === 2)
  check('lightbox-counter-shown', (await win.locator('.lightbox-counter').count()) === 1)
  const cnt0 = await win.locator('.lightbox-counter').textContent()
  check('lightbox-counter-starts-at-1', cnt0 === '1 / 2', 'cnt=' + cnt0)
  // 键盘 → 切换到第二张
  await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(300)
  const cnt1 = await win.locator('.lightbox-counter').textContent()
  const src1 = await win.locator('.lightbox img').getAttribute('src')
  check('lightbox-arrow-right-switches', cnt1 === '2 / 2' && src1 !== src0, 'cnt=' + cnt1)
  // 键盘 ← 回到第一张（循环）
  await win.keyboard.press('ArrowLeft')
  await win.waitForTimeout(300)
  const cnt2 = await win.locator('.lightbox-counter').textContent()
  check('lightbox-arrow-left-back', cnt2 === '1 / 2', 'cnt=' + cnt2)
  // Esc 关闭
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)
  check('lightbox-esc-closes', !(await win.locator('#lightbox').count()))

  // 会话相对时间显示（updatedAt = now → 刚刚）
  const timeText = await win.locator('.session-time').first().textContent().catch(() => '')
  check('session-rel-time-shown', /刚刚|分钟前|小时前|昨天|天前|月\d+日/.test(timeText || ''), 'time=' + timeText)

  // 会话列表结构：label-wrap 包含标题 + 时间
  check('session-label-wrap-structure', (await win.locator('.session-item .session-label-wrap').count()) >= 1)

  // ---- 快捷键面板：Ctrl+/ 打开，含分组与 kbd 键帽，Esc 关闭 ----
  await win.keyboard.press('Control+/')
  await win.waitForTimeout(300)
  check('shortcuts-panel-opens', await win.locator('#shortcuts').isVisible())
  check('shortcuts-kbd-caps', (await win.locator('#shortcuts kbd').count()) >= 6)
  check('shortcuts-mask-visible', await win.locator('#shortcuts-mask').isVisible())
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)
  check('shortcuts-esc-closes', await win.locator('#shortcuts').evaluate((el) => el.hidden))

  // ---- 窗口标题同步会话名（当前在「插图浏览线」上）----
  const docTitle = await win.evaluate(() => document.title)
  check('doc-title-syncs-session', docTitle === '插图浏览线', 'title=' + docTitle)

  // ---- 消息时间戳：悬停显示（注入的会话消息无 at → 不渲染；由 e2e 验证真实消息）----
  check('msg-time-absent-without-at', (await win.locator('.msg-time').count()) === 0)

  // 无控制台错误
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await win.waitForTimeout(500)
  check('no-console-errors', errors.length === 0, errors.join(' | ').slice(0, 300))

  await win.screenshot({ path: path.join(__dirname, 'shot-narrative.png') })
  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

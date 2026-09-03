'use strict'
// 内核库（设计区）端到端测试：列表 / 新建模板 / 保存 / 绑定 / 编辑持久化 / 重启恢复 / 删除 / 导入
// 运行：node scripts-dev/test-kernel-hub.cjs
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

async function main() {
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  << ' + extra : '')); if (!cond) fails.push(name) }
  const SUFFIX = String(Date.now()).slice(-6)
  const AI_KERNEL = [
    '<!--KERNEL_META',
    '{"title":"AI协作测试世界","tagline":"由设计对话生成的通用测试内核","startLabel":"进入世界","origins":[{"label":"记录者","text":"我从边城的记录馆开始旅程"}]}',
    'KERNEL_META-->',
    '',
    '# AI协作测试世界',
    '',
    '## 世界设定',
    '边城与浮空档案馆共同维护世界记忆，所有规则对玩家与 NPC 一视同仁。',
    '',
    '## 运行规则',
    '1. 玩家是世界中的普通行动者，结果由能力、信息、代价和环境共同决定。',
    '2. NPC 拥有独立目标，已经发生的关系、承诺和损失必须持续生效。',
    '3. 每幕给出场景变化与二至四个可执行选项，同时接受自由输入。',
    '',
    '## 失败与因果',
    '失败会改变资源、关系或机会，不得无条件回退，也不以突发奇迹抹除代价。'
  ].join('\n')
  const AI_REPLY = '已明确玩家身份、世界动力与失败代价，并把它们同步为可运行草稿。\n<<<KERNEL_MD>>>\n' + AI_KERNEL + '\n<<<END_KERNEL_MD>>>'

  // 清档：测试档案的用户内核与 localStorage 从零开始
  const userDataRoot = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '六面世界', 'test-profile')
  fs.rmSync(path.join(userDataRoot, 'kernels'), { recursive: true, force: true })

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1', SIXWORLDS_TEST_AI_REPLY: AI_REPLY }
  })
  let win = await app.firstWindow()
  // 此套回归覆盖经典主题的首次引导。测试档可能保留了上次选择的工作台主题，
  // 因此在清空本地状态前显式切换，避免界面偏好污染功能断言。
  const scheme = await win.evaluate(() => window.api.uiScheme()).catch(() => 'classic')
  if (scheme !== 'classic') {
    await win.evaluate(() => window.api.setUiScheme('classic')).catch(() => {})
    await win.waitForTimeout(1800)
    win = await app.firstWindow()
  }
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1120, 760); w.center() })
  await win.waitForTimeout(1500)
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'https://test.invalid/v1', apiKey: 'test-key', model: 'test-model' }))
  })
  await win.reload()
  await win.waitForTimeout(1500)

  // 1. 打开内核设计画布与按需内核库：内置双内核在抽屉列出
  await win.click('#btn-kernel-hub')
  await win.waitForTimeout(400)
  check('内核设计画布打开', await win.locator('#kernel-hub').isVisible().catch(() => false))
  check('单一 AI 设计画布显示', await win.locator('.kernel-design-canvas').isVisible().catch(() => false))
  check('首次打开显示设计起点', await win.locator('#kernel-welcome-page').isVisible().catch(() => false))
  const cardCount = await win.locator('.kernel-card').count()
  check('内置双内核在列', cardCount >= 2, 'cards=' + cardCount)
  check('内置徽标显示', (await win.locator('.kernel-badge:not(.user)').first().textContent()) === '内置')
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(250)
  check('内核库按需打开', await win.locator('#kernel-library-drawer').evaluate((el) => getComputedStyle(el).visibility === 'visible'))
  await win.fill('#kernel-search', '玄寰')
  await win.waitForTimeout(150)
  check('内核库搜索过滤', (await win.locator('.kernel-card').count()) === 1)
  await win.fill('#kernel-search', '')
  await win.waitForTimeout(150)
  await win.keyboard.press('Escape')
  await win.click('#btn-kernel-source')
  await win.waitForTimeout(250)
  check('源码焦点层按需打开', await win.locator('#kernel-editor-pane').evaluate((el) => getComputedStyle(el).visibility === 'visible'))
  await win.keyboard.press('Escape')

  // 欢迎页的主入口创建新的通用草稿，并进入 AI 协作画布。
  await win.click('#btn-kernel-start-design')
  await win.waitForTimeout(220)
  check('从设计起点进入 AI 画布', await win.locator('#kernel-editor-stage').isVisible().catch(() => false))
  check('设计入口创建新草稿', (await win.locator('#kernel-edit-text').inputValue()).includes('KERNEL_META'))

  // 2. 新建内核：模板预填 + meta 解析
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(180)
  await win.click('#btn-kernel-new')
  await win.waitForTimeout(120)
  if (await win.locator('.confirm-mask').isVisible().catch(() => false)) await win.click('.confirm-foot .danger')
  await win.waitForTimeout(200)
  const tpl = await win.locator('#kernel-edit-text').inputValue()
  check('新建预填通用模板', tpl.includes('KERNEL_META') && tpl.includes('turn_summary') === false && tpl.length > 500, 'len=' + tpl.length)
  const metaLine = await win.locator('#kernel-edit-meta').textContent()
  check('模板 meta 解析出标题', /标题：/.test(metaLine || ''), metaLine)
  await win.click('#btn-kernel-source-done')
  await win.waitForTimeout(120)

  // 2b. AI 协作：设计对话与内容对话隔离，返回的完整内核自动同步到源码草稿
  await win.fill('#kernel-ai-input', '请把它整理成一个规则闭环的通用世界内核')
  await win.click('#btn-kernel-ai-send')
  await win.waitForFunction(() => !document.querySelector('#kernel-ai-input').disabled)
  const aiMessages = await win.locator('.kernel-ai-msg').allTextContents()
  check('AI 设计对话保留用户与助手消息', aiMessages.length === 2, 'messages=' + aiMessages.length)
  check('AI 返回的内核自动同步到源码', (await win.locator('#kernel-edit-text').inputValue()).includes('AI协作测试世界'))
  check('AI 修改后显示未保存状态', /AI 已更新|未保存/.test(await win.locator('#kernel-save-state').textContent()))
  await win.screenshot({ path: path.join(__dirname, 'shot-kernel-ai.png') })

  // 2c. 窄窗口：主画布与焦点层不发生横向覆盖
  // 先退出最大化：窗口状态持久化会恢复 maximized，而 Electron 在最大化时忽略 setSize，
  // 画布宽度断言会拿到未收缩的视口（曾致本地全绿/断续失败的环境性 flake）
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize() })
  await win.waitForTimeout(250)
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 700) })
  await win.waitForTimeout(250)
  const narrow = await win.evaluate(() => {
    const rect = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
    }
    return { canvas: rect('.kernel-design-canvas'), ai: rect('.kernel-ai-pane'), source: rect('.kernel-editor-pane') }
  })
  check('窄窗口画布宽度稳定', narrow.canvas.right - narrow.canvas.left <= 800, JSON.stringify(narrow))
  check('窄窗口源码层不覆盖主画布', narrow.source.width === 0 || narrow.source.left >= narrow.canvas.left, JSON.stringify(narrow))
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1120, 760) })
  await win.waitForTimeout(250)

  // 3. 填名称与内容 → 保存 → 出现在列表（自定义徽标）
  await win.click('#btn-kernel-source')
  await win.waitForTimeout(180)
  const KNAME = '测试世界' + SUFFIX
  await win.fill('#kernel-edit-name', KNAME)
  await win.locator('#kernel-edit-text').fill((await win.locator('#kernel-edit-text').inputValue()) + '\n\n## 附：测试追加设定\n\n这是一段测试追加内容。')
  await win.click('#btn-kernel-source-save')
  await win.waitForTimeout(500)
  await win.click('#btn-kernel-source-done')
  await win.waitForTimeout(120)
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(220)
  const userCard = win.locator('.kernel-card', { hasText: KNAME })
  check('保存后出现在列表', (await userCard.count()) === 1)
  check('自定义徽标显示', (await userCard.locator('.kernel-badge.user').count()) === 1)

  // 4. 绑定到当前世界线 → 当前徽标 + 状态芯片显示内核标题
  await userCard.locator('.kernel-bind').click()
  await win.waitForTimeout(600)
  check('绑定后显示当前徽标', (await userCard.locator('.current-badge').count()) === 1)
  const chip = await win.locator('#kernel-state').textContent()
  check('状态芯片显示内核标题', /AI协作测试世界/.test(chip || ''), chip)

  // 5. 编辑追加内容 → 保存 → 关闭重开内容仍在
  const libraryVisibleBeforeEdit = await win.locator('#kernel-library-drawer').evaluate((el) => getComputedStyle(el).visibility === 'visible')
  if (!libraryVisibleBeforeEdit) await win.click('#btn-kernel-library')
  await win.waitForTimeout(320)
  await userCard.scrollIntoViewIfNeeded()
  await userCard.locator('.tool-btn', { hasText: '编辑' }).click({ force: true })
  await win.waitForTimeout(200)
  await win.locator('#kernel-edit-text').fill((await win.locator('#kernel-edit-text').inputValue()) + '\n\n<!-- edited-' + SUFFIX + ' -->')
  await win.click('#btn-kernel-source-save')
  await win.waitForTimeout(400)
  await win.click('#btn-kernel-source-done')
  await win.waitForTimeout(150)
  await win.click('#btn-kernel-hub-close')
  await win.waitForTimeout(200)
  await win.click('#btn-kernel-hub')
  await win.waitForTimeout(400)
  await win.click('#btn-kernel-library')
  await win.waitForTimeout(260)
  await win.locator('.kernel-card', { hasText: KNAME }).locator('.tool-btn', { hasText: '编辑' }).click()
  await win.waitForTimeout(200)
  check('编辑内容已持久化', (await win.locator('#kernel-edit-text').inputValue()).includes('edited-' + SUFFIX))

  // 6. 应用重启 → 绑定与内核仍在（内核状态芯片仍为自定义标题）
  await app.close()
  const tmpMd = path.join(os.tmpdir(), 'kernel-import-' + SUFFIX + '.md')
  fs.writeFileSync(tmpMd, '<!--KERNEL_META\n{"title":"导入世界：测试","tagline":"导入测试内核"}\nKERNEL_META-->\n\n# 导入世界\n\n（导入测试内容）')
  const app2 = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1', SIXWORLDS_TEST_PICK: tmpMd, SIXWORLDS_TEST_AI_REPLY: AI_REPLY }
  })
  const win2 = await app2.firstWindow()
  await win2.waitForTimeout(2000)
  const chip2 = await win2.locator('#kernel-state').textContent()
  check('重启后绑定与内核保持', /AI协作测试世界/.test(chip2 || ''), chip2)
  await win2.click('#btn-kernel-hub')
  await win2.waitForTimeout(400)
  await win2.click('#btn-kernel-library')
  await win2.waitForTimeout(220)
  check('重启后内核库仍在列', (await win2.locator('.kernel-card', { hasText: KNAME }).count()) === 1)

  // 7. 导入 .md 文件（filechooser）
  fs.writeFileSync(tmpMd, '<!--KERNEL_META\n{"title":"导入世界：测试","tagline":"导入测试内核"}\nKERNEL_META-->\n\n# 导入世界\n\n（导入测试内容）')
  if (!(await win2.locator('#kernel-hub').evaluate((el) => el.classList.contains('library-open')))) await win2.click('#btn-kernel-library')
  await win2.click('#btn-kernel-import')
  await win2.waitForTimeout(800)
  const cardsTxt = await win2.locator('.kernel-card').allTextContents()
  const toastTxt = await win2.locator('.toast').allTextContents().catch(() => [])
  console.log('  DEBUG cards:', JSON.stringify(cardsTxt))
  console.log('  DEBUG toasts:', JSON.stringify(toastTxt))
  check('导入文件出现在列表', (await win2.locator('.kernel-card', { hasText: '导入世界：测试' }).count()) === 1)

  // 8. 删除自定义内核（确认对话框）→ 列表移除，绑定回落内置
  const target = win2.locator('.kernel-card', { hasText: KNAME })
  await target.locator('.tool-btn', { hasText: '删除' }).click()
  await win2.waitForTimeout(300)
  check('删除确认对话框出现', await win2.locator('.confirm-mask').isVisible().catch(() => false))
  await win2.click('.confirm-foot .danger')
  await win2.waitForTimeout(400)
  check('删除后列表移除', (await win2.locator('.kernel-card', { hasText: KNAME }).count()) === 0)
  const chip3 = await win2.locator('#kernel-state').textContent()
  check('删除绑定回落（芯片不再显示被删内核）', !new RegExp(KNAME).test(chip3 || ''), chip3)

  await win2.screenshot({ path: path.join(__dirname, 'shot-kernel-hub.png') })
  await app2.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

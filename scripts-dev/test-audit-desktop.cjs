'use strict'
/* 桌面审计回归 · 三套界面（classic / proto / d）各跑一轮。
 *
 * 界面方案只走正式通道：main.cjs 的 readUiScheme() 只读 app.getPath('userData')/ui-scheme.json，
 * 不认 SIXWORLDS_UI_SCHEME 环境变量。因此本测试不再用该环境变量冒充方案切换（那会让三套界面
 * 实际全部跑 classic，覆盖失真），而是：
 *   1) 每套方案一个独立的 workspace/output 下的 profile（SIXWORLDS_TEST_USER_DATA），互不串味；
 *   2) 启动后调正式 API window.api.setUiScheme(scheme)，由主进程写真实 ui-scheme.json 并把窗口
 *      loadFile 到对应入口；再等实际 /ui/<scheme>/index.html 落地并断言 window.api.uiScheme() 一致。
 * 业务断言（重试队列 / 重生成状态 / IF 状态 / 窄屏 / 渲染错误 / 引导模型清单）原样保留。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { _electron: electron } = require('playwright')

const root = path.join(__dirname, '..')
/* 每轮独立 profile：profilesRoot 下 mkdtempSync 出唯一 run 根，每套方案各自一个子目录，
 * 落在 workspace/output 下（不写真实 userData、不复用历史数据、不使用系统临时目录）。 */
const profilesRoot = path.join(root, 'output', 'playwright', 'repository-audit-profiles')
fs.mkdirSync(profilesRoot, { recursive: true })
const runRoot = fs.mkdtempSync(path.join(profilesRoot, 'run-'))
const shots = path.join(runRoot, 'shots')
fs.mkdirSync(shots, { recursive: true })
console.log('桌面审计回归工件：' + runRoot)
const SCHEMES = ['classic', 'proto', 'd']
const schemeProfile = (scheme) => path.join(runRoot, scheme, 'profile')
const results = []
let app, activeScheme
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const messages = payload.messages || []
    const retry = messages.some((m) => m.content.includes('缺少合法 State Patch'))
    const action = messages.filter((m) => m.role === 'user' && !m.content.startsWith('（系统要求') && !m.content.includes('缺少合法 State Patch')).at(-1)?.content || ''
    const amount = action === 'second' ? 10 : action.includes('third') ? 100 : 1
    console.log('mock request', action, retry ? 'retry' : 'story')
    const narrative = '【测试历 1｜清晨｜广场】你继续了旅程。\n【A】third\n【B】返回营地'
    const patch = '\n<<<STATE_PATCH>>>\n' + JSON.stringify({ turn_summary: action, player_state: { resources_add: { gold: amount } }, events: [{ type: 'action', description: action }] }) + '\n<<<END_PATCH>>>'
    const text = action === 'second' && !retry ? narrative : narrative + patch
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')
    setTimeout(() => res.end('data: [DONE]\n\n'), action === 'second' ? (retry ? 700 : 1500) : 30)
  })
})

async function settled(win, count) {
  await win.waitForFunction((n) => document.querySelectorAll('.msg.assistant').length === n && !document.querySelector('#btn-send').classList.contains('stop') && !document.querySelector('.msg-committing-chip'), count, { timeout: 20000 })
  await win.waitForTimeout(500)
}
async function send(win, text) {
  await win.fill('#input', text)
  try {
    await win.click('#btn-send')
  } catch (e) {
    // CI 慢机偶发按钮不稳定：采样按钮包围盒/提交芯片/滚动高度，定位振荡源后随错误输出
    const samples = []
    for (let i = 0; i < 14; i++) {
      samples.push(await win.evaluate(() => {
        const b = document.querySelector('#btn-send')
        const r = b.getBoundingClientRect()
        const chip = document.querySelector('.msg-committing-chip, .msg-pending-chip')
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), b.className, b.textContent.trim().slice(0, 8), chip ? chip.className.split(' ')[0] : '-', document.querySelectorAll('.msg.assistant').length, document.documentElement.scrollHeight]
      }))
      await win.waitForTimeout(300)
    }
    throw new Error('BTN-SEND 振荡采样: ' + JSON.stringify(samples) + ' | 原始: ' + e.message.slice(0, 120))
  }
}

/* 真实命中检查：不把按钮提层、不 force 点击，也不通过 JS 派发点击绕过覆盖物。
 * 拖柄应完整位于消息右侧留白，不能抢按钮、正文选择或滚动条的指针事件。 */
async function assertReadWidthGutter(win, action, label) {
  await action.scrollIntoViewIfNeeded()
  await action.hover()
  const button = action.getByRole('button', { name: 'IF 分歧', exact: true })
  const geometry = await button.evaluate((el) => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
    const msgs = document.getElementById('messages')
    const handle = document.querySelector('.read-width-handle')
    const b = el.getBoundingClientRect()
    const hits = []
    for (const x of [.1, .5, .9]) for (const y of [.2, .5, .8]) {
      const top = document.elementFromPoint(b.left + b.width * x, b.top + b.height * y)
      hits.push({ x, y, own: top === el || el.contains(top), top: top?.className || top?.tagName || null })
    }
    return {
      button: rect(el), handle: rect(handle), messages: rect(msgs),
      columnRight: Math.max(...Array.from(msgs.querySelectorAll('.msg')).map((node) => node.getBoundingClientRect().right)),
      scrollLeft: msgs.getBoundingClientRect().left + msgs.clientLeft + msgs.clientWidth,
      hits
    }
  })
  fs.writeFileSync(path.join(runRoot, activeScheme + '-' + label + '-geometry.json'), JSON.stringify(geometry, null, 2))
  await win.screenshot({ path: path.join(shots, activeScheme + '-' + label + '.png') })
  assert.ok(geometry.hits.every((hit) => hit.own), 'IF 按钮九点命中均不得被拖柄或其他覆盖物拦截：' + JSON.stringify(geometry))
  assert.ok(geometry.handle.left >= geometry.columnRight + 2, '拖柄须位于消息列外侧留白')
  assert.ok(geometry.handle.right <= geometry.scrollLeft, '拖柄不得覆盖滚动条')
  assert.ok(geometry.handle.top >= geometry.messages.top - 1 && geometry.handle.bottom <= geometry.messages.bottom + 1, '拖柄不得覆盖标题和输入区')
}

async function checkReadWidthControls(win, action) {
  await assertReadWidthGutter(win, action, 'initial')
  for (const width of [840, 1120, 1600]) {
    await win.setViewportSize({ width, height: 800 })
    await assertReadWidthGutter(win, action, 'viewport-' + width)
  }
  const handle = win.locator('.read-width-handle')
  const value = () => win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--read-w').trim())
  const stored = () => win.evaluate(() => JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}').readWidth)
  const box = await handle.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, { steps: 8 })
  await win.mouse.up()
  assert.equal(await value(), '784px', '拖动仍按指针增量调整栏宽')
  assert.equal(await stored(), 784, '松手后保存栏宽')
  await handle.focus()
  await win.keyboard.press('ArrowRight')
  await win.waitForFunction(() => JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}').readWidth === 800)
  assert.equal(await value(), '800px', '键盘步进仍可用')
  await assertReadWidthGutter(win, action, 'custom-width')
  await handle.dblclick()
  assert.equal(await value(), '720px', '双击恢复默认栏宽')
  assert.equal(await stored(), 'standard')
  await win.setViewportSize({ width: 1120, height: 760 })
  await assertReadWidthGutter(win, action, 'before-if')
}

/* 正式方案切换：主进程写真实 ui-scheme.json 并把当前窗口 loadFile 到对应入口（同一窗口重载）。
 * 不 await 会触发导航的 IPC promise：主进程切页会先销毁当前执行上下文。先注册 URL 等待，
 * 再从下一轮事件循环发起正式 API 调用，让 Playwright 的 evaluate 在导航前正常返回。 */
async function applyScheme(scheme) {
  const win = await app.firstWindow()
  await win.waitForSelector('#input', { timeout: 30000 })
  const current = await win.evaluate(() => window.api.uiScheme())
  if (current !== scheme) {
    const navigation = win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
    await win.evaluate((s) => { setTimeout(() => { void window.api.setUiScheme(s) }, 0) }, scheme)
    await navigation
  }
  await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
  await win.waitForSelector('#input', { timeout: 30000 })
  await win.waitForTimeout(1200)
  return win
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  for (const scheme of SCHEMES) {
    activeScheme = scheme
    const profile = schemeProfile(scheme)
    const appdata = path.join(runRoot, scheme, 'appdata')
    const tmp = path.join(runRoot, scheme, 'tmp')
    for (const dir of [profile, appdata, tmp]) fs.mkdirSync(dir, { recursive: true })
    app = await electron.launch({
      executablePath: require('electron'), cwd: root, args: ['.'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1', SIXWORLDS_TEST_USER_DATA: profile, APPDATA: appdata, TEMP: tmp, TMP: tmp, TMPDIR: tmp }
    })
    const win = await applyScheme(scheme)
    /* 实际入口 + 正式方案值必须一致（不拿环境变量当证据）。 */
    assert.equal(await win.evaluate(() => window.api.uiScheme()), scheme, 'api.uiScheme() 必须等于目标方案')
    assert.ok((await win.evaluate(() => location.pathname.replace(/\\/g, '/'))).includes('/ui/' + scheme + '/index.html'), '实际入口必须是 ui/' + scheme + '/index.html')
    const errors = []
    win.on('pageerror', (error) => errors.push(error.message))
    await win.evaluate((baseUrl) => {
      localStorage.clear()
      localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl, apiKey: 'mock', model: 'mock', illustPreset: 'off', skipSplash: true }))
    }, 'http://127.0.0.1:' + server.address().port)
    await win.reload()
    await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 30000 })
    await win.waitForSelector('#input')
    await win.waitForTimeout(1200)
    await send(win, 'first')
    await settled(win, 1)
    await send(win, 'second')
    await win.waitForSelector('#btn-send.stop')
    await win.locator('#choices .choice').filter({ hasText: 'third' }).click()
    await settled(win, 3)
    const saved = () => win.evaluate(() => JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]'))
    let sessions = await saved()
    const sid = sessions[0].id
    const resource = () => win.evaluate(async (id) => (await window.api.engineOverview({ storyId: id })).data.player.resources.gold, sid)
    assert.equal(await resource(), 111)
    const last = win.locator('.msg.assistant').last()
    await last.hover()
    await last.getByRole('button', { name: '重生成', exact: true }).click()
    await settled(win, 3)
    assert.equal(await resource(), 111, 'regeneration must not duplicate world state')
    const secondAction = win.locator('.msg.user').nth(1)
    await checkReadWidthControls(win, secondAction)
    await secondAction.hover()
    await secondAction.getByRole('button', { name: 'IF 分歧', exact: true }).click()
    try {
      await win.waitForSelector('.confirm-mask', { timeout: 1500 })
    } catch {
      const diagnostic = await win.evaluate(() => ({
        confirm: !!document.querySelector('.confirm-mask'),
        notices: Array.from(document.querySelectorAll('.toast')).map((el) => el.textContent),
        sessions: JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]').map((session) => ({
          id: session.id,
          messages: (session.messages || []).map((message) => ({ role: message.role, content: message.content, engineSnapshot: message.engineSnapshot }))
        })),
        clicked: document.activeElement?.outerHTML || ''
      }))
      console.error('IF 分歧确认层诊断 ' + activeScheme + ': ' + JSON.stringify(diagnostic))
      throw new Error('点击 IF 分歧后未显示确认层')
    }
    await win.getByRole('button', { name: '开辟 IF 线', exact: true }).click()
    await win.waitForFunction(() => document.querySelectorAll('.msg.user').length === 1)
    await win.waitForTimeout(650)
    sessions = await saved()
    const branch = sessions.find((s) => s.ifFrom === sid)
    assert.ok(branch)
    const branchGold = await win.evaluate(async (id) => (await window.api.engineOverview({ storyId: id })).data.player.resources.gold, branch.id)
    assert.equal(branchGold, 1, 'IF branch excludes future state')
    assert.equal(await resource(), 111, 'mother line unchanged')
    await win.screenshot({ path: path.join(shots, scheme + '-desktop.png') })
    await win.setViewportSize({ width: 700, height: 720 })
    await win.screenshot({ path: path.join(shots, scheme + '-narrow.png') })
    assert.equal(await win.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await win.setViewportSize({ width: 1120, height: 760 })
    await win.click('#btn-new')
    const beforeOrder = await win.locator('.session-item').evaluateAll((items) => items.map((item) => item.dataset.sid))
    const fromBox = await win.locator('.session-item').first().boundingBox()
    const toBox = await win.locator('.session-item').last().boundingBox()
    await win.mouse.move(fromBox.x + 50, fromBox.y + fromBox.height / 2)
    await win.mouse.down()
    await win.mouse.move(toBox.x + 50, toBox.y + toBox.height - 5, { steps: 12 })
    await win.mouse.up()
    const afterOrder = await win.locator('.session-item').evaluateAll((items) => items.map((item) => item.dataset.sid))
    assert.deepEqual(afterOrder, [...beforeOrder.slice(1), beforeOrder[0]], 'drop-after preserves intended order')
    assert.deepEqual(errors, [])
    if (scheme === 'classic') {
      await win.setViewportSize({ width: 1120, height: 760 })
      await win.evaluate(() => {
        const cfg = {}
        window.__auditSetup = window.Onboarding.createOnboarding({
          $: (id) => document.getElementById(id), cfg: () => cfg,
          api: { testEndpoint: async (payload) => { window.__auditModelRequest = payload; return { ok: true, models: ['safe-model', '<img src=x onerror=alert(1)>'] } } },
          PALETTES: [], applyTheme: () => {}, applyPalettePresetLink: () => {}, refreshModelSelect: () => {}, saveStore: () => {}, toast: () => {}
        })
        window.__auditSetup.showSetupWizard()
      })
      await win.locator('.wizard .primary').click()
      assert.equal(await win.inputValue('.wizard-model'), 'deepseek-chat')
      await win.fill('.wizard-model', 'custom-model')
      await win.fill('.wizard-apikey', 'mock-shared-key')
      await win.locator('.wizard .primary').click()
      await win.locator('.wizard .cancel').click()
      assert.equal(await win.inputValue('.wizard-model'), 'custom-model')
      await win.locator('.wizard .primary').click()
      await win.locator('[data-ip="openai"]').click()
      await win.locator('.wizard-fetch-btn').click()
      assert.equal(await win.evaluate(() => window.__auditModelRequest.apiKey), 'mock-shared-key')
      assert.equal(await win.locator('.wizard img').count(), 0)
      assert.ok((await win.locator('.wizard-imgmodel').textContent()).includes('<img'))
      await win.screenshot({ path: path.join(shots, 'onboarding-models.png') })
    }
    results.push({ scheme, status: 'passed', checks: ['queued retry', 'regeneration state', 'read width gutter / pointer / keyboard', 'IF state', 'narrow viewport', 'session reorder', 'no renderer errors'] })
    fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify(results, null, 2))
    console.log('PASS ' + scheme + ' (' + (await win.evaluate(() => location.pathname.replace(/\\/g, '/'))).replace(/^.*\/ui\//, 'ui/') + '): queued retry, regeneration state, read width hit testing / controls, IF state, narrow viewport, no renderer errors')
    await app.close(); app = null
  }
  console.log('（本轮 profile：' + path.relative(root, runRoot) + '）')
}
main().catch(async (error) => {
  console.error(error)
  results.push({ scheme: activeScheme, status: 'failed', error: error.message })
  fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify(results, null, 2))
  if (app) {
    try { await (await app.firstWindow()).screenshot({ path: path.join(shots, activeScheme + '-failure.png') }) }
    catch (captureError) { console.error('失败截图未保存：' + captureError.message) }
  }
  process.exitCode = 1
}).finally(async () => { if (app) await app.close(); server.closeAllConnections(); server.close() })

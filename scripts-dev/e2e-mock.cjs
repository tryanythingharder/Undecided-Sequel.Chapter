// 端到端测试（本地 mock 服务端，无需真实 API key）
// 覆盖：流式对话、选项渲染、自动插图（b64_json）、手动插图（远程 url → data URL）、
//       多会话（新建/切换/删除/持久化）、插图重生成、大图查看
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// 获取设置独立窗口（settings.html）；closed=true 时确认其已关闭
async function settingsWindow(app, closed) {
  for (let i = 0; i < 30; i++) {
    const ws = app.windows()
    const s = ws.find((w) => w.url().includes('settings.html'))
    if (closed ? !s : s) return s || null
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

// 等引擎后台补录结束：发送按钮非停止 + (消息数:待补录徽标:记账中徽标) 连续两轮稳定且徽标全清
// push-first 重构后补录在消息入列后后台进行（committing 徽标实时可见）——两处徽标都要清零
async function waitEngineSettled(win, timeout) {
  const t0 = Date.now()
  let prev = null
  while (Date.now() - t0 < (timeout || 12000)) {
    const busy = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    const snap = await win.evaluate(() => document.querySelectorAll('.msg.assistant').length + ':' + document.querySelectorAll('.msg-pending-chip').length + ':' + document.querySelectorAll('.msg-committing-chip').length)
    if (!busy && snap === prev && snap.endsWith(':0')) return true
    prev = snap
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function startMock() {
  let imageMode = 'b64' // b64 | url
  let chatCalls = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const json = (code, obj, headers) => {
        res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}))
        res.end(JSON.stringify(obj))
      }
      if (req.url.endsWith('/chat/completions')) {
        const { user, systemMsg } = (() => { try { const p = JSON.parse(body); const u = p.messages.filter((m) => m.role === 'user' && !String(m.content).startsWith('（系统要求')).pop(); const sys = p.messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join(''); return { user: u ? u.content : '', systemMsg: sys } } catch { return { user: '', systemMsg: '' } } })()
        const wantsStream = (() => { try { return JSON.parse(body).stream === true } catch { return false } })()
        // 漫画分镜师任务（pet:agent comic，非流式）：正文带【按回合分组的剧情素材】时，
        // 从素材行提取回合号，每回合返回一幕（确定性；续画轮次只包含新回合，便于断言追加）
        if (user.includes('【按回合分组的剧情素材】')) {
          const turns = [...new Set([...user.matchAll(/第(\d+)幕/g)].map((m) => Number(m[1])))].sort((a, b) => a - b).slice(0, 40)
          const panels = turns.map((t) => ({
            turn: t,
            title: t === 1 ? '清晨的到访' : (t === 2 ? '走向森林' : '第' + t + '幕·继续旅程'),
            narration: '第' + t + '幕的叙事摘录。',
            participants: ['主角'],
            sceneLine: '【甲龙历407.03.0' + t + '｜清晨｜布耶纳村】'
          }))
          return json(200, { choices: [{ message: { role: 'assistant', content: JSON.stringify({ cast: [{ name: '主角', look: 'young man with brown hair, plain village clothes' }], panels }) } }] })
        }
        // 角色闪卡设计师任务（pet:agent card，非流式）：system 带任务标识，从素材提取角色名，返回确定性卡面规划
        if (systemMsg.includes('收藏卡设计师')) {
          const name = (user.match(/名字：(.+)/) || [])[1] || '主角'
          return json(200, { choices: [{ message: { role: 'assistant', content: JSON.stringify({
            name, subtitle: '测试称号', technique: '测试招式', tagline: '测试一句话点睛',
            rarity: 'SSR',
            subjectPrompt: 'young man with brown hair, mage robe, plain white background, solid white background',
            backgroundPrompt: 'misty fantasy village at dawn', foil: 0.7, why: '（测试大脑）卡面设计思路'
          }) } }] })
        }
        const reply = user.includes('【A】')
          ? '【甲龙历 407.03.02｜午后｜村口】你接受了委托，沿着薄雾中的小路向森林走去。\n【A】深入森林 B. 返回村庄报信'
          : '【甲龙历 407.03.01｜清晨｜布耶纳村】薄雾笼罩的清晨，有人敲响了你的家门。一位灰袍旅人向你问路。\n【A】为他指路并闲聊（获得情报）【B】闭门不开 C. 跟随他'
        // 模拟 usage：每次调用递增，供渲染层累计断言
        chatCalls += 1
        const usage = { prompt_tokens: 50 * chatCalls, completion_tokens: 20 * chatCalls, total_tokens: 70 * chatCalls }
        if (wantsStream) {
          // SSE：按 12 字符分块推送
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          let i = 0
          const timer = setInterval(() => {
            if (i >= reply.length) {
              clearInterval(timer)
              // 末块携带 usage（choices 为空，与主流端点一致）
              res.write('data: ' + JSON.stringify({ choices: [], usage }) + '\n\n')
              res.write('data: [DONE]\n\n')
              res.end()
              return
            }
            const piece = reply.slice(i, i + 12)
            i += 12
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
          }, 30)
          return
        }
        return json(200, { choices: [{ message: { role: 'assistant', content: reply } }], usage })
      }
      if (req.url.endsWith('/images/generations')) {
        // revised_prompt：gpt-image 系真实行为（内部改写提示词）——e2e 校验透传链路
        if (imageMode === 'b64') {
          return json(200, { data: [{ b64_json: PNG_1PX, revised_prompt: '(mock revised) scene as requested' }] })
        }
        const port = server.address().port
        return json(200, { data: [{ url: 'http://127.0.0.1:' + port + '/img.png', revised_prompt: '(mock revised) scene as requested' }] })
      }
      if (req.url === '/img.png') {
        const buf = Buffer.from(PNG_1PX, 'base64')
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length })
        return res.end(buf)
      }
      if (req.url.endsWith('/models')) {
        if (req.headers.authorization !== 'Bearer sk-mock') return json(401, { error: { message: 'bad key' } })
        return json(200, { data: [{ id: 'mock-chat' }, { id: 'mock-image' }, { id: 'mock-other' }] })
      }
      json(404, { error: 'not found: ' + req.url })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, setMode: (m) => { imageMode = m } }))
  })
}

async function main() {
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }
  /* 动画驱动关闭的元素（closeModalAnim：CSS 动画结束或 220ms 兜底后才置 hidden）
   * 不能用固定 sleep 后断言——慢机器上必竞态。轮询状态直到 hidden 或超时。 */
  const waitForHidden = async (selector, timeout = 2500) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await win.locator(selector).evaluate((el) => el.hidden).catch(() => true)) return true
      await win.waitForTimeout(80)
    }
    return await win.locator(selector).evaluate((el) => el.hidden).catch(() => false)
  }
  let ok = false

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'], cwd: path.join(__dirname, '..'), env: {
      ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1', SIXWORLDS_UI_SCHEME: process.env.SIXWORLDS_UI_SCHEME || '',
      SIXWORLDS_TEST_SAVE_PATH: path.join(__dirname, 'tmp-comic-export.html')
    }
  })
  let win = await app.firstWindow()
  await win.waitForTimeout(1500)
  // 方案矩阵（绞杀者迁移闸门）：SIXWORLDS_UI_SCHEME=proto 整轮跑在原型工作台——
  // 双方案 DOM id 一致，断言天然双有效；切换会整窗重建，重取句柄再续
  if (process.env.SIXWORLDS_UI_SCHEME === 'proto') {
    const cur = await win.evaluate(() => window.api.uiScheme()).catch(() => 'classic')
    if (cur !== 'proto') {
      await win.evaluate(() => window.api.setUiScheme('proto')).catch(() => {})
      await win.waitForTimeout(2600)
      const wins = app.windows()
      win = wins[wins.length - 1]
    }
  }
  // 干净状态
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(1500)
  const winsAfter = app.windows()
  win = winsAfter[winsAfter.length - 1]

  // 配置文本模型 + 图像模型（b64 模式 + 自动插图）——设置在独立窗口中操作
  await win.click('#btn-settings')
  const sw = await settingsWindow(app)
  check('settings-window-opens', !!sw)
  await sw.selectOption('#set-preset', 'custom')
  await sw.fill('#set-baseurl', base)
  // P1-5 明文端点警示：http:// 地址就地亮警示（不打断输入）；https 隐藏
  const warnHttp = await sw.locator('#set-baseurl-warn').isVisible().catch(() => false)
  check('plain-http-warn-shown', warnHttp === true, 'http 警示可见=' + warnHttp)
  await sw.fill('#set-baseurl', 'https://example.com')
  await sw.waitForTimeout(100)
  const warnHttps = await sw.locator('#set-baseurl-warn').isVisible().catch(() => true)
  check('plain-http-warn-hidden-on-https', warnHttps === false, 'https 警示隐藏=' + warnHttps)
  await sw.fill('#set-baseurl', base)
  await sw.fill('#set-apikey', 'sk-mock')
  await sw.fill('#set-model', 'mock-chat')

  // ---- 新功能：密钥明/密切换 ----
  const keyType0 = await sw.locator('#set-apikey').getAttribute('type')
  check('apikey-masked-by-default', keyType0 === 'password', 'type=' + keyType0)
  await sw.click('#btn-peek-key')
  await sw.waitForTimeout(150)
  const keyType1 = await sw.locator('#set-apikey').getAttribute('type')
  check('apikey-peek-toggles-plain', keyType1 === 'text', 'type=' + keyType1)
  await sw.click('#btn-peek-key')
  await sw.waitForTimeout(150)
  check('apikey-peek-toggles-back', (await sw.locator('#set-apikey').getAttribute('type')) === 'password')

  // ---- 新功能：测试连接（GET /models → mock 返回 3 个模型，当前模型在列表中）----
  check('test-result-hidden-initially', await sw.locator('#test-result-text').evaluate((el) => el.classList.contains('hidden')))
  await sw.click('#btn-test-text')
  ok = false
  for (let i = 0; i < 30; i++) {
    const cls = await sw.locator('#test-result-text').getAttribute('class')
    if (cls && cls.includes('ok')) { ok = true; break }
    await sw.waitForTimeout(200)
  }
  const testText = ok ? await sw.locator('#test-result-text').textContent() : ''
  check('test-endpoint-ok', ok && /连接成功/.test(testText) && /mock-chat/.test(testText), 'text=' + testText)
  // 错误路径：清空密钥再测 → 应显示失败
  await sw.fill('#set-apikey', 'sk-wrong')
  await sw.click('#btn-test-text')
  ok = false
  for (let i = 0; i < 30; i++) {
    const cls = await sw.locator('#test-result-text').getAttribute('class')
    if (cls && cls.includes('err')) { ok = true; break }
    await sw.waitForTimeout(200)
  }
  check('test-endpoint-bad-key-err', ok, 'text=' + (await sw.locator('#test-result-text').textContent()))
  await sw.fill('#set-apikey', 'sk-mock')

  // ---- 新功能：获取模型列表 + 下拉选择（GET /models → 3 个 mock 模型）----
  await sw.click('#btn-models-text')
  ok = false
  for (let i = 0; i < 30; i++) {
    if (!(await sw.locator('#model-dd-text').evaluate((el) => el.classList.contains('hidden')))) { ok = true; break }
    await sw.waitForTimeout(200)
  }
  check('model-dropdown-opens', ok)
  check('model-options-3', (await sw.locator('#model-opts-text .model-opt:not(.refresh)').count()) === 3)
  // 筛选：输入 "chat" 只剩 mock-chat
  await sw.fill('#model-filter-text', 'chat')
  await sw.waitForTimeout(150)
  check('model-filter-narrows', (await sw.locator('#model-opts-text .model-opt:not(.refresh)').count()) === 1)
  // 点击选中 → 填入输入框并关闭
  await sw.locator('#model-opts-text .model-opt:not(.refresh)').first().click()
  await sw.waitForTimeout(150)
  check('model-picked-fills-input', (await sw.locator('#set-model').inputValue()) === 'mock-chat')
  check('model-dropdown-closes-on-pick', await sw.locator('#model-dd-text').evaluate((el) => el.classList.contains('hidden')))
  // 缓存：再次点击直接展开（不再请求）
  await sw.click('#btn-models-text')
  await sw.waitForTimeout(200)
  check('model-dropdown-reopens-from-cache', !(await sw.locator('#model-dd-text').evaluate((el) => el.classList.contains('hidden'))))
  // Esc 关闭下拉（不应关闭设置窗口）
  await sw.keyboard.press('Escape')
  await sw.waitForTimeout(200)
  check('model-dropdown-esc-closes', await sw.locator('#model-dd-text').evaluate((el) => el.classList.contains('hidden')))
  check('settings-window-still-open-after-esc', !!(await settingsWindow(app)))

  // 切到「插图模型」页签填写
  await sw.click('.tab[data-tab="image"]')
  await sw.waitForTimeout(200)
  await sw.selectOption('#set-illust-preset', 'custom')
  await sw.fill('#set-illust-baseurl', base)
  // 显式写死 mock 密钥：真实模型联调会往共享测试档案里复制真实加密密钥，重启后设置窗
  // 可能把真实密钥补进这个输入框 → mock 校验 Bearer sk-mock 失败 401，下拉打不开（实测病例）
  await sw.fill('#set-illust-apikey', 'sk-mock')
  // 图像模型：下拉获取并选择 mock-image
  await sw.click('#btn-models-image')
  ok = false
  for (let i = 0; i < 30; i++) {
    if (!(await sw.locator('#model-dd-image').evaluate((el) => el.classList.contains('hidden')))) { ok = true; break }
    await sw.waitForTimeout(200)
  }
  check('image-model-dropdown-opens', ok)
  await sw.fill('#model-filter-image', 'image')
  await sw.waitForTimeout(150)
  await sw.locator('#model-opts-image .model-opt:not(.refresh)').first().click()
  await sw.waitForTimeout(150)
  check('image-model-picked', (await sw.locator('#set-illust-model').inputValue()) === 'mock-image')
  await sw.check('#set-illust-auto')
  // 图像端点测试：密钥与文本一致（mock 统一校验 Bearer sk-mock）→ 应成功
  await sw.click('#btn-test-image')
  ok = false
  for (let i = 0; i < 30; i++) {
    const cls = await sw.locator('#test-result-image').getAttribute('class')
    if (cls && cls.includes('ok')) { ok = true; break }
    await sw.waitForTimeout(200)
  }
  check('test-image-endpoint-ok', ok, 'text=' + (await sw.locator('#test-result-image').textContent()))
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(500)
  check('settings-window-closed-after-save', !(await settingsWindow(app, true)))

  // ---- 流式对话：验证打字机增量渲染 ----
  let sawPartial = false
  let finalLen = 0
  win.on('console', (m) => { /* noop */ })
  await win.click('.empty .primary')
  // 轮询期间捕捉「部分文本」状态（流式推进中的中间态）
  for (let i = 0; i < 60; i++) {
    const t = await win.locator('.msg.assistant .msg-body').last().textContent().catch(() => '')
    if (t && t.length > 4 && t.includes('甲龙历')) {
      if (!t.includes('跟随他')) { sawPartial = true } // 还没收到全文 → 中间态
      else { finalLen = t.length; break }
    }
    await win.waitForTimeout(100)
  }
  check('streaming-typewriter-partial-seen', sawPartial)
  for (let i = 0; i < 20; i++) {
    const t = await win.locator('.msg.assistant .msg-body').last().textContent().catch(() => '')
    if (t && t.includes('跟随他') && !t.includes('▍')) { ok = true; break }
    await win.waitForTimeout(300)
  }
  check('streaming-final-complete', ok)
  check('stream-no-cursor-left', ok)

  check('choices-rendered', (await win.locator('.choice').count()) >= 2)
  // 等自动插图完成
  ok = false
  for (let i = 0; i < 20; i++) {
    if ((await win.locator('.illust img').count()) >= 1) { ok = true; break }
    await win.waitForTimeout(500)
  }
  const src = ok ? await win.locator('.illust img').first().getAttribute('src') : ''
  check('auto-illust-b64', ok && src.startsWith('data:image/'), src ? src.slice(0, 30) : 'no img')
  // gpt-image 改写提示词回显：mock 端点带 revised_prompt → 插图下方应出现提示条
  const revisedCount = await win.locator('.illust-revised').count()
  check('illust-revised-shown', revisedCount >= 1, 'revised=' + revisedCount)

  // ---- 会话标题自动生成 ----
  const title = await win.locator('.session-item.active .session-label-text').textContent().catch(() => '')
  check('session-auto-title', /布耶纳村/.test(title || ''), 'title=' + title)

  // ---- token 用量累计（Codex 化改版后统一展示在输入框下方小字 #token-meter，面板只留模型与思考程度）----
  // 成本评审回归：补账静默重试的 usage 也计入（此前被漏记 → 账单≈面板 1.4 倍）。
  // 本轮 = 主调用(50/20/70) + 无 patch 触发的补录重试(100/40/140) = 150/60/210。
  // 慢 runner 上 waitEngineSettled（徽标两轮稳定）可能先于补录 retry 完成返回——
  // 这里对最终值做确定性轮询（usage 入账后 renderTokenMeter 必更新），而非单次读取。
  await waitEngineSettled(win)
  const meta1 = await (async () => {
    for (let i = 0; i < 60; i++) {
      const t = await win.locator('#token-meter').textContent().catch(() => '')
      if (t.includes('210 tok')) return t
      await new Promise((r) => setTimeout(r, 300))
    }
    return await win.locator('#token-meter').textContent().catch(() => '')
  })()
  check('token-usage-shown', /210 tok/.test(meta1 || ''), 'meta=' + meta1)
  check('retry-usage-counted', (meta1 || '').includes('150 输入 / 60 输出 / 210 tok'), 'meta=' + meta1)

  // ---- 新消息带时间戳（悬停显示）----
  check('msg-time-on-new-messages', (await win.locator('.msg-time').count()) >= 2)

  // ---- 窗口标题同步会话名 ----
  const docTitle = await win.evaluate(() => document.title)
  check('doc-title-syncs-session', docTitle !== '六面世界' && docTitle.length > 0, 'title=' + docTitle)

  // ---- 大图查看 ----
  await win.locator('.illust img').first().click()
  await win.waitForTimeout(300)
  const lbVisible = await win.locator('#lightbox').isVisible().catch(() => false)
  check('lightbox-opens', lbVisible)
  const lbSrc = lbVisible ? await win.locator('#lightbox img').getAttribute('src') : ''
  check('lightbox-shows-image', lbSrc.startsWith('data:image/'))
  await win.locator('#lightbox').click()
  await win.waitForTimeout(200)
  check('lightbox-closes', !(await win.locator('#lightbox').isVisible().catch(() => false)))

  // ---- 新功能：Ctrl+F 消息搜索（在当前世界线内搜索「薄雾」）----
  await win.keyboard.press('Control+f')
  await win.waitForTimeout(250)
  check('search-bar-opens', await win.locator('#search-bar').isVisible())
  await win.fill('#search-input', '薄雾')
  await win.waitForTimeout(250)
  const sc = await win.locator('#search-count').textContent()
  check('search-finds-matches', /\d+\/\d+/.test(sc || '') && !/^0\/0$/.test(sc || ''), 'count=' + sc)
  // 命中高亮应渲染为 mark
  const markCnt = await win.locator('.msg-body mark').count()
  check('search-highlights-mark', markCnt >= 1, 'marks=' + markCnt)
  // Enter 跳转下一处 → 应有 active mark
  await win.keyboard.press('Enter')
  await win.waitForTimeout(150)
  const activeCnt = await win.locator('.msg-body mark.active').count()
  check('search-active-mark', activeCnt === 1, 'active=' + activeCnt)
  // Esc 关闭搜索并清除高亮
  await win.keyboard.press('Escape')
  await waitForHidden('#search-bar')
  check('search-bar-closes', await win.locator('#search-bar').evaluate((el) => el.hidden))
  const marksAfter = await win.locator('.msg-body mark').count()
  check('search-clears-highlights', marksAfter === 0, 'leftover=' + marksAfter)

  // ---- 第二轮：url 模式 + 手动插图（验证远程 url → data URL + REDRAW）----
  mock.setMode('url')
  await win.click('#btn-settings')
  const sw2 = await settingsWindow(app)
  await sw2.click('.tab[data-tab="image"]')
  await sw2.waitForTimeout(200)
  await sw2.uncheck('#set-illust-auto')
  await sw2.click('#btn-save-settings')
  await win.waitForTimeout(500)

  await win.click('.choice >> nth=0')
  ok = false
  for (let i = 0; i < 20; i++) {
    const texts = await win.locator('.msg.assistant .msg-body').allTextContents()
    if (texts.length >= 2 && texts[texts.length - 1].includes('森林') && !texts[texts.length - 1].includes('▍')) { ok = true; break }
    await win.waitForTimeout(300)
  }
  check('chat-round-2-via-choice', ok)

  const lastAssistant = win.locator('.msg.assistant').last()
  await lastAssistant.hover()
  await win.waitForTimeout(200)
  const illustBtn = lastAssistant.locator('.tool-btn', { hasText: '插图' })
  check('illust-btn-visible', (await illustBtn.count()) === 1)
  await illustBtn.click()
  ok = false
  for (let i = 0; i < 20; i++) {
    if ((await lastAssistant.locator('.illust img').count()) >= 1) { ok = true; break }
    await win.waitForTimeout(500)
  }
  const src2 = ok ? await lastAssistant.locator('.illust img').getAttribute('src') : ''
  check('manual-illust-url-fetched', ok && src2.startsWith('data:image/png'), src2 ? src2.slice(0, 30) : 'no img')

  // ---- REDRAW：第一条消息（b64）悬停后应有 REDRAW 按钮 ----
  const firstAssistant = win.locator('.msg.assistant').first()
  await firstAssistant.hover()
  await win.waitForTimeout(200)
  const redrawBtn = firstAssistant.locator('.tool-btn', { hasText: '重绘' })
  check('redraw-btn-visible', (await redrawBtn.count()) === 1)
  if (await redrawBtn.count()) {
    await redrawBtn.click()
    ok = false
    for (let i = 0; i < 20; i++) {
      const src = await firstAssistant.locator('.illust img').getAttribute('src').catch(() => null)
      if (src && src.startsWith('data:image/png')) { ok = true; break } // url 模式 → png
      await win.waitForTimeout(500)
    }
    check('redraw-regenerates', ok)
  }

  // ---- 中途停止生成：发起一轮 → busy 时点 STOP → 保留已生成内容 ----
  // 用自由输入触发（非选项），确保 mock 回复走第一条分支（不含【A】）
  await win.fill('#input', '独自去森林深处探查')
  await win.click('#btn-send')
  await win.waitForTimeout(150) // 让流式开始
  // busy 时头部应显示「世界运转中…」状态徽标
  check('busy-status-shown', (await win.locator('.chat-status.on').count()) === 1)
  // busy 时发送按钮应变为「停止」
  const stopText = await win.locator('#btn-send').textContent()
  check('send-button-becomes-stop', /停止/.test(stopText || ''), 'btn=' + stopText)
  // 点停止
  await win.click('#btn-send') // busy → stopGeneration
  await win.waitForTimeout(400)
  check('stopped-not-busy', !(await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))))
  // 停止后头部忙碌状态消失
  check('busy-status-cleared', (await win.locator('.chat-status.on').count()) === 0)
  // 恢复为「发送」
  const sendText2 = await win.locator('#btn-send').textContent()
  check('send-button-restored', /发送/.test(sendText2 || ''), 'btn=' + sendText2)

  // ---- 重命名世界线（双击标题 → 输入 → 回车）----
  const beforeTitle = await win.locator('.session-item.active .session-label-text').textContent()
  await win.locator('.session-item.active .session-label-text').dblclick()
  await win.waitForTimeout(200)
  check('rename-input-appears', await win.locator('.session-rename-input').count() === 1)
  await win.locator('.session-rename-input').fill('重命名测试线')
  await win.locator('.session-rename-input').press('Enter')
  await win.waitForTimeout(300)
  const afterTitle = await win.locator('.session-item.active .session-label-text').textContent()
  check('rename-committed', afterTitle === '重命名测试线', 'title=' + afterTitle)
  check('rename-changed', beforeTitle !== afterTitle)

  // ---- 复制消息文本（点 COPY → 不报错 + toast）----
  await win.locator('.msg.assistant').first().hover()
  await win.waitForTimeout(200)
  const copyBtn = win.locator('.msg.assistant').first().locator('.tool-btn', { hasText: '复制' })
  check('copy-btn-visible', (await copyBtn.count()) === 1)
  await copyBtn.click()
  await win.waitForTimeout(300)
  check('copy-toast-shown', (await win.locator('.toast.ok').count()) >= 1)

  // ---- 重新生成上一回合（REGEN）----
  await waitEngineSettled(win) // 等上一回合的后台补录结束（条款 17 重试不占用 UI 状态）
  // 取最后一条 assistant 的 REGEN 按钮触发
  const lastMsg = win.locator('.msg.assistant').last()
  await lastMsg.hover()
  await win.waitForTimeout(200)
  const regenBtn = lastMsg.locator('.tool-btn', { hasText: '重生成' })
  check('regen-btn-visible', (await regenBtn.count()) === 1)
  const assistantBefore = await win.locator('.msg.assistant').count()
  await regenBtn.click()
  // 等待重新生成完成：按钮复位 且 消息数恢复（push-first 后消息入列先于补录，数量即时恢复）
  ok = false
  for (let i = 0; i < 30; i++) {
    const n = await win.locator('.msg.assistant').count()
    const busyNow = await win.evaluate(() => document.querySelector('#btn-send').classList.contains('stop'))
    if (!busyNow && n === assistantBefore) { ok = true; break }
    await win.waitForTimeout(400)
  }
  check('regen-completes', ok)
  // assistant 数量应保持（移除一条再生成一条）
  const assistantAfter = await win.locator('.msg.assistant').count()
  check('regen-keeps-count', assistantAfter === assistantBefore, 'before=' + assistantBefore + ' after=' + assistantAfter)

  // ---- 顽固待补录「放弃」出口（R85）----
  // mock 回复始终无状态块：后台补账重试也失败 → pending chip 留存。实测横幅放弃按钮整链
  await waitEngineSettled(win)
  let chipCnt = 0
  for (let i = 0; i < 20; i++) {
    chipCnt = await win.locator('.msg-pending-chip').count()
    if (chipCnt >= 1) break
    await win.waitForTimeout(300)
  }
  check('pending-chip-present', chipCnt >= 1, 'chips=' + chipCnt)
  const bannerShown = await win.evaluate(() => !document.getElementById('pending-banner').classList.contains('hidden'))
  check('pending-banner-shown', bannerShown)
  check('pending-discard-btn-mounted', (await win.locator('#btn-pending-discard').count()) === 1)
  await win.locator('#btn-pending-discard').click()
  await win.waitForTimeout(300)
  const discardConfirmVisible = await win.locator('.confirm-mask').isVisible().catch(() => false)
  check('discard-confirm-opens', discardConfirmVisible)
  if (discardConfirmVisible) await win.locator('.confirm-mask .confirm-foot button').last().click()
  for (let i = 0; i < 20; i++) {
    if ((await win.locator('.msg-pending-chip').count()) === 0) break
    await win.waitForTimeout(300)
  }
  check('discard-clears-chips', (await win.locator('.msg-pending-chip').count()) === 0)
  check('discard-hides-banner', await win.evaluate(() => document.getElementById('pending-banner').classList.contains('hidden')))
  const pendLeft = await win.evaluate(async () => {
    const sid = document.querySelector('.session-item.active').dataset.sid
    const r = await window.api.enginePendings({ storyId: sid })
    return (r && r.ok && Array.isArray(r.data)) ? r.data.length : -1
  })
  check('discard-empties-engine-pendings', pendLeft === 0, 'left=' + pendLeft)
  check('discard-keeps-narrative', (await win.locator('.msg.assistant').count()) === assistantBefore)

  // ---- 多会话：新建 → 空态 → 切回 → 删除 ----  await waitEngineSettled(win) // 等 regen 的后台补录结束，避免 engineBusy 拦截
  await win.click('#btn-new')
  await win.waitForTimeout(300)
  check('new-session-empty', (await win.locator('.empty').count()) === 1)
  const sessionCount = await win.locator('.session-item').count()
  check('session-list-2', sessionCount === 2, 'count=' + sessionCount)
  // 切回第一个会话（列表中第二个，新的在最前）
  await win.locator('.session-item >> nth=1').click()
  await win.waitForTimeout(300)
  check('switch-back-restores', (await win.locator('.msg.assistant').count()) >= 2)

  // ---- 工作区菜单：打开 / 新建 / 切换（workspace-panel getter 桥接回归闸：C1 修复
  // "workspaces is not iterable" 曾让菜单/切换/IF 线全灭且 e2e 零断言静默漏过）----
  await win.click('#btn-ws')
  await win.waitForTimeout(300)
  check('ws-menu-opens', await win.locator('#ws-menu').isVisible().catch(() => false))
  check('ws-menu-shows-current', (await win.locator('#ws-menu-list .ws-menu-item.current').count()) === 1)
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  check('ws-menu-esc-closes', await win.locator('#ws-menu').evaluate((el) => el.classList.contains('hidden')))
  // 新建工作区（promptDialog 输入名称）→ 自动切换 + 空工作区建一条新世界线
  await win.click('#btn-ws')
  await win.waitForTimeout(250)
  await win.click('#ws-new')
  await win.waitForTimeout(300)
  await win.locator('.confirm-input').fill('回归测试工作区')
  await win.click('.confirm-foot .primary')
  await win.waitForTimeout(700)
  check('ws-created-switched', (await win.locator('#ws-name').textContent()) === '回归测试工作区', 'ws-name=' + (await win.locator('#ws-name').textContent()))
  check('ws-new-gives-empty-line', (await win.locator('.session-item').count()) === 1)
  // 切回原工作区 → 世界线列表恢复
  await win.click('#btn-ws')
  await win.waitForTimeout(250)
  await win.locator('#ws-menu-list .ws-menu-item').first().click()
  await win.waitForTimeout(500)
  check('ws-switch-back-name', (await win.locator('#ws-name').textContent()) === '默认世界', 'ws-name=' + (await win.locator('#ws-name').textContent()))
  check('ws-switch-restores-lines', (await win.locator('.session-item').count()) === 2, 'lines=' + (await win.locator('.session-item').count()))

  // ---- 故事进度条：节点点击跳转（rail-panel msgEl getter 桥接回归闸：C1 修复曾静默失效）----
  // rail 仅在侧栏收起态显示（Codex 式交互）——先收起再点
  await win.evaluate(() => document.body.classList.add('sb-collapsed'))
  await win.waitForTimeout(250)
  await win.evaluate(() => { const m = document.getElementById('messages'); m.scrollTop = m.scrollHeight }) // 先置底
  await win.waitForTimeout(250)
  const railBefore = await win.evaluate(() => document.getElementById('messages').scrollTop)
  await win.locator('#rail-nodes .rail-node').first().click()
  await win.waitForTimeout(1000) // smooth 滚动落定
  const railAfter = await win.evaluate(() => document.getElementById('messages').scrollTop)
  check('rail-node-click-jumps', railAfter < railBefore, 'scrollTop ' + railBefore + ' → ' + railAfter)

  // ---- 持久化：reload 后会话与消息仍在 ----
  await win.reload()
  await win.waitForTimeout(1500)
  check('sessions-persist-after-reload', (await win.locator('.session-item').count()) === 2)
  // 重载后需重新加载内核才能渲染消息（boot 中 await loadKernel），稍作等待
  ok = false
  for (let i = 0; i < 20; i++) {
    if ((await win.locator('.msg.assistant').count()) >= 2) { ok = true; break }
    await win.waitForTimeout(500)
  }
  check('messages-persist-after-reload', ok)

  // ---- 画廊：当前会话（有插图）可查看大图、切换世界线（删除前验证）----
  await win.click('#btn-gallery')
  await win.waitForTimeout(300)
  check('gallery-opens', await win.locator('#gallery').isVisible())
  const galleryImgs = await win.locator('.gallery-card img').count()
  check('gallery-shows-cards', galleryImgs >= 1, 'cards=' + galleryImgs)
  // 新功能：卡片显示叙事摘要
  const excerpt = galleryImgs ? await win.locator('.gallery-card-excerpt').first().textContent() : ''
  check('gallery-card-excerpt', galleryImgs > 0 && /薄雾|森林|清晨|村庄/.test(excerpt || ''), 'excerpt=' + (excerpt || '').slice(0, 40))
  // 新功能：保存全部按钮 + 导出故事存档按钮存在
  check('gallery-saveall-btn', (await win.locator('#btn-gallery-saveall').count()) === 1)
  check('gallery-export-btn', (await win.locator('#btn-gallery-export').count()) === 1)
  // 查看大图
  await win.locator('.gallery-card img').first().click()
  await win.waitForTimeout(300)
  check('gallery-lightbox-opens', await win.locator('#lightbox').isVisible())
  await win.locator('#lightbox').click()
  await win.waitForTimeout(200)
  check('gallery-lightbox-closes', !(await win.locator('#lightbox').isVisible().catch(() => false)))
  // 切换世界线下拉（应有 2 个会话可选）
  const opts = await win.locator('#gallery-session option').count()
  check('gallery-session-options', opts >= 2, 'opts=' + opts)
  await win.click('#btn-gallery-close')
  await waitForHidden('#gallery')
  check('gallery-closes', await win.locator('#gallery').evaluate((el) => el.hidden))

  // ---- 快捷键：Ctrl+G 开关画廊、Ctrl+, 打开设置（独立窗口）----
  await win.keyboard.press('Control+g')
  await win.waitForTimeout(300)
  check('shortcut-ctrl-g-opens-gallery', await win.locator('#gallery').isVisible())
  await win.keyboard.press('Control+g')
  await waitForHidden('#gallery')
  check('shortcut-ctrl-g-closes-gallery', await win.locator('#gallery').evaluate((el) => el.hidden))

  // ---- 漫画回放（Comic Replay）：播种引擎回合 → 规划面板 → AI 分镜 → 逐幕绘制 → 阅读视图 → 导出 ----
  // mock 聊天回复不含 STATE_PATCH（事件账本为空）——先经 engineCommit 播种 2 个带事件账本的回合
  await win.click('#btn-gallery')
  await win.waitForTimeout(300)
  const curSid = await win.locator('#gallery-session').inputValue()
  check('comic-session-id-resolvable', !!curSid, 'sid=' + curSid)
  if (curSid) {
    const mkRaw = (n, where) => '【甲龙历407.03.0' + n + '｜清晨｜' + where + '】第' + n + '回合的叙事正文。\n<<<STATE_PATCH>>>\n' + JSON.stringify({
      turn_summary: '第' + n + '幕：主角在' + where,
      scene: { game_time: '甲龙历407.03.0' + n, location: where, participants: ['主角'], ended: false },
      entity_changes: [{ op: 'upsert', name: '主角', type: 'character', state: {}, tags: [], summary: '转生少年' }],
      events: [{ type: 'action', description: '第' + n + '回合的关键事件发生在' + where, importance: 60, participant_names: ['主角'] }]
    }) + '\n<<<END_PATCH>>>'
    const seedOnce = async (raw) => {
      const r = await win.evaluate(async ({ sid, raw }) => (await window.api.engineCommit({ storyId: sid, sessionId: sid, playerInput: '前进', raw })), { sid: curSid, raw })
      return r && r.ok && r.data && (r.data.committed || r.data.patch_status === 'PATCH_PRESENT' || r.data.ok)
    }
    check('comic-seed-turn-1', await seedOnce(mkRaw(1, '布耶纳村')))
    check('comic-seed-turn-2', await seedOnce(mkRaw(2, '村口')))
    // 素材 IPC：范围内回合事件可取
    const src = await win.evaluate(async (sid) => {
      const r = await window.api.engineComicSource({ storyId: sid, fromTurn: 1, toTurn: 2 })
      return r && r.ok ? r.data : null
    }, curSid)
    check('comic-source-turns', !!(src && src.turns && src.turns.length === 2 && src.turns[0].events.length >= 1), JSON.stringify(src && { n: src.turns && src.turns.length }))
  }

  // 规划面板：作品菜单 →「漫画回放」（无分镜时进生成向导）→ 默认 AI 模式 → 开始
  await win.click('#btn-gallery-close')
  await waitForHidden('#gallery')
  await win.click('#btn-works')
  await win.waitForTimeout(250)
  check('works-menu-opens', await win.locator('#works-pop').isVisible().catch(() => false))
  check('works-menu-comic-sub', /还没有分镜/.test(await win.locator('#works-comic-sub').textContent().catch(() => '')))
  await win.click('#works-comic')
  await win.waitForTimeout(400)
  check('comic-planner-opens', await win.locator('#comic-planner').isVisible().catch(() => false))
  check('comic-planner-estimates', /预计绘制/.test(await win.locator('.comic-planner-estimate').textContent().catch(() => '')))
  await win.click('#comic-start')
  await win.waitForTimeout(300)
  // AI 分镜规划（mock /chat/completions 的 comic 分支）→ 队列逐幕绘制（mock /images/generations b64）
  ok = false
  for (let i = 0; i < 40; i++) {
    const st = await win.evaluate(async (sid) => {
      const r = await window.api.loadSessions()
      const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
      return s && s.comic ? { n: s.comic.panels.length, done: s.comic.panels.filter((p) => p.illust).length } : null
    }, curSid).catch(() => null)
    if (st && st.done >= 2) { ok = true; break }
    await win.waitForTimeout(400)
  }
  check('comic-panels-drawn', ok, '两幕绘制完成')
  // 进度岛应已收尾离场
  ok = false
  for (let i = 0; i < 10; i++) {
    if (!(await win.locator('#comic-island').count())) { ok = true; break }
    await win.waitForTimeout(300)
  }
  check('comic-island-closed', ok)

  // 阅读视图：作品菜单 →「漫画回放」（已有分镜直接进阅读器）→ 幕图 → 分幕侧栏 → 翻页 → 关闭 → 导出
  await win.click('#btn-works')
  await win.waitForTimeout(250)
  await win.click('#works-comic')
  await win.waitForTimeout(400)
  check('comic-view-opens', await win.locator('#comic-view').isVisible().catch(() => false))
  check('comic-sidebar-shown', await win.locator('#comic-view .comic-sidebar').isVisible().catch(() => false))
  const comicRows = await win.locator('#comic-view .comic-list-row').count()
  check('comic-sidebar-rows', comicRows === 2, 'rows=' + comicRows)
  check('comic-sidebar-states-done', (await win.locator('#comic-view .comic-list-state').allTextContents()).join('') === '✓✓')
  check('comic-view-shows-img', (await win.locator('#comic-view .comic-img').count()) === 1)
  const counterText = await win.locator('#comic-view .comic-counter').textContent().catch(() => '')
  check('comic-view-counter', /1 \/ 2|2 \/ 2/.test(counterText), 'counter=' + counterText)
  await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(200)
  await win.click('#comic-view .comic-view-export')
  ok = false
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(__dirname, 'tmp-comic-export.html'))) { ok = true; break }
    await win.waitForTimeout(300)
  }
  if (ok) {
    const exported = fs.readFileSync(path.join(__dirname, 'tmp-comic-export.html'), 'utf8')
    check('comic-export-selfcontained', exported.includes('data:image/png') && /漫画回放/.test(exported), 'len=' + exported.length)
  } else {
    check('comic-export-file-written', false, '导出文件未生成')
  }
  fs.rmSync(path.join(__dirname, 'tmp-comic-export.html'), { force: true })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)
  check('comic-view-closes', !(await win.locator('#comic-view').count()))

  // ---- 续画（增量）：再播种第 3 回合 → 一键续画 → 只追加 1 幕（前 2 幕保留不重画）----
  const seedExtra = await win.evaluate(async ({ sid }) => {
    const raw = '【甲龙历407.03.03｜清晨｜森林】第3回合的叙事正文。\n<<<STATE_PATCH>>>\n' + JSON.stringify({
      turn_summary: '第3幕：主角深入森林',
      scene: { game_time: '甲龙历407.03.03', location: '森林', participants: ['主角'], ended: false },
      events: [{ type: 'discovery', description: '在森林深处发现了遗迹', importance: 70, participant_names: ['主角'] }]
    }) + '\n<<<END_PATCH>>>'
    const r = await window.api.engineCommit({ storyId: sid, sessionId: sid, playerInput: '继续', raw })
    return r && r.ok && r.data && (r.data.committed || r.data.ok)
  }, { sid: curSid }).catch(() => false)
  check('comic-seed-turn-3', seedExtra)
  // 已有分镜 → 作品菜单进阅读器 → 点「继续生成」→ 弹「续画/重画」对话框 → 续画（自动范围 3→3）
  await win.click('#btn-works')
  await win.waitForTimeout(250)
  await win.click('#works-comic')
  await win.waitForSelector('#comic-view .comic-view-continue', { timeout: 6000 })
  await win.click('#comic-view .comic-view-continue')
  await win.waitForTimeout(500)
  check('comic-resume-dialog-shown', await win.locator('.confirm-mask').isVisible().catch(() => false))
  await win.click('.confirm-foot .primary') // 续画
  ok = false
  for (let i = 0; i < 40; i++) {
    const st = await win.evaluate(async (sid) => {
      const r = await window.api.loadSessions()
      const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
      return s && s.comic ? { n: s.comic.panels.length, done: s.comic.panels.filter((p) => p.illust).length } : null
    }, curSid).catch(() => null)
    if (st && st.n >= 3 && st.done >= 3) { ok = true; break }
    await win.waitForTimeout(400)
  }
  check('comic-resume-appends-only-new', ok, '续画后应有 3 幕全画完')
  const firstPanelKept = await win.evaluate(async (sid) => {
    const r = await window.api.loadSessions()
    const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
    return s && s.comic ? s.comic.panels[0].title : null
  }, curSid).catch(() => null)
  check('comic-resume-keeps-old-panels', firstPanelKept === '清晨的到访', 'first=' + firstPanelKept)
  // 画廊保持关闭：漫画入口已从画廊工具条迁到顶栏「作品」菜单（画廊不再被漫画流程牵连）
  check('gallery-stays-closed-after-comic', await win.locator('#gallery').evaluate((el) => el.hidden))

  // ---- 角色闪卡（Holo Card）：作品菜单 → 图鉴面板 → 选角 → AI 规划 → 2 次生图 → 抠图排版落盘 → 图鉴 ----
  check('works-btn-present', (await win.locator('#btn-works').count()) === 1)
  await win.click('#btn-works')
  await win.waitForTimeout(250)
  await win.click('#works-holo')
  await win.waitForSelector('#holo-view', { timeout: 6000 })
  check('holo-view-opens', await win.locator('#holo-view').isVisible().catch(() => false))
  check('holo-view-empty-state', await win.locator('.holo-view-empty').isVisible().catch(() => false))
  await win.click('#holo-view .holo-view-generate')
  await win.waitForTimeout(400)
  check('holo-picker-opens', await win.locator('#holo-picker').isVisible().catch(() => false))
  check('holo-picker-lists-characters', (await win.locator('.holo-picker-item').count()) >= 1)
  // 选中第一个角色（主角）→ 规划 → 两次生图(1px PNG) → canvas 加工 → 落盘
  await win.locator('.holo-picker-item').first().click()
  ok = false
  for (let i = 0; i < 40; i++) {
    const st = await win.evaluate(async (sid) => {
      const r = await window.api.loadSessions()
      const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
      return s && s.cards ? s.cards.length : -1
    }, curSid).catch(() => -1)
    if (st >= 1) { ok = true; break }
    await win.waitForTimeout(400)
  }
  check('holo-card-created', ok, 'session.cards 应有 1 张')
  if (ok) {
    const card = await win.evaluate(async (sid) => {
      const r = await window.api.loadSessions()
      const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
      return s.cards[0]
    }, curSid)
    check('holo-card-meta', !!(card && card.cardId && /^card-[a-z0-9-]+$/.test(card.cardId) && card.rarity === 'SSR'), JSON.stringify(card))
    // 卡目录落盘验证(主进程直查userData:测试档案目录)
    const dirOk = await win.evaluate(async (cardId) => {
      const r = await window.api.cardRead({ cardId })
      return r && r.ok && r.config && r.config.title === '主角' && r.config.assets && r.config.assets.model === './card.glb'
    }, card.cardId).catch(() => false)
    check('holo-card-config-written', dirOk)
    // 1px PNG 主体(纯白)抠图 → 透明占比 100% ≥15% → layered = true
    check('holo-card-layered-flag', card.layered === true, 'layered=' + card.layered)
    // 查看器 IPC(e2e 接缝:SIXWORLDS_TEST 不真开窗,返回 ok)
    const vw = await win.evaluate(async (cardId) => window.api.cardWindow({ cardId }), card.cardId).catch(() => null)
    check('holo-viewer-ipc-ok', !!(vw && vw.ok))
    // 重新打开图鉴面板：卡片墙应渲染出 1 张卡（含 sixworlds-asset 预览图）
    await win.click('#btn-works')
    await win.waitForTimeout(250)
    await win.click('#works-holo')
    await win.waitForSelector('.holo-card-item', { timeout: 6000 })
    check('holo-wall-shows-card', (await win.locator('.holo-card-item').count()) === 1)
    check('holo-wall-preview-src', /^sixworlds-asset:\/\/holo\/card\//.test(await win.locator('.holo-card-img').first().getAttribute('src').catch(() => '')))
    // 删除:确认框 → 卡目录与图鉴记录移除
    await win.locator('.holo-card-actions button.del').first().click()
    await win.waitForTimeout(300)
    const confirmVisible = await win.locator('.confirm-mask').isVisible().catch(() => false)
    check('holo-delete-confirm-shown', confirmVisible)
    if (confirmVisible) await win.locator('.confirm-mask .confirm-foot button').last().click()
    ok = false
    for (let i = 0; i < 20; i++) {
      const left = await win.evaluate(async (sid) => {
        const r = await window.api.loadSessions()
        const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
        return s && s.cards ? s.cards.length : 0
      }, curSid).catch(() => 1)
      if (left === 0) { ok = true; break }
      await win.waitForTimeout(300)
    }
    check('holo-card-deleted', ok)
    const rd = await win.evaluate(async (cardId) => {
      const r = await window.api.cardRead({ cardId })
      return !(r && r.ok)
    }, card.cardId).catch(() => true)
    check('holo-card-dir-removed', rd)
  }
  // 关掉图鉴面板（Esc 由全局链关闭 holo-view），避免遮挡后续设置窗口操作
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  check('holo-view-closes', !(await win.locator('#holo-view').count()))

  await win.keyboard.press('Control+,')
  const sw3 = await settingsWindow(app)
  check('shortcut-ctrl-comma-opens-settings', !!sw3)
  // R78：关闭钮点击会立即销毁设置窗口——Playwright 后续可操作性检查会命中已销毁页面，
  // 因此用页面内 evaluate 触发点击，不做跨进程等待（行为等价：窗口被真实关闭）
  await sw3.evaluate(() => document.getElementById('btn-win-close').click()).catch(() => {})
  await win.waitForTimeout(300)
  check('esc-closes-settings', !(await settingsWindow(app, true)))

  // ---- 新功能：字号 / 阅读栏宽度可调且持久化（设置在独立窗口，效果在主窗口验证）----
  await win.keyboard.press('Control+,')
  const sw4 = await settingsWindow(app)
  await sw4.click('.tab[data-tab="appearance"]')
  await sw4.waitForTimeout(200)
  const fs0 = await win.evaluate(() => document.documentElement.getAttribute('data-fontsize'))
  check('fontsize-default-standard', fs0 === 'standard', 'data-fontsize=' + fs0)
  await sw4.selectOption('#set-fontsize', 'large')
  await win.waitForTimeout(200)
  const bodyFs = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size').trim())
  check('fontsize-large-applies', bodyFs === '16px', '--font-size=' + bodyFs)
  await sw4.selectOption('#set-readwidth', 'wide')
  await win.waitForTimeout(200)
  const readW = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--read-w').trim())
  check('readwidth-wide-applies', readW === '860px', '--read-w=' + readW)
  // 页签记忆：切到高级页签 → 保存关闭 → 重开应仍在高级页签
  await sw4.click('.tab[data-tab="advanced"]')
  await sw4.waitForTimeout(150)
  await sw4.click('#btn-save-settings')
  await win.waitForTimeout(500)
  await win.keyboard.press('Control+,')
  const sw5 = await settingsWindow(app)
  const activeTab = await sw5.locator('.modal-tabs .tab.active').getAttribute('data-tab')
  check('settings-tab-remembered', activeTab === 'advanced', 'tab=' + activeTab)
  // 改回标准并保存（不污染后续断言）
  await sw5.click('.tab[data-tab="appearance"]')
  await sw5.waitForTimeout(150)
  await sw5.selectOption('#set-fontsize', 'standard')
  await sw5.selectOption('#set-readwidth', 'standard')
  await sw5.click('#btn-save-settings')
  await win.waitForTimeout(500)
  // 保存后应立即生效
  const fs1 = await win.evaluate(() => document.documentElement.getAttribute('data-fontsize'))
  check('fontsize-persisted-after-save', fs1 === 'standard', 'data-fontsize=' + fs1)

  // 删除当前会话 → 回到另一条（删除会弹出确认对话框，需点确认）
  await win.locator('.session-item.active .session-del').click()
  await win.waitForTimeout(300)
  check('delete-confirm-dialog-shown', await win.locator('.confirm-mask').isVisible().catch(() => false))
  // 点确认按钮（danger 类）
  await win.click('.confirm-foot .danger')
  await win.waitForTimeout(400)
  check('delete-session', (await win.locator('.session-item').count()) === 1)

  await win.screenshot({ path: path.join(__dirname, 'shot-e2e-mock.png') })
  await app.close()
  mock.server.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

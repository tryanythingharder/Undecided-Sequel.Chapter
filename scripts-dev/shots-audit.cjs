// 设计走查截图脚本：捕获当前 UI 全部关键状态（mock 服务端驱动真实流程）
// 输出到 test-shots/audit/
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const OUT = path.join(__dirname, '..', 'test-shots', 'audit')
fs.mkdirSync(OUT, { recursive: true })

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
// 生成一张纯色系 PNG（较大尺寸，模拟插图）
function solidPngDataUrl() { return 'data:image/png;base64,' + PNG_1PX }

function startMock() {
  let imageMode = 'b64'
  let chatCalls = 0
  let failOnce = false
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const json = (code, obj, headers) => {
        res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}))
        res.end(JSON.stringify(obj))
      }
      if (req.url.endsWith('/chat/completions')) {
        const user = (() => { try { const p = JSON.parse(body); const u = p.messages.filter((m) => m.role === 'user').pop(); return u ? u.content : '' } catch { return '' } })()
        const wantsStream = (() => { try { return JSON.parse(body).stream === true } catch { return false } })()
        if (user.includes('触发错误')) return json(429, { error: { message: 'rate limit exceeded' } })
        const longNarrative = '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。你披上外衣走到门边，透过门缝看到一位灰袍旅人站在门外，斗篷上还沾着夜露。\n\n「旅人」"打扰了。我在寻找一位懂得古代文字的人，村里人说你或许能帮上忙。"\n\n他取出一枚刻着奇异纹路的石片，递到你面前。石片上的纹路在晨光中泛着微弱的蓝光。\n\n【状态】体力 100/100 ｜ 魔力 50/50 ｜ 金币 12\n【你需要决定】\n【A】接过石片仔细端详（触发鉴定）\n【B】询问报酬后再决定\n【C】婉拒并关门（可能错过机遇）\n① 假装不在家'
        const reply = user.includes('【A】') || user.includes('开始')
          ? longNarrative
          : '【甲龙历 407.03.02｜午后｜村口】\n你接过石片，指尖传来一阵微弱的麻痹感。旅人的眼中闪过一丝期待。\n\n"这是从北方遗迹中带出来的东西。"他压低声音，"据说与六面世界的传说有关。"\n\n【A】追问遗迹的位置\n【B】要求先看看酬劳\n【C】把石片还给他\n【D】邀请他进屋详谈'
        chatCalls += 1
        const usage = { prompt_tokens: 1240 * chatCalls, completion_tokens: 186 * chatCalls, total_tokens: 1426 * chatCalls }
        if (wantsStream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          let i = 0
          const timer = setInterval(() => {
            if (i >= reply.length) {
              clearInterval(timer)
              res.write('data: ' + JSON.stringify({ choices: [], usage }) + '\n\n')
              res.write('data: [DONE]\n\n')
              res.end()
              return
            }
            const piece = reply.slice(i, i + 16)
            i += 16
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n')
          }, 20)
          return
        }
        return json(200, { choices: [{ message: { role: 'assistant', content: reply } }], usage })
      }
      if (req.url.endsWith('/images/generations')) return json(200, { data: [{ b64_json: PNG_1PX }] })
      if (req.url.endsWith('/models')) {
        if (req.headers.authorization !== 'Bearer sk-mock') return json(401, { error: { message: 'bad key' } })
        return json(200, { data: [{ id: 'mock-chat' }, { id: 'mock-image' }, { id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'kimi-k2' }, { id: 'glm-4.6' }, { id: 'qwen-max' }] })
      }
      json(404, { error: 'not found: ' + req.url })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function settingsWindow(app, closed) {
  for (let i = 0; i < 40; i++) {
    const s = app.windows().find((w) => w.url().includes('settings.html'))
    if (closed ? !s : s) return s || null
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

async function shot(win, name) {
  await win.screenshot({ path: path.join(OUT, name + '.png') })
  console.log('SHOT', name)
}

async function main() {
  const mock = await startMock()
  const base = 'http://127.0.0.1:' + mock.port
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.waitForTimeout(1200)
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(2000)

  // 1. 首次启动免责声明
  const disclaimer = await win.locator('.modal').first()
  if (await win.locator('text=免责声明').count()) await shot(win, '01-disclaimer')
  // 同意免责
  const agree = win.locator('input[type="checkbox"]').first()
  if (await agree.count()) { await agree.check(); await win.waitForTimeout(200) }
  const agreeBtn = win.locator('button:has-text("我已阅读并同意")')
  if (await agreeBtn.count()) { await agreeBtn.click(); await win.waitForTimeout(600) }
  // 2. 教程指引（免责声明后自动打开）
  if (await win.locator('#guide:not([hidden])').count()) {
    await shot(win, '02-guide')
    await win.click('#btn-guide-close')
    await win.waitForTimeout(400)
  }

  // 3. 空态（深色主题默认）
  await shot(win, '03-empty-dark')

  // 配置 mock 端点
  await win.click('#btn-settings')
  const sw = await settingsWindow(app)
  await shot(sw, '04-settings-text')
  await sw.selectOption('#set-preset', 'custom')
  await sw.fill('#set-baseurl', base)
  await sw.fill('#set-apikey', 'sk-mock')
  await sw.fill('#set-model', 'mock-chat')
  await shot(sw, '05-settings-text-filled')
  // 模型下拉获取
  await sw.click('#btn-models-text')
  await sw.waitForTimeout(700)
  await shot(sw, '06-settings-model-dropdown')
  // 外观页签
  await sw.click('.tab[data-tab="appearance"]')
  await sw.waitForTimeout(300)
  await shot(sw, '07-settings-appearance')
  // 插图页签
  await sw.click('.tab[data-tab="image"]')
  await sw.waitForTimeout(300)
  await shot(sw, '08-settings-image')
  // 高级页签
  await sw.click('.tab[data-tab="advanced"]')
  await sw.waitForTimeout(300)
  await shot(sw, '09-settings-advanced')
  await sw.click('#btn-save-settings')
  await win.waitForTimeout(600)

  // 4. 发送第一条消息 → 流式生成中（截 busy 状态）
  await win.click('#input')
  await win.fill('#input', '开始游戏')
  await win.click('#btn-send')
  await win.waitForTimeout(350) // 流式中段
  await shot(win, '10-streaming')
  // 等流式完成
  await win.waitForSelector('.choice', { timeout: 10000 })
  await win.waitForTimeout(400)
  await shot(win, '11-narrative-choices')

  // 5. 消息悬停工具条
  const assistantMsg = win.locator('.msg.assistant').last()
  await assistantMsg.hover()
  await win.waitForTimeout(250)
  await shot(win, '12-msg-tools')

  // 6. 多选组合模式
  const multiToggle = win.locator('#multi-toggle')
  if (await multiToggle.count()) {
    await multiToggle.click()
    await win.locator('.choice').nth(0).click()
    await win.locator('.choice').nth(1).click()
    await win.waitForTimeout(300)
    await shot(win, '13-multi-select')
    await multiToggle.click() // 关闭
    await win.waitForTimeout(200)
  }

  // 7. 点选一个选项 → 第二轮叙事
  await win.locator('.choice').first().click()
  await win.waitForSelector('.msg.assistant >> nth=1', { timeout: 10000 })
  await win.waitForTimeout(600)
  await shot(win, '14-second-turn')

  // 8. 模型芯片用量面板
  await win.click('#chip-text-model')
  await win.waitForTimeout(350)
  await shot(win, '15-usage-panel')
  await win.keyboard.press('Escape')
  await win.click('.chat-header') // 关弹层
  await win.waitForTimeout(250)

  // 9. 主题弹层
  await win.click('#btn-theme')
  await win.waitForTimeout(350)
  await shot(win, '16-theme-pop')
  await win.keyboard.press('Escape')
  await win.click('.chat-header')
  await win.waitForTimeout(250)

  // 10. 工作区菜单
  await win.click('#btn-ws')
  await win.waitForTimeout(300)
  await shot(win, '17-workspace-menu')
  await win.keyboard.press('Escape')
  await win.click('.chat-header')
  await win.waitForTimeout(250)

  // 11. 会话内搜索
  await win.keyboard.press('Control+f')
  await win.waitForTimeout(300)
  await win.fill('#search-input', '石片')
  await win.waitForTimeout(400)
  await shot(win, '18-search-in-session')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)

  // 12. 侧栏全局搜索
  await win.fill('#sb-search', '石片')
  await win.waitForTimeout(400)
  await shot(win, '19-global-search')
  await win.fill('#sb-search', '')
  await win.waitForTimeout(300)

  // 13. 侧栏收起 → 故事进度条
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(500)
  const railNode = win.locator('.rail-node').first()
  if (await railNode.count()) {
    await railNode.hover()
    await win.waitForTimeout(400)
  }
  await shot(win, '20-collapsed-progress-rail')
  await win.keyboard.press('Control+b')
  await win.waitForTimeout(400)

  // 14. 画廊（空态）
  await win.click('#btn-gallery')
  await win.waitForTimeout(400)
  await shot(win, '21-gallery-empty')
  await win.click('#btn-gallery-close')
  await win.waitForTimeout(300)

  // 15. 错误恢复态
  await win.fill('#input', '触发错误')
  await win.click('#btn-send')
  await win.waitForTimeout(1200)
  await shot(win, '22-error-state')

  // 16. 浅色主题
  await win.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light')
  })
  await win.waitForTimeout(300)
  await shot(win, '23-light-theme')
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await win.waitForTimeout(200)

  // 17. 窄窗口自适应
  await win.setViewportSize({ width: 700, height: 800 })
  await win.waitForTimeout(600)
  await shot(win, '24-narrow-700')
  await win.setViewportSize({ width: 1280, height: 800 })
  await win.waitForTimeout(500)
  await shot(win, '25-laptop-1280')

  // 18. 快捷键面板
  await win.keyboard.press('Control+/')
  await win.waitForTimeout(400)
  await shot(win, '26-shortcuts')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  // 19. 操作指南
  await win.click('#btn-help')
  await win.waitForTimeout(400)
  await shot(win, '27-guide-modal')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  // 20. composer-foot 细节（模型切换下拉）
  await shot(win, '28-final-state')

  await app.close()
  mock.server.close()
  console.log('ALL_SHOTS_DONE')
  process.exit(0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })

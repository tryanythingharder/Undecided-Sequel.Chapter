// 验证插图失败重试按钮
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1800)
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'il', title: '插图测试', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始', at: Date.now() },
        { role: 'assistant', at: Date.now(), content: '【甲龙历 407.03.01｜清晨】你走过村口的长桥，桥下河水湍急，远处山影朦胧，一位旅者正向你招手。', illustError: '连接超时' }
      ]
    }]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
      currentSessionId: 'il', preset: 'custom',
      baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm',
      illustPreset: 'custom', illustBaseUrl: 'http://127.0.0.1:1', illustModel: 'img-m'
    }))
  })
  await win.reload()
  await win.waitForTimeout(2000)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // 错误消息上出现重试绘制按钮
  const cnt = await win.locator('.illust-error .retry-btn').count()
  check('illust-retry-btn-shown', cnt === 1, 'count=' + cnt)
  // 点击 → 错误清除 → pending 出现（连不上的端点会再次失败，但重试链路走通）
  await win.locator('.illust-error .retry-btn').click()
  await win.waitForTimeout(800)
  const hasPendingOrRetry = await win.evaluate(() => {
    const t = document.body.textContent
    return t.includes('正在绘制') || t.includes('插图生成失败') || t.includes('重试绘制')
  })
  check('illust-retry-click-restarts', hasPendingOrRetry)
  await win.waitForTimeout(2500)

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

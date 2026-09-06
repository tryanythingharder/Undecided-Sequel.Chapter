'use strict'
/* 真实模型冒烟（开发机手动工具，npm run test:real）：不带 SIXWORLDS_TEST 启动 →
 * 使用真实 userData 的已配置端点与密钥（safeStorage，全程不导出）→ 新建独立测试会话 →
 * 发送 2 轮真实对话（第 2 轮点选项）→ 观测流式/选项解析/落账链路/标题派生 →
 * 结束删除测试会话（不污染用户既有世界线）。产生真实 API 费用，不进 CI 测试矩阵。 */
const path = require('node:path')
const { _electron: electron } = require('playwright')

const RESULTS = []
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  ' + extra : ''))
  RESULTS.push([name, !!cond])
}

async function main() {
  console.log('== 启动真实模式（真实 userData：A6api DeepSeek）==')
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'], cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } // 注意：无 SIXWORLDS_TEST
  })
  const win = await app.firstWindow()
  // 真实模式有 splash 开场动画：2.6s 后开放键盘进入（Enter/Escape），12s 兜底
  await win.waitForTimeout(3200)
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(1200)
  const errs = []
  win.on('pageerror', (e) => errs.push(String(e).slice(0, 300)))
  win.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)) })

  // 模型配置观测（不读密钥）
  const cfgState = await win.evaluate(() => {
    const chip = document.getElementById('chip-text-model')
    const ks = document.getElementById('kernel-state')
    return { modelChip: chip ? chip.textContent.trim() : '', kernel: ks ? ks.textContent.trim() : '' }
  })
  check('model-config-ready', !!cfgState.modelChip, 'model=' + cfgState.modelChip)
  check('kernel-loaded', cfgState.kernel.includes('已加载'), cfgState.kernel)

  // 记住既有会话数，结束时恢复
  const before = await win.evaluate(() => {
    const items = document.querySelectorAll('.session-item')
    const first = items[0]
    return { count: items.length, firstTitle: first ? first.textContent.slice(0, 40) : '' }
  })
  console.log('  既有会话数:', before.count)

  // 新建测试会话
  await win.click('#btn-new')
  await win.waitForTimeout(600)
  const testTitle = await win.evaluate(() => {
    const lbl = document.querySelector('.session-item.active .session-label-text')
    return lbl ? lbl.textContent.slice(0, 30) : ''
  })
  console.log('  测试会话:', testTitle)

  // ---- 第 1 轮：自由输入 ----
  const t0 = Date.now()
  await win.fill('#input', '请用一段开场白开始这个故事，并给出 3 个选项。')
  await win.click('#btn-send')
  // 流式观测：等待中途出现打字机光标（▍）或文本渐增
  let sawStreaming = false, finalText = ''
  for (let i = 0; i < 150; i++) {
    const t = await win.evaluate(() => {
      const bodies = document.querySelectorAll('.msg.assistant .msg-body')
      const last = bodies[bodies.length - 1]
      return { txt: last ? last.textContent : '', cursor: !!document.querySelector('.stream-dot'), busy: document.querySelector('#btn-send').classList.contains('stop') }
    })
    if (t.cursor && t.txt.length < 400) sawStreaming = true
    if (!t.busy && t.txt.length > 20) { finalText = t.txt; break }
    await win.waitForTimeout(400)
  }
  const dur1 = ((Date.now() - t0) / 1000).toFixed(1)
  check('round1-stream-seen', sawStreaming)
  check('round1-reply-arrived', finalText.length > 30, 'len=' + finalText.length + ' 用时 ' + dur1 + 's')
  check('round1-no-protocol-leak', !finalText.includes('<<<'), 'sample=' + finalText.slice(0, 50).replace(/\n/g, ' '))
  await win.waitForTimeout(2500) // 落账后台窗口

  // 选项渲染
  const choices = await win.evaluate(() => document.querySelectorAll('.choice').length)
  check('round1-choices-rendered', choices >= 2, 'choices=' + choices)

  // 落账状态（pending/committing chip 数——真实模型首轮可能缺状态块，属预期；断言不崩溃即可）
  const ledger = await win.evaluate(() => ({
    pending: document.querySelectorAll('.msg-pending-chip').length,
    committing: document.querySelectorAll('.msg-committing-chip').length,
    banner: !document.getElementById('pending-banner').classList.contains('hidden')
  }))
  console.log('  落账状态:', JSON.stringify(ledger), '（真实模型首轮回合可能提示待补录，属产品预期行为）')

  // ---- 第 2 轮：点击第一个选项 ----
  if (choices >= 1) {
    await win.locator('.choice').first().click()
    let t2Text = ''
    const t1 = Date.now()
    for (let i = 0; i < 150; i++) {
      const t = await win.evaluate(() => {
        const bodies = document.querySelectorAll('.msg.assistant .msg-body')
        const last = bodies[bodies.length - 1]
        return { txt: last ? last.textContent : '', busy: document.querySelector('#btn-send').classList.contains('stop') }
      })
      if (!t.busy && t.txt !== finalText && t.txt.length > 20) { t2Text = t.txt; break }
      await win.waitForTimeout(400)
    }
    const dur2 = ((Date.now() - t1) / 1000).toFixed(1)
    check('round2-via-choice', t2Text.length > 30, 'len=' + t2Text.length + ' 用时 ' + dur2 + 's')
  }

  // 会话标题自动派生 + 原始数据对比（localStorage 里的 sessions 持久层）
  await win.waitForTimeout(1500)
  const autoTitle = await win.evaluate(() => {
    const lbl = document.querySelector('.session-item.active .session-label-text')
    return lbl ? lbl.textContent.slice(0, 40) : ''
  })
  check('auto-title-derived', !autoTitle.includes('新世界线'), 'title=' + autoTitle)

  // ---- 清理：删除测试会话（删前确认） ----
  await win.locator('.session-item.active .session-del').click()
  await win.waitForTimeout(400)
  const confirmVisible = await win.locator('.confirm-mask').isVisible().catch(() => false)
  if (confirmVisible) await win.locator('.confirm-mask .confirm-foot button').last().click().catch(() => {})
  await win.waitForTimeout(800)
  const after = await win.evaluate(() => document.querySelectorAll('.session-item').length)
  check('test-session-cleaned', after === before.count, 'before=' + before.count + ' after=' + after)

  // 崩溃兜底无错误
  check('no-page-errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  const fails = RESULTS.filter(([, ok]) => !ok).map(([n]) => n)
  console.log(fails.length ? '\nFAILED: ' + fails.join('; ') : '\nREAL_MODEL_SMOKE_ALL_PASS')
  await app.close().catch(() => {})
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })

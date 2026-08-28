// R53 诊断脚本（长会话规模实测，不改 UI）：
//  A) 300 条消息的启动渲染 / 会话切换重渲染 / 搜索过滤重渲染耗时 + longtask
//  B) 大载荷（含插图 dataURL）下 saveSessions 的同步序列化/写入耗时（每回合都要付）
//  C) 存储写入失败时的行为：确定性注入（patch setItem 抛 QuotaExceededError，天然配额 >15MB 无法复现耗尽）——
//     验证 R61 修复：UI 照常推进 + 写入确实失败 + 用户得到恰好一次的错误提示（节流）+ 故障恢复后不重复提醒
// 用法：node audit-r53-longsession.cjs [cdp-port]（需 mock-server + electron --remote-debugging-port 已起，SIXWORLDS_TEST=1）
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const fails = []

// —— 构造贴近真实密度的消息 ——
function assistantTurn(i) {
  const scenes = ['布耶纳村', '王都魔法学院', '大森林深处', '米里斯大陆', '贝卡利特迷宫']
  const scene = scenes[i % scenes.length]
  return '【甲龙历 407.03.' + String((i % 28) + 1).padStart(2, '0') + '｜午后｜' + scene + '】\n' +
    '你沿着石板路前行，沿途的商贩吆喝声此起彼伏。远处教堂的钟声敲了三下，惊起一群白鸽。\n\n' +
    '「就是这里了。」你停下脚步，面前的木质大门上刻着奇异的六边形纹路，纹路的中央是一只竖瞳，在阳光下泛着微弱的蓝光。\n\n' +
    '推门而入，灰尘在光柱中飞舞。房间中央的石台上放着一枚刻满古代文字的石片，与旅人给你的那枚极为相似。你伸出手，指尖尚未触及，石片便微微震颤起来。\n\n' +
    '【状态】体力 ' + (100 - (i % 20)) + '/100 ｜ 魔力 ' + (50 - (i % 10)) + '/50 ｜ 金币 ' + (12 + i) + ' 枚\n\n' +
    '【你需要决定】\n【A】拿起石片仔细端详（触发鉴定）\n【B】先检查房间四角\n【C】退出门外观察动静\n【D】用魔力探查石片'
}
function userTurn(i) { return '我' + ['检查背包里的地图', '向旅人打听遗迹的位置', '在原地警戒四周', '翻阅手札寻找线索'][i % 4] + '。' }

function buildMessages(n) {
  const arr = []
  for (let i = 0; i < n; i++) {
    arr.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: i % 2 === 0 ? userTurn(i) : assistantTurn(i), at: Date.now() - (n - i) * 60000 })
  }
  return arr
}

async function main() {
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!browser) throw new Error('CDP connect failed')
  let win = null
  for (let i = 0; i < 40 && !win; i++) {
    for (const ctx of browser.contexts()) {
      const p = ctx.pages().find((x) => x.url().includes('index.html'))
      if (p) win = p
    }
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  await win.setViewportSize({ width: 1440, height: 900 })

  // ===== 种子：300 条消息的大会话 + 4 张 ~700KB 的插图 dataURL（模拟真实 1344x768 插图占用） =====
  const ILLUST = 'data:image/jpeg;base64,' + 'A'.repeat(700000)
  const messages = buildMessages(300)
  for (let i = 0; i < 4; i++) messages[10 + i * 60].illust = ILLUST
  await win.evaluate((msgs) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'big', title: '长线·三百回合', createdAt: Date.now() - 86400000, updatedAt: Date.now(), messages: msgs },
      { id: 'small', title: '短线', createdAt: Date.now() - 3600000, updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }, { role: 'assistant', content: '第一幕。\n\n【A】走【B】停' }] },
    ]))
  }, messages)

  // ===== A1) 启动渲染耗时（reload → 300 条 .msg 出现） =====
  await win.reload()
  const t0 = Date.now()
  let bootMs = -1
  for (let i = 0; i < 200; i++) {
    const c = await win.evaluate(() => document.querySelectorAll('.msg').length)
    if (c >= 300) { bootMs = Date.now() - t0; break }
    await win.waitForTimeout(20)
  }
  console.log('METRIC boot_render_300msgs_ms=' + bootMs)
  if (bootMs < 0) { console.log('FAIL boot-render (msg count=' + await win.evaluate(() => document.querySelectorAll('.msg').length) + ')'); fails.push('boot-render') }

  // ===== A2) 会话切换全量重渲染耗时（短线→长线，click → 双 rAF） =====
  await win.locator('#session-list .session-item', { hasText: '短线' }).click()
  await win.waitForTimeout(300)
  const switchMs = await win.evaluate(() => new Promise((resolve) => {
    const items = document.querySelectorAll('#session-list .session-item')
    let target = null
    items.forEach((it) => { if (it.textContent.includes('长线')) target = it })
    const t0 = performance.now()
    target.click()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))))
  }))
  console.log('METRIC switch_rerender_300msgs_ms=' + switchMs)
  await win.waitForTimeout(400)

  // ===== A3) 搜索过滤重渲染（命中大量消息）+ 清除过滤 =====
  const searchMs = await win.evaluate(() => new Promise((resolve) => {
    const si = document.querySelector('#search-input')
    if (!si) return resolve(-1)
    si.focus()
    const t0 = performance.now()
    si.value = '石片'
    si.dispatchEvent(new Event('input', { bubbles: true }))
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))))
  }))
  console.log('METRIC search_filter_300msgs_ms=' + searchMs)
  const clearMs = await win.evaluate(() => new Promise((resolve) => {
    const si = document.querySelector('#search-input')
    const t0 = performance.now()
    si.value = ''
    si.dispatchEvent(new Event('input', { bubbles: true }))
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))))
  }))
  console.log('METRIC search_clear_300msgs_ms=' + clearMs)

  // ===== B) saveSessions 同步写入耗时（模拟 app.js:222 的真实调用，大载荷 + 插图） =====
  const saveMs = await win.evaluate(() => {
    const raw = localStorage.getItem('sixworlds.sessions.v2')
    const payload = raw // 与当前存储同尺寸的重写（setItem 替换旧值，配额按新值计）
    const t0 = performance.now()
    try { localStorage.setItem('sixworlds.sessions.v2', payload) } catch {}
    return { ms: Math.round(performance.now() - t0), chars: payload.length }
  })
  console.log('METRIC saveSessions_sync_ms=' + saveMs.ms + ' payload_chars=' + saveMs.chars)

  // ===== C) 存储写入失败 → 行为证据（确定性注入） =====
  // 天然配额实验（2026-08-25 已跑）：本环境 localStorage 容量 >15MB（12MB 填充 + 2.86MB 会话载荷共存，保存仍成功），
  // 天然耗尽不可复现 → 改为直接 patch setItem 对三个存储键抛 QuotaExceededError，走真实保存代码路径。
  // R62：三个入口（sessions/store/workspaces）共用一条节流提示——一次故障期只提醒一次。
  await win.evaluate(() => {
    const orig = Storage.prototype.setItem
    window.__origSetItem = orig
    const failing = ['sixworlds.sessions.v2', 'sixworlds.codex.state.v3', 'sixworlds.workspaces.v1']
    Storage.prototype.setItem = function (k, v) {
      if (failing.indexOf(k) >= 0) { const e = new Error('mock quota'); e.name = 'QuotaExceededError'; throw e }
      return orig.call(this, k, v)
    }
  })

  const beforeState = await win.evaluate(() => {
    let n = -1
    try { n = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]').length } catch {}
    return { sessionsSaved: n }
  })
  console.log('STATE before_inject ' + JSON.stringify(beforeState))

  // C1) 新建世界线（newSession → saveSessions 必失败）
  await win.locator('#btn-new').click()
  await win.waitForTimeout(400)
  // C2) 再发一个回合（发送 → saveSessions 再失败；mock 流式回复）
  await win.locator('#input').fill('触发一次正常回合')
  await win.locator('#input').press('Enter')
  let done = false
  for (let i = 0; i < 60; i++) {
    const t = await win.evaluate(() => (document.querySelector('#btn-send') || {}).textContent || '')
    if (t.includes('发送')) { done = true; break }
    await win.waitForTimeout(100)
  }
  await win.waitForTimeout(600)

  const afterUi = await win.evaluate(() => ({
    toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent),
    msgCount: document.querySelectorAll('.msg').length,
    sessionItems: document.querySelectorAll('#session-list .session-item').length,
  }))
  console.log('STATE after_actions_in_ui ' + JSON.stringify({ msgCount: afterUi.msgCount, sessionItems: afterUi.sessionItems }))
  console.log('STATE toasts ' + JSON.stringify(afterUi.toasts))

  const afterStore = await win.evaluate(() => {
    let n = -1
    try { n = JSON.parse(localStorage.getItem('sixworlds.sessions.v2') || '[]').length } catch {}
    return { sessionsSaved: n }
  })
  console.log('STATE after_inject ' + JSON.stringify(afterStore))

  // C3) 判定（R61 修复后预期）：
  //   - UI 正常推进（sessionItems=3, 新回合渲染）
  //   - 持久层确实没写进去（sessionsSaved 仍=2，注入下写入必失败）
  //   - 但用户得到了明确反馈：恰好 1 条「存储空间不足」错误 toast（节流：两次失败保存只提醒一次）
  const warned = afterUi.toasts.filter((t) => t.includes('存储空间不足'))
  const uiAdvanced = afterUi.sessionItems === 3 && afterUi.msgCount >= 2
  const notWritten = afterStore.sessionsSaved === 2
  const warnedOnce = warned.length === 1
  if (!uiAdvanced) fails.push('c-ui-advanced')
  if (!notWritten) fails.push('c-not-written')
  if (!warnedOnce) fails.push('c-warn-once')
  console.log('EVIDENCE ui_advanced=' + uiAdvanced + ' write_failed_as_injected=' + notWritten + ' user_warned_once=' + warnedOnce)

  // C4) 恢复 setItem（故障期结束后下一次保存应自动恢复并清除警示态）
  await win.evaluate(() => { Storage.prototype.setItem = window.__origSetItem })
  // 切换会话触发一次成功保存 → 无新增「存储空间不足」toast
  await win.locator('#session-list .session-item', { hasText: '短线' }).click()
  await win.waitForTimeout(500)
  const recovered = await win.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent))
  const noRepeatWarn = !recovered.some((t) => t.includes('存储空间不足')) || recovered.filter((t) => t.includes('存储空间不足')).length === 1
  if (!noRepeatWarn) fails.push('c-warn-repeat')
  console.log('EVIDENCE recover_no_repeat_warn=' + noRepeatWarn)

  console.log(fails.length ? 'AUDIT FAIL ' + fails.join(',') : 'AUDIT ALL PASS')
  process.exit(fails.length ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })
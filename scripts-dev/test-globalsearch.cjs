// 验证侧栏全局搜索（跨所有世界线搜标题+正文）
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
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'sa', title: '甲龙村启程', createdAt: Date.now(), updatedAt: Date.now(), messages: [
        { role: 'user', content: '开始冒险', at: Date.now() },
        { role: 'assistant', content: '【甲龙历 407.03.01｜清晨】你离开了布耶纳村，踏上通往中央的路。', at: Date.now() }
      ] },
      { id: 'sb', title: '魔法学院篇', createdAt: Date.now(), updatedAt: Date.now(), messages: [
        { role: 'user', content: '去学院报到', at: Date.now() },
        { role: 'assistant', content: '【甲龙历 407.05.12】你抵达了拉诺亚魔法大学，布耶纳村的乡音已远。', at: Date.now() }
      ] },
      { id: 'sc', title: '完全无关的故事', createdAt: Date.now(), updatedAt: Date.now(), messages: [
        { role: 'user', content: '开始', at: Date.now() },
        { role: 'assistant', content: '平淡的一天。', at: Date.now() }
      ] }
    ]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentSessionId: 'sa', preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm' }))
  })
  await win.reload()
  await win.waitForTimeout(2000)
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // 初始三个会话全显示
  check('initial-3-sessions', (await win.locator('.session-item').count()) === 3)

  // 搜「布耶纳」：甲乙命中（乙正文里有），丙隐藏
  await win.locator('#sb-search').fill('布耶纳')
  await win.waitForTimeout(300)
  check('filter-hides-nonmatch', (await win.locator('.session-item').count()) === 2, 'count=' + (await win.locator('.session-item').count()))
  check('hits-badge-shown', (await win.locator('.session-hits').count()) === 2)
  // 搜索态不显示时间分组标题
  const groupLabels = await win.locator('.session-group-label').count()
  check('filter-flat-list', groupLabels === 0, 'groups=' + groupLabels)

  // 搜标题词：只命中甲
  await win.locator('#sb-search').fill('魔法学院')
  await win.waitForTimeout(300)
  check('filter-by-title', (await win.locator('.session-item').count()) === 1)

  // 清空（Esc）：恢复全部
  await win.locator('#sb-search').press('Escape')
  await win.waitForTimeout(300)
  check('escape-restores-all', (await win.locator('.session-item').count()) === 3)

  // 点击命中会话 → 自动切会话 + 打开会话内搜索定位
  await win.locator('#sb-search').fill('拉诺亚')
  await win.waitForTimeout(300)
  await win.locator('.session-item[data-sid="sb"]').click()
  await win.waitForTimeout(500)
  const searchOpen = await win.evaluate(() => !document.getElementById('search-bar').hidden)
  check('click-opens-in-session-search', searchOpen)
  const searchVal = await win.locator('#search-input').inputValue()
  check('search-input-filled', searchVal === '拉诺亚', searchVal)
  const marked = await win.locator('.msg-body mark').count()
  check('match-highlighted', marked >= 1, 'marks=' + marked)
  // 关闭会话内搜索
  await win.locator('#search-close').click()
  await win.waitForTimeout(200)

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

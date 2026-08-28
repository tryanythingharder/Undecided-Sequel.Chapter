// 三项修复验证：孤儿会话自愈 / 标签截断 / 进度条居中
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
  const fails = []
  const check = (name, cond, extra) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails.push(name) }

  // ---- 1. 孤儿会话自愈：ws 指向不存在的工作区 → 自动归入第一个工作区并可见 ----
  await win.evaluate(() => {
    // 模拟用户真实事故现场：工作区列表只有 w1/w2，但会话困在已消失的 w-ghost
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([
      { id: 'w1', name: '默认世界', createdAt: Date.now() },
      { id: 'w2', name: '测试', createdAt: Date.now() }
    ]))
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 'orphan', ws: 'w-ghost', title: '被困的对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [
        { role: 'user', content: '开始', at: Date.now() },
        { role: 'assistant', at: Date.now(), content: '【甲龙历 407.03.01】欢迎。\n【A】启程\n【B】等待' }
      ] },
      { id: 'ok1', ws: 'w1', title: '正常线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始', at: Date.now() }] }
    ]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentWsId: 'w1', preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm' }))
  })
  await win.reload()
  await win.waitForTimeout(2200)
  // 孤儿会话应出现在默认世界（w1）
  const orphanVisible = await win.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.session-item'))
    return items.some((el) => el.dataset.sid === 'orphan')
  })
  check('orphan-session-selfheals-visible', orphanVisible)
  // 自愈后数据层归属正确
  const wsAfter = await win.evaluate(() => {
    const ss = JSON.parse(localStorage.getItem('sixworlds.sessions.v2'))
    return ss.find((x) => x.id === 'orphan').ws
  })
  check('orphan-session-rehomed-to-w1', wsAfter === 'w1', 'ws=' + wsAfter)
  // 点击孤儿会话 → 选项按钮出现（用户的原始症状）
  await win.locator('.session-item[data-sid="orphan"]').click()
  await win.waitForTimeout(500)
  check('orphan-session-shows-choices', (await win.locator('#choices .choice').count()) === 2)

  // ---- 2. 标签截断修复：CANON-H 不再被剥成 CANON- ----
  await win.evaluate(() => {
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
      id: 'lbl', ws: 'w1', title: '标签测试', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [
        { role: 'user', content: '开始', at: Date.now() },
        { role: 'assistant', at: Date.now(), content: '**【正典模式】**\n> A. 文库主线 CANON-L（默认）\n> B. WEB 原典 CANON-W\n> C. 混合模式 CANON-H\n> D. 自定义 CANON-C' }
      ]
    }]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentWsId: 'w1', currentSessionId: 'lbl', preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm' }))
  })
  await win.reload()
  await win.waitForTimeout(2200)
  const labels = await win.locator('#choices .choice').allTextContents()
  check('label-keeps-trailing-letter', labels.length === 4 && labels[2].includes('CANON-H'), JSON.stringify(labels))

  // ---- 3. 进度条居中：节点簇垂直居中（左侧中间开始） ----
  // 造一条多幕会话，收起侧栏，测量节点簇中心 vs 轨道容器中心
  await win.evaluate(() => {
    const msgs = []
    for (let i = 0; i < 6; i++) {
      msgs.push({ role: 'user', content: '行动' + i, at: Date.now() })
      msgs.push({ role: 'assistant', content: '【甲龙历 407.03.0' + (i + 1) + '】第' + i + '幕的叙事内容，发生了一些事情。', at: Date.now() })
    }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{ id: 'rail', ws: 'w1', title: '进度条测试', createdAt: Date.now(), updatedAt: Date.now(), messages: msgs }]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ currentWsId: 'w1', currentSessionId: 'rail', preset: 'custom', baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-x', model: 'm' }))
  })
  await win.reload()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Control+b') // 收起侧栏，进度条出现
  await win.waitForTimeout(600)
  const railPos = await win.evaluate(() => {
    const rail = document.querySelector('.progress-rail')
    if (!rail || getComputedStyle(rail).display === 'none') return null
    const nodes = document.querySelectorAll('.rail-node')
    if (!nodes.length) return { nodeCount: 0 }
    const rr = rail.getBoundingClientRect()
    let top = Infinity, bottom = -Infinity
    nodes.forEach((n) => {
      const r = n.getBoundingClientRect()
      top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom)
    })
    return {
      railTop: rr.top, railBottom: rr.bottom, railCenter: rr.top + rr.height / 2,
      clusterTop: top, clusterBottom: bottom, clusterCenter: (top + bottom) / 2,
      nodeCount: nodes.length
    }
  })
  if (railPos) {
    check('rail-has-nodes', railPos.nodeCount >= 6, 'nodes=' + railPos.nodeCount)
    // 节点簇中心应接近轨道容器中心（±60px 容差）
    const dev = Math.abs(railPos.clusterCenter - railPos.railCenter)
    check('rail-nodes-vertically-centered', dev <= 60, '偏移=' + Math.round(dev) + 'px')
    // 不再贴底：簇底距轨道底应大于 60px（旧行为是紧贴底部）
    const bottomGap = railPos.railBottom - railPos.clusterBottom
    check('rail-not-bottom-anchored', bottomGap > 60, '底距=' + Math.round(bottomGap) + 'px')
    // 也不贴顶（居中而非顶部对齐）
    const topGap = railPos.clusterTop - railPos.railTop
    check('rail-not-top-anchored', topGap > 60, '顶距=' + Math.round(topGap) + 'px')
  } else {
    check('rail-visible-when-collapsed', false, '进度条未显示')
  }
  // 展开回来
  await win.keyboard.press('Control+b')

  await app.close()
  console.log(fails.length === 0 ? 'ALL_PASS' : 'FAILED: ' + fails.join(', '))
  process.exit(fails.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

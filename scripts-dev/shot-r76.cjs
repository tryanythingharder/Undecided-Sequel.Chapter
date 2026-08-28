// R76 落地视觉走查：主界面电影场（双主题）+ 灵动岛 toast + 入场动画预览
const path = require('node:path')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)
const OUT = path.join(__dirname, 'shot-r76')

const STORY = [
  '【甲龙历 407.03.01｜清晨｜布耶纳村】',
  '晨雾还没散尽，村口的石板路泛着露水。你攥了攥肩上洗得发白的行囊带子，洛琪希的背影在雾里若隐若现——她说今天的课在森林那边。',
  '远处传来铁匠铺开门的声响，混着面包房飘来的麦香。这是你在布耶纳村的第三个春天。',
  '【简要状态】\n生命 ▸ 92/100　位置 ▸ 布耶纳村·村口\n持有 ▸ 木剑 / 旅行行囊 / 洛琪希的便条\n同行 ▸ 洛琪希（魔法家庭教师）',
  '「发什么呆呢？」雾里传来轻笑声，「再不走，今天的魔法课就要变成**逃课记录**了哦。」',
  '【你需要决定】',
  '【A】老老实实跟上，路上追问今天的教学内容',
  '【B】先去面包房买两个刚出炉的面包当早饭，再追上去',
  '【C】故意放慢脚步，等她回头来催——逗逗这位老师',
].join('\n')

async function main() {
  require('node:fs').mkdirSync(OUT, { recursive: true })
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1120, height: 700 })
  await win.waitForTimeout(1200)

  // 种子：一条世界线（含场景行/状态面板/选项/插图）+ 一条待删线（触发 toast）
  await win.evaluate((story) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    const illust = (() => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 640, 360)
      grad.addColorStop(0, '#6b5233'); grad.addColorStop(.6, '#2c3a4a'); grad.addColorStop(1, '#14120f')
      g.fillStyle = grad; g.fillRect(0, 0, 640, 360)
      g.fillStyle = 'rgba(255,240,210,.5)'; g.beginPath(); g.arc(480, 90, 42, 0, 7); g.fill()
      return c.toDataURL('image/png')
    })()
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', title: '序幕 · 帷幕未启', createdAt: Date.now(), updatedAt: Date.now(), messages: [
        { role: 'user', content: '开始', at: Date.now() },
        { role: 'assistant', content: story, at: Date.now(), illust },
      ] },
      { id: 't1', title: '待删线', createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'user', content: '开始' }] },
    ]))
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ theme: 'dark' }))
  }, STORY)
  await win.reload()
  await win.waitForTimeout(2200)

  // 1. 主界面 · 深色电影场
  await win.screenshot({ path: path.join(OUT, 'r76-main-dark.png') })

  // 2. 灵动岛 toast：删除一条世界线 → 「已删除」toast
  await win.locator('#session-list .session-item', { hasText: '待删线' }).locator('.session-del').click({ force: true })
  await win.waitForTimeout(400)
  await win.locator('.confirm .danger').click()
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(OUT, 'r76-island-toast.png') })
  await win.waitForTimeout(4200)

  // 3. 主界面 · 浅色（画廊白）
  await win.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    c.theme = 'light'
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  })
  await win.reload()
  await win.waitForTimeout(2000)
  await win.screenshot({ path: path.join(OUT, 'r76-main-light.png') })

  // 4. 入场动画预览（splash-preview 强制显示，截两帧 + 进入后）
  await win.evaluate(() => localStorage.setItem('sixworlds.splash-preview', '1'))
  await win.reload()
  await win.waitForTimeout(1400)
  await win.screenshot({ path: path.join(OUT, 'r76-splash-1.png') })
  await win.waitForTimeout(2600)
  await win.screenshot({ path: path.join(OUT, 'r76-splash-2.png') })
  await win.mouse.click(560, 350) // 点击进入
  await win.waitForTimeout(1000)
  await win.screenshot({ path: path.join(OUT, 'r76-splash-entered.png') })

  await app.close()
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

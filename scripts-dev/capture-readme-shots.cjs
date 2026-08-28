// 为 README 捕获产品截图：入场动画 / 主界面(深) / 主题弹层 / 浅色 / 画廊 / 设置窗
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)

const OUT = path.join(__dirname, '..', 'docs', 'shots')
fs.mkdirSync(OUT, { recursive: true })

// SVG 插图：晨光村庄 / 教堂 / 月夜 / 森林（渐变分层剪影，1200x675）
function svgIllust(variant) {
  const scenes = {
    dawn: { sky: ['#2b1f3a', '#8a4d3f', '#e8a45c'], sun: ['#f5d9a0', '#e8a45c'], moon: false, mist: 'rgba(232,164,92,.25)' },
    church: { sky: ['#1d2740', '#3d5a80', '#98c1d9'], sun: ['#e0fbfc', '#98c1d9'], moon: false, mist: 'rgba(152,193,217,.22)' },
    night: { sky: ['#050510', '#101830', '#27324f'], sun: ['#d8e4ff', '#8fa8d8'], moon: true, mist: 'rgba(143,168,216,.18)' },
    forest: { sky: ['#0d1f12', '#1d4028', '#4a7c59'], sun: ['#c2e8c8', '#7fb069'], moon: false, mist: 'rgba(127,176,105,.20)' }
  }[variant]
  const ridges = [
    { y: 430, f: 'rgba(0,0,0,.35)', amp: 40 },
    { y: 490, f: 'rgba(0,0,0,.55)', amp: 55 },
    { y: 545, f: 'rgba(0,0,0,.8)', amp: 30 }
  ]
  let ridgeSvg = ''
  ridges.forEach((r, i) => {
    let d = 'M0 675 L0 ' + r.y
    for (let x = 0; x <= 1200; x += 100) d += ' Q' + (x + 50) + ' ' + (r.y - r.amp * Math.sin(i + x / 130)) + ' ' + (x + 100) + ' ' + (r.y + 12 * Math.sin(x / 210))
    d += ' L1200 675 Z'
    ridgeSvg += '<path d="' + d + '" fill="' + r.f + '"/>'
  })
  const houses = variant === 'dawn'
    ? '<g fill="rgba(0,0,0,.82)"><rect x="150" y="500" width="70" height="60"/><polygon points="140,500 185,462 230,500"/><rect x="260" y="512" width="55" height="48"/><polygon points="252,512 287,480 322,512"/><rect x="960" y="498" width="80" height="62"/><polygon points="950,498 1000,458 1050,498"/></g><g fill="#f5d9a0" opacity=".85"><rect x="172" y="518" width="12" height="14"/><rect x="278" y="526" width="10" height="12"/><rect x="984" y="516" width="13" height="15"/></g>'
    : variant === 'church'
      ? '<g fill="rgba(0,0,0,.82)"><rect x="520" y="360" width="160" height="240"/><polygon points="500,360 600,270 700,360"/><rect x="585" y="200" width="30" height="160"/><polygon points="575,205 600,165 625,205"/><rect x="300" y="500" width="90" height="100"/><polygon points="290,500 345,452 400,500"/></g><g fill="#e0fbfc" opacity=".9"><path d="M600 480 l22 38 -22 38 -22 -38 Z"/><rect x="594" y="300" width="12" height="18"/></g>'
      : variant === 'night'
        ? '<circle cx="900" cy="170" r="58" fill="#e8eeff"/><circle cx="882" cy="160" r="52" fill="' + scenes.sky[1] + '"/><g fill="rgba(0,0,0,.85)"><rect x="180" y="500" width="64" height="70"/><polygon points="172,500 212,464 252,500"/><rect x="820" y="520" width="58" height="50"/><polygon points="812,520 849,488 886,520"/></g><g fill="#d8e4ff" opacity=".8"><rect x="200" y="516" width="10" height="13"/><rect x="838" y="532" width="9" height="11"/></g>'
        : '<g fill="rgba(0,0,0,.78)"><rect x="140" y="300" width="14" height="260"/><rect x="300" y="260" width="18" height="300"/><rect x="520" y="310" width="13" height="250"/><rect x="760" y="250" width="20" height="310"/><rect x="980" y="320" width="15" height="240"/><ellipse cx="147" cy="290" rx="46" ry="34"/><ellipse cx="309" cy="240" rx="58" ry="42"/><ellipse cx="527" cy="298" rx="44" ry="32"/><ellipse cx="770" cy="228" rx="62" ry="45"/><ellipse cx="988" cy="306" rx="47" ry="34"/></g>'
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">' +
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + scenes.sky[0] + '"/><stop offset=".55" stop-color="' + scenes.sky[1] + '"/><stop offset="1" stop-color="' + scenes.sky[2] + '"/>' +
    '</linearGradient><radialGradient id="glow" cx=".5" cy=".5" r=".5">' +
    '<stop offset="0" stop-color="' + scenes.sun[0] + '"/><stop offset="1" stop-color="' + scenes.sun[1] + '" stop-opacity="0"/>' +
    '</radialGradient></defs>' +
    '<rect width="1200" height="675" fill="url(#sky)"/>' +
    (scenes.moon ? '' : '<circle cx="330" cy="200" r="120" fill="url(#glow)" opacity=".8"/><circle cx="330" cy="200" r="46" fill="' + scenes.sun[0] + '" opacity=".92"/>') +
    ridgeSvg + houses +
    '<rect y="600" width="1200" height="75" fill="' + scenes.mist + '"/></svg>')
}

async function passSplash(w) {
  try { await w.waitForSelector('#splash.ready', { timeout: 20000, state: 'attached' }) } catch { return }
  try { await w.locator('#splash').click({ force: true, timeout: 5000 }) } catch { }
  await w.waitForTimeout(800)
}

async function main() {
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  })
  const win = await app.firstWindow()
  await win.evaluate(() => localStorage.clear())
  await win.reload()
  await win.waitForTimeout(2800)

  // ---- 截图 1：入场动画（展开中段，字与扫光可见）----
  await win.screenshot({ path: path.join(OUT, '01-splash.png') })

  // 种演示数据：一条世界线 8 回合 + 3 插图 + 选项
  await win.evaluate((imgs) => {
    const now = Date.now()
    const mk = (role, content, illust) => { const m = { role, content, at: now - Math.random() * 3e6 }; if (illust) m.illust = illust; return m }
    const sessions = [{
      id: 'demo1', ws: JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1',
      title: '《布耶纳村的清晨》', createdAt: now - 864e5, updatedAt: now - 6e5,
      messages: [
        mk('user', '我出生在布耶纳村的铁匠铺，今年十岁。今天我想去村口的集市看看。'),
        mk('assistant', '【甲龙历 407.03.01｜清晨】\n晨雾还挂在麦田上，铁匠铺的炉火昨夜熄得很晚。你推开木门，带着一身煤灰味走进布耶纳村的集市。\n\n集市长老认出了你：「小家伙，今天集市有外地商队，听说还带来了**北地来的魔法道具**。」\n\n【你需要决定】', imgs[0]),
        mk('user', '【A】凑近商队的摊位，看看那件魔法道具'),
        mk('assistant', '摊主是个裹着灰袍的高个子。他掀开绒布——那是一枚**微微发烫的罗盘**，指针不指北，而指着村子后山的方向。\n\n「识货的话，三个铜币。」他眯起眼。\n\n【你需要决定】\n【A】掏钱买下罗盘\n【B】追问指针为什么指着后山\n【C】摇头离开，去看别的摊位', imgs[1])
      ]
    }, {
      id: 'demo2', ws: sessions_ws(), title: '《月夜的后山》', createdAt: now - 2 * 864e5, updatedAt: now - 9e6,
      messages: [mk('user', '半夜我偷偷溜出家门，往后山走。'), mk('assistant', '【甲龙历 407.03.02｜深夜】\n月亮悬在后山尖上，草叶上全是露水。你听见了那种低语声——和昨晚一样，从林子深处传来。', imgs[2])]
    }]
    function sessions_ws() { return JSON.parse(localStorage.getItem('sixworlds.workspaces.v1') || '[]')[0]?.id || 'w1' }
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify(sessions))
    localStorage.setItem('sixworlds.onboard.v1', '1') // 跳过首启向导/免责声明
    localStorage.setItem('sixworlds.ifhint-seen.v1', '1')
    localStorage.setItem('sixworlds.railhint-seen.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
      preset: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat',
      currentSessionId: 'demo1', theme: 'dark', palette: 'classic', illustAuto: true
    }))
  }, ['dawn', 'church', 'night'].map(svgIllust))
  await win.reload()
  await win.waitForTimeout(600)
  await passSplash(win)
  // 放大窗口到演示尺寸
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center() })
  await win.waitForTimeout(700)
  // 展开侧栏宽度到舒适值
  await win.evaluate(() => { const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}'); c.sbWidth = 240; localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c)) })
  await win.reload(); await win.waitForTimeout(500)
  await passSplash(win)
  // 滚到底 + 多选勾选一颗，展示选项
  await win.evaluate(() => { const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight })
  await win.waitForTimeout(400)

  // ---- 截图 2：主界面（深色 + 叙事 + 选项）----
  await win.screenshot({ path: path.join(OUT, '02-main-dark.png') })

  // ---- 截图 3：主题弹层 ----
  await win.evaluate(() => document.getElementById('btn-theme').click())
  await win.waitForTimeout(450)
  await win.screenshot({ path: path.join(OUT, '03-theme-pop.png') })
  await win.evaluate(() => { const b = document.getElementById('btn-theme-close'); if (b) b.click() })
  await win.waitForTimeout(300)

  // ---- 截图 4：浅色主题（羊皮纸调色板）----
  await win.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    c.theme = 'light'; c.palette = 'paper'; localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  })
  await win.reload(); await win.waitForTimeout(500)
  await passSplash(win)
  await win.evaluate(() => { const m = document.getElementById('messages'); if (m) m.scrollTop = m.scrollHeight })
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(OUT, '04-light-paper.png') })

  // ---- 截图 5：画廊（切回深色经典）----
  await win.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
    c.theme = 'dark'; c.palette = 'classic'; localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify(c))
  })
  await win.reload(); await win.waitForTimeout(500)
  await passSplash(win)
  await win.evaluate(() => document.getElementById('btn-gallery').click())
  await win.waitForTimeout(1400)
  await win.screenshot({ path: path.join(OUT, '05-gallery.png') })
  await win.evaluate(() => document.getElementById('btn-gallery-close').click())
  await win.waitForTimeout(500)

  // ---- 截图 6：设置窗口（独立系统窗口）----
  await win.evaluate(() => document.getElementById('btn-settings').click())
  await win.waitForTimeout(1200)
  const pages = app.windows()
  let shot = false
  for (const p of pages) {
    const u = p.url()
    if (u && u.includes('settings.html')) {
      await app.evaluate(({ BrowserWindow }) => {
        const list = BrowserWindow.getAllWindows()
        const s = list.find((x) => x.getTitle() !== '' && list.indexOf(x) > 0)
        if (s) { s.setSize(760, 640); s.center() }
      })
      await p.waitForTimeout(600)
      await p.screenshot({ path: path.join(OUT, '06-settings.png') })
      shot = true
      break
    }
  }
  console.log(shot ? 'settings shot OK' : 'settings window NOT FOUND')

  await app.close()
  console.log('DONE ->', OUT)
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })

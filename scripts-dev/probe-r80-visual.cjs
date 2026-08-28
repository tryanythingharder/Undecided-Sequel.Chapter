// R80 视觉探针：截图画廊 + 设置窗口真实渲染，供人工对照 Finalize Design 原型
const path = require('node:path')
const fs = require('node:fs')
const PLAYWRIGHT = 'C:\\Users\\Administrator\\AppData\\Local\\npm-cache\\_npx\\31e32ef8478fbf80\\node_modules\\playwright'
const { _electron: electron } = require(PLAYWRIGHT)
const OUT = path.join(__dirname, '..', 'test-shots')

// 4:3→16:9 占位插图（内联 SVG data URL，模拟小说插画构图感）
const svg = (c1, c2, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>` +
  `<rect width="640" height="360" fill="url(#g)"/>` +
  `<circle cx="500" cy="90" r="46" fill="#fff3d6" opacity=".85"/>` +
  `<rect y="260" width="640" height="100" fill="#00000022"/>` +
  `<text x="24" y="330" font-family="Consolas" font-size="20" fill="#ffffffcc">${label}</text></svg>`
)

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const app = await electron.launch({
    executablePath: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'], cwd: path.join(__dirname, '..'), env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_TEST: '1' }
  })
  const win = await app.firstWindow()
  await win.waitForTimeout(1200)
  await win.setViewportSize({ width: 1120, height: 760 })

  await win.evaluate((svgs) => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ preset: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-demo-key-000000000000', model: 'deepseek-chat' }))
    const now = Date.now()
    const mkMsg = (role, content, illust) => Object.assign({ role, content }, illust ? { illust: illust, illustPending: false } : {})
    const msgs = [
      mkMsg('user', '开始'),
      mkMsg('assistant', '【甲龙历 407.03.01｜清晨｜布耶纳村】\n薄雾笼罩的清晨，有人敲响了你的家门。一位灰袍旅人向你问路，他的斗篷下露出一截做工精细的法杖。\n\n【A】为他指路并闲聊（获得情报）【B】闭门不开 C. 跟随他', svgs[0]),
      mkMsg('user', '【A】为他指路并闲聊（获得情报）'),
      mkMsg('assistant', '旅人道谢后欲言又止。他压低声音：「村里的水井三天前开始泛出微光……我不便出面调查。」\n\n【A】答应去查看水井 【B】追问法杖的来历 【C】婉拒后独自出发', svgs[1]),
      mkMsg('user', '【A】答应去查看水井'),
      mkMsg('assistant', '水井边缘结着一层细密冰纹，井底深处有幽蓝的呼吸般的光——那不是反光，是某种存在。',
        svgs[2])
    ]
    localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([
      { id: 's1', ws: 'w1', title: '布耶纳村的少年', createdAt: now - 86400000, updatedAt: now, messages: msgs },
      { id: 's2', ws: 'w1', title: '王都的异乡人', createdAt: now - 172800000, updatedAt: now - 86400000, messages: [mkMsg('user', '开始'), mkMsg('assistant', '王都的酒馆里流传着六面魔方塔的传闻。\n\n【A】听取传闻 【B】买单离开')] },
      { id: 's3', ws: 'w2', title: '篝火之夜 · IF 分歧线', createdAt: now - 200000000, updatedAt: now - 100000000, messages: msgs.slice(0, 2) }
    ]))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([
      { id: 'w1', name: '默认世界', createdAt: now },
      { id: 'w2', name: '异世界线', createdAt: now }
    ]))
  }, [svg('#3d5a80', '#98c1d9', 'ROUND 04 · 村口水井'), svg('#6d597a', '#b56576', 'ROUND 02 · 灰袍旅人'), svg('#2f4858', '#86bbd8', 'ROUND 03 · 出发前夜')])
  await win.reload()
  await win.waitForTimeout(1800)

  // ---- 画廊 ----
  await win.evaluate(() => document.getElementById('btn-gallery').click())
  await win.waitForTimeout(900)
  await win.screenshot({ path: path.join(OUT, 'r80-gallery-dark.png') })

  // 结构事实收集
  const facts = await win.evaluate(() => {
    const g = document.getElementById('gallery')
    const head = g.querySelector('.gallery-head')
    const toolbar = g.querySelector('.gallery-toolbar')
    return {
      galleryWidth: Math.round(g.getBoundingClientRect().width),
      cardW: Math.round(g.querySelector('.gallery-card')?.getBoundingClientRect().width || 0),
      cardsPerRow: (() => { const gs = getComputedStyle(g.querySelector('.gallery-body')).gridTemplateColumns.split(' ').length; return gs })(),
      headOrder: [...head.querySelectorAll(':scope>*,button')].map((e) => e.className.split(' ')[0]).filter(Boolean),
      toolbarText: toolbar.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)
    }
  })
  console.log('GALLERY_FACTS ' + JSON.stringify(facts))

  // 浅色
  await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
  await win.waitForTimeout(350)
  await win.screenshot({ path: path.join(OUT, 'r80-gallery-light.png') })
  await win.evaluate(() => document.getElementById('btn-gallery-close').click())
  await win.waitForTimeout(400)

  // ---- 设置窗口 ----
  await win.evaluate(() => window.api.openSettings ? window.api.openSettings() : null).catch(() => {})
  let sw = null
  for (let i = 0; i < 30 && !sw; i++) {
    sw = app.windows().find((w) => w.url().includes('settings.html')) || null
    if (!sw) await win.waitForTimeout(150)
  }
  if (!sw) { console.log('SETTINGS_WINDOW_NOT_FOUND'); }
  else {
    await sw.setViewportSize({ width: 560, height: 700 })
    await sw.waitForTimeout(700)
    const sf = await sw.evaluate(() => {
      const tabs = document.querySelector('.modal-tabs')
      const tabRect = tabs.getBoundingClientRect()
      const sel = document.getElementById('set-preset')
      const body = document.querySelector('.modal-body')
      return {
        winInner: innerWidth + 'x' + innerHeight,
        tabsGeom: Math.round(tabRect.x) + ',' + Math.round(tabRect.y) + ' ' + Math.round(tabRect.width) + 'x' + Math.round(tabRect.height),
        tabsJustify: getComputedStyle(tabs).justifyContent,
        presetOptions: [...sel.options].map((o) => o.value).join('|'),
        panelPadL: getComputedStyle(body).paddingLeft,
        labelStyle: (() => { const l = document.querySelector('.set-group label'); const cs = getComputedStyle(l); return cs.fontSize + '/' + cs.color })()
      }
    })
    console.log('SETTINGS_FACTS ' + JSON.stringify(sf))
    await sw.screenshot({ path: path.join(OUT, 'r80-settings-text.png') })
    await sw.evaluate(() => document.querySelector('.tab[data-tab="image"]').click())
    await sw.waitForTimeout(300)
    await sw.screenshot({ path: path.join(OUT, 'r80-settings-image.png') })
  }

  console.log('DONE screenshots in test-shots/')
  await app.close()
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

// R70 结构重构验证:新 Composer 分组/空态快启/画廊抽屉/帮助双Tab/模型芯片位置
const PLAYWRIGHT = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright'
const { chromium } = require(PLAYWRIGHT)
const PORT = process.argv[2] || '9335'
const OUT = 'D:\\代码\\测试\\无职转生\\test-shots\\audit'

async function main() {
  let browser = null
  for (let i = 0; i < 40 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT) } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  if (!browser) throw new Error('CDP connect failed')
  let win = null
  for (let i = 0; i < 40 && !win; i++) {
    for (const ctx of browser.contexts()) { const p = ctx.pages().find((x) => x.url().includes('index.html')); if (p) win = p }
    if (!win) await new Promise((r) => setTimeout(r, 250))
  }
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('sixworlds.onboard.v1', '1')
    localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({ baseUrl: 'http://127.0.0.1:4599', apiKey: 'sk-mock', model: 'mock-chat' }))
    localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: 'w1', name: '默认世界', createdAt: Date.now() }]))
  })
  await win.reload()
  await win.waitForTimeout(1500)

  const results = []
  const check = (name, pass, detail) => { results.push({ name, pass } ); console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ' + (detail || '')) }

  // 1) 空态快启:4 个出身 chips 存在且可点
  const quick = await win.evaluate(() => ({
    chips: document.querySelectorAll('.empty-quick-chip').length,
    btn: !!document.querySelector('.empty .primary'),
  }))
  check('empty-quick-chips', quick.chips === 4, 'chips=' + quick.chips)
  await win.screenshot({ path: OUT + '\\r70-01-empty-quick.png' })

  // 1b) 点出身 chip → 输入框预填
  await win.locator('.empty-quick-chip').first().click()
  await win.waitForTimeout(300)
  const filled = await win.evaluate(() => document.getElementById('input').value.length > 0)
  check('quick-chip-fills-input', filled)

  // 2) Composer 分组:config 簇含模型选择器,hint;actions 簇含灵感+发送
  const composer = await win.evaluate(() => {
    const cfg = document.querySelector('.composer-config')
    const act = document.querySelector('.composer-actions')
    return {
      hasConfig: !!cfg, hasActions: !!act,
      configHasModel: !!(cfg && cfg.querySelector('#sel-model')),
      configHasThink: !!(cfg && cfg.querySelector('#sel-think')),
      configHasHint: !!(cfg && cfg.querySelector('#hint')),
      configHasChip: !!(cfg && cfg.querySelector('#chip-text-model')),
      actionsHasSend: !!(act && act.querySelector('#btn-send')),
      actionsHasInspire: !!(act && act.querySelector('#btn-inspire')),
      configBeforeActions: !!(cfg && act && cfg.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING),
    }
  })
  check('composer-config-cluster', composer.hasConfig && composer.configHasModel && composer.configHasThink && composer.configHasHint && composer.configHasChip, JSON.stringify(composer))
  check('composer-actions-cluster', composer.hasActions && composer.actionsHasSend && composer.actionsHasInspire)
  check('config-left-actions-right', composer.configBeforeActions)

  // 3) 对话头不再有模型芯片(只留状态)
  const header = await win.evaluate(() => {
    const h = document.querySelector('.chat-head-right')
    return { hasChip: !!(h && h.querySelector('#chip-text-model')), hasStatus: !!(h && h.querySelector('#chat-status')) }
  })
  check('header-clean', !header.hasChip && header.hasStatus, JSON.stringify(header))

  // 4) 画廊抽屉:右贴边、宽 520（Finalize Design 玻璃抽屉）、非全屏
  await win.locator('#btn-gallery').click()
  await win.waitForTimeout(600)
  const gallery = await win.evaluate(() => {
    const g = document.getElementById('gallery')
    const r = g.getBoundingClientRect()
    const cs = getComputedStyle(g)
    return { right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), winW: window.innerWidth, anim: cs.animationName }
  })
  check('gallery-drawer-right-anchored', gallery.right === gallery.winW, JSON.stringify(gallery))
  check('gallery-drawer-width', gallery.w >= 500 && gallery.w <= 524, 'w=' + gallery.w)
  check('gallery-drawer-anim', gallery.anim === 'drawerin', gallery.anim)
  await win.screenshot({ path: OUT + '\\r70-02-gallery-drawer.png' })
  await win.locator('#btn-gallery-close').click()
  await win.waitForTimeout(400)

  // 5) 帮助面板双 Tab:? 按钮 → 怎么玩页;Ctrl+/ → 快捷键页;Tab 可切换
  await win.locator('#btn-help').click()
  await win.waitForTimeout(500)
  const help1 = await win.evaluate(() => ({
    visible: !document.getElementById('guide').hidden,
    playActive: document.getElementById('help-tab-play').classList.contains('active'),
    playVisible: !document.getElementById('guide-play').classList.contains('hidden'),
    keysHidden: document.getElementById('guide-keys').classList.contains('hidden'),
  }))
  check('help-default-play-tab', help1.visible && help1.playActive && help1.playVisible && help1.keysHidden, JSON.stringify(help1))
  await win.screenshot({ path: OUT + '\\r70-03-help-play.png' })
  await win.locator('#help-tab-keys').click()
  await win.waitForTimeout(300)
  const help2 = await win.evaluate(() => ({
    keysActive: document.getElementById('help-tab-keys').classList.contains('active'),
    keysVisible: !document.getElementById('guide-keys').classList.contains('hidden'),
    playHidden: document.getElementById('guide-play').classList.contains('hidden'),
  }))
  check('help-tab-switch', help2.keysActive && help2.keysVisible && help2.playHidden, JSON.stringify(help2))
  await win.screenshot({ path: OUT + '\\r70-04-help-keys.png' })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  // Ctrl+/ 直达快捷键页
  await win.keyboard.press('Control+/')
  await win.waitForTimeout(400)
  const help3 = await win.evaluate(() => ({
    visible: !document.getElementById('guide').hidden,
    keysActive: document.getElementById('help-tab-keys').classList.contains('active'),
  }))
  check('ctrl-slash-opens-keys', help3.visible && help3.keysActive, JSON.stringify(help3))
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)

  const fails = results.filter((r) => !r.pass).length
  console.log(fails ? 'AUDIT ' + fails + ' failed' : 'AUDIT ALL PASS')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.log('ERROR ' + e.message); process.exit(1) })

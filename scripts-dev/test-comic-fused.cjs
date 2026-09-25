'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const ROOT = path.resolve(__dirname, '..')
const OUT = process.env.SIXWORLDS_TEST_OUTPUT_DIR ? path.resolve(process.env.SIXWORLDS_TEST_OUTPUT_DIR) : path.join(ROOT, 'output', 'comic-fused')
const scheme = process.argv[2] || process.env.SIXWORLDS_UI_SCHEME || 'classic'
async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-fused-'))
  const env = { ...process.env, SIXWORLDS_TEST: '1', SIXWORLDS_UI_SCHEME: scheme }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${profile}`], cwd: ROOT, env })
  try {
    const win = await app.firstWindow()
    win.setDefaultTimeout(5000)
    await win.goto('about:blank')
    await win.setViewportSize({ width: 1000, height: 900 })
    await win.evaluate(({ source, styles }) => {
      document.head.innerHTML = '<meta charset="utf-8">'
      styles.forEach(css => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s) })
      document.body.innerHTML = ''
      ;(0, eval)(source)
      window.__session = { id: 'fused-test', title: '整页链路测试（合成图片，不是真实生图）' }
      window.__requests = []; window.__exports = []; window.__toasts = []
      window.__turn = 2
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1344"><rect width="768" height="1344" fill="white"/><path d="M24 24H340L310 370H24Z M360 24H744V370H330Z M24 394H744V1090H24Z M24 1114H744V1320H24Z" fill="#bbb" stroke="black" stroke-width="5"/><ellipse cx="160" cy="110" rx="95" ry="45" fill="white"/><text x="100" y="120" font-size="22">TEST PAGE</text><text x="60" y="720" font-size="30">ONE IMAGE / MOCK ONLY</text></svg>'
      window.__image = 'data:image/svg+xml;base64,' + btoa(svg)
      const plan = turn => ({ cast: [{ name: '旅人', look: turn === 2 ? '黑发，灰色披风' : '红发，金色铠甲' }], panels: [{ fullPage: true, turn, title: '完整漫画页 ' + turn, narration: '翻越山谷后遭遇守卫', composition: 'Exactly 2 panels: beat 1 in a shallow upper panel, beat 2 in a dominant lower panel.', participants: ['旅人'], sceneLine: '山谷', beats: [
        { turn, description: '旅人在山谷入口停步', size: 'square', dialogue: [{ speaker: '旅人', line: '终于到了。', tone: 'normal' }] },
        { turn, description: '守卫举起长矛阻挡旅人', size: 'hero', dialogue: [{ speaker: '守卫', line: '站住！', tone: 'shout' }] }
      ] }] })
      window.__reader = window.ComicPanel.createComicPanel({
        api: {
          engineComicSource: async () => ({ ok: true, data: { turns: [{ turn: window.__turn, summary: '山谷遇见守卫' }], cast: [] } }),
          petAgent: async req => { window.__planning = req; return { ok: true, plan: plan(window.__turn) } },
          generateImage: async req => { window.__requests.push(req); return { ok: true, dataUrl: window.__image } },
          saveFile: async req => { window.__exports.push(req); return { ok: true } },
          notify: () => {}
        },
        cfg: () => ({ illustSize: '1344x768', illustNegative: 'text, speech bubbles' }),
        $: id => document.getElementById(id), curSession: () => window.__session,
        saveSessions: () => {}, confirmDialog: async () => true,
        toast: text => window.__toasts.push(text), stylePrompt: () => ''
      })
    }, { source: fs.readFileSync(path.join(ROOT, 'ui/shared/comic-panel.js'), 'utf8'), styles: ['ui/' + scheme + '/styles.css', 'ui/shared/works.css'].map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')) })
    await win.evaluate(() => window.__reader.planAndRun({ fromTurn: 1, toTurn: 2 }))
    await win.waitForFunction(() => window.__session.comic?.progress.state === 'done')
    const requests = await win.evaluate(() => window.__requests)
    assert.equal(requests.length, 1, 'Two beats must generate exactly one page image')
    assert.equal(requests[0].n, 1)
    assert.equal(requests[0].size, '768x1344')
    assert.equal(requests[0].negative, '', 'Image text must not be forbidden by global negative prompt')
    for (const text of ['ONE finished portrait manga PAGE', '终于到了。', '站住！', '旅人在山谷入口停步', '守卫举起长矛阻挡旅人']) assert.ok(requests[0].prompt.includes(text), text)
    assert.ok(!requests[0].prompt.includes('absolutely no text'))
    for (const text of ['exactly 2 story panels', 'Character design bible', 'wood grain', 'action axis', 'Only dialogue.line and caption are printable text']) assert.ok(requests[0].prompt.includes(text), text)
    const script = JSON.parse(requests[0].prompt.split('Ordered page script: ')[1])
    assert.deepEqual(script.map(b => b.order), [1, 2])
    assert.deepEqual(script.map(b => b.image), ['旅人在山谷入口停步', '守卫举起长矛阻挡旅人'])
    assert.ok(requests[0].prompt.includes('Exactly 2 panels: beat 1'))
    assert.equal(await win.evaluate(() => window.__planning.pageCount), 4)
    console.log('PASS one image request contains the entire page script, dialogue and portrait size')
    await win.evaluate(() => window.__reader.openView())
    await win.waitForFunction(() => document.querySelector('.comic-full-page img')?.complete)
    assert.equal(await win.locator('.comic-paper').count(), 1)
    assert.equal(await win.locator('.comic-cell').count(), 1)
    assert.equal(await win.locator('.comic-img').count(), 1)
    assert.equal(await win.locator('.comic-lettering,.comic-bubble,.comic-caption,.comic-ink-outline').count(), 0)
    const geometry = await win.locator('.comic-full-page img').evaluate(el => {
      const p = el.closest('.comic-paper').getBoundingClientRect(), r = el.getBoundingClientRect()
      return { fit: getComputedStyle(el).objectFit, bottom: p.bottom, viewport: innerHeight, width: p.width, height: p.height, imageWidth: r.width, imageHeight: r.height }
    })
    assert.equal(geometry.fit, 'contain')
    assert.ok(geometry.bottom <= geometry.viewport + 1, JSON.stringify(geometry))
    assert.ok(Math.abs(geometry.width / geometry.height - 768 / 1344) < .01)
    assert.equal(await win.locator('.comic-img').getAttribute('src'), await win.evaluate(() => window.__image))
    await win.screenshot({ path: path.join(OUT, scheme + '-page.png') })
    console.log('PASS reader preserves a single uncropped page image with no CSS panels or lettering')
    await win.locator('.comic-view-export').click()
    await win.waitForFunction(() => window.__exports.length === 1)
    const html = await win.evaluate(() => window.__exports[0].content)
    fs.writeFileSync(path.join(OUT, scheme + '-export.html'), html)
    await win.evaluate(() => { window.__reader.closeView(); window.__turn = 3 })
    await win.locator('#comic-view').waitFor({ state: 'detached' })
    await win.evaluate(() => window.__reader.planAndRun({ fromTurn: 3, toTurn: 3, resume: true }))
    await win.waitForFunction(() => window.__session.comic.progress.state === 'done' && window.__requests.length === 2)
    assert.deepEqual(await win.evaluate(() => window.__session.comic.panels.map(p => p.turn)), [2, 3])
    assert.equal(await win.evaluate(() => window.__session.comic.cast[0].look), '黑发，灰色披风')
    assert.ok((await win.evaluate(() => window.__planning.castText)).includes('黑发，灰色披风'))
    const continuedPrompt = await win.evaluate(() => window.__requests[1].prompt)
    assert.ok(continuedPrompt.includes('黑发，灰色披风'))
    assert.ok(!continuedPrompt.includes('红发，金色铠甲'))
    await win.evaluate(() => window.__reader.runQueue())
    assert.equal(await win.evaluate(() => window.__requests.length), 2, 'Completed pages must not regenerate on resume')
    await win.evaluate(() => window.__reader.openView())
    await win.locator('#comic-mode-scroll').click()
    assert.equal(await win.locator('.comic-scroll-section').count(), 2)
    assert.equal(await win.locator('.comic-full-page img').count(), 2)
    assert.equal(await win.locator('.comic-bubble,.comic-caption').count(), 0)
    const stage = await win.locator('.comic-stage').boundingBox()
    await win.keyboard.press('Home')
    await win.mouse.move(stage.x + stage.width / 2, stage.y + 150)
    await win.mouse.wheel(0, 350)
    await win.waitForFunction(() => document.querySelector('.comic-stage').scrollTop > 100)
    console.log('PASS continuation appends one full page, skips finished images and scrolls whole pages')
    await win.goto('about:blank')
    await win.setContent(html, { waitUntil: 'load' })
    assert.equal(await win.locator('.page').count(), 1)
    assert.equal(await win.locator('.page img').count(), 1)
    assert.equal(await win.locator('.comic-lettering,.comic-bubble,.comic-caption,.comic-ink-outline').count(), 0)
    await win.locator('#mb-paged').click()
    assert.equal(await win.locator('.page:visible').count(), 1)
    await win.emulateMedia({ media: 'print' })
    assert.equal(await win.locator('.page img:visible').count(), 1)
    console.log('PASS HTML export preserves one fused image without duplicate lettering, including print')
    console.log('ALL_PASS fused page integration ' + scheme)
  } finally {
    const child = app.process()
    const timeout = setTimeout(() => { if (child.exitCode == null) child.kill() }, 8000)
    try { await app.close() } catch {} finally { clearTimeout(timeout) }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })

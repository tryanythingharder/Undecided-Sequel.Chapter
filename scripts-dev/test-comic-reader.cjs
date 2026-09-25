#!/usr/bin/env node
'use strict'
// Standalone: node scripts-dev/test-comic-reader.cjs [classic|proto]
// Also accepts SIXWORLDS_UI_SCHEME. Only the shared factory + real styles run in
// the test renderer; no app globals, model calls, persistent sessions or source assertions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const ROOT = path.resolve(__dirname, '..')
const OUT = process.env.SIXWORLDS_TEST_OUTPUT_DIR ? path.resolve(process.env.SIXWORLDS_TEST_OUTPUT_DIR) : path.join(ROOT, 'output', 'comic-reader')
const scheme = process.argv[2] || process.env.SIXWORLDS_UI_SCHEME || 'classic'
assert.ok(['classic', 'proto'].includes(scheme), 'Expected classic or proto')
const failures = []
let passed = 0

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS [${scheme}] ${name}`)
  } catch (err) {
    failures.push({ name, error: err.stack || String(err) })
    console.error(`FAIL [${scheme}] ${name}: ${err.message}`)
  }
}
async function poll(read, accept, label, timeout = 4000) {
  const until = Date.now() + timeout
  let value
  do {
    value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (Date.now() < until)
  assert.fail(`${label}: ${JSON.stringify(value)}`)
}
async function frames(win) {
  await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
}
async function imagesReady(win, selector) {
  await win.waitForFunction(sel => {
    const imgs = [...document.querySelectorAll(sel)]
    return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0)
  }, selector)
  await frames(win)
}
async function stageState(win) {
  return win.evaluate(() => {
    const s = document.querySelector('.comic-stage')
    return { top: s.scrollTop, height: s.clientHeight, total: s.scrollHeight,
      page: document.querySelector('.comic-sidebar-count').textContent.trim(),
      active: [...document.querySelectorAll('.comic-list-row')].findIndex(r => r.classList.contains('on')) + 1 }
  })
}
async function atPage(win, page) {
  return poll(() => stageState(win), s => s.page === `${page} / 3` && s.active === page, `page/sidebar should both be ${page}`)
}
async function home(win) {
  await win.keyboard.press('Home')
  await poll(() => stageState(win), s => s.top < 2 && s.active === 1, 'Home should reset scroll position')
}
async function scrollMode(win) {
  await win.locator('#comic-mode-scroll').click()
  await imagesReady(win, '.comic-stage img')
}
async function checkLayout(win) {
  const g = await win.evaluate(() => {
    const stage = document.querySelector('.comic-stage')
    const r = stage.getBoundingClientRect()
    const toolbar = document.querySelector('.comic-reader-toolbar').getBoundingClientRect()
    const sections = [...stage.querySelectorAll('.comic-scroll-section')]
    const cells = sections.flatMap(s => [...s.querySelectorAll('.comic-cell')])
    const rect = el => { const b = el.getBoundingClientRect(); return { x: b.x, top: b.top, bottom: b.bottom, width: b.width, height: b.height } }
    const nested = [...stage.querySelectorAll('*')].filter(el => {
      const cs = getComputedStyle(el)
      return (/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) ||
        (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2)
    }).map(el => el.className)
    return { stage: rect(stage), viewport: { w: innerWidth, h: innerHeight }, toolbarBottom: toolbar.bottom,
      overflow: getComputedStyle(stage).overflowY, total: stage.scrollHeight, client: stage.clientHeight,
      horizontal: stage.scrollWidth - stage.clientWidth, nested,
      documentOverflow: document.documentElement.scrollHeight - innerHeight,
      sections: sections.map(s => ({ page: s.dataset.pageNo, count: s.querySelectorAll('.comic-cell').length })),
      cells: cells.map(rect),
      papers: [...stage.querySelectorAll('.comic-paper')].map(p => {
        const pr = p.getBoundingClientRect()
        return { width: pr.width, height: pr.height, cells: [...p.querySelectorAll('.comic-cell')].map(c => {
          const cr = c.getBoundingClientRect()
          return { x: cr.left - pr.left, y: cr.top - pr.top, width: cr.width, height: cr.height }
        }) }
      }),
      bottom: r.bottom, right: r.right }
  })
  assert.deepEqual(g.sections, [3, 5, 4].map((count, i) => ({ page: String(i + 1), count })))
  assert.ok(g.stage.height > 200 && g.bottom <= g.viewport.h + 2 && g.stage.top >= g.toolbarBottom - 2, JSON.stringify(g.stage))
  assert.ok(g.stage.x >= -1 && g.right <= g.viewport.w + 2)
  assert.ok(g.total > g.client && /auto|scroll/.test(g.overflow), 'Stage must be a constrained scroll viewport')
  assert.ok(g.horizontal <= 2 && g.documentOverflow <= 2, 'No horizontal/body scrolling')
  assert.deepEqual(g.nested, [], 'Stage descendants must not have nested scrollbars')
  assert.equal(g.cells.length, 12)
  assert.equal(g.papers.length, 3)
  g.papers.forEach(p => {
    assert.ok(Math.abs(p.width / p.height - .70) < .02, 'Paper must keep its complete-page ratio')
    p.cells.forEach((c, i) => {
      assert.ok(c.width > 40 && c.height > 40, 'Panel must have usable dimensions')
      assert.ok(c.x >= -2 && c.y >= -2 && c.x + c.width <= p.width + 2 && c.y + c.height <= p.height + 2, 'Panel must stay within paper')
      p.cells.slice(0, i).forEach(b => assert.ok(
        Math.min(c.x + c.width, b.x + b.width) - Math.max(c.x, b.x) <= 2 ||
        Math.min(c.y + c.height, b.y + b.height) - Math.max(c.y, b.y) <= 2, 'Panel rectangles must not overlap'))
    })
  })
  assert.ok(new Set(g.papers.flatMap(p => p.cells.map(c => Math.round(c.width / p.width * 100)))).size > 2, 'Panel widths must vary')
}
async function toolbarLayout(win) {
  const g = await win.evaluate(() => {
    const selectors = ['#comic-mode-paged', '#comic-mode-scroll', '.comic-view-continue', '.comic-view-export', '.comic-view-close']
    return { width: innerWidth, height: innerHeight, buttons: selectors.map(sel => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { sel, x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height, reachable: el === hit || el.contains(hit) }
    }) }
  })
  assert.equal(g.width, 600, 'Narrow viewport must actually be 600 CSS pixels')
  for (const [i, b] of g.buttons.entries()) {
    assert.ok(b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.right <= g.width && b.bottom <= g.height && b.reachable, JSON.stringify(b))
    for (const a of g.buttons.slice(0, i)) {
      assert.ok(Math.min(a.right, b.right) - Math.max(a.x, b.x) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) <= 1, `${a.sel} overlaps ${b.sel}`)
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sixworlds-comic-reader-'))
  let app
  try {
    const env = { ...process.env, SIXWORLDS_TEST: '1', SIXWORLDS_UI_SCHEME: scheme, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${profile}`], cwd: ROOT, env })
    const win = await app.firstWindow()
    win.setDefaultTimeout(5000)
    // A fresh document removes the application's listeners and asynchronous UI.
    // Keep the real Electron renderer, but load only the code/styles under test.
    await win.goto('about:blank')
    await win.setViewportSize({ width: 1280, height: 900 })
    const errors = []
    win.on('pageerror', err => errors.push(err.message))
    const mountReader = ({ source, styles }) => {
      document.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      for (const css of styles) {
        const style = document.createElement('style')
        style.textContent = css
        document.head.appendChild(style)
      }
      document.body.innerHTML = ''
      try { localStorage.removeItem('sixworlds.comic.readMode') } catch {}
      ;(0, eval)(source)
      const dimensions = [[1200, 600], [600, 1100], [800, 800], [1400, 700], [700, 1000], [1000, 650]]
      window.__session = { id: 'comic-reader-regression', title: '漫画阅读回归 · Synthetic world', comic: {
        version: 1, panels: Array.from({ length: 12 }, (_, i) => {
          const [w, h] = dimensions[i % dimensions.length]
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="hsl(${i * 31},35%,28%)"/><path d="M0 ${h} L${w / 2} ${h / 4} L${w} ${h}" fill="hsl(${i * 31},40%,45%)"/><circle cx="${w / 2}" cy="${h / 3}" r="${Math.min(w, h) / 9}" fill="#eedcab"/><text x="30" y="70" fill="white" font-size="40">Panel ${i + 1} / ${w} x ${h}</text></svg>`
          return { idx: i, turn: i + 1, title: `分镜 ${i + 1}`, size: ['square', 'square', 'hero', 'wide', 'tall', 'square'][i % 6], pageBreak: [0, 3, 8].includes(i),
            sceneLine: `测试场景 ${Math.floor(i / 4) + 1}`, narration: `第 ${i + 1} 幕：穿过山谷，继续旅程。`,
            dialogue: [{ speaker: '旅人', line: `这是第 ${i + 1} 幕。`, tone: 'normal' }],
            illust: 'data:image/svg+xml;base64,' + btoa(svg) }
        })
      } }
      window.__exports = []
      window.__reader = window.ComicPanel.createComicPanel({
        api: { saveFile: async payload => { window.__exports.push(payload); return { ok: true, path: 'captured-by-test.html' } } },
        cfg: () => ({}), $: id => document.getElementById(id), curSession: () => window.__session,
        saveSessions: () => {}, confirmDialog: async () => false, toast: () => {}, stylePrompt: () => ''
      })
      window.__reader.openView()
    }
    const readerAssets = { source: fs.readFileSync(path.join(ROOT, 'ui', 'shared', 'comic-panel.js'), 'utf8'),
      styles: [fs.readFileSync(path.join(ROOT, 'ui', scheme, 'styles.css'), 'utf8'), fs.readFileSync(path.join(ROOT, 'ui', 'shared', 'works.css'), 'utf8')] }
    // Reproducible standalone visual fixture uses exactly the same bootstrap,
    // real source and real CSS as the automated renderer (not serialized DOM).
    const fixtureAssets = JSON.stringify(readerAssets).replace(/</g, '\\u003c')
    fs.writeFileSync(path.join(OUT, `${scheme}-fixture.html`), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script>(' + mountReader.toString() + ')(' + fixtureAssets + ');</script></body></html>')
    await win.evaluate(mountReader, readerAssets)
    await imagesReady(win, '.comic-stage img')

    await test('paged reader starts at latest completed page (3), four panels', async () => {
      await atPage(win, 3)
      assert.equal(await win.locator('.comic-page[data-page-no="3"] .comic-cell').count(), 4)
    })
    await test('third page paged -> scroll retains actual position and sidebar', async () => {
      await scrollMode(win)
      await atPage(win, 3)
      const g = await win.evaluate(() => {
        const stage = document.querySelector('.comic-stage'), section = document.querySelector('.comic-scroll-section[data-page-no="3"]')
        return { top: stage.scrollTop, offset: section ? section.getBoundingClientRect().top - stage.getBoundingClientRect().top : null }
      })
      assert.ok(g.top > 0 && g.offset >= -2 && g.offset <= 120, JSON.stringify(g))
    })
    await test('desktop constrained stage, variable complete pages, no nested scrollbar', () => checkLayout(win))
    await test('real mouse wheel scrolls stage without moving toolbar', async () => {
      await home(win)
      const before = await stageState(win)
      const toolbar = await win.locator('.comic-reader-toolbar').boundingBox()
      const box = await win.locator('.comic-stage').boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + Math.min(200, box.height / 2))
      await win.mouse.wheel(0, 420)
      const after = await poll(() => stageState(win), s => s.top > before.top + 100, 'Wheel must change stage.scrollTop')
      assert.ok(after.top < before.height, JSON.stringify(after))
      assert.deepEqual(await win.locator('.comic-reader-toolbar').boundingBox(), toolbar)
    })
    await test('wheel crossing a section updates page/sidebar to page 2', async () => {
      await home(win)
      const delta = await win.evaluate(() => {
        const s = document.querySelector('.comic-stage'), p = document.querySelectorAll('.comic-scroll-section')[1]
        return p.getBoundingClientRect().top - s.getBoundingClientRect().top + 30
      })
      const box = await win.locator('.comic-stage').boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + 200)
      await win.mouse.wheel(0, delta)
      await atPage(win, 2)
    })
    await test('scroll -> paged retains current page 2', async () => {
      await win.locator('.comic-list-row').nth(1).click()
      await atPage(win, 2)
      await win.locator('#comic-mode-paged').click()
      await atPage(win, 2)
      assert.equal(await win.locator('.comic-page[data-page-no="2"] .comic-cell').count(), 5)
      assert.equal(await win.locator('.comic-stage .comic-cell').count(), 5)
    })
    await test('PageDown scrolls roughly one viewport, not a four-panel group', async () => {
      await scrollMode(win)
      await home(win)
      const before = await stageState(win)
      const groupHeight = await win.locator('.comic-scroll-section').first().evaluate(el => el.getBoundingClientRect().height)
      await win.keyboard.press('PageDown')
      const after = await poll(() => stageState(win), s => s.top > 0, 'PageDown should scroll')
      const delta = after.top - before.top
      assert.ok(delta >= before.height * .5 && delta <= before.height * 1.1, JSON.stringify({ delta, viewport: before.height, groupHeight }))
    })
    await test('desktop screenshot', async () => {
      await scrollMode(win)
      await home(win)
      await win.screenshot({ path: path.join(OUT, `${scheme}-desktop.png`) })
    })
    await win.setViewportSize({ width: 600, height: 800 })
    await frames(win)
    await test('600px scroll toolbar is in-bounds, clickable and nonoverlapping', () => toolbarLayout(win))
    await test('600px constrained complete comic pages', () => checkLayout(win))
    await test('narrow screenshot', async () => {
      await win.screenshot({ path: path.join(OUT, `${scheme}-narrow.png`) })
    })
    await test('600px paged toolbar is nonoverlapping', async () => {
      await win.locator('#comic-mode-paged').click()
      await imagesReady(win, '.comic-stage img')
      await toolbarLayout(win)
      await win.screenshot({ path: path.join(OUT, `${scheme}-narrow-paged.png`) })
    })

    // Capture the real saveFile payload, then execute its embedded script in a
    // new document. No reimplemented export template or source-text matching.
    await test('export actual HTML and execute embedded reader modes', async () => {
      await win.locator('.comic-view-export').click()
      await win.waitForFunction(() => window.__exports.length === 1)
      const payload = await win.evaluate(() => window.__exports[0])
      assert.equal(typeof payload.content, 'string')
      fs.writeFileSync(path.join(OUT, `${scheme}-export.html`), payload.content)
      await win.goto('about:blank')
      await win.setViewportSize({ width: 1280, height: 900 })
      await win.setContent(payload.content, { waitUntil: 'load' })
      await imagesReady(win, '.cell img')
      assert.equal(await win.locator('.page:visible').count(), 3)
      assert.equal(await win.locator('.cell img').count(), 12)
      await win.locator('#mb-paged').click()
      assert.equal(await win.locator('.page:visible').count(), 1)
      assert.equal(await win.locator('#pg-no').innerText(), '1 / 3')
      await win.keyboard.press('ArrowRight')
      assert.equal(await win.locator('#pg-no').innerText(), '2 / 3')
      await win.locator('#pg-next').click()
      assert.equal(await win.locator('.page:visible').getAttribute('data-page'), '3')
      assert.ok(await win.locator('#pg-next').isDisabled())
      await win.locator('#mb-scroll').click()
      assert.equal(await win.locator('.page:visible').count(), 3)
      await win.locator('#mb-paged').click()
      assert.equal(await win.locator('.page:visible').getAttribute('data-page'), '3')
    })
    await test('export uses the same variable complete-page geometry', async () => {
      await win.locator('#mb-scroll').click()
      const pages = await win.locator('.page').evaluateAll(pages => pages.map(p => {
        const r = p.getBoundingClientRect()
        return { ratio: r.width / r.height, count: p.querySelectorAll('.cell').length }
      }))
      assert.deepEqual(pages.map(p => p.count), [3, 5, 4])
      pages.forEach(p => assert.ok(Math.abs(p.ratio - .70) < .02))
    })
    await test('export print includes all 3 pages/12 images even from paged mode', async () => {
      await win.locator('#mb-paged').click()
      await win.emulateMedia({ media: 'print' })
      try {
        assert.equal(await win.locator('.page:visible').count(), 3, 'Print must override paged mode hiding')
        assert.equal(await win.locator('.cell img:visible').count(), 12)
        assert.equal(await win.locator('.mode-bar:visible, .pager:visible').count(), 0, 'Print should hide interactive controls')
      } finally { await win.emulateMedia({ media: 'screen' }) }
    })
    await test('no renderer exceptions', async () => assert.deepEqual(errors, []))
  } finally {
    if (app) await app.close()
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    fs.writeFileSync(path.join(OUT, `${scheme}-results.json`), JSON.stringify({ scheme, passed, failures }, null, 2))
  }
  console.log(`\nComic reader [${scheme}]: ${passed} passed, ${failures.length} failed. Artifacts: ${OUT}`)
  if (failures.length) process.exitCode = 1
}
main().catch(err => { console.error(err); process.exitCode = 1 })

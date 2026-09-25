'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const sandbox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/shared/comic-panel.js'), 'utf8'), sandbox)
const build = sandbox.window.ComicPanel.buildComicPages
assert.equal(typeof build, 'function', 'Shared deterministic page layout must be exposed')
const panels = Array.from({ length: 12 }, (_, i) => ({
  idx: i, turn: i + 1, title: `Panel ${i + 1}`,
  pageBreak: [0, 3, 8].includes(i),
  size: ['square', 'square', 'hero', 'wide', 'tall', 'square'][i % 6],
  sceneLine: 'A single scene', dialogue: [{ speaker: 'Traveler', line: 'Keep moving.' }]
}))
const pages = build(panels)
assert.deepEqual(Array.from(pages, p => p.panels.length), [3, 5, 4])
assert.deepEqual(Array.from(pages.flatMap(p => p.panels), p => p.idx), panels.map(p => p.idx))
assert.equal(JSON.stringify(build(panels)), JSON.stringify(pages), 'Layout must be deterministic')
let polygons = 0
for (const page of pages) {
  assert.equal(page.aspectRatio, .70)
  assert.equal(page.layout.length, page.panels.length)
  page.layout.forEach((r, i) => {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(r[key]), key)
    assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0)
    assert.ok(r.x + r.width <= 1.00001 && r.y + r.height <= 1.00001)
    for (const b of page.layout.slice(0, i)) {
      const overlapX = Math.min(r.x + r.width, b.x + b.width) - Math.max(r.x, b.x)
      const overlapY = Math.min(r.y + r.height, b.y + b.height) - Math.max(r.y, b.y)
      assert.ok(overlapX <= .00001 || overlapY <= .00001, 'Panel rectangles must not overlap')
    }
    if (r.polygon) {
      polygons++
      assert.ok(r.polygon.length >= 3)
      for (const point of r.polygon) assert.ok(point.length === 2 && point.every(n => Number.isFinite(n) && n >= 0 && n <= 1))
    }
  })
}
assert.ok(polygons > 0, 'Dramatic fixture must include a diagonal panel')
assert.deepEqual(Array.from(build([])), [])
assert.equal(build([panels[0]])[0].panels.length, 1)
const legacy = panels.map(({ pageBreak, ...panel }) => panel)
const legacyPages = build(legacy)
assert.deepEqual(Array.from(legacyPages.flatMap(p => p.panels), p => p.idx), legacy.map(p => p.idx))
assert.ok(legacyPages.every(p => p.panels.length >= 1 && p.panels.length <= 6))
console.log(`PASS comic layout: ${pages.length} pages, 3/5/4 panels, ${polygons} diagonal panels; legacy data preserved`)

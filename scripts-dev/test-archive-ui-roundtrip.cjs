'use strict'
/* 完整存档正式 UI 往返：创建、导出、导入、确认恢复与重启水合。 */
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')

const ROOT = path.join(__dirname, '..')
const PROFILE = path.join(process.env.APPDATA, '六面世界', 'test-profile')
const OUTPUT = path.join(path.dirname(process.env.APPDATA), path.basename(process.env.SIXWORLDS_TEST_USER_DATA || 'archive-test') + '-archive-ui-artifacts')
const EXPORT_PATH = path.join(OUTPUT, 'ui-roundtrip.swarchive')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const ROUNDS = 1000
const baseEnv = {
  ...process.env,
  SIXWORLDS_TEST: '1',
  SIXWORLDS_STORAGE_TEST: '1',
  SIXWORLDS_TEST_USER_DATA: PROFILE,
  SIXWORLDS_TEST_ARCHIVE_EXPORT_PATH: EXPORT_PATH,
  SIXWORLDS_TEST_ARCHIVE_IMPORT_PATH: EXPORT_PATH,
  SIXWORLDS_TEST_IMAGE_EXPORT_DIR: path.join(OUTPUT, 'gallery-images'),
  SIXWORLDS_TEST_SAVE_PATH: path.join(OUTPUT, 'gallery-story.html'),
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
}

const launch = () => electron.launch({ executablePath: require('electron'), args: ['.'], cwd: ROOT, env: baseEnv })
const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, passed: !!condition, detail: detail ? String(detail) : '' })
  console.log((condition ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''))
}
async function ready(win) {
  await win.waitForSelector('#input', { timeout: 30000 })
  await win.waitForTimeout(800)
}
async function selectScheme(win, scheme) {
  if (scheme === 'classic') return win
  await win.evaluate((value) => window.api.setUiScheme(value), scheme).catch(() => {})
  await win.waitForURL('**/ui/' + scheme + '/index.html', { timeout: 15000 })
  await ready(win)
  return win
}
async function openArchives(win) {
  await win.click('#btn-archives')
  await win.waitForSelector('.product-panel[aria-label="存档中心"]', { timeout: 10000 })
}
async function waitForFile(filePath, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
async function waitForFiles(dir, count, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).filter((name) => name.endsWith('.png')).length === count) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  fs.mkdirSync(path.join(OUTPUT, 'gallery-images'), { recursive: true })
  const app = await launch()
  let win
  try {
    win = await app.firstWindow()
    await ready(win)
    const scheme = process.env.SIXWORLDS_UI_SCHEME || 'classic'
    await selectScheme(win, scheme)
    check('launches-selected-production-entry', await win.evaluate(() => location.pathname.split(String.fromCharCode(92)).join('/')).then((url) => url.includes('/ui/' + scheme + '/index.html')), scheme)

    // Seed 1,000 rounds, two images, and structured memory in an isolated world line.
    const seed = await win.evaluate(async ({ image, rounds }) => {
      const loaded = await window.api.loadSessions()
      const session = loaded?.sessions?.find((item) => item.id === loaded.context?.current?.currentSessionId) || loaded?.sessions?.[0]
      if (!loaded?.ok || !session) return { ok: false, reason: 'no-session' }
      session.title = '存档 UI 往返夹具'
      session.messages = Array.from({ length: rounds }, (_, index) => {
        const turn = index + 1
        return [
          { role: 'user', content: 'archive-round-' + turn + '-user', engineTurn: turn },
          Object.assign({ role: 'assistant', content: 'archive-round-' + turn + '-assistant', engineTurn: turn }, turn === rounds ? { illust: image, illusts: [image, image] } : {})
        ]
      }).flat()
      const saved = await window.api.saveSessions(loaded.sessions)
      if (!saved?.ok) return { ok: false, reason: saved?.error || 'session-save-failed' }
      const ensured = await window.api.engineEnsure({ storyId: session.id, title: session.title, kernelId: 'archive-ui-kernel', kernelText: '# Archive UI kernel\nPersistent kernel binding.' })
      if (!ensured?.ok) return { ok: false, reason: ensured?.error || 'engine-ensure-failed' }
      const committed = await window.api.engineCommit({
        storyId: session.id, sessionId: session.id, playerInput: '记录存档往返记忆',
        raw: '<<<STATE_PATCH>>>\n' + JSON.stringify({ turn_summary: 'archive-memory-roundtrip', facts: [{ key: 'archive_memory', statement: 'archive-memory-survives-restart', importance: 30 }] }) + '\n<<<END_PATCH>>>'
      })
      if (!committed?.ok || !committed.data?.committed) return { ok: false, reason: committed?.error || committed?.data?.patch_status || 'engine-commit-failed' }
      const syncSnapshot = await window.api.archiveCreate({ ...loaded.context, label: 'automation-seed-sync' })
      if (!syncSnapshot?.ok) return { ok: false, reason: syncSnapshot?.error || 'seed-archive-create-failed' }
      const seedArchive = (await window.api.archiveList())?.items?.find((item) => item.label === 'automation-seed-sync')
      if (!seedArchive) return { ok: false, reason: 'seed-archive-not-listed' }
      const syncRestore = await window.api.archiveRestore({ id: seedArchive.id })
      if (!syncRestore?.ok) return { ok: false, reason: syncRestore?.error || 'seed-archive-restore-failed' }
      return { ok: true, id: session.id, count: saved.count, messages: session.messages.length, kernelVersion: ensured.data?.kernel_version, stateSynced: true }
    }, { image: PNG, rounds: ROUNDS })
    check('seed-isolated-session-with-1000-rounds-and-memory', seed.ok && seed.stateSynced && !!seed.id && seed.messages === ROUNDS * 2, JSON.stringify(seed))
    await win.waitForFunction((expected) => [...document.querySelectorAll('.msg')].some((el) => el.textContent.includes(expected)), 'archive-round-' + ROUNDS + '-assistant', { timeout: 30000 })

    await win.click('#btn-gallery')
    await win.waitForSelector('#gallery:visible', { timeout: 10000 })
    await win.click('#btn-gallery-saveall')
    const imageDir = path.join(OUTPUT, 'gallery-images')
    const imagesSaved = await waitForFiles(imageDir, 2)
    const imageNames = imagesSaved ? fs.readdirSync(imageDir).filter((name) => name.endsWith('.png')) : []
    check('gallery-ui-batch-download-saves-all-images', imagesSaved && imageNames.length === 2 && imageNames.every((name) => fs.statSync(path.join(imageDir, name)).size > 0), JSON.stringify(imageNames))
    await win.click('#btn-gallery-export')
    const storyPath = path.join(OUTPUT, 'gallery-story.html')
    const storyExported = await waitForFile(storyPath)
    const storyHtml = storyExported ? fs.readFileSync(storyPath, 'utf8') : ''
    const embeddedImages = (storyHtml.match(/src=\"data:image\/png;base64,/g) || []).length
    check('gallery-ui-html-export-embeds-full-text-and-both-images', storyExported && storyHtml.includes('archive-round-' + ROUNDS + '-assistant') && embeddedImages === 2 && !storyHtml.includes('sixworlds-asset:'), JSON.stringify({ bytes: storyHtml.length, embeddedImages }))
    await win.click('#btn-gallery-close')
    await win.waitForFunction(() => document.querySelector('#gallery')?.hidden === true, { timeout: 10000 })

    await openArchives(win)
    await win.getByLabel('存档名称').fill('正式 UI 往返存档')
    await win.getByRole('button', { name: '创建存档' }).click()
    const originalRow = win.locator('.product-row').filter({ hasText: '正式 UI 往返存档' })
    await originalRow.waitFor({ state: 'visible', timeout: 15000 })
    check('archive-created-through-visible-ui', await originalRow.count() === 1)

    await originalRow.getByRole('button', { name: '导出' }).click()
    const exported = await waitForFile(EXPORT_PATH)
    check('archive-exported-through-visible-ui', exported, exported ? String(fs.statSync(EXPORT_PATH).size) + ' bytes' : 'missing')

    await win.getByRole('button', { name: '导入存档' }).click()
    const importedRow = win.locator('.product-row').filter({ hasText: '导入 · 正式 UI 往返存档' })
    await importedRow.waitFor({ state: 'visible', timeout: 15000 })
    check('archive-imported-through-visible-ui', await importedRow.count() === 1)

    // 改写现状并重载，证明下面的恢复确实从导入归档取回旧消息与图片。
    const changed = await win.evaluate(async (sessionId) => {
      const loaded = await window.api.loadSessions()
      const session = loaded?.sessions?.find((item) => item.id === sessionId)
      if (!session) return false
      session.messages = [{ role: 'assistant', content: 'archive-roundtrip-mutated-current-state' }]
      return (await window.api.saveSessions(loaded.sessions))?.ok === true
    }, seed.id)
    check('current-state-mutated-before-restore', changed)
    await win.reload()
    await ready(win)
    await openArchives(win)
    await win.evaluate(() => {
      window.__archiveRestoreTrace = { updates: [] }
      window.api.onCfgUpdated((data) => {
        if (data?.archiveRestored) window.__archiveRestoreTrace.updates.push({ sessions: data.sessions?.length, messages: data.sessions?.[0]?.messages?.length })
      })
    })
    await win.locator('.product-close').click()
    await openArchives(win)
    const restoreRow = win.locator('.product-row').filter({ hasText: '导入 · 正式 UI 往返存档' })
    await restoreRow.getByRole('button', { name: '恢复' }).click()
    await win.locator('.confirm-mask').waitFor({ state: 'visible', timeout: 10000 })
    await win.locator('.confirm-foot button.primary').click()
    await win.waitForTimeout(3000)
    const restoreTrace = await win.evaluate(async ({ sessionId }) => {
      const loaded = await window.api.loadSessions()
      const archives = await window.api.archiveList()
      return {
        updates: window.__archiveRestoreTrace.updates,
        confirm: document.querySelector('.confirm-mask')?.textContent || null,
        toasts: [...document.querySelectorAll('.toast')].map((item) => item.textContent),
        restoreDisabled: [...document.querySelectorAll('.product-row')].find((row) => row.textContent.includes('导入 · 正式 UI 往返存档'))?.querySelector('button')?.disabled,
        current: loaded?.sessions?.find((item) => item.id === sessionId)?.messages?.length,
        archives: archives?.items?.map((item) => ({ label: item.label, messages: item.messages }))
      }
    }, { sessionId: seed.id })
    check('restore-ipc-broadcasts-the-full-archive-session-snapshot', restoreTrace.updates.some((item) => item.messages === ROUNDS * 2), JSON.stringify(restoreTrace))
    await win.waitForFunction(async ({ sessionId, rounds }) => {
      const result = await window.api.loadSessions()
      const session = result?.sessions?.find((item) => item.id === sessionId)
      return session?.messages?.length === rounds * 2 && session.messages[session.messages.length - 1]?.content === 'archive-round-' + rounds + '-assistant'
    }, { sessionId: seed.id, rounds: ROUNDS }, { timeout: 10000 }).catch(() => {})
    await win.waitForFunction((expected) => [...document.querySelectorAll('.msg')].some((el) => el.textContent.includes(expected)), 'archive-round-' + ROUNDS + '-assistant', { timeout: 30000 })
    const restored = await win.evaluate(async ({ sessionId, rounds }) => {
      const loaded = await window.api.loadSessions()
      const session = loaded?.sessions?.find((item) => item.id === sessionId)
      const messages = session?.messages || []
      const transcriptMatches = messages.length === rounds * 2 && messages.every((message, index) => {
        const turn = Math.floor(index / 2) + 1
        return message.role === (index % 2 ? 'assistant' : 'user') && message.content === 'archive-round-' + turn + '-' + (index % 2 ? 'assistant' : 'user')
      })
      const message = messages[messages.length - 1]
      const images = message?.illusts || (message?.illust ? [message.illust] : [])
      const reads = await Promise.all(images.map((image) => window.api.readImageDataUrl(image)))
      const ensured = await window.api.engineEnsure({ storyId: sessionId, title: session?.title, kernelId: 'archive-ui-kernel', kernelText: '# Archive UI kernel\nPersistent kernel binding.' })
      const memory = await window.api.engineMemory({ storyId: sessionId })
      return {
        count: messages.length, transcriptMatches, ending: message?.content,
        imageCount: images.length,
        hydrated: images.every((image) => typeof image === 'string' && image.startsWith('sixworlds-asset://image/')),
        imagesReadable: reads.length === 2 && reads.every((read) => read?.ok === true && read.dataUrl.startsWith('data:image/')),
        kernelMatches: ensured?.ok === true && ensured.data?.kernel_match === true,
        memoryRestored: memory?.ok === true && memory.data?.facts?.some((fact) => fact.text === 'archive-memory-survives-restart')
      }
    }, { sessionId: seed.id, rounds: ROUNDS })
    check('restore-through-confirmed-ui-recovers-all-rounds-images-kernel-and-memory', restored.count === ROUNDS * 2 && restored.transcriptMatches && restored.ending === 'archive-round-' + ROUNDS + '-assistant' && restored.imageCount === 2 && restored.hydrated && restored.imagesReadable && restored.kernelMatches && restored.memoryRestored, JSON.stringify(restored))

    await app.close()
    const restarted = await launch()
    try {
      const restoredWin = await restarted.firstWindow()
      await ready(restoredWin)
      const afterRestart = await restoredWin.evaluate(async ({ sessionId, rounds }) => {
        const loaded = await window.api.loadSessions()
        const session = loaded?.sessions?.find((item) => item.id === sessionId)
        const messages = session?.messages || []
        const transcriptMatches = messages.length === rounds * 2 && messages.every((item, index) => {
          const turn = Math.floor(index / 2) + 1
          return item.content === 'archive-round-' + turn + '-' + (index % 2 ? 'assistant' : 'user')
        })
        const message = messages[messages.length - 1]
        const images = message?.illusts || (message?.illust ? [message.illust] : [])
        const reads = await Promise.all(images.map((image) => window.api.readImageDataUrl(image)))
        const ensured = await window.api.engineEnsure({ storyId: sessionId, title: session?.title, kernelId: 'archive-ui-kernel', kernelText: '# Archive UI kernel\nPersistent kernel binding.' })
        const memory = await window.api.engineMemory({ storyId: sessionId })
        return {
          content: message?.content, messages: messages.length, transcriptMatches,
          images: images.length, imagesReadable: reads.length === 2 && reads.every((item) => item?.ok === true),
          kernelMatches: ensured?.ok === true && ensured.data?.kernel_match === true,
          memoryRestored: memory?.ok === true && memory.data?.facts?.some((fact) => fact.text === 'archive-memory-survives-restart')
        }
      }, { sessionId: seed.id, rounds: ROUNDS })
      check('archive-full-transcript-images-kernel-and-memory-survive-app-restart', afterRestart.content === 'archive-round-' + ROUNDS + '-assistant' && afterRestart.messages === ROUNDS * 2 && afterRestart.transcriptMatches && afterRestart.images === 2 && afterRestart.imagesReadable && afterRestart.kernelMatches && afterRestart.memoryRestored, JSON.stringify(afterRestart))
    } finally {
      await restarted.close()
    }
  } finally {
    if (app && app.windows().length) await app.close().catch(() => {})
  }

  const report = { scheme: process.env.SIXWORLDS_UI_SCHEME || 'default', exportPath: EXPORT_PATH, checks, complete: checks.every((x) => x.passed), passed: checks.filter((x) => x.passed).length, failed: checks.filter((x) => !x.passed).length }
  fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify(report, null, 2))
  console.log('\n' + report.passed + ' passed, ' + report.failed + ' failed. Artifact: ' + OUTPUT)
  process.exit(report.failed ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })

'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'output', 'current-comic-' + Date.now())
async function main() {
  const env = { ...process.env }
  for (const key of ['SIXWORLDS_TEST', 'SIXWORLDS_STORAGE_TEST', 'ELECTRON_RUN_AS_NODE']) delete env[key]
  const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: ROOT, env, timeout: 30000 })
  try {
    const win = await app.firstWindow()
    await win.context().addInitScript(() => {
      let mod
      Object.defineProperty(window, 'ComicPanel', { configurable: true, get: () => mod, set(value) {
        mod = value
        const create = value.createComicPanel
        value.createComicPanel = ctx => {
          window.__realComicContext = ctx
          return create(ctx)
        }
      } })
    })
    await win.reload()
    await win.waitForFunction(() => window.__realComicContext?.curSession()?.id, { timeout: 30000 })
    const metadata = await win.evaluate(async () => {
      const ctx = window.__realComicContext
      const r = await ctx.api.loadSessions()
      return { activeId: ctx.curSession().id, style: ctx.cfg().illustStyle, model: ctx.cfg().illustModel, sessions: (r.sessions || []).map(s => ({ id: s.id, title: s.title, messages: s.messages?.length || 0, pages: s.comic?.panels?.length || 0, drawn: s.comic?.panels?.filter(p => p.illust).length || 0, fullPages: s.comic?.panels?.filter(p => p.fullPage === true).length || 0, turns: s.comic?.panels?.map(p => p.turn) || [] })) }
    })
    console.log(JSON.stringify(metadata))
    if (!process.argv.includes('--generate')) return
    fs.mkdirSync(OUT, { recursive: true })
    const selected = process.argv.find(a => a.startsWith('--session='))?.slice(10)
    const repairDir = process.argv.find(a => a.startsWith('--repair='))?.slice(9)
    const preserved = repairDir ? [2, 3].map(n => ({ index: n - 1, image: 'data:image/png;base64,' + fs.readFileSync(path.join(repairDir, 'page-0' + n + '.png')).toString('base64') })) : []
    const info = await win.evaluate(async ({ selected, preserved }) => {
      const ctx = window.__realComicContext
      const r = await ctx.api.loadSessions()
      const source = selected ? r.sessions.find(s => s.id === selected) : ctx.curSession()
      if (!source?.comic?.panels?.length) throw new Error('Selected session has no comic script')
      window.__originalComic = JSON.stringify(source.comic)
      window.__rerunSession = structuredClone(source)
      window.__sourceSessionId = source.id
      for (const p of window.__rerunSession.comic.panels) Object.assign(p, { illust: null, illustAsset: null, illustAt: null, illustPending: false, illustError: null })
      window.__rerunToasts = []
      window.__rerun = window.ComicPanel.createComicPanel({ ...ctx, curSession: () => window.__rerunSession, saveSessions: () => {}, toast: t => window.__rerunToasts.push(t), api: { ...ctx.api, saveFile: async payload => { window.__rerunExport = payload.content; return { ok: true } } } })
      window.__rerunDone = false
      const legacy = window.__rerunSession.comic.panels
      const groups = [legacy.slice(0, 5), legacy.slice(5, 9), legacy.slice(9, 13), legacy.slice(13)]
      window.__rerunSession.comic.panels = groups.filter(g => g.length).map((g, i) => ({
        idx: i, fullPage: true, turn: Math.max(...g.map(p => p.turn)), title: g[g.length - 1].title,
        narration: g.map(p => p.narration).join('；'), sceneLine: g[0].sceneLine,
        participants: [...new Set(g.flatMap(p => p.participants || []))],
        composition: 'Create exactly ' + g.length + ' panels for the ordered beats. Vary their proportions naturally, emphasize the final emotional beat, and keep clear left-to-right, top-to-bottom reading order. The selected illustration style governs all artwork.',
        beats: g.map(p => ({ turn: p.turn, description: p.narration, size: p.size || 'square', dialogue: p.dialogue || [] })),
        illust: null, illustAsset: null, illustPending: false, illustError: null
      }))
      if (preserved.length) {
        for (const p of preserved) window.__rerunSession.comic.panels[p.index].illust = p.image
        const first = window.__rerunSession.comic.panels[0]
        first.beats[0].description = '黎明前，大陆边缘的一座小村庄。远景交代村庄与离村的迁徙车队，只画故事世界里的景物。'
        first.beats[1].description = '十二岁的棕发男孩穿着旧斗篷，跟随疲惫的父亲与七岁的卷发妹妹一起赶路。三人带着破旧行囊。'
        first.beats[4].description = '界碑旁，妹妹拉着男孩衣角，父亲俯身对孩子们低声叮嘱。'
        first.beats[4].dialogue = [{ speaker: '父亲', line: '别回头，从今天起我们只是路人。', tone: 'whisper' }]
        first.narration = '一家三口离开村庄，迁徙十二天后到达界碑，父亲叮嘱孩子隐去旧姓。'
        first.composition += ' Only the three travelers appear in this page; the cobbler has not appeared yet. No character statistics, game choices or interface text. Print only the supplied dialogue.'
        const last = window.__rerunSession.comic.panels[3]
        last.sceneLine = '夜晚｜驿铺内室｜关闭的木门和窗板'
        last.beats = [
          { turn: 5, description: '夜晚驿铺昏暗内室。父亲坐在油灯旁，男孩在他身边低声问话，妹妹裹蓝色披肩靠在行李旁。房门和木窗板已关闭，画面中没有街道或日光。', dialogue: [{ speaker: '玩家角色', line: '为什么用“莱恩”这个名字？', tone: 'whisper' }, { speaker: '父亲', line: '先把门关好。', tone: 'normal' }] },
          { turn: 5, description: '同一夜晚室内，父亲转向男孩解释往事，油灯暖光照着疲惫面容。背景只有暗色室内木墙，门窗紧闭。', dialogue: [{ speaker: '父亲', line: '七年前我欠莱恩一份人情。', tone: 'normal' }, { speaker: '父亲', line: '你母亲也确有这门远亲。', tone: 'normal' }] },
          { turn: 5, description: '同一夜晚室内特写。父亲贴近男孩耳边压低声音，神色郑重。背后是油灯与关闭的木窗板，只有室内暖光和暗影。', dialogue: [{ speaker: '父亲', line: '先找到莱恩认下表亲。', tone: 'whisper' }, { speaker: '父亲', line: '之后再做打算。别告诉任何人我们的姓。', tone: 'whisper' }] }
        ]
        last.narration = '夜晚驿铺内，父亲向男孩交代化名缘由，叮嘱保密。所有画面均在关闭门窗的内室。'
        last.composition = 'Exactly three panels, all inside the SAME DIM INN ROOM AT NIGHT, closed wooden door and shutters, amber oil-lamp illumination. No exterior street view, no daylight, no open doorway. Preserve the selected illustration style. Read from top to bottom.'
      }
      window.__rerun.runQueue().finally(() => { window.__rerunDone = true })
      return { id: source.id, title: source.title, pages: source.comic.panels.length, turns: source.comic.panels.map(p => p.turn), style: ctx.cfg().illustStyle }
    }, { selected, preserved })
    console.log('RERUN ' + JSON.stringify(info))
    for (let i = 0; i < 180; i++) {
      await new Promise(r => setTimeout(r, 10000))
      const state = await win.evaluate(() => ({ finished: window.__rerunDone && window.__rerunSession.comic.progress?.state === 'done', done: window.__rerunSession.comic.panels.filter(p => p.illust).length, failed: window.__rerunSession.comic.panels.filter(p => p.illustError).length }))
      console.log('PROGRESS ' + JSON.stringify(state))
      const checkpoint = await win.evaluate(() => ({ pages: window.__rerunSession.comic.panels.map(p => ({ image: p.illust, prompt: p.prompt })), errors: window.__rerunToasts.map(t => /超时|timeout/i.test(t) ? 'timeout' : /规划失败/.test(t) ? 'planning-failed' : /失败/.test(t) ? 'generation-failed' : 'status') }))
      for (const [n, p] of checkpoint.pages.entries()) {
        if (!p.image?.startsWith('data:image/')) continue
        const name = 'page-' + String(n + 1).padStart(2, '0')
        const dest = path.join(OUT, name + '.png')
        if (!fs.existsSync(dest)) { fs.writeFileSync(dest, Buffer.from(p.image.split(',')[1], 'base64')); fs.writeFileSync(path.join(OUT, name + '-prompt.txt'), p.prompt || ''); console.log('PAGE_SAVED ' + dest) }
      }
      if (state.finished) { console.log('STATUS_CLASSES ' + JSON.stringify(checkpoint.errors)); break }
    }
    const result = await win.evaluate(async () => {
      if (!window.__rerunDone) throw new Error('Generation did not finish')
      await window.__rerun.exportHtml()
      const r = await window.api.loadSessions()
      const original = r.sessions.find(s => s.id === window.__sourceSessionId)
      return { title: window.__rerunSession.title, comic: window.__rerunSession.comic, html: window.__rerunExport, originalUnchanged: JSON.stringify(original.comic) === window.__originalComic }
    })
    fs.writeFileSync(path.join(OUT, 'comic.html'), result.html || '')
    const manifest = { ...info, originalUnchanged: result.originalUnchanged, pages: [] }
    fs.writeFileSync(path.join(OUT, 'storyboard.json'), JSON.stringify({ cast: result.comic.cast, panels: result.comic.panels.map(({ fullPage, turn, title, narration, composition, beats }) => ({ fullPage, turn, title, narration, composition, beats })) }, null, 2))
    for (const [i, p] of result.comic.panels.entries()) {
      const name = 'page-' + String(i + 1).padStart(2, '0')
      if (p.illust?.startsWith('data:image/')) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(p.illust.split(',')[1], 'base64'))
      fs.writeFileSync(path.join(OUT, name + '-prompt.txt'), p.prompt || '')
      manifest.pages.push({ page: i + 1, turn: p.turn, title: p.title, generated: Boolean(p.illust), failed: Boolean(p.illustError) })
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log('OUTPUT ' + OUT)
    console.log('RESULT ' + JSON.stringify(manifest))
    if (!result.originalUnchanged || manifest.pages.some(p => !p.generated)) process.exitCode = 1
  } finally { await app.close() }
}
main().catch(() => { console.error('Rerun failed; no credentials logged.'); process.exitCode = 1 })

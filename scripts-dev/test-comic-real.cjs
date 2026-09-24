'use strict'
// One-shot REAL fused-page generation through the app's own IPC path.
// Launches the real app with the REAL profile (same as the user opening it),
// evaluates the app's real panelPrompt source in the renderer, then calls
// window.api.generateImage. Keys stay in the app process memory; nothing
// secret is printed or written. Output: output/comic-fused/real-1.png
const fs = require('node:fs')
const path = require('node:path')
const { _electron: electron } = require('playwright')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'output', 'comic-fused')
const OUTPUT_NAME = 'directed-' + Date.now()

const PAGE = {
  fullPage: true, turn: 3, title: '夜雨中的石桥对峙',
  sceneLine: '【暴雨夜｜镇外的石桥】',
  narration: '琳冒雨赶到石桥，守门老人拦住去路，一场对峙在雨中展开。',
  composition: 'Exactly three panels corresponding to beats 1, 2, 3. A shallow wide establishing panel at the top, a medium-height guard reaction panel in the middle, and a dominant face-off panel occupying the lower half. A restrained diagonal boundary leads into the last panel. Read top to bottom. Keep 琳 on the left and the guard on the right in shared views. Reserve clean balloon space above heads. Do not add lantern inserts, face inserts or extra establishing shots.',
  participants: ['琳', '守门老人'],
  cast: [
    { name: '琳', look: 'A slender young female traveler with long silver-white hair, a narrow youthful face and determined eyes. Stable anchors: loose silver hair, a plain deep-blue wool cloak fastened at the collar, and an unadorned wooden practice sword at her hip. Under the cloak she wears a practical linen tunic, dark trousers and worn boots. The sword is carved from dull brown wood, with visible grain and a thick blunt edge; its grip and guard are wooden, not polished metal.' },
    { name: '守门老人', look: 'An elderly stooped gatekeeper with a deeply lined angular face, heavy brows and a coarse gray beard. Stable anchors: gray beard, hunched silhouette, worn dark-brown leather armor over a plain tunic. A weathered hood frames his face without concealing his eyes. He holds a long spear in his right hand and a small iron-framed amber lantern in his left. His expression is wary and exhausted rather than monstrous; keep his clothing functional, without decorative gold trim.' }
  ],
  beats: [
    { turn: 3, description: 'Wide side view of a rain-soaked stone bridge at night. 琳 runs in from the left toward the guard on the right; one boot strikes a puddle, the heavy wet cloak trails behind. Her wooden sword remains at her hip. The distant amber lantern establishes the light source. Leave upper-left balloon space.', size: 'square', dialogue: [{ speaker: '琳', line: '老丈，请让我过去！', tone: 'shout' }] },
    { turn: 3, description: 'Medium three-quarter view of 守门老人 facing left. His right hand brings the spear across the path; his left hand keeps the lantern below chest height. Amber light catches his weathered brow and gray beard, cool rain outlines his hood. His narrowed eyes convey a serious warning, not anger. Keep the spear grip and lantern handle separate and readable.', size: 'tall', dialogue: [{ speaker: '守门老人', line: '夜里过桥的人，从没有活着回去过。', tone: 'normal' }] },
    { turn: 3, description: 'Dominant side-view two-shot. 琳 remains on the left, feet planted apart, pointing her blunt all-wood practice sword at the guard on the right. Visible brown wood grain and rounded wooden edge, no steel blade. Her jaw is set and her gaze steady, not smiling. The guard lowers the spear between them and watches her while holding the lantern in his left hand. Rain drips from the wooden tip. Preserve the bridge axis; place her balloon above the left figure and his whisper above the right.', size: 'hero', dialogue: [{ speaker: '琳', line: '那就试试看。', tone: 'normal' }, { speaker: '守门老人', line: '……好胆色。', tone: 'whisper' }] }
  ]
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 30000
  })
  try {
    const win = await app.firstWindow()
    await win.waitForTimeout(3500)
    const comicSrc = fs.readFileSync(path.join(ROOT, 'ui/shared/comic-panel.js'), 'utf8')
    const illustSrc = fs.readFileSync(path.join(ROOT, 'ui/shared/illust-panel.js'), 'utf8')
    const gen = await win.evaluate(async ({ comicSrc, illustSrc, page }) => {
      const comp = comicSrc.match(/const PANEL_COMPOSITION = \{[\s\S]*?\}/)[0]
      const fn = comicSrc.match(/function panelPrompt\(panel, comic, styleText\) \{[\s\S]*?\n    \}/)[0]
      const style = (illustSrc.match(/'ln-original':\s*'((?:[^'\\]|\\.)*)'/) || [])[1] || ''
      const factory = new Function('panel', 'comic', 'styleText', comp + '\n' + fn + '\nreturn panelPrompt(panel, comic, styleText)')
      const prompt = factory(page, { cast: page.cast }, style)
      const cfg = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
      const sec = window.api && window.api.loadSecrets ? await window.api.loadSecrets() : null
      const apiKey = (sec && sec.ok && sec.secrets && (sec.secrets.illustApiKey || sec.secrets.apiKey)) || ''
      const r = await window.api.generateImage({
        baseUrl: cfg.illustBaseUrl || cfg.baseUrl,
        apiKey,
        model: cfg.illustModel,
        quality: cfg.illustQuality || 'default',
        n: 1,
        size: '864x1536',
        prompt
      })
      return { r, model: cfg.illustModel, prompt }
    }, { comicSrc, illustSrc, page: PAGE })
    fs.writeFileSync(path.join(OUT, OUTPUT_NAME + '-prompt.txt'), gen.prompt, 'utf8')
    console.log('MODEL=' + gen.model, 'PROMPT_CHARS=' + gen.prompt.length)
    if (gen.r && gen.r.ok) {
      const b64 = gen.r.dataUrl.split(',', 2)[1]
      fs.writeFileSync(path.join(OUT, OUTPUT_NAME + '.png'), Buffer.from(b64, 'base64'))
      if (gen.r.revisedPrompt) fs.writeFileSync(path.join(OUT, OUTPUT_NAME + '-revised-prompt.txt'), gen.r.revisedPrompt, 'utf8')
      console.log('IMAGE_SAVED bytes=' + b64.length)
	    if (gen.r.cost != null) console.log('COST=' + gen.r.cost)
    } else {
      console.error('GEN_ERROR=' + String(gen.r && gen.r.error).slice(0, 500))
      process.exitCode = 1
    }
  } finally {
    try { await app.close() } catch {}
  }
}
main().catch(e => { console.error('FATAL', String(e && e.message || e).slice(0, 400)); process.exitCode = 1 })

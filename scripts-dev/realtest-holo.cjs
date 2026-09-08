/* 真实模型端到端测试：闪卡生成链路（真实 API，花费真实额度）
 *
 * 与 e2e-mock 的区别：
 *   - 不设 SIXWORLDS_TEST（真实启动路径：splash / 真实配置 / 真实 DPAPI 密钥）
 *   - APPDATA 指向 test-shots/realtest-appdata 沙盒副本（用户的真实 userData 不受影响）
 *   - 文本模型（deepseek-v4-pro-0813）做 card 规划；图像模型（gpt-image-2@worldclawpro.ai）做 2 次生图
 *
 * 验证链：启动（沙盒配置+会话）→ 画廊 → 闪卡选角 → 真实规划 → 2 次真实生图
 *   → canvas 抠图/排版 → 卡目录落盘（PNG 尺寸 + card-config.json）→ 查看器渲染（readPixels）
 * 产物：test-shots/realtest-report.json + test-shots/realtest-*.png 截图
 * 绝不打印密钥；花费与耗时如实记账到报告。
 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')
const SHOTS = path.join(ROOT, 'test-shots')
const TARGET_SESSION = 'smtjtz4wn' // 7 个 character 实体的世界线（黎明前的黑暗…）

function log(...a) { console.log('[realtest]', ...a) }
function now() { return new Date().toISOString().slice(11, 23) }

// PNG IHDR 尺寸读取（不进渲染进程，纯 Node 校验产物）
function pngSize(file) {
  const b = fs.readFileSync(file)
  if (b.length < 24 || b.readUInt32BE(12) !== 0x49484452) return null
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

async function main() {
  const report = { startedAt: new Date().toISOString(), steps: [], costs: [], errors: [] }
  const mark = (name, ok, note) => {
    report.steps.push({ t: now(), name, ok: !!ok, note: String(note || '') })
    log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (note ? ' | ' + note : ''))
  }

  log('启动沙盒 Electron（APPDATA=' + SANDBOX_APPDATA + '）')
  // 启动重试：真实 userData 副本的 GPUCache/DIPS 在并发启动时会锁冲突（0x5）导致实例秒退
  const purgeSandboxCaches = () => {
    const ud = path.join(SANDBOX_APPDATA, '六面世界')
    for (const d of ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GraphiteDawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'DIPS', 'Crashpad']) {
      try { fs.rmSync(path.join(ud, d), { recursive: true, force: true }) } catch {}
    }
    for (const f of ['lockfile', 'DevToolsActivePort', 'DIPS-wal']) {
      try { fs.rmSync(path.join(ud, f), { force: true }) } catch {}
    }
  }
  let app = null
  let launchErr = null
  for (let attempt = 1; attempt <= 3 && !app; attempt++) {
    purgeSandboxCaches()
    try {
      // 入口必须是 scripts-dev/realtest-entry.cjs（文件级）而非 '.'：
      // 1) 用户真实实例以 electron . 启动，'.' 入口拿到同一 Chromium 单例标识 →
      //    requestSingleInstanceLock 失败 → app.quit() 秒退（exitCode=0，无窗口不报错）；
      // 2) 文件级入口丢失 package.json 应用名，userData 会变成 %APPDATA%\Electron（全新档）——
      //    入口文件里 app.setPath('userData', 沙盒) 先行指回副本。两全其美。
      app = await electron.launch({
        executablePath: electronExecutable,
        args: [path.join(__dirname, 'realtest-entry.cjs'), '--disable-gpu-shader-disk-cache'], cwd: ROOT,
        env: { ...process.env, APPDATA: SANDBOX_APPDATA, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
      })
    } catch (e) {
      launchErr = e
      log('启动失败（第 ' + attempt + ' 次）：' + String(e && e.message || e).split('\n')[0])
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  if (!app) throw launchErr || new Error('三次启动均失败')
  let win = await app.firstWindow()
  await win.waitForTimeout(3000).catch(() => {})
  // 真实路径首窗可能在 CDP 附着期间导航/重载（大数据 + splash）——句柄失效时重取
  for (let i = 0; i < 5; i++) {
    const alive = await win.evaluate(() => true).catch(() => false)
    if (alive) break
    log('窗口句柄失效，重取（第 ' + (i + 1) + ' 次）…')
    const ws = app.windows()
    win = ws[ws.length - 1]
    await win.waitForTimeout(1500).catch(() => {})
  }
  const winUrl = win.url()
  report.winUrl = winUrl
  log('首窗：' + winUrl)

  // 真实路径有 splash：Enter 键立即触发 finish（onKey 在 splashBoot 时就挂上）
  try {
    await win.locator('#splash').waitFor({ state: 'attached', timeout: 5000 }).catch(() => null)
    await win.keyboard.press('Enter').catch(() => {})
    await win.locator('#splash').waitFor({ state: 'detached', timeout: 9000 }).catch(() => null)
    mark('splash-dismissed', !(await win.locator('#splash').count().catch(() => 1)))
  } catch (e) { mark('splash-dismissed', false, String(e).slice(0, 120)) }

  // 等应用 boot 完成：#btn-gallery 可见（真实路径无 localStorage 清空）
  await win.locator('#btn-gallery').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  await win.waitForTimeout(2500)

  // ---- 确认真实配置已生效（不打印密钥） ----
  const cfgInfo = await win.evaluate(() => {
    const raw = localStorage.getItem('sixworlds.codex.state.v3')
    if (!raw) return null
    try {
      const c = JSON.parse(raw)
      return {
        baseUrl: c.baseUrl || '', model: c.model || '',
        illustBaseUrl: c.illustBaseUrl || '', illustModel: c.illustModel || '', illustSize: c.illustSize || '',
        hasKey: !!(c.apiKey && c.apiKey.length > 8), hasIllustKey: !!(c.illustApiKey && c.illustApiKey.length > 8),
        currentSessionId: c.currentSessionId || '', skipSplash: !!c.skipSplash
      }
    } catch { return null }
  }).catch(() => null)
  mark('config-loaded', !!(cfgInfo && cfgInfo.baseUrl && cfgInfo.model && cfgInfo.illustModel && cfgInfo.hasKey),
    cfgInfo ? JSON.stringify({ text: cfgInfo.model, img: cfgInfo.illustModel + '@' + cfgInfo.illustSize, keys: cfgInfo.hasKey && cfgInfo.hasIllustKey }) : 'localStorage 读取失败')

  // ---- 切到目标世界线（如未选中） ----
  const sessState = await win.evaluate(async () => {
    const r = await window.api.loadSessions()
    const list = (r && r.sessions) || []
    const active = document.querySelector('.session-item.active')
    return { storage: r && r.storage, ids: list.map((s) => s.id + ':' + (s.title || '').slice(0, 12)), active: active ? active.dataset.sid : null }
  }).catch((e) => ({ err: String(e) }))
  log('会话库：' + JSON.stringify(sessState))
  if (!(sessState.ids || []).some((x) => x.startsWith(TARGET_SESSION + ':'))) {
    mark('target-session-exists', false, '目标世界线不在会话库：' + JSON.stringify(sessState.ids))
  } else {
    if (sessState.active !== TARGET_SESSION) {
      // 点击目标会话项（session-item 的 dataset.sid）
      const clicked = await win.evaluate((sid) => {
        const items = Array.from(document.querySelectorAll('.session-item'))
        const el = items.find((it) => (it.dataset && it.dataset.sid) === sid)
        if (!el) return false
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      }, TARGET_SESSION).catch(() => false)
      await win.waitForTimeout(1200)
      mark('switched-to-target-session', clicked)
    } else {
      mark('switched-to-target-session', true, '已是当前会话')
    }
  }

  // 主窗截图（生成前）
  await win.screenshot({ path: path.join(SHOTS, 'realtest-1-main.png') }).catch(() => {})

  // ---- 画廊 → 闪卡 ----
  await win.click('#btn-gallery').catch((e) => mark('gallery-open', false, e.message))
  await win.waitForTimeout(600)
  mark('gallery-open', await win.locator('#gallery:not([hidden])').isVisible().catch(() => false) || await win.locator('#gallery').isVisible().catch(() => false))
  await win.click('#btn-holo-card').catch((e) => mark('holo-picker-open', false, e.message))
  await win.waitForTimeout(800)
  const pickerVisible = await win.locator('#holo-picker').isVisible().catch(() => false)
  mark('holo-picker-open', pickerVisible)
  if (!pickerVisible) {
    report.errors.push('选角弹窗未出现')
    await app.close().catch(() => {})
    fs.writeFileSync(path.join(SHOTS, 'realtest-report.json'), JSON.stringify(report, null, 2))
    process.exit(1)
  }
  const charCount = await win.locator('.holo-picker-item').count()
  const charNames = await win.locator('.holo-picker-item').allTextContents().catch(() => [])
  mark('picker-lists-characters', charCount >= 1, charNames.slice(0, 8).join(' / ').slice(0, 160))
  await win.screenshot({ path: path.join(SHOTS, 'realtest-2-picker.png') }).catch(() => {})

  // 记录生成前会话卡片基线 + tokens 基线（用于花费增量）
  const before = await win.evaluate(async (sid) => {
    const r = await window.api.loadSessions()
    const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
    return { cards: s && s.cards ? s.cards.length : 0, cost: s && s.tokens ? (s.tokens.cost || 0) : 0 }
  }, TARGET_SESSION).catch(() => ({ cards: 0, cost: 0 }))
  log('基线：cards=' + before.cards + ' cost=' + before.cost)

  // ---- 选中第一个角色（真实规划 + 真实生图，最长 8 分钟） ----
  log('点击角色开始真实生成（规划 + 2 次生图，最长 ~8 分钟）…')
  const genStart = Date.now()
  await win.locator('.holo-picker-item').first().click()
  let done = null
  let lastProgress = ''
  for (let i = 0; i < 160; i++) { // 160 × 3s = 480s
    const st = await win.evaluate(async (sid) => {
      const r = await window.api.loadSessions()
      const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
      const island = document.querySelector('#holo-island .island-txt')
      const errToast = document.querySelector('.toast-wrap .toast.err')
      return {
        cards: s && s.cards ? s.cards.length : 0,
        cost: s && s.tokens ? (s.tokens.cost || 0) : 0,
        island: island ? (island.textContent || '').trim().slice(0, 40) : '',
        toast: errToast ? (errToast.textContent || '').slice(0, 80) : ''
      }
    }, TARGET_SESSION).catch(() => null)
    if (st) {
      if (st.island && st.island !== lastProgress) { lastProgress = st.island; log('进度：' + st.island) }
      if (st.cards > before.cards) { done = st; break }
      // 失败 toast 停止等待（链路 throw 后 island 关闭 + err toast）
      if (/失败/.test(st.toast || '')) { done = { failed: st.toast }; break }
    }
    await win.waitForTimeout(3000)
  }
  const genMs = Date.now() - genStart
  if (done && done.failed) {
    mark('generation', false, '失败提示：' + done.failed + '（' + Math.round(genMs / 1000) + 's）')
    report.errors.push('生成失败：' + done.failed)
    await win.screenshot({ path: path.join(SHOTS, 'realtest-fail.png') }).catch(() => {})
  } else if (done) {
    mark('generation', true, 'session.cards ' + before.cards + '→' + done.cards + '，耗时 ' + Math.round(genMs / 1000) + 's' + (done.cost > before.cost ? '，花费 $' + done.cost : ''))
    if (Number.isFinite(done.cost)) report.costs.push({ delta: done.cost - before.cost })
  } else {
    mark('generation', false, '8 分钟超时（最后进度：' + lastProgress + '）')
    report.errors.push('超时')
  }

  // ---- 读取卡片元数据 ----
  const cardMeta = await win.evaluate(async (sid) => {
    const r = await window.api.loadSessions()
    const s = r && r.sessions && r.sessions.find((x) => x.id === sid)
    return s && s.cards ? s.cards[s.cards.length - 1] : null
  }, TARGET_SESSION).catch(() => null)
  if (cardMeta && cardMeta.cardId) {
    mark('card-meta', /^[a-z0-9-]+$/.test(cardMeta.cardId), JSON.stringify({ name: cardMeta.name, rarity: cardMeta.rarity, layered: cardMeta.layered }))
    // ---- 读取卡目录产物（主进程 API） ----
    const cardRead = await win.evaluate(async (cid) => {
      const r = await window.api.cardRead({ cardId: cid })
      return r
    }, cardMeta.cardId).catch(() => null)
    if (cardRead && cardRead.ok) {
      const cfgCard = cardRead.config
      mark('card-config', !!(cfgCard && cfgCard.assets && cfgCard.assets.subject), JSON.stringify({
        title: cfgCard && cfgCard.title, subtitle: cfgCard && cfgCard.subtitle, foil: cfgCard && cfgCard.parameters && cfgCard.parameters.foil,
        subjectDepth: cfgCard && cfgCard.parameters && cfgCard.parameters.subjectDepth
      }))
      // 目录内直接文件校验（PNG 尺寸 + glb 存在）
      const cardDir = path.join(SANDBOX_APPDATA, '六面世界', 'holo-cards', cardMeta.cardId)
      const expect = [['subject.png', '1024x1536'], ['background.png', null], ['text.png', '1024x1536'], ['card.glb', null], ['card-config.json', null]]
      for (const [f, size] of expect) {
        const p = path.join(cardDir, f)
        if (!fs.existsSync(p)) { mark('file:' + f, false, '缺失'); continue }
        if (f.endsWith('.png')) {
          const sz = pngSize(p)
          mark('file:' + f, !!sz && sz.w >= 512, sz ? sz.w + 'x' + sz.h + '（' + Math.round(fs.statSync(p).size / 1024) + 'KB）' : '非 PNG')
        } else {
          mark('file:' + f, fs.statSync(p).size > 100, Math.round(fs.statSync(p).size / 1024) + 'KB')
        }
      }
      report.cardDir = cardDir
      report.cardId = cardMeta.cardId
    } else {
      mark('card-config', false, 'cardRead 失败：' + JSON.stringify(cardRead).slice(0, 120))
    }

    // ---- 打开查看器窗口（真实 BrowserWindow + Three.js WebGL） ----
    log('打开查看器窗口…')
    await win.evaluate(async (cid) => { await window.api.cardWindow({ cardId: cid }) }, cardMeta.cardId).catch(() => {})
    let viewer = null
    for (let i = 0; i < 40; i++) {
      const ws = app.windows()
      viewer = ws.find((w) => w.url().includes('holo') && w.url().includes('card='))
      if (viewer) break
      await new Promise((r) => setTimeout(r, 250))
    }
    if (viewer) {
      mark('viewer-window-opened', true, viewer.url().slice(-80))
      // 等 Three.js 场景就绪（app.bundle.js 初始化完成 → canvas 存在）
      await viewer.waitForSelector('canvas', { timeout: 15000 }).catch(() => {})
      await viewer.waitForTimeout(4000)
      const holo = await viewer.evaluate(() => {
        const cv = document.querySelector('canvas')
        return { hasCanvas: !!cv, w: cv ? cv.width : 0, h: cv ? cv.height : 0, title: document.title }
      }).catch(() => null)
      mark('viewer-webgl-canvas', !!(holo && holo.hasCanvas && holo.w > 0), JSON.stringify(holo))
      // readPixels 颜色统计（headless screenshot 对 WebGL 常黑，直接读帧缓冲）
      const px = await viewer.evaluate(() => {
        const cv = document.querySelector('canvas')
        if (!cv) return null
        try {
          const gl = cv.getContext('webgl2') || cv.getContext('webgl')
          if (!gl) return { err: 'no-gl' }
          const w = Math.min(cv.width, 400), h = Math.min(cv.height, 400)
          const buf = new Uint8Array(w * h * 4)
          gl.readPixels(Math.floor(cv.width / 2 - w / 2), Math.floor(cv.height / 2 - h / 2), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
          let lit = 0, total = w * h, rs = 0, gs = 0, bs = 0
          for (let i = 0; i < buf.length; i += 4) {
            const l = buf[i] + buf[i + 1] + buf[i + 2]
            if (l > 30) { lit++; rs += buf[i]; gs += buf[i + 1]; bs += buf[i + 2] }
          }
          return { lit: +(lit / total * 100).toFixed(1), avg: lit ? [Math.round(rs / lit), Math.round(gs / lit), Math.round(bs / lit)] : null }
        } catch (e) { return { err: String(e).slice(0, 80) } }
      }).catch(() => null)
      mark('viewer-pixels-lit', !!(px && px.lit > 1), px ? ('亮像素 ' + px.lit + '%，均值RGB ' + (px.avg ? px.avg.join(',') : '-')) : 'readPixels 失败')
      await viewer.screenshot({ path: path.join(SHOTS, 'realtest-3-viewer.png') }).catch(() => {})
      await viewer.close().catch(() => {})
    } else {
      mark('viewer-window-opened', false, '15s 内未出现 holo 查看器窗口')
    }
  } else {
    mark('card-meta', false, 'session.cards 无新卡')
  }

  // 主窗终态截图（画廊图鉴应显示新卡）
  await win.screenshot({ path: path.join(SHOTS, 'realtest-4-gallery.png') }).catch(() => {})

  report.finishedAt = new Date().toISOString()
  report.verdict = report.errors.length ? 'FAIL' : (report.steps.every((s) => s.ok) ? 'PASS' : 'PASS_WITH_NOTES')
  fs.writeFileSync(path.join(SHOTS, 'realtest-report.json'), JSON.stringify(report, null, 2))
  log('报告 → test-shots/realtest-report.json')

  await app.close().catch(() => {})
  const failed = report.steps.filter((s) => !s.ok)
  log(failed.length ? '有 ' + failed.length + ' 项失败' : '全部通过')
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('[realtest] FATAL', e)
  process.exit(2)
})

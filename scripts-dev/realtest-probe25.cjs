/* 沙盒内直接试生小图探针（256x256，单次最小成本）：
 * ① gpt-image-2.5 系列模型是否可用（/models 被 403 分组限制，列表查不了，只能试生）
 * ② background:transparent 是否生效（返回图带 alpha）
 * ③ revised_prompt 是否回传（gpt-image 系内部改写）
 * 绝不打印密钥。用法：node realtest-probe25.cjs <模型名>（默认 gpt-image-2.5-sunburst）
 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')
const MODEL = process.argv[2] || 'gpt-image-2.5-sunburst'
const SIZE = process.argv[3] || '256x256'
const USE_BG = (process.argv[4] || 'on') === 'on'

function log(...a) { console.log('[probe]', ...a) }

function purge() {
  const ud = path.join(SANDBOX_APPDATA, '六面世界')
  for (const d of ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'DIPS', 'Crashpad']) {
    try { fs.rmSync(path.join(ud, d), { recursive: true, force: true }) } catch {}
  }
  for (const f of ['lockfile', 'DevToolsActivePort']) { try { fs.rmSync(path.join(ud, f), { force: true }) } catch {} }
}

async function main() {
  let app = null
  for (let i = 1; i <= 3 && !app; i++) {
    purge()
    try {
      app = await electron.launch({
        executablePath: electronExecutable,
        args: [path.join(__dirname, 'realtest-entry.cjs'), '--disable-gpu-shader-disk-cache'],
        cwd: ROOT,
        env: { ...process.env, APPDATA: SANDBOX_APPDATA, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
      })
    } catch { await new Promise((r) => setTimeout(r, 3000)) }
  }
  if (!app) throw new Error('启动失败')
  try {
    let win = await app.firstWindow()
    await win.waitForTimeout(3000).catch(() => {})
    for (let i = 0; i < 5; i++) {
      if (await win.evaluate(() => true).catch(() => false)) break
      const ws = app.windows(); win = ws[ws.length - 1]
      await win.waitForTimeout(1500).catch(() => {})
    }
    await win.locator('#splash').waitFor({ state: 'attached', timeout: 5000 }).catch(() => null)
    await win.keyboard.press('Enter').catch(() => {})
    await win.locator('#splash').waitFor({ state: 'detached', timeout: 9000 }).catch(() => null)
    await win.waitForTimeout(1500)

    const t0 = Date.now()
    const res = await win.evaluate(async ([model, sizeReq, useBg, envBase, envKey]) => {
      let c = {}
      try { c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}') } catch {}
      // 环境注入（envBase/envKey）优先于沙盒存量配置——密钥只在内存中流转，不落 localStorage
      let apiKey = envKey || c.illustApiKey || c.apiKey || ''
      if (!envKey) {
        try {
          const sec = await window.api.loadSecrets()
          if (sec && sec.ok && sec.secrets && sec.secrets.illustApiKey) apiKey = sec.secrets.illustApiKey
        } catch {}
      }
      const baseUrl = envBase || c.illustBaseUrl
      if (!baseUrl || !apiKey) return { error: '沙盒未配置生图端点' }
      const r = await window.api.generateImage({
        baseUrl, apiKey, model,
        prompt: 'A small red apple on plain white background, minimal test image',
        size: sizeReq, quality: 'default', background: useBg ? 'transparent' : '', n: 1
      })
      if (!r || !r.ok) return { error: (r && r.error) || '未知错误' }
      // alpha 检测（与 holo-card hasTransparency 同逻辑）
      const alphaInfo = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          try {
            const W = Math.min(64, img.naturalWidth), H = Math.min(64, img.naturalHeight)
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H
            const d = cv.getContext('2d'); d.drawImage(img, 0, 0, W, H)
            const px = d.getImageData(0, 0, W, H).data
            let trans = 0
            for (let i = 3; i < px.length; i += 4) if (px[i] < 250) trans++
            resolve({ w: img.naturalWidth, h: img.naturalHeight, transparent: trans / (W * H) >= 0.03, transRatio: (trans / (W * H)).toFixed(3) })
          } catch (e) { resolve({ transparent: false, err: String(e) }) }
        }
        img.onerror = () => resolve({ transparent: false, err: 'decode fail' })
        img.src = r.dataUrl
      })
      return { ok: true, sizeReq, bgReq: useBg, alphaInfo, revised: r.revisedPrompt || '', cost: (r.cost != null ? r.cost : (r.usage && r.usage.cost) != null ? r.usage.cost : null) }
    }, [MODEL, SIZE, USE_BG, process.env.PROBE_BASE, process.env.PROBE_KEY]).catch((e) => ({ error: String((e && e.message) || e) }))
    const ms = Date.now() - t0

    if (res.error) { log('FAIL 模型=' + MODEL + ' | ' + String(res.error).slice(0, 300) + ' | ' + ms + 'ms'); process.exitCode = 1; return }
    log('PASS 模型=' + MODEL + ' 可用 | 耗时 ' + ms + 'ms')
    log('  透明背景：' + (res.alphaInfo.transparent ? '生效 ✓（透明像素占比 ' + res.alphaInfo.transRatio + '）' : '未生效 ✗（' + JSON.stringify(res.alphaInfo) + '）'))
    log('  模型改写：' + (res.revised ? '有 ✓ → ' + String(res.revised).slice(0, 120) : '无（端点未回传 revised_prompt）'))
    log('  计费：' + (res.cost != null ? res.cost : '未回传') + ' | 尺寸 ' + res.alphaInfo.w + 'x' + res.alphaInfo.h)
  } finally { await app.close().catch(() => {}) }
}

main().catch((e) => { console.error('[probe] 异常：', e); process.exit(1) })

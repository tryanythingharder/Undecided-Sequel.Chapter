/* 沙盒内查询真实生图端点的模型目录（GET /models，只读、不打印密钥）
 * 用途：确认 gpt-image-2.5 系列是否可用（gpt_image_playground 实测用户端点支持）。
 * 用法：node scripts-dev/realtest-models.cjs [过滤词]
 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')
const FILTER = process.argv[2] || ''

function log(...a) { console.log('[models]', ...a) }

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
    } catch (e) { log('启动失败（第 ' + i + ' 次）'); await new Promise((r) => setTimeout(r, 3000)) }
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

    const res = await win.evaluate(async ([filter, envBase, envKey]) => {
      let c = {}
      try { c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}') } catch {}
      const baseUrl = envBase || c.illustBaseUrl || ''
      let apiKey = envKey || c.illustApiKey || ''
      if (!envKey) { try { const sec = await window.api.loadSecrets(); if (sec && sec.ok && sec.secrets && sec.secrets.illustApiKey) apiKey = sec.secrets.illustApiKey } catch {} }
      if (!baseUrl || !apiKey) return { error: '沙盒未配置生图端点' }
      const r = await window.api.testEndpoint({ baseUrl, apiKey })
      if (!r || !r.ok) return { error: (r && r.error) || 'testEndpoint 失败' }
      const all = r.models || []
      return { total: all.length, models: all.filter((m) => !filter || String(m).toLowerCase().includes(filter)) }
    }, [FILTER.toLowerCase(), process.env.PROBE_BASE || '', process.env.PROBE_KEY || '']).catch((e) => ({ error: String(e) }))

    if (res.error) { log('FAIL ' + res.error); process.exitCode = 1; return }
    log('模型总数：' + res.total + (FILTER ? '（过滤 "' + FILTER + '"）' : ''))
    for (const m of res.models) log('  ' + m)
  } finally { await app.close().catch(() => {}) }
}

main().catch((e) => { console.error('[models] 异常：', e); process.exit(1) })

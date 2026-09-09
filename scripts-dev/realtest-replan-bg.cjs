/* 只重跑 pet:agent 'card' 规划（文本 LLM 一次调用，零生图成本）
 *
 * 用途：改了卡面提示词规范后，在真实模型上验证新规范的实际产出，不必花图像额度。
 * 沙盒启动方式与 realtest-holo.cjs 一致（APPDATA 指向 test-shots/realtest-appdata，
 * 用户真实 userData 与运行中的实例完全不受影响）。绝不打印密钥。
 *
 * 产物：test-shots/refined-plan-bg2.json
 * 用法：node scripts-dev/realtest-replan-bg.cjs [角色名]
 */
const path = require('node:path')
const fs = require('node:fs')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const ROOT = path.join(__dirname, '..')
const SANDBOX_APPDATA = path.join(ROOT, 'test-shots', 'realtest-appdata')
const OUT = path.join(ROOT, 'test-shots', 'refined-plan-bg2.json')
const TARGET_NAME = process.argv[2] || '玩家角色'
// --cast-file=<path>：直接用给定角色档案文本（不回查引擎），用于复现某张已验收卡的角色
const castArg = process.argv.find((a) => a.startsWith('--cast-file='))
const CAST_FILE = castArg ? castArg.slice('--cast-file='.length) : null

function log(...a) { console.log('[replan]', ...a) }

function purgeSandboxCaches() {
  const ud = path.join(SANDBOX_APPDATA, '六面世界')
  for (const d of ['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GraphiteDawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'DIPS', 'Crashpad']) {
    try { fs.rmSync(path.join(ud, d), { recursive: true, force: true }) } catch {}
  }
  for (const f of ['lockfile', 'DevToolsActivePort', 'DIPS-wal']) {
    try { fs.rmSync(path.join(ud, f), { force: true }) } catch {}
  }
}

async function main() {
  let app = null
  let launchErr = null
  for (let attempt = 1; attempt <= 3 && !app; attempt++) {
    purgeSandboxCaches()
    try {
      app = await electron.launch({
        executablePath: electronExecutable,
        args: [path.join(__dirname, 'realtest-entry.cjs'), '--disable-gpu-shader-disk-cache'],
        cwd: ROOT,
        env: { ...process.env, APPDATA: SANDBOX_APPDATA, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
      })
    } catch (e) {
      launchErr = e
      log('启动失败（第 ' + attempt + ' 次）：' + String((e && e.message) || e).split('\n')[0])
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
  if (!app) throw launchErr || new Error('三次启动均失败')

  try {
    let win = await app.firstWindow()
    await win.waitForTimeout(3000).catch(() => {})
    for (let i = 0; i < 5; i++) {
      const alive = await win.evaluate(() => true).catch(() => false)
      if (alive) break
      const ws = app.windows()
      win = ws[ws.length - 1]
      await win.waitForTimeout(1500).catch(() => {})
    }
    // 真实路径有 splash，Enter 立即收尾
    await win.locator('#splash').waitFor({ state: 'attached', timeout: 5000 }).catch(() => null)
    await win.keyboard.press('Enter').catch(() => {})
    await win.locator('#splash').waitFor({ state: 'detached', timeout: 9000 }).catch(() => null)
    await win.locator('#btn-gallery').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
    await win.waitForTimeout(2000)

    const res = await win.evaluate(async ({ targetName, fixedCast }) => {
      // 只读取配置用于本次调用，绝不回传密钥
      let c = {}
      try { c = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}') } catch {}
      // 密钥走 DPAPI safeStorage（localStorage 只存非敏感配置）
      let apiKey = c.apiKey || ''
      try {
        const sec = await window.api.loadSecrets()
        if (sec && sec.ok && sec.secrets && sec.secrets.apiKey) apiKey = sec.secrets.apiKey
      } catch {}
      const cloud = (c.baseUrl && apiKey && c.model)
        ? { baseUrl: c.baseUrl, apiKey, model: c.model } : null
      if (!cloud) return { error: '沙盒没有可用的文本模型配置（baseUrl/model/密钥缺一）' }

      let castText = fixedCast
      let sid = '(fixture)'
      let picked = targetName
      if (!castText) {
        const r = await window.api.loadSessions()
        const list = (r && r.sessions) || []
        const ids = [c.currentSessionId, ...list.map((s) => s.id)].filter(Boolean)
        let src = null
        for (const id of ids) {
          const cr = await window.api.engineCardSource({ storyId: id })
          if (cr && cr.ok && cr.data && cr.data.characters && cr.data.characters.length) { src = cr.data; sid = id; break }
        }
        if (!src) return { error: '沙盒会话里没有 character 实体' }

        const ch = src.characters.find((x) => x.name === targetName) || src.characters[0]
        picked = ch.name
        // 与 shared/holo-card.js castTextOf 逐字一致
        const parts = ['【角色档案】']
        parts.push('名字：' + ch.name)
        if (ch.summary) parts.push('简介：' + ch.summary)
        if (ch.state) parts.push('状态：' + ch.state)
        if (ch.tags && ch.tags.length) parts.push('标签：' + ch.tags.join('、'))
        if (ch.facts && ch.facts.length) { parts.push('相关事实：'); for (const f of ch.facts.slice(0, 10)) parts.push('- ' + f.statement) }
        if (ch.relationships && ch.relationships.length) {
          parts.push('关系网：')
          for (const rel of ch.relationships.slice(0, 8)) parts.push('- 与 ' + rel.with + '：' + rel.type + (rel.strength != null ? '（强度 ' + rel.strength + '）' : ''))
        }
        if (ch.events && ch.events.length) { parts.push('重要经历：'); for (const e of ch.events.slice(0, 6)) parts.push('- 第' + e.turn + '回合：' + e.description) }
        castText = parts.join('\n').slice(0, 6000)
      }

      const t0 = Date.now()
      const pr = await window.api.petAgent({ task: 'card', story: '', castText, cloud })
      return { sid, name: picked, ms: Date.now() - t0, ok: pr && pr.ok, error: pr && pr.error, plan: pr && pr.plan }
    }, { targetName: TARGET_NAME, fixedCast: CAST_FILE ? fs.readFileSync(CAST_FILE, 'utf8') : null })
      .catch((e) => ({ error: String((e && e.message) || e) }))

    if (!res || !res.ok) {
      log('FAIL 规划未成功：' + ((res && res.error) || '未知'))
      process.exitCode = 1
      return
    }
    fs.writeFileSync(OUT, JSON.stringify(res.plan, null, 2))
    log('PASS 规划成功 | 角色=' + res.name + ' | 会话=' + res.sid + ' | 耗时=' + res.ms + 'ms')
    log('--- subjectPrompt (' + res.plan.subjectPrompt.length + ' 字符) ---')
    log(res.plan.subjectPrompt)
    log('--- backgroundPrompt (' + res.plan.backgroundPrompt.length + ' 字符) ---')
    log(res.plan.backgroundPrompt)
    log('--- 文案 ---')
    log('称号 ' + res.plan.subtitle + ' | 招式 ' + res.plan.technique + ' | ' + res.plan.tagline)
    log('产物：' + OUT)
  } finally {
    await app.close().catch(() => {})
  }
}

main().catch((e) => { console.error('[replan] 异常：', e); process.exit(1) })

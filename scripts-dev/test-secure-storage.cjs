'use strict'
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { _electron: electron } = require('playwright')
const electronExecutable = require('electron')

const root = path.join(__dirname, '..')
const profile = path.resolve(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '六面世界', 'test-profile-storage')
if (path.basename(profile) !== 'test-profile-storage') throw new Error('拒绝清理非测试目录: ' + profile)
fs.rmSync(profile, { recursive: true, force: true })

async function main() {
  const app = await electron.launch({
    executablePath: electronExecutable,
    args: ['.'],
    cwd: root,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', SIXWORLDS_STORAGE_TEST: '1' }
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(1000)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69s6xQAAAABJRU5ErkJggg=='
    await win.evaluate(async ({ png }) => {
      await window.api.clearSessions()
      const ws = 'w-storage-test'
      localStorage.setItem('sixworlds.codex.state.v3', JSON.stringify({
        apiKey: 'sk-storage-plaintext-test', illustApiKey: 'sk-image-plaintext-test',
        currentWsId: ws, currentSessionId: 's-storage-test', skipSplash: true
      }))
      localStorage.setItem('sixworlds.workspaces.v1', JSON.stringify([{ id: ws, name: '存储测试', createdAt: Date.now() }]))
      localStorage.setItem('sixworlds.sessions.v2', JSON.stringify([{
        id: 's-storage-test', ws, title: '安全存储测试', createdAt: Date.now(), updatedAt: Date.now(),
        messages: [{ role: 'assistant', content: '持久化内容', illust: png }]
      }]))
    }, { png })
    await win.reload()
    await win.waitForTimeout(1800)

    const result = await win.evaluate(async () => {
      const cfg = JSON.parse(localStorage.getItem('sixworlds.codex.state.v3') || '{}')
      const stored = await window.api.loadSessions()
      const secrets = await window.api.loadSecrets()
      const source = stored.sessions[0].messages[0].illust
      const imageLoaded = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img.naturalWidth === 1 && img.naturalHeight === 1)
        img.onerror = () => resolve(false)
        img.src = source
      })
      return { cfg, localSessions: localStorage.getItem('sixworlds.sessions.v2'), stored, secrets, source, imageLoaded }
    })

    const checks = [
      ['localStorage 不再含文本密钥', !('apiKey' in result.cfg) && !('illustApiKey' in result.cfg)],
      ['localStorage 会话副本已移除', result.localSessions === null],
      ['文件会话可恢复', result.stored.ok && result.stored.sessions.length === 1],
      ['插图已外置为受限资源 URL', String(result.source).startsWith('sixworlds-asset://image/')],
      ['外置插图可真实加载', result.imageLoaded],
      ['系统安全存储可解密密钥', result.secrets.ok && result.secrets.secrets.apiKey === 'sk-storage-plaintext-test']
    ]
    for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
    if (checks.some((x) => !x[1])) throw new Error('安全存储回归失败')

    const secretRaw = fs.readFileSync(path.join(profile, 'secrets.json'), 'utf8')
    const sessionsRaw = fs.readFileSync(path.join(profile, 'session-data', 'sessions.json'), 'utf8')
    if (secretRaw.includes('sk-storage-plaintext-test')) throw new Error('密钥文件泄露明文')
    if (sessionsRaw.includes('base64') || sessionsRaw.includes(png.slice(30))) throw new Error('会话 JSON 仍内嵌插图')
    console.log('PASS  磁盘密钥为密文且会话 JSON 不含 base64 插图')

    const perf = await win.evaluate(async () => {
      const messages = Array.from({ length: 5000 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user', content: '第 ' + i + ' 条长期历史：边城、旧约与选择仍需被保存。'
      }))
      const session = { id: 's-storage-perf', ws: 'w-storage-test', title: '五千条存储基准', createdAt: Date.now(), updatedAt: Date.now(), messages }
      const t0 = performance.now()
      const saved = await window.api.saveSessions([session])
      const saveMs = performance.now() - t0
      const t1 = performance.now()
      const loaded = await window.api.loadSessions()
      const loadMs = performance.now() - t1
      return { saved, saveMs, loadMs, count: loaded.sessions[0]?.messages?.length || 0 }
    })
    const perfOk = perf.saved.ok && perf.count === 5000 && perf.saveMs < 2000 && perf.loadMs < 1000
    console.log((perfOk ? 'PASS' : 'FAIL') + '  文件会话 5000 条保存/加载性能  ' + JSON.stringify(perf))
    if (!perfOk) throw new Error('文件会话性能回归')
  } finally {
    await app.close().catch(() => {})
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })

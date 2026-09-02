const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell, Notification, safeStorage, protocol, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{
  scheme: 'sixworlds-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true }
}])

// 测试隔离：scripts-dev 下的 Playwright 脚本以 SIXWORLDS_TEST=1 启动时，
// 使用独立的 userData 档案目录，localStorage 等持久化与真实使用完全隔离，
// 绝不会清掉/覆盖用户手工配置的模型与密钥。
if (process.env.SIXWORLDS_TEST || process.env.SIXWORLDS_STORAGE_TEST) {
  const profile = process.env.SIXWORLDS_STORAGE_TEST ? 'test-profile-storage' : 'test-profile'
  app.setPath('userData', path.join(app.getPath('userData'), profile))
}

const KERNEL_DEFAULT = path.join(__dirname, 'kernel.md')
const MAX_KERNEL_BYTES = 1024 * 1024
const MAX_CONFIG_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_CHAT_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_BATCH = 100
const MAX_SESSIONS_JSON_BYTES = 64 * 1024 * 1024
const MAX_SESSIONS = 50
let win = null
let settingsWin = null

function atomicWriteFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, data)
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    try { fs.rmSync(file, { force: true }) } catch {}
    try { fs.renameSync(tmp, file) } catch (renameError) {
      try { fs.rmSync(tmp, { force: true }) } catch {}
      throw renameError
    }
  }
}

function readTextFileLimited(file, maxBytes, label) {
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error((label || '文件') + '不是普通文件')
  if (stat.size > maxBytes) throw new Error((label || '文件') + '过大（上限 ' + Math.floor(maxBytes / 1024) + 'KB）')
  return fs.readFileSync(file, 'utf8')
}

async function readResponseBufferLimited(response, maxBytes, label) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error((label || '响应') + '过大')
  if (!response.body || !response.body.getReader) {
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.length > maxBytes) throw new Error((label || '响应') + '过大')
    return buf
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try { await reader.cancel() } catch {}
      throw new Error((label || '响应') + '过大')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

function sessionDataDir() { return path.join(app.getPath('userData'), 'session-data') }
function sessionImagesDir() { return path.join(sessionDataDir(), 'images') }
function sessionsFile() { return path.join(sessionDataDir(), 'sessions.json') }
function secretsFile() { return path.join(app.getPath('userData'), 'secrets.json') }

function hashText(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex')
}

function dataUrlImage(value) {
  const m = String(value || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (!m) throw new Error('无效或不支持的图像数据')
  const estimated = Math.floor(m[2].replace(/[\r\n]/g, '').length * 3 / 4)
  if (estimated > MAX_IMAGE_BYTES) throw new Error('单张插图过大（上限 25MB）')
  const buffer = Buffer.from(m[2], 'base64')
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('单张插图过大或数据无效')
  const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg')
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.slice(6)
  return { buffer, mime, ext }
}

function imageAssetRel(value) {
  try {
    const u = new URL(String(value || ''))
    if (u.protocol !== 'sixworlds-asset:' || u.hostname !== 'image') return null
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/\\/g, '/')
    return /^[a-f0-9]{24}\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(rel) ? rel : null
  } catch { return null }
}

function imageAssetUrl(rel) {
  return 'sixworlds-asset://image/' + String(rel).split('/').map(encodeURIComponent).join('/')
}

function resolveImageAsset(rel) {
  if (!/^[a-f0-9]{24}\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(String(rel || ''))) throw new Error('非法插图引用')
  const root = path.resolve(sessionImagesDir())
  const target = path.resolve(root, String(rel))
  if (!target.startsWith(root + path.sep)) throw new Error('插图路径越界')
  const stat = fs.statSync(target)
  if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('插图文件无效或过大')
  return target
}

function imageSource(value) {
  const rel = imageAssetRel(value)
  if (rel) {
    const file = resolveImageAsset(rel)
    const ext = path.extname(file).toLowerCase()
    const mime = ext === '.jpg' ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : 'image/png')
    return { buffer: fs.readFileSync(file), mime, ext: ext.slice(1) }
  }
  return dataUrlImage(value)
}

function externalizeSessions(input) {
  if (!Array.isArray(input)) throw new Error('会话数据格式不正确')
  if (input.length > MAX_SESSIONS) throw new Error('会话数量超过上限（50）')
  const sessions = JSON.parse(JSON.stringify(input))
  const assets = new Set()
  let imageCount = 0
  for (const session of sessions) {
    if (!session || typeof session !== 'object' || !Array.isArray(session.messages)) throw new Error('会话数据不完整')
    if (session.messages.length > 5000) throw new Error('单条世界线消息过多')
    const sessionDir = hashText(session.id || 'unknown').slice(0, 24)
    for (const message of session.messages) {
      if (!message || typeof message !== 'object') continue
      if (!message.illust) {
        delete message.illustAsset
        continue
      }
      let rel = imageAssetRel(message.illust)
      if (!rel) {
        const img = dataUrlImage(message.illust)
        const digest = hashText(img.buffer)
        rel = sessionDir + '/' + digest + '.' + img.ext
        const target = path.join(sessionImagesDir(), rel)
        if (!fs.existsSync(target)) atomicWriteFile(target, img.buffer)
      } else {
        resolveImageAsset(rel)
      }
      imageCount++
      if (imageCount > 2000) throw new Error('插图数量超过上限（2000）')
      assets.add(rel)
      message.illustAsset = rel
      delete message.illust
    }
  }
  const json = JSON.stringify({ v: 1, sessions })
  if (Buffer.byteLength(json) > MAX_SESSIONS_JSON_BYTES) throw new Error('会话文本数据过大（上限 64MB，不含插图）')
  return { sessions, assets, json }
}

function hydrateSessions(stored) {
  const sessions = Array.isArray(stored) ? stored : []
  for (const session of sessions) {
    if (!session || !Array.isArray(session.messages)) continue
    for (const message of session.messages) {
      if (!message || !message.illustAsset) continue
      try {
        resolveImageAsset(message.illustAsset)
        message.illust = imageAssetUrl(message.illustAsset)
      } catch {
        delete message.illust
        delete message.illustAsset
        message.illustError = '本地插图文件缺失或损坏'
      }
    }
  }
  return sessions
}

function progressSessions(input) {
  const sessions = JSON.parse(JSON.stringify(Array.isArray(input) ? input : []))
  for (const session of sessions) {
    if (!session || !Array.isArray(session.messages)) continue
    for (const message of session.messages) {
      if (!message) continue
      // 移动端进度包只同步叙事与结构化状态；插图留在桌面图库，避免数百 MB 的 base64 JSON。
      delete message.illust
      delete message.illustAsset
    }
  }
  return sessions
}

function cleanupSessionImages(keep) {
  const root = sessionImagesDir()
  if (!fs.existsSync(root)) return
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || !/^[a-f0-9]{24}$/.test(dir.name)) continue
    const fullDir = path.join(root, dir.name)
    for (const file of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const rel = dir.name + '/' + file.name
      if (file.isFile() && !keep.has(rel)) fs.rmSync(path.join(fullDir, file.name), { force: true })
    }
    try { if (fs.readdirSync(fullDir).length === 0) fs.rmdirSync(fullDir) } catch {}
  }
}

function loadSecrets() {
  if (!fs.existsSync(secretsFile())) return { apiKey: '', illustApiKey: '' }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
  const raw = readTextFileLimited(secretsFile(), 128 * 1024, '密钥文件')
  const doc = JSON.parse(raw)
  if (!doc || doc.v !== 1 || typeof doc.payload !== 'string') throw new Error('密钥文件格式不正确')
  const decrypted = safeStorage.decryptString(Buffer.from(doc.payload, 'base64'))
  const value = JSON.parse(decrypted)
  return {
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    illustApiKey: typeof value.illustApiKey === 'string' ? value.illustApiKey : ''
  }
}

function saveSecrets(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，密钥未保存')
  const payload = {
    apiKey: String((value && value.apiKey) || '').slice(0, 16384),
    illustApiKey: String((value && value.illustApiKey) || '').slice(0, 16384)
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(payload)).toString('base64')
  atomicWriteFile(secretsFile(), JSON.stringify({ v: 1, payload: encrypted }))
  return true
}

// 按调用方定位窗口：设置窗口里的对话框/窗口控制应作用于设置窗口本身
function windowForEvent(evt) {
  const w = evt ? BrowserWindow.fromWebContents(evt.sender) : null
  return (w && !w.isDestroyed()) ? w : win
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 380,
    minHeight: 300,
    frame: false,
    backgroundColor: '#161618',
    show: false,
    title: '六面世界',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.loadFile(uiSchemeEntry())
  win.once('ready-to-show', () => win.show())
  watchTopmost(win)
  // 链接接管：内容中的 URL 一律用系统默认浏览器打开，绝不许在应用内导航（防白屏/游离窗口）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault()
      if (/^https?:/i.test(url)) shell.openExternal(url)
    }
  })
  // 渲染进程崩溃/无响应兜底：自动重载，恢复到崩溃前状态（localStorage 持久化）
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    try { win.webContents.reload() } catch {}
  })
  win.webContents.on('unresponsive', () => {
    try { win.webContents.forcefullyCrashRenderer() } catch {}
  })
  // 生成中关闭确认（渲染层 busy 时通过 'chat:busy' 查询）：避免误关丢掉正在生成的回合
  let rendererBusy = false
  ipcMain.on('chat:busy', (_e, v) => { rendererBusy = !!v })
  win.on('close', async (e) => {
    if (!rendererBusy) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: '正在生成中',
      message: '世界正在回应你的行动，关闭窗口将丢失正在生成的这一幕。',
      detail: '确定要关闭吗？',
      buttons: ['继续等待', '仍然关闭'],
      defaultId: 0,
      cancelId: 0
    })
    if (choice === 1) {
      rendererBusy = false
      // 取消挂起的生成请求再关
      for (const [, ctrl] of pendingChats) { try { ctrl.abort() } catch {} }
      pendingChats.clear()
      win.close()
    }
  })
  const emitMax = () => {
    if (win) win.webContents.send('window:maximized', win.isMaximized())
  }
  win.on('maximize', emitMax)
  win.on('unmaximize', emitMax)
  // 主窗口关闭时连带关闭设置窗口，避免应用空转
  win.on('closed', () => {
    win = null
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close()
  })
}

// ---- 设置：独立系统窗口（可拖动、可缩放） ----
function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    // R82：4:3 再等比缩小 40%（1024×768 → 614×461），按用户反馈
    width: 614,
    height: 461,
    minWidth: 500,
    minHeight: 380,
    frame: false,
    resizable: true,
    backgroundColor: '#161618',
    show: false,
    title: '设置 · 六面世界',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'))
  settingsWin.once('ready-to-show', () => settingsWin.show())
  watchTopmost(settingsWin)
  const emitMax = () => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('window:maximized', settingsWin.isMaximized())
    }
  }
  settingsWin.on('maximize', emitMax)
  settingsWin.on('unmaximize', emitMax)
  settingsWin.on('closed', () => {
    settingsWin = null
    // 未保存的预览（主题/置顶/字号等）需要回滚，通知主窗口恢复
    if (win && !win.isDestroyed()) win.webContents.send('cfg:updated', { revert: true })
  })
}

// ---- 单实例锁：防止多实例同时写同一份 localStorage 造成数据竞争 ----
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 第二个实例：聚焦已有窗口后退出
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// ---- 窗口位置/尺寸记忆（持久化到 userData/window-state.json） ----
function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window-state.json'), 'utf8'))
    if (st && Number.isFinite(st.x) && Number.isFinite(st.y) && Number.isFinite(st.width) && Number.isFinite(st.height)) return st
  } catch {}
  return null
}
function saveWindowState() {
  if (!win || win.isDestroyed() || win.isMinimized() || !win.isVisible()) return
  try {
    // 最大化时保存 maximized 标志而非当前尺寸
    const maximized = win.isMaximized()
    const b = maximized ? (lastNormalBounds || win.getNormalBounds()) : win.getBounds()
    lastNormalBounds = b
    fs.writeFileSync(path.join(app.getPath('userData'), 'window-state.json'), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }))
  } catch {}
}
let lastNormalBounds = null

// ---- 界面方案（经典 / 原型工作台，持久化到 userData/ui-scheme.json） ----
function readUiScheme() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'ui-scheme.json'), 'utf8'))
    return st && st.scheme === 'proto' ? 'proto' : 'classic'
  } catch {}
  return 'classic'
}
function writeUiScheme(scheme) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(path.join(app.getPath('userData'), 'ui-scheme.json'), JSON.stringify({ scheme }))
  } catch {}
}
function uiSchemeEntry() {
  return readUiScheme() === 'proto'
    ? path.join(__dirname, 'renderer-proto', 'index.html')
    : path.join(__dirname, 'renderer', 'index.html')
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'
  protocol.handle('sixworlds-asset', async (request) => {
    try {
      const rel = imageAssetRel(request.url)
      if (!rel) return new Response('Not found', { status: 404 })
      const file = resolveImageAsset(rel)
      const ext = path.extname(file).toLowerCase()
      const mime = ext === '.jpg' ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : 'image/png')
      const body = fs.readFileSync(file)
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Length': String(body.length), 'Cache-Control': 'private, max-age=31536000, immutable' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  createWindow()
  // 窗口状态持久化：大小变化/移动/关闭时保存（去抖）
  let stateTimer = null
  const debouncedSave = () => {
    clearTimeout(stateTimer)
    stateTimer = setTimeout(saveWindowState, 800)
  }
  if (win) {
    win.on('resize', debouncedSave)
    win.on('move', debouncedSave)
    win.on('maximize', debouncedSave)
    win.on('unmaximize', debouncedSave)
    win.on('close', saveWindowState)
    // 恢复上次状态
    const st = loadWindowState()
    if (st) {
      // 校验窗口在可见屏幕范围内（拔掉显示器后坐标可能悬空）
      const area = require('electron').screen.getDisplayMatching(st).workArea
      const onScreen = st.x >= area.x - 100 && st.x <= area.x + area.width && st.y >= area.y - 50 && st.y <= area.y + area.height
      if (onScreen) {
        win.setBounds({ x: st.x, y: st.y, width: st.width, height: st.height })
        if (st.maximized) win.maximize()
      }
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => {
  try { storyEngine?.close?.() } catch {}
  try { sessionsDb?.close?.() } catch {}
})

// ---- 诊断：语义索引状态（打包/用户环境排查用；引擎惰性创建，未初始化时返回 uninitialized） ----
ipcMain.handle('vector:stats', () => {
  try { return storyEngine?.vectorStore?.stats?.() || { enabled: false, uninitialized: true } }
  catch (e) { return { enabled: false, error: String((e && e.message) || e) }
  }
})

// ---- 真实嵌入模型配置（api-v1）：userData/embedder.json，引擎重启后生效 ----
ipcMain.handle('embedder:get', () => {
  const cfg = readEmbedderConfig()
  return { ok: true, embedder: (cfg && cfg.embedder) || 'hash-v1', baseUrl: cfg ? cfg.baseUrl || '' : '', model: cfg ? cfg.model || '' : '', dim: cfg ? cfg.dim || null : null, hasKey: !!(cfg && cfg.apiKey) }
})
ipcMain.handle('embedder:set', (_evt, input) => {
  try {
    const mode = input && input.embedder === 'api-v1' ? 'api-v1' : 'hash-v1'
    if (mode === 'api-v1') {
      const baseUrl = String(input.baseUrl || '').trim()
      const model = String(input.model || '').trim()
      const dim = Number(input.dim)
      const apiKey = String(input.apiKey || '').trim()
      if (!/^https?:\/\//.test(baseUrl)) throw new Error('嵌入端点必须是 http(s) URL')
      if (!model) throw new Error('嵌入模型名不能为空')
      if (!Number.isInteger(dim) || dim < 2 || dim > 4096) throw new Error('嵌入维度不正确（2~4096）')
      if (!apiKey) throw new Error('嵌入 API 密钥不能为空（api-v1 不缓存凭据外的任何东西）')
      atomicWriteFile(embedderConfigFile(), JSON.stringify({ embedder: mode, baseUrl, model, dim, apiKey }))
    } else {
      atomicWriteFile(embedderConfigFile(), JSON.stringify({ embedder: mode }))
    }
    return { ok: true, embedder: mode, restartRequired: !!storyEngine } // 引擎已建则需重启应用生效（版本水位自动全量重嵌）
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 界面方案切换（经典 / 原型工作台） ----
ipcMain.handle('ui-scheme:get', () => readUiScheme())

ipcMain.handle('ui-scheme:set', (evt, scheme) => {
  const next = scheme === 'proto' ? 'proto' : 'classic'
  writeUiScheme(next)
  // 立即把调用窗口切换到对应方案的入口（数据与设置两侧完全共享）
  const target = windowForEvent(evt)
  if (target && !target.isDestroyed()) target.loadFile(uiSchemeEntry())
  return next
})

// ---- 敏感配置与会话持久化 ----
ipcMain.handle('secrets:load', () => {
  try { return { ok: true, secrets: loadSecrets() } }
  catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})

ipcMain.handle('secrets:save', (_evt, value) => {
  try { saveSecrets(value); return { ok: true } }
  catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})

// ---- 会话持久化：SQLite 主存（sessions.db）+ JSON 镜像（sessions.json，移动端工具/人工恢复兼容面） ----
const { createSessionsDb } = require('./sessions-db.cjs')
let sessionsDb = null
function sessionsDbFor() {
  // 测试接缝：SIXWORLDS_TEST 下可强制禁用 SQLite 主存，验证纯文件降级路径（test-sessions-persistence）
  if (process.env.SIXWORLDS_TEST === '1' && process.env.SIXWORLDS_SESSIONS_DB === 'off') {
    return { enabled: false, load() { return null }, importDoc() {}, clear() {}, close() {} }
  }
  if (!sessionsDb) sessionsDb = createSessionsDb(app.getPath('userData'))
  return sessionsDb
}

let sessionSaveQueue = Promise.resolve()
ipcMain.handle('sessions:load', async () => {
  try {
    const db = sessionsDbFor()
    if (db.enabled) {
      // 1) SQLite 主存
      const fromDb = db.load()
      if (fromDb) {
        const doc = fromDb.doc
        const stored = Array.isArray(doc) ? doc : doc && doc.sessions
        if (!Array.isArray(stored) || stored.length > MAX_SESSIONS) throw new Error('会话库格式不正确')
        return { ok: true, exists: true, sessions: hydrateSessions(stored), storage: 'sqlite' }
      }
      // 2) 一次性迁移：主存为空且旧 JSON 存在 → 导入主存（JSON 镜像保留不删）
      const file = sessionsFile()
      if (fs.existsSync(file)) {
        const raw = readTextFileLimited(file, MAX_SESSIONS_JSON_BYTES, '会话文件')
        const doc = JSON.parse(raw)
        const stored = Array.isArray(doc) ? doc : doc.sessions
        if (!Array.isArray(stored) || stored.length > MAX_SESSIONS) throw new Error('会话文件格式不正确')
        db.importDoc(Array.isArray(doc) ? { v: 1, sessions: stored } : doc)
        return { ok: true, exists: true, sessions: hydrateSessions(stored), storage: 'migrated' }
      }
      return { ok: true, exists: false, sessions: [], storage: 'empty' }
    }
    // 3) 降级：纯文件路径（旧行为）
    const file = sessionsFile()
    if (!fs.existsSync(file)) return { ok: true, exists: false, sessions: [], storage: 'file' }
    const raw = readTextFileLimited(file, MAX_SESSIONS_JSON_BYTES, '会话文件')
    const doc = JSON.parse(raw)
    const stored = Array.isArray(doc) ? doc : doc.sessions
    if (!Array.isArray(stored) || stored.length > MAX_SESSIONS) throw new Error('会话文件格式不正确')
    return { ok: true, exists: true, sessions: hydrateSessions(stored), storage: 'file' }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

ipcMain.handle('sessions:save', (_evt, input) => {
  const task = async () => {
    const data = externalizeSessions(input)
    const db = sessionsDbFor()
    if (db.enabled) db.importDoc({ v: 1, sessions: data.sessions })
    atomicWriteFile(sessionsFile(), data.json) // JSON 镜像：兼容面保留（移动端工具/人工恢复）
    cleanupSessionImages(data.assets)
    return { ok: true, count: data.sessions.length, images: data.assets.size }
  }
  sessionSaveQueue = sessionSaveQueue.then(task, task)
  return sessionSaveQueue.catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
})

ipcMain.handle('sessions:clear', async () => {
  const task = async () => {
    const db = sessionsDbFor()
    if (db.enabled) db.clear()
    const file = sessionsFile()
    fs.rmSync(file, { force: true })
    fs.rmSync(sessionImagesDir(), { recursive: true, force: true })
    return { ok: true }
  }
  sessionSaveQueue = sessionSaveQueue.then(task, task)
  return sessionSaveQueue.catch((e) => ({ ok: false, error: String((e && e.message) || e) }))
})

ipcMain.handle('image:readDataUrl', (_evt, source) => {
  try {
    const img = imageSource(source)
    return { ok: true, dataUrl: 'data:' + img.mime + ';base64,' + img.buffer.toString('base64') }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 故事状态引擎（通用结构化状态 + 长期记忆 + 检索） ----
// 存储位于 userData/story-engine/（stories/snapshots/logs 分目录），与 localStorage 互补。
const { createEngine } = require('./engine/index')
let storyEngine = null
/* 真实嵌入模型配置（api-v1，OpenAI 兼容 /v1/embeddings）：userData/embedder.json，由设置页写入。
 * 引擎惰性创建时读取——改动配置重启后生效（版本水位自动全量重嵌）。 */
const embedderConfigFile = () => path.join(app.getPath('userData'), 'embedder.json')
function readEmbedderConfig() {
  try { return JSON.parse(fs.readFileSync(embedderConfigFile(), 'utf8')) } catch { return null }
}
function engineFor() {
  if (!storyEngine) {
    const ec = readEmbedderConfig()
    const apiEmbedder = (ec && ec.embedder === 'api-v1' && ec.baseUrl && ec.model && ec.dim && ec.apiKey)
      ? { baseUrl: String(ec.baseUrl), model: String(ec.model), dim: Number(ec.dim), apiKey: String(ec.apiKey) }
      : null
    storyEngine = createEngine(path.join(app.getPath('userData'), 'story-engine'), apiEmbedder ? { apiEmbedder } : undefined)
  }
  return storyEngine
}
const ENGINE_ID_RE = /^[A-Za-z0-9_-]{1,120}$/
function validateEnginePayload(channel, payload) {
  if (channel === 'engine:protocol') return
  if (!ENGINE_ID_RE.test(String(payload.storyId || ''))) throw new Error('非法 storyId')
  for (const key of ['pendingId', 'snapshotId', 'turnId']) {
    if (payload[key] != null && !ENGINE_ID_RE.test(String(payload[key]))) throw new Error('非法 ' + key)
  }
  for (const key of ['raw', 'kernelText', 'playerInput', 'intent']) {
    if (payload[key] != null && Buffer.byteLength(String(payload[key])) > MAX_CHAT_RESPONSE_BYTES) throw new Error(key + ' 过大')
  }
}
const safeHandle = (ch, fn) => ipcMain.handle(ch, async (_e, payload) => {
  try {
    const value = payload || {}
    validateEnginePayload(ch, value)
    return { ok: true, data: await fn(value) }
  }
  catch (e) { return { ok: false, error: String((e && e.message) || e) } }
})
safeHandle('engine:ensure', (p) => {
  const r = engineFor().ensureStory(p)
  return { story_id: p.storyId, created: r.created, kernel_version: r.kernel_version, kernel_match: r.kernel_match, turn: r.story.counters.turn }
})
safeHandle('engine:context', (p) => {
  // 条款 6/7/8：玩家 IPC 路径强制 PLAYER 级别 —— 渲染层传入的 includeSecrets/accessLevel 一律不授予秘密。
  // DEBUG 级完整状态走 engine:overview（Inspector 开发调试路径），普通玩家调用路径永不输出。
  if (p.accessLevel && String(p.accessLevel).toUpperCase() !== 'PLAYER') console.warn('[engine] context accessLevel 请求被钳制为 PLAYER（玩家路径）')
  const r = engineFor().buildContext(p.storyId, { playerInput: p.playerInput, entityNames: p.entityNames, limit: p.limit, accessLevel: 'PLAYER' })
  return { block: r.block, overview: r.overview, retrieved_ids: r.retrieved.retrieved_ids, context_size: r.block.length }
})
safeHandle('engine:commit', (p) => {
  const eng = engineFor()
  const r = eng.commitFromRaw(p.raw, {
    storyId: p.storyId, sessionId: p.sessionId, playerInput: p.playerInput,
    intent: p.intent, model: p.model, rawOutput: p.raw,
    retrievedIds: p.retrievedIds, contextSize: p.contextSize
  })
  // 条款 15/18/19/28：未正式提交且非显式 NO_STATE_CHANGE → 落 Pending Commit（重启可恢复）
  if (r.committed) {
    if (p.pendingId) { try { eng.discardPending({ storyId: p.storyId, pendingId: p.pendingId }); r.pending_resolved = true } catch {} }
    return r
  }
  if (r.patch_status === 'NO_STATE_CHANGE') return r
  try {
    if (p.pendingId) {
      const pc = eng.getPending(p.storyId, p.pendingId)
      if (pc) { // 重试仍未成功：更新既有 Pending（retry_count 递增，不另建）
        pc.retry_count = (pc.retry_count || 0) + (Number(p.retryCount) || 1)
        pc.patch_error = (r.errors && r.errors.length ? r.errors[0].message : (r.warnings[0] && r.warnings[0].message) || r.patch_status || 'unknown')
        pc.updated_at = Date.now()
        eng.store.savePending(pc)
        r.pending_id = pc.pending_id; r.pending_recorded = true
        return r
      }
    }
    const pc = eng.recordPending({
      storyId: p.storyId, sessionId: p.sessionId, playerInput: p.playerInput,
      narrative: r.narrative || p.raw, patchError: (r.errors && r.errors.length ? r.errors[0].message : (r.warnings[0] && r.warnings[0].message) || r.patch_status || ''),
      retryCount: Number(p.retryCount) || 0, turnId: r.turn_id, stateVersion: (eng.overview(p.storyId) || {}).engine_turn
    })
    r.pending_id = pc.pending_id; r.pending_recorded = true
  } catch (e) { r.pending_error = String((e && e.message) || e) }
  return r
})
// ---- Pending Commit 恢复 / 补录（条款 26/27） ----
safeHandle('engine:pendings', (p) => engineFor().listPendings(p.storyId))
safeHandle('engine:resolvePending', (p) => engineFor().resolvePending({ storyId: p.storyId, pendingId: p.pendingId, raw: p.raw }))
safeHandle('engine:discardPending', (p) => engineFor().discardPending({ storyId: p.storyId, pendingId: p.pendingId }))
safeHandle('engine:overview', (p) => engineFor().overview(p.storyId))
safeHandle('engine:snapshot', (p) => engineFor().snapshot(p.storyId, p.label))
safeHandle('engine:snapshots', (p) => engineFor().listSnapshots(p.storyId))
safeHandle('engine:restore', (p) => {
  engineFor().restoreSnapshot(p.storyId, p.snapshotId)
  return engineFor().overview(p.storyId)
})
safeHandle('engine:logs', (p) => engineFor().turnLogs(p.storyId))
safeHandle('engine:log', (p) => engineFor().turnLog(p.storyId, p.turnId))
safeHandle('engine:protocol', () => engineFor().protocolPrompt())
// 被抛弃的叙事留痕（重生成/IF 分歧丢弃上一版）—— 永不静默覆盖，只增不删
safeHandle('engine:discardTurn', (p) => {
  const story = engineFor().getStory(p.storyId)
  if (!story) return { recorded: false }
  story.discarded_turns.push({ at: Date.now(), reason: p.reason || 'regen', excerpt: String(p.excerpt || '').slice(0, 400) })
  if (story.discarded_turns.length > 200) story.discarded_turns = story.discarded_turns.slice(-200)
  story.updated_at = Date.now()
  engineFor().store.saveStory(p.storyId)
  return { recorded: true }
})

// ---- kernel ----
ipcMain.handle('kernel:read', async () => {
  const candidates = [KERNEL_DEFAULT]
  for (const p of candidates) {
    try {
      const text = readTextFileLimited(p, MAX_KERNEL_BYTES, '内核文件')
      return { ok: true, text, path: p, size: text.length }
    } catch { /* next */ }
  }
  return { ok: false, error: '未找到内核文件 kernel.md（应用目录）', path: KERNEL_DEFAULT }
})

ipcMain.handle('kernel:readPath', async (_evt, p) => {
  try {
    if (typeof p !== 'string' || !p.trim()) return { ok: false, error: '内核路径不能为空' }
    const text = readTextFileLimited(p, MAX_KERNEL_BYTES, '内核文件')
    return { ok: true, text, path: p, size: text.length }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})
ipcMain.handle('kernel:pick', async (evt) => {
  // 测试接缝：SIXWORLDS_TEST 下允许用环境变量注入所选内核文件（自动化无法驱动原生对话框）
  if (process.env.SIXWORLDS_TEST && process.env.SIXWORLDS_TEST_PICK) {
    try {
      const p = process.env.SIXWORLDS_TEST_PICK
      const text = readTextFileLimited(p, MAX_KERNEL_BYTES, '内核文件')
      return { ok: true, text, path: p, size: text.length }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }
  const res = await dialog.showOpenDialog(windowForEvent(evt), {
    title: '选择世界内核文件',
    filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false }
  const p = res.filePaths[0]
  try {
    const text = readTextFileLimited(p, MAX_KERNEL_BYTES, '内核文件')
    return { ok: true, text, path: p, size: text.length }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- kernel library（内核库：内置 + 用户自定义，通用多内核支持） ----
// 内核 id 体系：builtin:kernel.md / builtin:kernel-xianxia.md（随应用分发，只读）；
// user:<slug>（userData/kernels/<slug>.md，可在内核库中新建/编辑/删除）。
const KERNELS_DIR = () => {
  const d = path.join(app.getPath('userData'), 'kernels')
  fs.mkdirSync(d, { recursive: true })
  return d
}
const BUILTIN_KERNELS = [
  { id: 'builtin:kernel.md', file: path.join(__dirname, 'kernel.md'), name: '六面世界：人生模拟器' },
  { id: 'builtin:kernel-xianxia.md', file: path.join(__dirname, 'kernel-xianxia.md'), name: '玄寰界：修真人生模拟器' }
]
const KERNEL_SLUG_RE = /^[\w\u4e00-\u9fa5-]+$/
const kernelSlug = (s) => String(s || '').trim().toLowerCase()
  .replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

ipcMain.handle('kernels:list', async () => {
  const out = []
  for (const b of BUILTIN_KERNELS) {
    try {
      const st = fs.statSync(b.file)
      out.push({ id: b.id, name: b.name, source: 'builtin', size: st.size, mtime: st.mtimeMs })
    } catch { /* 内置缺失忽略 */ }
  }
  try {
    for (const f of fs.readdirSync(KERNELS_DIR())) {
      if (!f.endsWith('.md')) continue
      const full = path.join(KERNELS_DIR(), f)
      try {
        const st = fs.statSync(full)
        out.push({ id: 'user:' + f.slice(0, -3), name: f.slice(0, -3), source: 'user', size: st.size, mtime: st.mtimeMs })
      } catch { /* 单文件异常忽略 */ }
    }
  } catch { /* 目录读取失败忽略 */ }
  out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
  return { ok: true, kernels: out }
})

ipcMain.handle('kernels:read', async (_evt, id) => {
  try {
    const s = String(id || '')
    if (s.startsWith('builtin:')) {
      const b = BUILTIN_KERNELS.find((x) => x.id === s)
      if (!b) return { ok: false, error: '未知内置内核' }
      const text = readTextFileLimited(b.file, MAX_KERNEL_BYTES, '内核文件')
      return { ok: true, id: s, name: b.name, text, size: text.length }
    }
    if (s.startsWith('user:')) {
      const slug = s.slice(5)
      if (!KERNEL_SLUG_RE.test(slug)) return { ok: false, error: '非法内核 id' }
      const text = readTextFileLimited(path.join(KERNELS_DIR(), slug + '.md'), MAX_KERNEL_BYTES, '内核文件')
      return { ok: true, id: s, name: slug, text, size: text.length }
    }
    return { ok: false, error: '未知内核 id' }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

ipcMain.handle('kernels:save', async (_evt, payload) => {
  try {
    const t = String((payload && payload.text) || '')
    const nm = String((payload && payload.name) || '').trim()
    if (!nm) return { ok: false, error: '内核名称不能为空' }
    if (!t.trim()) return { ok: false, error: '内核内容不能为空' }
    if (t.length > 1024 * 1024) return { ok: false, error: '内核过大（上限 1MB）' }
    let slug
    const id = String((payload && payload.id) || '')
    if (id.startsWith('user:')) {
      slug = id.slice(5)
      if (!KERNEL_SLUG_RE.test(slug)) return { ok: false, error: '非法内核 id' }
    } else {
      slug = kernelSlug(nm)
      if (!slug || !KERNEL_SLUG_RE.test(slug)) return { ok: false, error: '内核名称需要包含中文、字母或数字' }
      if (fs.existsSync(path.join(KERNELS_DIR(), slug + '.md'))) return { ok: false, error: '内核库中已存在同名内核' }
    }
    fs.writeFileSync(path.join(KERNELS_DIR(), slug + '.md'), t, 'utf8')
    return { ok: true, id: 'user:' + slug, name: slug, size: t.length }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

ipcMain.handle('kernels:delete', async (_evt, id) => {
  try {
    const s = String(id || '')
    if (!s.startsWith('user:')) return { ok: false, error: '内置内核不可删除' }
    const slug = s.slice(5)
    if (!KERNEL_SLUG_RE.test(slug)) return { ok: false, error: '非法内核 id' }
    fs.rmSync(path.join(KERNELS_DIR(), slug + '.md'), { force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- chat: OpenAI-compatible chat/completions（流式优先，失败自动回退非流式） ----
// 流式期间通过 'chat:delta' 事件向渲染层增量推送文本，最终仍返回完整结果
// 支持中途取消：请求附带 reqId，渲染层可调用 chat:abort(reqId) 中止
const pendingChats = new Map() // reqId -> AbortController
ipcMain.handle('chat:send', async (_evt, cfg) => {
  try {
    // 内核设计 e2e 接缝：只响应 kd* 请求，不影响内容区聊天或真实运行。
    if (process.env.SIXWORLDS_TEST && process.env.SIXWORLDS_TEST_AI_REPLY && /^kd/.test(String(cfg.reqId || ''))) {
      return { ok: true, content: process.env.SIXWORLDS_TEST_AI_REPLY }
    }
    const baseUrl = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
    const apiKey = String(cfg.apiKey || '').trim()
    const model = String(cfg.model || '').trim()
    if (!baseUrl || !apiKey || !model) {
      return { ok: false, error: '请先在设置中填写 API 地址、密钥与模型。' }
    }
    const endpoint = new URL(baseUrl + '/chat/completions')
    if (!['http:', 'https:'].includes(endpoint.protocol)) return { ok: false, error: 'API 地址仅支持 HTTP / HTTPS' }
    const messages = Array.isArray(cfg.messages) ? cfg.messages : []
    // 注意：不再发送 temperature（端点默认值即最佳实践，设置中也已移除该项）
    const payload = {
      model,
      messages,
      stream: true,
      // 请求在末块返回 usage（OpenAI 兼容端点普遍支持；不支持的会忽略）
      stream_options: { include_usage: true }
    }
    // 思考程度（reasoning_effort）：OpenAI 兼容端点支持 low/medium/high；
    // 不支持的端点报错后会在下方自动去掉该参数重试一次（等效默认）
    const think = String(cfg.thinkLevel || 'default')
    const wantReasoning = think === 'low' || think === 'medium' || think === 'high'
    if (wantReasoning) payload.reasoning_effort = think
    // R78：增量合并后再发——部分端点一秒能推几十个碎块，逐条 IPC 会把渲染进程
    // 压出卡顿。这里按 50ms 窗口攒批，末尾在 finally 里强制冲刷，保证不丢尾字。
    let pendingDelta = ''
    let deltaTimer = null
    const flushDelta = () => {
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null }
      if (!pendingDelta) return
      const d = pendingDelta
      pendingDelta = ''
      if (win && !win.isDestroyed() && !cfg.silent) win.webContents.send('chat:delta', d) // silent：State Patch 补录重试不进 UI（条款 25）
    }
    const emit = (piece) => {
      pendingDelta += piece
      if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 50)
    }
    // 单次完整请求（fetch + 流式/非流式解析）；抽出便于「思考参数不被支持时」自动降级重试
    const runOnce = async () => {
      // 注意：controller/reqId 必须声明在 try 之外 —— 外层 finally 要引用它们
      const controller = new AbortController()
      const reqId = String(cfg.reqId || '')
      if (reqId) pendingChats.set(reqId, controller)
      const timeout = setTimeout(() => controller.abort(), 240000)
      try {
      let res
      const requestBody = JSON.stringify(payload)
      if (Buffer.byteLength(requestBody) > MAX_CHAT_RESPONSE_BYTES) return { ok: false, error: '请求上下文过大（上限 16MB）' }
      res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'Accept': 'text/event-stream'
          },
          body: requestBody,
          signal: controller.signal
        })

      // 非流式响应（或不支持 SSE 的端点）：按普通 JSON 处理
      const ctype = String(res.headers.get('content-type') || '')
      if (!ctype.includes('text/event-stream')) {
        const body = (await readResponseBufferLimited(res, MAX_CHAT_RESPONSE_BYTES, '文本接口响应')).toString('utf8')
        let data
        try { data = JSON.parse(body) } catch {
          return { ok: false, error: '非 JSON 响应 (' + res.status + '): ' + body.slice(0, 400) }
        }
        if (!res.ok) {
          return { ok: false, error: friendlyError(JSON.stringify(data && data.error ? data.error : (res.status + ' ' + body.slice(0, 400)))) }
        }
        const content = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content : ''
        if (typeof content !== 'string') return { ok: false, error: '响应缺少文本内容' }
        const usage = data && data.usage && typeof data.usage === 'object' ? data.usage : null
        return { ok: true, content, usage }
      }

      // 流式响应：逐行解析 SSE
      if (!res.ok) {
        const body = (await readResponseBufferLimited(res, 1024 * 1024, '错误响应')).toString('utf8')
        return { ok: false, error: 'HTTP ' + res.status + ' ' + body.slice(0, 400) }
      }
      let full = ''
      let usage = null
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let receivedBytes = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          receivedBytes += value.byteLength
          if (receivedBytes > MAX_CHAT_RESPONSE_BYTES) {
            controller.abort()
            throw new Error('流式响应过大（上限 16MB）')
          }
          buf += decoder.decode(value, { stream: true })
          if (buf.length > 2 * 1024 * 1024 && !buf.includes('\n')) throw new Error('流式响应单行过大')
          const lines = buf.split('\n')
          buf = lines.pop() // 末行可能不完整，留待下一块
          for (const line of lines) {
            const s = line.trim()
            if (!s.startsWith('data:')) continue
            const chunk = s.slice(5).trim()
            if (!chunk || chunk === '[DONE]') continue
            try {
              const j = JSON.parse(chunk)
              const delta = j && j.choices && j.choices[0] && j.choices[0].delta
              const piece = delta && typeof delta.content === 'string' ? delta.content : ''
              if (piece) { full += piece; emit(piece) }
              // 末块常带 usage（choices 为空数组或省略）
              if (j && j.usage && typeof j.usage === 'object') usage = j.usage
            } catch { /* 跳过坏块 */ }
          }
        }
      } catch (e) {
        // 中途取消（AbortController）→ 返回已累积的部分文本，标记 aborted
        if (controller.signal.aborted) return { ok: true, aborted: true, content: full, usage }
        // 网络中断但已有部分文本 → 保留（半段叙事总比全丢好），标记 aborted 让渲染层提示
        if (full) return { ok: true, aborted: true, content: full, usage, partial: true }
        throw e
      }
      if (!full) return { ok: false, error: '流式响应中没有收到文本内容' }
      return { ok: true, content: full, usage }
      } finally {
        clearTimeout(timeout)
        // 冲刷残余增量（保证最后一截文字在返回前送达渲染层），再清理 reqId
        flushDelta()
        // 整个请求（含 SSE 流消费完毕或中断）结束后才清理，流式期间「停止生成」始终可命中
        if (reqId) pendingChats.delete(reqId)
      }
    }

    let result = await runOnce()
    // 提供商不支持 reasoning_effort（思考程度）时：去掉参数自动重试一次（等效默认档）
    if (result && !result.ok && wantReasoning && payload.reasoning_effort) {
      const errText = String(result.error || '')
      if (/reasoning|thinking|unsupported|not support|invalid|unknown|extra_forbidden|unrecognized|unexpected.?field|not.?allowed/i.test(errText)) {
        delete payload.reasoning_effort
        result = await runOnce()
      }
    }
    return result
  } catch (e) {
    // 顶层中止：也当作返回部分内容
    if (e && (e.name === 'AbortError' || (e.message && /aborted/i.test(e.message)))) {
      return { ok: true, aborted: true, content: '' }
    }
    return { ok: false, error: friendlyError(String((e && e.message) || e)) }
  }
})

// ---- chat:send 的错误文案本地化（常见网络/HTTP 错误 → 中文提示） ----
function friendlyError(msg) {
  const m = String(msg || '')
  if (/abort/i.test(m)) return '请求被中止'
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|timed?\s?out/i.test(m)) return '连接超时：服务器没有及时响应，请检查网络或稍后重试'
  if (/ECONNREFUSED/i.test(m)) return '无法连接到服务器：请检查 API 地址是否正确、服务是否在线'
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return '域名解析失败：请检查 API 地址拼写'
  if (/ECONNRESET|EPIPE|socket hang up/i.test(m)) return '网络连接中断：请稍后重试'
  if (/certificate|SSL|TLS/i.test(m)) return '证书校验失败：请检查 API 地址是否为有效 https 站点'
  if (/401|Unauthorized/i.test(m)) return '鉴权失败（401）：请检查 API 密钥是否正确'
  if (/403|Forbidden/i.test(m)) return '无权限（403）：该密钥无权访问此模型或端点'
  if (/404|Not Found/i.test(m)) return '接口不存在（404）：请检查 API 地址是否包含 /v1 以及模型名'
  if (/429|Too Many Requests|rate limit/i.test(m)) return '请求过于频繁（429）：请稍等片刻再试'
  if (/does not support image input|不支持图像输入/i.test(m)) return '当前模型不支持读取图片——六面世界不会向对话端点发送图片，该错误来自模型服务管道；可更换支持视觉的模型或直接忽略'
  if (/500|502|503|504|Internal Server|Bad Gateway|Service Unavailable/i.test(m)) return '服务端错误（5xx）：请稍后重试或更换端点'
  return m
}

// ---- 中途取消当前生成 ----
ipcMain.handle('chat:abort', (_evt, reqId) => {
  // 传入了 reqId：只精确取消该请求；未命中（已结束/过期）不误伤其它在途请求
  if (reqId) {
    const c = pendingChats.get(String(reqId))
    if (c) {
      try { c.abort() } catch { /* noop */ }
      return true
    }
    return false
  }
  // 没有 reqId 则取消所有（兼容旧调用）
  for (const [, ctrl] of pendingChats) { try { ctrl.abort() } catch {} }
  pendingChats.clear()
  return false
})

// ---- image: OpenAI-compatible images/generations ----
// 统一返回 data URL（远程图片由主进程拉取后转 base64，渲染层 CSP 只需允许 data:）
ipcMain.handle('image:generate', async (_evt, cfg) => {
  try {
    const baseUrl = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
    const apiKey = String(cfg.apiKey || '').trim()
    const model = String(cfg.model || '').trim()
    const prompt = String(cfg.prompt || '').trim()
    const size = /^\d{3,4}x\d{3,4}$/.test(String(cfg.size)) ? cfg.size : '1024x1024'
    if (!baseUrl || !apiKey || !model || !prompt) {
      return { ok: false, error: '图像模型未配置完整（地址 / 密钥 / 模型 / 提示词）。' }
    }
    const endpoint = new URL(baseUrl + '/images/generations')
    if (!['http:', 'https:'].includes(endpoint.protocol)) return { ok: false, error: 'API 地址仅支持 HTTP / HTTPS' }
    const payload = { model, prompt, size, n: Math.min(4, Math.max(1, Number(cfg.n) || 1)) }
    // 可选参数：反向提示词 / 种子（部分端点支持，按需透传）
    if (String(cfg.negative || '').trim()) payload.negative_prompt = String(cfg.negative).trim()
    if (cfg.seedLock && Number.isFinite(Number(cfg.seed)) && String(cfg.seed) !== '') {
      payload.seed = Number(cfg.seed)
    }
    // 清晰度（quality）：default 不传（沿用端点默认值，即现有行为），standard/high 透传给支持的端点
    const quality = String(cfg.quality || 'default')
    if (quality === 'standard' || quality === 'high' || quality === 'low') payload.quality = quality
    // 额外参数（response_format 等），按需透传
    if (cfg.extra && typeof cfg.extra === 'object') Object.assign(payload, cfg.extra)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000)
    let res
    let body
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      body = (await readResponseBufferLimited(res, MAX_IMAGE_BYTES * 2, '图像接口响应')).toString('utf8')
    } finally {
      clearTimeout(timeout)
    }
    let data
    try { data = JSON.parse(body) } catch {
      return { ok: false, error: '非 JSON 响应 (' + res.status + '): ' + body.slice(0, 400) }
    }
    if (!res.ok) {
      return { ok: false, error: JSON.stringify(data && data.error ? data.error : (res.status + ' ' + body.slice(0, 400))) }
    }
    const item = data && data.data && data.data[0]
    if (!item) return { ok: false, error: '响应中没有图像数据' }
    // 计费信息（部分端点在响应里返回 usage.cost / cost，透传给渲染层展示）
    const usage = data.usage && typeof data.usage === 'object' ? data.usage : null
    const cost = (data.cost != null) ? data.cost : ((usage && usage.cost != null) ? usage.cost : null)
    const billing = {}
    if (usage) billing.usage = usage
    if (cost != null) billing.cost = cost
    if (item.b64_json) {
      let mime = 'image/png'
      if (model.includes('jpeg') || model.includes('Kolors')) mime = 'image/jpeg'
      const img = dataUrlImage('data:' + mime + ';base64,' + item.b64_json)
      return Object.assign({ ok: true, dataUrl: 'data:' + img.mime + ';base64,' + img.buffer.toString('base64') }, billing)
    }
    if (item.url) {
      // 拉取远程图片转为 data URL
      const remoteUrl = new URL(String(item.url))
      if (!['http:', 'https:'].includes(remoteUrl.protocol)) return { ok: false, error: '图像地址协议不受支持' }
      const imageController = new AbortController()
      const imageTimeout = setTimeout(() => imageController.abort(), 60000)
      try {
        const imgRes = await fetch(remoteUrl, { signal: imageController.signal })
        if (!imgRes.ok) return { ok: false, error: '拉取图像失败: ' + imgRes.status }
        const mime = String(imgRes.headers.get('content-type') || 'image/png').split(';')[0].toLowerCase()
        if (!/^image\/(?:png|jpeg|jpg|webp)$/.test(mime)) return { ok: false, error: '远程地址返回的不是受支持图像' }
        const buf = await readResponseBufferLimited(imgRes, MAX_IMAGE_BYTES, '远程图像')
        return Object.assign({ ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') }, billing)
      } finally { clearTimeout(imageTimeout) }
    }
    return { ok: false, error: '响应格式不支持（缺少 b64_json / url）' }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 将插图（data URL）保存到磁盘 ----
ipcMain.handle('image:save', async (evt, opts) => {
  try {
    const img = imageSource((opts && (opts.dataUrl || opts.source)) || '')
    const ext = img.ext
    const defaultName = String((opts && opts.defaultName) || ('illust-' + Date.now() + '.' + ext))
    const res = await dialog.showSaveDialog(windowForEvent(evt), { title: '保存插图', defaultPath: defaultName, filters: [{ name: 'Image', extensions: [ext] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    fs.writeFileSync(res.filePath, img.buffer)
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 端点连通性测试：GET {baseUrl}/models，返回可用模型数（低成本，不消耗 token）----
ipcMain.handle('net:test', async (_evt, opts) => {
  try {
    const baseUrl = String((opts && opts.baseUrl) || '').trim().replace(/\/+$/, '')
    const apiKey = String((opts && opts.apiKey) || '').trim()
    if (!baseUrl || !apiKey) return { ok: false, error: '地址与密钥不能为空' }
    const endpoint = new URL(baseUrl + '/models')
    if (!['http:', 'https:'].includes(endpoint.protocol)) return { ok: false, error: 'API 地址仅支持 HTTP / HTTPS' }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let res
    let body
    try {
      res = await fetch(endpoint, {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: controller.signal
      })
      body = (await readResponseBufferLimited(res, 4 * 1024 * 1024, '模型列表响应')).toString('utf8')
    } finally {
      clearTimeout(timeout)
    }
    let data = null
    try { data = JSON.parse(body) } catch { /* 非 JSON */ }
    if (!res.ok) {
      const msg = data && data.error && (data.error.message || data.error.code)
      return { ok: false, error: 'HTTP ' + res.status + (msg ? ' · ' + msg : '') + ' ' + body.slice(0, 200) }
    }
    const models = Array.isArray(data && data.data)
      ? data.data.map((m) => m && (m.id || m.name)).filter(Boolean)
      : []
    return { ok: true, models: models.slice(0, 50), count: models.length }
  } catch (e) {
    if (e && (e.name === 'AbortError' || (e.message && /aborted/i.test(e.message)))) {
      return { ok: false, error: '连接超时（15 秒无响应）' }
    }
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 打开任意 JSON 文件并返回内容（导入配置用）----
ipcMain.handle('dialog:openFile', async (evt, opts) => {
  try {
    const res = await dialog.showOpenDialog(windowForEvent(evt), {
      title: String((opts && opts.title) || '选择文件'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false }
    const content = readTextFileLimited(res.filePaths[0], MAX_CONFIG_BYTES, '配置文件')
    return { ok: true, path: res.filePaths[0], content }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 批量保存插图：让用户选一个文件夹，按「会话名-序号」写入全部图片 ----
ipcMain.handle('image:saveAll', async (evt, opts) => {
  try {
    const items = Array.isArray(opts && opts.items) ? opts.items : []
    if (!items.length) return { ok: false, error: '没有可保存的插图' }
    if (items.length > MAX_IMAGE_BATCH) return { ok: false, error: '单次最多保存 100 张插图' }
    const res = await dialog.showOpenDialog(windowForEvent(evt), {
      title: '选择保存文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false }
    const dir = res.filePaths[0]
    const base = String((opts && opts.nameBase) || 'illust').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    let saved = 0
    const failed = []
    items.forEach((it, i) => {
      try {
        const img = imageSource(it && (it.dataUrl || it.source))
        const ext = img.ext
        const name = base + '-' + String(i + 1).padStart(2, '0') + '.' + ext
        fs.writeFileSync(path.join(dir, name), img.buffer)
        saved++
      } catch (e) {
        failed.push(String((e && e.message) || e))
      }
    })
    return { ok: saved > 0, path: dir, saved, failed }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 系统通知：生成完成时（窗口最小化/失焦才发，不打扰前台用户） ----
ipcMain.handle('notify', (_evt, opts) => {
  try {
    if (!Notification.isSupported()) return false
    // 主窗口在前台且聚焦时不发
    if (win && !win.isDestroyed() && !win.isMinimized() && win.isFocused()) return false
    const n = new Notification({
      title: String((opts && opts.title) || '六面世界'),
      body: String((opts && opts.body) || ''),
      silent: false
    })
    n.on('click', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus() } })
    n.show()
    return true
  } catch { return false }
})

// ---- window controls（按调用方窗口生效，设置窗口可复用同一组通道） ----
// Windows 置顶：Electron 33 实测默认级别/'floating' 不生效，必须用最高级别 'screen-saver'；
// 且 Windows 在最大化/还原/最小化恢复时会静默丢掉 TOPMOST 标志，需挂事件重新应用。
const pinnedWins = new WeakSet()
function applyAlwaysOnTop(w, pinned) {
  if (!w || w.isDestroyed()) return
  if (pinned) {
    w.setAlwaysOnTop(true, 'screen-saver', 1)
    w.moveTop()
    pinnedWins.add(w)
  } else {
    w.setAlwaysOnTop(false)
    pinnedWins.delete(w)
  }
}
function watchTopmost(w) {
  if (!w) return
  const reapply = () => { if (pinnedWins.has(w)) applyAlwaysOnTop(w, true) }
  ;['maximize', 'unmaximize', 'restore', 'show'].forEach((ev) => w.on(ev, reapply))
}
ipcMain.handle('window:pin', (evt, pinned) => {
  const w = windowForEvent(evt)
  applyAlwaysOnTop(w, !!pinned)
  return !!pinned
})
ipcMain.handle('window:minimize', (evt) => { const w = windowForEvent(evt); if (w) w.minimize() })
ipcMain.handle('window:maximize-toggle', (evt) => {
  const w = windowForEvent(evt)
  if (!w) return false
  if (w.isMaximized()) w.unmaximize(); else w.maximize()
  return w.isMaximized()
})
ipcMain.handle('window:close', (evt) => { const w = windowForEvent(evt); if (w) w.close() })

// ---- 设置窗口 ----
ipcMain.handle('settings:open', () => { createSettingsWindow(); return true })
// 设置窗口 → 主窗口的配置变更广播：{ persisted } 保存 / { preview } 实时预览 / { clearSessions } 清空世界线
ipcMain.handle('settings:changed', (_evt, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('cfg:updated', payload || {})
  return true
})

// ---- 文件保存（导出配置/续玩码等）----
ipcMain.handle('dialog:saveFile', async (evt, opts) => {
  try {
    const title = String((opts && opts.title) || '保存文件')
    const defaultName = String((opts && opts.defaultName) || 'export.json')
    const content = String((opts && opts.content) || '')
    const res = await dialog.showSaveDialog(windowForEvent(evt), { title, defaultPath: defaultName })
    if (res.canceled || !res.filePath) return { ok: false }
    fs.writeFileSync(res.filePath, content, 'utf8')
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 主窗口 -> 设置窗口 反向同步（主窗口运行时改了模型/主题等，实时同步给已打开的设置窗口） ----
ipcMain.handle('main:changed', (_e, payload) => {
  try {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('cfg:sync', payload || {})
  } catch { /* noop */ }
  return true
})

// ---- theme ----
ipcMain.handle('theme:set', (_evt, source) => {
  const s = String(source || 'system')
  if (s === 'light' || s === 'dark') nativeTheme.themeSource = s
  else nativeTheme.themeSource = 'system'
  return {
    source: nativeTheme.themeSource,
    dark: nativeTheme.shouldUseDarkColors
  }
})
ipcMain.handle('theme:get', () => ({
  source: nativeTheme.themeSource,
  dark: nativeTheme.shouldUseDarkColors
}))

// ---- 移动端进度包导出（渲染层收集 localStorage，主进程读引擎文件并落盘） ----
ipcMain.handle('progress:export', async (evt, payload) => {
  try {
    const storyEngineDir = path.join(app.getPath('userData'), 'story-engine')
    const files = {}
    let engineBytes = 0
    /* 只打包正本与记录（stories/snapshots/pendings/logs，且仅 .json）——与移动端 EngineImportPolicy
     * 白名单对称。memory.db* 是派生索引（二进制、可由正本重建）：打进包既损坏内容（按 utf8 读二进制）
     * 又会让移动端导入整体失败（深度-1 路径被策略拒绝）。 */
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        const st = fs.statSync(full)
        if (st.isDirectory()) {
          if (path.relative(storyEngineDir, full).split(path.sep)[0] !== 'tmp') walk(full)
        }
        else {
          if (st.size > 8 * 1024 * 1024) throw new Error('引擎状态文件过大：' + f)
          engineBytes += st.size
          if (engineBytes > 128 * 1024 * 1024) throw new Error('引擎状态总量过大（上限 128MB）')
          const rel = path.relative(storyEngineDir, full).split(path.sep).join('/')
          const segs = rel.split('/')
          if (!['stories', 'snapshots', 'pendings', 'logs'].includes(segs[0]) || segs[segs.length - 1].slice(-5) !== '.json') continue
          files[rel] = fs.readFileSync(full, 'utf8')
        }
      }
    }
    if (fs.existsSync(storyEngineDir)) walk(storyEngineDir)
    const bundle = {
      type: 'sixworlds-progress',
      v: 1,
      exportedAt: Date.now(),
      world: (payload && payload.world) || null,
      workspaces: (payload && payload.workspaces) || [],
      sessions: progressSessions((payload && payload.sessions) || []),
      engine: { files },
    }
    const serialized = JSON.stringify(bundle)
    if (Buffer.byteLength(serialized) > 128 * 1024 * 1024) throw new Error('进度包过大（上限 128MB）')
    // 测试接缝：SIXWORLDS_TEST 下用注入路径替代原生保存对话框（自动化无法驱动）
    const testOut = process.env.SIXWORLDS_TEST === '1' && payload && typeof payload.__testPath === 'string' ? payload.__testPath : null
    if (testOut) { fs.writeFileSync(testOut, serialized); return { ok: true, path: testOut } }
    const res = await dialog.showSaveDialog(windowForEvent(evt), {
      title: '导出移动端进度包',
      defaultPath: '六面世界-进度包.json',
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    fs.writeFileSync(res.filePath, serialized)
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 进度包导入（移动端导出的包 → 桌面接续；与移动端 EngineImportPolicy 同一防线）----
const IMPORT_MAX_FILE_BYTES = 8 * 1024 * 1024
const IMPORT_MAX_TOTAL_BYTES = 128 * 1024 * 1024
const IMPORT_MAX_FILES = 5000
const IMPORT_ALLOWED_ROOTS = new Set(['stories', 'snapshots', 'pendings', 'logs'])
const IMPORT_SAFE_SEG = /^[A-Za-z0-9_.-]{1,180}$/

/* 引擎文件路径防线（与移动端 EngineImportPolicy 逐条对应）：
 * 限额（单文件 8MB / 总量 128MB / 件数 5000）+ 路径白名单（仅 stories/snapshots/pendings/logs，
 * 拒绝 tmp/绝对路径/../非法片段）+ 越界校验（resolve 后必须仍位于引擎目录内）。 */
function resolveImportTarget(engineDir, rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 512 || rel.includes('\u0000')) throw new Error('进度包路径为空或过长')
  const norm = rel.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) throw new Error('不允许绝对路径')
  const segs = norm.split('/')
  if (segs.length < 2 || segs.length > 3) throw new Error('引擎文件目录层级不正确')
  if (segs.some((s) => !s || s === '.' || s === '..' || !IMPORT_SAFE_SEG.test(s))) throw new Error('引擎文件路径包含非法片段')
  if (!IMPORT_ALLOWED_ROOTS.has(segs[0])) throw new Error('不支持的引擎文件目录')
  if (segs[segs.length - 1].slice(-5) !== '.json') throw new Error('不支持的引擎文件类型')
  const target = path.resolve(engineDir, ...segs)
  if (!target.startsWith(path.resolve(engineDir) + path.sep)) throw new Error('引擎文件路径越界')
  return target
}

ipcMain.handle('progress:import', async (evt) => {
  try {
    /* 测试接缝：SIXWORLDS_TEST 下用注入路径替代原生打开对话框（自动化无法驱动）。
     * 仅测试态生效——progress:import 本无渲染层参数，注入走全局 env 不引入生产面。 */
    const testIn = process.env.SIXWORLDS_TEST === '1' && process.env.SIXWORLDS_TEST_IMPORT_PATH ? process.env.SIXWORLDS_TEST_IMPORT_PATH : null
    let raw = null
    if (testIn && fs.existsSync(testIn)) {
      raw = fs.readFileSync(testIn)
    } else {
      const res = await dialog.showOpenDialog(windowForEvent(evt), {
        title: '导入进度包',
        properties: ['openFile'],
        filters: [{ name: '六面世界进度包', extensions: ['json'] }],
      })
      if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true }
      raw = fs.readFileSync(res.filePaths[0])
    }
    if (raw.length > IMPORT_MAX_TOTAL_BYTES) throw new Error('导入文件过大（上限 128MB）')
    const bundle = JSON.parse(raw.toString('utf8'))
    if (!bundle || bundle.type !== 'sixworlds-progress') throw new Error('不是有效的进度包（type 不符）')
    if (bundle.v !== 1) throw new Error('进度包版本不支持（v=' + bundle.v + '，需要 v1）')
    if (!Array.isArray(bundle.workspaces)) throw new Error('进度包工作区数据不正确')
    // 会话在渲染层合并（页面持有内存态）；主进程只校验形状
    if (bundle.sessions != null && !Array.isArray(bundle.sessions)) throw new Error('进度包世界线数据不正确')
    const sessions = Array.isArray(bundle.sessions) ? bundle.sessions : []
    if (sessions.length > MAX_SESSIONS) throw new Error('进度包世界线数量超过上限（50）')
    for (const s of sessions) {
      if (!s || typeof s !== 'object' || !Array.isArray(s.messages)) throw new Error('进度包会话数据不完整')
    }
    // 引擎状态：先全部校验并收集，全部通过后一次性落盘（不留半写状态）
    const engineDir = path.join(app.getPath('userData'), 'story-engine')
    const files = (bundle.engine && bundle.engine.files) || {}
    const keys = Object.keys(files)
    if (keys.length > IMPORT_MAX_FILES) throw new Error('进度包中的引擎文件数量过多')
    const pending = []
    let totalBytes = 0
    for (const rel of keys) {
      const content = files[rel]
      if (typeof content !== 'string') throw new Error('进度包中的引擎文件内容必须是文本')
      /* 旧版包兼容：早期导出会把派生索引 memory.db* 一并打进包（按 utf8 读已损坏、且可由正本重建）——
       * 明确跳过这三个键，其余任何白名单外路径仍硬拒绝（旧包可导入，攻击面不放松）。 */
      if (/^memory\.db(-wal|-shm)?$/.test(rel)) continue
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > IMPORT_MAX_FILE_BYTES) throw new Error('进度包中的引擎文件过大')
      totalBytes += bytes
      if (totalBytes > IMPORT_MAX_TOTAL_BYTES) throw new Error('进度包中的引擎数据总量过大')
      pending.push([resolveImportTarget(engineDir, rel), content])
    }
    /* 引擎句柄重建：文件级替换后，内存缓存/检索槽/语义索引全部指向旧状态——
     * 直接弃旧引擎（关句柄），下一次使用时按新文件重建（派生索引随 flushStory/检索兜底自动同步）。 */
    if (storyEngine) { try { storyEngine.close() } catch {} ; storyEngine = null }
    for (const [target, content] of pending) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      atomicWriteFile(target, content)
    }
    /* 会话合并（按 id 保留较新 updatedAt，上限 50）：主进程单一实现——
     * 主窗口在内存持有会话权威副本，若由设置窗口直接写 localStorage，主窗口的下一次防抖
     * 保存会整包覆盖导入数据。落库后广播 progressImported，主窗口重载内存态并重新渲染。 */
    const merged = (() => {
      try {
        const db = sessionsDbFor()
        const cur = db.enabled ? db.load() : null
        const curDoc = cur ? cur.doc : null
        const curArr = Array.isArray(curDoc) ? curDoc : (curDoc && curDoc.sessions) || []
        const byId = new Map(curArr.filter((s) => s && s.id).map((s) => [s.id, s]))
        for (const s of sessions) {
          const old = byId.get(s.id)
          if (!old || Number(s.updatedAt || 0) >= Number(old.updatedAt || 0)) byId.set(s.id, s)
        }
        const out = [...byId.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, MAX_SESSIONS)
        if (db.enabled) db.importDoc({ v: 1, sessions: out })
        atomicWriteFile(sessionsFile(), JSON.stringify({ v: 1, sessions: out }))
        return out
      } catch (e) { throw new Error('会话合并失败：' + String((e && e.message) || e)) }
    })()
    if (win && !win.isDestroyed()) win.webContents.send('cfg:updated', { progressImported: true })
    return { ok: true, count: merged.length, files: pending.length, engineFiles: pending.length, workspaces: bundle.workspaces, sessions: merged, world: bundle.world || null }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

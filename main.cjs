const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell, Notification } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// 测试隔离：scripts-dev 下的 Playwright 脚本以 SIXWORLDS_TEST=1 启动时，
// 使用独立的 userData 档案目录，localStorage 等持久化与真实使用完全隔离，
// 绝不会清掉/覆盖用户手工配置的模型与密钥。
if (process.env.SIXWORLDS_TEST) {
  app.setPath('userData', path.join(app.getPath('userData'), 'test-profile'))
}

const KERNEL_DEFAULT = path.join(__dirname, 'kernel.md')
let win = null
let settingsWin = null

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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
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

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'
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

// ---- 故事状态引擎（通用结构化状态 + 长期记忆 + 检索） ----
// 存储位于 userData/story-engine/（stories/snapshots/logs 分目录），与 localStorage 互补。
const { createEngine } = require('./engine/index')
let storyEngine = null
function engineFor() {
  if (!storyEngine) storyEngine = createEngine(path.join(app.getPath('userData'), 'story-engine'))
  return storyEngine
}
const safeHandle = (ch, fn) => ipcMain.handle(ch, async (_e, payload) => {
  try { return { ok: true, data: await fn(payload || {}) } }
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
      const text = fs.readFileSync(p, 'utf8')
      return { ok: true, text, path: p, size: text.length }
    } catch { /* next */ }
  }
  return { ok: false, error: '未找到内核文件 kernel.md（应用目录）', path: KERNEL_DEFAULT }
})

ipcMain.handle('kernel:readPath', async (_evt, p) => {
  try {
    const text = fs.readFileSync(p, 'utf8')
    return { ok: true, text, path: p, size: text.length }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})
ipcMain.handle('kernel:pick', async (evt) => {
  const res = await dialog.showOpenDialog(windowForEvent(evt), {
    title: '选择世界内核文件',
    filters: [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false }
  const p = res.filePaths[0]
  try {
    const text = fs.readFileSync(p, 'utf8')
    return { ok: true, text, path: p, size: text.length }
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
    const baseUrl = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
    const apiKey = String(cfg.apiKey || '').trim()
    const model = String(cfg.model || '').trim()
    if (!baseUrl || !apiKey || !model) {
      return { ok: false, error: '请先在设置中填写 API 地址、密钥与模型。' }
    }
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
      try {
        res = await fetch(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeout)
      }

      // 非流式响应（或不支持 SSE 的端点）：按普通 JSON 处理
      const ctype = String(res.headers.get('content-type') || '')
      if (!ctype.includes('text/event-stream')) {
        const body = await res.text()
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
        const body = await res.text()
        return { ok: false, error: 'HTTP ' + res.status + ' ' + body.slice(0, 400) }
      }
      let full = ''
      let usage = null
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
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
    try {
      res = await fetch(baseUrl + '/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
    const body = await res.text()
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
      return Object.assign({ ok: true, dataUrl: 'data:' + mime + ';base64,' + item.b64_json }, billing)
    }
    if (item.url) {
      // 拉取远程图片转为 data URL
      const imgRes = await fetch(item.url)
      if (!imgRes.ok) return { ok: false, error: '拉取图像失败: ' + imgRes.status }
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const mime = imgRes.headers.get('content-type') || 'image/png'
      return Object.assign({ ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') }, billing)
    }
    return { ok: false, error: '响应格式不支持（缺少 b64_json / url）' }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ---- 将插图（data URL）保存到磁盘 ----
ipcMain.handle('image:save', async (evt, opts) => {
  try {
    const dataUrl = String((opts && opts.dataUrl) || '')
    const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return { ok: false, error: '无效的图像数据' }
    const mime = m[1]
    const ext = mime.includes('png') ? 'png' : (mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : (mime.includes('webp') ? 'webp' : 'png'))
    const defaultName = String((opts && opts.defaultName) || ('illust-' + Date.now() + '.' + ext))
    const res = await dialog.showSaveDialog(windowForEvent(evt), { title: '保存插图', defaultPath: defaultName, filters: [{ name: 'Image', extensions: [ext] }] })
    if (res.canceled || !res.filePath) return { ok: false }
    fs.writeFileSync(res.filePath, Buffer.from(m[2], 'base64'))
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let res
    try {
      res = await fetch(baseUrl + '/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
    const body = await res.text()
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
    const content = fs.readFileSync(res.filePaths[0], 'utf8')
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
        const m = String(it.dataUrl || '').match(/^data:([^;]+);base64,(.*)$/)
        if (!m) throw new Error('无效图像数据')
        const mime = m[1]
        const ext = mime.includes('png') ? 'png' : (mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : (mime.includes('webp') ? 'webp' : 'png'))
        const name = base + '-' + String(i + 1).padStart(2, '0') + '.' + ext
        fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'))
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
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f)
        const st = fs.statSync(full)
        if (st.isDirectory()) walk(full)
        else {
          const rel = path.relative(storyEngineDir, full).split(path.sep).join('/')
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
      sessions: (payload && payload.sessions) || [],
      engine: { files },
    }
    const res = await dialog.showSaveDialog(windowForEvent(evt), {
      title: '导出移动端进度包',
      defaultPath: '六面世界-进度包.json',
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    fs.writeFileSync(res.filePath, JSON.stringify(bundle))
    return { ok: true, path: res.filePath }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

/* ======== 六面世界 · 极简桌面聊天窗 ========
 * 【维护策略】本目录（renderer/）＝「经典界面」方案，已冻结为维护态：
 *  只修阻断性 bug 与数据安全问题，不再新增功能；功能演进集中在 renderer-proto/（原型工作台方案，
 *  视觉以 design-prototypes/zcode-platform-v2 为准）。两方案共享同一份 localStorage 与引擎数据，
 *  涉及共享数据结构（会话/世界线/设置/引擎 IPC）的改动必须两侧同步。
 */
(() => {
  'use strict'

  const api = window.api
  const $ = (id) => document.getElementById(id)

  // ---- 弹层/模态离场动画（有头有尾）：先播动画再隐藏 ----
  // 浮层（下拉/弹层）：挂 .popout，动画结束（或 220ms 兜底）后再执行 hideFn
  function hideWithAnim(el, hideFn) {
    if (!el) { if (hideFn) hideFn(); return }
    if (el.dataset.leaving === '1') { if (hideFn) hideFn(); return } // 已在离场中：直接完成隐藏
    el.dataset.leaving = '1'
    el.classList.add('popout')
    let done = false
    const onEnd = (ev) => { if (ev.target === el) finish() }
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('animationend', onEnd)
      // 离场期间被重新打开（cancelHideAnim）：撤掉动画类，不再隐藏
      if (el.dataset.leaving !== '1') { el.classList.remove('popout'); return }
      el.dataset.leaving = ''
      el.classList.remove('popout')
      if (hideFn) hideFn()
    }
    el.addEventListener('animationend', onEnd)
    setTimeout(finish, 220)
  }
  // 模态（含遮罩）：box + mask 同时淡出，动画结束再隐藏
  function closeModalAnim(box, mask, hideFn) {
    if (!box) { if (hideFn) hideFn(); return }
    if (box.dataset.leaving === '1') { if (hideFn) hideFn(); return }
    box.dataset.leaving = '1'
    box.classList.add('closing')
    if (mask) mask.classList.add('closing')
    let done = false
    const onEnd = (ev) => { if (ev.target === box) finish() }
    const finish = () => {
      if (done) return
      done = true
      box.removeEventListener('animationend', onEnd)
      if (box.dataset.leaving !== '1') {
        box.classList.remove('closing')
        if (mask) mask.classList.remove('closing')
        return
      }
      box.dataset.leaving = ''
      box.classList.remove('closing')
      if (mask) mask.classList.remove('closing')
      if (hideFn) hideFn()
    }
    box.addEventListener('animationend', onEnd)
    setTimeout(finish, 320)
  }
  // 重新打开时撤销离场动画（配合上面两个函数的取消逻辑）
  function cancelHideAnim(el) {
    if (!el) return
    el.dataset.leaving = ''
    el.classList.remove('popout')
    el.classList.remove('closing')
  }

  // ---- 文本模型预设 ----
  const PRESETS = {
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    moonshot: { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0711-preview' },
    zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    qwen: { name: '通义 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    custom: { name: '自定义', baseUrl: '', model: '' }
  }

  // ---- 图像模型预设已随设置迁至独立窗口（renderer/settings.js） ----

  // ---- 插图风格预设（英文提示词：图像模型对英文风格词响应更稳，噪点更少） ----
  // ln-original 严格还原《无职转生》原作轻小说插画质感（シロタツ画风：细腻水彩 + 柔和光影 + 魔导氛围）
  // 针对本作内核（kernel.md = 六面世界/无职转生系）默认启用；换其他内核时玩家可自由切换其余风格

  // ---- 本地配置（持久化） ----
  const STORE_KEY = 'sixworlds.codex.state.v3'
  const SESSIONS_KEY = 'sixworlds.sessions.v2'
  const WORKSPACES_KEY = 'sixworlds.workspaces.v1'
  const DEFAULT_CFG = {
    preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    kernelPath: '',
    theme: 'system',
    palette: 'classic',
    fontUI: 'sans',
    radius: 'standard',
    density: 'standard',
    layout: 'sidebar',
    sbSide: 'left',
    models: [],
    thinkLevel: 'default',
    illustQuality: 'default',
    fontSize: 'standard',
    readWidth: 'standard',
    pin: false,
    skipSplash: false,
    illustAuto: false,
    illustPreset: 'off',
    illustBaseUrl: '',
    illustApiKey: '',
    illustModel: '',
    illustStyle: 'ln-original',
    illustCustom: '',
    illustSize: '1344x768',
    illustNegative: '',
    illustSeedLock: false,
    illustSeed: '',
    illustN: 1,
    illustMinLen: 80,
    illustPrefixEnable: true,
    illustPrefix: 'A scene illustration from a Japanese fantasy light novel.',
    ctxCount: 24,
    keepCount: 80,
    sidebarWidth: 200,
    sidebarCollapsed: false,
    currentSessionId: null,
    currentWsId: null
  }
  let cfg = Object.assign({}, DEFAULT_CFG, loadStore())
  if (cfg.palette === 'codex') cfg.palette = 'classic' // 旧版配置迁移：调色板 id 不再使用 codex 字样

  let kernel = null // { text, path, size }
  let busy = false
  let engineBusy = false // 条款 17：状态补录进行中（不复位发送按钮 UI，但阻止并发发送/重生成，保证消息顺序）
  let busyIsland = null // R76：生成中的灵动岛句柄（send 开始展示、结束收纳）
  let currentReqId = null // 当前生成的请求 id，用于中途取消
  let choiceMode = false
  let streaming = '' // 流式期间累积的文本
  const multiSel = new Set() // 选项多选累积（Ctrl+点击 或 多选模式勾选）
  let multiMode = false        // 显式多选模式（无需按住 Ctrl，普通点击即勾选）
  let choicesFoldUser = false  // 玩家手动收起选项区（置底时自动展开并复位）
  let choicesAutoFolded = false // 上滑查阅历史时自动收起
  let choicesFoldGuard = 0 // 自动折叠防抖闸：折叠/展开后的 smooth 滚动动画期内不再自动折叠（防振荡，见滚动处理器）
  const sessionDrafts = new Map() // 每会话输入草稿（内存，切会话不丢）
  let sbFilter = '' // 侧栏全局搜索过滤词（跨所有世界线）

  // 内核开局界面元数据：内核文件可用 <!--KERNEL_META {json} KERNEL_META--> 自定义空态界面（标题/开场白/出身预设），未配置时回落内置默认

  // ---- 多会话：{ id, ws, title, messages: [{role, content, illust?}], updatedAt, createdAt } ----
  let sessions = []
  let currentId = null

  // ---- 工作区：{ id, name, createdAt, kernelPath?, lastSessionId? } ----
  // 完全隔离：每个会话属于且仅属于一个工作区；会话列表/搜索/画廊只显示当前工作区的内容
  let workspaces = []
  let currentWsId = null

  function loadWorkspaces() {
    try {
      workspaces = JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]')
      if (!Array.isArray(workspaces)) workspaces = []
    } catch { workspaces = [] }
    if (!workspaces.length) {
      workspaces = [{ id: 'w' + Date.now().toString(36), name: '默认世界', createdAt: Date.now() }]
    }
    // 校验当前工作区 id
    currentWsId = workspaces.some((w) => w.id === cfg.currentWsId) ? cfg.currentWsId : workspaces[0].id
  }
  // R61/R62 存储失败可见性：浏览器、文件或安全存储写失败此前会被静默吞掉。
  // UI 照常推进但重启即丢。保存入口共用一条节流提示（同一故障期只提醒一次，任一成功保存后复位）。
  let saveFailWarned = false
  function warnSaveFail(scope) {
    if (saveFailWarned) return
    saveFailWarned = true
    try { toast('⚠ ' + scope + '未保存——请检查磁盘空间与写入权限，并及时导出备份，否则重启后可能丢失最新内容', 'err', 8000) } catch {}
  }
  function saveWorkspaces() {
    try {
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces))
      saveFailWarned = false
    } catch { warnSaveFail('工作区设置') }
  }
  function curWs() { return workspaces.find((w) => w.id === currentWsId) || null }
  // 当前工作区的会话（隔离视图）
  function wsSessions() { return sessions.filter((s) => s.ws === currentWsId) }

  function loadStore() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (v) return v
      // 迁移旧版本配置（v2）
      const old = JSON.parse(localStorage.getItem('sixworlds.codex.state.v2') || 'null')
      if (old) return old
      return {}
    } catch { return {} }
  }
  let savedSecretsSignature = null
  function publicConfig(value) {
    const out = Object.assign({}, value)
    delete out.apiKey
    delete out.illustApiKey
    return out
  }
  function persistSecrets() {
    if (!api.saveSecrets) return Promise.resolve({ ok: false, error: '当前版本不支持安全密钥存储' })
    const secrets = { apiKey: String(cfg.apiKey || ''), illustApiKey: String(cfg.illustApiKey || '') }
    const signature = JSON.stringify(secrets)
    if (signature === savedSecretsSignature) return Promise.resolve({ ok: true })
    return api.saveSecrets(secrets).then((r) => {
      if (r && r.ok) savedSecretsSignature = signature
      else warnSaveFail('API 密钥')
      return r
    }).catch(() => { warnSaveFail('API 密钥'); return { ok: false } })
  }
  async function hydrateSecrets() {
    const legacy = { apiKey: String(cfg.apiKey || ''), illustApiKey: String(cfg.illustApiKey || '') }
    let secured = { apiKey: '', illustApiKey: '' }
    if (api.loadSecrets) {
      const r = await api.loadSecrets()
      if (r && r.ok && r.secrets) secured = r.secrets
    }
    // 自动化夹具仍从隔离 localStorage 注入；真实用户以系统安全存储为准，缺失时迁移旧明文。
    const preferLegacy = !!api.isTest
    cfg.apiKey = preferLegacy ? (legacy.apiKey || secured.apiKey || '') : (secured.apiKey || legacy.apiKey || '')
    cfg.illustApiKey = preferLegacy ? (legacy.illustApiKey || secured.illustApiKey || '') : (secured.illustApiKey || legacy.illustApiKey || '')
    savedSecretsSignature = JSON.stringify(secured)
    if (JSON.stringify({ apiKey: cfg.apiKey, illustApiKey: cfg.illustApiKey }) !== savedSecretsSignature) await persistSecrets()
    if (!api.isTest) {
      for (const key of [STORE_KEY, 'sixworlds.codex.state.v2']) {
        try {
          const value = JSON.parse(localStorage.getItem(key) || 'null')
          if (value && typeof value === 'object') {
            delete value.apiKey
            delete value.illustApiKey
            localStorage.setItem(key, JSON.stringify(value))
          }
        } catch {}
      }
    }
  }
  function saveStore() {
    cfg.currentSessionId = currentId
    cfg.currentWsId = currentWsId
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(api.isTest ? cfg : publicConfig(cfg)))
      saveFailWarned = false
    } catch { warnSaveFail('应用设置') }
    persistSecrets()
  }
  /* ---- 会话数据层（读取合并迁移 + 防抖保存）——双界面方案共享实现：
   *    shared/sessions-client.js 是唯一实现处；此处只绑定本方案的可变状态与提示回调，
   *    归属修复/迁移逻辑的改动不再需要双边人工同步。 ---- */
  const sessionsLib = SessionsClient.createSessionsPersistence({ getSessions: () => sessions }, {
    api, warnSaveFail, onSaved: () => { saveFailWarned = false }
  })
  sessionsLib.bindAutoFlush() // 页面隐藏/关闭强制冲刷（规范八：不丢尾部消息）
  async function loadSessions() {
    const r = await sessionsLib.loadSessions(() => workspaces, currentWsId)
    sessions = r.sessions
    if (r.needsSave) saveSessions() // 归属修复（无 ws / 孤儿会话）后一次防抖落盘
  }
  const saveSessions = sessionsLib.saveSessions
  function curSession() { return sessions.find((s) => s.id === currentId) || null }

  function newSession() {
    const now = Date.now()
    const s = { id: 's' + now.toString(36), ws: currentWsId, title: '新世界线', messages: [], updatedAt: now, createdAt: now }
    sessions.unshift(s)
    currentId = s.id
    const ws = curWs()
    if (ws) ws.lastSessionId = s.id
    saveStore()
    saveSessions()
    saveWorkspaces()
    renderSessionList()
    return s
  }
  function touchSession() {
    const s = curSession()
    if (s) { s.updatedAt = Date.now(); saveSessions() }
  }
  // 从叙事文本提取会话标题：优先【XX历…｜…】场景行（兼容任意历法内核），否则截取首句
  function deriveTitle(text) {
    const m = String(text || '').match(/【([^\]】]*历[^\]】]*｜[^\]】]*)】/)
    if (m) return m[1].split('｜')[0] + ' · ' + (m[1].split('｜')[2] || m[1].split('｜')[1] || '')
    const t = String(text || '').replace(/\s+/g, ' ').trim()
    return t.slice(0, 18) || '新世界线'
  }

  // 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / M月d日（超过一周显示完整日期）
  function relTime(ts) {
    if (!ts) return ''
    const diff = Date.now() - Number(ts)
    if (diff < 60 * 1000) return '刚刚'
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前'
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前'
    const d = new Date(Number(ts))
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    if (d >= yesterday) return '昨天'
    if (diff < 7 * 24 * 3600000) return Math.floor(diff / 86400000) + ' 天前'
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  }

  // 会话时间分组（对标 Codex/ChatGPT 侧栏）：今天 / 昨天 / 7 天内 / 更早
  function sessionGroup(ts) {
    if (!ts) return '更早'
    const now = new Date()
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const d = new Date(Number(ts)).getTime()
    if (d >= startToday) return '今天'
    if (d >= startToday - 86400000) return '昨天'
    if (d >= startToday - 7 * 86400000) return '7 天内'
    return '更早'
  }

  // ---- 会话拖拽排序（鼠标拖动，与侧栏伸缩一致的实现方式） ----
  let dragSession = null // { id, el, startY, started }
  let justDraggedSession = false
  function clearDropMarks() {
    document.querySelectorAll('.session-item.drop-before, .session-item.drop-after')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after'))
  }
  document.addEventListener('mousemove', (e) => {
    if (!dragSession) return
    if (!dragSession.started) {
      if (Math.abs(e.clientY - dragSession.startY) < 6) return
      dragSession.started = true
      dragSession.el.classList.add('dragging')
    }
    e.preventDefault()
    // 命中目标条目：按指针 Y 与条目中点决定插前/插后
    clearDropMarks()
    const els = Array.from(document.querySelectorAll('.session-item'))
    const target = els.find((el) => {
      if (el === dragSession.el) return false
      const r = el.getBoundingClientRect()
      return e.clientY >= r.top && e.clientY <= r.bottom
    })
    if (target) {
      const r = target.getBoundingClientRect()
      target.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after')
    }
  })
  document.addEventListener('mouseup', (e) => {
    if (!dragSession || !dragSession.started) { dragSession = null; return }
    const dragEl = dragSession.el
    const draggedId = dragSession.id
    dragEl.classList.remove('dragging')
    // 计算落点：被标记的目标（插前/插后）——必须先取标记再清理（R36 修复：原顺序相反，落点永远落空，拖拽恒移末尾）
    const marked = document.querySelector('.session-item.drop-before, .session-item.drop-after')
    clearDropMarks()
    dragSession = null
    justDraggedSession = true
    let insertBeforeId = null, afterMarked = false
    if (marked) {
      afterMarked = marked.classList.contains('drop-after')
      const els = Array.from(document.querySelectorAll('.session-item'))
      const markedIdx = els.indexOf(marked)
      const dragIdx = els.indexOf(dragEl)
      // 拖拽条目仍在列表中：标记位在拖拽条目之后且插后 → 目标要跳过拖拽条目自身
      const targetEl = els[afterMarked ? markedIdx + (markedIdx > dragIdx ? 1 : 0) : markedIdx]
      insertBeforeId = targetEl ? targetEl.dataset.sid : null
    }
    // 重排 sessions 数组
    const from = sessions.findIndex((s) => s.id === draggedId)
    if (from < 0) { renderSessionList(); return }
    const [moved] = sessions.splice(from, 1)
    if (!insertBeforeId) {
      sessions.push(moved) // 无标记 → 放到最后
    } else {
      let to = sessions.findIndex((s) => s.id === insertBeforeId)
      if (to < 0) to = sessions.length
      sessions.splice(to, 0, moved)
    }
    saveSessions()
    renderSessionList()
  })

  function renderSessionList() {
    const list = $('session-list')
    list.innerHTML = ''
    // 工作区隔离：只显示当前工作区的会话；全局搜索也只在本工作区内搜
    const q = sbFilter
    const hitCounts = new Map()
    let shown = wsSessions()
    if (q) {
      const re = new RegExp(escapeRegExp(q), 'gi')
      shown = shown.filter((s) => {
        const titleHits = (((s.title || '').match(re) || []).length)
        let bodyHits = 0
        for (const m of s.messages) bodyHits += (String(m.content || '').match(re) || []).length
        const total = titleHits + bodyHits
        if (total > 0) hitCounts.set(s.id, total)
        return total > 0
      })
    }
    let lastGroup = null
    for (const s of shown) {
      // 分组标题（搜索态平铺不分组）
      const g = q ? '' : sessionGroup(s.updatedAt)
      if (g !== lastGroup) {
        lastGroup = g
        if (g) {
          const head = document.createElement('div')
          head.className = 'session-group-label'
          head.textContent = g
          list.appendChild(head)
        }
      }
      const item = document.createElement('div')
      item.className = 'session-item' + (s.id === currentId ? ' active' : '')
      item.dataset.sid = s.id
      // R33 键盘可达：会话项可聚焦，Enter/Space 触发同一点击逻辑（转发 .click() 不复制逻辑）
      item.tabIndex = 0
      item.setAttribute('role', 'button')
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click() }
      })
      // 首字徽标（侧栏收起时显示，代替标题）；IF 线显示 IF 标识
      const badge = document.createElement('span')
      badge.className = 'session-badge' + (s.ifFrom ? ' if-badge' : '')
      badge.textContent = s.ifFrom ? 'IF' : ((String(s.title || '世').replace(/^[\s"'”“‘’《〈「『【\[(（·•—]+/, '').slice(0, 1) || '世')) /* 跳过书名号等前导标点，收起时首字符可辨识（R77） */
      item.appendChild(badge)
      const labelWrap = document.createElement('div')
      labelWrap.className = 'session-label-wrap'
      const label = document.createElement('span')
      label.className = 'session-label-text'
      label.textContent = s.title
      const time = document.createElement('span')
      time.className = 'session-time'
      time.textContent = relTime(s.updatedAt)
      // 全局搜索命中数徽标
      if (q && hitCounts.has(s.id)) {
        const hits = document.createElement('span')
        hits.className = 'session-hits'
        hits.textContent = hitCounts.get(s.id) + ' 命中'
        hits.title = '正文中共 ' + hitCounts.get(s.id) + ' 处命中，点击进入后自动定位'
        labelWrap.appendChild(hits)
      }
      const illustCount = s.messages.filter((m) => m.illust).length
      label.title = s.title + '（' + s.messages.length + ' 条 · ' + illustCount + ' 插图 · 双击重命名 · 拖动排序）'
      labelWrap.appendChild(label)
      labelWrap.appendChild(time)
      // 双击重命名
      labelWrap.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        renameSession(s, labelWrap)
      })
      item.appendChild(labelWrap)
      const del = document.createElement('button')
      del.className = 'session-del'
      del.innerHTML = '<svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
      del.title = '删除该世界线'
      del.addEventListener('click', (e) => {
        e.stopPropagation()
        if (busy) { toast('世界运转中，回合结束后再删除', 'info', 1800); return } // R57：生成中禁止删除世界线（防流式写入已删会话）
        confirmDialog({
          title: '删除这条世界线？',
          body: '「' + s.title + '」的 ' + s.messages.length + ' 条对话、' + illustCount + ' 张插图与世界状态记忆（含待补录记录）将被永久删除，无法恢复。',
          danger: true,
          okText: '删除'
        }).then((ok) => {
          if (!ok) return
          sessions = sessions.filter((x) => x.id !== s.id)
          if (currentId === s.id) {
            currentId = sessions.length ? sessions[0].id : null
            if (!currentId) newSession()
          }
          saveStore()
          saveSessions(true)
          // 级联清理引擎侧数据（R85：故事/快照/Pending/日志/向量索引一并删除，防孤儿累积）
          api.engineDeleteStory({ storyId: s.id }).catch(() => {})
          renderSessionList()
          renderMessages()
          updateTitle()
          toast('已删除世界线', 'info')
        })
      })
      item.appendChild(del)
      item.addEventListener('click', () => {
        if (justDraggedSession) { justDraggedSession = false; return }
        if (busy) { toast('世界运转中，回合结束后即可切换', 'info', 1800); return } // R56：生成中点选其它线给出反馈（与新建按钮一致，不再静默无响应）
        if (s.id === currentId) return
        // 保存当前输入草稿，切换后恢复目标会话草稿
        const inputEl2 = $('input')
        if (currentId) sessionDrafts.set(currentId, inputEl2.value)
        currentId = s.id
        // 选项区状态随会话重置：收起/自动收起/多选模式不跨会话残留
        choicesFoldUser = false
        choicesAutoFolded = false
        multiMode = false
        multiSel.clear()
        const ws = curWs()
        if (ws) { ws.lastSessionId = s.id; saveWorkspaces() }
        saveStore()
        inputEl2.value = sessionDrafts.get(s.id) || ''
        fitInput()
        renderSessionList()
        renderMessages()
        updateTitle()
        // 全局搜索态：切过去后自动打开会话内搜索并定位命中
        if (sbFilter) {
          openSearch()
          searchInput.value = sbFilter
          runSearch(sbFilter)
        }
      })
      // 拖拽排序：按下记录，移动超阈值进入拖拽（点击不受影响）
      item.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return
        if (e.target.closest('.session-del, input, button')) return
        dragSession = { id: s.id, el: item, startY: e.clientY, started: false }
      })
      list.appendChild(item)
    }
  }

  // 双击重命名世界线：把整个标签区（含时间）替换为行内输入框
  function renameSession(s, labelEl) {
    const original = s.title
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'session-rename-input'
    input.value = original
    input.maxLength = 40
    // 先解绑 dblclick（replaceWith 后旧元素事件随节点丢弃，无需手动清理）
    labelEl.replaceWith(input)
    input.focus()
    input.select()
    input.addEventListener('dblclick', (e) => e.stopPropagation())
    input.addEventListener('click', (e) => e.stopPropagation())
    let done = false
    const commit = (save) => {
      if (done) return
      done = true
      const v = String(input.value || '').trim()
      if (save && v && v !== original) {
        s.title = v
        saveSessions()
        toast('已重命名', 'ok', 1800)
      }
      renderSessionList()
      if (s.id === currentId) updateTitle()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true) }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false) }
    })
    input.addEventListener('blur', () => commit(true))
  }

  // ============ 工作区：完全隔离的会话容器 ============
  const wsBtn = $('btn-ws')
  const wsMenu = $('ws-menu')

  function renderWsBtn() {
    const ws = curWs()
    $('ws-name').textContent = ws ? ws.name : '工作区'
    $('btn-ws').title = '当前工作区：' + (ws ? ws.name : '') + '（点击切换/管理）'
  }

const WsPanel = window.WorkspacePanel.createWorkspacePanel({
    $, api,
    workspaces: () => workspaces,
    wsMenu,
    wsOutsideClose, wsEscClose,
    busy: () => busy,
    sessions: () => sessions, sessionDrafts,
    currentId: () => currentId, setCurrentId: (v) => { currentId = v },
    currentWsId: () => currentWsId, setCurrentWsId: (v) => { currentWsId = v },
    sbFilter: () => sbFilter, setSbFilter: (v) => { sbFilter = v },
    curWs, wsSessions, saveWorkspaces, saveStore, saveSessions,
    renderWsBtn, renderSessionList, renderMessages, updateTitle,
    newSession, fitInput, loadKernel,
    confirmDialog, promptDialog, toast,
    currentKernelRef,
  })
  const renderWsMenu = () => WsPanel.renderWsMenu()
  const openWsMenu = () => WsPanel.openWsMenu()
  const closeWsMenu = () => WsPanel.closeWsMenu()
  const switchWorkspace = (id) => WsPanel.switchWorkspace(id)
  const newWorkspace = () => WsPanel.newWorkspace()
  const renameWorkspace = () => WsPanel.renameWorkspace()
  const deleteWorkspace = () => WsPanel.deleteWorkspace()
  const wsKernelAction = () => WsPanel.wsKernelAction()
  const branchFrom = (idx) => WsPanel.branchFrom(idx)
  function wsOutsideClose(e) {
    if (!wsMenu.contains(e.target) && e.target !== wsBtn && !wsBtn.contains(e.target)) closeWsMenu()
  }
  function wsEscClose(e) { if (e.key === 'Escape') closeWsMenu() }






  wsBtn.addEventListener('click', () => {
    if (!wsMenu.classList.contains('hidden')) { closeWsMenu(); return }
    openWsMenu()
  })
  $('ws-new').addEventListener('click', () => { closeWsMenu(); newWorkspace() })
  $('ws-rename').addEventListener('click', () => { closeWsMenu(); renameWorkspace() })
  $('ws-del').addEventListener('click', () => { closeWsMenu(); deleteWorkspace() })
  $('ws-kernel').addEventListener('click', () => { closeWsMenu(); wsKernelAction() })

  // ============ IF 线分歧：从任意玩家行动节点另开世界线重新选择 ============

const Rail = window.RailPanel.createRailPanel({ $, msgEl: () => document.getElementById('messages'), cancelHideAnim, hideWithAnim })
  const buildProgressRail = (messages) => Rail.buildProgressRail(messages)
  const tryShowRailHint = () => Rail.tryShowRailHint()
  const updateRailFill = () => Rail.updateRailFill()
  const hideRailPop = () => Rail.hideRailPop()

  // ============ 侧边栏：拖拽伸缩 + 收起（对标 Codex/ChatGPT） ============
  const sidebarEl = $('sidebar')
  const SB_MIN = 160, SB_MAX = 420, SB_COLLAPSED_W = 48, SB_SNAP_W = 110
  const narrowMQ = window.matchMedia('(max-width: 760px)')

  // 生效的收起态：用户手动收起 或 窗口过窄自动收起
  function sbCollapsed() { return !!cfg.sidebarCollapsed || narrowMQ.matches }

  function applySidebar() {
    const c = sbCollapsed()
    sidebarEl.classList.toggle('collapsed', c)
    document.body.classList.toggle('sb-collapsed', c)
    sidebarEl.style.width = c ? '' : Math.min(SB_MAX, Math.max(SB_MIN, Number(cfg.sidebarWidth) || 200)) + 'px'
    const tog = $('btn-sidebar-toggle')
    if (tog) {
      tog.innerHTML = c
        ? '<svg class="ic" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>'
        : '<svg class="ic" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>'
      tog.title = c ? '展开会话栏（Ctrl+B）' : '收起会话栏（Ctrl+B）'
    }
    tryShowRailHint() // R15：收起瞬间进度条首次可见 → 触发一次性提示
  }

  function toggleSidebar() {
    // 窄窗口下的展开请求不持久化（回到宽屏仍自动收起），仅本次展开
    cfg.sidebarCollapsed = !sbCollapsed()
    saveStore()
    applySidebar()
  }

  // 拖拽把手（右缘 7px 热区，hover 显示竖线）
  const sbHandle = document.createElement('div')
  sbHandle.className = 'sidebar-handle'
  sbHandle.title = '拖动调整宽度 · 拖到最窄自动收起'
  sidebarEl.appendChild(sbHandle)

  let sbDragging = false, sbStartX = 0, sbStartW = 0
  sbHandle.addEventListener('mousedown', (e) => {
    sbDragging = true
    sbStartX = e.clientX
    sbStartW = sidebarEl.getBoundingClientRect().width
    sidebarEl.classList.add('resizing')
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => {
    if (!sbDragging) return
    // 拖动即从收起态展开；侧栏在右侧时方向取反
    sidebarEl.classList.remove('collapsed')
    const dir = cfg.sbSide === 'right' ? -1 : 1
    const w = sbStartW + dir * (e.clientX - sbStartX)
    sidebarEl.style.width = Math.min(SB_MAX, Math.max(SB_COLLAPSED_W, w)) + 'px'
  })
  window.addEventListener('mouseup', () => {
    if (!sbDragging) return
    sbDragging = false
    sidebarEl.classList.remove('resizing')
    document.body.style.cursor = ''
    const w = sidebarEl.getBoundingClientRect().width
    if (w < SB_SNAP_W) {
      // 拖到最窄：snap 收起
      cfg.sidebarCollapsed = true
      toast('已收起会话栏 · Ctrl+B 展开或拖动右缘拉开', 'info', 2600)
    } else {
      cfg.sidebarCollapsed = false
      cfg.sidebarWidth = Math.round(w)
      // 窄窗口下拖开仅本次生效，不覆盖持久化宽度
      if (narrowMQ.matches) { sidebarEl.style.width = Math.round(w) + 'px'; saveStore(); return }
    }
    saveStore()
    applySidebar()
  })
  // 双击把手：直接收起/展开切换
  sbHandle.addEventListener('dblclick', toggleSidebar)

  // 窗口跨过窄屏断点时自动应用（窄→自动收起，宽→恢复用户设置）
  narrowMQ.addEventListener('change', applySidebar)
  applySidebar()

  // ---- 主题系统：明暗模式 × 多预设调色板 × 字体/圆角/密度/布局/侧栏方向 ----
  // 调色板预设（标题栏主题按钮与设置-外观均可切换；CSS 见 styles.css 尾部）
  const PALETTES = [
    { id: 'classic',  name: '经典',     dot: ['#c98b4b', '#a5641f'] },
    { id: 'paper',    name: '羊皮纸',     dot: ['#c9a25e', '#f5efe0'] },
    { id: 'forest',   name: '林间',       dot: ['#7fae6a', '#4e7a3a'] },
    { id: 'violet',   name: '紫晶',       dot: ['#a98fd6', '#6f52a3'] },
    { id: 'ocean',    name: '海渊',       dot: ['#62a8c9', '#2d6e93'] },
    { id: 'rose',     name: '蔷薇',       dot: ['#c97b9c', '#a34468'] },
    { id: 'contrast', name: '高对比',     dot: ['#ffcf7d', '#000000'] }
  ]
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)')
  // system 模式下解析实际明暗（palette 需要确定的 data-theme 才能命中 CSS）
  function resolvedTheme() {
    if (cfg.theme === 'dark' || cfg.theme === 'light') return cfg.theme
    return darkMQ.matches ? 'dark' : 'light'
  }
  const Appearance = window.AppearancePanel.createAppearance({ cfg: () => cfg, api, PALETTES, resolvedTheme })
  const applyTheme = (theme) => Appearance.applyTheme(theme)
  const applyAppearance = () => Appearance.applyAppearance()
  const applyReading = () => Appearance.applyReading()
  // 跟随系统时，系统切换明暗要立即反映到界面
  darkMQ.addEventListener('change', () => { if (cfg.theme === 'system') applyTheme('system') })

  // ---- 置顶 ----
  function setPin(on) {
    cfg.pin = !!on
    $('btn-pin').classList.toggle('active', cfg.pin)
    api.pin(cfg.pin)
  }

  // ---- 内核 ----
  // 内核引用解析：kernelId（内核库 id，如 user:xxx / builtin:kernel.md）优先，
  // 兼容旧版文件路径 kernelPath；返回 { ok, text, name } 形状与旧接口一致
  async function resolveKernelRef(ref) {
    if (!ref) return null
    if (ref.startsWith('builtin:') || ref.startsWith('user:')) return await api.kernelLibRead(ref)
    return await api.readKernelPath(ref) // 旧版文件路径绑定
  }
  function currentKernelRef() {
    const ws = curWs()
    return (ws && (ws.kernelId || ws.kernelPath)) || cfg.kernelPath || 'builtin:kernel.md'
  }

  // ---- 选项解析：兼容多种格式 ----
  // 选项解析：支持多种标记格式（兼容不同模型的输出习惯）
  // 选项解析已收敛到 shared/choices.js（双方案单一来源；本处保留同名委托以维持既有调用点）
  function parseChoices(text) { return ChoiceParser.parseChoices(text) }
  function extractQuoteChoices(text) { return ChoiceParser.extractQuoteChoices(text) }

  // ---- 插图 ----
const Illust = window.IllustPanel.createIllustPanel({
    api, cfg: () => cfg,
    curSession, busy: () => busy,
    renderMessages, saveSessions, toast,
    downloadIllust,
  })
  const illustReady = () => Illust.illustReady()
  const stylePrompt = () => Illust.stylePrompt()
  const buildIllustPrompt = (text) => Illust.buildIllustPrompt(text)
  const generateIllust = (idx, regen, isAuto, customPrompt) => Illust.generateIllust(idx, regen, isAuto, customPrompt)
  const viewIllust = (dataUrl, list) => Illust.viewIllust(dataUrl, list)

  // 从叙事文本提炼图像提示词：去掉选项/状态等结构化内容，取叙事主体

  // 为指定消息生成插图。idx 为当前会话 messages 下标。
  // regen: 已有插图时重新生成；isAuto: 自动触发（受最短长度门槛约束），手动点击不受限
  // customPrompt: 智能体优化后的提示词（不传则按叙事原文现场构建）

  // ---- 大图查看（支持多图浏览：← → 键 / 箭头按钮切换，Esc 关闭） ----
  // list: 可选的图片数组（画廊或当前会话的全部插图）；dataUrl: 当前图（在 list 中定位）

  // 轻量行内 Markdown：先 escapeHtml 再加标记（安全：不含原始 HTML）
  // 支持 **加粗** *斜体* `行内代码`
  function mdInline(escaped) {
    return escaped
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  }

  // 叙事结构化渲染：场景行 / 决定块 / 状态面板 / 选项弱化 / 段落排版
  // 纯展示用（HTML 已逐段转义），搜索态仍走 markMessage 纯文本高亮
  function renderNarrative(text, opts) {
    const raw = String(text || '')
    const hideOptions = !!(opts && opts.hideOptions) // R71：选项已提取为可点按钮时，正文不再重复渲染选项行
    const out = []
    let para = []
    const flush = () => {
      if (para.length) {
        out.push('<p>' + mdInline(escapeHtml(para.join(''))) + '</p>')
        para = []
      }
    }
    const lines = raw.split('\n')
    for (let li = 0; li < lines.length; li++) {
      const t = lines[li].trim()
      if (!t) { flush(); continue }
      // 场景行：【甲龙历 407.03.01｜清晨｜布耶纳村】/【玄历 1024.03.01｜清晨｜青阳城】等历法场景行
      if (/^【[^\]】]*历[^\]】]*｜/.test(t)) {
        flush()
        out.push('<div class="scene-line">' + mdInline(escapeHtml(t)) + '</div>')
        continue
      }
      // 决定块：【你需要决定】…
      if (/^【你需要决定】/.test(t)) {
        flush()
        out.push('<div class="ask-line">' + mdInline(escapeHtml(t)) + '</div>')
        continue
      }
      // 选项行：【A】…（历史轮弱化显示；当前轮已提取为可点按钮，正文跳过避免重复）
      if (/^【[A-H]】/.test(t)) {
        flush()
        if (hideOptions) continue
        out.push('<div class="option-line">' + mdInline(escapeHtml(t)) + '</div>')
        continue
      }
      // 简要状态块：【简要状态】行 + 后续行直到空行
      if (/^【简要状态】/.test(t)) {
        flush()
        const buf = [t]
        let j = li + 1
        while (j < lines.length && lines[j].trim()) { buf.push(lines[j].trim()); j++ }
        li = j - 1
        out.push('<div class="status-panel">' + escapeHtml(buf.join('\n')) + '</div>')
        continue
      }
      para.push(t)
    }
    flush()
    return out.join('') || '<p>' + escapeHtml(raw) + '</p>'
  }

  // ---- 渲染 ----
  const msgEl = $('messages')
  const choiceEl = $('choices')

  /* ---- 聊天历史窗口化（规范五/六/七/八）：DOM 只保留最近窗口 ----
   * Chat History ≠ Story Memory：完整历史仍在会话数据里（可搜索/可翻阅），
   * 但 DOM 节点数有界——打开/切换/发送只渲染最近 RENDER_WINDOW 条，
   * 向上翻阅按 RENDER_CHUNK 追加更早历史，避免大历史卡死前端。 */
  const RENDER_WINDOW = 60
  const RENDER_CHUNK = 60
  let renderWindow = RENDER_WINDOW
  let _renderedSessionId = null

  // 智能滚动：用户位于底部附近时跟随，向上翻阅时不打扰
  let wasNearBottom = true
  function autoScroll() {
    wasNearBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120
    if (wasNearBottom) msgEl.scrollTop = msgEl.scrollHeight
    const scrollBtn = document.getElementById('scroll-to-bottom')
    if (scrollBtn) scrollBtn.classList.toggle('hidden', wasNearBottom)
  }

  /* R86 流式选项渐进渲染：生成期间【你需要决定】文本一流到（状态块 JSON 尾巴还在路上）
   * 就把选项按钮先画出来——读完即可点选排队，观感等待从「全轮完成」缩短到「叙事读完」。
   * 逐帧调用幂等：选项集合签名没变且区非空则跳过；本轮结束后 renderMessages 全量重建权威版。 */
  let streamChoicesKey = ''
  function renderStreamingChoices(shownText) {
    if (!busy) { streamChoicesKey = ''; return }
    const cs = parseChoices(shownText)
    const key = cs.map((c) => c.key + '\u0001' + c.label).join('\u0002')
    if (key === streamChoicesKey && choiceEl.children.length > 0) return
    streamChoicesKey = key
    choiceEl.innerHTML = ''
    if (!cs.length) return
    const head = document.createElement('div')
    head.className = 'choices-head'
    const title = document.createElement('span')
    title.className = 'choices-title'
    title.textContent = '这一幕的 ' + cs.length + ' 个选择'
    const hint = document.createElement('span')
    hint.className = 'stream-choices-hint'
    hint.textContent = ' · 可先点选，稍后自动发出'
    head.appendChild(title); head.appendChild(hint)
    choiceEl.appendChild(head)
    for (const c of cs) {
      const b = document.createElement('button')
      b.className = 'choice'
      const ck = document.createElement('span')
      ck.className = 'ck'
      ck.textContent = c.key
      const lb = document.createElement('span')
      lb.textContent = c.label
      b.appendChild(ck); b.appendChild(lb)
      b.title = '点击即排队这一行动，本回合结束自动发出'
      b.addEventListener('click', () => send('【' + c.key + '】' + c.label))
      choiceEl.appendChild(b)
    }
    applyChoicesFold()
  }

  function renderMessages() {
    const searchState = Search.state()
    // 记住重绘前的滚动位置：贴底则重绘后仍贴底，否则保持原位（不打扰翻阅历史的用户）
    const prevScroll = msgEl.scrollTop
    wasNearBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120
    const s = curSession()
    if (!s || s.id !== _renderedSessionId) renderWindow = RENDER_WINDOW // 切换世界线重置窗口
    _renderedSessionId = s ? s.id : null
    const all = s ? s.messages : []
    const total = all.length
    const start = Math.max(0, total - renderWindow) // 窗口起点（绝对下标）
    const messages = all.slice(start)
    let lastAssistantIdx = -1
    // R71：预计算最后一条 assistant——其选项会提取为按钮，正文渲染时跳过选项行避免重复
    all.forEach((m, i) => { if (m.role === 'assistant') lastAssistantIdx = i })
    msgEl.innerHTML = ''

    // 「查看更早」哨兵：更早历史仍在数据中，按需加载进 DOM（规范七：分页接口语义）
    if (start > 0) {
      const older = document.createElement('button')
      older.className = 'load-older'
      older.textContent = '查看更早的消息（还有 ' + start + ' 条）'
      older.title = '加载更早的聊天记录进视图'
      older.addEventListener('click', () => {
        const prevHeight = msgEl.scrollHeight, prevTop = msgEl.scrollTop
        renderWindow += RENDER_CHUNK
        renderMessages()
        msgEl.scrollTop = msgEl.scrollHeight - prevHeight + prevTop // 顶部补页后保持视口锚定
      })
      msgEl.appendChild(older)
    }

    messages.forEach((m, k) => {
      const i = start + k // 绝对下标：工具/重生成/搜索/插图槽一律使用会话数据的真实下标
      const div = document.createElement('div')
      div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant')
      const role = document.createElement('div')
      role.className = 'msg-role'
      role.textContent = m.role === 'user' ? '你' : '世界'
      // 时间戳（悬停消息时显示，Codex 式低调呈现）
      if (m.at) {
        const ts = document.createElement('span')
        ts.className = 'msg-time'
        ts.textContent = new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        role.appendChild(ts)
      }

      // 消息工具栏（悬停出现）：复制 / 重生成 / 插图 / 下载
      const showTools = !busy && !String(m.content).startsWith('⚠️')
      if (showTools) {
        const tools = document.createElement('span')
        tools.className = 'msg-tools'
        // 复制文本
        const cb = document.createElement('button')
        cb.className = 'tool-btn'
        cb.textContent = '复制'
        cb.title = '复制这段文字'
        cb.addEventListener('click', () => {
          copyText(m.content)
        })
        tools.appendChild(cb)
        // 重生成（仅助手消息）
        if (m.role === 'assistant') {
          const rg = document.createElement('button')
          rg.className = 'tool-btn'
          rg.textContent = '重生成'
          rg.title = '重新生成这一回合'
          rg.addEventListener('click', () => regenerate(i))
          tools.appendChild(rg)
        }
        // 插图
        if (m.role === 'assistant' && illustReady()) {
          if (!m.illust && !m.illustPending) {
            const ib = document.createElement('button')
            ib.className = 'tool-btn'
            ib.textContent = '插图'
            ib.title = '为这一幕生成小说插图'
            ib.addEventListener('click', () => generateIllust(i, false))
            tools.appendChild(ib)
          } else if (m.illust) {
            const rb = document.createElement('button')
            rb.className = 'tool-btn'
            rb.textContent = '重绘'
            rb.title = '重新生成这张插图'
            rb.addEventListener('click', () => generateIllust(i, true))
            tools.appendChild(rb)
          }
        }
        // IF 线分歧（仅玩家行动消息）：从这一步另开世界线重新选择
        if (m.role === 'user') {
          const ifb = document.createElement('button')
          ifb.className = 'tool-btn if-btn'
          ifb.textContent = 'IF 分歧'
          ifb.title = '开辟 IF 线：在新世界线里复刻到此为止的历史，回到这一步重新选择（原线不受影响）'
          ifb.addEventListener('click', () => branchFrom(i))
          tools.appendChild(ifb)
        }
        // 下载插图
        if (m.illust) {
          const dl = document.createElement('button')
          dl.className = 'tool-btn'
          dl.textContent = '保存'
          dl.title = '保存这张插图到本地'
          dl.addEventListener('click', () => downloadIllust(m.illust, i))
          tools.appendChild(dl)
        }
        role.appendChild(tools)
      }

      const body = document.createElement('div')
      body.className = 'msg-body'
      // 错误消息：友好呈现 + 重试按钮（复用上一条 user 行动）
      const isError = m.role === 'assistant' && String(m.content || '').startsWith('⚠️')
      if (isError) {
        body.classList.add('err')
        // 提取原始错误文本（去掉 ⚠️ 前缀行）
        const raw = String(m.content).replace(/^⚠️[^\n]*\n?/, '')
        body.textContent = raw || m.content
        if (!busy && i === total - 1) {
          const retryBtn = document.createElement('button')
          retryBtn.className = 'retry-btn'
          retryBtn.textContent = '↻ 重试这一回合'
          retryBtn.title = '移除报错并重新发送上一条行动'
          retryBtn.addEventListener('click', () => {
            // 移除这条报错消息，然后复用其前的 user 行动重发（regen 不重复 push user）
            const cs = curSession()
            if (!cs) return
            cs.messages.splice(i, 1)
            saveSessions()
            send(null, { regen: true })
          })
          body.appendChild(document.createElement('br'))
          body.appendChild(retryBtn)
        }
      }
      // 搜索态：对命中片段高亮（HTML 已转义，安全）；Search 闭包态经 state() 读取
      else if (searchState.query && searchState.matches.some((x) => x.msgIdx === i)) {
        body.classList.add('plain')
        const marked = markMessage(m.content, searchState.query)
        if (marked) body.innerHTML = marked.html
        else body.textContent = m.content
      }
      // 叙事消息：结构化渲染（场景行/决定块/段落）；当前轮选项已提取为按钮 → 正文隐藏选项行
      else if (m.role === 'assistant') {
        body.innerHTML = renderNarrative(m.content, {
          hideOptions: i === lastAssistantIdx && !busy && parseChoices(m.content).length > 0,
        })
      } else {
        body.textContent = m.content
      }

      if (m.role === 'assistant' && (m.illust || m.illustPending)) {
        const il = document.createElement('div')
        il.className = 'illust'
        if (m.illust) {
          const img = document.createElement('img')
          img.src = m.illust
          img.alt = '场景插图'
          img.title = '点击查看大图'
          // 传入当前会话全部插图，Lightbox 中可 ← → 切换
          const allIllusts = all.filter((x) => x.illust).map((x) => x.illust)
          img.addEventListener('click', () => viewIllust(m.illust, allIllusts))
          // R33b 键盘可达：Enter/Space 打开大图
          img.tabIndex = 0
          img.setAttribute('role', 'button')
          img.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.click() }
          })
          il.appendChild(img)
        } else if (m.illustPending) {
          il.className = 'illust-pending'
          il.innerHTML = '<span class="dots">正在绘制这一幕的插图</span>'
        }
        div.appendChild(role)
        div.appendChild(il)
        div.appendChild(body)
      } else if (m.role === 'assistant' && m.illustError) {
        div.appendChild(role)
        const err = document.createElement('div')
        err.className = 'illust-error'
        err.textContent = '插图生成失败：' + m.illustError
        // 一键重试绘制（清除错误状态重新生成）
        if (!busy && illustReady()) {
          const rb = document.createElement('button')
          rb.className = 'retry-btn'
          rb.textContent = '↻ 重试绘制'
          rb.title = '重新为这一幕生成插图'
          rb.addEventListener('click', () => {
            m.illustError = null
            generateIllust(i, false)
          })
          err.appendChild(document.createElement('br'))
          err.appendChild(rb)
        }
        div.appendChild(err)
        div.appendChild(body)
      } else {
        div.appendChild(role)
        div.appendChild(body)
        if (m.role === 'assistant') {
          const slot = document.createElement('div')
          slot.id = 'illust-slot-' + i
          div.appendChild(slot)
        }
      }

      msgEl.appendChild(div)
      div.dataset.mi = i
      // 落账徽标（条款 30）：三态明确区分「记账中 / 未落账 / 正常完成」，不悄悄假装已保存
      if (m.role === 'assistant' && (m.pending || m.committing)) {
        if (m.committing) {
          // 记账中：后台补录进行时（不可点击，阅读/选项不受影响）
          const chip = document.createElement('div')
          chip.className = 'msg-committing-chip'
          chip.textContent = '◌ 记忆记账中…'
          chip.title = '正在把这一回合写入世界记忆（后台进行，不影响阅读和选择）。完成后自动消失。'
          div.appendChild(chip)
        } else {
          const chip = document.createElement('button')
          chip.className = 'msg-pending-chip'
          chip.textContent = '⚠ 状态未落账 · 点击补录'
          chip.title = '这一回合的结构化状态没有正式提交（模型缺状态块或校验未过）。点击立即尝试补录。'
          chip.addEventListener('click', () => resolvePendingFlow(typeof m.pending === 'string' ? m.pending : null))
          div.appendChild(chip)
        }
      }
    })

    // 流式中的消息
    if (busy && streaming !== '') {
      const div = document.createElement('div')
      div.className = 'msg assistant'
      const role = document.createElement('div')
      role.className = 'msg-role'
      role.textContent = '世界'
      const body = document.createElement('div')
      body.className = 'msg-body plain'
      body.textContent = streaming + ' ▍'
      div.appendChild(role); div.appendChild(body)
      msgEl.appendChild(div)
    } else if (busy) {
      const div = document.createElement('div')
      div.className = 'msg assistant'
      const role = document.createElement('div')
      role.className = 'msg-role'
      role.textContent = '世界'
      const body = document.createElement('div')
      body.className = 'msg-body plain'
      body.innerHTML = '<span class="stream-dot">▍</span>'
      div.appendChild(role); div.appendChild(body)
      msgEl.appendChild(div)
    }

    // 空状态（开场引导）
    if (total === 0 && !busy) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      const sigil = document.createElement('div')
      sigil.className = 'empty-sigil'
      sigil.innerHTML = '<svg width="44" height="44" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/><path d="M8 4.5 11.5 8 8 11.5 4.5 8Z"/></svg>'
      const kMeta = parseKernelMeta(kernel && kernel.text)
      const title = document.createElement('div')
      title.className = 'empty-title'
      title.textContent = (kMeta && kMeta.title) || '六面世界'
      const p = document.createElement('p')
      p.textContent = (kMeta && kMeta.tagline) || '世界已就绪，等待第一个转生者'
      const btn = document.createElement('button')
      btn.className = 'primary'
      btn.textContent = (kMeta && kMeta.startLabel) || '开始游戏'
      btn.addEventListener('click', () => send((kMeta && kMeta.startPayload) || '开始'))
      // R70 快启：转生出身预设——填入输入框可编辑再发送（复用灵感按钮的填入模式，零业务变更）
      const quick = document.createElement('div')
      quick.className = 'empty-quick'
      const ORIGINS = (kMeta && kMeta.origins && kMeta.origins.length) ? kMeta.origins : [
        { label: '平民之子', text: '我是一个平民家庭的孩子，出生在乡村，平凡但渴望改变命运' },
        { label: '贵族血脉', text: '我出身贵族旁支，背负家族期望但渴望自由' },
        { label: '流浪剑士', text: '我是一个身无分文的流浪剑士，靠接委托为生' },
        { label: '神秘来客', text: '我带着模糊的前世记忆醒来，被陌生人收留' },
      ]
      const quickLabel = document.createElement('div')
      quickLabel.className = 'empty-quick-label'
      quickLabel.textContent = (kMeta && kMeta.quickLabel) || '选择一个出身，或直接自由描述'
      quick.appendChild(quickLabel)
      const quickRow = document.createElement('div')
      quickRow.className = 'empty-quick-row'
      ORIGINS.forEach((o) => {
        const c = document.createElement('button')
        c.className = 'empty-quick-chip'
        c.textContent = o.label
        c.title = o.text
        c.addEventListener('click', () => {
          const inputEl = $('input')
          inputEl.value = o.text
          sessionDrafts.set(currentId, inputEl.value)
          fitInput()
          inputEl.focus()
        })
        quickRow.appendChild(c)
      })
      quick.appendChild(quickRow)
      const tip = document.createElement('p')
      tip.className = 'empty-tip'
      tip.textContent = 'Enter 发送 · Shift+Enter 换行 · Ctrl+, 设置'
      empty.appendChild(sigil); empty.appendChild(title); empty.appendChild(p)
      empty.appendChild(btn); empty.appendChild(quick); empty.appendChild(tip)
      // R10 P2：API 未配置时预防提示（点击前就知道会发生什么，而非仅靠事后报错）
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        const cfgTip = document.createElement('p')
        cfgTip.className = 'empty-tip empty-cfg-tip'
        cfgTip.textContent = '尚未配置 API —— 点击「开始游戏」将自动打开设置完成配置'
        empty.appendChild(cfgTip)
      }
      msgEl.appendChild(empty)
    }

    // 选项（多选组合：普通点击直接发送；多选模式或 Ctrl+点击勾选累积，组合发送）
    choiceMode = false
    choiceEl.innerHTML = ''
    multiSel.clear()
    // 输入占位随上下文切换（P1：占位文案须与当前可用操作一致）
    $('input').placeholder = '自由描述你的行动…（Enter 发送 · Shift+Enter 换行）'
    if (lastAssistantIdx >= 0 && !busy) {
      const choices = parseChoices(all[lastAssistantIdx].content)
      if (choices.length > 0) {
        choiceMode = true
        $('input').placeholder = '点选上方选项直接行动，或在此自由描述…（Enter 发送）'
        // 一次性 IF 发现提示（R7 P1-1）：首次出现选项时展示；点 ✕ 或用过 IF 后永不再现
        if (!localStorage.getItem('sixworlds.ifhint-seen.v1')) {
          const ifh = document.createElement('div')
          ifh.className = 'if-hint'
          const ift = document.createElement('span')
          ift.textContent = '选错了也没关系——悬停你发出的那条行动，点「IF 分歧」换条路重走'
          const ifx = document.createElement('button')
          ifx.className = 'if-hint-x'; ifx.title = '知道了'; ifx.innerHTML = '<svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
          ifx.addEventListener('click', () => { localStorage.setItem('sixworlds.ifhint-seen.v1', '1'); ifh.remove() })
          ifh.appendChild(ift); ifh.appendChild(ifx)
          choiceEl.appendChild(ifh)
        }
        // 头部行：选项数 + 多选模式开关 + 收起开关（上滑自动收起时也可手动展开）
        const head = document.createElement('div')
        head.className = 'choices-head'
        const title = document.createElement('span')
        title.className = 'choices-title'
        title.textContent = '这一幕的 ' + choices.length + ' 个选择'
        const multiBtn = document.createElement('button')
        multiBtn.className = 'multi-toggle' + (multiMode ? ' on' : '')
        multiBtn.textContent = multiMode ? '✓ 多选组合' : '多选组合'
        multiBtn.title = '开启后点击选项即勾选（可多选），再点组合发送一次执行；也支持随时 Ctrl+点击'
        multiBtn.addEventListener('click', () => {
          multiMode = !multiMode
          if (!multiMode) {
            multiSel.clear()
            choiceEl.querySelectorAll('.choice.picked').forEach((el) => el.classList.remove('picked'))
            const mb = choiceEl.querySelector('.multi-bar')
            if (mb) mb.classList.add('hidden')
          }
          multiBtn.classList.toggle('on', multiMode)
          multiBtn.textContent = multiMode ? '✓ 多选组合' : '多选组合'
        })
        const foldBtn = document.createElement('button')
        foldBtn.className = 'choices-fold'
        foldBtn.textContent = '收起 ▴'
        foldBtn.title = '收起选项区（回到底部时自动展开）'
        foldBtn.addEventListener('click', () => { choicesFoldUser = true; applyChoicesFold() })
        head.appendChild(title); head.appendChild(multiBtn); head.appendChild(foldBtn)
        choiceEl.appendChild(head)
        // 多选工具条（有勾选时出现）
        const bar = document.createElement('div')
        bar.className = 'multi-bar hidden'
        const info = document.createElement('span')
        info.className = 'multi-info'
        const sendBtn = document.createElement('button')
        sendBtn.className = 'primary multi-send'
        sendBtn.textContent = '组合发送'
        sendBtn.title = '把勾选的选项组合成一条行动发送'
        const clearBtn = document.createElement('button')
        clearBtn.className = 'ghost multi-clear'
        clearBtn.textContent = '清空'
        bar.appendChild(info); bar.appendChild(sendBtn); bar.appendChild(clearBtn)
        choiceEl.appendChild(bar)
        const syncBar = () => {
          const n = multiSel.size
          bar.classList.toggle('hidden', n === 0)
          info.textContent = n ? ('已选 ' + n + ' 项：' + Array.from(multiSel).map((c) => c.key).join(' + ')) : ''
        }
        sendBtn.addEventListener('click', () => {
          if (!multiSel.size) return
          const combined = Array.from(multiSel).map((c) => '【' + c.key + '】' + c.label).join('；')
          multiSel.clear()
          multiMode = false // R54：组合发送后退出多选模式（防止下一回合单击被意外勾选；与文件管理器选择模式同惯例）
          send(combined)
        })
        clearBtn.addEventListener('click', () => {
          multiSel.clear()
          choiceEl.querySelectorAll('.choice.picked').forEach((el) => el.classList.remove('picked'))
          syncBar()
        })

        for (const c of choices) {
          const b = document.createElement('button')
          b.className = 'choice'
          const ck = document.createElement('span')
          ck.className = 'ck'
          ck.textContent = c.key
          const lb = document.createElement('span')
          lb.textContent = c.label
          b.appendChild(ck); b.appendChild(lb)
          b.title = '点击直接行动 · Ctrl+点击或多选模式下勾选组合'
          b.addEventListener('click', (e) => {
            if (multiMode || e.ctrlKey || e.metaKey || e.shiftKey) {
              // 多选：勾选/取消
              if (multiSel.has(c)) {
                multiSel.delete(c)
                b.classList.remove('picked')
              } else {
                multiSel.add(c)
                b.classList.add('picked')
              }
              syncBar()
            } else {
              send('【' + c.key + '】' + c.label)
            }
          })
          choiceEl.appendChild(b)
        }
      }
    }
    // R83 兜底 v2：模型未按契约输出选项时，先从原文提取「引号候选清单」（上下文相关），
    // 提取不到才退回通用建议。引号分支是内容的确定性映射，测试环境允许；
    // 通用三条仍只在真实会话注入（防污染 e2e）。错误回合不注入。
    const lastMsg = lastAssistantIdx >= 0 ? all[lastAssistantIdx] : null
    const isErr = !!lastMsg && String(lastMsg.content || '').startsWith('⚠️')
    const quoteChoices = (!choiceMode && lastMsg && !isErr) ? extractQuoteChoices(lastMsg.content) : []
    if (quoteChoices.length >= 2) {
      choiceMode = true
      $('input').placeholder = '点选上方选项直接行动，或在此自由描述…（Enter 发送）'
      const head = document.createElement('div')
      head.className = 'choices-head'
      const title = document.createElement('span')
      title.className = 'choices-title'
      title.textContent = '也可以直接从文中选一个方向：'
      const foldBtn = document.createElement('button')
      foldBtn.className = 'choices-fold'
      foldBtn.textContent = '收起 ▴'
      foldBtn.title = '收起选项区（回到底部时自动展开）'
      foldBtn.addEventListener('click', () => { choicesFoldUser = true; applyChoicesFold() })
      head.appendChild(title); head.appendChild(foldBtn)
      choiceEl.appendChild(head)
      const keys = ['A', 'B', 'C', 'D', 'E', 'F']
      quoteChoices.forEach((label, i) => {
        const b = document.createElement('button')
        b.className = 'choice fallback'
        const ck = document.createElement('span')
        ck.className = 'ck'
        ck.textContent = keys[i]
        const lb = document.createElement('span')
        lb.textContent = label
        b.appendChild(ck); b.appendChild(lb)
        b.title = '点击直接行动 · Ctrl+点击或多选模式下勾选组合'
        b.addEventListener('click', (e) => {
          send('【' + keys[i] + '】' + label)
        })
        choiceEl.appendChild(b)
      })
    } else {
      const allowGenericFallback = !choiceMode && !isErr && lastAssistantIdx >= 0 &&
        !(window.api && window.api.isTest)
      if (allowGenericFallback) {
        choiceMode = true
        $('input').placeholder = '点选上方选项直接行动，或在此自由描述…（Enter 发送）'
        const head = document.createElement('div')
        head.className = 'choices-head'
        const title = document.createElement('span')
        title.className = 'choices-title'
        title.textContent = '世界线在自行流淌——可以选择：'
        const foldBtn = document.createElement('button')
        foldBtn.className = 'choices-fold'
        foldBtn.textContent = '收起 ▴'
        foldBtn.title = '收起选项区（回到底部时自动展开）'
        foldBtn.addEventListener('click', () => { choicesFoldUser = true; applyChoicesFold() })
        head.appendChild(title); head.appendChild(foldBtn)
        choiceEl.appendChild(head)
        for (const t of ['继续推进剧情', '调查周围的环境和人物', '等待事态进一步发展']) {
          const b = document.createElement('button')
          b.className = 'choice fallback'
          b.textContent = t
          b.title = '把这句话作为你的行动发送'
          b.addEventListener('click', () => send(t))
          choiceEl.appendChild(b)
        }
      }
    }
    applyChoicesFold()

    msgEl.scrollTop = wasNearBottom ? msgEl.scrollHeight : prevScroll
    // 新一幕到达且玩家在置底：自动展开选项区（按钮跟随出现）
    if (choiceMode && wasNearBottom && (choicesFoldUser || choicesAutoFolded)) {
      choicesFoldUser = false
      choicesAutoFolded = false
      applyChoicesFold()
    }
    buildProgressRail(messages)
    // Pending Commit 横幅（条款 26）：每次重绘随当前故事刷新（切线/重启后自动可见）
    if (!busy) refreshPendingBanner()
  }

  // ============ 故事进度条（会话栏完全收起时显示在左侧） ============
  // 每次世界回应 = 一个节点；带插图的节点高亮，悬停显示图片小窗 / 文字摘要，点击跳转到那一幕
  // 进度填充 = 当前滚动位置在整条故事中的比例
  // 悬停小窗内容：插图优先，否则场景行/摘要

  // 流式期间只更新最后一条流式消息的文本（不整页重绘）
  // 性能：增量按帧合并（requestAnimationFrame），且用 appendData 只「追加」新字——
  // 不再每帧把整段已生成文本重写进 DOM（旧法每帧成本随篇幅线性增长，长回复越写越卡）
  let streamRaf = 0
  let streamRenderedLen = 0
  // 状态引擎：流式期间实时隐藏协议块（含未完整的标记前缀与常见变体：两箭头/全角/围栏行）
  const STREAM_MARKS = ['<<<STATE_PATCH>>>', '<<<STATE_PATCH>', '<<< STATE_PATCH >>>', '<<<state_patch>>>', '＜＜＜STATE_PATCH＞＞＞', '```json', '```', 'update_state(']
  const STREAM_MARK = '<<<STATE_PATCH>>>'   // hold 前缀判定仍以标准形态为基准（变体逐字增量各异，够用）

  // ============ 消息搜索（Ctrl+F 在当前世界线内搜索） ============
  // 思路：维护 query 与命中索引，renderMessages 在渲染 body 时对命中片段包裹 <mark>
  const searchBar = $('search-bar')
  const searchInput = $('search-input')

  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  // 计算一条消息中命中次数；同时返回包好 mark 的 HTML（不命中则 null，避免无谓重排）
  const Search = window.SearchPanel.createSearch({
    $, msgEl, searchBar, searchInput,
    curSession, escapeHtml, escapeRegExp,
    renderMessages,
    cancelHideAnim, hideWithAnim,
    focusInput: () => $('input').focus(),
    RENDER_WINDOW,
    expandRenderWindow: (need) => { renderWindow = Math.max(renderWindow, need) },
  })
  const markMessage = (content, query) => Search.markMessage(content, query)
  const openSearch = () => Search.openSearch()
  const closeSearch = () => Search.closeSearch()
  const runSearch = (q) => Search.runSearch(q)
  const searchStep = (dir) => Search.searchStep(dir)

  searchInput.addEventListener('input', () => runSearch(searchInput.value))
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchStep(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
  })
  $('search-next').addEventListener('click', () => searchStep(1))
  $('search-prev').addEventListener('click', () => searchStep(-1))
  $('search-close').addEventListener('click', closeSearch)

  // ---- 发送 ----
  // opts: { regen: bool } 重新生成时，先移除最后一条 assistant 再复用上一条 user
  // ======== 故事状态引擎桥（结构化状态 + 长期记忆 + 检索） ========
  // 概念映射：Story = 世界线（s.id）· Session = 本次运行内对该故事的交互连接 · Turn = 一次提交
  // 存储在主进程 userData/story-engine/（按故事分文件 + 快照 + 回合日志），与 localStorage 叙事历史互补。
  // 条款 17：State Patch 缺失时的补录请求词——只要求补结构化状态，严禁重写剧情（条款 25）
  // 补录提示词：自带最小模板示例（弱模型按例输出可大幅提高合规率）；reason 用于冲突引导
  const EngineFlow = window.EngineFlow.createEngineFlow({
    api,
    curWs,
    currentKernelRef,
    kernel: () => kernel,
  })
  const patchRetryPrompt = (reason) => EngineFlow.patchRetryPrompt(reason)
  const PATCH_RETRY_PROMPT = EngineFlow.patchRetryPrompt(null)
  const enginePrep = (s, playerInput) => EngineFlow.enginePrep(s, playerInput)

const sendSt = {
    get busy() { return busy }, set busy(v) { busy = v },
    get engineBusy() { return engineBusy }, set engineBusy(v) { engineBusy = v },
    get busyIsland() { return busyIsland }, set busyIsland(v) { busyIsland = v },
    get currentReqId() { return currentReqId }, set currentReqId(v) { currentReqId = v },
    get streaming() { return streaming }, set streaming(v) { streaming = v },
    get streamRaf() { return streamRaf }, set streamRaf(v) { streamRaf = v },
    get streamRenderedLen() { return streamRenderedLen }, set streamRenderedLen(v) { streamRenderedLen = v },
  }
  const SendOrch = window.SendFlow.createSend({
    st: sendSt, $, api, msgEl,
    STREAM_MARKS, STREAM_MARK, autoScroll,
    cfg: () => cfg, kernel: () => kernel,
    curSession, deriveTitle, fitInput, generateIllust, illustReady,
    newSession, openSettings,
    renderMessages, renderSessionList, saveSessions, sessionDrafts,
    setSendButtonState, showBusyIsland, toast, touchSession, updateTitle,
    enginePrep, patchRetryPrompt, protocolText: () => EngineFlow.protocolText(),
    // R86：流式选项渐进渲染——【你需要决定】一出现即可点选（点击经排队发送，不等 JSON 尾巴）
    onStreamChoices: (shownText) => renderStreamingChoices(shownText),
  })
  const send = SendOrch.send
  const appendStream = (piece) => SendOrch.appendStream(piece)
  const resolvePendingFlow = window.SendFlow.createResolvePendingFlow({
    st: sendSt, $, api,
    cfg: () => cfg, kernel: () => kernel,
    curSession, renderMessages, toast,
    enginePrep, patchRetryPrompt, protocolText: () => EngineFlow.protocolText(),
    seedProtocolText: (t) => EngineFlow.seedProtocolText(t),
    refreshPendingBanner,
  })
  // 中途取消当前生成
  function stopGeneration() {
    if (!busy || !currentReqId) return
    api.abortChat(currentReqId)
    SendOrch.clearQueue('已停止生成本轮（排队中的发送一并取消）') // R86：停止即放弃排队续发
  }

  // 重新生成指定回合（默认最后一回合）
  function regenerate(idx) {
    if (busy) { toast('请等当前回合结束', 'info'); return }
    if (engineBusy) { toast('上一回合状态正在补录，请稍候', 'info'); return }
    const s = curSession()
    if (!s) return
    // idx 指向一条 assistant 消息；找到其前的 user，移除该 assistant 及之后
    if (idx < 0 || idx >= s.messages.length) return
    // 截断到 idx（含 idx 的 assistant 一并移除），再复用截断前的 user
    if (s.messages[idx].role !== 'assistant') {
      toast('只能重新生成世界回应', 'info')
      return
    }
    s.messages = s.messages.slice(0, idx)
    saveSessions()
    // send 会取最后一条 user 作为上下文（regen=true 不会再 push user）
    send(null, { regen: true })
  }

  // ============ Pending Commit（条款 18/19/26/27/30） ============
  // 横幅：重启/切线后扫描该故事的未落账回合；补录：静默请求补状态块并 resolvePending
  async function refreshPendingBanner() {
    const el = document.getElementById('pending-banner')
    if (!el) return
    const s = curSession()
    if (!s) { el.classList.add('hidden'); return }
    try {
      const r = await api.enginePendings({ storyId: s.id })
      const n = (r && r.ok && Array.isArray(r.data)) ? r.data.length : 0
      const label = document.getElementById('pending-count')
      if (n > 0) {
        el.classList.remove('hidden')
        if (label) label.textContent = n + ' 条回合状态未落账（剧情已展示，状态未提交——多因模型未按协议输出状态块。可一键补录；反复补不进可「放弃」并建议更换模型）'
      } else {
        el.classList.add('hidden')
      }
    } catch { el.classList.add('hidden') }
  }


  // 复制文本到剪贴板
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(String(text || ''))
      } else {
        const ta = document.createElement('textarea')
        ta.value = String(text || '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      toast('已复制', 'ok', 1800)
    } catch (e) {
      toast('复制失败', 'err')
    }
  }

  // 保存插图到本地文件
  async function downloadIllust(dataUrl, idx) {
    const s = curSession()
    const idxLabel = (idx >= 0 && s && s.messages[idx]) ? (idx + 1) : Date.now()
    const nameBase = s ? (s.title || 'illust').replace(/[\\/:*?"<>|]/g, '_') : 'illust'
    const r = await api.saveImage({ dataUrl, defaultName: nameBase + '-' + idxLabel })
    if (r && r.ok) toast('插图已保存：' + r.path, 'ok')
    else if (r && r.error) toast('保存失败：' + r.error, 'err')
  }

  // 发送按钮在 busy 时变为 STOP；标题栏同步忙碌指示（Codex 式状态徽标）
  const ICON_SEND = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M3.5 8.5 8 13h4.5M12.5 13H8M12.5 13V8.5"/></svg>'
  const ICON_STOP = '<svg class="ic ic-sm" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>'
  function setSendButtonState(isBusy) {
    const btn = $('btn-send')
    if (btn) {
      if (isBusy) {
        btn.innerHTML = '停止 ' + ICON_STOP
        btn.classList.add('stop')
        btn.title = '停止生成'
      } else {
        btn.innerHTML = '发送 ' + ICON_SEND
        btn.classList.remove('stop')
        btn.title = '发送'
      }
    }
    // 头部忙碌指示
    const head = document.querySelector('.chat-header')
    if (head) head.classList.toggle('busy', !!isBusy)
    const status = document.getElementById('chat-status')
    if (status) {
      status.textContent = isBusy ? '世界运转中…' : ''
      status.classList.toggle('on', !!isBusy)
    }
    // 同步 busy 到主进程：生成中关闭窗口时弹确认
    try { ipcSendBusy(!!isBusy) } catch {}
  }
  // ipcRenderer 单向通知（经 preload 暴露的 sendBusy）
  function ipcSendBusy(v) { if (window.api && window.api.sendBusy) window.api.sendBusy(v) }

  function updateTitle() {
    const s = curSession()
    const n = s ? s.messages.length : 0
    const provider = PRESETS[cfg.preset] ? PRESETS[cfg.preset].name : cfg.preset
    $('chat-title').textContent = n === 0 ? '序幕 · 帷幕未启' : (s ? s.title : '') + ' · ' + Math.ceil(n / 2) + ' 回合'
    // R43 IF 线母线面包屑：有血缘时标题旁显示「← 母线」，点击按标准切线流程回母线
    if (s && s.ifFrom) {
      const parent = sessions.find((x) => x.id === s.ifFrom)
      if (parent) {
        const bc = document.createElement('button')
        bc.className = 'mother-chip'
        bc.textContent = '← 母线：' + parent.title
        bc.title = '回到母线：' + parent.title
        bc.addEventListener('click', () => {
          if (busy) return
          const inputEl3 = $('input')
          if (currentId) sessionDrafts.set(currentId, inputEl3.value)
          currentId = parent.id
          choicesFoldUser = false; choicesAutoFolded = false; multiMode = false; multiSel.clear()
          const ws = curWs()
          if (ws) { ws.lastSessionId = parent.id; saveWorkspaces() }
          saveStore()
          inputEl3.value = sessionDrafts.get(parent.id) || ''
          fitInput()
          renderSessionList(); renderMessages(); updateTitle()
          toast('已回到母线', 'info', 1800)
        })
        $('chat-title').appendChild(bc)
      }
    }
    // 右上角模型芯片：文本模型 + 插图模型（点击查看 token 用量与扣费）
    const chipT = $('chip-text-model')
    if (chipT) { chipT.textContent = cfg.model; chipT.title = '文本模型：' + cfg.model + ' · 点击查看用量' }
    const chipI = $('chip-img-model')
    if (chipI) {
      if (illustReady()) {
        chipI.hidden = false
        // illustModel 可经配置导入进入——拼接前转义，防导入恶意 JSON 注入 HTML（CSP 之外的纵深）
        chipI.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/><path d="M8 4.5 11.5 8 8 11.5 4.5 8Z"/></svg> ' + escapeHtml(cfg.illustModel) + (cfg.illustAuto ? ' · 自动' : '')
        chipI.title = '插图模型：' + cfg.illustModel + ' · 点击查看用量'
      } else {
        chipI.hidden = true
      }
    }
    // 窗口标题同步当前世界线（任务栏/Alt+Tab 可辨识）
    document.title = (s && n > 0 && s.title ? s.title : '六面世界')
  }

  // ---- 右上角模型用量面板（点模型芯片展开） ----
  function renderModelPop() {
    const pop = $('model-pop')
    if (!pop) return
    const s = curSession()
    let allTok = 0, allCost = 0, allImgs = 0
    for (const x of sessions) {
      if (x.tokens) { allTok += x.tokens.total || 0; allCost += x.tokens.cost || 0 }
      allImgs += x.messages.filter((m) => m.illust).length
    }
    const provider = PRESETS[cfg.preset] ? PRESETS[cfg.preset].name : cfg.preset
    const st = (s && s.tokens) ? s.tokens : { prompt: 0, completion: 0, total: 0, cost: 0 }
    const sessImgs = s ? s.messages.filter((m) => m.illust).length : 0
    const row = (k, v) => {
      const d = document.createElement('div'); d.className = 'mp-row'
      const k1 = document.createElement('span'); k1.className = 'mp-k'; k1.textContent = k
      const v1 = document.createElement('span'); v1.className = 'mp-v'; v1.textContent = v
      d.appendChild(k1); d.appendChild(v1)
      return d
    }
    pop.innerHTML = ''
    const secT = document.createElement('div'); secT.className = 'mp-sec'; secT.textContent = '文本模型'
    pop.appendChild(secT)
    pop.appendChild(row('模型', cfg.model || '—'))
    pop.appendChild(row('提供商', provider))
    pop.appendChild(row('本线用量', (st.prompt || 0) + ' 输入 / ' + (st.completion || 0) + ' 输出 / ' + (st.total || 0) + ' tok'))
    pop.appendChild(row('全部世界线', allTok + ' tok'))
    const costTxt = (st.cost > 0 || allCost > 0)
      ? ((st.cost || 0).toFixed(4) + '（累计 ' + allCost.toFixed(4) + '）')
      : '端点未返回计费信息'
    pop.appendChild(row('扣费', costTxt))
    const secI = document.createElement('div'); secI.className = 'mp-sec'; secI.textContent = '插图模型'
    pop.appendChild(secI)
    if (illustReady()) {
      pop.appendChild(row('模型', cfg.illustModel || '—'))
      pop.appendChild(row('本线插图', sessImgs + ' 张'))
      pop.appendChild(row('全部插图', allImgs + ' 张'))
      pop.appendChild(row('扣费', '图像生成通常按张计费，费率见提供商账单'))
    } else {
      pop.appendChild(row('状态', '未启用（设置 · 插图模型）'))
    }
  }
  function toggleModelPop() {
    const pop = $('model-pop')
    if (!pop) return
    if (pop.classList.contains('hidden')) { renderModelPop(); cancelHideAnim(pop); pop.classList.remove('hidden') }
    else hideWithAnim(pop, () => pop.classList.add('hidden'))
  }
  const chipT0 = $('chip-text-model'), chipI0 = $('chip-img-model')
  if (chipT0) chipT0.addEventListener('click', (e) => { e.stopPropagation(); toggleModelPop() })
  if (chipI0) chipI0.addEventListener('click', (e) => { e.stopPropagation(); toggleModelPop() })

  // ---- 对话栏：切换模型 / 思考程度 ----
  function refreshModelSelect() {
    const sel = $('sel-model')
    if (!sel) return
    const list = (Array.isArray(cfg.models) ? cfg.models.slice() : []).filter(Boolean)
    if (cfg.model && !list.includes(cfg.model)) list.unshift(cfg.model)
    sel.innerHTML = ''
    for (const m of list) {
      const o = document.createElement('option')
      o.value = m
      o.textContent = m.length > 26 ? m.slice(0, 24) + '…' : m
      o.title = m
      sel.appendChild(o)
    }
    sel.value = cfg.model || ''
    sel.hidden = list.length < 2 // 只有一个可选模型时收起下拉
  }
  const selModel = $('sel-model')
  const selThink = $('sel-think')
  if (selModel) selModel.addEventListener('change', () => {
    if (!selModel.value || selModel.value === cfg.model) return
    cfg.model = selModel.value
    saveStore()
    // 反向同步给已打开的设置窗口，避免其旧快照在保存时覆盖
    try { api.mainChanged({ model: cfg.model }) } catch { /* noop */ }
    updateTitle()
    toast('已切换模型：' + cfg.model, 'ok', 1800)
  })
  if (selThink) selThink.addEventListener('change', () => {
    cfg.thinkLevel = selThink.value
    saveStore()
    try { api.mainChanged({ thinkLevel: cfg.thinkLevel }) } catch { /* noop */ }
    const label = { default: '默认', low: '浅', medium: '中', high: '深' }[cfg.thinkLevel] || '默认'
    toast('思考程度：' + label + '（提供商不支持时自动回退默认）', 'info', 2200)
  })

  // ============ Toast 通知 ============
  const Toast = window.ToastPanel.createToast({
  })
  function toast(msg, kind, dur) { return Toast.toast(msg, kind, dur) }

  // R76：忙碌灵动岛（生成中顶部胶囊；独立 DOM——不进 .toast-wrap、不用 .toast 类，
  // 完全避开 e2e 的 toast 选择器与 aria 通告区，纯视觉元素）
  function showBusyIsland() {
    const el = document.createElement('div')
    el.className = 'island-busy'
    el.id = 'island-busy'
    el.setAttribute('aria-hidden', 'true')
    const dot = document.createElement('span')
    dot.className = 'island-dot'
    const m = document.createElement('span')
    m.className = 'island-txt'
    m.textContent = '世界正在书写这一幕…'
    el.appendChild(dot); el.appendChild(m)
    document.body.appendChild(el)
    let closed = false
    return {
      close() {
        if (closed) return
        closed = true
        el.classList.add('leaving')
        setTimeout(() => el.remove(), 320)
      }
    }
  }

  // ============ 确认对话框 ============
  function confirmDialog(opts) {
    opts = opts || {}
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm' + (opts.danger ? ' danger' : '')
      const head = document.createElement('div')
      head.className = 'confirm-head'
      const title = document.createElement('div')
      title.className = 'confirm-title'
      title.textContent = opts.title || '确认'
      head.appendChild(title)
      const body = document.createElement('div')
      body.className = 'confirm-body'
      body.textContent = opts.body || ''
      const foot = document.createElement('div')
      foot.className = 'confirm-foot'
      const cancel = document.createElement('button')
      cancel.className = 'cancel'
      cancel.textContent = opts.cancelText || '取消'
      const ok = document.createElement('button')
      ok.className = opts.danger ? 'danger' : 'primary'
      ok.textContent = opts.okText || '确定'
      foot.appendChild(cancel); foot.appendChild(ok)
      // Esc ↵ 键位提示行（原型 H）
      const hint = document.createElement('div')
      hint.className = 'confirm-kbd-hint'
      hint.innerHTML = '<kbd>Esc</kbd> 取消 · <kbd>↵</kbd> 确认'
      box.appendChild(head); box.appendChild(body); box.appendChild(foot); box.appendChild(hint)
      mask.appendChild(box)
      document.body.appendChild(mask)
      function close(val) {
        if (mask.dataset.leaving === '1') return // 已在离场
        mask.dataset.leaving = '1'
        box.classList.add('closing'); mask.classList.add('closing')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          mask.remove()
          resolve(val)
        }
        box.addEventListener('animationend', (ev) => { if (ev.target === box) finish() })
        setTimeout(finish, 260)
      }
      cancel.addEventListener('click', () => close(false))
      ok.addEventListener('click', () => close(true))
      mask.addEventListener('click', (e) => { if (e.target === mask) close(false) })
      const onKey = (e) => {
        if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey) }
        else if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', onKey) }
      }
      document.addEventListener('keydown', onKey)
      setTimeout(() => ok.focus(), 50)
    })
  }

  // 输入对话框（Electron 不支持 window.prompt，自定义实现）
  function promptDialog(opts) {
    opts = opts || {}
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm'
      const head = document.createElement('div')
      head.className = 'confirm-head'
      const title = document.createElement('div')
      title.className = 'confirm-title'
      title.textContent = opts.title || '输入'
      head.appendChild(title)
      const body = document.createElement('div')
      body.className = 'confirm-body'
      body.textContent = opts.body || ''
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'confirm-input'
      input.value = opts.value || ''
      input.maxLength = opts.maxLength || 40
      input.placeholder = opts.placeholder || ''
      const foot = document.createElement('div')
      foot.className = 'confirm-foot'
      const cancel = document.createElement('button')
      cancel.className = 'cancel'
      cancel.textContent = opts.cancelText || '取消'
      const ok = document.createElement('button')
      ok.className = 'primary'
      ok.textContent = opts.okText || '确定'
      foot.appendChild(cancel); foot.appendChild(ok)
      // Esc ↵ 键位提示行（原型 H）
      const hint = document.createElement('div')
      hint.className = 'confirm-kbd-hint'
      hint.innerHTML = '<kbd>Esc</kbd> 取消 · <kbd>↵</kbd> 确认'
      box.appendChild(head); box.appendChild(body); box.appendChild(input); box.appendChild(foot); box.appendChild(hint)
      mask.appendChild(box)
      document.body.appendChild(mask)
      function close(val) {
        if (mask.dataset.leaving === '1') return
        mask.dataset.leaving = '1'
        box.classList.add('closing'); mask.classList.add('closing')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          mask.remove()
          resolve(val)
        }
        box.addEventListener('animationend', (ev) => { if (ev.target === box) finish() })
        setTimeout(finish, 260)
      }
      cancel.addEventListener('click', () => close(null))
      ok.addEventListener('click', () => close(input.value.trim()))
      mask.addEventListener('click', (e) => { if (e.target === mask) close(null) })
      const onKey = (e) => {
        if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', onKey) }
        else if (e.key === 'Enter') { close(input.value.trim()); document.removeEventListener('keydown', onKey) }
      }
      document.addEventListener('keydown', onKey)
      setTimeout(() => { input.focus(); input.select() }, 50)
    })
  }

  // ============ 设置（独立系统窗口，由主进程创建） ============
  function openSettings() {
    api.openSettings()
  }

  // 设置窗口的广播：保存（persisted）/ 实时预览（preview）/ 撤销预览（revert）/ 清空世界线（clearSessions）
  let previewBackup = null // 预览前的本地值，用于取消/关窗时回滚
  api.onCfgUpdated(async (data) => {
    data = data || {}
    if (data.clearSessions) {
      sessions = []
      newSession()
      saveSessions()
      renderSessionList()
      renderMessages()
      updateTitle()
      return
    }
    // 进度包导入完成（设置窗口触发，主进程已合并落库）：重载内存态并校正当前选中世界线
    if (data.progressImported) {
      loadWorkspaces() // 导入的工作区（若有）先就位，孤儿会话自愈才能正确归属
      await loadSessions()
      const wsS = wsSessions()
      if (!wsS.length) newSession()
      else if (!wsS.some((s) => s.id === currentId)) currentId = wsS[0].id
      saveStore()
      renderWsBtn()
      renderSessionList()
      renderMessages()
      updateTitle()
      return
    }
    // 外观相关键：保存/预览/回滚统一处理（多预设调色板 / 字体 / 圆角 / 密度 / 布局 / 侧栏方向 / 字号 / 栏宽 / 置顶）
    const APP_KEYS = ['theme', 'palette', 'fontUI', 'radius', 'density', 'layout', 'sbSide', 'fontSize', 'readWidth', 'pin']
    function applyAllAppearance() {
      applyTheme(cfg.theme)
      applyAppearance()
      applyReading()
      setPin(cfg.pin)
    }
    if (data.persisted) {
      // 保存/重置/导入：从 localStorage 重新加载配置并全面应用
      previewBackup = null
      const keepCur = currentId
      cfg = Object.assign({}, DEFAULT_CFG, loadStore())
      await hydrateSecrets()
      if (cfg.palette === 'codex') cfg.palette = 'classic' // 设置窗口保存/重置/导入后的重载同样归一化
      if (sessions.some((s) => s.id === keepCur)) { currentId = keepCur; cfg.currentSessionId = keepCur }
      applyAllAppearance()
      refreshModelSelect()
      if (selThink) selThink.value = cfg.thinkLevel || 'default'
      await loadKernel()
      updateTitle()
      renderMessages()
      toast('设置已保存', 'ok')
      return
    }
    if (data.preview) {
      // 实时预览：只改运行态，不落盘；记录备份以便撤销
      if (!previewBackup) {
        const bk = {}
        for (const k of APP_KEYS) bk[k] = cfg[k]
        previewBackup = bk
      }
      const p = data.preview
      let needTheme = false, needAppear = false, needRead = false
      for (const k of APP_KEYS) {
        if (p[k] === undefined) continue
        cfg[k] = p[k]
        if (k === 'theme') needTheme = true
        else if (k === 'fontSize' || k === 'readWidth') needRead = true
        else needAppear = true
      }
      if (needTheme) applyTheme(cfg.theme)
      if (needAppear) applyAppearance()
      if (needRead) applyReading()
      if (p.pin !== undefined) setPin(!!p.pin)
      return;
    }
    if (data.revert) {
      // 取消/关闭设置窗口：回滚未保存的预览
      if (previewBackup) {
        for (const k of APP_KEYS) cfg[k] = previewBackup[k]
        previewBackup = null
      }
      applyAllAppearance()
    }
  })

  // ============ 画廊 ============
  // ============ 内核库（设计区）：列表 / 新建 / 编辑 / 导入 / 绑定 / 删除 ============
  // 内核 = 一个世界的规则书（Markdown）。引擎与内核解耦：换内核即换世界，玩法能力不变。
  let kernelHubEditingId = null // 只有 user:* 可原位保存；内置内核修改后另存副本
  let kernelHubSourceId = ''
  let kernelHubWorkspaceId = null // 设计画布当前载入的工作区；切换工作区后避免复用旧草稿
  let kernelEditorDirty = false
  let kernelAiBusy = false
  let kernelAutoSaveTimer = 0
  let kernelAiReqId = null
  let kernelRenderSeq = 0
  let kernelSearchTimer = null
  let kernelCheckpointAccepted = false
  let kernelValidation = { source: '', result: null }
  let kernelLayerReturnFocus = null
  let kernelSourceView = 'editor'
  let kernelStage = 'welcome'
  const KERNEL_WELCOME_SEEN_KEY = 'sixworlds.kernel.design.welcome.v1'
  const commandMask = $('command-mask')
  const commandInput = $('command-input')
  let commandReturnFocus = null
  let commandActiveIndex = 0
const KData = window.KernelData.createKernelData({
    $, api,
    sourceId: () => kernelHubSourceId,
    currentKernelRef, resolveKernelRef,
  })
  const parseKernelMeta = (text) => KData.parseKernelMeta(text)
  const KERNEL_TEMPLATE = KData.KERNEL_TEMPLATE
  const KERNEL_DESIGN_SYSTEM = KData.KERNEL_DESIGN_SYSTEM
  const KERNEL_DRAFT_KEY = '__draft__'
  const kernelReleases = KData.releases
  const kernelDesignChats = KData.designChats
  const saveKernelReleases = () => KData.saveKernelReleases()
  const kernelReleaseFor = (k, meta) => KData.kernelReleaseFor(k, meta)
  const saveKernelDesignChats = () => KData.saveKernelDesignChats()
  const kernelChatKey = () => KData.kernelChatKey()
  const kernelChatMessages = () => KData.kernelChatMessages()
  const setKernelChatMessages = (list) => KData.setKernelChatMessages(list)
  async function loadKernel() {
    const r = await KData.loadKernel()
    kernel = r
    return !!r
  }

  function kernelWelcomeSeen() {
    try { return localStorage.getItem(KERNEL_WELCOME_SEEN_KEY) === '1' } catch { return false }
  }

  function markKernelWelcomeSeen() {
    try { localStorage.setItem(KERNEL_WELCOME_SEEN_KEY, '1') } catch {}
  }

  function setKernelStage(stage) {
    const valid = ['welcome', 'intent', 'shape', 'rules', 'test', 'release']
    kernelStage = valid.includes(stage) ? stage : 'intent'
    const hub = $('kernel-hub')
    if (hub) hub.dataset.kernelStage = kernelStage
    const welcome = $('kernel-welcome-page')
    const editor = $('kernel-editor-stage')
    const pages = {
      shape: $('kernel-stage-shape'),
      rules: $('kernel-stage-rules'),
      test: $('kernel-stage-test'),
      release: $('kernel-stage-release')
    }
    if (welcome) welcome.classList.toggle('active', kernelStage === 'welcome')
    if (editor) editor.classList.toggle('active', kernelStage === 'intent')
    Object.entries(pages).forEach(([key, page]) => {
      if (page) page.classList.toggle('active', kernelStage === key)
    })
    document.querySelectorAll('.kernel-rail-step').forEach((step) => {
      step.classList.toggle('active', step.dataset.kernelStage === kernelStage)
    })
    const meta = parseKernelMeta($('kernel-edit-text') ? $('kernel-edit-text').value : '')
    const displayName = (meta && meta.title) || ($('kernel-edit-name') && $('kernel-edit-name').value.trim()) || '当前内核'
    const releaseName = $('kernel-stage-release-name')
    if (releaseName) releaseName.textContent = displayName
    if (kernelStage !== 'welcome') markKernelWelcomeSeen()
    if (kernelStage === 'intent') {
      renderKernelAiMessages()
      renderKernelDesignSurface()
      window.setTimeout(() => $('kernel-ai-input') && $('kernel-ai-input').focus(), 40)
    }
  }

  function setKernelDirty(dirty, label) {
    kernelEditorDirty = !!dirty
    const state = $('kernel-save-state')
    state.classList.toggle('dirty', kernelEditorDirty)
    if (label) state.textContent = label
    else if (!$('kernel-edit-text').value.trim()) state.textContent = '未选择内核'
    else state.textContent = kernelEditorDirty ? '有未保存修改' : '已保存'
  }

  // 内核设计区的检查只读取当前 Markdown 草稿，不改写引擎数据，也不伪造远端验证结果。
  function inspectKernelDraft(text) {
    const source = String(text || '')
    const meta = parseKernelMeta(source)
    const hasHeading = (patterns) => patterns.some((p) => new RegExp(p, 'i').test(source))
    const checks = [
      {
        id: 'meta', title: '内核元数据', present: !!meta,
        detail: meta ? '已识别 KERNEL_META，可用于通用内核标题与开局配置。' : '缺少有效的 KERNEL_META JSON，保存前请补全标题与运行元数据。'
      },
      {
        id: 'experience', title: '体验意图与玩家身份', present: hasHeading(['玩家身份', '玩家主权', 'player[_ -]?authority', '体验目标', '核心体验']),
        detail: hasHeading(['玩家身份', '玩家主权', 'player[_ -]?authority', '体验目标', '核心体验']) ? '草稿声明了玩家在世界中的身份或决策边界。' : '尚未识别玩家身份或决策边界，设计助手无法稳定判断玩家主权。'
      },
      {
        id: 'rules', title: '运行规则与世界推进', present: hasHeading(['运行规则', '世界推进', 'world[_ -]?tick', '规则骨架', '输出格式']),
        detail: hasHeading(['运行规则', '世界推进', 'world[_ -]?tick', '规则骨架', '输出格式']) ? '已识别至少一组运行规则或世界推进约束。' : '尚未识别运行规则，建议明确每回合如何推进与输出。'
      },
      {
        id: 'causality', title: '因果、失败与代价', present: hasHeading(['因果', '失败', '代价', '后果', 'causality']),
        detail: hasHeading(['因果', '失败', '代价', '后果', 'causality']) ? '草稿包含失败后果或持续因果的描述。' : '尚未识别失败与代价，长期世界可能出现无成本回退。'
      },
      {
        id: 'output', title: '输出契约', present: hasHeading(['输出', '选项', '格式', 'output[_ -]?format', '每幕']),
        detail: hasHeading(['输出', '选项', '格式', 'output[_ -]?format', '每幕']) ? '已识别模型输出格式或每幕结构。' : '尚未识别输出格式，建议约束叙事、选项与状态记录的边界。'
      }
    ]
    const blocking = checks.filter((c) => !c.present && (c.id === 'meta' || c.id === 'rules')).length
    const attention = checks.filter((c) => !c.present && c.id !== 'meta' && c.id !== 'rules').length
    return { checks, blocking, attention, total: checks.length }
  }

  function renderKernelAudit(result) {
    const title = $('kernel-audit-title')
    const count = $('kernel-audit-count')
    const note = $('kernel-audit-note')
    const list = $('kernel-audit-list')
    if (!title || !count || !list) return
    list.innerHTML = ''
    if (!result) {
      title.textContent = '等待检查'
      count.textContent = '未运行'
      count.className = 'kernel-audit-count'
      const tabCount = $('kernel-source-audit-count')
      if (tabCount) tabCount.textContent = ''
      if (note) note.textContent = '验证只检查当前草稿中可识别的通用规则段落，不会修改内容。'
      return
    }
    const checked = kernelValidation.source === $('kernel-edit-text').value
    const stateClass = result.blocking ? 'error' : result.attention ? 'warning' : 'valid'
    title.textContent = result.blocking ? '需要补全' : result.attention ? '有待决定项' : '结构完整'
    count.textContent = checked ? (result.blocking ? result.blocking + ' 项阻止发布' : result.attention ? result.attention + ' 项待决定' : '可继续发布') : '未运行'
    count.className = 'kernel-audit-count ' + (checked ? stateClass : '')
    const tabCount = $('kernel-source-audit-count')
    if (tabCount) {
      const issues = result.checks.filter((item) => !item.present).length
      tabCount.textContent = issues ? String(issues) : '✓'
    }
    if (note) note.textContent = checked ? '检查基于当前草稿文本；修改后需要重新运行。' : '以下是可检查的规则契约，点击“验证”生成当前草稿的检查结果。'
    result.checks.forEach((check) => {
      const item = document.createElement('div')
      const status = check.present ? 'ok' : (check.id === 'meta' || check.id === 'rules' ? 'error' : 'warning')
      item.className = 'kernel-audit-item ' + status
      const head = document.createElement('div')
      head.className = 'kernel-audit-item-head'
      const dot = document.createElement('span'); dot.className = 'kernel-audit-dot'; dot.setAttribute('aria-hidden', 'true')
      const strong = document.createElement('strong'); strong.textContent = check.present ? check.title + ' · 已识别' : check.title + ' · 待补全'
      head.append(dot, strong)
      const p = document.createElement('p'); p.textContent = check.detail
      item.append(head, p); list.appendChild(item)
    })
  }

  function renderKernelCheckpoint() {
    const checkpoint = $('kernel-checkpoint')
    const text = $('kernel-edit-text') ? $('kernel-edit-text').value : ''
    const meta = parseKernelMeta(text)
    const hasDraft = !!String(text || '').trim()
    const title = $('kernel-design-title')
    const sub = $('kernel-design-sub')
    const stage = $('kernel-design-stage-label')
    if (title) title.textContent = (meta && meta.title) || ($('kernel-edit-name') && $('kernel-edit-name').value.trim()) || (hasDraft ? '未命名内核' : '选择或新建一个内核')
    if (sub) sub.textContent = (meta && meta.tagline) || (hasDraft ? '把体验意图交给设计助手，再逐条确认可运行的规则契约。' : '先描述你想让世界带给玩家的体验，设计助手会把它整理成可运行规则。')
    if (stage) stage.textContent = hasDraft ? '通用内核 · 规则协作' : '通用内核 · AI 协作画布'
    const sourceTitle = $('kernel-source-title')
    if (sourceTitle) sourceTitle.textContent = ((meta && meta.title) || ($('kernel-edit-name') && $('kernel-edit-name').value.trim()) || '未命名内核') + ' / source.md'
    if (!checkpoint) return
    checkpoint.hidden = !hasDraft
    if (!hasDraft) {
      renderKernelAudit(null)
      return
    }
    const result = inspectKernelDraft(text)
    const checked = kernelValidation.source === text && !!kernelValidation.result
    const state = $('kernel-checkpoint-state')
    if (state) {
      state.className = 'validation-state ' + (checked ? (result.blocking ? 'error' : result.attention ? 'warning' : 'valid') : '')
      state.textContent = checked ? (kernelCheckpointAccepted ? (result.attention ? '已接受 · 有待决定' : '已接受') : (result.blocking ? '需要补全' : result.attention ? '有待决定' : '结构完整')) : '尚未检查'
    }
    const list = $('kernel-contract-list')
    if (list) {
      list.innerHTML = ''
      result.checks.slice(0, 4).forEach((check, index) => {
        const row = document.createElement('article')
        row.className = 'contract-row' + (check.present ? '' : ' attention')
        const idx = document.createElement('span'); idx.className = 'contract-index'; idx.textContent = String(index + 1).padStart(2, '0')
        const copy = document.createElement('div')
        const h = document.createElement('h3'); h.textContent = check.title
        const p = document.createElement('p'); p.textContent = check.detail
        copy.append(h, p)
        const status = document.createElement('span'); status.className = 'contract-status ' + (check.present ? 'fixed' : (check.id === 'meta' || check.id === 'rules' ? 'missing' : 'pending'))
        status.textContent = check.present ? (checked ? '已识别' : '可检查') : (check.id === 'meta' || check.id === 'rules' ? '需补全' : '待决定')
        row.append(idx, copy, status); list.appendChild(row)
      })
    }
    renderKernelAudit(kernelValidation.result || result)
  }

  function renderKernelProgress() {
    const track = $('kernel-progress-track')
    if (!track) return
    const text = $('kernel-edit-text') ? $('kernel-edit-text').value : ''
    const hasDraft = !!String(text || '').trim()
    const chat = kernelChatMessages()
    const meta = parseKernelMeta(text)
    const result = kernelValidation.source === text ? kernelValidation.result : null
    const complete = {
      intent: chat.length > 0,
      rules: hasDraft && !!meta,
      check: !!result && result.blocking === 0,
      release: !!result && result.blocking === 0 && !kernelEditorDirty && !!kernelHubEditingId
    }
    const steps = ['intent', 'rules', 'check', 'release']
    let activeFound = false
    steps.forEach((step) => {
      const item = track.querySelector('[data-step="' + step + '"]')
      if (!item) return
      item.classList.toggle('complete', complete[step])
      item.classList.remove('active')
      if (!complete[step] && !activeFound) { item.classList.add('active'); activeFound = true }
      const small = item.querySelector('small')
      if (small) {
        const labels = { intent: complete.intent ? '已记录' : '描述目标', rules: complete.rules ? '已成形' : '形成契约', check: complete.check ? '已检查' : '发现缺口', release: complete.release ? '已保存' : '保存并应用' }
        small.textContent = labels[step]
      }
    })
    const release = $('kernel-release-state')
    if (release) {
      release.className = 'kernel-release-state'
      if (complete.release) { release.classList.add('ready'); release.textContent = '可发布' }
      else if (kernelEditorDirty) { release.classList.add('attention'); release.textContent = '草稿有改动' }
      else release.textContent = hasDraft ? '草稿' : '未选择'
    }
  }

  function renderKernelDesignSurface() {
    renderKernelCheckpoint()
    renderKernelProgress()
  }

  async function runKernelValidation(showFeedback = true) {
    const source = $('kernel-edit-text') ? $('kernel-edit-text').value : ''
    if (!source.trim()) { toast('请先新建或选择一个内核', 'info'); return null }
    const result = inspectKernelDraft(source)
    kernelValidation = { source, result }
    renderKernelDesignSurface()
    if (showFeedback) {
      if (result.blocking) toast('结构检查完成：' + result.blocking + ' 项必须补全', 'err', 5000)
      else if (result.attention) toast('结构检查完成：' + result.attention + ' 项待决定', 'info', 5000)
      else toast('结构检查完成：当前草稿可继续发布', 'ok')
    }
    return result
  }

  function openKernelLayer(kind) {
    const hub = $('kernel-hub')
    const scrim = $('kernel-layer-scrim')
    if (!hub || !scrim) return
    kernelLayerReturnFocus = document.activeElement
    hub.classList.toggle('library-open', kind === 'library')
    hub.classList.toggle('source-open', kind === 'source')
    const library = $('kernel-library-drawer')
    const source = $('kernel-editor-pane')
    const canvas = document.querySelector('.kernel-design-canvas')
    const head = document.querySelector('.kernel-workbench-head')
    if (library) { library.setAttribute('aria-hidden', String(kind !== 'library')); library.inert = kind !== 'library' }
    if (source) { source.setAttribute('aria-hidden', String(kind !== 'source')); source.inert = kind !== 'source' }
    if (canvas) canvas.inert = true
    if (head) head.inert = true
    scrim.hidden = false
    if (kind === 'library') {
      markKernelWelcomeSeen()
      window.setTimeout(() => $('kernel-search') && $('kernel-search').focus(), 30)
    } else {
      setKernelSourceView('editor')
      renderKernelAudit(kernelValidation.result)
      window.setTimeout(() => $('kernel-edit-text') && $('kernel-edit-text').focus(), 30)
    }
  }

  function setKernelSourceView(view) {
    kernelSourceView = view === 'audit' ? 'audit' : 'editor'
    const workspace = document.querySelector('.kernel-source-workspace')
    if (workspace) workspace.classList.toggle('audit-active', kernelSourceView === 'audit')
    document.querySelectorAll('.kernel-source-tab').forEach((tab) => {
      const active = tab.dataset.sourceTab === kernelSourceView
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    })
  }

  function closeKernelLayer(restoreFocus = true) {
    const hub = $('kernel-hub')
    const scrim = $('kernel-layer-scrim')
    if (!hub) return
    hub.classList.remove('library-open', 'source-open')
    const library = $('kernel-library-drawer')
    const source = $('kernel-editor-pane')
    const canvas = document.querySelector('.kernel-design-canvas')
    const head = document.querySelector('.kernel-workbench-head')
    if (library) { library.setAttribute('aria-hidden', 'true'); library.inert = true }
    if (source) { source.setAttribute('aria-hidden', 'true'); source.inert = true }
    if (canvas) canvas.inert = false
    if (head) head.inert = false
    if (scrim) scrim.hidden = true
    if (restoreFocus && kernelLayerReturnFocus && typeof kernelLayerReturnFocus.focus === 'function') {
      try { kernelLayerReturnFocus.focus() } catch {}
    }
    kernelLayerReturnFocus = null
  }

  function trapKernelLayerFocus(e) {
    const hub = $('kernel-hub')
    const layer = hub.classList.contains('source-open') ? $('kernel-editor-pane') : $('kernel-library-drawer')
    if (!layer) return
    const focusables = [...layer.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    if (!focusables.length) { e.preventDefault(); return }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  function setKernelAreaTab(active) {
    const isDesign = active === 'design'
    const contentTab = $('btn-content-area')
    const designTab = $('btn-kernel-hub')
    if (contentTab) {
      contentTab.classList.toggle('active', !isDesign)
      contentTab.setAttribute('aria-selected', String(!isDesign))
      contentTab.tabIndex = isDesign ? -1 : 0
    }
    if (designTab) {
      designTab.classList.toggle('active', isDesign)
      designTab.setAttribute('aria-selected', String(isDesign))
      designTab.tabIndex = isDesign ? 0 : -1
    }
  }

  function openKernelHub() {
    $('kernel-hub').hidden = false
    setKernelAreaTab('design')
    closeKernelLayer(false)
    setKernelStage(kernelWelcomeSeen() ? 'intent' : 'welcome')
    renderKernelHub()
    renderKernelAiMessages()
    renderKernelDesignSurface()
    const ref = currentKernelRef()
    // 画布关闭期间可能切换了工作区或绑定内核；无未保存草稿时自动载入新的当前内核。
    if (ref && (!kernelHubSourceId || (!kernelEditorDirty && (kernelHubSourceId !== ref || kernelHubWorkspaceId !== currentWsId)))) {
      editKernel(ref)
    }
  }

  function closeKernelHub() {
    closeKernelLayer(false)
    $('kernel-hub').hidden = true
    setKernelAreaTab('content')
  }

  function commandOptions() {
    return [...document.querySelectorAll('#command-list [data-command]')]
  }

  function filterCommandOptions(query) {
    const q = String(query || '').trim().toLocaleLowerCase()
    const options = commandOptions()
    let visible = 0
    options.forEach((option) => {
      const match = !q || option.textContent.toLocaleLowerCase().includes(q)
      option.hidden = !match
      option.classList.remove('active')
      if (match) visible++
    })
    commandActiveIndex = 0
    const first = options.find((option) => !option.hidden)
    if (first) first.classList.add('active')
    const empty = $('command-empty')
    if (empty) empty.hidden = visible > 0
  }

  function openCommandPanel(prefill = '') {
    if (!commandMask || !commandInput) return
    if (themePopEl && !themePopEl.classList.contains('hidden')) closeThemePop()
    commandReturnFocus = document.activeElement
    commandMask.hidden = false
    commandInput.value = prefill
    const densityLabel = $('command-density-label')
    if (densityLabel) densityLabel.textContent = cfg.density === 'compact' ? '紧凑' : '舒适'
    filterCommandOptions(prefill)
    window.setTimeout(() => { commandInput.focus(); commandInput.select() }, 20)
  }

  function closeCommandPanel(restoreFocus = true) {
    if (!commandMask || commandMask.hidden) return
    commandMask.hidden = true
    if (restoreFocus && commandReturnFocus && typeof commandReturnFocus.focus === 'function') {
      try { commandReturnFocus.focus() } catch {}
    }
    commandReturnFocus = null
  }

  function runCommand(name) {
    closeCommandPanel(false)
    if (name === 'design') openKernelHub()
    else if (name === 'library') {
      if ($('kernel-hub').hidden) openKernelHub()
      openKernelLayer('library')
    } else if (name === 'source') {
      if ($('kernel-hub').hidden) openKernelHub()
      openKernelLayer('source')
    } else if (name === 'gallery') openGallery()
    else if (name === 'settings') openSettings()
    else if (name === 'density') {
      cfg.density = cfg.density === 'compact' ? 'standard' : 'compact'
      applyAppearance(); saveStore()
      toast('信息密度：' + (cfg.density === 'compact' ? '紧凑' : '舒适'), 'info', 1800)
    }
  }

  if (commandMask && commandInput) {
    commandInput.addEventListener('input', () => filterCommandOptions(commandInput.value))
    commandInput.addEventListener('keydown', (e) => {
      const options = commandOptions().filter((option) => !option.hidden)
      if (e.key === 'Escape') { e.preventDefault(); closeCommandPanel(); return }
      if (!options.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        commandActiveIndex = (commandActiveIndex + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        options.forEach((option, index) => option.classList.toggle('active', index === commandActiveIndex))
      } else if (e.key === 'Enter') {
        e.preventDefault(); runCommand(options[commandActiveIndex].dataset.command)
      }
    })
    commandMask.addEventListener('click', (e) => { if (e.target === commandMask) closeCommandPanel() })
    $('btn-command-close').addEventListener('click', () => closeCommandPanel())
    $('btn-command').addEventListener('click', () => openCommandPanel())
    commandOptions().forEach((option) => option.addEventListener('click', () => runCommand(option.dataset.command)))
  }

  async function renderKernelHub() {
    const renderSeq = ++kernelRenderSeq
    const cards = $('kernel-cards')
    cards.innerHTML = ''
    const bound = currentKernelRef()
    const query = String($('kernel-search') && $('kernel-search').value || '').trim().toLocaleLowerCase()
    try {
      const lr = await api.kernelLibList()
      const list = (lr && lr.ok && lr.kernels) ? lr.kernels : []
      if ($('kernel-library-count')) $('kernel-library-count').textContent = list.length + ' 个内核'
      const metas = await Promise.all(list.map(async (k) => {
        const r = await api.kernelLibRead(k.id)
        return (r && r.ok) ? { k, text: r.text } : { k, text: '' }
      }))
      if (renderSeq !== kernelRenderSeq) return
      let visible = 0
      for (const { k, text } of metas) {
        const meta = parseKernelMeta(text)
        const searchText = [k.name, meta && meta.title, meta && meta.tagline].filter(Boolean).join(' ').toLocaleLowerCase()
        if (query && !searchText.includes(query)) continue
        visible++
        const card = document.createElement('div')
        card.className = 'kernel-card' + (k.id === bound ? ' current' : '') + (k.id === kernelHubSourceId ? ' selected' : '')
        card.tabIndex = 0
        card.setAttribute('role', 'button')
        card.setAttribute('aria-label', '编辑内核：' + ((meta && meta.title) || k.name))
        card.addEventListener('click', (e) => { if (!e.target.closest('button')) editKernel(k.id) })
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editKernel(k.id) }
        })
        const head = document.createElement('div')
        head.className = 'kernel-card-head'
        const title = document.createElement('span')
        title.className = 'kernel-card-title'
        title.textContent = (meta && meta.title) || k.name
        const badge = document.createElement('span')
        badge.className = 'kernel-badge' + (k.source === 'user' ? ' user' : '')
        badge.textContent = k.source === 'user' ? '自定义' : '内置'
        head.appendChild(title)
        card.appendChild(head)
        const tags = document.createElement('div')
        tags.className = 'kernel-card-tags'
        tags.appendChild(badge)
        if (k.id === bound) {
          const cur = document.createElement('span')
          cur.className = 'kernel-badge current-badge'
          cur.textContent = '当前世界线'
          tags.appendChild(cur)
        }
        card.appendChild(tags)
        const sub = document.createElement('div')
        sub.className = 'kernel-card-sub'
        sub.textContent = k.name + ' · ' + ((meta && meta.tagline) ? meta.tagline : '未声明简介') + ' · ' + (k.size / 1024).toFixed(1) + ' KB'
        card.appendChild(sub)
        const ops = document.createElement('div')
        ops.className = 'kernel-card-ops'
        const mkBtn = (label, title, fn, cls) => {
          const b = document.createElement('button')
          b.className = 'tool-btn' + (cls ? ' ' + cls : '')
          b.textContent = label; b.title = title
          b.addEventListener('click', (e) => { e.stopPropagation(); fn() })
          return b
        }
        if (k.id !== bound) ops.appendChild(mkBtn('应用到当前内容', '把该内核设为当前内容工作区的世界规则', () => bindKernel(k.id), 'kernel-bind'))
        ops.appendChild(mkBtn('编辑', k.source === 'user' ? '编辑该内核' : '查看内置内核（保存将创建副本）', () => editKernel(k.id)))
        if (k.source === 'user') ops.appendChild(mkBtn('删除', '从内核库删除（不可恢复）', () => deleteKernel(k.id)))
        card.appendChild(ops)
        cards.appendChild(card)
      }
      if (!metas.length) cards.textContent = '内核库为空'
      else if (!visible) cards.textContent = '没有匹配的内核'
      const boundItem = metas.find((x) => x.k.id === bound)
      const boundMeta = boundItem ? parseKernelMeta(boundItem.text) : null
      $('kernel-hub-sub').textContent = list.length + ' 个内核 · 当前内容：' + ((boundMeta && boundMeta.title) || (boundItem && boundItem.k.name) || '默认内核')
    } catch (e) {
      cards.textContent = '内核库读取失败：' + String((e && e.message) || e)
    }
  }

  async function bindKernel(id) {
    const ws = curWs()
    if (!ws) { toast('请先创建一条世界线', 'info'); return }
    ws.kernelId = id
    ws.kernelPath = ''
    saveWorkspaces()
    const ok = await loadKernel()
    toast(ok ? '已绑定内核并重新加载' : '内核加载失败', ok ? 'ok' : 'err')
    renderKernelHub()
    // 绑定后仍停留在设计工作台时，同步画布草稿；未保存草稿由用户明确决定后再覆盖。
    if (ok && !kernelEditorDirty) await editKernel(id, { keepLayer: true })
  }

  async function editKernel(id, options) {
    const openedFromLibrary = $('kernel-hub').classList.contains('library-open') && !(options && options.keepLayer)
    if (kernelEditorDirty && id !== kernelHubSourceId) {
      const discard = await confirmDialog({ title: '放弃未保存修改', body: '切换内核会丢弃当前草稿中尚未保存的修改。', danger: true, okText: '放弃并切换' })
      if (!discard) return
    }
    const r = await api.kernelLibRead(id)
    if (!r || !r.ok) { toast('内核读取失败：' + ((r && r.error) || ''), 'err'); return }
    kernelHubEditingId = (r.id && r.id.startsWith('user:')) ? r.id : null // 内置只读，保存时另存副本
    kernelHubSourceId = r.id || id
    kernelHubWorkspaceId = currentWsId
    const meta = parseKernelMeta(r.text)
    $('kernel-edit-name').value = (meta && meta.title) || r.name
    $('kernel-edit-text').value = r.text || ''
    kernelCheckpointAccepted = false
    kernelValidation = { source: '', result: null }
    updateKernelEditMeta()
    setKernelDirty(false)
    renderKernelAiMessages()
    renderKernelHub()
    renderKernelDesignSurface()
    if (openedFromLibrary) {
      openKernelLayer('source')
      $('kernel-edit-text').focus()
    } else if (!$('kernel-hub').classList.contains('source-open') && !$('kernel-hub').classList.contains('library-open')) {
      $('kernel-ai-input').focus()
    }
  }

  async function newKernel() {
    const openedFromLibrary = $('kernel-hub').classList.contains('library-open')
    if (kernelEditorDirty) {
      const discard = await confirmDialog({ title: '放弃未保存修改', body: '新建内核会替换当前尚未保存的草稿。', danger: true, okText: '放弃并新建' })
      if (!discard) return
    }
    kernelHubEditingId = null
    kernelHubSourceId = KERNEL_DRAFT_KEY
    kernelHubWorkspaceId = currentWsId
    kernelDesignChats[KERNEL_DRAFT_KEY] = []
    saveKernelDesignChats()
    kernelCheckpointAccepted = false
    kernelValidation = { source: '', result: null }
    $('kernel-edit-name').value = ''
    $('kernel-edit-text').value = KERNEL_TEMPLATE
    updateKernelEditMeta()
    setKernelDirty(true)
    renderKernelAiMessages()
    renderKernelHub()
    renderKernelDesignSurface()
    setKernelStage('intent')
    if (openedFromLibrary) {
      openKernelLayer('source')
      $('kernel-edit-name').focus()
    } else if ($('kernel-hub').classList.contains('source-open')) {
      $('kernel-edit-name').focus()
    } else {
      $('kernel-ai-input').focus()
    }
  }

  function updateKernelEditMeta() {
    const meta = parseKernelMeta($('kernel-edit-text').value)
    const n = $('kernel-edit-text').value.length
    $('kernel-edit-meta').textContent = (meta && meta.title ? '标题：' + meta.title + ' · ' : '') + (meta && meta.version ? 'v' + meta.version + ' · ' : '') + (meta && meta.origins ? '出身 ' + meta.origins.length + ' 条 · ' : '') + (n / 1024).toFixed(1) + ' KB'
    $('kernel-ai-context').textContent = (meta && meta.title) || $('kernel-edit-name').value.trim() || '未命名内核'
  }

  // 内核草稿防抖自动保存（1100ms）：与原型工作台方案对齐——草稿不再有关机/误关丢失风险
  function scheduleKernelAutoSave() {
    if (kernelAutoSaveTimer) clearTimeout(kernelAutoSaveTimer)
    if (!kernelEditorDirty || !kernelHubEditingId || !$('kernel-edit-name').value.trim() || !$('kernel-edit-text').value.trim()) return
    kernelAutoSaveTimer = setTimeout(() => {
      kernelAutoSaveTimer = 0
      if (kernelEditorDirty && !kernelAiBusy) saveKernelEdit()
    }, 1100)
  }

  async function saveKernelEdit() {
    const name = $('kernel-edit-name').value.trim()
    const text = $('kernel-edit-text').value
    if (!name.trim()) { toast('请先填写内核名称', 'info'); return }
    if (!text.trim()) { toast('内核内容不能为空', 'info'); return }
    const oldChatKey = kernelChatKey()
    const r = await api.kernelLibSave({ id: kernelHubEditingId, name, text })
    if (!r || !r.ok) { toast('保存失败：' + ((r && r.error) || ''), 'err'); return }
    toast('已保存到内核库：' + name, 'ok')
    kernelHubEditingId = r.id
    kernelHubSourceId = r.id
    if (oldChatKey !== r.id && kernelDesignChats[oldChatKey]) {
      kernelDesignChats[r.id] = kernelDesignChats[oldChatKey]
      delete kernelDesignChats[oldChatKey]
      saveKernelDesignChats()
    }
    $('kernel-edit-name').value = name
    setKernelDirty(false)
    // 保存 = 草稿状态登记进发布元数据（已发布的内核不因保存而降级）
    if (!kernelReleases[r.id]) kernelReleases[r.id] = { status: 'draft', version: '0.1' }
    else if (kernelReleases[r.id].status !== 'published') kernelReleases[r.id].status = 'draft'
    saveKernelReleases()
    // 若当前世界线正绑定该内核，热重载
    if (currentKernelRef() === r.id) await loadKernel()
    renderKernelAiMessages()
    renderKernelHub()
    renderKernelDesignSurface()
    if (kernelStage === 'welcome') setKernelStage('intent')
  }

  async function publishKernel() {
    const result = await runKernelValidation(false)
    if (!result) return
    if (result.blocking) {
      toast('暂不能发布：请先补全 ' + result.blocking + ' 项必需结构', 'err', 5000)
      openKernelLayer('source')
      return
    }
    if (kernelEditorDirty || !kernelHubEditingId) await saveKernelEdit()
    if (kernelEditorDirty) return
    // 发布登记：版本号自动 +0.1（首次 0.1 → 0.2），与原型工作台方案共用发布元数据
    const release = kernelReleaseFor({ id: kernelHubEditingId, source: 'user' }, parseKernelMeta($('kernel-edit-text').value))
    const parts = String(release.version || '0.1').split('.').map((v) => Number(v) || 0)
    const nextVersion = (parts[0] || 0) + '.' + ((parts[1] || 0) + 1)
    kernelReleases[kernelHubEditingId] = { status: 'published', version: nextVersion, publishedAt: Date.now() }
    saveKernelReleases()
    kernelCheckpointAccepted = true
    renderKernelDesignSurface()
    toast('内核 v' + nextVersion + ' 已发布，可应用到任意世界线', 'ok', 5000)
    // 发布成功 → 弹窗确认是否立即应用并游玩（绑定当前工作区 + 回内容区聚焦输入）
    const meta = parseKernelMeta($('kernel-edit-text').value)
    const name = (meta && meta.title) || $('kernel-edit-name').value.trim() || '新内核'
    const playNow = await confirmDialog({
      title: '内核已就绪',
      body: '「' + name + '」已保存到内核库。要立即应用到当前工作区并开始游玩吗？',
      okText: '立即应用并游玩',
      cancelText: '稍后'
    })
    if (playNow && kernelHubEditingId) {
      await bindKernel(kernelHubEditingId)
      closeKernelHub()
      if (!curSession()) newSession()   // 空工作区给一条新世界线
      $('input').focus()
      toast('已应用「' + name + '」——开始你的新世界吧', 'ok', 4000)
    }
  }

  async function acceptKernelCheckpoint() {
    const result = await runKernelValidation(false)
    if (!result) return
    if (result.blocking) {
      toast('检查点仍有 ' + result.blocking + ' 项必需结构未补全', 'err', 5000)
      return
    }
    kernelCheckpointAccepted = true
    renderKernelDesignSurface()
    toast(result.attention ? '检查点已接受，仍有 ' + result.attention + ' 项待决定' : '检查点已接受，规则骨架已确认', result.attention ? 'info' : 'ok', 5000)
  }

  async function deleteKernel(id) {
    const ok = await confirmDialog({ title: '删除内核', body: '该自定义内核将从内核库删除（世界线数据不受影响）。确定删除？', danger: true, okText: '删除' })
    if (!ok) return
    const r = await api.kernelLibDelete(id)
    if (!r || !r.ok) { toast('删除失败：' + ((r && r.error) || ''), 'err'); return }
    const currentWasBound = currentKernelRef() === id
    let changedWorkspace = false
    for (const ws of workspaces) {
      if (ws.kernelId === id) { ws.kernelId = ''; changedWorkspace = true }
    }
    if (changedWorkspace) saveWorkspaces()
    if (currentWasBound) await loadKernel()
    delete kernelDesignChats[id]
    saveKernelDesignChats()
    if (kernelHubSourceId === id) {
      kernelHubEditingId = null
      kernelHubSourceId = ''
      kernelHubWorkspaceId = null
      $('kernel-edit-name').value = ''
      $('kernel-edit-text').value = ''
      updateKernelEditMeta()
      setKernelDirty(false)
      kernelCheckpointAccepted = false
      kernelValidation = { source: '', result: null }
      renderKernelAiMessages()
      renderKernelDesignSurface()
    }
    toast('已删除', 'ok')
    renderKernelHub()
  }

  async function importKernelFile() {
    const r = await api.pickKernel()
    if (!r || !r.ok || !r.text) return
    const suggested = (r.path || '').split(/[\\//]/).pop().replace(/\.(md|markdown|txt)$/i, '') || '导入内核'
    const name = suggested
    const rs = await api.kernelLibSave({ name, text: r.text })
    if (!rs || !rs.ok) { toast('导入失败：' + ((rs && rs.error) || ''), 'err'); return }
    toast('已导入内核库：' + name, 'ok')
    renderKernelHub()
  }

  function renderKernelAiMessages() {
    const box = $('kernel-ai-messages')
    box.innerHTML = ''
    const list = kernelChatMessages()
    if (!list.length && !kernelAiBusy) {
      const empty = document.createElement('div')
      empty.className = 'kernel-ai-empty'
      const title = document.createElement('strong')
      title.textContent = '从一个世界念头开始'
      const text = document.createElement('span')
      text.textContent = '描述你想体验的冲突、身份或规则。'
      empty.appendChild(title); empty.appendChild(text); box.appendChild(empty)
    }
    for (const msg of list) {
      const item = document.createElement('div')
      item.className = 'kernel-ai-msg ' + msg.role
      const role = document.createElement('div')
      role.className = 'kernel-ai-role'
      role.textContent = msg.role === 'user' ? '你' : '设计助手'
      const body = document.createElement('div')
      body.className = 'kernel-ai-body'
      body.textContent = msg.content
      item.appendChild(role); item.appendChild(body); box.appendChild(item)
    }
    if (kernelAiBusy) {
      const item = document.createElement('div')
      item.className = 'kernel-ai-msg assistant pending'
      const role = document.createElement('div')
      role.className = 'kernel-ai-role'; role.textContent = '设计助手'
      const body = document.createElement('div')
      body.className = 'kernel-ai-body'; body.textContent = '正在整理规则并更新草稿…'
      item.appendChild(role); item.appendChild(body); box.appendChild(item)
    }
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight })
    renderKernelDesignSurface()
  }

  function setKernelAiBusy(on) {
    kernelAiBusy = !!on
    $('kernel-ai-input').disabled = kernelAiBusy
    $('btn-kernel-ai-reset').disabled = kernelAiBusy
    $('btn-kernel-ai-send').innerHTML = kernelAiBusy
      ? '<svg class="ic ic-sm" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>'
      : '发送 <svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M3.5 8.5 8 13h4.5M12.5 13H8M12.5 13V8.5"/></svg>'
    $('btn-kernel-ai-send').title = kernelAiBusy ? '停止生成' : '发送给设计助手'
    renderKernelAiMessages()
  }

  function stripKernelChangeBlock(content) {
    return String(content || '')
      .replace(/<<<KERNEL_MD>>>[\s\S]*?<<<END_KERNEL_MD>>>/i, '')
      .replace(/<<<KERNEL_PATCH>>>[\s\S]*?<<<END_KERNEL_PATCH>>>/i, '')
      .replace(/<<<NO_KERNEL_CHANGE>>>/gi, '')
      .trim()
  }

  function applyKernelAiChange(content, currentText) {
    const raw = String(content || '')
    const full = raw.match(/<<<KERNEL_MD>>>\s*([\s\S]*?)\s*<<<END_KERNEL_MD>>>/i)
    if (full) {
      const text = full[1].trim()
      if (text.length < 100) return { ok: false, error: '返回的完整内核过短' }
      if (!parseKernelMeta(text)) return { ok: false, error: '返回内容缺少有效的 KERNEL_META JSON' }
      return { ok: true, changed: true, text, mode: 'replace' }
    }
    const patch = raw.match(/<<<KERNEL_PATCH>>>\s*([\s\S]*?)\s*<<<END_KERNEL_PATCH>>>/i)
    if (patch) {
      try {
        const data = JSON.parse(patch[1])
        const ops = data && Array.isArray(data.operations) ? data.operations.slice(0, 24) : []
        if (!ops.length) return { ok: false, error: 'PATCH 中没有可应用的操作' }
        let next = String(currentText || '')
        for (const op of ops) {
          const search = op && typeof op.search === 'string' ? op.search : ''
          const replace = op && typeof op.replace === 'string' ? op.replace : ''
          if (!search) return { ok: false, error: 'PATCH 包含空的 search' }
          const first = next.indexOf(search)
          if (first < 0) return { ok: false, error: 'PATCH 原文未在当前草稿中找到' }
          if (next.indexOf(search, first + search.length) >= 0) return { ok: false, error: 'PATCH 原文在草稿中不唯一' }
          next = next.slice(0, first) + replace + next.slice(first + search.length)
        }
        if (!parseKernelMeta(next)) return { ok: false, error: 'PATCH 会破坏 KERNEL_META，已拒绝应用' }
        return { ok: true, changed: true, text: next, mode: 'patch' }
      } catch (e) {
        return { ok: false, error: 'PATCH JSON 无法解析：' + String((e && e.message) || e) }
      }
    }
    // 兼容没有遵守标记、但只返回了一个完整 Markdown 代码块的模型。
    const fence = raw.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
    if (fence && parseKernelMeta(fence[1])) return { ok: true, changed: true, text: fence[1].trim(), mode: 'replace' }
    // 设计对话允许只讨论取舍；没有变更块时保留回复，但不触碰当前草稿。
    return { ok: true, changed: false, text: currentText, mode: 'none' }
  }

  async function sendKernelAi() {
    if (kernelAiBusy) {
      if (kernelAiReqId) api.abortChat(kernelAiReqId)
      return
    }
    const value = $('kernel-ai-input').value.trim()
    if (!value) return
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      toast('请先在设置中填写 API 地址、密钥与模型。', 'err')
      openSettings()
      return
    }
    if (!$('kernel-edit-text').value.trim()) await newKernel()
    if (!$('kernel-edit-text').value.trim()) return

    const before = $('kernel-edit-text').value
    const history = kernelChatMessages()
    const nextHistory = history.concat({ role: 'user', content: value, at: Date.now() })
    setKernelChatMessages(nextHistory)
    $('kernel-ai-input').value = ''
    kernelAiReqId = 'kd' + Date.now().toString(36)
    setKernelAiBusy(true)

    const draftForAi = before.length <= 120000
      ? before
      : before.slice(0, 90000) + '\n\n[中段因长度省略，禁止修改该省略区]\n\n' + before.slice(-30000)
    const messages = [
      { role: 'system', content: KERNEL_DESIGN_SYSTEM + '\n\n【当前内核草稿】\n' + draftForAi }
    ]
    messages.push(...nextHistory.slice(-14).map((m) => ({ role: m.role, content: m.content })))
    const r = await api.sendChat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      thinkLevel: cfg.thinkLevel || 'default',
      messages,
      reqId: kernelAiReqId,
      silent: true
    })
    const wasAborted = !!(r && r.ok && r.aborted)
    kernelAiReqId = null
    setKernelAiBusy(false)

    if (wasAborted) {
      toast('已停止内核设计生成', 'info')
      return
    }
    if (!r || !r.ok || !r.content) {
      const err = (r && r.error) || '没有收到设计回复'
      setKernelChatMessages(kernelChatMessages().concat({ role: 'assistant', content: '生成失败：' + err, at: Date.now() }))
      renderKernelAiMessages()
      toast('内核设计失败：' + err, 'err')
      return
    }

    const applied = applyKernelAiChange(r.content, before)
    let summary = stripKernelChangeBlock(r.content) || (applied.changed ? '已同步本轮设计到内核草稿。' : '本轮仅讨论设计，草稿未改变。')
    if (!applied.ok) summary += '\n\n草稿未自动更新：' + applied.error
    setKernelChatMessages(kernelChatMessages().concat({ role: 'assistant', content: summary, at: Date.now() }))
    if (applied.ok && applied.changed) {
      $('kernel-edit-text').value = applied.text
      kernelCheckpointAccepted = false
      kernelValidation = { source: '', result: null }
      const meta = parseKernelMeta(applied.text)
      if (meta && meta.title && (!kernelHubEditingId || !$('kernel-edit-name').value.trim())) $('kernel-edit-name').value = meta.title
      updateKernelEditMeta()
      setKernelDirty(true, applied.mode === 'patch' ? 'AI 已应用局部修改' : 'AI 已更新完整草稿')
      $('kernel-edit-text').classList.add('ai-updated')
      setTimeout(() => $('kernel-edit-text').classList.remove('ai-updated'), 900)
    } else if (!applied.ok) {
      toast(applied.error, 'err', 5000)
    }
    renderKernelAiMessages()
  }

  async function resetKernelAi() {
    const list = kernelChatMessages()
    if (list.length) {
      const ok = await confirmDialog({ title: '新建设计对话', body: '当前内核的设计对话将被清空，内核草稿不会改变。', okText: '清空对话' })
      if (!ok) return
    }
    setKernelChatMessages([])
    renderKernelAiMessages()
    $('kernel-ai-input').focus()
  }

  $('btn-kernel-hub').addEventListener('click', openKernelHub)
  $('btn-content-area').addEventListener('click', closeKernelHub)
  $('btn-kernel-hub-close').addEventListener('click', closeKernelHub)
  document.querySelectorAll('.kernel-rail-step, [data-kernel-stage]').forEach((step) => {
    step.addEventListener('click', () => {
      const next = step.dataset.kernelStage
      if (next) setKernelStage(next)
    })
  })
  $('btn-kernel-rail-library').addEventListener('click', () => openKernelLayer('library'))
  $('btn-kernel-start-design').addEventListener('click', async () => {
    markKernelWelcomeSeen()
    setKernelStage('intent')
    await newKernel()
  })
  $('btn-kernel-use-recommended').addEventListener('click', () => openKernelLayer('library'))
  $('btn-kernel-import-start').addEventListener('click', async () => {
    markKernelWelcomeSeen()
    openKernelLayer('library')
    await importKernelFile()
  })
  $('btn-kernel-recommended-all').addEventListener('click', () => openKernelLayer('library'))
  document.querySelectorAll('.kernel-row-action').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.kernelRecommend
    if (id) await bindKernel(id)
    setKernelStage('intent')
  }))
  $('btn-kernel-stage-rules').addEventListener('click', () => setKernelStage('rules'))
  $('btn-kernel-stage-test').addEventListener('click', () => setKernelStage('test'))
  $('btn-kernel-stage-release').addEventListener('click', () => setKernelStage('release'))
  $('btn-kernel-stage-rules-source').addEventListener('click', () => openKernelLayer('source'))
  document.querySelectorAll('[data-kernel-rule-edit]').forEach((button) => button.addEventListener('click', () => {
    openKernelLayer('source')
  }))
  $('btn-kernel-stage-run-test').addEventListener('click', async () => {
    const result = await runKernelValidation(true)
    if (!result) return
    const checks = result.checks || []
    checks.slice(0, 4).forEach((check, index) => {
      const el = $('kernel-test-check-' + (index + 1))
      if (el) { el.textContent = check.present ? '已通过' : '待补全'; el.className = check.present ? 'passed' : 'pending' }
    })
    const state = $('kernel-stage-test-state')
    if (state) { state.className = 'kernel-stage-state ' + (result.blocking ? 'error' : result.attention ? 'warning' : 'ready'); state.innerHTML = '<i></i>' + (result.blocking ? '需要补全' : result.attention ? '有待决定' : '检查通过') }
  })
  $('btn-kernel-stage-publish').addEventListener('click', publishKernel)
  document.querySelectorAll('.area-switch-btn').forEach((tab, index, tabs) => {
    tab.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      let next = index
      if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = tabs.length - 1
      else {
        const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1
        next = (index + dir + tabs.length) % tabs.length
      }
      tabs[next].click()
      tabs[next].focus()
    })
  })
  $('btn-kernel-library').addEventListener('click', () => {
    if ($('kernel-hub').classList.contains('library-open')) closeKernelLayer()
    else openKernelLayer('library')
  })
  $('btn-kernel-source').addEventListener('click', () => openKernelLayer('source'))
  $('btn-kernel-publish').addEventListener('click', publishKernel)
  $('btn-kernel-library-close').addEventListener('click', () => closeKernelLayer())
  $('btn-kernel-source-close').addEventListener('click', () => closeKernelLayer())
  $('btn-kernel-source-done').addEventListener('click', () => closeKernelLayer())
  $('btn-kernel-validate').addEventListener('click', () => runKernelValidation(true))
  $('btn-kernel-source-save').addEventListener('click', saveKernelEdit)
  document.querySelectorAll('.kernel-source-tab').forEach((tab, index, tabs) => {
    tab.addEventListener('click', () => setKernelSourceView(tab.dataset.sourceTab))
    tab.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
      e.preventDefault()
      let next = index
      if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = tabs.length - 1
      else next = (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      setKernelSourceView(tabs[next].dataset.sourceTab)
      tabs[next].focus()
    })
  })
  $('btn-kernel-checkpoint-source').addEventListener('click', () => openKernelLayer('source'))
  $('btn-kernel-checkpoint-revise').addEventListener('click', () => {
    const input = $('kernel-ai-input')
    input.value = '请根据检查点中待补全或待决定的规则，提出修订方案并同步到当前内核草稿。'
    input.focus()
  })
  $('btn-kernel-checkpoint-accept').addEventListener('click', acceptKernelCheckpoint)
  $('kernel-layer-scrim').addEventListener('click', () => closeKernelLayer())
  $('btn-kernel-new').addEventListener('click', newKernel)
  $('btn-kernel-import').addEventListener('click', importKernelFile)
  $('btn-kernel-save').addEventListener('click', saveKernelEdit)
  $('btn-kernel-ai-send').addEventListener('click', sendKernelAi)
  $('btn-kernel-ai-reset').addEventListener('click', resetKernelAi)
  $('kernel-search').addEventListener('input', () => {
    clearTimeout(kernelSearchTimer)
    kernelSearchTimer = setTimeout(renderKernelHub, 120)
  })
  $('kernel-ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendKernelAi() }
  })
  document.querySelectorAll('.kernel-prompt').forEach((b) => b.addEventListener('click', () => {
    $('kernel-ai-input').value = b.dataset.prompt || ''
    $('kernel-ai-input').focus()
  }))
  $('kernel-edit-text').addEventListener('input', () => {
    updateKernelEditMeta(); setKernelDirty(true); kernelCheckpointAccepted = false; kernelValidation = { source: '', result: null }; renderKernelDesignSurface(); scheduleKernelAutoSave()
  })
  $('kernel-edit-name').addEventListener('input', () => {
    updateKernelEditMeta(); setKernelDirty(true); kernelCheckpointAccepted = false; renderKernelDesignSurface(); scheduleKernelAutoSave()
  })

  // 桌面宽屏下可拖动 AI / 源码分隔线；窄窗仍按上下布局自动重排。
  const kernelBody = document.querySelector('.kernel-hub-body')
  const kernelSplitter = $('kernel-splitter')
  const KERNEL_SOURCE_WIDTH_KEY = 'sixworlds.kernel.sourceWidth.v1'
  let storedKernelSourceWidth = 0
  try { storedKernelSourceWidth = Number(localStorage.getItem(KERNEL_SOURCE_WIDTH_KEY) || 0) } catch {}
  if (storedKernelSourceWidth >= 360 && storedKernelSourceWidth <= 760) kernelBody.style.setProperty('--kernel-source-w', storedKernelSourceWidth + 'px')
  function setKernelSourceWidth(width) {
    const max = Math.max(360, kernelBody.getBoundingClientRect().width - 252 - 340 - 7)
    const next = Math.round(Math.min(max, Math.max(360, width)))
    kernelBody.style.setProperty('--kernel-source-w', next + 'px')
    try { localStorage.setItem(KERNEL_SOURCE_WIDTH_KEY, String(next)) } catch {}
  }
  kernelSplitter.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= 1080) return
    const startX = e.clientX
    const startWidth = document.querySelector('.kernel-editor-pane').getBoundingClientRect().width
    kernelSplitter.classList.add('dragging')
    kernelSplitter.setPointerCapture(e.pointerId)
    const move = (ev) => setKernelSourceWidth(startWidth - (ev.clientX - startX))
    const up = () => {
      kernelSplitter.classList.remove('dragging')
      kernelSplitter.removeEventListener('pointermove', move)
      kernelSplitter.removeEventListener('pointerup', up)
      kernelSplitter.removeEventListener('pointercancel', up)
    }
    kernelSplitter.addEventListener('pointermove', move)
    kernelSplitter.addEventListener('pointerup', up)
    kernelSplitter.addEventListener('pointercancel', up)
  })
  kernelSplitter.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const width = document.querySelector('.kernel-editor-pane').getBoundingClientRect().width
    setKernelSourceWidth(width + (e.key === 'ArrowLeft' ? 24 : -24))
  })
  kernelSplitter.addEventListener('dblclick', () => {
    kernelBody.style.removeProperty('--kernel-source-w')
    try { localStorage.removeItem(KERNEL_SOURCE_WIDTH_KEY) } catch {}
  })

  const Gallery = window.GalleryPanel.createGallery({
    $,
    sessions: () => sessions,
    currentId: () => currentId,
    setCurrentId: (v) => { currentId = v },
    wsSessions,
    isBusy: () => busy,
    saveStore, saveSessions,
    renderSessionList, renderMessages, updateTitle,
    summarize,
    viewIllust, generateIllust, downloadIllust,
    confirmDialog, toast,
    cancelHideAnim, closeModalAnim,
  })
  const openGallery = () => Gallery.openGallery()
  const closeGallery = () => Gallery.closeGallery()
  const buildGallerySessionSelect = () => Gallery.buildGallerySessionSelect()
  const renderGallery = () => Gallery.renderGallery()

  // 叙事摘要：去掉【】结构块后截取前 60 字
  function summarize(text) {
    const t = String(text || '').replace(/【[^】]*】/g, ' ').replace(/\s+/g, ' ').trim()
    return (t.slice(0, 60) || '（无叙事文字）') + (t.length > 60 ? '…' : '')
  }

  // 一键保存当前世界线全部插图到文件夹
  $('btn-gallery-saveall').addEventListener('click', async () => {
    const sel = $('gallery-session')
    const s = sessions.find((x) => x.id === (sel && sel.value))
    if (!s) return
    const items = s.messages.filter((m) => m.illust).map((m) => ({ dataUrl: m.illust }))
    if (!items.length) { toast('这条世界线还没有插图', 'info'); return }
    const r = await api.saveAllImages({ items, nameBase: s.title || 'illust' })
    if (r && r.ok) {
      toast('已保存 ' + r.saved + ' 张插图到 ' + r.path, 'ok')
      if (r.failed && r.failed.length) toast(r.failed.length + ' 张保存失败', 'err')
    } else if (r && r.error) {
      toast('保存失败：' + r.error, 'err')
    }
  })

  // 导出整条世界线为自包含 HTML 存档（叙事全文 + 内嵌插图，浏览器可直接打开）
  $('btn-gallery-export').addEventListener('click', async () => {
    const sel = $('gallery-session')
    const s = sessions.find((x) => x.id === (sel && sel.value))
    if (!s) return
    if (!s.messages.length) { toast('这条世界线还没有内容', 'info'); return }
    const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const archivedMessages = await Promise.all(s.messages.map(async (m) => {
      if (!m.illust || !String(m.illust).startsWith('sixworlds-asset:') || !api.readImageDataUrl) return m
      const loaded = await api.readImageDataUrl(m.illust)
      return Object.assign({}, m, { illust: loaded && loaded.ok ? loaded.dataUrl : null })
    }))
    const turns = archivedMessages.map((m) => {
      const role = m.role === 'user' ? '你' : '世界'
      const img = m.illust ? '<figure><img src="' + esc(m.illust) + '" alt="插图" /></figure>' : ''
      return '<section class="turn ' + (m.role === 'user' ? 'you' : 'world') + '"><h3>' + role + '</h3>' + img + '<p>' + esc(m.content) + '</p></section>'
    }).join('\n')
    const date = new Date(s.createdAt || Date.now()).toLocaleDateString('zh-CN')
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(s.title) + ' · 六面世界存档</title><style>' +
      'body{font-family:Georgia,"Noto Serif SC",serif;max-width:720px;margin:40px auto;padding:0 20px;background:#f7f4ee;color:#2b2823;line-height:1.9}' +
      'h1{font-size:22px;letter-spacing:1px} .meta{color:#8a857c;font-size:13px;margin-bottom:32px}' +
      '.turn{margin:28px 0;padding:18px 22px;background:#fffdf9;border:1px solid #e4ded2;border-radius:10px}' +
      '.turn.you{background:#f0ece3;border-style:dashed}' +
      '.turn h3{font-size:12px;letter-spacing:2px;color:#a08b5f;margin:0 0 10px;text-transform:uppercase}' +
      '.turn p{white-space:pre-wrap;margin:0;font-size:15px}' +
      'figure{margin:0 0 12px} figure img{max-width:100%;border-radius:8px;border:1px solid #e4ded2}' +
      '</style></head><body><h1>' + esc(s.title) + '</h1><div class="meta">六面世界 · 人生存档 · 始于 ' + esc(date) + ' · ' + s.messages.length + ' 段</div>' + turns + '</body></html>'
    const name = (s.title || 'sixworlds').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '-存档.html'
    const r = await api.saveFile({ title: '导出故事存档', defaultName: name, content: html })
    if (r && r.ok) toast('故事存档已导出：' + r.path, 'ok')
    else if (r && r.error) toast('导出失败：' + r.error, 'err')
  })
  $('gallery-session').addEventListener('change', renderGallery)

  // ---- 输入区：自动增高（2–9 行）----
  const inputEl = $('input')
  function fitInput() {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 208) + 'px'
  }
  inputEl.addEventListener('input', fitInput)
  fitInput()

  // ---- 回到底部按钮（消息区翻阅时出现）----
  const scrollBtn = document.createElement('button')
  scrollBtn.id = 'scroll-to-bottom'
  scrollBtn.className = 'scroll-bottom hidden'
  scrollBtn.title = '回到底部'
  scrollBtn.textContent = '↓'
  scrollBtn.addEventListener('click', () => {
    msgEl.scrollTo({ top: msgEl.scrollHeight, behavior: 'smooth' })
    scrollBtn.classList.add('hidden')
  })
  document.querySelector('.chat').appendChild(scrollBtn)
  msgEl.addEventListener('scroll', () => {
    const near = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120
    scrollBtn.classList.toggle('hidden', near)
    wasNearBottom = near
    updateRailFill()
    // 选项区自动收起/展开：向上翻阅历史时收起（不挡视线），回到置底时自动展开。
    // R84 修复：置底自动展开只复位「自动收起」；玩家手动收起（choicesFoldUser）必须保持，
    // 否则收起按钮一点、布局变化引发 scroll 事件 → near=true → 立刻被重新展开（点收起无反应）。
    if (choiceMode) {
      if (near) {
        if (choicesAutoFolded) { choicesAutoFolded = false; applyChoicesFold() }
      } else if (!choicesAutoFolded && !choicesFoldUser && Date.now() >= choicesFoldGuard) {
        choicesAutoFolded = true
        applyChoicesFold()
      }
    }
  })

  // ---- 选项区收起/展开（收起后输入框上方浮现极简小箭头钮） ----
  function applyChoicesFold() {
    const pill = $('choices-expand')
    if (!pill) return
    const folded = choiceMode && (choicesFoldUser || choicesAutoFolded)
    if (choiceEl.classList.contains('collapsed') !== folded) choicesFoldGuard = Date.now() + 400 // 折叠态切换：smooth 滚动动画（~300ms）触发的中间态 scroll 事件不再反向自动折叠
    choiceEl.classList.toggle('collapsed', folded)
    pill.classList.toggle('hidden', !folded)
  }
  const choicesPill = $('choices-expand')
  if (choicesPill) {
    choicesPill.addEventListener('click', () => {
      choicesFoldUser = false
      choicesAutoFolded = false
      applyChoicesFold()
    })
  }

  // ---- 操作指南（右下角 ? 按钮）----
  const guideMask = $('guide-mask')
  // R70 帮助面板双 Tab：怎么玩 / 快捷键（原两个独立 Modal 合并）
  function setHelpTab(which) {
    const play = $('help-tab-play'), keys = $('help-tab-keys')
    const p = $('guide-play'), k = $('guide-keys')
    if (!play || !keys) return
    play.classList.toggle('active', which === 'play')
    keys.classList.toggle('active', which === 'keys')
    play.setAttribute('aria-selected', which === 'play' ? 'true' : 'false')
    keys.setAttribute('aria-selected', which === 'keys' ? 'true' : 'false')
    if (p) p.classList.toggle('hidden', which !== 'play')
    if (k) k.classList.toggle('hidden', which !== 'keys')
  }
  function openGuide() {
    cancelHideAnim($('guide')); cancelHideAnim(guideMask)
    guideMask.hidden = false; $('guide').hidden = false
    setHelpTab('play')
  }
  function closeGuide() {
    closeModalAnim($('guide'), guideMask, () => {
      guideMask.hidden = true
      $('guide').hidden = true
      // 首次配置完成后，帮助页关闭即进入通用内核设计起点；普通帮助关闭不改变当前区域。
      if (guideMask.dataset.afterOnboarding === 'kernel') {
        delete guideMask.dataset.afterOnboarding
        openKernelHub()
      }
    })
  }
  $('btn-help').addEventListener('click', openGuide)
  $('btn-guide-close').addEventListener('click', closeGuide)
  $('help-tab-play').addEventListener('click', () => setHelpTab('play'))
  $('help-tab-keys').addEventListener('click', () => setHelpTab('keys'))
  guideMask.addEventListener('click', closeGuide)
  $('guide').addEventListener('click', (e) => e.stopPropagation())

  // ---- 状态检查器（故事状态引擎调试视图 · Ctrl+Alt+I） ----
  // 查看：结构化状态总览 / 九大记忆账本 / 快照（创建+恢复）/ 回合诊断日志
  const inspMask = $('inspector-mask')
  let inspTab = 'overview'
  let inspRestoreArm = '' // 恢复按钮两段式确认（点一次变"确认恢复"，再点执行）
  function setInspTab(which) {
    inspTab = which
    const tabs = [['overview', 'insp-tab-overview', 'insp-overview'], ['ledgers', 'insp-tab-ledgers', 'insp-ledgers'], ['snaps', 'insp-tab-snaps', 'insp-snaps'], ['logs', 'insp-tab-logs', 'insp-logs']]
    for (const [key, tabId, panelId] of tabs) {
      const t = $(tabId), p = $(panelId)
      if (!t || !p) continue
      const on = key === which
      t.classList.toggle('active', on)
      t.setAttribute('aria-selected', on ? 'true' : 'false')
      p.classList.toggle('hidden', !on)
    }
    refreshInspector()
  }
  function inspChip(label, v) { return '<span class="insp-chip">' + label + ' <b>' + (Number(v) || 0) + '</b></span>' }
  function inspTag(text, cls) { return '<span class="insp-tag' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>' }
  function inspOverviewHtml(o) {
    const c = o.counts || {}
    const scene = o.scene || {}
    const player = o.player || {}
    const pBits = []
    if (player.name) pBits.push('名字:' + player.name)
    if (player.location) pBits.push('位置:' + player.location)
    if (player.status && player.status.length) pBits.push('状态:' + player.status.join('/'))
    const resKeys = Object.keys(player.resources || {})
    if (resKeys.length) pBits.push('资源:' + resKeys.map((k) => k + '=' + player.resources[k]).join(', '))
    return [
      '<div class="insp-head"><span class="insp-story">' + escapeHtml(o.title || o.story_id) + '</span>',
      '<span class="insp-meta">' + escapeHtml(o.story_id) + ' · 引擎回合 <b>' + escapeHtml(String(o.engine_turn)) + '</b> · 内核 ' + escapeHtml(String((o.kernel && o.kernel.version) || '?')).slice(0, 24) + '</span></div>',
      '<div class="insp-chips">',
      inspChip('有效决定', c.decisions), inspChip('活跃承诺', c.commitments_active), inspChip('活跃事实', c.facts_active),
      inspChip('玩家已知', c.knowledge), inspChip('事件', c.events), inspChip('待兑现因果', c.causal_pending),
      inspChip('开放伏笔', c.threads_open), inspChip('实体', c.entities), inspChip('Session', c.sessions),
      '</div>',
      '<div class="insp-sec">当前场景</div>',
      '<div class="insp-item">' + escapeHtml([scene.game_time, scene.location, scene.summary].filter(Boolean).join(' · ') || '（尚未开始）') + '</div>',
      '<div class="insp-sec">玩家状态</div>',
      '<div class="insp-item">' + escapeHtml(pBits.join('；') || JSON.stringify(player)) + '</div>',
      '<div class="insp-actions"><button class="insp-btn primary" data-act="snap-now">在此创建快照</button></div>'
    ].join('')
  }
  async function refreshInspector() {
    const s = curSession()
    const panels = { overview: $('insp-overview'), ledgers: $('insp-ledgers'), snaps: $('insp-snaps'), logs: $('insp-logs') }
    if (!s) { for (const el of Object.values(panels)) if (el) el.innerHTML = '<div class="insp-empty">当前没有世界线。</div>'; return }
    const sid = s.id
    if (inspTab === 'overview' || inspTab === 'ledgers') {
      const r = await api.engineOverview({ storyId: sid })
      if (!r || !r.ok || !r.data) {
        const msg = '<div class="insp-empty">引擎中尚无该故事的结构化状态（本世界线还没有完成过引擎回合）。</div>'
        if (inspTab === 'overview') panels.overview.innerHTML = msg
        else panels.ledgers.innerHTML = msg
        return
      }
      if (inspTab === 'overview') panels.overview.innerHTML = inspOverviewHtml(r.data)
      else panels.ledgers.innerHTML = await inspLedgersHtmlFull(sid)
    } else if (inspTab === 'snaps') {
      const r = await api.engineSnapshots({ storyId: sid })
      const list = (r && r.ok && r.data) || []
      inspRestoreArm = ''
      panels.snaps.innerHTML = list.length ? [
        '<div class="insp-actions"><span class="insp-meta">快照保存完整结构化状态；恢复会替换当前状态（叙事消息不受影响）。</span></div>'
      ].concat(list.map((sp) => '<div class="insp-row"><span class="insp-grow"><span class="insp-id">' + escapeHtml(sp.snapshot_id) + '</span>' + escapeHtml(sp.label) + ' · 第' + escapeHtml(String(sp.turn)) + '回合</span><button class="insp-btn" data-act="restore" data-id="' + escapeHtml(sp.snapshot_id) + '">恢复</button></div>')).join('') : '<div class="insp-empty">尚无快照。在「总览」或此页创建。</div>'
    } else {
      const r = await api.engineLogs({ storyId: sid })
      const list = (r && r.ok && r.data) || []
      panels.logs.innerHTML = list.length ? [
        '<div class="insp-actions"><button class="insp-btn" data-act="log-refresh">刷新</button></div>'
      ].concat(list.map((tid) => '<div class="insp-row"><span class="insp-grow"><span class="insp-id">' + escapeHtml(tid) + '</span></span><button class="insp-btn" data-act="viewlog" data-id="' + escapeHtml(tid) + '">查看</button></div>')).join('') : '<div class="insp-empty">尚无回合日志。</div>'
    }
  }
  async function inspLedgersHtmlFull(sid) {
    // 概览只给计数，明细需要账本原始数据 —— 用 log/overview 组合：直接读最新回合日志里的账本摘要最轻量；
    // 这里选择恢复一个只读视图：engineOverview 不带账本，故退化为用快照列表之外的独立 IPC —— 
    // 简化实现：用 engineLog 最后一回合 + overview 计数即可满足"至少可以查看"
    const r = await api.engineOverview({ storyId: sid })
    if (!r || !r.ok || !r.data) return '<div class="insp-empty">无数据。</div>'
    const c = r.data.counts || {}
    const sec = (t, items) => '<div class="insp-sec">' + t + '</div><div class="insp-list">' + (items || '<div class="insp-item">（无）</div>') + '</div>'
    const logs = await api.engineLogs({ storyId: sid })
    let lastLogHtml = '<div class="insp-item">（无回合日志）</div>'
    const lastTid = logs && logs.ok && logs.data && logs.data[0]
    if (lastTid) {
      const lr = await api.engineLog({ storyId: sid, turnId: lastTid })
      if (lr && lr.ok && lr.data) {
        const d = lr.data
        const applied = (d.commit_result && d.commit_result.applied) || {}
        const flat = Object.entries(applied).map(([k, v]) => k + ':' + (Array.isArray(v) ? v.join(',') : v)).join('　')
        lastLogHtml = '<div class="insp-item"><b>最近回合</b> ' + escapeHtml(d.turn_id || '') + ' · 提交' + (d.commit_result && d.commit_result.ok ? '<span class="insp-tag ok">成功</span>' : '<span class="insp-tag warn">失败</span>') + '<br>' + escapeHtml(flat || '（无状态变化）') + '</div>'
      }
    }
    return [
      lastLogHtml,
      sec('记忆账本计数（明细以叙事一致性由引擎自动维护）',
        '<div class="insp-item">决定 ' + (c.decisions_total || 0) + '（有效 ' + (c.decisions || 0) + '）· 承诺 ' + (c.commitments_active || 0) + ' 活跃 · 事实 ' + (c.facts_active || 0) + ' 活跃 · 玩家已知 ' + (c.knowledge || 0) + ' · 事件 ' + (c.events || 0) + ' · 因果 ' + (c.causal_pending || 0) + ' 待兑现 · 伏笔 ' + (c.threads_open || 0) + ' 开放 · 关系 ' + (c.relationships || 0) + ' · 实体 ' + (c.entities || 0) + '</div>'),
      sec('引擎数据位置', '<div class="insp-item">应用数据目录 /story-engine/stories/' + escapeHtml(sid) + '.json（含快照 snapshots/ 与日志 logs/）</div>')
    ].join('')
  }
  async function openInspector() {
    cancelHideAnim($('inspector')); cancelHideAnim(inspMask)
    inspMask.hidden = false; $('inspector').hidden = false
    setInspTab(inspTab || 'overview')
  }
  function closeInspector() {
    closeModalAnim($('inspector'), inspMask, () => { inspMask.hidden = true; $('inspector').hidden = true })
  }
  inspMask.addEventListener('click', closeInspector)
  $('inspector').addEventListener('click', async (e) => {
    e.stopPropagation()
    const btn = e.target.closest('[data-act]')
    if (!btn) {
      const tab = e.target.closest('.insp-tab')
      if (tab) {
        const which = tab.id.replace('insp-tab-', '')
        setInspTab(which)
      }
      return
    }
    const act = btn.dataset.act
    const s = curSession()
    if (!s) return
    const sid = s.id
    if (act === 'snap-now') {
      const o = await api.engineOverview({ storyId: sid })
      const turn = o && o.ok && o.data ? o.data.engine_turn : 0
      const r = await api.engineSnapshot({ storyId: sid, label: '手动快照 · 第' + turn + '回合' })
      toast(r && r.ok ? '快照已创建：' + r.data.snapshot_id : '快照创建失败', r && r.ok ? 'ok' : 'err')
      setInspTab('snaps')
    } else if (act === 'restore') {
      const id = btn.dataset.id
      if (inspRestoreArm !== id) {
        inspRestoreArm = id
        btn.textContent = '确认恢复？'
        btn.classList.add('primary')
        setTimeout(() => { if (inspRestoreArm === id) { inspRestoreArm = ''; btn.textContent = '恢复'; btn.classList.remove('primary') } }, 4000)
        return
      }
      const r = await api.engineRestore({ storyId: sid, snapshotId: id })
      if (r && r.ok) {
        toast('已恢复到快照 ' + id + '（第' + r.data.engine_turn + '回合）', 'ok')
        inspRestoreArm = ''
        setInspTab('overview')
      } else toast('恢复失败：' + ((r && r.error) || '未知'), 'err')
    } else if (act === 'viewlog') {
      const r = await api.engineLog({ storyId: sid, turnId: btn.dataset.id })
      const panels = $('insp-logs')
      if (r && r.ok && r.data) {
        panels.innerHTML = '<div class="insp-actions"><button class="insp-btn" data-act="log-back">返回列表</button></div><pre class="insp-logpre">' + escapeHtml(JSON.stringify(r.data, null, 2)) + '</pre>'
      } else panels.innerHTML = '<div class="insp-empty">日志读取失败。</div>'
    } else if (act === 'log-back' || act === 'log-refresh') {
      setInspTab('logs')
    }
  })

  // ============ 事件绑定 ============
  // Pending Commit 横幅按钮（条款 26：允许继续补 Patch，不能忘掉）
  // R85：补不进的死账出口——重试仍失败时允许用户显式丢弃（记忆留痕于日志，叙事不丢，横幅不再永久噪音）
  const discardAllPendings = () => {
    const s = curSession()
    if (!s || busy || engineBusy) return
    confirmDialog({
      title: '放弃这些待补录状态？',
      body: '补录多次仍失败（模型反复输出无法通过校验的状态块）。放弃后：剧情与对话不受影响，这些回合的结构化状态（实体/伏笔/事实变化）不再写入世界记忆，也无法事后找回。确定放弃？',
      danger: true,
      okText: '放弃补录'
    }).then((ok) => {
      if (!ok) return
      ;(async () => {
        let n = 0
        try {
          const lr = await api.enginePendings({ storyId: s.id })
          const list = (lr && lr.ok && Array.isArray(lr.data)) ? lr.data : []
          for (const pc of list) {
            const r = await api.engineDiscardPending({ storyId: s.id, pendingId: pc.pending_id })
            if (r && r.data && r.data.discarded) n++
          }
        } catch {}
        for (const m of s.messages) { if (m.pending) { m.pending = undefined; m.committing = false } }
        saveSessions()
        renderMessages()
        refreshPendingBanner()
        toast(n ? ('已放弃 ' + n + ' 条待补录（世界记忆不再含这些回合）') : '没有可放弃的待补录', n ? 'info' : 'ok')
      })()
    })
  }
  const pendingBannerEl = document.getElementById('pending-banner')
  if (pendingBannerEl) {
    document.getElementById('btn-pending-resolve').addEventListener('click', () => resolvePendingFlow(null))
    document.getElementById('btn-pending-dismiss').addEventListener('click', () => pendingBannerEl.classList.add('hidden'))
    const discardBtn = document.createElement('button')
    discardBtn.id = 'btn-pending-discard'
    discardBtn.className = 'pending-btn ghost'
    discardBtn.textContent = '放弃'
    discardBtn.title = '补录多次仍失败时，显式放弃这些回合的状态补录（剧情不受影响）'
    discardBtn.addEventListener('click', discardAllPendings)
    document.getElementById('btn-pending-resolve').after(discardBtn)
  }
  $('btn-new').addEventListener('click', () => {
    if (busy) { toast('请等当前回合结束', 'info'); return }
    newSession()
    renderMessages()
    updateTitle()
    if (!choiceMode) $('input').focus()
  })
  // 侧栏全局搜索：输入即过滤所有世界线（标题+正文）；Esc 清空
  const sbSearch = $('sb-search')
  sbSearch.addEventListener('input', () => {
    sbFilter = sbSearch.value.trim()
    renderSessionList()
  })
  sbSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      sbSearch.value = ''
      sbFilter = ''
      renderSessionList()
    } else if (e.key === 'Enter' && sbFilter) {
      // 跳到第一个命中会话
      const first = document.querySelector('#session-list .session-item:not(.active)')
      if (first) first.click()
    }
  })
  // 发送按钮：busy 时变成停止
  $('btn-send').addEventListener('click', () => {
    if (busy) { stopGeneration(); return }
    send($('input').value)
  })
  // R13：自由输入「灵感」入口——本地静态轮换填入，可编辑后再发送（不耗 token）
  const INSPIRES = ['环顾四周，记下所有出口与异常之处', '追问对方的真实来意与目的', '检查随身物品与自身状态', '先稳住局势，观察后再行动', '回忆之前得到的线索，重新梳理', '试探性地套近乎，降低对方戒心', '直接表明来意，试探对方底线', '寻找可以利用的环境或道具', '暗中做好最坏打算的准备', '换个角度质问刚才的矛盾之处', '先照顾好同行者的状态', '决定暂时撤退，从长计议']
  let inspireIdx = Math.floor(Math.random() * INSPIRES.length)
  $('btn-inspire').addEventListener('click', () => {
    const el = $('input')
    el.value = INSPIRES[inspireIdx++ % INSPIRES.length]
    fitInput()
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
  // R46：空输入框按 ↑ 召回上一条已发送行动（shell-history 式；连按向上回溯，Esc/清空复位）
  let recallIdx = -1, recallValue = null
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.isComposing) {
      const el = $('input')
      // R46b 护栏：召回中的内容被外部改动（手编/切会话）→ 重置召回状态再判断
      if (recallIdx >= 0 && el.value !== recallValue) recallIdx = -1
      if (el.value !== '' && recallIdx < 0) return // 有草稿时不拦截（正常光标行为）
      const s = curSession()
      if (!s) return
      const userMsgs = s.messages.filter((m) => m.role === 'user')
      if (!userMsgs.length) return
      e.preventDefault()
      recallIdx = Math.min(recallIdx + 1, userMsgs.length - 1)
      el.value = userMsgs[userMsgs.length - 1 - recallIdx].content
      recallValue = el.value
      fitInput()
      el.setSelectionRange(el.value.length, el.value.length)
      return
    }
    if (e.key === 'ArrowDown' && recallIdx >= 0) {
      e.preventDefault()
      const el = $('input')
      recallIdx--
      el.value = recallIdx < 0 ? '' : (() => { const s = curSession(); const um = s ? s.messages.filter((m) => m.role === 'user') : []; return um.length ? um[um.length - 1 - recallIdx].content : '' })()
      recallValue = recallIdx < 0 ? null : el.value
      fitInput()
      return
    }
    if (e.key === 'Escape' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) { recallIdx = -1; recallValue = null }
    // Enter 或 Ctrl/Cmd+Enter 发送（Shift+Enter 换行）
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      // busy 时输入保留待生成完再发（不静默丢弃）
      if (busy) { toast('生成中…内容已保留，完成后自动聚焦', 'info', 1800); return }
      send($('input').value)
    }
  })

  $('btn-sidebar-toggle').addEventListener('click', toggleSidebar)
  $('btn-sb-collapse').addEventListener('click', toggleSidebar)

  // 标题栏双击：最大化/还原（Windows 标准行为；品牌区双击，避开按钮）
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return
    api.maximizeToggle()
  })

  $('btn-pin').addEventListener('click', () => { setPin(!cfg.pin); saveStore() })
  // 主题按钮：完整外观抽屉，所有选项即时应用并持久化。
  const themePopEl = $('theme-pop')
  const themeMaskEl = $('theme-drawer-mask')
  // 调色板「人设」联动：首次选择某调色板时写入推荐字体/密度（用户手动改过后不再干预）
  // paper 羊皮纸→衬线字体；forest 林间→宽松密度；contrast 高对比→紧凑密度
  const PALETTE_LINKS = { paper: { fontUI: 'serif' }, forest: { density: 'relaxed' }, contrast: { density: 'compact' } }
  function applyPalettePresetLink(paletteId) {
    const link = PALETTE_LINKS[paletteId]
    if (!link) return false
    let seeded = []
    try { seeded = JSON.parse(localStorage.getItem('sixworlds.preset-seeded.v1') || '[]') } catch { }
    if (!Array.isArray(seeded) || seeded.includes(paletteId)) return false
    seeded.push(paletteId)
    try { localStorage.setItem('sixworlds.preset-seeded.v1', JSON.stringify(seeded)) } catch { }
    Object.assign(cfg, link)
    const t = link.fontUI ? '衬线字体' : (link.density === 'relaxed' ? '宽松密度' : '紧凑密度')
    toast('已联动推荐外观：' + t + '（可在设置中改回）', 'info', 2600)
    return true
  }
  function buildThemePop() {
    const grid = $('swatch-grid')
    if (!grid) return
    grid.innerHTML = ''
    for (const p of PALETTES) {
      const sw = document.createElement('button')
      sw.className = 'appearance-tile swatch'
      sw.title = p.name
      sw.dataset.setting = 'palette'
      sw.dataset.value = p.id
      const sample = document.createElement('span')
      sample.className = 'palette-sample'
      const primary = document.createElement('i')
      const secondary = document.createElement('b')
      primary.style.background = p.dot[0]
      secondary.style.background = p.dot[1]
      sample.appendChild(primary); sample.appendChild(secondary)
      const nm = document.createElement('span')
      nm.textContent = p.name
      sw.appendChild(sample); sw.appendChild(nm)
      grid.appendChild(sw)
    }
    themePopEl.querySelectorAll('[data-setting]').forEach((b) => {
      const value = String(cfg[b.dataset.setting] === undefined ? '' : cfg[b.dataset.setting])
      const on = b.dataset.value === value
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
  }
  function setThemeAppearance(setting, value) {
    const payload = {}
    if (setting === 'theme') {
      applyTheme(value)
      payload.theme = cfg.theme
    } else {
      cfg[setting] = value
      let linked = false
      if (setting === 'palette') linked = applyPalettePresetLink(value)
      applyAppearance()
      applyReading()
      payload[setting] = value
      if (linked) { payload.fontUI = cfg.fontUI; payload.density = cfg.density }
    }
    saveStore()
    try { api.mainChanged(payload) } catch { /* noop */ }
    buildThemePop()
  }
  function closeThemePop() {
    if (!themePopEl || themePopEl.classList.contains('hidden')) return
    $('btn-theme').classList.remove('active')
    themeMaskEl.hidden = true
    hideWithAnim(themePopEl, () => themePopEl.classList.add('hidden'))
  }
  function toggleThemePop() {
    if (!themePopEl) return
    if (themePopEl.classList.contains('hidden')) {
      buildThemePop()
      cancelHideAnim(themePopEl)
      themeMaskEl.hidden = false
      themePopEl.classList.remove('hidden')
      $('btn-theme').classList.add('active')
    } else closeThemePop()
  }
  themePopEl.addEventListener('click', (e) => {
    const option = e.target.closest('[data-setting]')
    if (option) {
      e.stopPropagation()
      setThemeAppearance(option.dataset.setting, option.dataset.value)
    }
  })
  $('btn-theme').addEventListener('click', (e) => { e.stopPropagation(); toggleThemePop() })
  $('btn-theme-close').addEventListener('click', closeThemePop)
  themeMaskEl.addEventListener('click', closeThemePop)
  // ---- 界面方案（经典 / 原型工作台）：读取当前方案点亮对应磁贴，点击后由主进程重载入口 ----
  async function refreshUiSchemeTiles() {
    let scheme = 'classic'
    try { scheme = await api.uiScheme() } catch { /* noop */ }
    themePopEl.querySelectorAll('[data-ui-scheme]').forEach((tile) => {
      tile.classList.toggle('on', tile.dataset.uiScheme === scheme)
      tile.setAttribute('aria-pressed', tile.dataset.uiScheme === scheme ? 'true' : 'false')
    })
  }
  refreshUiSchemeTiles()
  themePopEl.querySelectorAll('[data-ui-scheme]').forEach((tile) => {
    tile.addEventListener('click', async (e) => {
      e.stopPropagation()
      const target = tile.dataset.uiScheme
      let current = 'classic'
      try { current = await api.uiScheme() } catch { /* noop */ }
      if (target === current) return
      try { await api.setUiScheme(target) } catch { /* noop */ }
    })
  })
  $('btn-theme-reset').addEventListener('click', () => {
    Object.assign(cfg, {
      theme: 'system', palette: 'classic', fontUI: 'sans', radius: 'standard',
      density: 'standard', layout: 'sidebar', sbSide: 'left', readWidth: 'standard'
    })
    applyTheme(cfg.theme)
    applyAppearance()
    applyReading()
    applySidebar()
    saveStore()
    try { api.mainChanged({ theme: cfg.theme, palette: cfg.palette, fontUI: cfg.fontUI, radius: cfg.radius, density: cfg.density, layout: cfg.layout, sbSide: cfg.sbSide, readWidth: cfg.readWidth }) } catch { /* noop */ }
    buildThemePop()
  })
  // 点击弹层外部：关闭主题弹层 / 模型用量面板
  document.addEventListener('click', (e) => {
    if (themePopEl && !themePopEl.classList.contains('hidden') &&
      !themePopEl.contains(e.target) && e.target !== $('btn-theme') && !$('btn-theme').contains(e.target)) {
      closeThemePop()
    }
    const mp = $('model-pop')
    // 芯片点击已 stopPropagation，这里只需处理点到其他位置的情况
    if (mp && !mp.classList.contains('hidden') && !mp.contains(e.target)) {
      hideWithAnim(mp, () => mp.classList.add('hidden'))
    }
  })
  $('btn-gallery').addEventListener('click', () => openGallery())
  $('btn-gallery-close').addEventListener('click', () => closeGallery())
  // R81：pointerdown 即时响应——画廊打开瞬间 head 重绘/大图解码可能吞掉 click，先按先关
  $('btn-gallery-close').addEventListener('pointerdown', () => closeGallery(), { once: false })
  $('gallery-mask').addEventListener('click', () => closeGallery())
  $('btn-min').addEventListener('click', () => api.minimize())
  $('btn-max').addEventListener('click', () => api.maximizeToggle())
  $('btn-close').addEventListener('click', () => api.close())

  $('btn-settings').addEventListener('click', openSettings)

  // 流式增量
  api.onChatDelta((piece) => {
    if (!busy) return
    appendStream(piece)
  })

  // ============ 快捷键面板（R70：并入帮助面板，Ctrl+/ 直达快捷键页） ============
  function openShortcuts() {
    cancelHideAnim($('guide')); cancelHideAnim(guideMask)
    guideMask.hidden = false; $('guide').hidden = false
    setHelpTab('keys')
  }
  function closeShortcuts() { closeGuide() }

  // 全局快捷键：Esc 返回内容/关闭浮层 · Ctrl+K 内核设计 · Ctrl+G 画廊 · Ctrl+F 搜索
  document.addEventListener('keydown', (e) => {
    if (commandMask && !commandMask.hidden && e.key === 'Tab') {
      const focusables = [commandInput, $('btn-command-close'), ...commandOptions().filter((option) => !option.hidden)]
        .filter((el) => el && el.getClientRects().length && !el.disabled)
      if (focusables.length) {
        const index = focusables.indexOf(document.activeElement)
        const next = (index + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length
        e.preventDefault(); focusables[next].focus()
      } else e.preventDefault()
      return
    }
    if (e.key === 'Tab' && !$('kernel-hub').hidden && ($('kernel-hub').classList.contains('library-open') || $('kernel-hub').classList.contains('source-open'))) {
      trapKernelLayerFocus(e)
      return
    }
    if (e.key === 'Escape') {
      if (commandMask && !commandMask.hidden) closeCommandPanel()
      else if (themePopEl && !themePopEl.classList.contains('hidden')) closeThemePop()
      else if (!$('gallery').hidden) closeGallery()
      else if (!$('inspector-mask').hidden) closeInspector()
      else if (!$('guide-mask').hidden) closeGuide()
      else if (!$('kernel-hub').hidden) {
        if ($('kernel-hub').classList.contains('library-open') || $('kernel-hub').classList.contains('source-open')) closeKernelLayer()
        else closeKernelHub()
      }
    } else if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'i' || e.key === 'I')) {
      // Ctrl+Alt+I 状态检查器（引擎状态/快照/回合日志）
      e.preventDefault()
      if ($('inspector').hidden) openInspector()
      else closeInspector()
    } else if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.key === '<')) {
      e.preventDefault()
      openSettings()
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault()
      if ($('gallery').hidden) openGallery()
      else closeGallery()
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault()
      if (commandMask && commandMask.hidden) openCommandPanel()
      else closeCommandPanel()
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      // Ctrl+K 在内容区与内核设计工作台之间切换
      e.preventDefault()
      if ($('kernel-hub').hidden) openKernelHub()
      else closeKernelHub()
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
      // Ctrl+Shift+L 打开/关闭内核库焦点层
      e.preventDefault()
      if ($('kernel-hub').hidden) openKernelHub()
      if ($('kernel-hub').classList.contains('library-open')) closeKernelLayer()
      else openKernelLayer('library')
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '.' || e.key === '>')) {
      // Ctrl+. 打开/关闭源码焦点层
      e.preventDefault()
      if ($('kernel-hub').hidden) openKernelHub()
      if ($('kernel-hub').classList.contains('source-open')) closeKernelLayer()
      else openKernelLayer('source')
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      // Ctrl+F 在当前世界线内搜索（替代浏览器查找）
      e.preventDefault()
      if (!$('gallery').hidden) return
      if (searchBar.hidden) openSearch()
      else { searchInput.focus(); searchInput.select() }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === '?')) {
      // Ctrl+/ 帮助面板-快捷键页
      e.preventDefault()
      if ($('guide').hidden) openShortcuts()
      else closeGuide()
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      // Ctrl+B 收起/展开会话栏
      e.preventDefault()
      toggleSidebar()
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      // R47：Ctrl+N 新建世界线（对标桌面版 ⌘+N New chat）
      e.preventDefault()
      if (busy) { toast('请等当前回合结束', 'info'); return }
      newSession()
      renderMessages()
      updateTitle()
      if (!choiceMode) $('input').focus()
    } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
      // R48：字号缩放（对标 ⌘+/-/0；small/standard/large 循环，0 复位标准）
      e.preventDefault()
      const order = ['small', 'standard', 'large']
      let i = order.indexOf(cfg.fontSize || 'standard')
      if (i < 0) i = 1
      if (e.key === '0') i = 1
      else if (e.key === '-') i = Math.max(0, i - 1)
      else i = Math.min(order.length - 1, i + 1)
      cfg.fontSize = order[i]
      applyReading(); saveStore()
      toast('字号：' + (order[i] === 'small' ? '小' : order[i] === 'large' ? '大' : '标准'), 'info', 1200)
    }
  })

  // ============ R72 初始化配置向导（首次安装：外观 → 文本模型 → 插图模型） ============
  // ============ R72/R73 初始化配置向导（外观 → 模型拉取配置） ============
  // DOM-source-of-truth：mask.dataset.step 驱动步进；cacheStep 切步前缓存表单值；模型名支持 GET /models 拉取下拉
  // ============ 免责声明（首次安装须确认） ============

  // ============ R76 入场动画（Mineradio 式启动页） ============
  // 五层舞台 + 字标序列由纯 CSS 驱动；此处只负责：粒子尘埃、点击/键盘进入、12s 兜底、离场双层时序。
  // e2e 环境（SIXWORLDS_TEST=1）直接移除，不阻塞自动化；设置 sixworlds.splash-preview 可强制预览。
const Onboarding = window.Onboarding.createOnboarding({
    $, api, cfg: () => cfg,
    applyTheme, applyPalettePresetLink, refreshModelSelect, saveStore, toast,
    STORE_KEY, OB_KEY: 'sixworlds.onboard.v1', PALETTES,
  })
  const WIZ_PRESETS = Onboarding.WIZ_PRESETS
  const WIZ_IMG_PRESETS = Onboarding.WIZ_IMG_PRESETS
  const showSetupWizard = () => Onboarding.showSetupWizard()
  const showDisclaimer = () => Onboarding.showDisclaimer()
  Onboarding.splashBoot()

  // ---- 启动 ----
  ;(async function boot() {
    await hydrateSecrets()
    applyTheme(cfg.theme)
    applyAppearance()
    applyReading()
    setPin(cfg.pin)
    loadWorkspaces() // 必须先于 loadSessions（旧会话迁移需要工作区存在）
    await loadSessions()
    const ws = curWs()
    const wsS = wsSessions()
    if (!wsS.length) newSession()
    else currentId = wsS.some((s) => s.id === ws.lastSessionId)
      ? ws.lastSessionId
      : (wsS.some((s) => s.id === cfg.currentSessionId) ? cfg.currentSessionId : wsS[0].id)
    renderWsBtn()
    renderSessionList()
    updateTitle()
    await loadKernel()
    renderMessages()
    refreshModelSelect()
    if (selThink) selThink.value = cfg.thinkLevel || 'default'
    $('input').focus()
    // 世界之灵桌宠（bloub）：经典 / 原型双方案共用（shared/bloub-pet.js）；失败静默
    try { if (window.BloubPet) window.BloubPet.init() } catch {}
    // 桌宠云端大脑：注入用户配置的模型（内存传递，密钥不落 localStorage）；引导/设置改动后刷新
    try {
      if (window.BloubPet) window.BloubPet.setCloudBrain({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model })
    } catch {}
    ;(function syncPetBrain() {
      // hydrateSecrets/persistSecrets 完成与设置窗口改密钥后都再同步一次
      const push = () => {
        try {
          if (window.BloubPet) window.BloubPet.setCloudBrain({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model })
        } catch {}
      }
      setTimeout(push, 400)
      window.addEventListener('storage', push)
      if (window.api && window.api.onCfgUpdated) window.api.onCfgUpdated(push)
    })()
    // 桌宠智能体能力面（纯新增注入，不改既有流程）：读选项 / 代选（等一轮生成完）/ 读剧情 / 配图
    try {
      if (window.BloubPet) window.BloubPet.bindAgent({
        getChoices: () => {
          const s = curSession()
          if (!s || busy) return []
          const la = s.messages.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1)
          if (la < 0) return []
          return parseChoices(s.messages[la].content)
        },
        playChoice: async (key, label) => {
          if (busy) return { ok: false, error: '上一回合还没结束' }
          if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return { ok: false, error: '模型未配置' }
          await send('【' + key + '】' + label)
          return { ok: true }
        },
        storyTail: (n) => {
          const s = curSession()
          if (!s) return ''
          return s.messages.slice(-Math.max(1, n || 6))
            .map((m) => (m.role === 'user' ? '（你）' : '（故事）') + String(m.content || '').replace(/\s+/g, ' ').slice(0, 400))
            .join('\n')
        },
        // 幕候选：0 = 最近一幕（与主进程智能体提示词约定一致）
        assistantCandidates: () => {
          const s = curSession()
          if (!s) return []
          const out = []
          for (let i = s.messages.length - 1; i >= 0 && out.length < 5; i--) {
            const m = s.messages[i]
            if (m.role === 'assistant' && String(m.content || '').length > 40) {
              out.push({ idx: i, preview: String(m.content).replace(/\s+/g, ' ').slice(0, 90) })
            }
          }
          return out
        },
        lastScene: () => {
          const s = curSession()
          if (!s) return null
          for (let i = s.messages.length - 1; i >= 0; i--) {
            const m = s.messages[i]
            if (m.role === 'assistant' && String(m.content || '').length > 40) {
              return { idx: i, text: String(m.content || '') }
            }
          }
          return null
        },
        illustReady: () => illustReady(),
        generateIllustFor: async (idx, customPrompt) => {
          if (busy) return { ok: false, error: '剧情生成中，稍后再试' }
          if (idx < 0 || idx >= (curSession() ? curSession().messages.length : 0)) return { ok: false, error: '幕不存在' }
          await generateIllust(idx, true, false, customPrompt || null)
          const m = curSession() && curSession().messages[idx]
          return m && m.illust ? { ok: true } : { ok: false, error: (m && m.illustError) || '生成未完成' }
        }
      })
    } catch {}
    // 首次安装检测：未完成新手引导时，初始化配置向导（R72/R75） → 免责声明确认 → 教程指引
    const OB_KEY = 'sixworlds.onboard.v1'
    let onboarded = false
    try { onboarded = !!localStorage.getItem(OB_KEY) } catch {}
    if (!onboarded) {
      // R78：测试环境（SIXWORLDS_TEST=1）跳过首启引导流——与 splash 同待遇，
      // 否则 e2e 点击会被向导遮罩拦截（test-choices multi-* 教训）
      if (!(window.api && window.api.isTest)) {
        await showSetupWizard()
        await showDisclaimer()
        guideMask.dataset.afterOnboarding = 'kernel'
        openGuide()
      }
      try { localStorage.setItem(OB_KEY, '1') } catch {}
    }
  })()
})()

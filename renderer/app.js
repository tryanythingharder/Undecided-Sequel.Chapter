/* ======== 六面世界 · 极简桌面聊天窗 ======== */
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
  const ILLUST_STYLES = {
    'ln-original': 'Japanese light novel illustration, faithfully styled after the original Mushoku Tensei: Jobless Reincarnation novel illustrations by Shirotaka: clean refined lineart with delicate watercolor-like coloring, soft luminous lighting, gentle color gradients, subtle paper texture, expressive finely-drawn faces, meticulous medieval-fantasy costumes and magic details, warm slightly nostalgic palette, dreamy fantasy atmosphere, composed like a light-novel frontispiece, single key scene, high quality, no text, no watermark, no logo',
    anime: 'modern Japanese anime style light novel illustration, clean lineart, soft cel shading, harmonious colors, atmospheric composition, high quality, no text, no watermark',
    watercolor: 'soft watercolor illustration, delicate loose brushwork, pale elegant colors, visible paper grain, warm quiet mood, high quality, no text, no watermark',
    oil: 'classical oil painting illustration, rich impasto brushwork, dramatic chiaroscuro lighting, epic fantasy master style, high quality, no text, no watermark',
    ink: 'East Asian ink wash painting sumi-e illustration, elegant negative space, flowing expressive brush lines, muted monochrome palette, oriental aesthetics, high quality, no text, no watermark',
    realistic: 'cinematic photorealistic concept art illustration, film-grade lighting, rich detail, dramatic composition, high quality, no text, no watermark'
  }

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
  const sessionDrafts = new Map() // 每会话输入草稿（内存，切会话不丢）
  let sbFilter = '' // 侧栏全局搜索过滤词（跨所有世界线）

  // 内核开局界面元数据：内核文件可用 <!--KERNEL_META {json} KERNEL_META--> 自定义空态界面（标题/开场白/出身预设），未配置时回落内置默认
  function parseKernelMeta(text) {
    if (!text) return null
    const m = String(text).match(/<!--KERNEL_META\s*([\s\S]*?)\s*KERNEL_META-->/)
    if (!m) return null
    try {
      const o = JSON.parse(m[1])
      if (!o || typeof o !== 'object') return null
      const out = {}
      for (const k of ['title', 'tagline', 'startLabel', 'startPayload', 'quickLabel']) {
        if (typeof o[k] === 'string' && o[k].trim()) out[k] = o[k].trim()
      }
      if (Array.isArray(o.origins)) {
        out.origins = o.origins
          .filter((x) => x && typeof x.label === 'string' && typeof x.text === 'string' && x.label.trim() && x.text.trim())
          .map((x) => ({ label: x.label.trim(), text: x.text.trim() }))
          .slice(0, 8)
        if (!out.origins.length) delete out.origins
      }
      return out
    } catch (e) { return null } // 块损坏时静默回落默认界面
  }

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
  // R61/R62 存储失败可见性：localStorage 写失败（配额耗尽等）此前被 catch 静默吞掉——
  // UI 照常推进但重启即丢。三个保存入口共用一条节流提示（同一故障期只提醒一次，任一成功保存后复位）。
  let saveFailWarned = false
  function warnSaveFail(scope) {
    if (saveFailWarned) return
    saveFailWarned = true
    try { toast('⚠ 存储空间不足，' + scope + '未保存——请删除旧世界线或导出备份，否则重启后将丢失最新进度', 'err', 8000) } catch {}
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
  function saveStore() {
    cfg.currentSessionId = currentId
    cfg.currentWsId = currentWsId
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cfg))
      saveFailWarned = false
    } catch { warnSaveFail('应用设置') }
  }
  function loadSessions() {
    try {
      sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
      if (!Array.isArray(sessions)) sessions = []
      // 迁移 v1（无 createdAt）→ 补全
      for (const s of sessions) if (!s.createdAt) s.createdAt = s.updatedAt || Date.now()
    } catch { sessions = [] }
    // 迁移旧 key 的会话
    if (sessions.length === 0) {
      try {
        const old = JSON.parse(localStorage.getItem('sixworlds.sessions.v1') || '[]')
        if (Array.isArray(old) && old.length) {
          sessions = old.map((s) => Object.assign({ createdAt: s.updatedAt || Date.now() }, s))
        }
      } catch {}
    }
    // 迁移：无工作区归属的旧会话 → 归入第一个工作区（默认世界）
    if (sessions.some((s) => !s.ws)) {
      const homeWs = (workspaces[0] && workspaces[0].id) || currentWsId
      for (const s of sessions) if (!s.ws) s.ws = homeWs
      saveSessions()
    }
    // 自愈：归属的工作区已不存在（工作区列表曾丢失重建）的孤儿会话 → 重新归入第一个工作区
    // 没有这条，用户旧对话会被隔离逻辑永久隐藏
    const orphaned = sessions.filter((s) => s.ws && !workspaces.some((w) => w.id === s.ws))
    if (orphaned.length) {
      const homeWs = (workspaces[0] && workspaces[0].id) || currentWsId
      for (const s of orphaned) s.ws = homeWs
      saveSessions()
    }
  }
  function saveSessions() {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50)))
      saveFailWarned = false
    } catch { warnSaveFail('最新世界线进度') }
  }
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
          body: '「' + s.title + '」的 ' + s.messages.length + ' 条对话与 ' + illustCount + ' 张插图将被永久删除，无法恢复。',
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
          saveSessions()
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

  function renderWsMenu() {
    const listEl = $('ws-menu-list')
    listEl.innerHTML = ''
    for (const w of workspaces) {
      const it = document.createElement('div')
      it.className = 'ws-menu-item' + (w.id === currentWsId ? ' current' : '')
      const cnt = sessions.filter((s) => s.ws === w.id).length
      const name = document.createElement('span')
      name.textContent = w.name
      const meta = document.createElement('span')
      meta.className = 'ws-menu-meta'
      meta.textContent = (w.id === currentWsId ? '✓ ' : '') + cnt + ' 线' + (w.kernelPath ? ' · 专属内核' : '')
      it.appendChild(name); it.appendChild(meta)
      it.addEventListener('click', () => { closeWsMenu(); if (w.id !== currentWsId) switchWorkspace(w.id) })
      listEl.appendChild(it)
    }
    // 专属内核操作项（有覆盖时显示清除）
    const kernelItem = $('ws-kernel')
    const ws = curWs()
    if (ws && ws.kernelPath) {
      kernelItem.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg> 清除专属内核（恢复全局）'
      kernelItem.dataset.mode = 'clear'
    } else {
      kernelItem.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/><path d="M8 4.5 11.5 8 8 11.5 4.5 8Z"/></svg> 设置专属内核…'
      kernelItem.dataset.mode = 'set'
    }
  }

  function openWsMenu() {
    renderWsMenu()
    cancelHideAnim(wsMenu)
    wsMenu.classList.remove('hidden')
    // 立即挂一次性关闭监听（下一拍生效，避免当次点击立刻关掉）
    setTimeout(() => {
      document.addEventListener('click', wsOutsideClose)
      document.addEventListener('keydown', wsEscClose)
    }, 0)
  }
  function closeWsMenu() {
    hideWithAnim(wsMenu, () => wsMenu.classList.add('hidden'))
    document.removeEventListener('click', wsOutsideClose)
    document.removeEventListener('keydown', wsEscClose)
  }
  function wsOutsideClose(e) {
    if (!wsMenu.contains(e.target) && e.target !== wsBtn && !wsBtn.contains(e.target)) closeWsMenu()
  }
  function wsEscClose(e) { if (e.key === 'Escape') closeWsMenu() }

  async function switchWorkspace(id) {
    if (busy) { toast('请等当前回合结束', 'info'); return }
    const target = workspaces.find((w) => w.id === id)
    if (!target || id === currentWsId) return
    // 保存当前输入草稿与离开工作区的最近会话
    if (currentId) sessionDrafts.set(currentId, $('input').value)
    const oldWs = curWs()
    if (oldWs) oldWs.lastSessionId = currentId
    currentWsId = id
    // 恢复目标工作区：优先上次会话 → 首条会话 → 新建
    const wsS = wsSessions()
    if (wsS.length) {
      currentId = wsS.some((s) => s.id === target.lastSessionId) ? target.lastSessionId : wsS[0].id
    } else {
      currentId = null
    }
    saveWorkspaces()
    saveStore()
    $('input').value = currentId ? (sessionDrafts.get(currentId) || '') : ''
    fitInput()
    sbFilter = ''
    $('sb-search').value = ''
    renderWsBtn()
    renderSessionList()
    renderMessages()
    updateTitle()
    await loadKernel() // 工作区专属内核
  }

  async function newWorkspace() {
    const name = await promptDialog({
      title: '新建工作区',
      body: '工作区之间完全隔离：各自拥有独立的世界线、搜索与画廊。适合存放不同的世界内核 / 不同的故事。',
      value: '新世界 ' + (workspaces.length + 1),
      placeholder: '工作区名称',
      okText: '创建'
    })
    if (!name) return
    const w = { id: 'w' + Date.now().toString(36), name, createdAt: Date.now() }
    workspaces.push(w)
    saveWorkspaces()
    await switchWorkspace(w.id)
    newSession() // 空工作区给一条新世界线
    toast('工作区「' + name + '」已创建', 'ok')
  }

  async function renameWorkspace() {
    const ws = curWs()
    if (!ws) return
    const name = await promptDialog({ title: '重命名工作区', value: ws.name, okText: '重命名' })
    if (!name || name === ws.name) return
    ws.name = name
    saveWorkspaces()
    renderWsBtn()
    toast('已重命名', 'ok')
  }

  async function deleteWorkspace() {
    const ws = curWs()
    if (!ws) return
    if (busy) { toast('世界运转中，回合结束后再删除', 'info', 1800); return } // R57：生成中禁止删除工作区（防流式写入已删会话）
    if (workspaces.length <= 1) { toast('至少保留一个工作区', 'info'); return }
    const cnt = sessions.filter((s) => s.ws === ws.id).length
    const ok = await confirmDialog({
      title: '删除工作区「' + ws.name + '」？',
      body: '该工作区的 ' + cnt + ' 条世界线及其全部对话、插图将被永久删除，无法恢复。其他工作区不受影响。',
      danger: true,
      okText: '删除工作区'
    })
    if (!ok) return
    sessions = sessions.filter((s) => s.ws !== ws.id)
    workspaces = workspaces.filter((w) => w.id !== ws.id)
    // 删除后切到剩余第一个工作区
    currentWsId = workspaces[0].id
    const wsS = wsSessions()
    currentId = wsS.length ? wsS[0].id : null
    if (!currentId) newSession()
    saveSessions(); saveWorkspaces(); saveStore()
    renderWsBtn()
    renderSessionList()
    renderMessages()
    updateTitle()
    await loadKernel()
    toast('工作区已删除', 'info')
  }

  async function wsKernelAction() {
    const ws = curWs()
    if (!ws) return
    const mode = $('ws-kernel').dataset.mode
    if (mode === 'clear') {
      ws.kernelPath = ''
      saveWorkspaces()
      await loadKernel()
      renderWsBtn()
      toast('已恢复全局内核', 'ok')
      return
    }
    const r = await api.pickKernel()
    if (r && r.ok && r.path) {
      ws.kernelPath = r.path
      saveWorkspaces()
      await loadKernel()
      renderWsBtn()
      toast('工作区专属内核已加载', 'ok')
    }
  }

  wsBtn.addEventListener('click', () => {
    if (!wsMenu.classList.contains('hidden')) { closeWsMenu(); return }
    openWsMenu()
  })
  $('ws-new').addEventListener('click', () => { closeWsMenu(); newWorkspace() })
  $('ws-rename').addEventListener('click', () => { closeWsMenu(); renameWorkspace() })
  $('ws-del').addEventListener('click', () => { closeWsMenu(); deleteWorkspace() })
  $('ws-kernel').addEventListener('click', () => { closeWsMenu(); wsKernelAction() })

  // ============ IF 线分歧：从任意玩家行动节点另开世界线重新选择 ============
  function branchFrom(idx) {
    const s = curSession()
    if (!s) return
    if (busy) return // 生成中不可达（工具栏 !busy 才渲染，app.js:1217）；保留守卫仅作防御
    const act = String(s.messages[idx] ? s.messages[idx].content : '').slice(0, 30)
    confirmDialog({
      title: '开辟 IF 线？',
      body: '将以「' + s.title + '」为母线，在新世界线里复刻到这一步之前的历史，让你重新选择。你的原世界线保持不变。' + (act ? '（将撤销的行动：' + act + '…）' : ''),
      okText: '开辟 IF 线'
    }).then((ok) => {
      if (!ok) return
      localStorage.setItem('sixworlds.ifhint-seen.v1', '1') // 用过 IF → 一次性发现提示永不再现（R7）
      const now = Date.now()
      const ns = {
        id: 's' + now.toString(36),
        ws: s.ws, // IF 线留在母线的工作区（隔离）
        title: 'IF · ' + s.title,
        // 复刻到该行动之前（含呈现选项的那次世界回应，选项按钮会重新出现）
        messages: s.messages.slice(0, idx).map((m) => Object.assign({}, m)),
        updatedAt: now, createdAt: now,
        ifFrom: s.id
      }
      sessions.unshift(ns)
      currentId = ns.id
      saveStore()
      saveSessions()
      renderSessionList()
      renderMessages()
      updateTitle()
      toast('IF 线已开辟：历史复刻完毕，重新选择吧', 'ok', 2600)
    })
  }

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
  function applyTheme(theme) {
    cfg.theme = theme
    const root = document.documentElement
    root.setAttribute('data-theme', resolvedTheme())
    root.setAttribute('data-palette', PALETTES.some((p) => p.id === cfg.palette) ? cfg.palette : 'classic')
    // nativeTheme 负责系统标题栏/滚动条：system/dark/light 原样透传
    api.setTheme(theme === 'dark' || theme === 'light' ? theme : 'system')
  }
  // 跟随系统时，系统切换明暗要立即反映到界面
  darkMQ.addEventListener('change', () => { if (cfg.theme === 'system') applyTheme('system') })

  // 外观全量应用：调色板 / 展示字体 / 圆角 / 文字密度 / 布局 / 侧栏方向
  function applyAppearance() {
    const root = document.documentElement
    root.setAttribute('data-palette', PALETTES.some((p) => p.id === cfg.palette) ? cfg.palette : 'classic')
    root.setAttribute('data-theme', resolvedTheme())
    const fonts = ['sans', 'serif', 'mono', 'kai']
    root.setAttribute('data-font', fonts.includes(cfg.fontUI) ? cfg.fontUI : 'sans')
    const radii = ['none', 'small', 'standard', 'round']
    if ((cfg.radius || 'standard') !== 'standard') root.setAttribute('data-radius', radii.includes(cfg.radius) ? cfg.radius : 'standard')
    else root.removeAttribute('data-radius')
    const dens = ['compact', 'standard', 'relaxed']
    if ((cfg.density || 'standard') !== 'standard') root.setAttribute('data-density', dens.includes(cfg.density) ? cfg.density : 'standard')
    else root.removeAttribute('data-density')
    const layouts = ['sidebar', 'focus', 'immersive']
    document.body.classList.remove('layout-focus', 'layout-immersive')
    if (layouts.includes(cfg.layout) && cfg.layout !== 'sidebar') document.body.classList.add('layout-' + cfg.layout)
    document.body.classList.toggle('sb-right', cfg.sbSide === 'right')
  }

  // ---- 阅读体验：字号 / 栏宽（data 属性驱动 CSS 变量） ----
  function applyReading() {
    const root = document.documentElement
    const fs = { small: '13px', standard: '14.5px', large: '16px' }
    const rw = { narrow: '640px', standard: '720px', wide: '860px', xwide: '980px' }
    root.setAttribute('data-fontsize', cfg.fontSize || 'standard')
    root.style.setProperty('--read-w', rw[cfg.readWidth] || rw.standard)
    root.style.setProperty('--font-size', fs[cfg.fontSize] || fs.standard)
  }

  // ---- 置顶 ----
  function setPin(on) {
    cfg.pin = !!on
    $('btn-pin').classList.toggle('active', cfg.pin)
    api.pin(cfg.pin)
  }

  // ---- 内核 ----
  async function loadKernel() {
    // 工作区专属内核优先，其次全局配置，最后应用内置 kernel.md
    const ws = curWs()
    let r
    if (ws && ws.kernelPath) r = await api.readKernelPath(ws.kernelPath)
    else if (cfg.kernelPath) r = await api.readKernelPath(cfg.kernelPath)
    else r = await api.readKernel()
    if (r && r.ok) {
      kernel = r
      $('kernel-state').textContent = (ws && ws.kernelPath) ? '已加载·工作区' : '已加载'
      $('kernel-state').style.color = 'var(--ok)'
      return true
    }
    kernel = null
    $('kernel-state').textContent = '失败'
    $('kernel-state').style.color = 'var(--danger)'
    return false
  }

  // ---- 选项解析：兼容多种格式 ----
  // 选项解析：支持多种标记格式（兼容不同模型的输出习惯）
  // ①【A】xxx（全角括号） ②A. / A、 / A)（行内字母标记） ③1. / 1、（行首数字） ④①②③（圈号）
  // ⑤行首列表符号 - * • 与加粗 ** 前缀先剥离再匹配
  function parseChoices(text) {
    const out = []
    const seen = new Set()
    const push = (key, label) => {
      let l = (label || '').trim()
      // 剥离尾部残留的选项标记（如 "label A."）——必须带标点才剥，避免误伤正常结尾字母（如 "CANON-H"）
      l = l.replace(/\s*[A-H0-9]\s*[\.、\)]\s*$/, '')
      // 剥离残留的加粗星号（如 "**A.** label" 匹配后标签带 "**" 前缀）
      l = l.replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '').replace(/^\*\*/, '')
      l = l.trim()
      if (!l) return
      // 去重按 key+文案：叙事里出现多个【你需要决定】块（多组 A/B/C）时，
      // 只有完全相同的选项才会被合并——按钮不会再整组消失
      const dedupe = key + '|' + l
      if (seen.has(dedupe)) return
      seen.add(dedupe)
      out.push({ key, label: l })
    }

    let m
    // R78 容错：全角字母 Ａ-Ｈ → 半角（部分端点输出全角编号）；未知符号原样返回
    const normKey = (k) => {
      const c = k.charCodeAt(0)
      return (c >= 0xFF21 && c <= 0xFF28) ? String.fromCharCode(c - 0xFEE0) : k.toUpperCase()
    }
    const re1 = /【([A-HＡ-Ｈ])】([^【\n]*)/g
    while ((m = re1.exec(text))) { push(normKey(m[1]), m[2].replace(/\*/g, '')) }

    const lines = String(text).split('\n')
    const circ = '①②③④⑤⑥⑦⑧'
    for (const line of lines) {
      // R78：行首列表符剥离后清除全部残星号（此前只剥两端，`**A.** 文案` 这类解析失败导致无按钮）；
      // 分隔符补入全角句点 ．
      const clean = line.replace(/^\s*(?:[-*•·]\s*)+/, '').replace(/\*/g, '').trim()
      const re2 = /(?:^|\s)([A-HＡ-Ｈ])\s*[\.、\):：．]\s*/g
      const marks = []
      while ((m = re2.exec(clean))) {
        marks.push({ key: m[1], start: m.index + m[0].length })
      }
      if (marks.length === 0) {
        // 行首数字标记：1. / 1、 / 1) / 1:（仅行首，避免误吞正文数字）
        const nm = clean.match(/^([1-8１-８])\s*[\.、\):：．]\s*/)
        if (nm) {
          const digit = (nm[1].charCodeAt(0) >= 0xFF11) ? String.fromCharCode(nm[1].charCodeAt(0) - 0xFEE0) : nm[1]
          push(String.fromCharCode(64 + Number(digit)), clean.slice(nm[0].length)); continue
        }
        // 行首圈号：①②③…
        const cm = clean.match(/^([①-⑧])\s*/)
        if (cm) { push(String.fromCharCode(64 + circ.indexOf(cm[1]) + 1), clean.slice(cm[0].length)); continue }
      }
      for (let i = 0; i < marks.length; i++) {
        const label = i + 1 < marks.length ? clean.slice(marks[i].start, marks[i + 1].start).trim() : clean.slice(marks[i].start).trim()
        push(normKey(marks[i].key), label)
      }
    }
    out.sort((a, b) => a.key.localeCompare(b.key))
    return out
  }

  // ---- 兜底建议 v2（R83）：从原文提取「引号候选清单」——模型没按契约输出选项，
  // 但常以列表形式给出候选项（创建角色时的世界线设定、路线举例等）。
  // 规则：①同行内 ≥2 个「…」项即认作一组 ②否则需 ≥2 个列表行各含引号；
  // 散落在叙述里的单个专名引用绝不触发，防止把对白/书名误判成选项。
  function extractQuoteChoices(text) {
    const lines = String(text || '').split('\n')
    let inlineRun = 0 // 至少一行内并列 ≥2 个引号项（截图案例即此形态）
    let listRows = 0  // 以列表符开头的引号行数
    const flat = []
    for (const raw of lines) {
      const line = raw.trim()
      const items = (line.match(/「([^「」\n]{4,60})」/g) || []).map((s) => s.slice(1, -1).trim()).filter(Boolean)
      if (!items.length) continue
      flat.push(...items)
      if (items.length >= 2) inlineRun++
      if (/^[-*•·]/.test(line)) listRows++
    }
    if (flat.length < 2) return []
    if (!(inlineRun > 0 || listRows >= 2)) return []
    const seen = new Set()
    const out = []
    for (const it of flat) {
      if (!seen.has(it)) { seen.add(it); out.push(it) }
      if (out.length >= 6) break
    }
    return out
  }

  // ---- 插图 ----
  function illustReady() {
    return cfg.illustPreset !== 'off' && cfg.illustBaseUrl && cfg.illustModel &&
      (cfg.illustApiKey || cfg.apiKey)
  }

  function stylePrompt() {
    if (cfg.illustStyle === 'custom') return String(cfg.illustCustom || '').trim() || ILLUST_STYLES['ln-original']
    return ILLUST_STYLES[cfg.illustStyle] || ILLUST_STYLES['ln-original']
  }

  // 从叙事文本提炼图像提示词：去掉选项/状态等结构化内容，取叙事主体
  function buildIllustPrompt(text) {
    let t = String(text || '')
    t = t.replace(/【[^】*]*】[^【]*/g, ' ')
    t = t.replace(/【[^】]*】/g, ' ')
    t = t.replace(/\s+/g, ' ').trim()
    if (!t) t = String(text || '').slice(0, 300)
    if (t.length > 600) t = t.slice(0, 600)
    const style = stylePrompt()
    const prefix = (cfg.illustPrefixEnable && cfg.illustPrefix) ? String(cfg.illustPrefix) + ' ' : ''
    // 风格与前缀均为英文（降低噪点）；画面内容取叙事原文（图像模型可直接理解中日文场景描述）
    return prefix + style + '. Scene depicted: ' + t
  }

  // 为指定消息生成插图。idx 为当前会话 messages 下标。
  // regen: 已有插图时重新生成；isAuto: 自动触发（受最短长度门槛约束），手动点击不受限
  async function generateIllust(idx, regen, isAuto) {
    const s = curSession()
    if (!s) return
    const msg = s.messages[idx]
    if (!msg || msg.role !== 'assistant' || (msg.illust && !regen) || !illustReady()) return
    // 长度门槛：仅自动触发时，过短不生成（手动点击代表用户明确需要）
    if (isAuto && cfg.illustMinLen > 0 && String(msg.content).length < cfg.illustMinLen) return
    msg.illust = null
    msg.illustPending = true
    const renderPending = (attempt, retrying) => {
      renderMessages()
      const box = document.getElementById('illust-slot-' + idx)
      if (box) {
        box.className = 'illust-pending'
        const label = retrying ? ('正在重试绘制' + (attempt > 0 ? '（第 ' + (attempt + 1) + ' 次）' : '')) : '正在绘制这一幕的插图'
        box.innerHTML = '<span class="dots">' + label + '</span>'
      }
    }
    renderPending(0, false)

    // 单次尝试抽成函数，便于失败后重试一次
    const attemptOnce = async () => api.generateImage({
      baseUrl: cfg.illustBaseUrl,
      apiKey: cfg.illustApiKey || cfg.apiKey,
      model: cfg.illustModel,
      prompt: buildIllustPrompt(msg.content),
      size: cfg.illustSize,
      quality: cfg.illustQuality || 'default', // 清晰度：default 不传参，standard/high 透传给支持的端点
      negative: cfg.illustNegative,
      seedLock: cfg.illustSeedLock,
      seed: cfg.illustSeed,
      n: cfg.illustN
    })

    let r = await attemptOnce()
    // 失败自动重试一次（网络抖动 / 端点偶发 5xx 常见）
    if (!r || !r.ok) {
      renderPending(1, true)
      await new Promise((res) => setTimeout(res, 800))
      r = await attemptOnce()
    }
    msg.illustPending = false
    if (r && r.ok) {
      msg.illust = r.dataUrl
      msg.illustAt = Date.now()
      msg.illustError = null
      // 端点若返回计费（usage.cost / cost），累计到本线费用（右上角用量面板可见）
      const imgCost = Number(r.cost != null ? r.cost : ((r.usage && r.usage.cost) != null ? r.usage.cost : NaN))
      if (Number.isFinite(imgCost)) {
        s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
        s.tokens.cost = (s.tokens.cost || 0) + imgCost
      }
      saveSessions()
      renderMessages()
    } else {
      msg.illustError = (r && r.error) || '未知错误'
      saveSessions()
      renderMessages()
      const box2 = document.getElementById('illust-slot-' + idx)
      if (box2) {
        box2.className = 'illust-error'
        box2.textContent = '插图生成失败：' + msg.illustError
      }
      // 在错误框补重试按钮（renderMessages 分支也有一份）
      if (box2 && !busy) {
        const rb = document.createElement('button')
        rb.className = 'retry-btn'
        rb.textContent = '↻ 重试绘制'
        rb.addEventListener('click', () => {
          msg.illustError = null
          generateIllust(idx, true)
        })
        box2.appendChild(document.createElement('br'))
        box2.appendChild(rb)
      }
      toast('插图生成失败：' + msg.illustError, 'err')
    }
  }

  // ---- 大图查看（支持多图浏览：← → 键 / 箭头按钮切换，Esc 关闭） ----
  // list: 可选的图片数组（画廊或当前会话的全部插图）；dataUrl: 当前图（在 list 中定位）
  function viewIllust(dataUrl, list) {
    let mask = document.getElementById('lightbox')
    if (mask) mask.remove()
    const imgs = Array.isArray(list) && list.length ? list.filter(Boolean) : [dataUrl]
    let idx = Math.max(0, imgs.indexOf(dataUrl))
    const hasNav = imgs.length > 1

    mask = document.createElement('div')
    mask.id = 'lightbox'
    mask.className = 'lightbox'
    const img = document.createElement('img')
    img.src = imgs[idx]
    img.alt = '场景插图'
    mask.appendChild(img)

    // 计数器（多图时显示）
    const counter = document.createElement('div')
    counter.className = 'lightbox-counter'
    const syncCounter = () => { counter.textContent = (idx + 1) + ' / ' + imgs.length }
    syncCounter()
    if (hasNav) mask.appendChild(counter)

    // 左右切换按钮（多图时）
    const prevBtn = document.createElement('button')
    prevBtn.className = 'lightbox-nav lightbox-prev'
    prevBtn.innerHTML = '<svg class="ic ic-lg" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>'
    prevBtn.title = '上一张（←）'
    const nextBtn = document.createElement('button')
    nextBtn.className = 'lightbox-nav lightbox-next'
    nextBtn.innerHTML = '<svg class="ic ic-lg" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>'
    nextBtn.title = '下一张（→）'

    // 关闭按钮（右上角）
    const closeBtn = document.createElement('button')
    closeBtn.className = 'lightbox-close'
    closeBtn.innerHTML = '<svg class="ic ic-lg" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
    closeBtn.title = '关闭（Esc）'
    mask.appendChild(closeBtn)
    // 保存按钮
    const saveBtn = document.createElement('button')
    saveBtn.className = 'lightbox-save'
    saveBtn.textContent = '保存'
    saveBtn.title = '保存这张插图'
    mask.appendChild(saveBtn)

    const step = (dir) => {
      if (!hasNav) return
      idx = (idx + dir + imgs.length) % imgs.length
      img.style.opacity = '0'
      setTimeout(() => { img.src = imgs[idx]; img.style.opacity = '1' }, 90)
      syncCounter()
    }
    if (hasNav) {
      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); step(-1) })
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); step(1) })
      mask.appendChild(prevBtn)
      mask.appendChild(nextBtn)
    }

    const close = () => {
      mask.classList.add('closing')
      setTimeout(() => mask.remove(), 160)
      document.removeEventListener('keydown', onKey)
    }
    closeBtn.addEventListener('click', close)
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadIllust(imgs[idx], -1) })
    // 点击任意位置关闭（按钮已阻止冒泡）
    mask.addEventListener('click', close)
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    document.addEventListener('keydown', onKey)
    document.body.appendChild(mask)
  }

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

  // 智能滚动：用户位于底部附近时跟随，向上翻阅时不打扰
  let wasNearBottom = true
  function autoScroll() {
    wasNearBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120
    if (wasNearBottom) msgEl.scrollTop = msgEl.scrollHeight
    const scrollBtn = document.getElementById('scroll-to-bottom')
    if (scrollBtn) scrollBtn.classList.toggle('hidden', wasNearBottom)
  }

  function renderMessages() {
    // 记住重绘前的滚动位置：贴底则重绘后仍贴底，否则保持原位（不打扰翻阅历史的用户）
    const prevScroll = msgEl.scrollTop
    wasNearBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 120
    const s = curSession()
    const messages = s ? s.messages : []
    msgEl.innerHTML = ''
    let lastAssistantIdx = -1
    // R71：预计算最后一条 assistant——其选项会提取为按钮，正文渲染时跳过选项行避免重复
    messages.forEach((m, i) => { if (m.role === 'assistant') lastAssistantIdx = i })

    messages.forEach((m, i) => {
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
        if (!busy && i === messages.length - 1) {
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
      // 搜索态：对命中片段高亮（HTML 已转义，安全）
      else if (searchQuery && searchMatches.some((x) => x.msgIdx === i)) {
        body.classList.add('plain')
        const marked = markMessage(m.content, searchQuery)
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
          const allIllusts = messages.filter((x) => x.illust).map((x) => x.illust)
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
      // Pending 徽标（条款 30）：明确区分「正常完成 / 未落账」，不悄悄假装已保存
      if (m.role === 'assistant' && m.pending) {
        const chip = document.createElement('button')
        chip.className = 'msg-pending-chip'
        chip.textContent = '⚠ 状态未落账 · 点击补录'
        chip.title = '这一回合的结构化状态没有正式提交（模型缺状态块或校验未过）。点击立即尝试补录。'
        chip.addEventListener('click', () => resolvePendingFlow(typeof m.pending === 'string' ? m.pending : null))
        div.appendChild(chip)
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
    if (messages.length === 0 && !busy) {
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
      const choices = parseChoices(messages[lastAssistantIdx].content)
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
    const lastMsg = lastAssistantIdx >= 0 ? messages[lastAssistantIdx] : null
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
  function buildProgressRail(messages) {
    const rail = $('progress-rail')
    const nodesEl = $('rail-nodes')
    const fill = $('rail-fill')
    if (!rail || !nodesEl) return
    nodesEl.innerHTML = ''
    // 世界回应节点（错误消息除外），最多保留最近 50 个
    const beats = []
    messages.forEach((m, i) => {
      if (m.role === 'assistant' && !String(m.content || '').startsWith('⚠️')) beats.push({ i, m })
    })
    rail.classList.toggle('rail-empty', beats.length === 0)
    const shown = beats.slice(-50)
    shown.forEach((b, bi) => {
      const n = document.createElement('div')
      n.className = 'rail-node' + (b.m.illust ? ' has-img' : '') + (bi === shown.length - 1 ? ' latest' : '')
      n.title = '第 ' + (beats.length - shown.length + bi + 1) + ' 幕 · 点击跳转'
      // R33 键盘可达：进度条节点可聚焦跳转
      n.tabIndex = 0
      n.setAttribute('role', 'button')
      n.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.click() }
      })
      // 悬停小窗：插图或场景摘要
      n.addEventListener('mouseenter', () => showRailPop(n, b.m))
      n.addEventListener('mouseleave', hideRailPop)
      n.addEventListener('click', () => {
        const el = msgEl.querySelector('[data-mi="' + b.i + '"]')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      nodesEl.appendChild(n)
    })
    updateRailFill()
    tryShowRailHint()
  }
  // R15：进度条一次性发现提示——首次可见且 ≥2 节点时浮现（✕ 或 8s 自消）；渲染与收起两处触发
  function tryShowRailHint() {
    const rail = $('progress-rail')
    const nodesEl2 = $('rail-nodes')
    if (!rail || !nodesEl2 || localStorage.getItem('sixworlds.railhint-seen.v1')) return
    if (nodesEl2.childElementCount < 2) return
    if (rail.getBoundingClientRect().width === 0) return
    localStorage.setItem('sixworlds.railhint-seen.v1', '1')
    const rh = document.createElement('div')
    rh.className = 'rail-hint'
    const rht = document.createElement('span')
    rht.textContent = '故事进度条：悬停节点预览该幕，点击跳转到那一幕'
    const rx = document.createElement('button')
    rx.className = 'rail-hint-x'; rx.title = '知道了'; rx.innerHTML = '<svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
    rx.addEventListener('click', () => rh.remove())
    rh.appendChild(rht); rh.appendChild(rx)
    rail.appendChild(rh)
    setTimeout(() => { if (rh.parentNode) rh.remove() }, 8000)
  }
  // 进度填充 = 当前滚动位置在整条故事中的比例
  function updateRailFill() {
    const fill = $('rail-fill')
    const rail = $('progress-rail')
    if (!fill || !rail) return
    const frac = msgEl.scrollHeight > msgEl.clientHeight
      ? msgEl.scrollTop / (msgEl.scrollHeight - msgEl.clientHeight)
      : 1
    fill.style.height = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%'
  }
  // 悬停小窗内容：插图优先，否则场景行/摘要
  function railSnippet(m) {
    const t = String(m.content || '')
    const sc = t.match(/【([^\]】]*历[^\]】]*｜[^\]】]*)】/)
    if (sc) return sc[1]
    return t.replace(/\s+/g, ' ').trim().slice(0, 60) || '（这一幕）'
  }
  function showRailPop(node, m) {
    const pop = $('rail-pop')
    if (!pop) return
    pop.innerHTML = ''
    if (m.illust) {
      const img = document.createElement('img')
      img.src = m.illust
      img.alt = '这一幕的插图'
      pop.appendChild(img)
    }
    const txt = document.createElement('div')
    txt.className = 'rail-pop-text'
    txt.textContent = railSnippet(m)
    pop.appendChild(txt)
    const chat = document.querySelector('.chat')
    const nr = node.getBoundingClientRect()
    const cr = chat.getBoundingClientRect()
    cancelHideAnim(pop)
    pop.classList.remove('hidden')
    // 小窗贴在节点右侧
    pop.style.top = Math.max(8, Math.min(nr.top - cr.top - 20, cr.height - 160)) + 'px'
  }
  function hideRailPop() {
    const pop = $('rail-pop')
    if (pop) hideWithAnim(pop, () => pop.classList.add('hidden'))
  }

  // 流式期间只更新最后一条流式消息的文本（不整页重绘）
  // 性能：增量按帧合并（requestAnimationFrame），且用 appendData 只「追加」新字——
  // 不再每帧把整段已生成文本重写进 DOM（旧法每帧成本随篇幅线性增长，长回复越写越卡）
  let streamRaf = 0
  let streamRenderedLen = 0
  // 状态引擎：流式期间实时隐藏 STATE_PATCH 协议块（含未完整的标记前缀）
  const STREAM_MARK = '<<<STATE_PATCH>>>'
  function streamVisibleLen() {
    const i = streaming.indexOf(STREAM_MARK)
    if (i !== -1) return i
    const hold = Math.min(streaming.length, STREAM_MARK.length - 1)
    for (let k = hold; k > 0; k--) {
      if (STREAM_MARK.startsWith(streaming.slice(streaming.length - k))) return streaming.length - k
    }
    return streaming.length
  }
  function flushStream() {
    streamRaf = 0
    if (!busy) return
    const shown = streaming.slice(0, streamVisibleLen())
    if (shown.length === streamRenderedLen) return
    const bodies = msgEl.querySelectorAll('.msg.assistant .msg-body')
    const last = bodies[bodies.length - 1]
    if (!last) return
    const firstNode = last.firstChild
    if (firstNode && firstNode.nodeType === Node.TEXT_NODE && firstNode.data.length === streamRenderedLen && shown.length > streamRenderedLen) {
      // 常规路径：文本节点内容恰好等于已渲染前缀 → 追加增量即可
      firstNode.appendData(shown.slice(streamRenderedLen))
    } else {
      // 冷启动/外部重绘后：整体重建一次（含光标），之后回到追加路径
      last.textContent = ''
      last.appendChild(document.createTextNode(shown))
      const dot = document.createElement('span')
      dot.className = 'stream-dot'
      dot.textContent = ' ▍'
      last.appendChild(dot)
    }
    streamRenderedLen = shown.length
    autoScroll()
  }
  function appendStream(piece) {
    streaming += piece
    if (!streamRaf) streamRaf = requestAnimationFrame(flushStream)
  }

  // ============ 消息搜索（Ctrl+F 在当前世界线内搜索） ============
  // 思路：维护 query 与命中索引，renderMessages 在渲染 body 时对命中片段包裹 <mark>
  let searchQuery = ''
  let searchMatches = [] // [{ msgIdx, count }]
  let searchActive = -1   // 全局命中序号（0-based）
  const searchBar = $('search-bar')
  const searchInput = $('search-input')

  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

  // 计算一条消息中命中次数；同时返回包好 mark 的 HTML（不命中则 null，避免无谓重排）
  function markMessage(content, query) {
    if (!query) return null
    const re = new RegExp(escapeRegExp(query), 'gi')
    let count = 0
    let out = ''
    let last = 0
    let m
    while ((m = re.exec(content)) !== null) {
      count++
      out += escapeHtml(content.slice(last, m.index))
      out += '<mark data-i="' + (count - 1) + '">' + escapeHtml(m[0]) + '</mark>'
      last = m.index + m[0].length
      if (m.index === re.lastIndex) re.lastIndex++ // 防止零宽死循环
    }
    out += escapeHtml(content.slice(last))
    return { html: out, count }
  }

  // 搜索框打开/关闭
  function openSearch() {
    if (!searchBar.hidden) { searchInput.focus(); searchInput.select(); return }
    cancelHideAnim(searchBar)
    searchBar.hidden = false
    searchInput.value = searchQuery
    searchInput.focus()
    runSearch(searchQuery)
  }
  function closeSearch() {
    if (searchBar.hidden) return
    hideWithAnim(searchBar, () => { searchBar.hidden = true })
    searchQuery = ''
    searchMatches = []
    searchActive = -1
    renderMessages()
    $('input').focus()
  }

  // 执行搜索：计算命中、更新计数、跳到第一个命中
  function runSearch(q) {
    searchQuery = String(q || '')
    searchMatches = []
    searchActive = -1
    const s = curSession()
    if (searchQuery && s) {
      const re = new RegExp(escapeRegExp(searchQuery), 'gi')
      for (let i = 0; i < s.messages.length; i++) {
        const c = String(s.messages[i].content || '')
        const cnt = (c.match(re) || []).length
        if (cnt) searchMatches.push({ msgIdx: i, count: cnt })
      }
    }
    let total = 0
    for (const x of searchMatches) total += x.count
    $('search-count').textContent = total === 0 ? '0/0' : '1/' + total
    $('search-prev').disabled = total < 2
    $('search-next').disabled = total < 2
    searchActive = total > 0 ? 0 : -1
    renderMessages()
    scrollToActiveMatch()
  }

  // 跳到当前命中：把对应 mark 标 active 并滚入视野
  function scrollToActiveMatch() {
    if (searchActive < 0) return
    let target = searchActive
    for (const x of searchMatches) {
      if (target < x.count) {
        const msg = msgEl.querySelector('.msg:nth-child(' + (x.msgIdx + 1) + ')')
        if (msg) {
          const marks = msg.querySelectorAll('mark')
          marks.forEach((mk, i) => mk.classList.toggle('active', i === target))
          const el = marks[target]
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        return
      }
      target -= x.count
    }
  }

  function searchStep(dir) {
    let total = 0
    for (const x of searchMatches) total += x.count
    if (total === 0) return
    searchActive = (searchActive + dir + total) % total
    $('search-count').textContent = (searchActive + 1) + '/' + total
    scrollToActiveMatch()
  }

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
  const storySess = new Map() // storyId -> sessionId（重启应用 = 新 Session；故事记忆跨 Session 持久）
  let engineProtocolText = null // 输出协议说明书（每次运行取一次）
  // 条款 17：State Patch 缺失时的补录请求词——只要求补结构化状态，严禁重写剧情（条款 25）
  const PATCH_RETRY_PROMPT = [
    '上一轮叙事已经生成。当前系统缺少合法 State Patch。',
    '请仅根据已经生成的叙事和当前 State，输出对应的结构化 State Patch（按此前给你的状态记录协议）。',
    '不要重新生成剧情。不要修改、扩写或复述已经生成的叙事。回复只包含状态块本身。',
    '如果重新审视后确认这一回合确实没有任何状态变化，只输出 <<<NO_STATE_CHANGE>>>。'
  ].join('\n')
  async function enginePrep(s, playerInput) {
    try {
      const ws = curWs()
      const kernelId = (ws && ws.kernelPath) || cfg.kernelPath || 'builtin:kernel.md'
      const en = await api.engineEnsure({ storyId: s.id, title: s.title, kernelId, kernelText: kernel ? kernel.text : '' })
      if (!en || !en.ok) return null
      let sessionId = storySess.get(s.id)
      if (!sessionId) {
        sessionId = 'SES-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
        storySess.set(s.id, sessionId)
      }
      const cx = await api.engineContext({ storyId: s.id, playerInput: String(playerInput || '') })
      if (!cx || !cx.ok || !cx.data) return null
      if (engineProtocolText == null) {
        const pr = await api.engineProtocol()
        engineProtocolText = pr && pr.ok ? pr.data : ''
      }
      return {
        storyId: s.id,
        sessionId,
        // 已有结构化状态时才注入状态块（新故事第一回合无历史可注入，payload 与旧版一致）
        block: cx.data.overview && cx.data.overview.engine_turn > 0 ? cx.data.block : '',
        engineTurn: cx.data.overview ? cx.data.overview.engine_turn : 0,
        retrievedIds: cx.data.retrieved_ids || [],
        contextSize: cx.data.context_size || 0,
        playerInput: String(playerInput || '')
      }
    } catch { return null } // 引擎任何故障都不阻断叙事主流程（降级为纯对话）
  }

  async function send(text, opts) {
    opts = opts || {}
    const value = String(text || '').trim()
    if (busy) return
    if (engineBusy) { toast('上一回合状态正在补录，请稍候', 'info'); return }
    if (!value && !opts.regen) return
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      toast('请先在设置中填写 API 地址、密钥与模型。', 'err')
      openSettings()
      return
    }
    if (!kernel) {
      toast('内核未加载，无法开始。', 'err')
      openSettings()
      return
    }

    const s = curSession() || newSession()
    // 发送即清空输入框（不等回复），草稿同步清除
    if (!opts.regen) {
      $('input').value = ''
      fitInput()
      sessionDrafts.delete(s.id)
    }
    if (opts.regen) {
      // 移除末尾的 assistant 消息（若有），保留其前的 user 作为上下文重发
      if (s.messages.length && s.messages[s.messages.length - 1].role === 'assistant') {
        const discarded = s.messages.pop()
        // 状态引擎：被抛弃的叙事留痕（永不静默覆盖，只增不删）
        try { api.engineDiscard({ storyId: s.id, excerpt: String(discarded.content || '').slice(0, 400), reason: 'regen' }) } catch {}
      }
    } else {
      s.messages.push({ role: 'user', content: value, at: Date.now() })
    }
    busy = true
    streaming = ''
    streamRenderedLen = 0
    currentReqId = 'r' + Date.now().toString(36)
    busyIsland = showBusyIsland() // R76：忙碌灵动岛（独立于 .toast，避免干扰 e2e toast 选择器）
    setSendButtonState(true)
    renderMessages()
    updateTitle()

    // ---- 状态引擎：确保故事存在 + 检索长期记忆（任何故障静默降级为纯对话） ----
    const engineMeta = opts.regen ? await enginePrep(s, value || (s.messages.filter((m) => m.role === 'user').pop() || {}).content || '') : await enginePrep(s, value)

    const ctxN = Math.min(64, Math.max(2, Number(cfg.ctxCount) || 24))
    const history = s.messages.slice(-ctxN).map((m) => ({ role: m.role, content: m.content }))
    const msgs = [{ role: 'system', content: kernel.text }]
    if (engineMeta && engineMeta.block) msgs.push({ role: 'system', content: engineMeta.block })
    if (engineMeta && engineProtocolText) msgs.push({ role: 'system', content: engineProtocolText })
    msgs.push(...history)
    const payload = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      // 思考程度（提供商支持 reasoning_effort 时生效，不支持自动回退默认）
      thinkLevel: cfg.thinkLevel || 'default',
      messages: msgs,
      reqId: currentReqId
    }

    const r = await api.sendChat(payload)
    const wasAborted = r && r.ok && r.aborted
    busy = false
    if (busyIsland) { busyIsland.close(); busyIsland = null } // R76：收纳忙碌灵动岛
    if (streamRaf) { cancelAnimationFrame(streamRaf); streamRaf = 0 }
    streaming = ''
    streamRenderedLen = 0
    currentReqId = null
    setSendButtonState(false)

    if (r && r.ok && r.content) {
      // ---- 状态引擎：提取 STATE_PATCH → 校验 → 提交；缺失/损坏自动补丁重试 → Pending（条款 15-22/25/28/30） ----
      let narrative = r.content
      let pendingId = null
      let pendingKept = false
      if (engineMeta) {
        const commitBase = { storyId: engineMeta.storyId, sessionId: engineMeta.sessionId, playerInput: engineMeta.playerInput, intent: engineMeta.playerInput.slice(0, 200), model: cfg.model, retrievedIds: engineMeta.retrievedIds, contextSize: engineMeta.contextSize }
        try {
          const cm = await api.engineCommit(Object.assign({}, commitBase, { raw: r.content, retryCount: 0 }))
          if (cm && cm.data) {
            if (cm.data.narrative) narrative = cm.data.narrative
            pendingId = cm.data.pending_id || null
            // 条款 17：PATCH_MISSING / PATCH_INVALID → 自动一次静默重试：只补状态块，不重写剧情（条款 25）
            if (!cm.data.committed && (cm.data.patch_status === 'PATCH_MISSING' || cm.data.patch_status === 'PATCH_INVALID')) {
              engineBusy = true // 补录期间禁止并发发送/重生成（不复位流式 UI，避免与 e2e/用户时序互踩）
              try {
                const retryMsgs = msgs.concat([
                  { role: 'assistant', content: narrative },
                  { role: 'user', content: PATCH_RETRY_PROMPT }
                ])
                const rr = await api.sendChat(Object.assign({}, payload, { messages: retryMsgs, reqId: 'rp' + Date.now().toString(36), silent: true }))
                if (rr && rr.ok && rr.content) {
                  const cm2 = await api.engineCommit(Object.assign({}, commitBase, { raw: rr.content, pendingId, retryCount: 1 }))
                  if (cm2 && cm2.data && cm2.data.committed) {
                    toast('状态已补录（模型首轮缺状态块）', 'ok', 3200)
                  } else {
                    pendingKept = !!(cm2 && cm2.data && cm2.data.pending_id) || !!pendingId
                  }
                } else pendingKept = !!pendingId
              } catch { pendingKept = !!pendingId }
              engineBusy = false
            } else if (!cm.data.committed && pendingId) {
              // PATCH_CONFLICT / COMMIT_FAILED：确定性失败不重试，直接进入 Pending（条款 18/28）
              pendingKept = true
            }
            if (cm.data.errors && cm.data.errors.length && cm.data.committed !== true && !pendingKept) {
              toast('状态记录未提交：' + cm.data.errors[0].message, 'err', 6000)
            }
          } else if (cm && cm.data && cm.data.narrative) {
            narrative = cm.data.narrative
          }
        } catch { /* 引擎故障不阻断叙事 */ }
      }
      if (pendingKept) toast('本回合状态未正式提交，已记录待补录（重启不丢失）', 'err', 6000)
      s.messages.push({ role: 'assistant', content: narrative, at: Date.now(), pending: pendingKept ? (pendingId || true) : undefined })
      // 首条叙事确定会话标题
      if (s.title === '新世界线') {
        s.title = deriveTitle(narrative)
        renderSessionList()
      }
      if (wasAborted) toast('已停止生成（保留已生成内容）', 'info')
      // 后台时通知：生成完成（点通知回到窗口）
      api.notify({ title: '六面世界 · 世界回应已就绪', body: (s.title || '') + ' 的新一幕已生成' + (r.partial ? '（网络中断，内容不完整）' : '') }).catch(() => {})
    } else if (r && r.ok && r.aborted) {
      // 没有收到任何内容也取消了
      toast('已停止生成', 'info')
    } else {
      const errMsg = (r && r.error) || '未知错误'
      s.messages.push({ role: 'assistant', content: '⚠️ [[世界引擎报错]]\n' + errMsg })
      toast('世界引擎报错：' + errMsg, 'err')
      api.notify({ title: '六面世界 · 生成失败', body: String(errMsg).slice(0, 120) }).catch(() => {})
    }
    // 累计本轮 token 用量到当前世界线（主进程从 usage 字段解析）
    if (r && r.ok && r.usage) {
      const u = r.usage
      s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
      s.tokens.prompt += Number(u.prompt_tokens) || 0
      s.tokens.completion += Number(u.completion_tokens) || 0
      s.tokens.total += Number(u.total_tokens) || 0
      // 部分端点在 usage 里带回费用（如有则累计，右上角用量面板展示）
      const c = Number(u.cost != null ? u.cost : (r.cost != null ? r.cost : NaN))
      if (Number.isFinite(c)) s.tokens.cost = (s.tokens.cost || 0) + c
      saveSessions()
    }
    const keepN = Math.min(400, Math.max(8, Number(cfg.keepCount) || 80))
    if (s.messages.length > keepN) s.messages = s.messages.slice(s.messages.length - keepN)
    touchSession()
    renderMessages()
    updateTitle()

    // 自动插图：为刚生成的叙事生成
    const last = s.messages.length - 1
    if (r && r.ok && r.content && cfg.illustAuto && illustReady() && last >= 0) {
      generateIllust(last, false, true)
    }
  }

  // 中途取消当前生成
  function stopGeneration() {
    if (!busy || !currentReqId) return
    api.abortChat(currentReqId)
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
        if (label) label.textContent = n + ' 条回合状态未落账（剧情已展示，但结构化状态未正式提交）'
      } else {
        el.classList.add('hidden')
      }
    } catch { el.classList.add('hidden') }
  }

  async function resolvePendingFlow(pendingId) {
    const s = curSession()
    if (!s || busy || engineBusy) return
    let targets = []
    try {
      const lr = await api.enginePendings({ storyId: s.id })
      const list = (lr && lr.ok && Array.isArray(lr.data)) ? lr.data : []
      targets = list.filter((x) => !pendingId || x.pending_id === pendingId)
    } catch { return }
    if (!targets.length) { toast('没有待补录的回合', 'info', 2200); refreshPendingBanner(); return }
    busy = true
    let okN = 0
    try {
      if (engineProtocolText == null) { const pr = await api.engineProtocol(); engineProtocolText = pr && pr.ok ? pr.data : '' }
      for (const pc of targets) {
        try {
          const prep = await enginePrep(s, pc.player_input || '')
          const msgs2 = [{ role: 'system', content: kernel.text }]
          if (prep && prep.block) msgs2.push({ role: 'system', content: prep.block })
          if (engineProtocolText) msgs2.push({ role: 'system', content: engineProtocolText })
          msgs2.push({ role: 'user', content: pc.player_input || '（玩家行动）' })
          msgs2.push({ role: 'assistant', content: pc.narrative || '' })
          msgs2.push({ role: 'user', content: PATCH_RETRY_PROMPT })
          const rr = await api.sendChat({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, thinkLevel: cfg.thinkLevel || 'default', messages: msgs2, reqId: 'rp' + Date.now().toString(36), silent: true })
          if (rr && rr.ok && rr.content) {
            const rs = await api.engineResolvePending({ storyId: s.id, pendingId: pc.pending_id, raw: rr.content })
            if (rs && rs.ok && rs.data && rs.data.resolved) okN++
          }
        } catch { /* 单条失败不影响其余补录 */ }
      }
    } finally {
      busy = false
      toast(okN === targets.length ? ('已补录 ' + okN + ' 条回合状态') : ('补录完成 ' + okN + '/' + targets.length + '（其余保持待补录）'), okN ? 'ok' : 'err', 5000)
      refreshPendingBanner()
      renderMessages()
    }
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
        chipI.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/><path d="M8 4.5 11.5 8 8 11.5 4.5 8Z"/></svg> ' + cfg.illustModel + (cfg.illustAuto ? ' · 自动' : '')
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
  function toast(msg, kind, dur) {
    kind = kind || 'info' // ok | err | info
    let wrap = document.querySelector('.toast-wrap')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'toast-wrap'
      // R34 屏幕阅读器：toast 作为状态通告区（err 用 alert 强打断）
      wrap.setAttribute('aria-live', 'polite')
      document.body.appendChild(wrap)
    }
    const el = document.createElement('div')
    el.className = 'toast ' + kind
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status')
    const icon = document.createElement('span')
    icon.className = 'toast-icon'
    icon.innerHTML = kind === 'ok'
      ? '<svg class="ic" viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg>'
      : (kind === 'err'
        ? '<svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
        : '<svg class="ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/></svg>')
    const m = document.createElement('span')
    m.className = 'toast-msg'
    m.textContent = msg
    el.appendChild(icon); el.appendChild(m)
    wrap.appendChild(el)
    const t = setTimeout(() => remove(), dur || 4200)
    function remove() {
      clearTimeout(t)
      el.classList.add('leaving')
      setTimeout(() => { el.remove() }, 220)
    }
    el.addEventListener('click', remove)
    return { close: remove }
  }

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
  function openGallery() {
    buildGallerySessionSelect()
    renderGallery()
    cancelHideAnim($('gallery'))
    cancelHideAnim($('gallery-mask'))
    $('gallery').hidden = false
  }
  function closeGallery() {
    closeModalAnim($('gallery'), $('gallery-mask'), () => { $('gallery').hidden = true })
  }
  function buildGallerySessionSelect() {
    const sel = $('gallery-session')
    // 工作区隔离：画廊只列当前工作区的会话
    const wsS = wsSessions()
    // 默认选中当前会话；若 select 已有合法值则沿用（用于切换会话后重建）
    const prev = sel && sel.value ? sel.value : null
    const cur = (prev && wsS.some((s) => s.id === prev)) ? prev : (currentId || (wsS[0] && wsS[0].id) || '')
    sel.innerHTML = ''
    for (const s of wsS) {
      const opt = document.createElement('option')
      opt.value = s.id
      const cnt = s.messages.filter((m) => m.illust).length
      opt.textContent = s.title + '（' + cnt + ' 张）'
      sel.appendChild(opt)
    }
    sel.value = wsS.some((s) => s.id === cur) ? cur : (wsS[0] && wsS[0].id) || ''
  }
  function renderGallery() {
    const sel = $('gallery-session')
    const sid = sel ? sel.value : null
    const s = sessions.find((x) => x.id === sid) || null
    const body = $('gallery-body')
    body.innerHTML = ''
    const imgs = s ? s.messages.map((m, i) => ({ m, i })).filter((x) => x.m.illust) : []
    $('gallery-count').textContent = s ? (s.title + ' · ' + imgs.length + ' 张插图') : '无会话'
    if (!imgs.length) {
      const e = document.createElement('div')
      e.className = 'gallery-empty'
      e.textContent = s ? '这条世界线还没有插图。在对话中点击「插图」按钮，或开启自动插图。' : '暂无会话。'
      body.appendChild(e)
      return
    }
    imgs.forEach(({ m, i }) => {
      const card = document.createElement('div')
      card.className = 'gallery-card'
      const img = document.createElement('img')
      img.src = m.illust
      img.alt = '插图'
      img.title = '点击查看大图'
      // 骨架屏：加载前显示占位动画，加载完成后淡入；异步解码避免大图卡住主线程（R81 画廊打开后短暂不可点的问题）
      img.loading = 'lazy'
      img.decoding = 'async'
      img.addEventListener('load', () => img.classList.add('loaded'))
      // 传入画廊全部插图，Lightbox 中可 ← → 切换
      const allIllusts = imgs.map((x) => x.m.illust)
      img.addEventListener('click', () => viewIllust(m.illust, allIllusts))
      // R33b 键盘可达：Enter/Space 打开大图
      img.tabIndex = 0
      img.setAttribute('role', 'button')
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.click() }
      })
      // 叙事摘要：该插图所属回合的叙事片段（hover 卡片可见；外层浮层 + 内层截断，见 styles.css R85）
      const excerptWrap = document.createElement('div')
      excerptWrap.className = 'gallery-card-excerpt'
      const excerpt = document.createElement('div')
      excerpt.className = 'gallery-card-excerpt-text'
      excerpt.textContent = summarize(m.content)
      excerpt.title = excerpt.textContent
      excerptWrap.appendChild(excerpt)
      const meta = document.createElement('div')
      meta.className = 'gallery-card-meta'
      const time = m.illustAt ? new Date(m.illustAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ('第' + (i + 1) + '条')
      meta.textContent = time
      const media = document.createElement('div')
      media.className = 'gallery-media'
      // 悬浮操作组：原型 K 的进卡显形按钮（重绘/存/删）
      const actions = document.createElement('div')
      actions.className = 'hover-actions'
      const rb = document.createElement('button')
      rb.textContent = '↻'
      rb.title = '重新生成这张插图（重绘）'
      rb.addEventListener('click', () => {
        if (busy) { toast('请等当前回合结束', 'info'); return }
        // 切到对应会话再重绘
        if (s.id !== currentId) {
          currentId = s.id
          saveStore()
          renderSessionList()
          renderMessages()
          updateTitle()
          buildGallerySessionSelect()
        }
        closeGallery()
        generateIllust(i, true)
      })
      const sb = document.createElement('button')
      sb.textContent = '↓'
      sb.title = '保存这张插图到本地'
      sb.addEventListener('click', () => {
        downloadIllust(m.illust, i)
      })
      const db = document.createElement('button')
      db.textContent = '×'
      db.className = 'del'
      db.title = '删除这张插图（不影响对话文字）'
      db.addEventListener('click', () => {
        confirmDialog({
          title: '删除这张插图？',
          body: '将从画廊与对话中移除该插图，对话文字保留。',
          danger: true,
          okText: '删除'
        }).then((ok) => {
          if (!ok) return
          m.illust = null
          m.illustAt = null
          m.illustError = null
          saveSessions()
          renderGallery()
          if (s.id === currentId) renderMessages()
          toast('已删除插图', 'info')
        })
      })
      actions.appendChild(rb); actions.appendChild(sb); actions.appendChild(db)
      media.appendChild(img); media.appendChild(excerptWrap); media.appendChild(actions)
      card.appendChild(media); card.appendChild(meta)
      body.appendChild(card)
    })
  }

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
    const turns = s.messages.map((m) => {
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
      } else if (!choicesAutoFolded && !choicesFoldUser) {
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
    closeModalAnim($('guide'), guideMask, () => { guideMask.hidden = true; $('guide').hidden = true })
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
      '<span class="insp-meta">' + escapeHtml(o.story_id) + ' · 引擎回合 <b>' + o.engine_turn + '</b> · 内核 ' + escapeHtml(String((o.kernel && o.kernel.version) || '?')).slice(0, 24) + '</span></div>',
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
      ].concat(list.map((sp) => '<div class="insp-row"><span class="insp-grow"><span class="insp-id">' + escapeHtml(sp.snapshot_id) + '</span>' + escapeHtml(sp.label) + ' · 第' + sp.turn + '回合</span><button class="insp-btn" data-act="restore" data-id="' + escapeHtml(sp.snapshot_id) + '">恢复</button></div>')).join('') : '<div class="insp-empty">尚无快照。在「总览」或此页创建。</div>'
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
  const pendingBannerEl = document.getElementById('pending-banner')
  if (pendingBannerEl) {
    document.getElementById('btn-pending-resolve').addEventListener('click', () => resolvePendingFlow(null))
    document.getElementById('btn-pending-dismiss').addEventListener('click', () => pendingBannerEl.classList.add('hidden'))
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
  // 主题按钮：弹层选择预设调色板 + 明暗模式（不再只是浅/暗二连击）
  const themePopEl = $('theme-pop')
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
      sw.className = 'swatch' + (cfg.palette === p.id ? ' on' : '')
      sw.title = p.name
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.background = 'linear-gradient(135deg, ' + p.dot[0] + ' 50%, ' + p.dot[1] + ' 50%)'
      const nm = document.createElement('span')
      nm.textContent = p.name
      sw.appendChild(dot); sw.appendChild(nm)
      sw.addEventListener('click', () => {
        cfg.palette = p.id
        const linked = applyPalettePresetLink(p.id)
        applyAppearance()
        saveStore()
        const payload = { palette: cfg.palette }
        if (linked) { payload.fontUI = cfg.fontUI; payload.density = cfg.density }
        try { api.mainChanged(payload) } catch { /* noop */ }
        buildThemePop()
      })
      grid.appendChild(sw)
    }
    document.querySelectorAll('.theme-mode').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === (cfg.theme || 'system'))
    })
  }
  function toggleThemePop() {
    if (!themePopEl) return
    if (themePopEl.classList.contains('hidden')) { buildThemePop(); cancelHideAnim(themePopEl); themePopEl.classList.remove('hidden') }
    else hideWithAnim(themePopEl, () => themePopEl.classList.add('hidden'))
  }
  document.querySelectorAll('.theme-mode').forEach((b) => {
    b.addEventListener('click', () => {
      applyTheme(b.dataset.mode)
      saveStore()
      try { api.mainChanged({ theme: cfg.theme }) } catch { /* noop */ }
      buildThemePop()
    })
  })
  $('btn-theme').addEventListener('click', (e) => { e.stopPropagation(); toggleThemePop() })
  // R78：主题弹层右上角关闭钮（与画廊/帮助一致）
  $('btn-theme-close').addEventListener('click', () => {
    hideWithAnim(themePopEl, () => themePopEl.classList.add('hidden'))
  })
  // 点击弹层外部：关闭主题弹层 / 模型用量面板
  document.addEventListener('click', (e) => {
    if (themePopEl && !themePopEl.classList.contains('hidden') &&
      !themePopEl.contains(e.target) && e.target !== $('btn-theme') && !$('btn-theme').contains(e.target)) {
      hideWithAnim(themePopEl, () => themePopEl.classList.add('hidden'))
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

  // 全局快捷键：Esc 关闭画廊/帮助面板 · Ctrl+, 设置 · Ctrl+G 画廊 · Ctrl+/ 帮助-快捷键页 · Ctrl+F 搜索
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('gallery').hidden) closeGallery()
      else if (!$('inspector-mask').hidden) closeInspector()
      else if (!$('guide-mask').hidden) closeGuide()
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
  const WIZ_PRESETS = {
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    moonshot: { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0711-preview' },
    zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    qwen: { name: '通义 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    custom: { name: '自定义', baseUrl: '', model: '' },
  }
  const WIZ_IMG_PRESETS = {
    off: { name: '暂不启用', baseUrl: '', model: '' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
    zhipu: { name: '智谱 CogView', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors' },
    dashscope: { name: '通义万相', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'wanx2.1-t2i-turbo' },
    custom: { name: '自定义', baseUrl: '', model: '' },
  }
  function showSetupWizard() {
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm wizard'
      box.style.width = '640px'
      box.style.display = 'flex'
      box.style.flexDirection = 'column'
      // 欢迎区（R75 → Finalize Design：居中 Emblem 列式头部）
      const head = document.createElement('div')
      head.className = 'wizard-head'
      head.innerHTML = '<span class="wizard-logo">六</span>' +
        '<span class="wizard-welcome">欢迎使用六面世界</span>' +
        '<span class="wizard-welcome-sub">三步完成初始配置，所有选项之后都能在设置中调整</span>'
      // 步骤条独立于 body：切步时只重绘状态，不参与内容动画
      const stepsEl = document.createElement('div')
      stepsEl.className = 'wizard-steps'
      const body = document.createElement('div')
      body.className = 'wizard-body'
      const pane = document.createElement('div')
      pane.className = 'wizard-pane'
      body.appendChild(pane)
      const foot = document.createElement('div')
      foot.className = 'confirm-foot wizard-foot'
      const prog = document.createElement('span')
      prog.className = 'wizard-progress'
      const back = document.createElement('button')
      back.className = 'cancel'
      const next = document.createElement('button')
      next.className = 'primary'
      foot.appendChild(prog); foot.appendChild(back); foot.appendChild(next)
      box.appendChild(head); box.appendChild(stepsEl); box.appendChild(body); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)

      const gv = (cls) => { const el = pane.querySelector(cls); return el ? el.value.trim() : null }
      const st = { theme: 'dark', palette: cfg.palette || 'classic', preset: 'deepseek', imgPreset: 'off' }
      const wizModels = { text: [], img: [] } // 拉取到的模型列表
      const origTheme = cfg.theme // 实时预览用：跳过时还原
      const origPalette = cfg.palette // 配色预览同理：跳过时还原
      let prevStep = 0 // 切步动画方向

      // 模型选择控件渲染：有列表 → 下拉；无 → 手填输入框（均可切换）
      function modelControl(kind) {
        const isText = kind === 'text'
        const list = isText ? wizModels.text : wizModels.img
        const valCls = isText ? '.wizard-model' : '.wizard-imgmodel'
        const cur = gv(valCls) || ''
        if (list.length) {
          let h = '<select class="' + (isText ? 'wizard-model' : 'wizard-imgmodel') + ' wizard-model-select">'
          if (!list.includes(cur) && cur) h += '<option value="' + cur + '" selected>' + cur + '（手填）</option>'
          for (const m of list) h += '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + m + '</option>'
          h += '</select>'
          return h
        }
        return '<input type="text" class="' + (isText ? 'wizard-model' : 'wizard-imgmodel') + '" value="' + cur + '" placeholder="' + (isText ? '点右侧按钮拉取，或手填' : '点右侧按钮拉取，或手填') + '">'
      }

      // 迷你界面模拟预览（R75）：CSS 画的侧栏 + 正文小窗，代替纯色块
      const themeCard = (v, name, desc) =>
        '<button class="wizard-theme-opt' + (st.theme === v ? ' sel' : '') + '" data-v="' + v + '">' +
        '<span class="wizard-theme-check">✓</span>' +
        '<span class="wizard-theme-mock ' + v + '"><span class="mock-side"><i></i><i></i><i></i></span>' +
        '<span class="mock-main"><b></b><i></i><i></i><i class="short"></i></span></span>' +
        '<span class="wizard-theme-name">' + name + '</span>' +
        '<span class="wizard-theme-desc">' + desc + '</span></button>'

      function render() {
        const steps = ['外观', '对话模型', '插图模型']
        const step = +mask.dataset.step || 0
        const seg = []
        steps.forEach((s, i) => {
          seg.push('<span class="wizard-step' + (i === step ? ' active' : '') + (i < step ? ' done' : '') + '">' +
            '<span class="wizard-step-dot">' + (i < step ? '✓' : (i + 1)) + '</span>' +
            '<span class="wizard-step-label">' + s + '</span></span>')
          if (i < steps.length - 1) seg.push('<span class="wizard-step-line' + (i < step ? ' passed' : '') + '"></span>')
        })
        stepsEl.innerHTML = seg.join('')
        let h = ''
        if (step === 0) {
          h += '<div class="wizard-title">选择外观</div><p class="wizard-sub">先选明暗基调，再挑一套界面配色——点击卡片立即预览效果</p>'
          h += '<div class="wizard-look">'
          h += '<div class="wizard-theme-row">'
          h += themeCard('light', '纯白', '明亮清爽，适合白天')
          h += themeCard('dark', '纯黑', '暗色沉浸，适合夜晚')
          h += themeCard('system', '跟随系统', '自动随系统切换')
          h += '</div>'
          // 配色预设（R76d）：与设置-外观/标题栏主题弹窗同一组调色板（原型：panel-2 圆角盒）
          h += '<div class="wizard-palette-box">'
          h += '<div class="wizard-palette-label">配色方案</div>'
          h += '<div class="wizard-palette-row">'
          for (const p of PALETTES) {
            h += '<button class="wizard-palette-opt' + (st.palette === p.id ? ' sel' : '') + '" data-pal="' + p.id + '" title="' + p.name + '">' +
              '<span class="wizard-palette-dot" style="background:linear-gradient(135deg,' + p.dot[0] + ' 50%,' + p.dot[1] + ' 50%)"></span>' +
              '<span class="wizard-palette-name">' + p.name + '</span></button>'
          }
          h += '</div>'
          h += '</div>'
          h += '<div class="wizard-hint">随时可以在右上角主题按钮或设置中更改</div>'
        } else if (step === 1) {
          const p = WIZ_PRESETS[st.preset] || WIZ_PRESETS.custom
          const cb = st.baseUrl !== undefined ? st.baseUrl : p.baseUrl
          const ck = st.apiKey !== undefined ? st.apiKey : ''
          // R75b：表单步内容整体垂直居中（与第 1 步视觉逻辑统一，消除底部大片留白）
          h += '<div class="wizard-form">'
          h += '<div class="wizard-title">配置对话模型</div><p class="wizard-sub">驱动故事生成的文本模型——填好地址与密钥后，可直接拉取可用模型列表</p>'
          h += '<div class="wizard-preset-row cols-4">'
          for (const k in WIZ_PRESETS) h += '<button class="wizard-preset-opt' + (k === st.preset ? ' sel' : '') + '" data-p="'+ k + '"><span class="wizard-preset-dot">' + (k === 'custom' ? '＋' : WIZ_PRESETS[k].name[0]) + '</span>' + WIZ_PRESETS[k].name + '</button>'
          h += '</div>'
          h += '<div class="wizard-field"><label>API 地址</label><input class="wizard-baseurl" type="text" value="' + cb + '" placeholder="https://api.deepseek.com"></div>'
          h += '<div class="wizard-field"><label>API Key</label><input class="wizard-apikey" type="password" value="' + ck + '" placeholder="sk-…（在提供商控制台获取）"></div>'
          h += '<div class="wizard-field"><label>模型</label><div class="wizard-fetch-row">' + modelControl('text')
          h += '<button class="wizard-fetch-btn" data-fetch="text">拉取模型</button></div></div>'
          h += '<div class="wizard-status" data-status="text"></div>'
          h += '</div>'
        } else {
          const p = WIZ_IMG_PRESETS[st.imgPreset] || WIZ_IMG_PRESETS.off
          const cb = st.imgBaseUrl !== undefined ? st.imgBaseUrl : p.baseUrl
          const ck = st.imgApiKey !== undefined ? st.imgApiKey : ''
          h += '<div class="wizard-form">'
          h += '<div class="wizard-title">配置插图模型</div><p class="wizard-sub">为故事生成插图的图像模型——可跳过，不影响文字游玩；Key 留空则复用对话模型的</p>'
          h += '<div class="wizard-preset-row">'
          for (const k in WIZ_IMG_PRESETS) h += '<button class="wizard-preset-opt' + (k === st.imgPreset ? ' sel' : '') + '" data-ip="'+ k + '"><span class="wizard-preset-dot">' + (k === 'custom' ? '＋' : k === 'off' ? '—' : WIZ_IMG_PRESETS[k].name[0]) + '</span>' + WIZ_IMG_PRESETS[k].name + '</button>'
          h += '</div>'
          if (st.imgPreset === 'off') {
            // 空状态（R75）：不启用时给明确的视觉反馈，不再留白
            h += '<div class="wizard-empty"><span class="wizard-empty-icon"></span>' +
              '<span class="wizard-empty-title">暂不启用插图</span>' +
              '<span class="wizard-empty-desc">不影响文字游玩；之后可以随时在设置中开启并配置图像模型</span></div>'
          } else {
            h += '<div class="wizard-field"><label>API 地址</label><input class="wizard-imgbaseurl" type="text" value="' + cb + '" placeholder="https://api.openai.com/v1"></div>'
            h += '<div class="wizard-field"><label>API Key</label><input class="wizard-imgapikey" type="password" value="' + ck + '" placeholder="留空则复用对话模型的 Key"></div>'
            h += '<div class="wizard-field"><label>模型</label><div class="wizard-fetch-row">' + modelControl('img')
            h += '<button class="wizard-fetch-btn" data-fetch="img">拉取模型</button></div></div>'
          }
          h += '<div class="wizard-status" data-status="img"></div>'
          h += '</div>'
        }
        pane.innerHTML = h
        // 切步动画（R75）：方向感知，前进从右滑入、后退从左滑入
        pane.classList.remove('anim-fwd', 'anim-back')
        void pane.offsetWidth
        pane.classList.add(step >= prevStep ? 'anim-fwd' : 'anim-back')
        prevStep = step
        // 实时预览：点击主题卡立即切换整个界面明暗（跳过时在 back 处理中还原）
        pane.querySelectorAll('.wizard-theme-opt').forEach((b) => b.addEventListener('click', () => { st.theme = b.dataset.v; applyTheme(b.dataset.v); render() }))
        // 实时预览：点击配色卡立即切换整套调色板（只动 DOM 属性不写 cfg；完成时落库、跳过时还原）
        pane.querySelectorAll('.wizard-palette-opt').forEach((b) => b.addEventListener('click', () => {
          st.palette = b.dataset.pal
          document.documentElement.setAttribute('data-palette', st.palette)
          render()
        }))
        pane.querySelectorAll('.wizard-preset-opt[data-p]').forEach((b) => b.addEventListener('click', () => {
          cacheStep(1)
          st.preset = b.dataset.p
          const p = WIZ_PRESETS[b.dataset.p]
          st.baseUrl = p.baseUrl; st.model = p.model
          wizModels.text = [] // 换预设清空已拉取列表
          render()
        }))
        pane.querySelectorAll('.wizard-preset-opt[data-ip]').forEach((b) => b.addEventListener('click', () => {
          cacheStep(2)
          st.imgPreset = b.dataset.ip
          const p = WIZ_IMG_PRESETS[b.dataset.ip]
          st.imgBaseUrl = p.baseUrl; st.imgModel = p.model
          wizModels.img = []
          render()
        }))
        // 拉取模型按钮
        const fb = pane.querySelector('.wizard-fetch-btn')
        if (fb) fb.addEventListener('click', async () => {
          const kind = fb.dataset.fetch
          const isText = kind === 'text'
          const baseUrl = isText ? gv('.wizard-baseurl') : gv('.wizard-imgbaseurl')
          let apiKey = isText ? gv('.wizard-apikey') : (gv('.wizard-imgapikey') || gv('.wizard-apikey'))
          const status = pane.querySelector('[data-status="' + kind + '"]')
          if (!baseUrl || !apiKey) { if (status) { status.textContent = '请先填写 API 地址与密钥'; status.className = 'wizard-status err' } return }
          fb.disabled = true
          const old = fb.textContent
          fb.textContent = '获取中…'
          if (status) { status.textContent = ''; status.className = 'wizard-status' }
          const r = await api.testEndpoint({ baseUrl, apiKey })
          fb.disabled = false
          fb.textContent = old
          if (r && r.ok && r.models && r.models.length) {
            if (isText) wizModels.text = r.models; else wizModels.img = r.models
            // render 重建 DOM 前先缓存当前表单值（否则地址/密钥被预设默认覆盖）
            cacheStep(isText ? 1 : 2)
            if (status) { status.textContent = '已获取 ' + r.models.length + ' 个模型'; status.className = 'wizard-status ok' }
            render()
            // render 重建了 status 元素，重新标记
            const status2 = pane.querySelector('[data-status="' + kind + '"]')
            if (status2) { status2.textContent = '已获取 ' + r.models.length + ' 个模型'; status2.className = 'wizard-status ok' }
          } else {
            const msg = (r && r.error) || '端点未返回模型列表，可手填模型名'
            if (status) { status.textContent = msg; status.className = 'wizard-status err' }
          }
        })
        const s = +mask.dataset.step || 0
        prog.textContent = '第 ' + (s + 1) + ' / 3 步'
        back.textContent = s === 0 ? '跳过' : '上一步'
        next.innerHTML = s === 2 ? '完成' : '下一步<span class="btn-arrow">→</span>'
      }
      // 离开某步前缓存表单值（render 重建 DOM）
      const cacheStep = (step) => {
        if (step === 1) {
          const v = gv('.wizard-baseurl'); if (v !== null) st.baseUrl = v
          const k = gv('.wizard-apikey'); if (k !== null) st.apiKey = k
          const m = gv('.wizard-model'); if (m !== null) st.model = m
        } else if (step === 2) {
          const v = gv('.wizard-imgbaseurl'); if (v !== null) st.imgBaseUrl = v
          const k = gv('.wizard-imgapikey'); if (k !== null) st.imgApiKey = k
          const m = gv('.wizard-imgmodel'); if (m !== null) st.imgModel = m
        }
      }
      function close() {
        if (mask.dataset.leaving === '1') return
        mask.dataset.leaving = '1'
        document.removeEventListener('keydown', onKey)
        box.classList.add('closing'); mask.classList.add('closing')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          document.removeEventListener('keydown', onKey)
          mask.remove(); resolve(true)
        }
        box.addEventListener('animationend', (ev) => { if (ev.target === box) finish() })
        setTimeout(finish, 260)
      }
      // 键盘（R75）：Enter 前进 / Esc 退出；焦点在弹窗内按钮/下拉上时交还原生行为，
      // 焦点在弹窗外（如聊天输入框）时仍由向导接管
      function onKey(e) {
        if (mask.dataset.leaving === '1') return
        const ae = document.activeElement
        const inMask = !!(ae && mask.contains(ae))
        if (e.key === 'Escape') { e.preventDefault(); back.click(); return }
        if (e.key !== 'Enter') return
        if (inMask && (ae.tagName === 'BUTTON' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return
        e.preventDefault()
        next.click()
      }
      document.addEventListener('keydown', onKey)
      next.addEventListener('click', () => {
        const step = +mask.dataset.step || 0
        if (step < 2) { cacheStep(step); mask.dataset.step = String(step + 1); render(); return }
        cacheStep(2)
        const b = gv('.wizard-baseurl') || st.baseUrl || '', k = gv('.wizard-apikey') || st.apiKey || '', m = gv('.wizard-model') || st.model || ''
        const ib = gv('.wizard-imgbaseurl') || st.imgBaseUrl || '', ik = gv('.wizard-imgapikey') || st.imgApiKey || '', im = gv('.wizard-imgmodel') || st.imgModel || ''
        const palOk = PALETTES.some((p) => p.id === st.palette)
        if (palOk) cfg.palette = st.palette // 配色方案落库（先赋值，applyTheme 按新值写 data-palette）
        applyTheme(st.theme)
        if (palOk) applyPalettePresetLink(cfg.palette) // 与标题栏主题弹窗一致：部分配色联动推荐外观
        if (b) cfg.baseUrl = b
        if (k) cfg.apiKey = k
        if (m) cfg.model = m
        if (st.preset && WIZ_PRESETS[st.preset]) cfg.preset = st.preset
        cfg.illustPreset = st.imgPreset
        if (st.imgPreset !== 'off') {
          if (ib) cfg.illustBaseUrl = ib
          if (ik) cfg.illustApiKey = ik
          if (im) cfg.illustModel = im
        }
        saveStore()
        try { api.mainChanged({ theme: cfg.theme }) } catch { /* noop */ }
        refreshModelSelect()
        toast('配置完成，祝你转生愉快', 'ok')
        close()
      })
      back.addEventListener('click', () => {
        const step = +mask.dataset.step || 0
        if (step === 0) {
          if (origTheme !== st.theme) applyTheme(origTheme) // 跳过：还原实时预览切换的主题
          if (origPalette !== st.palette) { cfg.palette = origPalette; document.documentElement.setAttribute('data-palette', origPalette) } // 跳过：还原配色预览
          close(); return // 跳过：保留默认，稍后设置
        }
        cacheStep(step)
        mask.dataset.step = String(step - 1); render()
      })
      mask.dataset.step = '0'
      render()
    })
  }
  // ============ 免责声明（首次安装须确认） ============
  function showDisclaimer() {    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm disclaimer'
      box.style.width = '520px'
      const head = document.createElement('div')
      head.className = 'confirm-head disclaimer-head'
      const emblem = document.createElement('span')
      emblem.className = 'disclaimer-emblem'
      emblem.textContent = '六'
      const headTxt = document.createElement('span')
      headTxt.className = 'disclaimer-head-txt'
      const title = document.createElement('div')
      title.className = 'confirm-title'
      title.textContent = '请先阅读免责声明'
      const sub = document.createElement('div')
      sub.className = 'disclaimer-sub'
      sub.textContent = '首次启动 · 阅读以下条款后继续'
      headTxt.appendChild(title); headTxt.appendChild(sub)
      head.appendChild(emblem); head.appendChild(headTxt)
      const body = document.createElement('div')
      body.className = 'disclaimer-body'
      // 条款列表：mono 编号（§01–05）+ 文本，对齐原型 F
      const items = [
        ['§01', '<strong>本软件是纯粹的本地工具。</strong>六面世界只是一个开源的桌面壳（界面 + 本地存储），不内置、不分发、也不代理任何 AI 服务。所有故事文本与插图均由<strong>你自己在设置中配置的第三方模型提供商</strong>（DeepSeek / OpenAI / 智谱等）生成并直接返回给你。'],
        ['§02', '<strong>不涉及侵权分发。</strong>本软件不提供、不托管任何受版权保护的小说原文、插画、音频或视频。世界内核（kernel.md）为玩家自备的同人创作设定文本；生成内容的权利与合规性由所用提供商的服务条款约束。'],
        ['§03', '<strong>生成内容免责。</strong>AI 生成的内容可能存在不准确、不适宜或与原作不符之处，仅供个人娱乐，请勿用于商业用途或对外发布为官方内容。'],
        ['§04', '<strong>费用自负。</strong>调用第三方 API 产生的 token 费用与图像生成费用由你的账户承担，请自行关注用量面板与提供商账单。'],
        ['§05', '<strong>内容安全。</strong>请遵守当地法律法规与提供商的使用政策；未满 18 周岁请在监护人指导下使用。']
      ]
      body.innerHTML = items.map((it) =>
        '<div class="d-item"><span class="d-no">' + it[0] + '</span><p>' + it[1] + '</p></div>'
      ).join('') +
        '<p class="d-final">继续使用即表示你已阅读并理解以上条款，<strong>相关风险与责任由使用者自行承担</strong>。</p>'
      const check = document.createElement('label')
      check.className = 'disclaimer-check'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      const ct = document.createElement('span')
      ct.textContent = '我已阅读并同意以上声明，理解风险由我自行承担'
      check.appendChild(cb); check.appendChild(ct)
      const foot = document.createElement('div')
      foot.className = 'confirm-foot disclaimer-foot'
      const ok = document.createElement('button')
      ok.className = 'primary'
      ok.textContent = '同意并继续'
      ok.disabled = true
      foot.appendChild(ok)
      box.appendChild(head); box.appendChild(body); box.appendChild(check); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)
      cb.addEventListener('change', () => { ok.disabled = !cb.checked })
      ok.addEventListener('click', () => {
        if (mask.dataset.leaving === '1') return
        mask.dataset.leaving = '1'
        box.classList.add('closing'); mask.classList.add('closing')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          mask.remove(); resolve(true)
        }
        box.addEventListener('animationend', (ev) => { if (ev.target === box) finish() })
        setTimeout(finish, 260)
      })
      setTimeout(() => { body.scrollTop = 0; cb.focus() }, 50)
    })
  }

  // ============ R76 入场动画（Mineradio 式启动页） ============
  // 五层舞台 + 字标序列由纯 CSS 驱动；此处只负责：粒子尘埃、点击/键盘进入、12s 兜底、离场双层时序。
  // e2e 环境（SIXWORLDS_TEST=1）直接移除，不阻塞自动化；设置 sixworlds.splash-preview 可强制预览。
  ;(function splashBoot() {
    const el = document.getElementById('splash')
    if (!el) return
    const preview = (() => { try { return !!localStorage.getItem('sixworlds.splash-preview') } catch { return false } })()
    if ((window.api && window.api.isTest) && !preview) { el.remove(); return }
    // R85：用户在设置里勾选「跳过开场动画」→ 移除启动页（窗口 show:false + ready-to-show 才显示，此处在首帧前执行，无闪现）
    const skip = (() => { try { return !!JSON.parse(localStorage.getItem(STORE_KEY) || '{}').skipSplash } catch { return false } })()
    if (skip && !preview) { el.remove(); return }

    // 粒子尘埃：约 70 颗光尘缓慢上浮（72% 琥珀 / 其余青与珊瑚），出界回收
    const cv = document.getElementById('splash-dust')
    if (cv && cv.getContext) {
      const ctx = cv.getContext('2d')
      const resize = () => { cv.width = innerWidth; cv.height = innerHeight }
      resize(); addEventListener('resize', resize)
      const dust = []
      for (let i = 0; i < 70; i++) {
        dust.push({
          x: Math.random(), y: Math.random(),
          r: .6 + Math.random() * 1.6,
          vx: (Math.random() - .5) * .00016,
          vy: -.00006 - Math.random() * .00022,
          a: .08 + Math.random() * .3,
          tint: Math.random() < .72 ? '217,154,82' : (Math.random() < .5 ? '122,215,194' : '255,83,103')
        })
      }
      ;(function tick() {
        if (!el.isConnected) return // 离场移除后停帧
        ctx.clearRect(0, 0, cv.width, cv.height)
        for (const d of dust) {
          d.x += d.vx; d.y += d.vy
          if (d.y < -.02) { d.y = 1.02; d.x = Math.random() }
          if (d.x < -.02) d.x = 1.02; else if (d.x > 1.02) d.x = -.02
          ctx.beginPath()
          ctx.arc(d.x * cv.width, d.y * cv.height, d.r, 0, 7)
          ctx.fillStyle = 'rgba(' + d.tint + ',' + d.a + ')'
          ctx.fill()
        }
        requestAnimationFrame(tick)
      })()
    }

    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.classList.add('exiting') // 粒子层先行淡出（CSS 双层时序），整层 620ms 后移除
      document.removeEventListener('keydown', onKey)
      setTimeout(() => el.remove(), 660)
    }
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); finish() }
    }
    // 主词定格（约 2.6s）后开放点击进入；「点击进入」提示 4.6s 才出现（CSS 动画时序）
    setTimeout(() => { el.classList.add('ready'); el.addEventListener('click', finish) }, 2600)
    document.addEventListener('keydown', onKey)
    setTimeout(finish, 12000) // 兜底：12s 未点击自动进入
  })()

  // ---- 启动 ----
  ;(async function boot() {
    applyTheme(cfg.theme)
    applyAppearance()
    applyReading()
    setPin(cfg.pin)
    loadWorkspaces() // 必须先于 loadSessions（旧会话迁移需要工作区存在）
    loadSessions()
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
        openGuide()
      }
      try { localStorage.setItem(OB_KEY, '1') } catch {}
    }
  })()
})()

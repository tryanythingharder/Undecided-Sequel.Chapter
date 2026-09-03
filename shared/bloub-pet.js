/*
 * 六面世界 · 世界之灵桌宠（shared/bloub-pet.js，经典 / 原型工作台双方案共用）
 *
 * 常驻在内容画布两侧空白边距里的活体机器人（引擎：shared/bloub.js + shared/bloub-mount.js）：
 *   - 平时呼吸、眨眼、视线跟着鼠标走；偶尔自己换个表情
 *   - 生成叙事时化作 thinking 三点；回合完成 notify 亮徽标；报错 alert 惊叹号
 *   - 点击：戳一戳（随机表情）+ 帮助气泡（使用指南 + 问答输入框）
 *   - 拖拽：可搬到任意边距/角落，位置记忆（localStorage），窗口变化自动夹回视口
 *   - 窄窗口（边距 < 140px）自动隐藏，不打扰内容区
 *
 * ---- 本地小模型（离线自由对话；主进程 main.cjs PetModel 段 + preload 暴露）----
 * 气泡底部有「接入本地小模型 · 约 400MB」一键按钮 → 二次确认（只说大小，不说型号）
 * → 主进程下载（hf-mirror，.part + 原子改名）→ 自动加载（node-llama-cpp 常驻会话）→ 就绪。
 * 就绪后问答路由：应用类问题仍走 RULES 规则库（0.5B 对应用事实易幻觉，规则才是精准的），
 * 规则未命中的闲聊走 pet:chat 流式（'pet:chat-delta' 增量 → 打字机逐字上屏 + 表情联动）。
 */
(function () {
  'use strict'

  var SIZE = 104                 // 机器人显示尺寸（px）
  var MIN_MARGIN = 140          // 边距低于此宽度隐藏（内容列 760px 居中后的两侧空白）
  var POS_KEY = 'sixworlds.pet.pos.v1'
  var TIP_KEY = 'sixworlds.pet.tip.v1'

  // ---- 使用指南（气泡开场轮换小贴士） ----
  var TIPS = [
    'Enter 发送 · Shift+Enter 换行；Ctrl+F 搜当前世界线，Ctrl+G 开画廊。',
    '顶栏主题按钮里：7 套调色板 × 明暗三态，字体圆角密度都能调。',
    '想从某一步换条路重走？悬停你发过的行动，点「IF 分歧」另开世界线。',
    '设置里可以导出进度包，用 Android App 导入就能接着玩。',
    '换内核世界：底部「内核」进工作台，内置的、自己写的、AI 设计的都行。',
    '生成太久或失败？错误消息上有「重试这一回合」，半截文本也不会丢。'
  ]

  // ---- 规则问答：帮助用户上手、解决常见问题（本地小模型接入前的 phase-1 实现） ----
  var RULES = [
    { k: ['怎么开始', '怎么玩', '新手', '开始游戏'], a: '开一条新世界线（侧栏「新世界线」），点「开始游戏」或选一个出身预设。AI 会推进剧情并在下方给 A/B/C 选项按钮；也可以在输入框里自由描述你的行动。' },
    { k: ['快捷键', '快捷', '热键'], a: 'Ctrl+F 搜索当前世界线 · Ctrl+G 打开画廊 · Ctrl+, 打开设置 · Ctrl+= / Ctrl+- / Ctrl+0 缩放字号 · Esc 关闭弹层。' },
    { k: ['主题', '外观', '调色', '换肤', '颜色'], a: '点顶栏的主题按钮：7 套调色板（经典琥珀 / 羊皮纸 / 林间 / 紫晶 / 海渊 / 蔷薇 / 高对比）× 明暗三态，字体、圆角、密度、阅读列宽、布局都能在里面调，即时预览。' },
    { k: ['未落账', '补录', '状态块', '落账'], a: '「状态未落账」表示该回合模型没按协议输出结构化状态块（剧情已正常展示）。点消息上的徽标或顶部横幅可一键补录；若某模型频繁出现，建议换推理能力更强的模型。' },
    { k: ['手机', '移动端', '安卓', '导出', '进度包'], a: '设置 → 导出进度包，把文件传到手机后用六面世界 Android App 导入即可接续游玩（世界线、状态、插图都会带过去）。' },
    { k: ['内核', '换世界', '世界观', '工作台'], a: '底部命令坞「内核」进入设计工作台：可切换内置内核（六面世界 / 玄寰界）、自己编写规则，或描述玩法让 AI 起草。切内核后新世界线按新规则运转。' },
    { k: ['if', 'IF', '分歧', '重走', '后悔'], a: '悬停你发过的任意一条行动消息，点「IF 分歧」：从那一步复制出一条新的世界线重新选择，原线完全不受影响。' },
    { k: ['密钥', '安全', '隐私', 'apikey', 'API key'], a: 'API 密钥存放在系统安全存储里（不走 localStorage 明文、不进导出包、设置界面也只显示已配置状态）。' },
    { k: ['报错', '401', '429', '超时', '失败', '错误'], a: '401 检查密钥、429 是限流稍后再试、超时可点错误消息上的「重试这一回合」。流式中断时已生成的半段文本会保留。' },
    { k: ['搜索', '查找'], a: 'Ctrl+F 在当前世界线内搜正文，支持上一处/下一处跳转与高亮。' },
    { k: ['你是谁', '你是', '机器人', '世界之灵'], a: '我是世界之灵，六面世界的看门人——bloub 引擎驱动的小家伙（代码 MIT，造型致敬 x.ai）。接入本地小模型后就能和你自由对话啦。' },
    { k: ['帮助', 'help', '会什么', '能做什么'], a: '现在可以问我：怎么开始 / 快捷键 / 换主题 / 状态未落账 / 导出进度包 / 换内核 / IF 分歧 / 报错处理。接入本地小模型后，任何问题都能聊。' }
  ]

  // 给本地模型预留的系统提示词（接入时随 history 一并送入）
  var PET_SYSTEM_PROMPT = [
    '你是「世界之灵」，六面世界（一个 AI 互动故事应用）里陪伴用户的桌面小精灵。',
    '职责：教用户怎么使用应用、解答使用中的问题、闲聊。',
    '回答要求：中文；简短（两三句以内）；亲切但不要话痨；不确定的功能就说不知道。'
  ].join('\n')

  // —— 问答适配器（phase-1：规则匹配；本地小模型接入时整体替换此函数，见文件头注释）——
  function respond(text) {
    var q = String(text || '').trim().toLowerCase()
    if (!q) return null
    for (var i = 0; i < RULES.length; i++) {
      for (var j = 0; j < RULES[i].k.length; j++) {
        if (q.indexOf(String(RULES[i].k[j]).toLowerCase()) !== -1) return RULES[i].a
      }
    }
    return null
  }
  var fallback = '这个问题我还答不上——接入下方按钮的本地小模型（约 400MB）后就能自由对话了。现在可以问我：怎么开始 / 快捷键 / 换主题 / 未落账 / 导出进度包 / IF 分歧。'

  var state = {
    root: null, bot: null, bubble: null, bubbleOpen: false, busy: false, token: 0,
    model: { phase: 'absent', progress: 0, received: 0, total: 0, error: null },   // 本地小模型镜像状态
    modelBusy: false, tw: null
  }

  function nextTip() {
    var n = 0
    try { n = Number(localStorage.getItem(TIP_KEY)) || 0 } catch {}
    n = (n + 1) % TIPS.length
    try { localStorage.setItem(TIP_KEY, String(n)) } catch {}
    return TIPS[n]
  }

  // 瞬时状态：显示 state 一段时间后回到 under（不覆盖更新的事件）
  function transient(id, ms, under) {
    var my = ++state.token
    state.bot.setState(id)
    state.root.dataset.state = id
    setTimeout(function () {
      if (my !== state.token) return            // 有更新的状态接手了
      state.bot.setState(under || 'idle')
      state.root.dataset.state = under || 'idle'
    }, ms)
  }

  function onEvent(name) {
    if (!state.bot) return
    if (name === 'busy') {
      state.busy = true
      state.token++
      state.bot.setState('thinking')             // 生成期间常驻思考（不打断）
      state.root.dataset.state = 'thinking'
    } else if (name === 'done') {
      state.busy = false
      transient('notify', 2200, 'idle')          // 完成：亮一下通知徽标
    } else if (name === 'error') {
      state.busy = false
      transient('alert', 2400, 'idle')           // 报错：惊叹号
    }
  }

  // ---- 本地小模型：状态镜像 / 接入区渲染 / 打字机流式 ----
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function fmtMB(n) { return Math.max(0, Math.round((n || 0) / 1048576)) + 'MB' }
  function modelReady() { return state.model.phase === 'ready' }

  function scrollBubble() {
    var body = state.bubble && state.bubble.querySelector('.pet-bubble-body')
    if (body) body.scrollTop = body.scrollHeight
  }

  function setModelState(s) {
    if (!s) return
    state.model = {
      phase: String(s.phase || 'absent'),
      progress: Number(s.progress) || 0,
      received: Number(s.received) || 0,
      total: Number(s.total) || 0,
      error: s.error || null
    }
    if (state.bubbleOpen) renderModelZone()
    var i = state.bubble && state.bubble.querySelector('.pet-bubble-input')
    if (i) i.placeholder = modelReady() ? '问我任何事，或者随便聊聊…' : '问我怎么用，例如「快捷键」…'
  }

  // 接入区（气泡底部）：absent→一键按钮；confirm→二次确认；downloading→进度条；ready→已接入
  function renderModelZone() {
    var z = state.bubble && state.bubble.querySelector('.pet-model-zone')
    if (!z) return
    var m = state.model
    z.innerHTML = ''
    z.dataset.phase = m.phase
    if (m.phase === 'ready') {
      z.appendChild(el('span', 'pet-model-on', '本地小模型已接入 · 离线自由对话'))
    } else if (m.phase === 'downloading') {
      var dl = el('div', 'pet-model-dl')
      var bar = el('div', 'pet-model-bar')
      bar.appendChild(el('i')).style.width = Math.round(m.progress * 100) + '%'
      dl.appendChild(bar)
      dl.appendChild(el('span', 'pet-model-pct', m.total
        ? Math.round(m.progress * 100) + '% · ' + fmtMB(m.received) + '/' + fmtMB(m.total)
        : fmtMB(m.received)))
      var c = el('button', 'pet-chip pet-chip-ghost', '取消')
      c.addEventListener('click', function () { if (window.api) window.api.petModelDownloadCancel() })
      dl.appendChild(c)
      z.appendChild(dl)
    } else if (m.phase === 'loading' || m.phase === 'ondisk') {
      z.appendChild(el('span', 'pet-model-loading', m.phase === 'loading' ? '下载完成，正在接入…' : '正在接入本地小模型…'))
    } else if (m.phase === 'error') {
      var box = el('div', 'pet-model-err')
      box.appendChild(el('span', 'pet-model-err-text', '接入失败：' + (m.error || '未知错误')))
      var r = el('button', 'pet-chip', '重试')
      r.addEventListener('click', function () { if (window.api) window.api.petModelDownload() })
      box.appendChild(r)
      z.appendChild(box)
    } else {
      var b = el('button', 'pet-chip pet-chip-model', '接入本地小模型 · 约 400MB')
      b.addEventListener('click', showModelConfirm)
      z.appendChild(b)
    }
  }

  // 二次确认：只讲大小与用途，不显示型号（用户要求）
  function showModelConfirm() {
    var z = state.bubble.querySelector('.pet-model-zone')
    if (!z) return
    z.innerHTML = ''
    z.dataset.phase = 'confirm'
    var c = el('div', 'pet-model-confirm')
    c.appendChild(el('div', 'pet-model-confirm-text',
      '将下载约 400MB 的本地小模型到本机，接入后我可以离线陪你自由聊天（不影响故事功能，随时可重试）。'))
    var row = el('div', 'pet-model-confirm-row')
    var no = el('button', 'pet-chip pet-chip-ghost', '取消')
    no.addEventListener('click', renderModelZone)
    var yes = el('button', 'pet-chip pet-chip-go', '下载（约 400MB）')
    yes.addEventListener('click', function () { if (window.api) window.api.petModelDownload() })
    row.appendChild(no); row.appendChild(yes)
    c.appendChild(row)
    z.appendChild(c)
    transient('exclaim', 1600, 'idle')
  }

  // 打字机：delta 按批到达，这里匀速放出（~60 字/秒），结束用主进程全文权威兜底
  function twFeed(tw, piece) {
    if (!tw.first) {
      tw.first = true
      if (state.bot) { state.bot.setState('wide'); state.root.dataset.state = 'wide' }   // 首字：睁大眼
    }
    tw.queue += piece
    if (!tw.timer) tw.timer = setInterval(function () { twTick(tw) }, 33)
  }
  function twTick(tw) {
    var n = Math.min(2, tw.queue.length)
    if (n > 0) {
      tw.el.textContent += tw.queue.slice(0, n)
      tw.queue = tw.queue.slice(n)
      scrollBubble()
    }
    if (!tw.queue.length && tw.done) {
      clearInterval(tw.timer)
      tw.timer = null
      tw.el.classList.remove('gen')
      if (tw.target && tw.el.textContent !== tw.target) tw.el.textContent = tw.target
      scrollBubble()
      transient('wink', 1800, state.busy ? 'thinking' : 'idle')   // 答完眨个眼
      if (state.tw === tw) state.tw = null
    }
  }
  function twKill(tw) {
    if (tw.timer) clearInterval(tw.timer)
    tw.el.classList.remove('gen')
    if (state.tw === tw) state.tw = null
  }

  // 就绪后规则话术里「接入后就能…」的过时尾巴改写成现在时
  function adjustRuleForModel(text) {
    if (!modelReady()) return text
    return text
      .replace('接入本地小模型后就能和你自由对话啦', '本地小模型已经接好，现在就能自由对话。')
      .replace('接入本地小模型后，任何问题都能聊。', '本地小模型已接入，任何问题都能聊。')
  }

  function modelAsk(q, aEl) {
    var api = window.api
    if (!api || !api.petChat) { aEl.textContent = fallback; return }
    state.modelBusy = true
    aEl.classList.add('gen')
    var tw = { queue: '', target: '', done: false, timer: null, el: aEl, first: false }
    state.tw = tw
    var off = api.onPetChatDelta(function (piece) { twFeed(tw, piece) })
    // 等首答期间常驻思考表情（0.5B 首答 ~1-7s）
    state.token++
    if (state.bot) { state.bot.setState('thinking'); state.root.dataset.state = 'thinking' }
    var fail = function (r) {
      off && off()
      twKill(tw)
      state.modelBusy = false
      aEl.classList.add('pet-model-err-text')
      aEl.textContent = (r && r.notReady) ? '本地小模型还没就绪，稍等一下再问我。' : ('出了点小问题：' + ((r && r.error) || '未知错误'))
      scrollBubble()
      transient('alert', 2400, state.busy ? 'thinking' : 'idle')
    }
    api.petChat({ text: q }).then(function (r) {
      if (!r || !r.ok) return fail(r)
      off && off()
      tw.target = r.content || ''
      tw.done = true
      if (!tw.timer && !tw.queue.length) twTick(tw)   // 没收到过 delta（极快/被攒批吞了）：直接收尾
      state.modelBusy = false
    }).catch(function (e) { fail(e && e.message ? { error: e.message } : {}) })
  }

  function poke() {
    var faces = ['wink', 'wide', 'exclaim', 'notify', 'hexagon']
    var f = faces[Math.floor(Math.random() * faces.length)]
    transient(f, 1600, state.busy ? 'thinking' : 'idle')
  }

  // ---- 帮助气泡 ----
  function buildBubble() {
    var b = document.createElement('div')
    b.className = 'pet-bubble hidden'
    b.id = 'pet-bubble'
    var head = document.createElement('div')
    head.className = 'pet-bubble-head'
    head.innerHTML = '<span class="pet-bubble-title">世界之灵</span>'
    var x = document.createElement('button')
    x.className = 'pet-bubble-x'
    x.title = '关闭'
    x.innerHTML = '<svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
    x.addEventListener('click', closeBubble)
    head.appendChild(x)
    var body = document.createElement('div')
    body.className = 'pet-bubble-body'
    var tip = document.createElement('div')
    tip.className = 'pet-bubble-tip'
    tip.textContent = nextTip()
    var foot = document.createElement('div')
    foot.className = 'pet-bubble-foot'
    var input = document.createElement('input')
    input.className = 'pet-bubble-input'
    input.placeholder = '问我怎么用，例如「快捷键」…'
    input.setAttribute('aria-label', '问世界之灵')
    var send = document.createElement('button')
    send.className = 'pet-bubble-send'
    send.textContent = '问'
    send.title = '提问'
    function ask() {
      var q = input.value.trim()
      if (!q) return
      if (state.modelBusy) return
      input.value = ''
      var qa = document.createElement('div')
      qa.className = 'pet-bubble-qa'
      var qEl = document.createElement('div')
      qEl.className = 'pet-bubble-q'
      qEl.textContent = q
      var aEl = document.createElement('div')
      aEl.className = 'pet-bubble-a'
      qa.appendChild(qEl); qa.appendChild(aEl)
      body.appendChild(qa)
      body.scrollTop = body.scrollHeight
      var hit = respond(q)
      if (hit) {                       // 应用类问题：规则库精准回答（0.5B 对应用事实易幻觉）
        aEl.textContent = adjustRuleForModel(hit)
        poke()
      } else if (modelReady()) {       // 规则未命中且模型就绪：本地小模型流式闲聊
        modelAsk(q, aEl)
      } else {
        aEl.textContent = fallback
        poke()
      }
    }
    send.addEventListener('click', ask)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ask() }
      e.stopPropagation()                        // 不与主界面快捷键（Ctrl+F 等）互踩
    })
    foot.appendChild(input); foot.appendChild(send)
    body.appendChild(tip)
    var zone = el('div', 'pet-model-zone')       // 本地小模型接入区（消息区与输入行之间的固定条）
    b.appendChild(head); b.appendChild(body); b.appendChild(zone); b.appendChild(foot)
    return b
  }

  function openBubble() {
    if (state.bubbleOpen) {                      // 已开：再点换贴士
      var t = state.bubble.querySelector('.pet-bubble-tip')
      if (t) t.textContent = nextTip()
      return
    }
    renderModelZone()                            // 开气泡时按最新模型状态渲染接入区
    anchorBubble()
    state.bubble.classList.remove('hidden')
    state.bubbleOpen = true
    setTimeout(function () { var i = state.bubble.querySelector('.pet-bubble-input'); if (i) i.focus() }, 60)
  }

  // 气泡锚定：默认桌宠正上方、右对齐；右侧放不下则左移，顶出视口则翻到桌宠下方
  function anchorBubble() {
    var r = state.root.getBoundingClientRect()
    var b = state.bubble
    b.style.visibility = 'hidden'
    b.classList.remove('hidden')
    var bw = b.offsetWidth || 320
    var bh = b.offsetHeight || 200
    b.classList.add('hidden')
    var x = Math.max(12, Math.min(window.innerWidth - bw - 12, r.x + r.width - bw))
    var y = r.y - bh - 14
    if (y < 76) y = r.y + r.height + 14          // 顶到标题栏之下放不下 → 改到桌宠下方
    b.style.left = Math.round(x) + 'px'
    b.style.top = Math.round(y) + 'px'
    b.style.visibility = 'visible'
  }
  function closeBubble() {
    if (!state.bubbleOpen) return
    state.bubble.classList.add('hidden')
    state.bubbleOpen = false
  }

  // ---- 定位：默认右侧边距中带、贴底；可拖拽（位置持久化，夹回视口） ----
  // 内容列宽：原型固定 760；经典走 --read-w（可调阅读列宽，默认 720）+ 余量
  function sideMargin() {
    var cw = 760
    try {
      var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--read-w'))
      if (isFinite(v) && v > 300) cw = v + 40
    } catch {}
    return Math.max(0, (window.innerWidth - cw) / 2)
  }

  function defaultPos() {
    var m = sideMargin()
    return { x: window.innerWidth - m / 2 - SIZE / 2, y: window.innerHeight - SIZE - 120 }
  }

  function applyPos(p) {
    var x = Math.max(8, Math.min(window.innerWidth - SIZE - 8, p.x))
    var y = Math.max(72, Math.min(window.innerHeight - SIZE - 8, p.y))
    state.root.style.left = x + 'px'
    state.root.style.top = y + 'px'
    return { x: x, y: y }
  }

  function savedPos() {
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
      if (p && isFinite(p.x) && isFinite(p.y)) return p
    } catch {}
    return null
  }

  // ---- 初始化（app.js 启动时调用一次；失败静默——桌宠绝不阻断应用） ----
  function init() {
    if (state.root) return state.root
    try {
      if (!window.BloubMount || !window.Bloub) return null
      // 样式自注入（幂等）：双方案共用一份，避免两套 styles.css 人工同步
      if (!document.getElementById('bloub-pet-style')) {
        var st = document.createElement('style')
        st.id = 'bloub-pet-style'
        st.textContent = "\n/* 桌宠自注入样式（单一来源；var 兜底链兼容经典 --panel/--border/--accent 与原型 --surface/--line-v2/--brand-v2 两套变量） */\n.bloub-pet {\n  position: fixed; z-index: 90;\n  width: 104px; height: 104px;\n  cursor: grab;\n  touch-action: none;\n  filter: drop-shadow(0 14px 34px rgba(0,0,0,.35));\n  transition: opacity .3s;\n}\n.bloub-pet:active { cursor: grabbing; }\n.bloub-pet.pet-hidden { opacity: 0; pointer-events: none; }\n.bloub-pet .pet-host { width: 104px; height: 104px; }\n.bloub-pet:focus-visible { outline: 1px solid var(--brand-v2, var(--accent, #a5641f)); outline-offset: 4px; border-radius: 10px; }\n.bloub-pet[data-state=\"thinking\"] { filter: drop-shadow(0 10px 26px rgba(0,0,0,.35)) drop-shadow(0 0 18px var(--accent-glow, rgba(201,139,75,.12))); }\n\n.pet-bubble {\n  position: fixed; z-index: 95;\n  width: min(320px, calc(100vw - 48px));\n  background: var(--surface, var(--panel, #fff));\n  border: 1px solid var(--line-strong-v2, var(--border-strong, #888));\n  border-radius: 10px;\n  box-shadow: 0 18px 50px rgba(0,0,0,.4);\n  overflow: hidden;\n  animation: pet-bubble-in .28s var(--ease-spring, cubic-bezier(.2,.8,.2,1));\n}\n.pet-bubble.hidden { display: none; }\n@keyframes pet-bubble-in { from { transform: translateY(10px) scale(.96); opacity: 0; } }\n.pet-bubble-head {\n  display: flex; align-items: center; justify-content: space-between;\n  padding: 8px 10px 8px 14px;\n  border-bottom: 1px solid var(--line-v2, var(--border, #ddd));\n  background: var(--surface-raised, var(--panel-2, #f5f5f6));\n}\n.pet-bubble-title { font-size: 12px; font-weight: 700; color: var(--text-primary, var(--text, #222)); letter-spacing: 1px; }\n.pet-bubble-x { border: 0; background: transparent; color: var(--text-faint-v2, var(--text-faint, #999)); cursor: pointer; width: 22px; height: 22px; padding: 0; }\n.pet-bubble-x:hover { color: var(--text-primary, var(--text, #222)); }\n.pet-bubble-x .ic { width: 12px; height: 12px; stroke: currentColor; stroke-width: 1.4; fill: none; }\n.pet-bubble-body { padding: 12px 14px; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }\n.pet-bubble-tip { font-size: 12px; line-height: 1.7; color: var(--text-muted-v2, var(--text-dim, #666)); }\n.pet-bubble-qa { display: flex; flex-direction: column; gap: 4px; }\n.pet-bubble-q { font-size: 12px; color: var(--text-primary, var(--text, #222)); font-weight: 600; }\n.pet-bubble-q::before { content: \"问 \"; color: var(--text-faint-v2, var(--text-faint, #999)); font-weight: 400; }\n.pet-bubble-a { font-size: 12px; line-height: 1.7; color: var(--text-muted-v2, var(--text-dim, #666)); }\n.pet-bubble-a::before { content: \"灵 \"; color: var(--brand-v2, var(--accent, #a5641f)); font-weight: 700; }\n.pet-bubble-foot { display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--line-v2, var(--border, #ddd)); background: var(--surface, var(--panel, #fff)); }\n.pet-bubble-input {\n  flex: 1; min-width: 0; height: 32px; padding: 0 10px;\n  border: 1px solid var(--line-v2, var(--border, #ddd)); border-radius: 6px;\n  background: var(--canvas, var(--bg, #fff)); color: var(--text-primary, var(--text, #222)); font-size: 12px;\n}\n.pet-bubble-input:focus { outline: none; border-color: var(--brand-v2, var(--accent, #a5641f)); }\n.pet-bubble-send {\n  flex: none; height: 32px; min-width: 44px; padding: 0 10px;\n  border: 1px solid var(--brand-v2, var(--accent, #a5641f)); border-radius: 6px;\n  background: var(--brand-v2, var(--accent, #a5641f)); color: #231a0c; font-size: 12px; font-weight: 700; cursor: pointer;\n}\n.pet-bubble-send:hover { background: var(--brand-strong-v2, var(--accent-dim, #8a6538)); border-color: var(--brand-strong-v2, var(--accent-dim, #8a6538)); }\n\n/* 本地小模型接入区（消息区与输入行之间的固定条；状态驱动） */\n.pet-model-zone { padding: 0 12px 10px; display: flex; }\n.pet-model-zone:empty { display: none; }\n.pet-model-zone .pet-model-on { flex: 1; align-self: center; font-size: 11px; color: var(--ok, #3d9a50); }\n.pet-model-zone .pet-model-loading { flex: 1; align-self: center; font-size: 11px; color: var(--text-muted-v2, var(--text-dim, #666)); animation: pet-pulse 1.2s ease-in-out infinite; }\n@keyframes pet-pulse { 50% { opacity: .45; } }\n.pet-model-zone .pet-model-dl { flex: 1; display: flex; flex-direction: column; gap: 4px; }\n.pet-model-zone .pet-model-bar { height: 4px; border-radius: 2px; background: var(--line-v2, var(--border, #ddd)); overflow: hidden; }\n.pet-model-zone .pet-model-bar i { display: block; height: 100%; border-radius: 2px; background: var(--brand-v2, var(--accent, #a5641f)); transition: width .3s; }\n.pet-model-zone .pet-model-pct { font-size: 11px; color: var(--text-muted-v2, var(--text-dim, #666)); }\n.pet-model-zone .pet-model-err { flex: 1; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n.pet-model-zone .pet-model-err-text { font-size: 11px; line-height: 1.5; color: var(--danger, #c0564a); }\n.pet-model-confirm { flex: 1; display: flex; flex-direction: column; gap: 8px; }\n.pet-model-confirm-text { font-size: 11px; line-height: 1.7; color: var(--text-muted-v2, var(--text-dim, #666)); }\n.pet-model-confirm-row { display: flex; gap: 8px; justify-content: flex-end; }\n.pet-chip {\n  border: 1px solid var(--line-v2, var(--border, #ddd)); border-radius: 999px;\n  height: 26px; padding: 0 12px; font-size: 11px; cursor: pointer; align-self: center;\n  background: var(--surface, var(--panel, #fff)); color: var(--text-primary, var(--text, #222));\n}\n.pet-chip:hover { border-color: var(--brand-v2, var(--accent, #a5641f)); color: var(--brand-v2, var(--accent, #a5641f)); }\n.pet-chip-ghost { border-color: transparent; color: var(--text-muted-v2, var(--text-dim, #666)); }\n.pet-chip-ghost:hover { border-color: var(--line-v2, var(--border, #ddd)); color: var(--text-primary, var(--text, #222)); }\n.pet-chip-model { border-color: var(--brand-v2, var(--accent, #a5641f)); color: var(--brand-v2, var(--accent, #a5641f)); font-weight: 700; }\n.pet-chip-go { border-color: var(--brand-v2, var(--accent, #a5641f)); background: var(--brand-v2, var(--accent, #a5641f)); color: #231a0c; font-weight: 700; }\n.pet-chip-go:hover { background: var(--brand-strong-v2, var(--accent-dim, #8a6538)); color: #231a0c; }\n\n/* 本地小模型回答：打字机光标（生成中闪烁） */\n.pet-bubble-a.gen::after { content: \"▍\"; color: var(--brand-v2, var(--accent, #a5641f)); animation: pet-caret .8s steps(1) infinite; }\n@keyframes pet-caret { 50% { opacity: 0; } }\n"
        document.head.appendChild(st)
      }
      var root = document.createElement('div')
      root.className = 'bloub-pet'
      root.id = 'bloub-pet'
      root.dataset.state = 'idle'
      root.title = '世界之灵：点击对话 · 拖动搬家'
      root.setAttribute('role', 'button')
      root.setAttribute('tabindex', '0')
      root.setAttribute('aria-label', '世界之灵：点击对话，拖动移动')

      var host = document.createElement('div')
      host.className = 'pet-host'
      root.appendChild(host)
      state.root = root
      state.bot = window.BloubMount.mount(host, { size: SIZE, cycle: null, follow: true })

      // 拖拽 vs 点击：移动超阈值算拖拽（不弹气泡），否则视为点击
      var drag = null
      root.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return
        var p = savedPos() || applyPos(defaultPos())
        drag = { sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
        root.setPointerCapture && root.setPointerCapture(e.pointerId)
      })
      root.addEventListener('pointermove', function (e) {
        if (!drag) return
        var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
        if (drag.moved) {
          var p = applyPos({ x: drag.ox + dx, y: drag.oy + dy })
          drag.px = p
        }
      })
      root.addEventListener('pointerup', function (e) {
        if (!drag) return
        var wasDrag = drag.moved
        if (wasDrag) {
          try { localStorage.setItem(POS_KEY, JSON.stringify(drag.px || applyPos(defaultPos()))) } catch {}
        }
        drag = null
        if (!wasDrag) { poke(); openBubble() }
      })
      root.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poke(); openBubble() }
      })

      state.bubble = buildBubble()
      document.body.appendChild(state.bubble)
      document.body.appendChild(root)
      applyPos(savedPos() || defaultPos())

      // 边距不足时隐藏（窄窗口不挡内容）；窗口变化时夹回视口
      function fit() {
        var ok = sideMargin() >= MIN_MARGIN
        root.classList.toggle('pet-hidden', !ok)
        applyPos({ x: parseFloat(root.style.left) || defaultPos().x, y: parseFloat(root.style.top) || defaultPos().y })
      }
      window.addEventListener('resize', fit)
      fit()

      // 点击气泡外关闭
      document.addEventListener('pointerdown', function (e) {
        if (state.bubbleOpen && !root.contains(e.target) && !state.bubble.contains(e.target)) closeBubble()
      }, true)

      // 待机自发小表情（低频、不吵）
      setInterval(function () {
        if (state.busy || state.bubbleOpen || document.hidden) return
        if (Math.random() < 0.5) transient(Math.random() < 0.5 ? 'wink' : 'wide', 1600, 'idle')
      }, 22000)

      // 本地小模型状态同步：初始查询 + 订阅下载/加载进度（就绪时小庆祝一下）
      try {
        var api = window.api
        if (api && api.petModelStatus) {
          api.petModelStatus().then(function (s) {
            var wasReady = modelReady()
            setModelState(s)
            if (!wasReady && modelReady()) transient('burst', 2000, 'idle')
          }).catch(function () {})
          if (api.onPetModelProgress) {
            api.onPetModelProgress(function (s) {
              var wasReady = modelReady()
              setModelState(s)
              if (!wasReady && modelReady()) {
                transient('burst', 2000, 'idle')    // 下载→就绪：小烟花庆祝
                renderModelZone()
              }
            })
          }
        }
      } catch (e2) {}

      return root
    } catch (e) { return null }
  }

  window.BloubPet = {
    init: init,
    event: onEvent,
    poke: function () { if (state.bot) poke() },
    ask: respond,                       // 测试/调试用：直接问规则库
    modelPhase: function () { return state.model.phase },   // 测试用：本地小模型镜像状态
    systemPrompt: PET_SYSTEM_PROMPT,    // 人设提示词展示副本（运行时正本在 shared/pet-model-prompt.cjs）
    get el() { return state.root }
  }
})()

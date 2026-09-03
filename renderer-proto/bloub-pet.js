/*
 * 六面世界 · 世界之灵桌宠（renderer-proto/bloub-pet.js，原型工作台专属）
 *
 * 常驻在内容画布两侧空白边距里的活体机器人（引擎：shared/bloub.js + shared/bloub-mount.js）：
 *   - 平时呼吸、眨眼、视线跟着鼠标走；偶尔自己换个表情
 *   - 生成叙事时化作 thinking 三点；回合完成 notify 亮徽标；报错 alert 惊叹号
 *   - 点击：戳一戳（随机表情）+ 帮助气泡（使用指南 + 问答输入框）
 *   - 拖拽：可搬到任意边距/角落，位置记忆（localStorage），窗口变化自动夹回视口
 *   - 窄窗口（边距 < 140px）自动隐藏，不打扰内容区
 *
 * ---- 后续接入本地小模型（对话/答疑自由化）----
 * 现在气泡问答走 PetAssistant.respond 的规则实现（关键词匹配使用指南）。
 * 接本地模型（Ollama / llama.cpp 等任意 OpenAI 兼容端点）时只需替换该函数，
 * 气泡 UI / 状态反应 / 拖拽全部无需改动：
 *   respond: function (text, history) {
 *     return window.api.sendChat({
 *       baseUrl: 'http://127.0.0.1:11434/v1',   // 本地端点
 *       apiKey: 'ollama', model: '<你的小模型>',
 *       messages: [{ role: 'system', content: PET_SYSTEM_PROMPT }].concat(history).concat([{ role: 'user', content: text }])
 *     }).then(function (r) { return r && r.ok ? r.content : null })
 *   }
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
  var fallback = '这个问题我还答不上——本地小模型接入后就能自由对话了。现在可以问我：怎么开始 / 快捷键 / 换主题 / 未落账 / 导出进度包 / IF 分支。'

  var state = { root: null, bot: null, bubble: null, bubbleOpen: false, busy: false, token: 0 }

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
      input.value = ''
      var qa = document.createElement('div')
      qa.className = 'pet-bubble-qa'
      var qEl = document.createElement('div')
      qEl.className = 'pet-bubble-q'
      qEl.textContent = q
      var aEl = document.createElement('div')
      aEl.className = 'pet-bubble-a'
      aEl.textContent = respond(q) || fallback
      qa.appendChild(qEl); qa.appendChild(aEl)
      body.appendChild(qa)
      body.scrollTop = body.scrollHeight
      poke()
    }
    send.addEventListener('click', ask)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); ask() }
      e.stopPropagation()                        // 不与主界面快捷键（Ctrl+F 等）互踩
    })
    foot.appendChild(input); foot.appendChild(send)
    body.appendChild(tip)
    b.appendChild(head); b.appendChild(body); b.appendChild(foot)
    return b
  }

  function openBubble() {
    if (state.bubbleOpen) {                      // 已开：再点换贴士
      var t = state.bubble.querySelector('.pet-bubble-tip')
      if (t) t.textContent = nextTip()
      return
    }
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
  function sideMargin() { return Math.max(0, (window.innerWidth - 760) / 2) }

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

      return root
    } catch (e) { return null }
  }

  window.BloubPet = {
    init: init,
    event: onEvent,
    poke: function () { if (state.bot) poke() },
    ask: respond,                       // 测试/调试用：直接问规则库
    systemPrompt: PET_SYSTEM_PROMPT,    // 本地小模型接入时复用的人设提示词
    get el() { return state.root }
  }
})()

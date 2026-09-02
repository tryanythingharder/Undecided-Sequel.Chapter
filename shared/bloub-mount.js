/*
 * 六面世界 · bloub 机器人挂载层（shared/bloub-mount.js）
 * 把 shared/bloub.js 引擎输出的 BotFrame 组装成 SVG DOM（复刻上游 BloubBot.vue 的
 * 结构：mask 挖洞眼睛、弧线前后分层、粒子按深度混色），并提供：
 *   window.BloubMount.mount(el, opts) → controller
 *   controller.setState(id) / close() / setBusy(bool)
 * 特性：rAF 驱动 + 标签页隐藏自动停帧；主题色走 CSS 变量（--bg/--text/--text-dim），
 * 换主题即时变色无需重建；多实例互不干扰（mask/gradient id 唯一）。
 * 上游出处与许可说明见 shared/bloub.js 头注释与 docs/bloub-vendor.md。
 */
(function () {
  'use strict'

  var VB = 158 // DEMI_VIEWBOX：viewBox 半宽（上游 repere.ts 常量，容纳最大 1.4R 的弧线）
  var SVG_NS = 'http://www.w3.org/2000/svg'

  // 空会话引导区的待机循环：比上游 15 态全序列更收敛——一个「呼吸、眨眼、偶尔卖萌」
  // 的节奏，不出现会抢走正文注意力的整段变形（burst/comet 全程 ~7s 不适合引导页）
  var IDLE_CYCLE = [
    { state: 'idle', duration: 2.4 },
    { state: 'thinking', duration: 2.6 },
    { state: 'idle', duration: 2.4 },
    { state: 'wink', duration: 1.6 },
    { state: 'idle', duration: 2.4 },
    { state: 'wide', duration: 1.8 },
    { state: 'idle', duration: 2.4 },
    { state: 'notify', duration: 2.2 }
  ]

  function el(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag)
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k])
    return n
  }

    // 读计算后的 CSS 变量（跟随主题类切换实时变化）。
    // 主题联动实现为「逐帧重读」而非把 var() 写进 attribute：主题切换后下一帧即变色，
    // 不依赖 CSS 变量继承链（眼洞需与容器实底色一致，计算值更直接）。
    function cssVar(name, fallback) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name)
      return (v && v.trim()) || fallback
    }

  // 十六进制颜色（#rgb/#rrggbb）线性混合：粒子的深度雾（上游 mixHex 逻辑）
  function mixHex(from, to, t) {
    function parse(h) {
      var s = h.replace('#', '')
      if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
      var v = parseInt(s, 16)
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
    }
    var a = parse(from), b = parse(to)
    var c = a.map(function (x, i) { return Math.round(x + (b[i] - x) * t) })
    return '#' + c.map(function (x) { return ('0' + x.toString(16)).slice(-2) }).join('')
  }

  /**
   * 挂载一个机器人。opts:
   *   size        显示尺寸 px（SVG 逻辑尺寸固定 viewBox，等比缩放）默认 64
   *   cycle       待机循环（[{state,duration}]）；null = 单状态常驻（busy 用）
   *   follow      视线跟随鼠标（默认 true；灵动岛等小场景设 false）
   *   aria        无障碍标签（默认「世界之灵」，纯装饰场景传 null）
   *   onFrame     每帧回调（测试用），参数 (frame, engine)
   * 返回 controller：{ setState, close, el, setBusy }
   */
  function mount(target, opts) {
    opts = opts || {}
    if (!window.Bloub) throw new Error('bloub.js 未加载')
    var B = window.Bloub

    var size = Number(opts.size) || 64
    var follow = opts.follow !== false
    var cycle = opts.cycle === undefined ? IDLE_CYCLE : opts.cycle
    if (cycle) {
      for (var ci = 0; ci < cycle.length; ci++) {
        if (!B.STATE_BY_ID.get(cycle[ci].state)) cycle[ci] = { state: 'idle', duration: 2.4 }
      }
    }

    var uid = Math.random().toString(36).slice(2, 8)
    var maskId = 'bloub-mask-' + uid
    var gradPrefix = 'bloub-g-' + uid + '-'

    var svg = el('svg', {
      width: size, height: size,
      viewBox: (-VB) + ' ' + (-VB) + ' ' + (VB * 2) + ' ' + (VB * 2),
      'class': 'bloub-svg'
    })
    if (opts.aria !== null) {
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', opts.aria || '世界之灵')
    } else {
      svg.setAttribute('aria-hidden', 'true')
    }

    // ---- 静态骨架：一次构建，帧循环只改动态属性（d/transform/opacity/fill）----
    var defs = el('defs')
    var mask = el('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: -VB, y: -VB, width: VB * 2, height: VB * 2 })
    var maskBody = el('path', { fill: '#fff' })
    mask.appendChild(maskBody)
    var maskEyes = [el('path', { fill: '#000' }), el('path', { fill: '#000' })]
    for (var mi = 0; mi < maskEyes.length; mi++) mask.appendChild(maskEyes[mi])
    var maskNotch = el('circle', { fill: '#000' })
    mask.appendChild(maskNotch)
    defs.appendChild(mask)
    var gradStore = {} // arcId → {el, stops[]}（挂载层内部用；渐变元素直接挂 defs）
    svg.appendChild(defs)

    // 弧线后半（画在身体前 → 被身体遮挡，形成穿球体的纵深感）
    var arcsBackG = el('g', { fill: 'none', 'stroke-linecap': 'round' })
    svg.appendChild(arcsBackG)
    // 爆破粒子（在身体后）
    var dotsBackG = el('g')
    svg.appendChild(dotsBackG)
    // 身体：paper 底 + mask 出 ink 色（眼睛是真洞，非白贴片）
    var bodyG = el('g')
    var paperPath = el('path')
    bodyG.appendChild(paperPath)
    var maskedRect = el('rect', { x: -VB, y: -VB, width: VB * 2, height: VB * 2, mask: 'url(#' + maskId + ')' })
    bodyG.appendChild(maskedRect)
    svg.appendChild(bodyG)
    // 前景粒子
    var dotsFrontG = el('g')
    svg.appendChild(dotsFrontG)
    // 通知徽标
    var notifC = el('circle', { fill: '#2496e8' })
    svg.appendChild(notifC)
    // 弧线前半
    var arcsFrontG = el('g', { fill: 'none', 'stroke-linecap': 'round' })
    svg.appendChild(arcsFrontG)

    target.appendChild(svg)

    // ---- 引擎与驱动 ----
    var engine = new B.BotEngine(100, 'idle')
    var clock = 0
    var last = 0
    var raf = 0
    var closed = false
    var cycleStart = 0
    var cycleIdx = 0
    var documentHidden = false

    // 循环推进（cycle 非空时按 duration 切状态；单状态则常驻）
    function advance() {
      if (!cycle || !cycle.length) return
      var block = cycle[cycleIdx]
      if (clock - cycleStart >= block.duration) {
        cycleIdx = (cycleIdx + 1) % cycle.length
        cycleStart = clock
        engine.setState(cycle[cycleIdx].state, clock)
      }
    }

    // 视线跟随（复刻上游 lookTarget 规则：视窗半宽归一，饱和于屏幕边缘）
    var pointer = null
    var aiming = false
    var turnSince = 0
    var TURN_TIME = 1.1
    var bbox = null
    function refreshBox() { bbox = svg.getBoundingClientRect() }
    function aim() {
      var def = B.STATE_BY_ID.get(engine.state)
      if (!def || !def.baseFace) { // 非休息脸状态不接管视线（保持测量姿态）
        if (aiming) { engine.setLook(null, clock); aiming = false }
        return
      }
      if (!bbox || bbox.width === 0) return
      if (!aiming) turnSince = clock
      var halfW = Math.max(1, window.innerWidth / 2)
      var halfH = Math.max(1, window.innerHeight / 2)
      var nx = pointer ? Math.max(-1, Math.min(1, (pointer.x - (bbox.left + bbox.width / 2)) / halfW)) : 0
      var ny = pointer ? Math.max(-1, Math.min(1, (pointer.y - (bbox.top + bbox.height / 2)) / halfH)) : 0
      var tour = 1 - Math.pow(1 - Math.max(0, Math.min(1, (clock - turnSince) / TURN_TIME)), 5)
      engine.setLook(B.lookTarget({
        nx: nx, ny: ny, tour: tour, pointer: pointer !== null
      }), clock)
      aiming = true
    }

    // ---- 帧渲染：把 BotFrame 写进骨架 ----
    var arcsCache = {} // arcId → {front, back, w, gradDef, pathF, pathB}
    function render(frame) {
      var ink = cssVar('--text', '#f4f1ea')
      // 原型方案的画布底色是 --canvas（浅色主题 #f4f4f1 / 深色 #0a0a0b）；眼洞必须与
      // 机器人所在容器的真实底色一致，否则「挖洞」会露馅。回退链兼容经典方案（--bg）
      var paper = cssVar('--canvas', cssVar('--bg', '#0a0a0b'))
      var dim = cssVar('--text-dim', '#aaa9a5')

      // 身体 + 眼洞
      paperPath.setAttribute('d', frame.bodyPath)
      paperPath.setAttribute('fill', paper)
      maskedRect.setAttribute('fill', ink)
      bodyG.setAttribute('opacity', frame.bodyAlpha)
      maskBody.setAttribute('d', frame.bodyPath)
      var ne = frame.eyes.length
      for (var i = 0; i < 2; i++) {
        if (i < ne) {
          var e = frame.eyes[i]
          maskEyes[i].setAttribute('d', e.d)
          maskEyes[i].setAttribute('transform', e.matrix)
          maskEyes[i].setAttribute('opacity', e.alpha)
          maskEyes[i].removeAttribute('display')
        } else maskEyes[i].setAttribute('display', 'none')
      }
      if (frame.notch) {
        maskNotch.removeAttribute('display')
        maskNotch.setAttribute('cx', frame.notch.x); maskNotch.setAttribute('cy', frame.notch.y); maskNotch.setAttribute('r', frame.notch.r)
      } else maskNotch.setAttribute('display', 'none')

      // 弧线：逐条 upsert（id 稳定 → path/gradient 元素复用；渐变直接挂 defs）
      var seenArc = {}
      for (var a = 0; a < frame.arcs.length; a++) {
        var arc = frame.arcs[a]
        var c = arcsCache[arc.id]
        if (!c) {
          var g = el('linearGradient', { id: gradPrefix + arc.id, gradientUnits: 'userSpaceOnUse' })
          var stops = []
          for (var s = 0; s < 3; s++) { var st = el('stop'); g.appendChild(st); stops.push(st) }
          defs.appendChild(g)
          var pf = el('path', { fill: 'none', 'stroke-linecap': 'round', stroke: 'url(#' + gradPrefix + arc.id + ')' })
          arcsFrontG.appendChild(pf)
          var pb = el('path', { fill: 'none', 'stroke-linecap': 'round', stroke: 'url(#' + gradPrefix + arc.id + ')' })
          arcsBackG.appendChild(pb)
          c = arcsCache[arc.id] = { grad: g, stops: stops, front: pf, back: pb }
        }
        seenArc[arc.id] = true
        c.front.setAttribute('d', arc.front)
        c.front.setAttribute('stroke-width', arc.width)
        c.front.setAttribute('opacity', arc.opacity)
        c.back.setAttribute('d', arc.back)
        c.back.setAttribute('stroke-width', arc.width)
        c.back.setAttribute('opacity', arc.opacity)
        c.grad.setAttribute('x1', arc.grad.x1); c.grad.setAttribute('y1', arc.grad.y1)
        c.grad.setAttribute('x2', arc.grad.x2); c.grad.setAttribute('y2', arc.grad.y2)
        for (var k = 0; k < 3; k++) {
          c.stops[k].setAttribute('offset', k / 2)
          c.stops[k].setAttribute('stop-color', arc.grad.stops[k])
        }
      }
      for (var id in arcsCache) {
        if (!seenArc[id]) {
          arcsCache[id].front.setAttribute('opacity', 0)
          arcsCache[id].back.setAttribute('opacity', 0)
        }
      }

      // 粒子：数量少（≤5），每帧按需增删
      var dl = frame.dots.length
      while (dotsFrontG.firstChild) dotsFrontG.removeChild(dotsFrontG.firstChild)
      while (dotsBackG.firstChild) dotsBackG.removeChild(dotsBackG.firstChild)
      var host = frame.dotsBehind ? dotsBackG : dotsFrontG
      for (var d = 0; d < dl; d++) {
        var dot = frame.dots[d]
        var color = dot.color || (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth))
        var n
        if (dot.d) {
          n = el('path', { d: dot.d, fill: color, opacity: dot.opacity, transform: 'translate(' + dot.x + ' ' + dot.y + ') rotate(' + (dot.rot || 0) + ') scale(100)' })
        } else {
          n = el('circle', { cx: dot.x, cy: dot.y, r: dot.r, fill: color, opacity: dot.opacity })
        }
        host.appendChild(n)
      }

      // 通知徽标
      if (frame.notif) {
        notifC.removeAttribute('display')
        notifC.setAttribute('cx', frame.notif.x); notifC.setAttribute('cy', frame.notif.y); notifC.setAttribute('r', frame.notif.r)
      } else notifC.setAttribute('display', 'none')

      if (opts.onFrame) opts.onFrame(frame, engine)
    }

    function tick(ms) {
      if (closed) return
      // 自清理：宿主容器被外部全量重绘移除（如 renderMessages 重建引导区）时，
      // 脱离文档即停帧销毁——调用方无需任何簿记
      if (!svg.isConnected) { close(); return }
      raf = requestAnimationFrame(tick)
      var dt = last ? Math.min((ms - last) / 1000, 0.064) : 0
      last = ms
      clock += dt
      advance()
      if (follow && !documentHidden) { refreshBox(); aim() }
      render(engine.sample(clock))
    }

    function onPointerMove(ev) { if (ev.pointerType !== 'touch') pointer = { x: ev.clientX, y: ev.clientY } }
    function onPointerLeave() { pointer = null }
    function onVis() {
      documentHidden = document.hidden
      if (documentHidden && aiming) { engine.setLook(null, clock); aiming = false } // 隐藏页停帧，松开视线防卡姿态
    }
    function onResize() { bbox = null }

    // 真销毁：停帧、摘监听、移除 DOM（tick 检测到宿主脱离时也会走到这里）
    function close() {
      if (closed) return
      closed = true
      cancelAnimationFrame(raf)
      if (follow) {
        window.removeEventListener('pointermove', onPointerMove)
        document.removeEventListener('pointerleave', onPointerLeave)
      }
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', onResize)
      if (svg.parentNode) svg.parentNode.removeChild(svg)
    }

    if (follow) {
      window.addEventListener('pointermove', onPointerMove, { passive: true })
      document.addEventListener('pointerleave', onPointerLeave)
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', onResize)

    if (cycle && cycle.length) engine.setState(cycle[0].state, 0)
    raf = requestAnimationFrame(tick)

    return {
      el: svg,
      engine: engine,
      setState: function (id) { engine.setState(id, clock) },
      setBusy: function (on) {
        // setBusy(true)：常驻 thinking（打字机三点）；false：回到循环
        if (on) {
          cycle = null
          engine.setState('thinking', clock)
        } else {
          cycle = (opts.cycle === undefined ? IDLE_CYCLE : opts.cycle) || null
          cycleIdx = 0
          cycleStart = clock
          if (cycle && cycle.length) engine.setState(cycle[0].state, clock)
        }
      },
      close: close
    }
  }

  window.BloubMount = { mount: mount, IDLE_CYCLE: IDLE_CYCLE }
})()

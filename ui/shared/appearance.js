/* ======== 六面世界 · 外观应用（主题/调色板/字体/圆角/密度/布局/阅读）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第四刀：appearance 集群（applyTheme / applyAppearance /
 * applyReading）。迁移前两侧 app.js 逐字相同（39 行）。cfg 为共享可变配置对象
 * （按引用注入，属性读写直通）；darkMQ / resolvedTheme / PALETTES / api.setTheme
 * 由 app.js 注入 —— 双方案差异只在注入值（如 proto 的 PALETTES 清单），不在逻辑。
 * 测试保护：e2e-mock.cjs theme-applied / palette-* / readwidth-* / fontsize-* 断言（含
 * 磁贴点击与拖拽手柄提交的自定义像素宽度）。挂载：<script src="../shared/appearance.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createAppearance(ctx) {
    // cfg 是 app.js 里可被整体重赋值的配置对象（设置保存后 cfg = Object.assign({}, ...)），
    // 因此经 ctx.cfg() 每次取当前引用，不能在闭包里捕获旧对象
    const cfg = () => ctx.cfg()
    const PALETTES = ctx.PALETTES
    const api = ctx.api

    function applyTheme(theme) {
      cfg().theme = theme
      const root = document.documentElement
      root.setAttribute('data-theme', ctx.resolvedTheme())
      root.setAttribute('data-palette', PALETTES.some((p) => p.id === cfg().palette) ? cfg().palette : 'classic')
      // nativeTheme 负责系统标题栏/滚动条：system/dark/light 原样透传
      api.setTheme(theme === 'dark' || theme === 'light' ? theme : 'system')
    }

    // 外观全量应用：调色板 / 展示字体 / 圆角 / 文字密度 / 布局 / 侧栏方向
    function applyAppearance() {
      const root = document.documentElement
      root.setAttribute('data-palette', PALETTES.some((p) => p.id === cfg().palette) ? cfg().palette : 'classic')
      root.setAttribute('data-theme', ctx.resolvedTheme())
      const fonts = ['sans', 'serif', 'mono', 'kai']
      root.setAttribute('data-font', fonts.includes(cfg().fontUI) ? cfg().fontUI : 'sans')
      const radii = ['none', 'small', 'standard', 'round']
      if ((cfg().radius || 'standard') !== 'standard') root.setAttribute('data-radius', radii.includes(cfg().radius) ? cfg().radius : 'standard')
      else root.removeAttribute('data-radius')
      const dens = ['compact', 'standard', 'relaxed']
      if ((cfg().density || 'standard') !== 'standard') root.setAttribute('data-density', dens.includes(cfg().density) ? cfg().density : 'standard')
      else root.removeAttribute('data-density')
      const layouts = ['sidebar', 'focus', 'immersive']
      document.body.classList.remove('layout-focus', 'layout-immersive')
      if (layouts.includes(cfg().layout) && cfg().layout !== 'sidebar') document.body.classList.add('layout-' + cfg().layout)
      document.body.classList.toggle('sb-right', cfg().sbSide === 'right')
    }

    // ---- 阅读体验：字号 / 栏宽（data 属性驱动 CSS 变量） ----
    // readWidth 允许数字（拖拽手柄产出的自定义 px 值）；预设名之外的有限数字按 px 应用，
    // 其余（含 NaN / 0 / 负数 / 乱字符串）回退 standard
    function applyReading() {
      const root = document.documentElement
      const fs = { small: '13px', standard: '14.5px', large: '16px' }
      const rw = { narrow: '640px', standard: '720px', wide: '860px', xwide: '980px' }
      const v = cfg().readWidth
      const custom = Number(v)
      const rwv = rw[v] || (v !== '' && v !== null && v !== undefined && Number.isFinite(custom) && custom >= 420 ? custom + 'px' : rw.standard)
      root.setAttribute('data-fontsize', cfg().fontSize || 'standard')
      root.style.setProperty('--read-w', rwv)
      root.style.setProperty('--font-size', fs[cfg().fontSize] || fs.standard)
    }

    // 校验并规范 readWidth：预设名直接透传，其余当作像素值夹取到 [420, 1600]；失败回 standard
    function setReadWidth(value) {
      const rw = ['narrow', 'standard', 'wide', 'xwide']
      if (rw.includes(value)) { cfg().readWidth = value; return value }
      const px = Math.round(Number(value))
      if (!Number.isFinite(px) || px < 420) { cfg().readWidth = 'standard'; return 'standard' }
      cfg().readWidth = Math.min(1600, px)
      return cfg().readWidth
    }

    // ---- 阅读栏宽度拖拽手柄（三方案共享）：贴在阅读列右缘，拖动即改 --read-w ----
    // 拖动只改运行态（applyReading 每 move 一次，纯 CSS 变量赋值，无 IO）；松手才提交持久化。
    // 双击 / Enter / 0 复位默认；左右方向键微调（Shift ×40 / 普通 ×16）。
    function createReadWidthHandle() {
      if (document.querySelector('.read-width-handle')) return null
      const chat = document.querySelector('main.chat') || document.querySelector('.chat')
      const msgs = document.getElementById('messages')
      if (!chat || !msgs) return null
      const handle = document.createElement('div')
      handle.className = 'read-width-handle'
      handle.title = '拖动调整阅读栏宽度 · 双击恢复默认'
      handle.setAttribute('role', 'slider')
      handle.setAttribute('aria-label', '阅读栏宽度（拖动调整，双击恢复默认）')
      handle.setAttribute('aria-orientation', 'vertical')
      handle.tabIndex = 0
      chat.appendChild(handle)

      const RW_MIN = 420, RW_MAX = 1600
      const PRESET_PX = { narrow: 640, standard: 720, wide: 860, xwide: 980 }
      const toPx = (v) => {
        const px = Math.round(Number(v))
        return PRESET_PX[v] || (Number.isFinite(px) && px >= RW_MIN ? Math.min(RW_MAX, px) : PRESET_PX.standard)
      }

      // 实测阅读列右缘：优先量 assistant 消息（proto 里 user 气泡窄且右对齐，不能当列宽样本）；
      // 没有消息时按「列在容器内容盒居中」推算。拖动中 --read-w 变化 → 量到的是活的列缘。
      const columnRight = () => {
        const sample = msgs.querySelector('.msg.assistant') || msgs.querySelector('.msg')
        if (sample) {
          const r = sample.getBoundingClientRect()
          if (r.width > 0) return r.right
        }
        const msgsRect = msgs.getBoundingClientRect()
        const cs = getComputedStyle(msgs)
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
        const contentW = Math.max(0, msgsRect.width - padX)
        return msgsRect.left + msgsRect.width / 2 + Math.min(toPx(cfg().readWidth), contentW) / 2
      }

      // 锚定实际渲染的阅读列右缘。把手是 chat 的 absolute 子节点——left/top 必须用
      // chat 原点坐标系（chat 是 position:relative）。把手「中心」压在列缘上（±8px），
      // 抓取点即列缘，抓取无跳变。纵向只占消息区（不压 header / composer）
      const position = () => {
        const chatRect = chat.getBoundingClientRect()
        const msgsRect = msgs.getBoundingClientRect()
        handle.style.left = Math.round(Math.min(columnRight(), chatRect.right - 16) - 8 - chatRect.left) + 'px'
        handle.style.top = Math.max(0, Math.round(msgsRect.top - chatRect.top)) + 'px'
        handle.style.height = Math.max(0, Math.round(msgsRect.height)) + 'px'
        handle.setAttribute('aria-valuemin', String(RW_MIN))
        handle.setAttribute('aria-valuemax', String(RW_MAX))
        handle.setAttribute('aria-valuenow', String(toPx(cfg().readWidth)))
        handle.setAttribute('aria-valuetext', '阅读栏宽 ' + toPx(cfg().readWidth) + ' 像素（左右方向键微调，双击恢复默认）')
      }

      let dragging = false, moved = false, before = null
      const onMove = (e) => {
        if (!dragging) return
        // 增量拖拽：以按下时实测的列右缘为锚（滚动条出现时列不与容器几何居中，
        // 用「指针位移 = 列宽增量」而不是「指针到中线的距离 = 半宽」，两种都跟手且无跳变）
        const w = Math.min(RW_MAX, Math.max(RW_MIN, grabEdgeW + (e.clientX - grabX) * 2))
        moved = true
        setReadWidth(w)
        applyReading()
        position()
        ctx.onReadWidthLive && ctx.onReadWidthLive(cfg().readWidth)
      }
      const onUp = () => {
        if (!dragging) return
        dragging = false
        handle.classList.remove('dragging')
        document.body.classList.remove('read-width-resizing')
        if (moved) ctx.onReadWidthSet && ctx.onReadWidthSet(cfg().readWidth)
      }
      const cancelDrag = () => {
        dragging = false
        handle.classList.remove('dragging')
        document.body.classList.remove('read-width-resizing')
        setReadWidth(before)
        applyReading()
        position()
      }
      let grabX = 0, grabEdgeW = 0
      handle.addEventListener('pointerdown', (e) => {
        dragging = true; moved = false; before = cfg().readWidth
        grabX = e.clientX
        grabEdgeW = toPx(cfg().readWidth)
        handle.classList.add('dragging')
        document.body.classList.add('read-width-resizing')
        try { handle.setPointerCapture(e.pointerId) } catch { /* noop */ }
        e.preventDefault()
      })
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
      const reset = () => {
        setReadWidth('standard')
        applyReading()
        position()
        ctx.onReadWidthSet && ctx.onReadWidthSet('standard')
      }
      handle.addEventListener('dblclick', reset)
      handle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === '0') { e.preventDefault(); reset() }
        else if (e.key === 'Escape' && dragging) { e.preventDefault(); cancelDrag() }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          const w = toPx(cfg().readWidth) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 40 : 16)
          setReadWidth(w)
          applyReading()
          position()
          ctx.onReadWidthLive && ctx.onReadWidthLive(cfg().readWidth)
          window.clearTimeout(handle._commit)
          handle._commit = window.setTimeout(() => ctx.onReadWidthSet && ctx.onReadWidthSet(cfg().readWidth), 600)
        }
      })
      window.addEventListener('resize', position)
      // --read-w 写在 documentElement 的 style 上，主题弹层预设 / 设置窗口预览 / 键盘 Ctrl+=
      // 都走 applyReading —— 观察 style 属性即可在所有路径后重新贴边
      const mo = new MutationObserver(position)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
      position()
      return {
        el: handle,
        reposition: position,
        destroy: () => { mo.disconnect(); window.removeEventListener('resize', position); handle.remove() }
      }
    }

    return { applyTheme, applyAppearance, applyReading, setReadWidth, createReadWidthHandle }
  }

  window.AppearancePanel = { createAppearance }
})()

/* ======== 六面世界 · 故事进度条（节点渲染 / 悬停小窗 / 滚动同步填充 / 一次性提示）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第九刀（二）：rail 集群（buildProgressRail /
 * tryShowRailHint / updateRailFill / railSnippet / showRailPop / hideRailPop，
 * 共 105 行）。迁移前两侧 app.js 逐字相同；无可变模块级状态（全部即时 DOM）。
 * 测试保护：e2e-mock 双方案矩阵（消息渲染/滚动/跳转链路）。
 * 挂载：<script src="../shared/rail-panel.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createRailPanel(ctx) {
    const $ = ctx.$
    const getMsgEl = ctx.msgEl // () => #messages（可变绑定经 getter 桥接——C1 修复：曾被按值解构，对函数调 querySelector 致节点点击/滚动填充全静默失效）
    const { cancelHideAnim, hideWithAnim } = ctx

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
        const el = getMsgEl().querySelector('[data-mi="' + b.i + '"]')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      nodesEl.appendChild(n)
    })
    updateRailFill()
    tryShowRailHint()
  }


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


  function updateRailFill() {
    const fill = $('rail-fill')
    const rail = $('progress-rail')
    if (!fill || !rail) return
    const me = getMsgEl()
    const frac = me.scrollHeight > me.clientHeight
      ? me.scrollTop / (me.scrollHeight - me.clientHeight)
      : 1
    fill.style.height = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%'
  }


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


    return { buildProgressRail, tryShowRailHint, updateRailFill, hideRailPop }
  }

  window.RailPanel = { createRailPanel }
})()

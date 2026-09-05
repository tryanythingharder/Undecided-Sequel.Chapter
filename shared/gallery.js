/* ======== 六面世界 · 插图画廊（经典 / 原型工作台 双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第三刀：gallery 集群（openGallery / closeGallery /
 * buildGallerySessionSelect / renderGallery）。迁移前两侧 app.js 逐字相同（129 行）。
 * 外部依赖经 ctx 注入：sessions/currentId 等可变状态用 getter/setter 桥接
 * （重绘按钮切会话写 currentId；删图改写消息对象后走 saveSessions 落盘）。
 * 测试保护：e2e-mock.cjs gallery-* 断言 + 插图重绘/删除交互。
 * 挂载：<script src="../shared/gallery.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createGallery(ctx) {
    const $ = ctx.$

    function openGallery() {
      buildGallerySessionSelect()
      renderGallery()
      ctx.cancelHideAnim($('gallery'))
      ctx.cancelHideAnim($('gallery-mask'))
      $('gallery').hidden = false
    }
    function closeGallery() {
      ctx.closeModalAnim($('gallery'), $('gallery-mask'), () => { $('gallery').hidden = true })
    }
    function buildGallerySessionSelect() {
      const sel = $('gallery-session')
      // 工作区隔离：画廊只列当前工作区的会话
      const wsS = ctx.wsSessions()
      // 默认选中当前会话；若 select 已有合法值则沿用（用于切换会话后重建）
      const prev = sel && sel.value ? sel.value : null
      const cur = (prev && wsS.some((s) => s.id === prev)) ? prev : (ctx.currentId() || (wsS[0] && wsS[0].id) || '')
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
      const s = ctx.sessions().find((x) => x.id === sid) || null
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
        img.addEventListener('click', () => ctx.viewIllust(m.illust, allIllusts))
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
        excerpt.textContent = ctx.summarize(m.content)
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
          if (ctx.isBusy()) { ctx.toast('请等当前回合结束', 'info'); return }
          // 切到对应会话再重绘
          if (s.id !== ctx.currentId()) {
            ctx.setCurrentId(s.id)
            ctx.saveStore()
            ctx.renderSessionList()
            ctx.renderMessages()
            ctx.updateTitle()
            buildGallerySessionSelect()
          }
          closeGallery()
          ctx.generateIllust(i, true)
        })
        const sb = document.createElement('button')
        sb.textContent = '↓'
        sb.title = '保存这张插图到本地'
        sb.addEventListener('click', () => {
          ctx.downloadIllust(m.illust, i)
        })
        const db = document.createElement('button')
        db.textContent = '×'
        db.className = 'del'
        db.title = '删除这张插图（不影响对话文字）'
        db.addEventListener('click', () => {
          ctx.confirmDialog({
            title: '删除这张插图？',
            body: '将从画廊与对话中移除该插图，对话文字保留。',
            danger: true,
            okText: '删除'
          }).then((ok) => {
            if (!ok) return
            m.illust = null
            m.illustAt = null
            m.illustError = null
            ctx.saveSessions()
            renderGallery()
            if (s.id === ctx.currentId()) ctx.renderMessages()
            ctx.toast('已删除插图', 'info')
          })
        })
        actions.appendChild(rb); actions.appendChild(sb); actions.appendChild(db)
        media.appendChild(img); media.appendChild(excerptWrap); media.appendChild(actions)
        card.appendChild(media); card.appendChild(meta)
        body.appendChild(card)
      })
    }

    return { openGallery, closeGallery, buildGallerySessionSelect, renderGallery }
  }

  window.GalleryPanel = { createGallery }
})()

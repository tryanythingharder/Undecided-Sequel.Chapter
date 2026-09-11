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
      // 非模态抽屉：不做焦点陷阱（对话区仍可用），只把焦点移进来并在关闭后还原
      window.A11y && window.A11y.focusFirst($('gallery'))
    }
    function closeGallery() {
      ctx.closeModalAnim($('gallery'), $('gallery-mask'), () => {
        $('gallery').hidden = true
        window.A11y && window.A11y.restore(document.getElementById('btn-gallery'))
      })
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
      const keepScroll = body.scrollTop // 全量重建前记下滚动位置，重建后还原（删除一张不再跳回顶部）
      body.innerHTML = ''
      const imgs = s ? s.messages.map((m, i) => ({ m, i })).filter((x) => x.m.illust) : []
      $('gallery-count').textContent = s ? (s.title + ' · ' + imgs.length + ' 张插图') : '无会话'
      if (!imgs.length) {
        const e = document.createElement('div')
        e.className = 'gallery-empty'
        const msg = document.createElement('div')
        msg.className = 'gallery-empty-msg'
        msg.textContent = s ? '这条世界线还没有插图。' : '暂无会话。'
        e.appendChild(msg)
        if (s) {
          const hint = document.createElement('div')
          hint.className = 'gallery-empty-hint'
          hint.textContent = '在对话中点击「插图」按钮，或到设置里开启自动插图。'
          const go = document.createElement('button')
          go.className = 'primary gallery-empty-go'
          go.textContent = '回到对话'
          go.addEventListener('click', () => { closeGallery(); if (ctx.focusInput) ctx.focusInput() })
          e.appendChild(hint); e.appendChild(go)
        }
        body.appendChild(e)
        body.scrollTop = 0
        return
      }
      // 大图查看器的图集：提到循环外算一次（原来每张卡都重建整个数组，O(n²)）
      const allIllusts = imgs.map((x) => x.m.illust)
      imgs.forEach(({ m, i }) => {
        const card = document.createElement('div')
        card.className = 'gallery-card'
        const media = document.createElement('div')
        media.className = 'gallery-media'
        const time = m.illustAt
          ? new Date(m.illustAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : ('第' + (i + 1) + '条')
        const img = document.createElement('img')
        img.src = m.illust
        img.alt = '插图 · ' + time
        img.title = '点击查看大图'
        // 骨架屏：加载前显示占位动画，加载完成后淡入；异步解码避免大图卡住主线程（R81）
        img.loading = 'lazy'
        img.decoding = 'async'
        img.addEventListener('load', () => img.classList.add('loaded'))
        // 重绘：闭包里的 m 是渲染时捕获的对象，消息裁剪后原索引会失效——
        // 点击时用 indexOf 重新定位，找不到就提示用户重开画廊（防清空另一条消息的插图）
        const redraw = () => {
          if (ctx.isBusy()) { ctx.toast('请等当前回合结束', 'info'); return }
          const idx = s.messages.indexOf(m)
          if (idx < 0 || s.messages[idx] !== m) { ctx.toast('这条插图对应的消息已变化，请重新打开画廊', 'info'); return }
          if (ctx.illustReady && !ctx.illustReady()) { ctx.toast('请先在设置里配置图像模型', 'err'); return }
          if (s.id !== ctx.currentId()) {
            if (ctx.switchToSession) ctx.switchToSession(s.id)
            else {
              ctx.setCurrentId(s.id); ctx.saveStore()
              ctx.renderSessionList(); ctx.renderMessages(); ctx.updateTitle()
              buildGallerySessionSelect()
            }
            ctx.toast('已切换到《' + s.title + '》，开始重绘', 'info')
          }
          closeGallery()
          ctx.generateIllust(idx, true)
        }
        // 加载失败兜底：坏图/外置文件丢失时给明确反馈与重试入口（原来只留永久空白）
        const showError = () => {
          if (media.querySelector('.gallery-card-error')) return
          const err = document.createElement('div')
          err.className = 'gallery-card-error'
          const t = document.createElement('div')
          t.textContent = '插图加载失败'
          const rb = document.createElement('button')
          rb.type = 'button'
          rb.textContent = '重绘这张'
          rb.addEventListener('click', (ev) => { ev.stopPropagation(); redraw() })
          err.appendChild(t); err.appendChild(rb)
          media.appendChild(err)
        }
        img.addEventListener('error', showError)
        // 传入画廊全部插图，Lightbox 中可 ← → 切换
        img.addEventListener('click', () => ctx.viewIllust(m.illust, allIllusts))
        // R33b 键盘可达：Enter/Space 打开大图
        img.tabIndex = 0
        img.setAttribute('role', 'button')
        img.setAttribute('aria-label', '查看大图 · ' + time)
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
        meta.textContent = time
        // 悬浮操作组：原型 K 的进卡显形按钮（重绘/存/删）
        const actions = document.createElement('div')
        actions.className = 'hover-actions'
        const rb = document.createElement('button')
        rb.textContent = '↻'
        rb.title = '重新生成这张插图（重绘）'
        rb.setAttribute('aria-label', '重新生成这张插图')
        rb.addEventListener('click', redraw)
        const sb = document.createElement('button')
        sb.textContent = '↓'
        sb.title = '保存这张插图到本地'
        sb.setAttribute('aria-label', '保存这张插图到本地')
        sb.addEventListener('click', () => {
          ctx.downloadIllust(m.illust, i)
        })
        const db = document.createElement('button')
        db.textContent = '×'
        db.className = 'del'
        db.title = '删除这张插图（不影响对话文字）'
        db.setAttribute('aria-label', '删除这张插图')
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
      body.scrollTop = keepScroll
    }

    return { openGallery, closeGallery, buildGallerySessionSelect, renderGallery }
  }

  window.GalleryPanel = { createGallery }
})()

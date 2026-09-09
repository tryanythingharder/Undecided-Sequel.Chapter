/* ======== 六面世界 · 会话内搜索（Ctrl+F）（经典 / 原型工作台 双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第二刀：search 集群（markMessage / openSearch /
 * closeSearch / runSearch / searchStep + scrollToActiveMatch）。迁移前两侧 app.js
 * 逐字相同（95 行）；搜索态（query/matches/active）内化到本模块，renderMessages
 * 通过 SearchPanel.state() 读取高亮态。DOM 引用与兄弟函数（escapeHtml /
 * escapeRegExp / curSession / renderMessages / cancelHideAnim / hideWithAnim /
 * msgEl / renderWindow 扩窗语义）由 app.js 注入 ctx —— 双方案差异只在注入值，
 * 不在逻辑。RENDER_WINDOW 常量从注入方取，避免双份漂移。
 * 测试保护：e2e-mock.cjs search-* 断言（打开/计数/高亮/跳转/关闭）。
 * 挂载：<script src="../shared/search.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createSearch(ctx) {
    // ---- 搜索态（模块私有；renderMessages 经 state() 读取） ----
    let searchQuery = ''
    let searchMatches = [] // [{ msgIdx, count }]
    let searchActive = -1  // 全局命中序号（0-based）

    const $ = ctx.$
    const msgEl = ctx.msgEl

    function markMessage(content, query) {
      if (!query) return null
      const re = new RegExp(ctx.escapeRegExp(query), 'gi')
      let count = 0
      let out = ''
      let last = 0
      let m
      while ((m = re.exec(content)) !== null) {
        count++
        out += ctx.escapeHtml(content.slice(last, m.index))
        out += '<mark data-i="' + (count - 1) + '">' + ctx.escapeHtml(m[0]) + '</mark>'
        last = m.index + m[0].length
        if (m.index === re.lastIndex) re.lastIndex++ // 防止零宽死循环
      }
      out += ctx.escapeHtml(content.slice(last))
      return { html: out, count }
    }

    // 搜索框打开/关闭
    function openSearch() {
      const searchBar = ctx.searchBar
      const searchInput = ctx.searchInput
      if (!searchBar.hidden) { searchInput.focus(); searchInput.select(); return }
      ctx.cancelHideAnim(searchBar)
      searchBar.hidden = false
      searchInput.value = searchQuery
      searchInput.focus()
      runSearch(searchQuery)
    }
    function closeSearch() {
      const searchBar = ctx.searchBar
      if (searchBar.hidden) return
      ctx.hideWithAnim(searchBar, () => { searchBar.hidden = true })
      searchQuery = ''
      searchMatches = []
      searchActive = -1
      ctx.renderMessages()
      ctx.focusInput()
    }

    // 执行搜索：计算命中、更新计数、跳到第一个命中
    function runSearch(q) {
      searchQuery = String(q || '')
      searchMatches = []
      searchActive = -1
      const s = ctx.curSession()
      if (searchQuery && s) {
        const re = new RegExp(ctx.escapeRegExp(searchQuery), 'gi')
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
      ctx.renderMessages()
      scrollToActiveMatch()
    }

    // 跳到当前命中：把对应 mark 标 active 并滚入视野（按绝对消息下标定位；不在窗口内则先扩窗加载）
    function scrollToActiveMatch() {
      if (searchActive < 0) return
      let target = searchActive
      const s = ctx.curSession()
      for (const x of searchMatches) {
        if (target < x.count) {
          let msg = msgEl.querySelector('.msg[data-mi="' + x.msgIdx + '"]')
          if (!msg && s) {
            // 目标在渲染窗口之外：扩窗加载后重找（聊天历史分页语义）
            ctx.expandRenderWindow(s.messages.length - x.msgIdx + ctx.RENDER_WINDOW)
            ctx.renderMessages()
            msg = msgEl.querySelector('.msg[data-mi="' + x.msgIdx + '"]')
          }
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

    return {
      markMessage,
      openSearch,
      closeSearch,
      runSearch,
      searchStep,
      // renderMessages 读取搜索态（高亮命中消息 + markMessage 纯文本高亮）
      state: () => ({ query: searchQuery, matches: searchMatches, active: searchActive }),
    }
  }

  window.SearchPanel = { createSearch }
})()

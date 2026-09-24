(function () {
  'use strict'
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el }
  const command = (text, action, cls = 'ghost') => { const button = node('button', cls, text); button.type = 'button'; button.addEventListener('click', action); return button }
  const date = (value) => new Date(value).toLocaleString('zh-CN', { hour12: false })

  function create(ctx) {
    let active = null
    function open(title) {
      if (active) active.close()
      const trigger = document.activeElement
      const mask = node('div', 'product-mask')
      const panel = node('section', 'product-panel')
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title)
      const head = node('header', 'product-head')
      const heading = node('h2', '', title)
      const closeButton = command('×', () => close(), 'product-close')
      closeButton.title = '关闭'; closeButton.setAttribute('aria-label', '关闭')
      head.append(heading, closeButton)
      const body = node('div', 'product-body')
      panel.append(head, body); mask.append(panel); document.body.append(mask)
      const onKey = (event) => {
        if (document.querySelector('.confirm-mask')) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
        if (event.key === 'Tab') window.A11y.trapTab(panel, event)
      }
      document.addEventListener('keydown', onKey, true)
      mask.addEventListener('click', (event) => { if (event.target === mask) close() })
      function close() { document.removeEventListener('keydown', onKey, true); mask.remove(); if (active?.mask === mask) active = null; window.A11y.restore(trigger) }
      active = { mask, body, close }
      closeButton.focus()
      return active
    }
    function status(body, message, error) { const el = node('p', 'product-status' + (error ? ' error' : ''), message); el.setAttribute('role', error ? 'alert' : 'status'); body.append(el); return el }
    async function withButton(button, action) { button.disabled = true; try { await action() } catch (error) { ctx.toast(error.message || String(error), 'err') } finally { button.disabled = false } }
    async function archives() {
      const view = open('存档中心')
      /* 存档操作串行化：面板级在途闸门，避免「创建/恢复/删除」并发导致的落盘竞态；
       * 所有异步回调在面板关闭后一律丢弃。 */
      let inFlight = false
      const live = () => document.contains(view.mask)
      const guarded = (label, action) => withButton(label, async () => {
        if (!live()) return
        if (inFlight) throw new Error('正在处理上一个存档操作，请稍候')
        inFlight = true
        try { await action() } finally { inFlight = false }
      })
      const toolbar = node('div', 'product-toolbar')
      const input = node('input'); input.placeholder = '存档名称'; input.setAttribute('aria-label', '存档名称'); input.maxLength = 120
      const save = command('创建存档', () => guarded(save, async () => {
        if (ctx.busy()) throw new Error('请等待当前生成与记忆保存完成')
        const written = await ctx.saveSessions(true)
        if (!written || written.ok === false) throw new Error((written && written.error) || '世界线尚未保存，已取消创建存档')
        const result = await ctx.api.archiveCreate({ ...ctx.context(), label: input.value.trim() || ctx.session()?.title || '手动存档' })
        if (!live()) return
        if (!result.ok) throw new Error(result.error)
        ctx.toast('完整存档已创建', 'ok'); input.value = ''; await refresh()
      }), 'primary')
      const importButton = command('导入存档', () => guarded(importButton, async () => {
        const result = await ctx.api.archiveImport()
        if (!live() || result.canceled) return
        if (!result.ok) throw new Error(result.error)
        await refresh(); ctx.toast('存档已加入列表，选择恢复后生效', 'ok')
      }))
      toolbar.append(input, save, importButton); view.body.append(toolbar)
      const list = node('div', 'product-list'); view.body.append(list)
      async function refresh() {
        const result = await ctx.api.archiveList()
        if (!live()) return
        list.replaceChildren()
        if (!result.ok) { status(list, result.error, true); return }
        if (!result.items.length) { status(list, '暂无存档'); return }
        for (const item of result.items) {
          const row = node('article', 'product-row')
          const copy = node('div', 'product-copy')
          copy.append(node('strong', '', item.label), node('small', '', date(item.createdAt) + ' · ' + item.sessions + ' 条世界线 · ' + item.messages + ' 条消息 · ' + (item.bytes / 1048576).toFixed(1) + ' MB'))
          const actions = node('div', 'product-actions')
          const restore = command('恢复', () => guarded(restore, async () => {
            if (ctx.busy()) throw new Error('请等待当前生成完成')
            const confirmed = await ctx.confirm({ title: '恢复此存档？', body: '当前全部世界线、作品与记忆将恢复到「' + item.label + '」。当前状态会先自动存档，可再次恢复。', okText: '恢复存档' })
            if (!confirmed || !live()) return
            // 恢复前必须先确认当前状态落盘成功，否则放弃恢复（前端状态保持不变）
            const flushed = await ctx.saveSessions(true)
            if (!flushed || flushed.ok === false) throw new Error((flushed && flushed.error) || '当前状态保存失败，已取消恢复存档')
            const r = await ctx.api.archiveRestore({ id: item.id })
            if (!live()) return
            if (!r.ok) throw new Error(r.error)
            ctx.toast('已恢复完整存档，恢复前状态已备份', 'ok'); await refresh()
          }))
          const exportButton = command('导出', () => guarded(exportButton, async () => { const r = await ctx.api.archiveExport({ id: item.id }); if (!live() || r.canceled) return; if (r.ok) ctx.toast('存档已导出', 'ok'); else throw new Error(r.error) }))
          const del = command('删除', () => guarded(del, async () => { if (!await ctx.confirm({ title: '删除存档？', body: '只删除「' + item.label + '」这份备份，当前世界线不受影响。', danger: true, okText: '删除存档' })) return; if (!live()) return; const r = await ctx.api.archiveDelete({ id: item.id }); if (!live()) return; if (!r.ok) throw new Error(r.error); await refresh() }))
          del.classList.add('danger'); actions.append(restore, exportButton, del); row.append(copy, actions); list.append(row)
        }
      }
      await refresh()
    }
    function jump(index, view) { view.close(); ctx.jump(index) }
    /* 章节 → 引擎回合区间：优先取分章时记录的 turnRange，其次由该段消息的 engineTurn 推导 */
    function chapterTurnRange(messages, chapter) {
      if (chapter.turnRange) return chapter.turnRange
      const turns = messages.slice(chapter.start, chapter.end).map((m) => Number(m.engineTurn)).filter((n) => Number.isFinite(n) && n > 0)
      return turns.length ? { fromTurn: Math.min(...turns), toTurn: Math.max(...turns) } : null
    }
    function chapters() {
      const s = ctx.session(); if (!s) return
      const storyId = s.id
      const view = open('章节与续玩')
      /* 异步回调护栏：世界线切换或面板关闭后，任何在途结果一律丢弃（防误操作/串线） */
      const live = () => ctx.session()?.id === storyId && document.contains(view.mask)
      const focusInput = () => {
        view.close()
        const input = document.getElementById('input')
        if (input) { input.focus(); input.scrollIntoView({ block: 'nearest' }) }
        else ctx.toast('未找到输入框，请在主界面继续输入', 'info')
      }
      const toolbar = node('div', 'product-toolbar')
      const createButton = command('结束本章', () => withButton(createButton, async () => {
        if (!live()) return
        if (ctx.busy()) { ctx.toast('请等待当前回合完成', 'info'); return }
        const chapters = s.chapters || []
        const start = chapters.length ? chapters[chapters.length - 1].end : 0
        if (s.messages.length <= start) { ctx.toast('本章还没有新的故事', 'info'); return }
        const title = await ctx.prompt({ title: '章节标题', value: '第 ' + (chapters.length + 1) + ' 章', okText: '保存章节' })
        if (!title || !live()) return
        const excerptOf = (m, index) => ({ index, text: String(m.content).replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').slice(0, 160) })
        const range = s.messages.slice(start).map((m, offset) => ({ m, index: start + offset }))
        const excerpts = range.filter(({ m }) => m.role === 'assistant' && !String(m.content).startsWith('⚠')).map(({ m, index }) => excerptOf(m, index)).filter((x) => x.text)
        const turns = range.map(({ m }) => Number(m.engineTurn)).filter((n) => Number.isFinite(n) && n > 0)
        const previous = chapters
        const chapter = { id: 'ch-' + Date.now().toString(36), title, start, end: s.messages.length, createdAt: Date.now(), excerpts: excerpts.slice(-3) }
        if (turns.length) chapter.turnRange = { fromTurn: Math.min(...turns), toTurn: Math.max(...turns) }
        s.chapters = previous.concat(chapter)
        const written = await ctx.saveSessions(true)
        if (written && written.ok === false) { s.chapters = previous; render(); throw new Error(written.error || '章节保存失败，已回滚本章') }
        render()
      }), 'primary')
      toolbar.append(createButton, command('继续输入', focusInput))
      view.body.append(toolbar)
      const list = node('div', 'product-list'); view.body.append(list)
      let data = null, recap = null, recapLoaded = false
      const goalsSection = () => {
        const goals = (data && data.goals) || []
        if (!goals.length) return null
        const section = node('section', 'chapter-section')
        section.append(node('h3', '', '未完成目标 / 活跃承诺'))
        for (const goal of goals) {
          const row = node('article', 'memory-row')
          row.append(node('p', '', goal.text))
          row.append(node('small', '', ['承诺', goal.dueHint ? '期限：' + goal.dueHint : '', goal.turn ? '第 ' + goal.turn + ' 幕' : ''].filter(Boolean).join(' · ')))
          section.append(row)
        }
        return section
      }
      const charactersSection = () => {
        const characters = (data && data.characters) || []
        if (!characters.length) return null
        const section = node('section', 'chapter-section')
        section.append(node('h3', '', '关键人物'))
        for (const person of characters) {
          const row = node('article', 'memory-row')
          row.append(node('h3', '', person.name))
          if (person.summary) row.append(node('p', '', person.summary))
          const relations = (person.relationships || []).map((r) => r.with + (r.type ? '（' + r.type + '）' : '')).join('、')
          const meta = [relations ? '关系：' + relations : '', person.turn ? '首见第 ' + person.turn + ' 幕' : ''].filter(Boolean).join(' · ')
          if (meta) row.append(node('small', '', meta))
          for (const fact of person.facts || []) {
            const link = command(fact.text, () => jumpTurn(fact.turn, view), 'chapter-excerpt')
            link.title = fact.turn ? '第 ' + fact.turn + ' 幕原文' : '查看原文'
            row.append(link)
          }
          section.append(row)
        }
        return section
      }
      /* 上一章回顾：只用账本原文摘录（明确标注非 AI 总结），引擎回顾不可用时降级为分章时抓取的本地摘录 */
      const recapSection = (chapters) => {
        const prev = chapters[chapters.length - 1]
        if (!prev) return null
        const section = node('section', 'chapter-section chapter-recap')
        section.append(node('h3', '', '上一章回顾 · ' + prev.title))
        section.append(node('p', 'recap-note', '以下为原文摘录（非 AI 总结），点击可回到原文核对。'))
        const items = (recap && recap.excerpts) || []
        if (items.length) {
          section.append(node('small', '', '原文摘录 · 第 ' + recap.fromTurn + '–' + recap.toTurn + ' 幕 · ' + items.length + ' 条' + (recap.truncated ? '（仅显示最近 ' + items.length + ' 条）' : '')))
          for (const item of items) {
            const link = command(item.text, () => jumpTurn(item.turn, view), 'chapter-excerpt')
            link.title = '第 ' + item.turn + ' 幕原文'
            section.append(link)
          }
          return section
        }
        const local = prev.excerpts || []
        if (local.length) {
          section.append(node('small', '', '本地原文摘录（引擎回顾不可用时的降级显示，非 AI 总结）'))
          for (const excerpt of local) {
            const link = command(excerpt.text, () => jump(excerpt.index, view), 'chapter-excerpt')
            link.title = '查看原文'; section.append(link)
          }
          return section
        }
        section.append(node('p', 'product-status', '本章没有可回顾的原文摘录'))
        return section
      }
      function jumpTurn(turn, view) {
        const index = s.messages.findIndex((m) => m.role === 'assistant' && Number(m.engineTurn) === Number(turn))
        if (index < 0) { ctx.toast('该原文未关联到当前世界线的消息', 'info'); return }
        jump(index, view)
      }
      function render() {
        list.replaceChildren()
        const chapters = s.chapters || []
        const recapBlock = recapSection(chapters)
        if (recapBlock) list.append(recapBlock)
        const goals = goalsSection(); if (goals) list.append(goals)
        const people = charactersSection(); if (people) list.append(people)
        if (!chapters.length) status(list, '尚未分章 · ' + s.messages.filter((m) => m.role === 'assistant').length + ' 幕')
        for (const chapter of chapters.slice().reverse()) {
          const section = node('section', 'chapter-section')
          const head = node('div', 'product-row')
          head.append(node('h3', '', chapter.title), command('回到本章', () => jump(chapter.start, view)))
          section.append(head)
          for (const excerpt of chapter.excerpts || []) {
            const link = command(excerpt.text, () => jump(excerpt.index, view), 'chapter-excerpt')
            link.title = '查看原文'; section.append(link)
          }
          list.append(section)
        }
        const tail = s.messages.map((m, index) => ({ m, index })).filter(({ m }) => m.role === 'assistant').slice(-1)[0]
        if (tail) { const section = node('section', 'chapter-section'); section.append(node('h3', '', '最近一幕'), command(String(tail.m.content).slice(0, 260), () => jump(tail.index, view), 'chapter-excerpt')); list.prepend(section) }
      }
      ;(async () => {
        try {
          const r = await ctx.api.engineMemory({ storyId })
          if (!live()) return
          if (r && r.ok) data = r.data
        } catch { /* 记忆不可读时仍展示章节与本地摘录 */ }
        if (!live()) return
        render()
        const chapters = s.chapters || []
        const prev = chapters[chapters.length - 1]
        const range = prev && chapterTurnRange(s.messages, prev)
        if (!range || recapLoaded) return
        recapLoaded = true
        try {
          const r = await ctx.api.engineMemory({ storyId, fromTurn: range.fromTurn, toTurn: range.toTurn })
          if (!live()) return
          if (r && r.ok && r.data && r.data.recap) recap = r.data.recap
        } catch { /* 降级为本地摘录 */ }
        if (live()) render()
      })()
      render()
    }
    async function memory() {
      const s = ctx.session(); if (!s) return
      const storyId = s.id
      const view = open('世界记忆')
      /* 异步回调护栏：切换世界线/关闭面板后在途的读取与纠错结果一律丢弃 */
      const live = () => ctx.session()?.id === storyId && document.contains(view.mask)
      let category = 'events', data = null
      const tabs = node('div', 'product-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '记忆分类')
      /* 标签顺序：账本原文在前，派生视图（未完成目标/关键人物）居中，伏笔与修正记录相邻
       * —— 修正记录是伏笔/事实等记录的改动留痕，紧跟其后便于对照（也保持既有键盘导航预期）。 */
      const labels = { events: '最近变化', facts: '已知事实', relationships: '人物关系', commitments: '承诺', goals: '未完成目标', characters: '关键人物', threads: '伏笔', corrections: '修正记录' }
      const list = node('div', 'product-list')
      Object.entries(labels).forEach(([key, label]) => { const button = command(label, () => { category = key; render() }, 'product-tab'); button.dataset.category = key; button.setAttribute('role', 'tab'); tabs.append(button) })
      view.body.append(tabs, list)
      function source(item) {
        const index = s.messages.findIndex((m) => m.role === 'assistant' && m.engineTurn === item.turn)
        if (index >= 0) return command('第 ' + item.turn + ' 幕原文', () => jump(index, view), 'ghost')
        return node('small', '', item.turn ? '第 ' + item.turn + ' 个记忆回合 · 原文未关联' : '历史记忆')
      }
      function render() {
        if (!live()) return
        for (const tab of tabs.children) { const on = tab.dataset.category === category; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1 }
        list.replaceChildren()
        const items = data?.[category] || []
        if (!items.length) { status(list, '暂无' + labels[category]); return }
        for (const item of items) {
          const row = node('article', 'memory-row')
          if (category === 'characters') {
            row.append(node('h3', '', item.name))
            if (item.summary) row.append(node('p', '', item.summary))
            const relations = (item.relationships || []).map((r) => r.with + (r.type ? '（' + r.type + '）' : '')).join('、')
            if (relations) row.append(node('small', '', '关系：' + relations))
            for (const fact of item.facts || []) {
              const link = command(fact.text, () => jumpTurn(fact.turn, view), 'chapter-excerpt')
              link.title = fact.turn ? '第 ' + fact.turn + ' 幕原文' : '查看原文'; row.append(link)
            }
            const actions = node('div', 'product-actions'); actions.append(source({ turn: item.turn }))
            row.append(actions); list.append(row); continue
          }
          if (item.title) row.append(node('h3', '', item.title))
          if (category === 'corrections') {
            row.append(node('p', 'memory-before', item.before), node('p', '', item.after))
            row.append(node('small', '', '原因：' + item.reason + ' · ' + date(item.at) + (item.sourceTurn ? ' · 来源第 ' + item.sourceTurn + ' 幕' : '')))
            if ((item.history || []).length > 1) {
              const detail = node('details', 'memory-history')
              detail.append(node('summary', '', '修正历史（' + item.history.length + ' 次）'))
              for (const h of item.history) detail.append(node('p', '', date(h.at) + ' · ' + h.before + ' → ' + h.after + '（' + h.reason + '）'))
              row.append(detail)
            }
            list.append(row); continue
          }
          row.append(node('p', '', item.text))
          if (item.dueHint) row.append(node('small', '', '期限：' + item.dueHint))
          const actions = node('div', 'product-actions'); actions.append(source(item))
          if (item.kind) actions.append(command('纠正记忆', () => edit(item)))
          row.append(actions)
          list.append(row)
        }
      }
      function jumpTurn(turn, view) {
        const index = s.messages.findIndex((m) => m.role === 'assistant' && Number(m.engineTurn) === Number(turn))
        if (index < 0) { ctx.toast('该原文未关联到当前世界线的消息', 'info'); return }
        jump(index, view)
      }
      async function refresh() {
        const r = await ctx.api.engineMemory({ storyId })
        if (!live()) return
        if (!r.ok) throw new Error(r.error)
        data = r.data; render()
      }
      function edit(item) {
        list.replaceChildren()
        const form = node('form', 'memory-form')
        const label = node('label', '', '修正内容'), input = node('textarea'); input.value = item.text; input.maxLength = 800; input.rows = 5; label.append(input)
        const reasonLabel = node('label', '', '修正原因'), reason = node('input'); reason.maxLength = 300; reason.required = true; reasonLabel.append(reason)
        const actions = node('div', 'product-actions')
        const save = command('保存修正', () => withButton(save, async () => {
          if (!live()) return
          if (ctx.busy()) throw new Error('请等待当前回合完成')
          const r = await ctx.api.engineCorrectMemory({ storyId, kind: item.kind, id: item.id, text: input.value, reason: reason.value })
          if (!live()) return
          if (!r.ok) throw new Error(r.error)
          data = r.data; render(); ctx.toast('记忆已修正，原内容保留在修正记录中', 'ok')
        }), 'primary')
        actions.append(save, command('取消', render)); form.append(label, reasonLabel, actions); form.addEventListener('submit', (event) => event.preventDefault()); list.append(form); input.focus()
      }
      tabs.addEventListener('keydown', (event) => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const buttons = [...tabs.children]; const current = buttons.indexOf(document.activeElement); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length; buttons[next].click(); buttons[next].focus() })
      try { await refresh() } catch (error) { if (live()) status(list, error.message, true) }
    }
    /* 入口挂载：三套布局共用同一套 DOM id，宿主按「实际可见」选择，不假设 .chat-head-right 一定显示。
     * proto 方案用 CSS 把 .chat-head-right 整体 display:none（proto/styles.css），若仍往那里挂，
     * 按钮会以 0×0 不可见且不可点——与 author-tools.js 的入口约定保持一致：头部不可见时退到
     * 会话栏底部（三套界面共有，与「存档」同列）。方案切换会整窗重载，mount() 会重新执行。
     * 入口按最终顺序构造后一次性 prepend（prepend(a,b,c) 保持 a,b,c 顺序），避免多次 prepend 次序颠倒。 */
    function mount() {
      const head = document.querySelector('.chat-head-right')
      const headVisible = !!(head && getComputedStyle(head).display !== 'none')
      const headHost = headVisible ? head : null
      const foot = document.querySelector('.sidebar-foot')
      const grouped = new Map()
      const plan = [
        ['btn-story-chapters', '章节', chapters, '章节与续玩'],
        ['btn-story-memory', '记忆', memory, '人物、承诺与伏笔'],
        ['btn-archives', '存档', archives, '完整存档、导入与恢复']
      ]
      for (const [id, label, action, title] of plan) {
        if (document.getElementById(id)) continue
        const host = headHost && id !== 'btn-archives' ? headHost : foot
        if (!host) continue
        const button = command(label, action, host === headHost ? 'tool-btn' : 'side-btn')
        button.id = id; button.title = title
        if (!grouped.has(host)) grouped.set(host, [])
        grouped.get(host).push(button)
      }
      for (const [host, buttons] of grouped) host.prepend(...buttons)
    }
    mount()
    return { archives, chapters, memory, open }
  }
  window.ProductTools = { create }
})()

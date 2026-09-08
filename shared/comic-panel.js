/* ======== 六面世界 · 漫画回放（Comic Replay）（双方案共享） ========
 * 一键把世界线从头（或指定回合范围）生成为漫画：事件账本 → 分镜规划（pet:agent
 * comic 任务 / 每回合一张本地模式）→ 串行逐幕生图（断点续跑/暂停/单幕重绘）→
 * 应用内阅读视图（← → 翻页）→ 自包含 HTML 导出。
 * 数据落 session.comic（不占消息插图位）；图片外置由主进程 externalizeSessions
 * 统一处理（collectImages 同规则覆盖 comic.panels）。
 * 测试保护：e2e-mock 双方案矩阵 comic-* 断言（规划→画图→阅读→导出/断点续跑）+
 * unit test-engine-comic（素材压缩/范围过滤）+ test-storage-sessions（comic 外置/水合）。
 * 挂载：<script src="../shared/comic-panel.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createComicPanel(ctx) {
    const api = ctx.api
    const cfg = ctx.cfg
    const $ = ctx.$
    const { curSession, saveSessions, confirmDialog, toast } = ctx

    // 面板参数记忆（localStorage）：上次幕数/密度/范围
    const LS_KEY = 'sixworlds.comic.pref'
    function loadPref() {
      try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
    }
    function savePref(p) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(p)) } catch {}
    }

    /* ---------- 分镜提示词构建：风格 + cast 外观 + 场景行 + 叙事 ---------- */
    function panelPrompt(panel, comic, styleText) {
      const look = (comic.cast || [])
        .filter((c) => (panel.participants || []).includes(c.name))
        .map((c) => c.name + ': ' + c.look)
        .join('; ')
      const scene = panel.sceneLine || ''
      const narr = String(panel.narration || '')
      const parts = [styleText]
      if (look) parts.push('Characters present: ' + look)
      if (scene) parts.push('Scene: ' + scene)
      parts.push('Depicted: ' + narr)
      return parts.join('. ')
    }

    /* ---------- 规划器：预估面板（起止回合 + 密度 + 幕数 + 预估 + 续画/重画） ---------- */
    async function openPlanner() {
      const s = curSession()
      if (!s) return
      if (queueRunning) { toast('漫画队列进行中——可点顶部胶囊暂停/继续', 'info'); return }
      // 续画/重画分流：已有分镜时先问意图（续画=自动范围上批末尾+1 → 当前）
      if (s.comic && s.comic.panels && s.comic.panels.length) {
        const cont = await confirmDialog({
          title: '这条世界线已有漫画分镜',
          body: '续画：从上次画到的回合继续补到当前进度（已有的幕保留）。重画：清空现有分镜重新规划。',
          okText: '续画',
          cancelText: '重画'
        })
        if (cont) {
          const total = await currentEngineTurn(s.id)
          return planAndRun({ fromTurn: latestTurn(s) + 1, toTurn: total, resume: true })
        }
        return plannerModal({ resume: false })
      }
      return plannerModal({ resume: false })
    }

    function latestTurn(s) {
      return (s.comic && s.comic.panels && s.comic.panels.length)
        ? Math.max.apply(null, s.comic.panels.map((p) => Number(p.turn) || 0)) : 0
    }

    /* 预估面板 modal：起止回合选择器（默认 1 → 当前）+ 密度模式 + 目标幕数 + 预估 */
    async function plannerModal(opts) {
      const s = curSession()
      if (!s) return
      const total = await currentEngineTurn(s.id)
      if (!total || total < 1) { toast('这条世界线还没有可入画的回合（先推进剧情）', 'info'); return }
      const pref = loadPref()
      let from = Math.min(Math.max(1, Number(pref.fromTurn) || 1), total)
      let to = total
      let mode = pref.mode === 'every' ? 'every' : 'ai'
      let count = Math.min(32, Math.max(8, Number(pref.panelCount) || 16))

      let mask = document.getElementById('comic-planner')
      if (mask) mask.remove()
      mask = document.createElement('div')
      mask.id = 'comic-planner'
      mask.className = 'confirm-mask comic-planner-mask'
      const box = document.createElement('div')
      box.className = 'confirm comic-planner'
      const head = document.createElement('div')
      head.className = 'confirm-title'
      head.textContent = '生成漫画回放'
      const bodyEl = document.createElement('div')
      bodyEl.className = 'confirm-body comic-planner-body'

      // 起止回合
      const rowRange = document.createElement('div')
      rowRange.className = 'comic-planner-row'
      rowRange.innerHTML = '<label>起止回合</label>'
      const fromInput = document.createElement('input')
      fromInput.id = 'comic-from'
      fromInput.type = 'number'
      fromInput.min = 1
      fromInput.max = total
      fromInput.value = from
      const dash = document.createElement('span')
      dash.textContent = '→'
      const toInput = document.createElement('input')
      toInput.id = 'comic-to'
      toInput.type = 'number'
      toInput.min = 1
      toInput.max = total
      toInput.value = to
      rowRange.appendChild(fromInput); rowRange.appendChild(dash); rowRange.appendChild(toInput)
      const rangeHint = document.createElement('div')
      rangeHint.className = 'comic-planner-hint'
      rangeHint.textContent = '共 ' + total + ' 个回合（当前进度第 ' + total + ' 回合）'
      bodyEl.appendChild(rowRange)
      bodyEl.appendChild(rangeHint)

      // 密度模式
      const rowMode = document.createElement('div')
      rowMode.className = 'comic-planner-row'
      rowMode.innerHTML = '<label>选幕方式</label>'
      const modeSel = document.createElement('select')
      modeSel.id = 'comic-mode'
      const optAi = document.createElement('option')
      optAi.value = 'ai'; optAi.textContent = 'AI 精选关键幕（有分镜节奏）'
      const optEvery = document.createElement('option')
      optEvery.value = 'every'; optEvery.textContent = '每回合一张（完整但量大）'
      modeSel.appendChild(optAi); modeSel.appendChild(optEvery)
      modeSel.value = mode
      rowMode.appendChild(modeSel)
      bodyEl.appendChild(rowMode)

      // 目标幕数（AI 模式）
      const rowCount = document.createElement('div')
      rowCount.className = 'comic-planner-row'
      rowCount.innerHTML = '<label>目标幕数</label>'
      const countInput = document.createElement('input')
      countInput.id = 'comic-count'
      countInput.type = 'number'
      countInput.min = 8
      countInput.max = 32
      countInput.value = count
      rowCount.appendChild(countInput)
      const countHint = document.createElement('span')
      countHint.className = 'comic-planner-hint'
      countHint.textContent = '（8~32，AI 精选模式的节奏参考）'
      rowCount.appendChild(countHint)
      bodyEl.appendChild(rowCount)

      const est = document.createElement('div')
      est.className = 'comic-planner-estimate'
      bodyEl.appendChild(est)
      const refreshEst = () => {
        from = Math.min(Math.max(1, Number(fromInput.value) || 1), total)
        to = Math.min(Math.max(from, Number(toInput.value) || total), total)
        fromInput.value = from; toInput.value = to
        const turnsInRange = Math.max(0, to - from + 1)
        mode = modeSel.value
        count = Math.min(32, Math.max(8, Number(countInput.value) || 16))
        const n = mode === 'every' ? turnsInRange : Math.min(count, turnsInRange)
        const mins = Math.max(1, Math.round(n * 15 / 60))
        est.textContent = '预计绘制 ' + n + ' 幕 · 约 ' + mins + ' 分钟起（费用取决于你的生图端点计价）'
      }
      fromInput.addEventListener('input', refreshEst)
      toInput.addEventListener('input', refreshEst)
      modeSel.addEventListener('change', refreshEst)
      countInput.addEventListener('input', refreshEst)
      refreshEst()

      const foot = document.createElement('div')
      foot.className = 'confirm-foot'
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'cancel'
      cancelBtn.id = 'comic-cancel'
      cancelBtn.textContent = '取消'
      const startBtn = document.createElement('button')
      startBtn.className = 'primary'
      startBtn.id = 'comic-start'
      startBtn.textContent = '开始生成'
      foot.appendChild(cancelBtn); foot.appendChild(startBtn)
      box.appendChild(head); box.appendChild(bodyEl); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)

      const done = await new Promise((resolve) => {
        const onKey = (e) => {
          if (e.key === 'Escape') { cleanup(); close(null) }
          else if (e.key === 'Enter') { cleanup(); close(true) }
        }
        const cleanup = () => document.removeEventListener('keydown', onKey)
        const close = (val) => {
          mask.classList.add('closing')
          setTimeout(() => { mask.remove(); resolve(val) }, 200)
        }
        document.addEventListener('keydown', onKey)
        cancelBtn.addEventListener('click', () => { cleanup(); close(null) })
        startBtn.addEventListener('click', () => { cleanup(); close(true) })
        mask.addEventListener('click', (e) => { if (e.target === mask) { cleanup(); close(null) } })
      })
      if (!done) return
      // 面板参数记忆（下次默认沿用）
      savePref(Object.assign({}, pref, { mode, panelCount: count, fromTurn: from }))
      planAndRun({ fromTurn: from, toTurn: to, resume: false })
    }

    async function planAndRun(opts) {
      const s = curSession()
      if (!s) return
      const fromTurn = Math.max(1, Number(opts && opts.fromTurn) || 1)
      const toTurn = Number(opts && opts.toTurn) || 0
      const src = await fetchSource(s.id, fromTurn, toTurn)
      if (!src) return
      const mode = loadPref().mode === 'every' ? 'every' : 'ai'
      const target = Math.min(32, Math.max(8, Number(loadPref().panelCount) || 16))

      // 分镜规划
      let comic = null
      if (mode === 'every') {
        comic = localPanels(src, target) // 每回合一张：本地确定性展开，不调 LLM
      } else {
        const r = await api.petAgent({
          task: 'comic',
          story: storyText(src),
          castText: castText(src),
          panelCount: target,
          cloud: cloudCfg()
        })
        if (!r || !r.ok) {
          toast('分镜规划失败：' + ((r && r.error) || '未知错误') + '（可切「每回合一张」模式绕过）', 'err', 6000)
          return
        }
        comic = r.plan
      }
      if (!comic || !Array.isArray(comic.panels) || !comic.panels.length) {
        toast('该范围没有可入画的剧情素材', 'err')
        return
      }
      // 写入 session.comic（续画=追加；重画=重建）
      const prev = (opts && opts.resume && s.comic) ? s.comic : null
      const prevPanels = prev ? prev.panels.filter((p) => !p.illustError || p.illust) : []
      s.comic = {
        version: 1,
        createdAt: prev ? prev.createdAt : Date.now(),
        updatedAt: Date.now(),
        cast: mergeCast(prev && prev.cast, comic.cast),
        panels: prevPanels.concat(comic.panels.map((q, i) => ({
          idx: (prev ? prevPanels.length : 0) + i,
          turn: q.turn,
          title: q.title || '',
          sceneLine: q.sceneLine || '',
          narration: q.narration || '',
          participants: q.participants || [],
          prompt: '',
          illust: null, illustAsset: null, illustAt: null, illustPending: false, illustError: null
        })))
      }
      s.comic.progress = { state: 'planning', done: countDone(s.comic), failed: 0 }
      saveSessions()
      runQueue()
    }

    function countDone(comic) {
      return comic.panels.filter((p) => p.illust).length
    }

    function mergeCast(prevCast, newCast) {
      const out = Array.isArray(prevCast) ? prevCast.slice() : []
      for (const c of (newCast || [])) {
        if (!c || !c.name) continue
        const i = out.findIndex((x) => x.name === c.name)
        if (i >= 0) out[i] = c // 新规划覆盖旧外貌（重画时以最新为准）
        else out.push(c)
      }
      return out.slice(0, 24)
    }

    async function currentEngineTurn(storyId) {
      const r = await api.engineOverview({ storyId })
      return (r && r.ok && r.data && r.data.engine_turn) || 1
    }

    async function fetchSource(storyId, fromTurn, toTurn) {
      const r = await api.engineComicSource({ storyId, fromTurn, toTurn })
      if (!r || !r.ok || !r.data) {
        toast('剧情素材读取失败：' + ((r && r.error) || '未知错误'), 'err')
        return null
      }
      return r.data
    }

    /* 每回合一张：本地确定性展开（events 逐回合 → 一幕） */
    function localPanels(src, target) {
      const panels = []
      for (const t of (src.turns || [])) {
        const evs = (t.events || []).filter((e) => e && e.description)
        if (!evs.length && !t.summary) continue
        const top = evs[0] || null
        panels.push({
          turn: t.turn,
          title: (t.summary || (top && top.description) || '第' + t.turn + '幕').slice(0, 40),
          narration: (t.summary || (top && top.description) || '').slice(0, 160),
          participants: (t.scene && t.scene.participants) || [],
          sceneLine: sceneLineOf(t)
        })
        if (panels.length >= 200) break // 2000 张闸门 + 每回合上限双保险
      }
      return { cast: (src.cast || []).map((c) => ({ name: c.name, look: c.summary || c.name })), panels }
    }

    function sceneLineOf(t) {
      const time = t.game_time || (t.scene && t.scene.game_time) || ''
      const loc = t.location || (t.scene && t.scene.location) || ''
      return (time || loc) ? ('【' + [time, loc].filter(Boolean).join('｜') + '】') : ''
    }

    /* 素材 → 文本（喂给云端大脑） */
    function storyText(src) {
      const lines = []
      for (const t of (src.turns || [])) {
        const head = '第' + t.turn + '幕 ' + (t.location ? ('@' + t.location) : '') + (t.game_time ? (' ' + t.game_time) : '')
        const parts = []
        if (t.summary) parts.push(t.summary)
        for (const e of (t.events || []).slice(0, 4)) {
          if (e && e.description) parts.push(e.description + '（' + (e.importance || 0) + '）')
        }
        if (!parts.length) continue
        lines.push(head + '：' + parts.join('；'))
      }
      return lines.join('\n').slice(0, 24000)
    }

    function castText(src) {
      return (src.cast || []).map((c) => c.name + '：' + (c.summary || '') + (c.state ? ' 状态:' + c.state : '')).join('\n').slice(0, 6000)
    }

    function cloudCfg() {
      const c = cfg() || {}
      return (c.baseUrl && (c.apiKey) && c.model) ? { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model } : null
    }

    /* ---------- 生成队列：串行逐幕（重试 1 次 / 暂停 / 断点续跑） ---------- */
    let queueRunning = false
    let paused = false

    async function runQueue() {
      const s = curSession()
      if (!s || !s.comic) return
      if (queueRunning) return
      queueRunning = true
      paused = false
      const styleText = ctx.stylePrompt()
      const island = createIsland()
      try {
        const panels = s.comic.panels
        for (let i = 0; i < panels.length; i++) {
          if (paused) break
          const p = panels[i]
          if (p.illust) continue // 已画（断点续跑：跳过）
          if (!(await drawPanel(s, p, styleText))) break
          island.update(countDone(s.comic) + ' / ' + countAll(s.comic))
        }
        s.comic.progress = {
          state: paused ? 'paused' : 'done',
          done: countDone(s.comic),
          failed: s.comic.panels.filter((x) => x.illustError).length
        }
        s.comic.updatedAt = Date.now()
        saveSessions()
        if (!paused && !s.comic.panels.some((x) => x.illustError)) {
          toast('漫画回放完成：共 ' + countDone(s.comic) + ' 幕', 'ok')
          api.notify && api.notify({ title: '漫画回放完成', body: '共 ' + countDone(s.comic) + ' 幕，可在画廊打开阅读' })
        } else if (!paused) {
          toast('漫画回放结束（有 ' + s.comic.panels.filter((x) => x.illustError).length + ' 幕失败，可在阅读视图单幕重绘）', 'info', 6000)
        }
        if (typeof ctx.onComicProgress === 'function') ctx.onComicProgress(s.comic.progress)
      } finally {
        queueRunning = false
        island.close()
      }
    }

    function countAll(comic) {
      return comic.panels.filter((p) => p.illust || p.illustError || p.illustPending).length
    }

    async function drawPanel(s, p, styleText) {
      p.illustPending = true
      p.illustError = null
      saveSessions()
      const attempt = () => api.generateImage({
        baseUrl: cfg().illustBaseUrl,
        apiKey: cfg().illustApiKey || cfg().apiKey,
        model: cfg().illustModel,
        prompt: panelPrompt(p, s.comic, styleText),
        size: cfg().illustSize,
        quality: cfg().illustQuality || 'default',
        negative: cfg().illustNegative,
        seedLock: cfg().illustSeedLock,
        seed: cfg().illustSeed,
        n: 1
      })
      let r = await attempt()
      if (!r || !r.ok) {
        await new Promise((res) => setTimeout(res, 800))
        r = await attempt()
      }
      p.illustPending = false
      if (r && r.ok) {
        p.illust = r.dataUrl
        p.illustAt = Date.now()
        p.illustError = null
        const cost = Number(r.cost != null ? r.cost : ((r.usage && r.usage.cost) != null ? r.usage.cost : NaN))
        if (Number.isFinite(cost)) {
          s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
          s.tokens.cost = (s.tokens.cost || 0) + cost
        }
      } else {
        p.illustError = (r && r.error) || '未知错误'
      }
      saveSessions()
      return true
    }

    /* 进度岛：独立 DOM（不进 .toast-wrap、不用 .toast 类——e2e toast 选择器隔离约定） */
    function createIsland() {
      let el = document.getElementById('comic-island')
      if (el) el.remove()
      el = document.createElement('div')
      el.id = 'comic-island'
      el.className = 'island-busy comic-island'
      el.setAttribute('aria-hidden', 'true')
      const dot = document.createElement('span')
      dot.className = 'island-dot'
      const txt = document.createElement('span')
      txt.className = 'island-txt'
      txt.textContent = '漫画回放 · 规划分镜中…'
      const pauseBtn = document.createElement('button')
      pauseBtn.className = 'comic-island-btn'
      pauseBtn.textContent = '暂停'
      pauseBtn.addEventListener('click', () => {
        paused = !paused
        pauseBtn.textContent = paused ? '继续' : '暂停'
      })
      el.appendChild(dot); el.appendChild(txt); el.appendChild(pauseBtn)
      document.body.appendChild(el)
      return {
        update(text) { txt.textContent = '漫画回放 · ' + text + ' 幕' },
        close() {
          el.classList.add('leaving')
          setTimeout(() => el.remove(), 320)
        }
      }
    }

    /* ---------- 阅读视图 ---------- */
    let viewIdx = 0
    let closeViewFn = null

    function openView() {
      const s = curSession()
      if (!s || !s.comic || !s.comic.panels.length) {
        toast('还没有漫画分镜——先在画廊点「生成漫画回放」', 'info')
        return
      }
      const mask = document.createElement('div')
      mask.id = 'comic-view'
      mask.className = 'comic-view'
      const stage = document.createElement('div')
      stage.className = 'comic-stage'
      mask.appendChild(stage)
      const navPrev = document.createElement('button')
      navPrev.className = 'comic-nav comic-nav-prev'
      navPrev.innerHTML = '‹'
      navPrev.title = '上一幕（←）'
      const navNext = document.createElement('button')
      navNext.className = 'comic-nav comic-nav-next'
      navNext.innerHTML = '›'
      navNext.title = '下一幕（→）'
      mask.appendChild(navPrev); mask.appendChild(navNext)
      const closeBtn = document.createElement('button')
      closeBtn.className = 'comic-view-close'
      closeBtn.innerHTML = '×'
      closeBtn.title = '关闭（Esc）'
      mask.appendChild(closeBtn)
      const exportBtn = document.createElement('button')
      exportBtn.className = 'comic-view-export'
      exportBtn.textContent = '导出 HTML'
      exportBtn.title = '导出为自包含漫画 HTML'
      mask.appendChild(exportBtn)
      document.body.appendChild(mask)

      const panels = s.comic.panels
      const renderPanel = () => {
        const p = panels[viewIdx]
        if (!p) return
        stage.innerHTML = ''
        const page = document.createElement('div')
        page.className = 'comic-page'
        const counter = document.createElement('div')
        counter.className = 'comic-counter'
        counter.textContent = (viewIdx + 1) + ' / ' + panels.length + ' · ' + (p.title || ('第 ' + p.turn + ' 回合'))
        const img = document.createElement('img')
        img.className = 'comic-img'
        img.src = p.illust || ''
        img.alt = p.title || '漫画分镜'
        if (!p.illust) {
          const ph = document.createElement('div')
          ph.className = 'comic-placeholder'
          ph.textContent = p.illustError ? ('生成失败：' + p.illustError) : (p.illustPending ? '绘制中…' : '未绘制（回到画廊继续生成）')
          if (p.illustError || !p.illustPending) {
            const rb = document.createElement('button')
            rb.className = 'comic-redraw'
            rb.textContent = p.illustError ? '↻ 重绘这一幕' : '绘制这一幕'
            rb.addEventListener('click', async () => {
              if (queueRunning) { toast('队列进行中，稍后再试', 'info'); return }
              p.illustError = null
              await drawPanel(curSession(), p, ctx.stylePrompt())
              renderPanel()
            })
            ph.appendChild(document.createElement('br'))
            ph.appendChild(rb)
          }
          page.appendChild(ph)
        } else {
          page.appendChild(img)
        }
        const narr = document.createElement('div')
        narr.className = 'comic-narr'
        const scene = document.createElement('div')
        scene.className = 'comic-scene'
        scene.textContent = p.sceneLine || ''
        const title = document.createElement('div')
        title.className = 'comic-title'
        title.textContent = (viewIdx + 1) + '. ' + (p.title || '') + (p.turn ? '（第' + p.turn + '回合）' : '')
        const body = document.createElement('div')
        body.className = 'comic-body'
        body.textContent = p.narration || ''
        narr.appendChild(scene); narr.appendChild(title); narr.appendChild(body)
        page.appendChild(narr)
        stage.appendChild(counter)
        stage.appendChild(page)
      }
      const step = (dir) => {
        const next = viewIdx + dir
        if (next < 0 || next >= panels.length) return
        viewIdx = next
        renderPanel()
      }
      navPrev.addEventListener('click', () => step(-1))
      navNext.addEventListener('click', () => step(1))
      exportBtn.addEventListener('click', () => exportHtml())
      const onKey = (e) => {
        if (e.key === 'Escape') close()
        else if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
      }
      const close = () => {
        mask.classList.add('closing')
        setTimeout(() => mask.remove(), 160)
        document.removeEventListener('keydown', onKey)
        mask.removeEventListener('comic-close', close)
        closeViewFn = null
      }
      closeBtn.addEventListener('click', close)
      mask.addEventListener('comic-close', close) // 全局 Esc 链经此事件先关视图（不连带关画廊）
      mask.addEventListener('click', (e) => { if (e.target === mask) close() })
      document.addEventListener('keydown', onKey)
      closeViewFn = close
      // 从最新已画幕开始读
      let lastDone = -1
      panels.forEach((p, i) => { if (p.illust) lastDone = i })
      viewIdx = Math.max(0, lastDone)
      renderPanel()
    }

    function closeView() { if (closeViewFn) closeViewFn() }

    /* ---------- HTML 导出（自包含：内嵌 base64 图 + 分镜排版） ---------- */
    async function exportHtml() {
      const s = curSession()
      if (!s || !s.comic) return
      const panels = s.comic.panels.filter((p) => p.illust)
      if (!panels.length) { toast('还没有画好的幕可导出', 'info'); return }
      const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      const hydrated = await Promise.all(panels.map(async (p) => {
        if (!String(p.illust).startsWith('sixworlds-asset:')) return p
        const loaded = await api.readImageDataUrl(p.illust)
        return Object.assign({}, p, { illust: loaded && loaded.ok ? loaded.dataUrl : null })
      }))
      const sections = hydrated.map((p, i) => {
        const img = p.illust ? ('<figure><img src="' + esc(p.illust) + '" alt="' + esc(p.title) + '" /></figure>') : ''
        return '<section class="panel"><div class="panel-head">' + esc(p.sceneLine) + '</div>' + img +
          '<h3>' + (i + 1) + '. ' + esc(p.title) + '</h3><p>' + esc(p.narration) + '</p></section>'
      }).join('\n')
      const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(s.title) + ' · 漫画回放</title><style>' +
        'body{font-family:Georgia,"Noto Serif SC",serif;max-width:860px;margin:40px auto;padding:0 20px;background:#f7f4ee;color:#2b2823;line-height:1.9}' +
        'h1{font-size:24px;letter-spacing:2px;text-align:center}.meta{color:#8a857c;font-size:13px;text-align:center;margin-bottom:36px}' +
        '.panel{margin:36px 0;padding:20px 24px;background:#fffdf9;border:1px solid #e4ded2;border-radius:12px}' +
        '.panel-head{font-size:12px;letter-spacing:1px;color:#a08b5f;margin-bottom:10px}' +
        'figure{margin:0 0 14px}figure img{max-width:100%;border-radius:8px;border:1px solid #e4ded2}' +
        '.panel h3{font-size:17px;margin:0 0 8px}.panel p{white-space:pre-wrap;margin:0;font-size:15px}' +
        '</style></head><body><h1>' + esc(s.title) + '</h1><div class="meta">六面世界 · 漫画回放 · ' + hydrated.length + ' 幕 · 导出于 ' +
        new Date().toLocaleDateString('zh-CN') + '</div>' + sections + '</body></html>'
      const name = (s.title || 'sixworlds').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '-漫画.html'
      const r = await api.saveFile({ title: '导出漫画回放', defaultName: name, content: html })
      if (r && r.ok) toast('漫画已导出：' + r.path, 'ok')
      else if (r && r.error) toast('导出失败：' + r.error, 'err')
    }

    /* 断点续跑入口：应用重开后差量补缺（已在 session.comic 里但缺图的幕） */
    function resumePending() {
      const s = curSession()
      if (!s || !s.comic) return false
      if (queueRunning) return false
      const missing = s.comic.panels.some((p) => !p.illust && !p.illustError)
      if (!missing) return false
      runQueue()
      return true
    }

    return { openPlanner, planAndRun, runQueue, resumePending, openView, closeView, exportHtml, panelPrompt }
  }

  window.ComicPanel = { createComicPanel }
})()

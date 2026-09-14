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

    /* ---------- 分镜提示词构建：风格 + cast 外观 + 场景行 + 叙事 ----------
     * 漫画格构图原则：一格只画「一个瞬间」（正在发生的事，不是剧情概括）；
     * 对白/旁白由 DOM 气泡叠加，画面必须完全无文字（模型画字必成乱码）。 */
    const PANEL_COMPOSITION = {
      hero: 'single dramatic establishing panel composition, one key dramatic moment in motion, dynamic angle, cinematic framing',
      square: 'standard manga panel composition, one clear action beat, mid-shot, focus on one decisive moment',
      wide: 'wide landscape panel, panoramic scenery or transition shot, small figures in environment, horizontal framing',
      tall: 'tall vertical panel, full-body character standing pose or face-off, dramatic low angle, vertical framing'
    }
    function panelPrompt(panel, comic, styleText) {
      const look = (comic.cast || [])
        .filter((c) => (panel.participants || []).includes(c.name))
        .map((c) => c.name + ': ' + c.look)
        .join('; ')
      const scene = panel.sceneLine || ''
      const narr = String(panel.narration || '')
      const comp = PANEL_COMPOSITION[panel.size] || PANEL_COMPOSITION.square
      const parts = [styleText, comp, 'one single moment from the scene, not a summary collage']
      if (look) parts.push('Characters present: ' + look)
      if (scene) parts.push('Scene: ' + scene)
      parts.push('Depicted: ' + narr)
      parts.push('absolutely no text, no letters, no speech bubbles, no captions in the image (dialogue is overlaid separately)')
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
          size: q.size || 'square',
          dialogue: Array.isArray(q.dialogue) ? q.dialogue : [],
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
          sceneLine: sceneLineOf(t),
          size: panels.length % 4 === 0 ? 'hero' : 'square', // 轮转节奏：每页首格大
          dialogue: [] // 本地模式没有台词素材，出无对白的纯画格（旁白气泡仍会渲染）
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
        toast('还没有漫画分镜——从顶栏「作品」菜单开始生成漫画回放', 'info')
        return
      }
      const mask = document.createElement('div')
      mask.id = 'comic-view'
      mask.className = 'comic-view'
      mask.setAttribute('role', 'dialog')
      mask.setAttribute('aria-modal', 'true')
      mask.setAttribute('aria-label', '漫画回放阅读器')
      const stage = document.createElement('div')
      stage.className = 'comic-stage'
      mask.appendChild(stage)
      // 分幕列表侧栏：独立阅读视图里直接跳到任意一幕（原来只能 ← → 逐页翻，找特定一幕很费劲）
      const sidebar = document.createElement('div')
      sidebar.className = 'comic-sidebar'
      const sbHead = document.createElement('div')
      sbHead.className = 'comic-sidebar-head'
      sbHead.textContent = '分页'
      const sbCount = document.createElement('span')
      sbCount.className = 'comic-sidebar-count'
      sbHead.appendChild(sbCount)
      const list = document.createElement('div')
      list.className = 'comic-list'
      sidebar.appendChild(sbHead); sidebar.appendChild(list)
      mask.classList.add('has-list')
      mask.appendChild(sidebar)
      const navPrev = document.createElement('button')
      navPrev.className = 'comic-nav comic-nav-prev'
      navPrev.innerHTML = '‹'
      navPrev.title = '上一页（←）'
      const navNext = document.createElement('button')
      navNext.className = 'comic-nav comic-nav-next'
      navNext.innerHTML = '›'
      navNext.title = '下一页（→）'
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
      const contBtn = document.createElement('button')
      contBtn.className = 'comic-view-continue'
      contBtn.textContent = '继续生成'
      contBtn.title = '回到生成向导（续画 / 重新规划）'
      mask.appendChild(contBtn)
      document.body.appendChild(mask)

      const panels = s.comic.panels
      /* ---- 真漫画页模型：panels 按每页 4 幕切页（hero 格占双列），阅读器翻的是页 ----
       * 分页确定性（按数组顺序切块），不存 pages —— 数据形状不变，旧 session 兼容。 */
      const PAGE_SIZE = 4
      const pages = []
      for (let i = 0; i < panels.length; i += PAGE_SIZE) pages.push(panels.slice(i, i + PAGE_SIZE))
      // 列表行只建一次，renderPage 只更新高亮与状态字（避免每次翻页重建 DOM）
      const listRows = pages.map((pg, pi) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'comic-list-row'
        const idxEl = document.createElement('span')
        idxEl.className = 'comic-list-idx'
        idxEl.textContent = String(pi + 1)
        const titleEl = document.createElement('span')
        titleEl.className = 'comic-list-title'
        const t = (pg[0] && (pg[0].title || ('第 ' + pg[0].turn + ' 回合'))) || ''
        titleEl.textContent = t + ' …'
        titleEl.title = titleEl.textContent
        const stEl = document.createElement('span')
        stEl.className = 'comic-list-state'
        row.appendChild(idxEl); row.appendChild(titleEl); row.appendChild(stEl)
        row.addEventListener('click', () => { viewIdx = pi; renderPage() })
        list.appendChild(row)
        return { row, stEl }
      })
      const stateOfPage = (pg) => {
        const states = pg.map((p) => p.illust ? '✓' : (p.illustError ? '!' : (p.illustPending ? '…' : '—')))
        const uniq = [...new Set(states)]
        return uniq.length === 1 ? uniq[0] : uniq.join('')
      }
      const stateOf = (p) => p.illust ? '✓' : (p.illustError ? '!' : (p.illustPending ? '…' : '—'))

      /* ---- 气泡：对白叠在画格上（白底描边漫画气泡 / 喊话锯齿 / 内心云朵 / 低语虚线） ----
       * 旁白（narration）走画格顶部的旁白条（半透明压暗条），不再占页面下方整段。 */
      function buildBubble(d) {
        const b = document.createElement('div')
        b.className = 'comic-bubble tone-' + (d.tone || 'normal')
        const name = document.createElement('div')
        name.className = 'comic-bubble-name'
        name.textContent = d.speaker
        const line = document.createElement('div')
        line.className = 'comic-bubble-line'
        line.textContent = d.line
        b.appendChild(name); b.appendChild(line)
        return b
      }
      function buildPanelCell(p, panelNoOnPage) {
        const cell = document.createElement('div')
        cell.className = 'comic-cell size-' + (p.size || 'square')
        cell.setAttribute('data-panel-no', String(panelNoOnPage))
        if (!p.illust) {
          const ph = document.createElement('div')
          ph.className = 'comic-placeholder'
          ph.textContent = p.illustError ? ('生成失败：' + p.illustError) : (p.illustPending ? '绘制中…' : '未绘制（用「继续生成」补画）')
          if (p.illustError || !p.illustPending) {
            const rb = document.createElement('button')
            rb.className = 'comic-redraw'
            rb.textContent = p.illustError ? '↻ 重绘这一格' : '绘制这一格'
            rb.addEventListener('click', async (ev) => {
              ev.stopPropagation()
              if (queueRunning) { toast('队列进行中，稍后再试', 'info'); return }
              p.illustError = null
              await drawPanel(curSession(), p, ctx.stylePrompt())
              renderPage()
            })
            ph.appendChild(document.createElement('br'))
            ph.appendChild(rb)
          }
          cell.appendChild(ph)
        } else {
          const img = document.createElement('img')
          img.className = 'comic-img'
          img.src = p.illust || ''
          img.alt = p.title || '漫画分镜'
          cell.appendChild(img)
        }
        // 旁白条：格子顶部压暗横条（narration 只写画外旁白）
        if (p.narration) {
          const cap = document.createElement('div')
          cap.className = 'comic-caption'
          cap.textContent = p.narration
          cell.appendChild(cap)
        }
        // 对白气泡：右上/左下/右上/左上按序错开，多气泡沿边排布
        const dl = Array.isArray(p.dialogue) ? p.dialogue : []
        dl.forEach((d, di) => {
          if (!d || !d.speaker || !d.line) return
          const b = buildBubble(d)
          b.classList.add('bubble-pos-' + ((di % 4) + 1))
          cell.appendChild(b)
        })
        return cell
      }

      const renderPage = () => {
        const pg = pages[viewIdx]
        if (!pg) return
        stage.innerHTML = ''
        sbCount.textContent = (viewIdx + 1) + ' / ' + pages.length
        listRows.forEach((r, i) => {
          r.row.classList.toggle('on', i === viewIdx)
          r.stEl.textContent = stateOfPage(pages[i])
        })
        const page = document.createElement('div')
        page.className = 'comic-page comic-page-grid'
        const counter = document.createElement('div')
        counter.className = 'comic-counter'
        const first = pg[0]
        const last = pg[pg.length - 1]
        counter.textContent = '第 ' + (viewIdx + 1) + ' / ' + pages.length + ' 页 · 幕 ' +
          ((first.turn ? ('#' + first.turn) : '') || '') + '–' + (last ? ('#' + last.turn) : '')
        pg.forEach((p, i) => page.appendChild(buildPanelCell(p, i + 1)))
        const scene = document.createElement('div')
        scene.className = 'comic-scene-line'
        scene.textContent = (first.sceneLine || '') + (first.sceneLine && last.sceneLine && first.sceneLine !== last.sceneLine ? ' → ' + last.sceneLine : '')
        stage.appendChild(counter)
        stage.appendChild(page)
        stage.appendChild(scene)
      }
      const step = (dir) => {
        const next = viewIdx + dir
        if (next < 0 || next >= pages.length) return
        viewIdx = next
        renderPage()
      }
      navPrev.addEventListener('click', () => step(-1))
      navNext.addEventListener('click', () => step(1))
      exportBtn.addEventListener('click', () => exportHtml())
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); close() }
        else if (e.key === 'Tab') { window.A11y && window.A11y.trapTab(mask, e) }
        else if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
      }
      const close = () => {
        mask.classList.add('closing')
        setTimeout(() => mask.remove(), 160)
        document.removeEventListener('keydown', onKey)
        mask.removeEventListener('comic-close', close)
        window.A11y && window.A11y.restore(document.getElementById('btn-works'))
        closeViewFn = null
      }
      closeBtn.addEventListener('click', close)
      mask.addEventListener('comic-close', close) // 全局 Esc 链经此事件先关视图（不连带关画廊）
      mask.addEventListener('click', (e) => { if (e.target === mask) close() })
      // 继续生成：关阅读视图 → 回生成向导（已有分镜时向导自己会问续画/重画）
      contBtn.addEventListener('click', () => { close(); openPlanner() })
      document.addEventListener('keydown', onKey)
      closeViewFn = close
      // 从含最新已画幕的页开始读
      let lastDone = -1
      panels.forEach((p, i) => { if (p.illust) lastDone = i })
      viewIdx = Math.max(0, Math.floor(Math.max(0, lastDone) / PAGE_SIZE))
      renderPage()
      closeBtn.focus()
    }

    function closeView() { if (closeViewFn) closeViewFn() }

    /* ---------- HTML 导出（自包含：内嵌 base64 图 + 漫画页分格排版 + 气泡） ---------- */
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
      // 与阅读视图同构：每页 4 格（hero 占双列），格内叠对白气泡
      const PAGE_SIZE = 4
      const pages = []
      for (let i = 0; i < hydrated.length; i += PAGE_SIZE) pages.push(hydrated.slice(i, i + PAGE_SIZE))
      const bubbleHtml = (p) => (Array.isArray(p.dialogue) ? p.dialogue : [])
        .filter((d) => d && d.speaker && d.line)
        .map((d, di) => '<div class="bubble tone-' + esc(d.tone || 'normal') + ' pos-' + ((di % 4) + 1) + '"><i>' + esc(d.speaker) + '</i>' + esc(d.line) + '</div>')
        .join('')
      const pageHtml = (pg) => '<section class="page">' + pg.map((p) => {
        const cell = '<div class="cell size-' + esc(p.size || 'square') + '">' +
          (p.illust ? ('<img src="' + esc(p.illust) + '" alt="' + esc(p.title) + '" />') : '') +
          (p.narration ? ('<div class="cap">' + esc(p.narration) + '</div>') : '') +
          bubbleHtml(p) +
          '<div class="tag">' + esc(p.sceneLine) + ' · ' + esc(p.title) + '</div>' +
          '</div>'
        return cell
      }).join('') + '</section>'
      const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(s.title) + ' · 漫画回放</title><style>' +
        'body{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;max-width:1060px;margin:24px auto;padding:0 16px;background:#efe9de;color:#2b2823}' +
        'h1{font-size:22px;letter-spacing:3px;text-align:center;margin:28px 0 4px}.meta{color:#8a857c;font-size:12.5px;text-align:center;margin-bottom:24px}' +
        '.page{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 22px}' +
        '.cell{position:relative;overflow:hidden;border:2px solid #2b2823;border-radius:4px;background:#fffdf9;min-height:220px}' +
        '.cell.size-hero{grid-column:span 2;min-height:360px}.cell.size-wide{grid-column:span 2}.cell.size-square{}.cell.size-tall{grid-row:span 1}' +
        '.cell img{width:100%;height:100%;object-fit:cover;display:block}' +
        '.cap{position:absolute;left:0;right:0;top:0;padding:6px 12px;background:rgba(20,22,26,.72);color:#f4efe5;font-size:12.5px;line-height:1.7;z-index:2}' +
        '.bubble{position:absolute;max-width:62%;padding:7px 12px 8px;background:#fff;border:2px solid #2b2823;border-radius:14px;z-index:3;font-size:13px;line-height:1.6;box-shadow:2px 2px 0 rgba(43,40,35,.18)}' +
        '.bubble i{display:block;font-style:normal;font-size:10.5px;color:#8a7c5c;font-weight:700;margin-bottom:2px;letter-spacing:1px}' +
        '.bubble.pos-1{top:12px;right:12px}.bubble.pos-2{bottom:14px;left:12px}.bubble.pos-3{top:64px;right:12px}.bubble.pos-4{bottom:64px;left:12px}' +
        '.bubble.tone-shout{border-style:solid;background:#fff3ef;transform:rotate(-1.5deg);font-weight:700}' +
        '.bubble.tone-thought{background:#f3f2ff;border-style:dashed;border-color:#5b5b7a;border-radius:20px}' +
        '.bubble.tone-whisper{background:#f7f7f4;border-style:dotted;color:#6a6a60}' +
        '.tag{position:absolute;left:0;right:0;bottom:0;padding:4px 10px;background:rgba(43,40,35,.66);color:#e8e2d4;font-size:10.5px;letter-spacing:1px;z-index:2}' +
        '@media print{body{max-width:none}.page{break-inside:avoid}}' +
        '</style></head><body><h1>' + esc(s.title) + '</h1><div class="meta">六面世界 · 漫画回放 · ' + hydrated.length + ' 幕 · ' + pages.length + ' 页 · 导出于 ' +
        new Date().toLocaleDateString('zh-CN') + '</div>' + pages.map(pageHtml).join('\n') + '</body></html>'
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

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

  /* Pure pagination: preserve source order/references, never persist derived geometry.
   * Explicit breaks are authoritative for runs of <=6; legacy panels use beat weights.
   * Rects are normalized paper coordinates; optional polygons are local [x,y] pairs. */
  function buildComicPages(panels) {
    if (!Array.isArray(panels) || !panels.length) return []
    const hint = (p) => typeof p.layout === 'string' ? p.layout : (p.layout && p.layout.size) || p.size || 'square'
    const importance = (p) => Number((p.layout && p.layout.importance) || p.importance) || 0
    const textWeight = (p) => String(p.narration || '').length + (Array.isArray(p.dialogue) ? p.dialogue : [])
      .reduce((n, d) => n + (d ? String(d.line || '').length + String(d.speaker || '').length + 12 : 0), 0)
    const weight = (p) => ({ splash: 6, hero: 2.8, tall: 1.7, wide: 1.15 }[hint(p)] || 1) +
      Math.min(3, textWeight(p) / 220) + (importance(p) >= 8 ? .7 : 0)
    const scene = (p) => String(p.sceneLine || '').replace(/[【】]/g, '').split(/[｜|]/).pop().trim()
    const pages = []
    const explicit = panels.some((p) => p.pageBreak === true || p.pageBreak === 'before' || p.pageBreak === 'after')
    let start = 0, group = [], cost = 0
    function flush() {
      if (!group.length) return
      const pg = group
      const rows = []
      for (let i = 0; i < pg.length;) {
        const p = pg[i], type = hint(p)
        const next = pg[i + 1]
        const pair = next && !['hero', 'wide', 'splash'].includes(type) &&
          !['hero', 'wide', 'splash'].includes(hint(next))
        const ids = pair ? [i, i + 1] : [i]
        const rowWeight = Math.max(...ids.map((j) => {
          const kind = hint(pg[j])
          return (kind === 'hero' || kind === 'splash' ? 3.4 : kind === 'wide' ? .85 : kind === 'tall' ? 2.5 : 1.5) +
            Math.min(2.5, textWeight(pg[j]) / 170) + (importance(pg[j]) >= 8 ? .6 : 0)
        }))
        rows.push({ ids, weight: rowWeight }); i += ids.length
      }
      const layout = new Array(pg.length)
      const margin = .035, gx = .016, gy = .012, width = 1 - margin * 2
      // A vertical close-up beside two beats, rather than three identical horizontal strips.
      if (pg.length === 3 && hint(pg[0]) === 'tall') {
        const split = .43, top = hint(pg[1]) === 'hero' ? .62 : .53
        layout[0] = { x: margin, y: margin, width: width * split, height: 1 - margin * 2 }
        const x = margin + width * split + gx, w = width * (1 - split) - gx
        const h = 1 - margin * 2
        layout[1] = { x, y: margin, width: w, height: h * top - gy / 2 }
        layout[2] = { x, y: margin + h * top + gy / 2, width: w, height: h * (1 - top) - gy / 2 }
      } else {
        const available = 1 - margin * 2 - gy * (rows.length - 1)
        const total = rows.reduce((n, row) => n + row.weight, 0)
        let y = margin
        rows.forEach((row, ri) => {
          const height = available * row.weight / total
          if (row.ids.length === 1) layout[row.ids[0]] = { x: margin, y, width, height }
          else {
            const [a, b] = row.ids
            const leftWeight = weight(pg[a]), rightWeight = weight(pg[b])
            const split = Math.max(.36, Math.min(.64, leftWeight / (leftWeight + rightWeight) + (ri % 2 ? .055 : -.055)))
            const w = (width - gx) * split
            layout[a] = { x: margin, y, width: w, height }
            layout[b] = { x: margin + w + gx, y, width: width - gx - w, height }
            // Small inward-only slants: bounds stay disjoint and text is never clipped.
            if (textWeight(pg[a]) < 120 && textWeight(pg[b]) < 120) {
              layout[a].polygon = [[0, 0], [1, .035], [.965, 1], [0, 1]]
              layout[b].polygon = [[.035, .035], [1, 0], [1, 1], [0, 1]]
            }
          }
          y += height + gy
        })
      }
      pages.push({ panels: pg, layout, startIndex: start, aspectRatio: .70 })
      start += pg.length; group = []; cost = 0
    }
    panels.forEach((p) => {
      if (p.fullPage === true) {
        flush()
        pages.push({ panels: [p], layout: [{ x: 0, y: 0, width: 1, height: 1 }], startIndex: start, aspectRatio: p.aspectRatio || 2 / 3, fullPage: true })
        start++
        return
      }
      const before = p.pageBreak === true || p.pageBreak === 'before'
      if (before) flush()
      if (group.length && (group.length >= 6 || (!explicit &&
        (cost + weight(p) > 6.2 || (group.length >= 2 && scene(p) && scene(group[group.length - 1]) && scene(p) !== scene(group[group.length - 1])))))) flush()
      group.push(p); cost += weight(p)
      if (p.pageBreak === 'after' || (!explicit && (hint(p) === 'splash' || cost >= 6.2))) flush()
    })
    flush()
    return pages
  }

  function rectStyle(rect) {
    return 'left:' + rect.x * 100 + '%;top:' + rect.y * 100 + '%;width:' + rect.width * 100 + '%;height:' + rect.height * 100 + '%'
  }
  function polygonStyle(rect) {
    return rect.polygon ? 'clip-path:polygon(' + rect.polygon.map(([x, y]) => x * 100 + '% ' + y * 100 + '%').join(',') + ')' : ''
  }
  function inkOutline(rect) {
    const points = rect.polygon || [[0, 0], [1, 0], [1, 1], [0, 1]]
    return '<svg class="comic-ink-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="' +
      points.map(([x, y]) => x * 100 + ',' + y * 100).join(' ') + '" /></svg>'
  }
  // Shared with the offline export; scale the stack as a unit, never overlap or crop text.
  function fitComicPage(page) {
    const base = page.clientWidth * .023
    page.querySelectorAll('.comic-lettering').forEach((stack) => {
      stack.style.fontSize = base + 'px'
      const available = stack.parentElement.clientHeight * .88
      let size = base
      for (let i = 0; i < 24 && stack.scrollHeight > available && size > .5; i++) {
        size *= Math.max(.5, Math.min(.9, available / stack.scrollHeight))
        stack.style.fontSize = size + 'px'
      }
    })
  }

  const COMIC_PAPER_CSS = `.comic-paper{position:relative!important;display:block!important;aspect-ratio:.70;width:100%;height:auto;max-height:none!important;overflow:hidden!important;padding:0!important;background:#fff;box-shadow:0 2px 16px #0005;flex:none}
.comic-paper .comic-cell{position:absolute!important;display:block!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:white!important;overflow:visible!important}
.comic-paper .comic-art{position:absolute;inset:0;overflow:hidden;background:#eee}
.comic-paper .comic-art .comic-img{display:block;position:absolute;inset:0;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:cover!important;border:0!important;border-radius:0!important}
.comic-ink-outline{position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;overflow:visible}.comic-ink-outline polygon{fill:none;stroke:#111;stroke-width:2;vector-effect:non-scaling-stroke}
.comic-paper .comic-lettering{position:absolute;inset:6% 5% auto;z-index:3;display:flex;flex-direction:column;gap:.45em;line-height:1.4;color:#111}
.comic-paper .comic-caption{position:static!important;order:0!important;align-self:flex-start;max-width:95%!important;background:#fff!important;color:#111!important;border:1px solid #111!important;padding:.3em .5em!important;font-size:.76em!important;line-height:1.4!important;letter-spacing:0!important}
.comic-paper .comic-bubble{position:relative!important;inset:auto!important;order:1!important;align-self:flex-end;box-sizing:border-box;max-width:85%!important;margin:0!important;padding:.35em .65em!important;background:#fff!important;color:#111!important;border:1.5px solid #111!important;border-radius:45%!important;font-size:1em!important;line-height:1.4!important;box-shadow:none!important;transform:none!important;overflow-wrap:anywhere}
.comic-paper .comic-bubble:nth-child(even){align-self:flex-start}.comic-paper .comic-bubble::before{display:none!important}.comic-paper .comic-bubble-name{font-size:.6em!important;color:#444!important;margin:0!important;letter-spacing:0!important}.comic-paper .comic-bubble-line{white-space:pre-wrap}
.comic-paper .comic-bubble.tone-shout{border-radius:8%!important;font-weight:bold}.comic-paper .comic-bubble.tone-thought{border-style:dashed!important}.comic-paper .comic-placeholder{font-size:12px;position:absolute!important;inset:0!important;min-height:0!important;padding:12px!important;box-sizing:border-box;width:100%!important;color:#333}
body.mode-paged .page:not(.cur){display:none!important}@media print{body.mode-paged .page:not(.cur){display:block!important}}
.comic-paper .comic-full-page .comic-img{object-fit:contain!important;clip-path:none!important;filter:none!important;border-radius:0!important}.comic-paper .comic-full-page{border:0!important;background:white!important}.comic-fused-paper{background:white!important}
.comic-paper .comic-shot-nav{position:absolute;right:8px;bottom:8px;z-index:4;border:1px solid #111;background:#fff;color:#111;border-radius:999px;padding:2px 9px;font-size:11px;cursor:pointer;opacity:.9}
.comic-paper .comic-note{position:absolute;left:8px;bottom:8px;z-index:4;background:#0009;color:#fff;border-radius:999px;padding:2px 9px;font-size:10.5px;max-width:78%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

  function createComicPanel(ctx) {
    if (!document.getElementById('comic-paper-style')) {
      const style = document.createElement('style'); style.id = 'comic-paper-style'; style.textContent = COMIC_PAPER_CSS; document.head.appendChild(style)
    }
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

    // Legacy panels keep their original prompt when resuming old saves.
    const PANEL_COMPOSITION = {
      hero: 'single dramatic establishing panel composition, one key dramatic moment in motion, dynamic angle, cinematic framing',
      square: 'standard manga panel composition, one clear action beat, mid-shot, focus on one decisive moment',
      wide: 'wide landscape panel, panoramic scenery or transition shot, small figures in environment, horizontal framing',
      tall: 'tall vertical panel, full-body character standing pose or face-off, dramatic low angle, vertical framing'
    }
    function panelPrompt(panel, comic, styleText) {
      if (panel.fullPage === true) {
        const cast = (comic.cast || []).map(c => c.name + ': ' + c.look).join('; ')
        const pageStyle = String(styleText || '')
          .replace(/\bno\s+(?:text|letters|lettering|speech bubbles|captions)\b/gi, '')
          .replace(/\bsingle key scene\b|composed like a light-novel frontispiece/gi, '')
          .replace(/(?:不要|禁止|无)(?:文字|字幕|对白|气泡)/g, '')
          .replace(/(?:,\s*){2,}/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '')
        const beats = (panel.beats || []).map((b, i) => ({
          order: i + 1, image: b.description, emphasis: b.size || 'square',
          caption: b.caption || '', dialogue: b.dialogue || []
        }))
        return [
          'Create ONE finished portrait manga PAGE as ONE fused image, not a single panel or a collection of separate image files.',
          'Draw all panels, artwork, borders, gutters, integrated speech balloons, their tails and the exact Chinese lettering directly into this one image. The reader will not add or arrange anything.',
          'Story fidelity: the ordered script is authoritative. Render exactly ' + beats.length + ' story panels, one per beat, in clear left-to-right, top-to-bottom order. Composition describes their arrangement, not additional scenes. Vary panel proportions around the emotional turning point; reserve slanted borders or artwork crossing gutters for moments that warrant them. A quiet exchange must remain quiet, not become an invented battle.',
          'Character design bible (reference only, never draw a character sheet):\n' + cast,
          'Treat these descriptions as binding visual identities, not loose inspiration. Preserve each distinct face shape, apparent age, hair silhouette, body proportions, costume construction and accessories across views. Keep clothing practical for the stated setting. Preserve specified prop materials and construction: a wooden weapon has visible wood grain and a matte wooden edge, not a polished steel blade. Do not embellish simple equipment into ornate armor or change costumes between panels. Temporary wetness, damage and poses come from the script.',
          'Acting and staging: depict one readable instant in each beat, with intentional posture, weight-bearing stance, natural hands gripping the correct objects, directed eyelines and facial tension appropriate to the dialogue. Follow the specified shot and angle; otherwise choose framing that reveals the action, not repeated front-facing portraits. Establish character positions and preserve the action axis, relative height, prop ownership and light direction. Foreground, characters and background must have distinct depth and value separation.',
          'Style priority: the selected style below governs the artwork, including character rendering, color, medium, shading and texture. Manga PAGE describes the sequential layout, not a replacement art style. Preserve the selected aesthetic throughout all panels; staging and character descriptions must not override it.',
          'Selected style: ' + (pageStyle || 'black and white manga, expressive ink, screentone, dramatic black shadows, white paper'),
          'Lettering: render each dialogue line exactly once, verbatim in readable Simplified Chinese inside clean high-contrast balloons. Tails point to the correct speaker; place balloons in reading order without covering faces, hands or key actions. Normal speech uses oval balloons, shouting jagged balloons, thoughts cloud balloons and whispers small dashed-outline balloons. Draw captions only when provided. Only dialogue.line and caption are printable text; never print speaker labels, metadata, order numbers, page instructions or the synopsis.',
          'Scene: ' + (panel.sceneLine || ''),
          'Page composition: ' + (panel.composition || 'Compose the ordered story beats as a varied, integrated multi-panel manga page.'),
          'Page synopsis (context only): ' + (panel.narration || ''),
          'Ordered page script: ' + JSON.stringify(beats)
        ].join('\n')
      }
      const look = (comic.cast || [])
        .filter((c) => (panel.participants || []).includes(c.name))
        .map((c) => c.name + ': ' + c.look)
        .join('; ')
      const scene = panel.sceneLine || ''
      const narr = String(panel.narration || '')
      const comp = PANEL_COMPOSITION[panel.size] || PANEL_COMPOSITION.square
      const style = String(styleText || '').trim() || 'black and white printed manga, expressive black ink linework, screentone shading, strong black shadows, white paper, no color'
      const parts = [style, comp, 'one single moment from the scene, not a summary collage']
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
      let count = Math.min(16, Math.max(1, Number(pref.pageCount) || 4))

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
      rowMode.innerHTML = '<label>分页方式</label>'
      const modeSel = document.createElement('select')
      modeSel.id = 'comic-mode'
      const optAi = document.createElement('option')
      optAi.value = 'ai'; optAi.textContent = 'AI 规划整页漫画（每页一张融合图）'
      const optEvery = document.createElement('option')
      optEvery.value = 'every'; optEvery.textContent = '每回合一页（页内分格由生图模型绘制）'
      modeSel.appendChild(optAi); modeSel.appendChild(optEvery)
      modeSel.value = mode
      rowMode.appendChild(modeSel)
      bodyEl.appendChild(rowMode)

      // 目标幕数（AI 模式）
      const rowCount = document.createElement('div')
      rowCount.className = 'comic-planner-row'
      rowCount.innerHTML = '<label>目标页数</label>'
      const countInput = document.createElement('input')
      countInput.id = 'comic-count'
      countInput.type = 'number'
      countInput.min = 1
      countInput.max = 16
      countInput.value = count
      rowCount.appendChild(countInput)
      const countHint = document.createElement('span')
      countHint.className = 'comic-planner-hint'
      countHint.textContent = '（1~16 页；每页一次生图，含分格、气泡和文字）'
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
        count = Math.min(16, Math.max(1, Number(countInput.value) || 4))
        const n = mode === 'every' ? turnsInRange : Math.min(count, turnsInRange)
        const mins = Math.max(1, Math.round(n * 15 / 60))
        est.textContent = '预计绘制 ' + n + ' 页整页图 · 约 ' + mins + ' 分钟起（费用取决于你的生图端点计价）'
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
      savePref(Object.assign({}, pref, { mode, pageCount: count, fromTurn: from }))
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
      const target = Math.min(16, Math.max(1, Number(loadPref().pageCount) || 4))

      const prev = (opts && opts.resume && s.comic) ? s.comic : null
      // 分镜规划
      let comic = null
      if (mode === 'every') {
        comic = localPanels(src, target) // 每回合一张：本地确定性展开，不调 LLM
      } else {
        const r = await api.petAgent({
          task: 'comic',
          story: storyText(src),
          castText: (prev ? '【已绘角色设定：复用固定外貌；剧情明确的换装、受伤写入对应 beat，不重设计人物】\n' + (prev.cast || []).map(c => c.name + '：' + c.look).join('\n') + '\n\n【当前角色档案】\n' : '') + castText(src),
          pageCount: target,
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
      if (mode !== 'every' && comic.panels.some(p => p.fullPage !== true || !Array.isArray(p.beats) || !p.beats.length)) {
        toast('分镜规划未返回整页漫画脚本，请重新规划（不会退回逐格生图）', 'err')
        return
      }
      // 写入 session.comic（续画=追加；重画=重建）
      // 旧存档 panel 只带 illust → 续画前规范成 [illust]，保证追加后列表口径一致、不丢图
      const prevPanels = prev ? prev.panels.filter((p) => !p.illustError || p.illust || (Array.isArray(p.illusts) && p.illusts.length)).map((p) => {
        if (Array.isArray(p.illusts) && p.illusts.length) return p
        return p.illust ? Object.assign({}, p, { illusts: [p.illust] }) : p
      }) : []
      s.comic = {
        version: 2,
        createdAt: prev ? prev.createdAt : Date.now(),
        updatedAt: Date.now(),
        cast: mergeCast(prev && prev.cast, comic.cast),
        panels: prevPanels.concat(comic.panels.map((q, i) => ({
          idx: (prev ? prevPanels.length : 0) + i,
          fullPage: true,
          composition: q.composition || '',
          beats: Array.isArray(q.beats) && q.beats.length ? q.beats : [{ turn: q.turn, description: q.narration, size: q.size, dialogue: q.dialogue || [] }],
          aspectRatio: 2 / 3,
          turn: q.turn,
          title: q.title || '',
          sceneLine: q.sceneLine || '',
          narration: q.narration || '',
          participants: q.participants || [],
          size: q.size || 'square',
          ...(q.pageBreak != null ? { pageBreak: q.pageBreak } : {}),
          ...(q.layout != null ? { layout: q.layout } : {}),
          ...(q.importance != null ? { importance: q.importance } : {}),
          dialogue: Array.isArray(q.dialogue) ? q.dialogue : [],
          prompt: '',
          illust: null, illusts: [], illustAsset: null, illustAt: null, illustPending: false, illustError: null, illustNote: null
        })))
      }
      s.comic.progress = { state: 'planning', done: countDone(s.comic), failed: 0 }
      saveSessions()
      runQueue()
    }

    function countDone(comic) {
      return comic.panels.filter((p) => p.illust || (Array.isArray(p.illusts) && p.illusts.length)).length
    }

    function mergeCast(prevCast, newCast) {
      const out = Array.isArray(prevCast) ? prevCast.slice() : []
      for (const c of (newCast || [])) {
        if (!c || !c.name) continue
        const i = out.findIndex((x) => x.name === c.name)
        // Appended pages reuse the published character design; a fresh run has no previous cast.
        if (i < 0) out.push(c)
        else if (!out[i].look) out[i] = c
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
          fullPage: true,
          composition: 'Create one complete manga page with varied panels showing these sequential moments. Choose the panel arrangement, borders and transitions as an integrated illustration.',
          beats: (evs.length ? evs.slice(0, 6).map(e => ({ turn: t.turn, description: e.description, size: Number(e.importance) >= 8 ? 'hero' : 'square', dialogue: [] })) : [{ turn: t.turn, description: t.summary, dialogue: [] }]),
          turn: t.turn,
          title: (t.summary || (top && top.description) || '第' + t.turn + '幕').slice(0, 40),
          narration: (t.summary || (top && top.description) || '').slice(0, 160),
          participants: (t.scene && t.scene.participants) || [],
          sceneLine: sceneLineOf(t),
          size: top && Number(top.importance) >= 8 ? 'hero' : (panels.length && sceneLineOf(t) !== panels[panels.length - 1].sceneLine ? 'wide' : 'square'),
          dialogue: [] // Local source has no verbatim dialogue; do not invent quotations.
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
          if (p.illust || (Array.isArray(p.illusts) && p.illusts.length)) continue // 已画（断点续跑：跳过）
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
          toast('漫画回放完成：共 ' + countDone(s.comic) + ' 张', 'ok')
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
      return comic.panels.filter((p) => p.illust || (Array.isArray(p.illusts) && p.illusts.length) || p.illustError || p.illustPending).length
    }

    async function drawPanel(s, p, styleText) {
      p.illustPending = true
      p.illustError = null
      saveSessions()
      p.prompt = panelPrompt(p, s.comic, styleText)
      const dims = String(cfg().illustSize || '').match(/^(\d+)x(\d+)$/)
      const pageSize = dims && Number(dims[1]) !== Number(dims[2])
        ? Math.min(Number(dims[1]), Number(dims[2])) + 'x' + Math.max(Number(dims[1]), Number(dims[2])) : '1024x1536'
      const size = p.fullPage ? pageSize : cfg().illustSize
      if (p.fullPage) { const [w, h] = size.split('x').map(Number); p.aspectRatio = w / h }
      const attempt = () => api.generateImage({
        baseUrl: cfg().illustBaseUrl,
        apiKey: cfg().illustApiKey || cfg().apiKey,
        model: cfg().illustModel,
        prompt: p.prompt,
        size,
        quality: cfg().illustQuality || 'default',
        negative: p.fullPage ? '' : cfg().illustNegative,
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
        // 多图：一页仍默认 n=1（一次生成 = 一页整页图）；但若端点返回多张就全收，
        // 不能只留首图。dataUrls 是主进程标准化后的有效列表，旧契约只有 dataUrl。
        const urls = Array.isArray(r.dataUrls) ? r.dataUrls.filter((u) => typeof u === 'string' && u) : []
        if (!urls.length && r.dataUrl) urls.push(r.dataUrl)
        if (!urls.length) {
          p.illustError = '图像接口没有返回可用图片'
          saveSessions()
          return true
        }
        p.illusts = urls
        p.illust = urls[0] // 兼容：首图即 illust
        p.illustAt = Date.now()
        p.illustError = null
        // 部分成功：至少一张可用（这格算画好），但如实记录有几张没转换成功
        if (r.partial === true || Number(r.imageErrors) > 0) {
          const failed = Number(r.imageErrors) || 0
          p.illustNote = '部分成功：' + urls.length + ' 张可用' + (failed ? '，' + failed + ' 张未转换成功' : '')
        } else {
          delete p.illustNote
        }
        // 一次 HTTP 尝试 = 一笔费用（主进程账本已按每次网络尝试记录）：无论返回几张只加一次，
        // 绝不用 imageCount × 单价或请求数 n 二次计价。
        const cost = Number(r.cost != null ? r.cost : ((r.usage && r.usage.cost) != null ? r.usage.cost : NaN))
        if (Number.isFinite(cost)) {
          s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
          s.tokens.cost = (s.tokens.cost || 0) + cost
        }
      } else {
        const returned = Number((r && r.imageCount) || 0)
        const failed = Number((r && r.imageErrors) || 0)
        const detail = []
        if (returned > 0) detail.push('已返回 ' + returned + ' 张')
        if (failed > 0) detail.push('其中 ' + failed + ' 张转换失败')
        p.illustError = ((r && r.error) || '未知错误') + (detail.length ? '（' + detail.join('，') + '）' : '')
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
    /* 阅读模式记忆：'paged'（日本单行本式翻页）| 'scroll'（条漫式连续下拉） */
    const MODE_LS_KEY = 'sixworlds.comic.readMode'
    function loadReadMode() {
      try { return localStorage.getItem(MODE_LS_KEY) === 'scroll' ? 'scroll' : 'paged' } catch { return 'paged' }
    }
    function saveReadMode(m) {
      try { localStorage.setItem(MODE_LS_KEY, m) } catch {}
    }

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
      // 阅读模式切换：翻页（单行本式，←→）| 连续（条漫式下拉滚动）
      const modeWrap = document.createElement('div')
      modeWrap.className = 'comic-mode-switch'
      modeWrap.setAttribute('role', 'group')
      modeWrap.setAttribute('aria-label', '阅读模式')
      const modePagedBtn = document.createElement('button')
      modePagedBtn.id = 'comic-mode-paged'
      modePagedBtn.type = 'button'
      modePagedBtn.textContent = '翻页'
      modePagedBtn.title = '分页分格：← → 翻页'
      const modeScrollBtn = document.createElement('button')
      modeScrollBtn.id = 'comic-mode-scroll'
      modeScrollBtn.type = 'button'
      modeScrollBtn.textContent = '连续'
      modeScrollBtn.title = '条漫式：整部连成长条，往下滚动阅读'
      modeWrap.appendChild(modePagedBtn); modeWrap.appendChild(modeScrollBtn)
      const toolbar = document.createElement('div')
      toolbar.className = 'comic-reader-toolbar'
      toolbar.append(modeWrap, contBtn, exportBtn, closeBtn)
      mask.appendChild(toolbar)
      document.body.appendChild(mask)

      const panels = s.comic.panels
      const pages = buildComicPages(panels)
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
        const t = (pg.panels[0] && (pg.panels[0].title || ('第 ' + pg.panels[0].turn + ' 回合'))) || ''
        titleEl.textContent = t + ' …'
        titleEl.title = titleEl.textContent
        const stEl = document.createElement('span')
        stEl.className = 'comic-list-state'
        row.appendChild(idxEl); row.appendChild(titleEl); row.appendChild(stEl)
        row.addEventListener('click', () => {
          viewIdx = pi
          if (readMode === 'scroll') scrollToPage(pi, 'smooth')
          else renderPage()
        })
        list.appendChild(row)
        return { row, stEl }
      })
      const stateOfPage = (pg) => {
        // 计数按真实图片数（一页多图时不是 1），状态符号按该页是否有可显示图判定
        const shots = pg.panels.reduce((n, p) => n + (Array.isArray(p.illusts) && p.illusts.length ? p.illusts.filter(Boolean).length : (p.illust ? 1 : 0)), 0)
        const states = pg.panels.map((p) => (p.illust || (p.illusts && p.illusts.length)) ? '✓' : (p.illustError ? '!' : (p.illustPending ? '…' : '—')))
        const uniq = [...new Set(states)]
        const label = uniq.length === 1 ? uniq[0] : uniq.join('')
        return shots > 1 ? (label + '×' + shots) : label
      }
      const stateOf = (p) => (p.illust || (p.illusts && p.illusts.length)) ? '✓' : (p.illustError ? '!' : (p.illustPending ? '…' : '—'))

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
      function buildPanelCell(p, panelNoOnPage, rect) {
        const cell = document.createElement('div')
        cell.className = 'comic-cell size-' + (p.size || 'square') + (p.fullPage ? ' comic-full-page' : '')
        cell.setAttribute('data-panel-no', String(panelNoOnPage))
        cell.style.cssText = rectStyle(rect)
        const art = document.createElement('div')
        art.className = 'comic-art'
        art.style.cssText = polygonStyle(rect)
        cell.appendChild(art)
        const lettering = document.createElement('div')
        lettering.className = 'comic-lettering'
        if (!p.fullPage) {
          cell.insertAdjacentHTML('beforeend', inkOutline(rect))
          cell.appendChild(lettering)
        }
        // 旧存档只有 illust → 视作 [illust]；新存档用 illusts（一次生成可能返回多张）
        const shots = Array.isArray(p.illusts) && p.illusts.length ? p.illusts.filter(Boolean) : (p.illust ? [p.illust] : [])
        if (!shots.length) {
          const ph = document.createElement('div')
          ph.className = 'comic-placeholder'
          ph.textContent = p.illustError ? ('生成失败：' + p.illustError) : (p.illustPending ? '绘制中…' : '未绘制（用「继续生成」补画）')
          if (p.illustError || !p.illustPending) {
            const rb = document.createElement('button')
            rb.className = 'comic-redraw'
            rb.textContent = p.fullPage ? (p.illustError ? '↻ 重绘整页' : '绘制整页') : (p.illustError ? '↻ 重绘这一格' : '绘制这一格')
            rb.addEventListener('click', async (ev) => {
              ev.stopPropagation()
              if (queueRunning) { toast('队列进行中，稍后再试', 'info'); return }
              p.illustError = null
              await drawPanel(curSession(), p, ctx.stylePrompt())
              if (readMode === 'scroll' && cell.isConnected) {
                const replacement = buildPanelCell(p, panelNoOnPage, rect)
                const image = replacement.querySelector('img')
                if (image) await image.decode().catch(() => {})
                cell.replaceWith(replacement)
                fitComicPage(replacement.closest('.comic-paper'))
                markListState()
              } else rerender()
            })
            ph.appendChild(document.createElement('br'))
            ph.appendChild(rb)
          }
          art.appendChild(ph)
        } else {
          // 多图：这一格内可切换（点击图片/计数条），视觉顺序与生成返回顺序一致
          let shotIdx = 0
          const img = document.createElement('img')
          img.className = 'comic-img'
          img.src = shots[shotIdx]
          img.alt = p.title || '漫画分镜'
          art.appendChild(img)
          if (p.illustNote) {
            const note = document.createElement('span')
            note.className = 'comic-note'
            note.textContent = p.illustNote
            note.title = p.illustNote
            art.appendChild(note)
          }
          if (shots.length > 1) {
            const switcher = document.createElement('button')
            switcher.type = 'button'
            switcher.className = 'comic-shot-nav'
            const sync = () => { switcher.textContent = (shotIdx + 1) + ' / ' + shots.length }
            sync()
            switcher.title = '切换这一格的候选图（' + shots.length + ' 张）'
            const advance = (ev) => {
              ev.stopPropagation()
              shotIdx = (shotIdx + 1) % shots.length
              img.src = shots[shotIdx]
              sync()
            }
            switcher.addEventListener('click', advance)
            img.addEventListener('click', advance)
            art.appendChild(switcher)
          }
        }
        if (p.fullPage) return cell
        // 旁白条：格子顶部压暗横条（narration 只写画外旁白）
        if (p.narration) {
          const cap = document.createElement('div')
          cap.className = 'comic-caption'
          cap.textContent = p.narration
          lettering.appendChild(cap)
        }
        // 对白气泡：右上/左下/右上/左上按序错开，多气泡沿边排布
        const dl = Array.isArray(p.dialogue) ? p.dialogue : []
        dl.forEach((d, di) => {
          if (!d || !d.speaker || !d.line) return
          const b = buildBubble(d)
          b.classList.add('bubble-pos-' + ((di % 4) + 1))
          lettering.appendChild(b)
        })
        return cell
      }

      /* ---- 渲染 ----
       * 两种阅读模式共享同一套分页数据与 buildPanelCell：
       * - paged：四格分页；scroll：单列条漫，分组只作为目录定位锚点。
       * viewIdx 在两种布局之间共享，连续模式由视口顶部的阅读位置驱动。 */
      let readMode = loadReadMode()
      let scrollFrame = 0

      const markListState = () => {
        listRows.forEach((r, i) => {
          r.row.classList.toggle('on', i === viewIdx)
          r.stEl.textContent = stateOfPage(pages[i])
        })
      }
      const buildPageEl = (pg, pi) => {
        const page = document.createElement('div')
        page.className = 'comic-page comic-page-grid comic-paper' + (pg.fullPage ? ' comic-fused-paper' : '')
        if (pg.fullPage) {
          page.style.aspectRatio = String(pg.aspectRatio)
          page.style.setProperty('--comic-ratio', String(pg.aspectRatio))
        }
        page.setAttribute('data-page-no', String(pi + 1))
        const counter = document.createElement('div')
        counter.className = 'comic-counter'
        const first = pg.panels[0]
        const last = pg.panels[pg.panels.length - 1]
        counter.textContent = '第 ' + (pi + 1) + ' / ' + pages.length + ' 页 · 幕 ' +
          ((first.turn ? ('#' + first.turn) : '') || '') + '–' + (last ? ('#' + last.turn) : '')
        pg.panels.forEach((p, i) => page.appendChild(buildPanelCell(p, i + 1, pg.layout[i])))
        const scene = document.createElement('div')
        scene.className = 'comic-scene-line'
        scene.textContent = (first.sceneLine || '') + (first.sceneLine && last.sceneLine && first.sceneLine !== last.sceneLine ? ' → ' + last.sceneLine : '')
        return { page, counter, scene }
      }

      const renderPage = () => {
        const pg = pages[viewIdx]
        if (!pg) return
        stage.innerHTML = ''
        sbCount.textContent = (viewIdx + 1) + ' / ' + pages.length
        markListState()
        const { page, counter, scene } = buildPageEl(pg, viewIdx)
        stage.appendChild(counter)
        stage.appendChild(page)
        stage.appendChild(scene)
        fitComicPage(page)
      }

      const renderScroll = () => {
        stage.innerHTML = ''
        const flow = document.createElement('div')
        flow.className = 'comic-scroll-flow'
        pages.forEach((pg, pi) => {
          // 分组只用于定位；条漫不显示纸页边界，也不复用两列网格。
          const section = document.createElement('section')
          section.className = 'comic-scroll-section'
          section.dataset.pageNo = String(pi + 1)
          section.setAttribute('aria-label', '第 ' + (pi + 1) + ' 组分镜')
          const { page, counter } = buildPageEl(pg, pi)
          section.append(counter, page)
          flow.appendChild(section)
        })
        stage.appendChild(flow)
        flow.querySelectorAll('.comic-paper').forEach(fitComicPage)
        markListState()
        sbCount.textContent = (viewIdx + 1) + ' / ' + pages.length
      }

      const syncViewIdxFromScroll = () => {
        const els = stage.querySelectorAll('.comic-scroll-section')
        if (!els.length) return
        const line = stage.getBoundingClientRect().top + Math.min(120, stage.clientHeight / 4)
        let cur = 0
        els.forEach((el, i) => { if (el.getBoundingClientRect().top <= line) cur = i })
        viewIdx = cur
        markListState()
        sbCount.textContent = (cur + 1) + ' / ' + pages.length
        const row = listRows[cur].row
        const lr = list.getBoundingClientRect(), rr = row.getBoundingClientRect()
        if (rr.top < lr.top) list.scrollTop += rr.top - lr.top
        else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom
      }
      const scrollToPage = (pi, behavior) => {
        const el = stage.querySelectorAll('.comic-scroll-section')[pi]
        if (!el) return
        viewIdx = pi
        markListState()
        sbCount.textContent = (pi + 1) + ' / ' + pages.length
        stage.scrollTo({ top: stage.scrollTop + el.getBoundingClientRect().top - stage.getBoundingClientRect().top - 24, behavior: behavior || 'auto' })
      }
      const onStageScroll = () => {
        if (readMode !== 'scroll' || scrollFrame) return
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0
          if (readMode === 'scroll') syncViewIdxFromScroll()
        })
      }
      stage.addEventListener('scroll', onStageScroll, { passive: true })

      const applyMode = (m) => {
        if (m !== 'scroll' && m !== 'paged') return
        if (m === readMode) return
        readMode = m
        saveReadMode(m)
        modePagedBtn.classList.toggle('on', m === 'paged')
        modeScrollBtn.classList.toggle('on', m === 'scroll')
        mask.classList.toggle('mode-scroll', m === 'scroll')
        navPrev.hidden = m === 'scroll'
        navNext.hidden = m === 'scroll'
        if (m === 'scroll') {
          renderScroll()
          scrollToPage(viewIdx, 'auto')
        } else {
          renderPage()
        }
      }
      modePagedBtn.addEventListener('click', () => applyMode('paged'))
      modeScrollBtn.addEventListener('click', () => applyMode('scroll'))

      const step = (dir) => {
        const next = viewIdx + dir
        if (next < 0 || next >= pages.length) return
        viewIdx = next
        if (readMode === 'scroll') scrollToPage(next, 'smooth')
        else renderPage()
      }
      navPrev.addEventListener('click', () => step(-1))
      navNext.addEventListener('click', () => step(1))
      exportBtn.addEventListener('click', () => exportHtml())
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); close() }
        else if (e.key === 'Tab') { window.A11y && window.A11y.trapTab(mask, e) }
        else if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
        else if (readMode === 'scroll' && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          if (e.key === 'Home' || e.key === 'End') stage.scrollTo({ top: e.key === 'Home' ? 0 : stage.scrollHeight, behavior: 'auto' })
          else stage.scrollBy({ top: (e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 1) * (e.key.startsWith('Page') ? stage.clientHeight * .85 : 80), behavior: 'auto' })
        }
      }
      const resizeObserver = new ResizeObserver(() => stage.querySelectorAll('.comic-paper').forEach(fitComicPage))
      resizeObserver.observe(stage)
      const close = () => {
        resizeObserver.disconnect()
        cancelAnimationFrame(scrollFrame)
        stage.removeEventListener('scroll', onStageScroll)
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
      // 按当前模式重渲染（重绘单格后不丢滚动位置/页号）
      const rerender = () => {
        if (readMode === 'scroll') {
          const top = stage.scrollTop
          renderScroll()
          stage.scrollTop = top
        } else renderPage()
      }
      // 从含最新已画幕的页开始读
      let lastDone = -1
      panels.forEach((p, i) => { if (p.illust || (Array.isArray(p.illusts) && p.illusts.length)) lastDone = i })
      viewIdx = Math.max(0, pages.findIndex(pg => lastDone >= pg.startIndex && lastDone < pg.startIndex + pg.panels.length))
      // 模式初始态：切换器高亮 + 按记忆的模式渲染（连续流滚到起始页）
      modePagedBtn.classList.toggle('on', readMode === 'paged')
      modeScrollBtn.classList.toggle('on', readMode === 'scroll')
      mask.classList.toggle('mode-scroll', readMode === 'scroll')
      navPrev.hidden = readMode === 'scroll'
      navNext.hidden = readMode === 'scroll'
      if (readMode === 'scroll') {
        renderScroll()
        requestAnimationFrame(() => scrollToPage(viewIdx, 'auto'))
      } else {
        renderPage()
      }
      closeBtn.focus()
    }

    function closeView() { if (closeViewFn) closeViewFn() }

    /* 一格的候选图列表（旧存档只有 illust → [illust]；新存档用 illusts） */
    function panelShots(p) {
      const list = Array.isArray(p && p.illusts) ? p.illusts.filter(Boolean) : []
      if (list.length) return list
      return (p && p.illust) ? [p.illust] : []
    }

    /* ---------- HTML 导出（自包含：内嵌 base64 图 + 漫画页分格排版 + 气泡） ---------- */
    async function exportHtml() {
      const s = curSession()
      if (!s || !s.comic) return
      const panels = s.comic.panels.filter((p) => panelShots(p).length)
      if (!panels.length) { toast('还没有画好的幕可导出', 'info'); return }
      const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      const hydrated = await Promise.all(panels.map(async (p) => {
        // 逐张水合：外置引用读回 data URL，一张都不丢；导出侧仍只用 illust（首图）渲染主体，
        // 其余候选图以 data 属性留给阅读器内切换（与阅读视图的多图切换一致）。
        const shots = await Promise.all(panelShots(p).map(async (u) => {
          if (!String(u).startsWith('sixworlds-asset:')) return u
          const loaded = await api.readImageDataUrl(u)
          return loaded && loaded.ok ? loaded.dataUrl : null
        }))
        const ok = shots.filter(Boolean)
        return Object.assign({}, p, { illusts: ok, illust: ok[0] || null })
      }))
      const pages = buildComicPages(hydrated)
      const bubbleHtml = (p) => (Array.isArray(p.dialogue) ? p.dialogue : [])
        .filter(d => d && d.speaker && d.line)
        .map(d => '<div class="comic-bubble bubble tone-' + esc(d.tone || 'normal') + '"><div class="comic-bubble-name">' + esc(d.speaker) + '</div><div class="comic-bubble-line">' + esc(d.line) + '</div></div>').join('')
      // 多图：主体 img 用首图，其余候选图序列化进 data-shots，导出页内可点击切换（不新增脚本依赖）
      const shotAttr = (p) => {
        const list = panelShots(p)
        return list.length > 1 ? ' data-shots="' + esc(JSON.stringify(list)) + '"' : ''
      }
      const shotNavHtml = (p) => {
        const n = panelShots(p).length
        return n > 1 ? '<button type="button" class="comic-shot-nav" title="切换这一格的候选图（' + n + ' 张）">1 / ' + n + '</button>' : ''
      }
      const pageHtml = (pg, pi) => pg.fullPage
        ? '<section class="page comic-paper comic-fused-paper" data-page="' + (pi + 1) + '" style="aspect-ratio:' + pg.aspectRatio + ';--comic-ratio:' + pg.aspectRatio + '"><div class="comic-cell comic-full-page" style="left:0;top:0;width:100%;height:100%"><div class="comic-art"><img class="comic-img" src="' + esc(pg.panels[0].illust || '') + '" alt="' + esc(pg.panels[0].title) + '"' + shotAttr(pg.panels[0]) + '>' + shotNavHtml(pg.panels[0]) + '</div></div></section>'
        : '<section class="page comic-paper" data-page="' + (pi + 1) + '">' + pg.panels.map((p, i) =>
        '<div class="comic-cell cell size-' + esc(p.size || 'square') + '" style="' + rectStyle(pg.layout[i]) + '">' +
        '<div class="comic-art" style="' + polygonStyle(pg.layout[i]) + '"><img class="comic-img" src="' + esc(p.illust || '') + '" alt="' + esc(p.title) + '"' + shotAttr(p) + '>' + shotNavHtml(p) + '</div>' + inkOutline(pg.layout[i]) +
        '<div class="comic-lettering">' + (p.narration ? '<div class="comic-caption">' + esc(p.narration) + '</div>' : '') + bubbleHtml(p) + '</div></div>'
      ).join('') + '</section>'
      // 计数按真实图片数（一页多图不缩水）：幕数 + 图片总数 + 页数
      const totalShots = hydrated.reduce((n, p) => n + panelShots(p).length, 0)
      const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(s.title) + ' · 漫画回放</title><style>' +
        'body{margin:24px auto;padding:0 16px;background:#383838;color:#eee;font-family:sans-serif}h1,.meta{text-align:center}.meta{font-size:12px}.mode-bar,.pager{display:flex;gap:12px;justify-content:center;margin:16px}.page{margin:24px auto;width:min(760px,100%)}button{cursor:pointer;padding:6px 16px}.on{background:#efd79d}.pager{display:none}body.mode-paged .pager{display:flex}body.mode-paged .page:not(.cur){display:none}body.mode-paged .page.cur{display:block;width:min(760px,100%,calc((100vh - 240px)*var(--comic-ratio,.7)))}' +
        '.comic-shot-nav{position:absolute;right:6px;bottom:6px;z-index:3;font-size:11px;padding:2px 8px;opacity:.85}' +
        COMIC_PAPER_CSS +
        '@media print{body{background:white}.mode-bar,.pager{display:none!important}.comic-shot-nav{display:none!important}.page{display:block!important;width:100%;break-after:page;break-inside:avoid}}' +
        '</style></head><body class="mode-scroll"><h1>' + esc(s.title) + '</h1><div class="meta">六面世界 · 漫画回放 · ' + hydrated.length + ' 幕 · ' + totalShots + ' 张图 · ' + pages.length + ' 页 · 导出于 ' +
        new Date().toLocaleDateString('zh-CN') + '</div>' +
        '<div class="mode-bar" role="group" aria-label="阅读模式">' +
        '<button type="button" id="mb-scroll" class="on">连续阅读</button><button type="button" id="mb-paged">翻页阅读</button></div>' +
        pages.map(pageHtml).join('\n') +
        '<div class="pager"><button type="button" id="pg-prev">‹ 上一页</button><span class="pgno" id="pg-no"></span><button type="button" id="pg-next">下一页 ›</button></div>' +
        '<script>(function(){var fitComicPage=' + fitComicPage.toString() + ';function fit(){document.querySelectorAll(".comic-paper").forEach(fitComicPage)};window.addEventListener("resize",fit);var cur=0,ps=[].slice.call(document.querySelectorAll(".page"));' +
        'function show(){ps.forEach(function(p,i){p.classList.toggle("cur",i===cur)});' +
        'document.getElementById("pg-no").textContent=(cur+1)+" / "+ps.length;' +
        'document.getElementById("pg-prev").disabled=cur<=0;document.getElementById("pg-next").disabled=cur>=ps.length-1;}' +
        'function setMode(m){if(document.body.className==="mode-scroll"){ps.forEach(function(p,i){if(p.getBoundingClientRect().top<=120)cur=i})}document.body.className="mode-"+m;' +
        'document.getElementById("mb-scroll").classList.toggle("on",m==="scroll");' +
        'document.getElementById("mb-paged").classList.toggle("on",m==="paged");' +
        'show();fit();if(m==="paged"){window.scrollTo(0,0)}else{ps[cur].scrollIntoView({block:"start"})}}' +
        'document.getElementById("mb-scroll").onclick=function(){setMode("scroll")};' +
        'document.getElementById("mb-paged").onclick=function(){setMode("paged")};' +
        'document.getElementById("pg-prev").onclick=function(){if(cur>0){cur--;show();window.scrollTo(0,0)}};' +
        'document.getElementById("pg-next").onclick=function(){if(cur<ps.length-1){cur++;show();window.scrollTo(0,0)}};' +
        'document.addEventListener("keydown",function(e){if(document.body.className!=="mode-paged")return;' +
        'if(e.key==="ArrowLeft"&&cur>0){cur--;show();window.scrollTo(0,0)}' +
        'if(e.key==="ArrowRight"&&cur<ps.length-1){cur++;show();window.scrollTo(0,0)}});' +
        'new ResizeObserver(fit).observe(document.body);' +
        // 多图切换：data-shots 里的候选图按序循环（导出页无外部依赖）
        'document.querySelectorAll(".comic-shot-nav").forEach(function(btn){var img=btn.parentNode.querySelector(".comic-img");var shots=[];try{shots=JSON.parse(img.getAttribute("data-shots")||"[]")}catch(e){shots=[]}if(shots.length<2)return;var k=0;var go=function(){k=(k+1)%shots.length;img.src=shots[k];btn.textContent=(k+1)+" / "+shots.length};btn.onclick=go;img.onclick=go});' +
        'show();fit()})()</' + 'script></body></html>'
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
      const missing = s.comic.panels.some((p) => !p.illust && !(Array.isArray(p.illusts) && p.illusts.length) && !p.illustError)
      if (!missing) return false
      runQueue()
      return true
    }

    return { openPlanner, planAndRun, runQueue, resumePending, openView, closeView, exportHtml, panelPrompt }
  }

  window.ComicPanel = { createComicPanel, buildComicPages }
})()

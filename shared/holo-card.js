/* ======== 六面世界 · 角色闪卡工坊（Holo Card）（双方案共享） ========
 * 把世界线里的 character 实体制成 3D 全息收藏卡（可拖转、随视角流光、翻面）。
 * 链路（照抄漫画回放 comic-panel.js 的任务化模式）：
 *   引擎素材（engine:cardSource）→ 选角弹窗 → pet:agent 'card' 规划卡面文案
 *   → 2 次生图（主体立绘纯白底 + 背景）→ canvas 边缘抠图（主体透明化，失败降级贴满）
 *   → canvas 程序化排版文字层（移植 RuiC generate_typography 布局）
 *   → card:write 落盘卡目录（userData/holo-cards/<id>/）
 *   → card:window 打开查看器（Three.js 流光渲染，零外部请求）
 * 数据落 session.cards（轻元数据：cardId/角色名/规划/时间；PNG 全部在卡目录，不进会话库）。
 * 查看器源自 HRuiCcc/RuiC-card-skill（MIT，renderer/holo/LICENSE-RuiC-card-skill.txt）。
 * 测试保护：unit test-holo-card（排版/抠图判定/配置装配）+ e2e holo-* 断言（fake 桩全链路）。
 * 挂载：<script src="../shared/holo-card.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createHoloCard(ctx) {
    const api = ctx.api
    const cfg = ctx.cfg
    const { $, curSession, saveSessions, confirmDialog, toast } = ctx

    /* ---------- 文字层排版常量（移植 RuiC generate_typography.py，画布 1024×1536） ---------- */
    const GOLD = '#f4d087'
    const CREAM = '#fff1ce'
    const INK = 'rgba(16,21,27,0.86)'

    // 双线性字体链：Windows 楷体 → 系统衬线 → 通用回退（与 Python 版 candidates 等价）
    const FONT_STACK = '"KaiTi", "STKaiti", "楷体", "Noto Serif CJK SC", "SimSun", serif'

    /* 在离屏 canvas 上排版透明文字层。布局逐条对应 generate_typography.py：
     * 左上 subtitle 25pt 金 → title 88pt 奶白 → collection 22pt 金 + 双金线
     * 中部 tagline 31pt / technique 69pt 居中金字；左下 edition、右下 HOLOGRAPHIC。
     * 溢出策略与 Python 版一致：宽度超限则逐级缩字号。 */
    function renderTextLayer(plan, opts) {
      const W = 1024, H = 1536
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const d = c.getContext('2d')
      const text = (x, y, value, size, opts2) => {
        let s = String(value || '')
        if (!s.trim()) return
        let px = Math.max(8, Math.round(size))
        d.font = (opts2 && opts2.bold ? '700 ' : '') + px + 'px ' + FONT_STACK
        while (d.measureText(s).width > (opts2 && opts2.maxWidth || 850) && px > 10) {
          px -= 2
          d.font = (opts2 && opts2.bold ? '700 ' : '') + px + 'px ' + FONT_STACK
        }
        d.textAlign = (opts2 && opts2.align) || 'left'
        d.textBaseline = (opts2 && opts2.baseline) || 'top'
        d.strokeStyle = INK
        d.lineWidth = 3
        d.strokeText(s, x, y)
        d.fillStyle = (opts2 && opts2.fill) || CREAM
        d.fillText(s, x, y)
      }
      const line = (y) => {
        d.strokeStyle = GOLD
        d.lineWidth = 2
        d.beginPath(); d.moveTo(70, y); d.lineTo(954, y); d.stroke()
      }
      text(72, 42, plan.subtitle, 25, { fill: GOLD })
      text(72, 80, plan.name, 88, { bold: true, maxWidth: 875 })
      text(76, 190, (opts && opts.collection) || '六面世界 · 典藏', 22, { fill: GOLD })
      line(248)
      line(1288)
      text(512, 1292, plan.tagline, 31, { fill: GOLD, align: 'center', maxWidth: 860 })
      text(512, 1340, plan.technique, 69, { fill: CREAM, align: 'center', bold: true, maxWidth: 860 })
      text(72, 1462, plan.edition || '001 / 001', 20, { fill: GOLD })
      text(952, 1462, 'HOLOGRAPHIC', 18, { fill: GOLD, align: 'right', maxWidth: 380 })
      return c
    }

    /* ---------- 主体层抠图：纯白底立绘 → 透明背景（边缘 flood-fill） ---------- */
    /* 从四角向内漫水填充近似背景色（容差阈值），命中的像素 alpha=0。
     * 判定：透明像素占比 ≥ 15% 才采用分层（否则贴满全卡，视差用背景层承载）。
     * 返回 { canvas, layered }。导出供单测（test-holo-card 直接断言纯函数）。 */
    function cutoutSubject(imgCanvas) {
      const W = imgCanvas.width, H = imgCanvas.height
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const d = c.getContext('2d')
      d.drawImage(imgCanvas, 0, 0)
      const data = d.getImageData(0, 0, W, H)
      const px = data.data
      // 采样四角 8×8 均值作为背景色估计（坐标 clamp 防小图越界 → NaN 比较恒 false）
      let br = 0, bg = 0, bb = 0, n = 0
      const S = Math.min(8, W, H)
      const sample = (x0, y0) => {
        const xs = Math.max(0, Math.min(W - S, x0))
        const ys = Math.max(0, Math.min(H - S, y0))
        for (let y = ys; y < ys + S; y++) for (let x = xs; x < xs + S; x++) {
          const i = (y * W + x) * 4
          br += px[i]; bg += px[i + 1]; bb += px[i + 2]; n++
        }
      }
      sample(0, 0); sample(W - S, 0); sample(0, H - S); sample(W - S, H - S)
      br /= n; bg /= n; bb /= n
      const TOL = 34 // 亮度容差
      const isBg = (i) => Math.abs(px[i] - br) <= TOL && Math.abs(px[i + 1] - bg) <= TOL && Math.abs(px[i + 2] - bb) <= TOL
      // 扫描线 flood-fill（栈 + 区段扩展）
      const visited = new Uint8Array(W * H)
      const stack = []
      for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1) } // 上下边全行入栈
      for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y) }
      let cleared = 0
      while (stack.length) {
        const y = stack.pop(), x = stack.pop()
        if (x < 0 || x >= W || y < 0 || y >= H) continue
        const p = y * W + x
        if (visited[p]) continue
        const i = p * 4
        if (!isBg(i)) continue
        visited[p] = 1
        px[i + 3] = 0
        cleared++
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
      }
      d.putImageData(data, 0, 0)
      const layered = cleared / (W * H) >= 0.15
      if (!layered) {
        // 抠图失败 → 保留原图贴满（uFit 信箱式适配承载，不做透明化）
        d.clearRect(0, 0, W, H)
        d.drawImage(imgCanvas, 0, 0)
      }
      return { canvas: c, layered }
    }

    /* ---------- 生图 → canvas 载入工具 ---------- */
    function loadToCanvas(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.naturalWidth; c.height = img.naturalHeight
          c.getContext('2d').drawImage(img, 0, 0)
          resolve(c)
        }
        img.onerror = () => reject(new Error('图像解码失败'))
        img.src = dataUrl
      })
    }
    function canvasToPngUrl(c) { return c.toDataURL('image/png') }

    /* ---------- pet:agent 规划输入：单角色档案文本 ---------- */
    function castTextOf(character, storyText) {
      const parts = ['【角色档案】']
      parts.push('名字：' + character.name)
      if (character.summary) parts.push('简介：' + character.summary)
      if (character.state) parts.push('状态：' + character.state)
      if (character.tags && character.tags.length) parts.push('标签：' + character.tags.join('、'))
      if (character.facts && character.facts.length) {
        parts.push('相关事实：')
        for (const f of character.facts.slice(0, 10)) parts.push('- ' + f.statement)
      }
      if (character.relationships && character.relationships.length) {
        parts.push('关系网：')
        for (const r of character.relationships.slice(0, 8)) {
          parts.push('- 与 ' + r.with + '：' + r.type + (r.strength != null ? '（强度 ' + r.strength + '）' : ''))
        }
      }
      if (character.events && character.events.length) {
        parts.push('重要经历：')
        for (const e of character.events.slice(0, 6)) parts.push('- 第' + e.turn + '回合：' + e.description)
      }
      const out = parts.join('\n')
      return out.slice(0, 6000)
    }

    function cloudCfg() {
      const c = cfg() || {}
      return (c.baseUrl && c.apiKey && c.model) ? { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model } : null
    }

    /* ---------- 选角弹窗（列出当前世界线全部 character 实体） ---------- */
    async function openPicker() {
      const s = curSession()
      if (!s) return
      const r = await api.engineCardSource({ storyId: s.id })
      if (!r || !r.ok) { toast('角色素材读取失败：' + ((r && r.error) || '未知错误'), 'err'); return }
      const src = r.data
      if (!src.characters || !src.characters.length) {
        toast('这条世界线还没有可制卡的角色（先推进剧情）', 'info')
        return
      }
      let mask = document.getElementById('holo-picker')
      if (mask) mask.remove()
      mask = document.createElement('div')
      mask.id = 'holo-picker'
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm holo-picker-box'
      const head = document.createElement('div')
      head.className = 'confirm-title'
      head.textContent = '生成角色闪卡'
      const bodyEl = document.createElement('div')
      bodyEl.className = 'confirm-body holo-picker-body'
      const hint = document.createElement('div')
      hint.className = 'holo-picker-hint'
      hint.textContent = '选一位角色：AI 规划卡面 → 生成主体立绘与背景 → 3D 全息卡查看器（每张卡消耗 2 次生图）'
      bodyEl.appendChild(hint)
      const list = document.createElement('div')
      list.className = 'holo-picker-list'
      for (const ch of src.characters) {
        const item = document.createElement('button')
        item.className = 'holo-picker-item'
        item.type = 'button'
        const nm = document.createElement('span')
        nm.className = 'holo-picker-name'
        nm.textContent = ch.name
        const sm = document.createElement('span')
        sm.className = 'holo-picker-summary'
        sm.textContent = (ch.summary || '玩家角色').slice(0, 60)
        item.appendChild(nm); item.appendChild(sm)
        item.addEventListener('click', () => { closePicker(); generateCard(ch) })
        list.appendChild(item)
      }
      bodyEl.appendChild(list)
      const foot = document.createElement('div')
      foot.className = 'confirm-foot'
      const cancelBtn = document.createElement('button')
      cancelBtn.className = 'cancel'
      cancelBtn.textContent = '取消'
      foot.appendChild(cancelBtn)
      box.appendChild(head); box.appendChild(bodyEl); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)
      const closePicker = () => {
        mask.classList.add('closing')
        setTimeout(() => mask.remove(), 200)
      }
      cancelBtn.addEventListener('click', closePicker)
      mask.addEventListener('click', (e) => { if (e.target === mask) closePicker() })
      const onKey = (e) => { if (e.key === 'Escape') { closePicker(); document.removeEventListener('keydown', onKey) } }
      document.addEventListener('keydown', onKey)
    }

    /* ---------- 进度岛（照抄 comic-island 样式接缝，id 独立防串扰） ---------- */
    function createIsland() {
      let el = document.getElementById('holo-island')
      if (el) el.remove()
      el = document.createElement('div')
      el.id = 'holo-island'
      el.className = 'island-busy comic-island'
      el.setAttribute('aria-hidden', 'true')
      const dot = document.createElement('span')
      dot.className = 'island-dot'
      const txt = document.createElement('span')
      txt.className = 'island-txt'
      txt.textContent = '闪卡工坊 · 准备中…'
      el.appendChild(dot); el.appendChild(txt)
      document.body.appendChild(el)
      return {
        update(text) { txt.textContent = '闪卡工坊 · ' + text },
        close() { el.classList.add('leaving'); setTimeout(() => el.remove(), 320) }
      }
    }

    /* ---------- 生成一张卡：规划 → 生图 → 抠图 → 排版 → 落盘 ---------- */
    async function generateCard(character) {
      const s = curSession()
      if (!s) return
      if (!cfg().illustBaseUrl || !cfg().illustModel || !(cfg().illustApiKey || cfg().apiKey)) {
        toast('生成闪卡需要先在设置里配置图像模型', 'err')
        return
      }
      const island = createIsland()
      try {
        // 1) LLM 规划卡面
        island.update('AI 规划卡面文案…')
        const pr = await api.petAgent({
          task: 'card',
          story: '',
          castText: castTextOf(character),
          cloud: cloudCfg()
        })
        if (!pr || !pr.ok) {
          toast('卡面规划失败：' + ((pr && pr.error) || '未知错误') + '（需要先配置文本模型）', 'err', 6000)
          return
        }
        const plan = pr.plan
        const style = ctx.stylePrompt ? ctx.stylePrompt() : ''
        const gen = (prompt, size) => api.generateImage({
          baseUrl: cfg().illustBaseUrl,
          apiKey: cfg().illustApiKey || cfg().apiKey,
          model: cfg().illustModel,
          prompt: style ? (style + '. ' + prompt) : prompt,
          size: size || cfg().illustSize,
          quality: cfg().illustQuality || 'default',
          negative: cfg().illustNegative,
          seedLock: cfg().illustSeedLock,
          seed: cfg().illustSeed,
          n: 1
        })
        const addCost = (r) => {
          const cost = Number(r && (r.cost != null ? r.cost : (r.usage && r.usage.cost != null ? r.usage.cost : NaN)))
          if (Number.isFinite(cost)) {
            s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
            s.tokens.cost = (s.tokens.cost || 0) + cost
          }
        }
        // 2) 主体立绘（纯白底） + 3) 背景（两次生图，失败各重试一次）
        const attempt = async (label, prompt, size) => {
          let r = await gen(prompt, size)
          if (!r || !r.ok) { await new Promise((res) => setTimeout(res, 800)); r = await gen(prompt, size) }
          if (!r || !r.ok) throw new Error(label + '：' + ((r && r.error) || '未知错误'))
          addCost(r)
          return r.dataUrl
        }
        island.update('绘制主体立绘…')
        const subjectUrl = await attempt('主体生成失败', plan.subjectPrompt + ', full body, standing pose, plain white background, solid white background, no text, no watermark', '1024x1024')
        island.update('绘制卡面背景…')
        const bgUrl = await attempt('背景生成失败', plan.backgroundPrompt + ', no people, no characters, no text, no watermark', '1024x1536')

        // 4) canvas 加工：主体抠图（等比贴到 1024×1536 画布）+ 文字排版
        island.update('装裱卡面…')
        const subjectCanvas = await loadToCanvas(subjectUrl)
        const { canvas: subjectLayer, layered } = cutoutSubject(subjectCanvas)
        // 主体层规范画布 1024×1536：立绘等比居中放大（贴满 90% 高度）
        const norm = document.createElement('canvas')
        norm.width = 1024; norm.height = 1536
        const nd = norm.getContext('2d')
        const scale = Math.max((1024 * 0.95) / subjectLayer.width, (1536 * 0.92) / subjectLayer.height)
        const dw = subjectLayer.width * scale, dh = subjectLayer.height * scale
        nd.drawImage(subjectLayer, (1024 - dw) / 2, (1536 - dh) / 2 + 20, dw, dh)
        const textLayer = renderTextLayer(plan, { collection: (s.title || '六面世界') + ' · 典藏' })
        const bgCanvas = await loadToCanvas(bgUrl)

        // 5) 卡配置 + 落盘（cardId = 时间戳 + 随机，符合 /^card-[a-z0-9-]{1,64}$/）
        const cardId = 'card-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
        const edition = String(((s.cards || []).length + 1)).padStart(3, '0') + ' / ' + String(((s.cards || []).length + 1)).padStart(3, '0')
        const config = {
          title: plan.name || character.name,
          subtitle: plan.subtitle || '',
          technique: plan.technique || '',
          tagline: plan.tagline || '',
          edition,
          collection: (s.title || '六面世界') + ' · 全息典藏',
          description: (plan.why || '').slice(0, 120) || ((character.summary || '').slice(0, 120)),
          assets: {
            model: './card.glb',
            subject: './subject.png',
            background: './background.png',
            text: './text.png'
          },
          parameters: {
            subjectScale: layered ? 1.25 : 1.0,
            subjectDepth: layered ? 0.28 : 0,
            backgroundDepth: -0.2,
            foil: Number.isFinite(Number(plan.foil)) ? Number(plan.foil) : 0.6
          },
          safeArea: { scale: 1.12, offset: [-0.06, -0.085] }
        }
        const wr = await api.cardWrite({
          cardId,
          config,
          layers: {
            subject: canvasToPngUrl(norm),
            background: canvasToPngUrl(bgCanvas),
            text: canvasToPngUrl(textLayer)
          }
        })
        if (!wr || !wr.ok) { toast('闪卡落盘失败：' + ((wr && wr.error) || '未知错误'), 'err'); return }

        // 6) 会话元数据（轻记录，不占消息位）
        s.cards = s.cards || []
        s.cards.push({
          cardId,
          name: plan.name || character.name,
          rarity: plan.rarity || 'SR',
          subtitle: plan.subtitle || '',
          layered,
          createdAt: Date.now()
        })
        saveSessions()
        island.close()
        toast('闪卡已生成：' + (plan.name || character.name) + (layered ? '（分层景深）' : '（整幅贴合）'), 'ok')
        api.notify && api.notify({ title: '角色闪卡完成', body: (plan.name || character.name) + ' · ' + (plan.rarity || 'SR') })
        // 直接开看
        const vr = await api.cardWindow({ cardId })
        if (!vr || !vr.ok) toast('打开查看器失败：' + ((vr && vr.error) || '未知错误'), 'err')
        if (typeof ctx.onCardsChanged === 'function') ctx.onCardsChanged()
      } catch (e) {
        island.close()
        toast('闪卡生成失败：' + String((e && e.message) || e), 'err', 6000)
      }
    }

    /* ---------- 画廊内闪卡区（渲染当前会话的卡列表） ---------- */
    function renderCardsPanel() {
      const s = curSession()
      const body = $('holo-cards-body')
      if (!body) return
      body.innerHTML = ''
      const cards = (s && s.cards) || []
      if (!cards.length) {
        const e = document.createElement('div')
        e.className = 'gallery-empty'
        e.textContent = '这条世界线还没有闪卡。点「生成角色闪卡」，把角色制成 3D 全息收藏卡。'
        body.appendChild(e)
        return
      }
      for (const card of cards.slice().reverse()) {
        const item = document.createElement('div')
        item.className = 'holo-card-item'
        const info = document.createElement('div')
        info.className = 'holo-card-info'
        const nm = document.createElement('div')
        nm.className = 'holo-card-name'
        nm.textContent = card.name + ' · ' + (card.rarity || 'SR')
        const sub = document.createElement('div')
        sub.className = 'holo-card-sub'
        sub.textContent = (card.subtitle || '') + ' · ' + new Date(card.createdAt || Date.now()).toLocaleDateString('zh-CN')
        info.appendChild(nm); info.appendChild(sub)
        const acts = document.createElement('div')
        acts.className = 'holo-card-actions'
        const viewBtn = document.createElement('button')
        viewBtn.textContent = '查看'
        viewBtn.title = '在 3D 全息查看器中打开'
        viewBtn.addEventListener('click', async () => {
          const r = await api.cardWindow({ cardId: card.cardId })
          if (!r || !r.ok) toast('打开失败：' + ((r && r.error) || '未知错误'), 'err')
        })
        const delBtn = document.createElement('button')
        delBtn.textContent = '删除'
        delBtn.className = 'del'
        delBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: '删除这张闪卡？',
            body: '将删除卡面文件与图鉴记录（不影响对话与角色数据）。',
            danger: true,
            okText: '删除'
          })
          if (!ok) return
          const r = await api.cardDelete({ cardId: card.cardId })
          if (r && r.ok) {
            s.cards = (s.cards || []).filter((c) => c.cardId !== card.cardId)
            saveSessions()
            renderCardsPanel()
            toast('已删除闪卡', 'info')
          } else {
            toast('删除失败：' + ((r && r.error) || '未知错误'), 'err')
          }
        })
        acts.appendChild(viewBtn); acts.appendChild(delBtn)
        item.appendChild(info); item.appendChild(acts)
        body.appendChild(item)
      }
    }

    return { openPicker, generateCard, renderCardsPanel, cutoutSubject, renderTextLayer }
  }

  window.HoloCard = { createHoloCard }
})()

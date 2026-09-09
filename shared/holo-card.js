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

    /* ---------- 透明检测：data URL 图像是否真带 alpha 通道（防端点静默忽略 background 参数） ---------- */
    /* 抽样 64×64 网格查 alpha<250 的像素占比 ≥3% 即认定透明。异步（等 Image 解码），导出供单测。 */
    function hasTransparency(dataUrl) {
      if (!dataUrl) return false
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          try {
            const W = Math.min(64, img.naturalWidth), H = Math.min(64, img.naturalHeight)
            const c = document.createElement('canvas')
            c.width = W; c.height = H
            const d = c.getContext('2d')
            d.drawImage(img, 0, 0, W, H)
            const px = d.getImageData(0, 0, W, H).data
            let trans = 0
            for (let i = 3; i < px.length; i += 4) if (px[i] < 250) trans++
            resolve(trans / (W * H) >= 0.03)
          } catch { resolve(false) }
        }
        img.onerror = () => resolve(false)
        img.src = dataUrl
      })
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

    /* ---------- 第 5 层：lineart 描边线稿（RuiC 四层图契约，README 效果的关键一层） ----------
     * shader 里 uHasLine 分量沿主体轮廓叠金色辉光（col += line*subject.a*band*amount*.055），
     * 没有这层卡片就少了原版 demo 的轮廓光立体感。原版用第 3 次生图画黑线稿（有配准漂移
     * 且多花一次生图）；这里从已抠图的主体层程序化推导：alpha 边缘 + 亮度 Sobel → 黑线白底，
     * 与主体像素级配准（同一张图推导，零漂移零费用）。 */
    function deriveLineart(subjectCanvas, layered) {
      const W = subjectCanvas.width, H = subjectCanvas.height
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const d = c.getContext('2d')
      d.fillStyle = '#fff'
      d.fillRect(0, 0, W, H)
      if (!layered) return c // 整幅模式没有干净 alpha 边缘，出纯白（shader uHasLine 会置 0，等价跳过）
      const src = subjectCanvas.getContext('2d').getImageData(0, 0, W, H)
      const sp = src.data
      const lum = (i) => (sp[i] * 0.299 + sp[i + 1] * 0.587 + sp[i + 2] * 0.114) * (sp[i + 3] / 255)
      const aAt = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? 0 : sp[(y * W + x) * 4 + 3]
      const out = d.getImageData(0, 0, W, H)
      const op = out.data
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y * W + x, i = p * 4
          // Sobel 亮度梯度（含 alpha 通道，透明区记 0 → 轮廓线自动出现在主体边缘）
          const gx = -lum(i - 4 - W * 4) - 2 * lum(i - 4) - lum(i - 4 + W * 4) + lum(i + 4 - W * 4) + 2 * lum(i + 4) + lum(i + 4 + W * 4)
          const gy = -lum(i - W * 4) - 2 * lum(i - W * 4 + 4) - lum(i - W * 4 + 8) + lum(i + W * 4) + 2 * lum(i + W * 4 + 4) + lum(i + W * 4 + 8)
          let g = Math.sqrt(gx * gx + gy * gy)
          // alpha 边缘强化：邻域 alpha 差 > 阈值也视为轮廓（内部细节弱、外轮廓强，层次分明）
          const aEdge = Math.max(
            Math.abs(aAt(x, y) - aAt(x + 1, y)), Math.abs(aAt(x, y) - aAt(x, y + 1)),
            Math.abs(aAt(x, y) - aAt(x - 1, y)), Math.abs(aAt(x, y) - aAt(x, y - 1))
          )
          if (aEdge > 60) g = Math.max(g, 120)
          // 阈值化：g>150 出黑线（真实卡目视标定：外轮廓+主褶皱，密度约 3%，不糊成剪影）
          op[i] = op[i + 1] = op[i + 2] = g > 150 ? 0 : 255
          op[i + 3] = 255
        }
      }
      d.putImageData(out, 0, 0)
      return c
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
        const gen = (prompt, size, opts) => api.generateImage({
          baseUrl: cfg().illustBaseUrl,
          apiKey: cfg().illustApiKey || cfg().apiKey,
          model: cfg().illustModel,
          prompt: style ? (style + '. ' + prompt) : prompt,
          size: size || cfg().illustSize,
          quality: cfg().illustQuality || 'default',
          background: (opts && opts.background) || '',
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
        // 2) 主体立绘（透明优先，降级白底） + 3) 背景（两次生图，失败各重试一次）
        const attempt = async (label, prompt, size, opts) => {
          let r = await gen(prompt, size, opts)
          if (!r || !r.ok) { await new Promise((res) => setTimeout(res, 800)); r = await gen(prompt, size, opts) }
          if (!r || !r.ok) throw new Error(label + '：' + ((r && r.error) || '未知错误'))
          addCost(r)
          return r
        }
        island.update('绘制主体立绘…')
        // 主体走 gpt-image 原生透明背景（background:'transparent'，模型直接返回带 alpha 的 PNG）。
        // 三段降级：端点报错 → 白底重试；静默忽略参数（返回不透明白底图）→ 白底重试；都失败 → 报错。
        // 白底命中后仍有 canvas flood-fill 抠图兜底（cutoutSubject），与旧链路完全一致。
        const revised = {}
        const subjPromptWhite = plan.subjectPrompt + ', full body, standing pose, plain white background, solid white background, no text, no watermark'
        const subjPromptTrans = plan.subjectPrompt + ', full body, standing pose, no text, no watermark'
        let subj = await attempt('主体生成失败', subjPromptTrans, '1024x1024', { background: 'transparent' }).catch((e) => e)
        let subjMode = 'transparent'
        if (subj instanceof Error || !hasTransparency(subj instanceof Error ? null : subj.dataUrl)) {
          const reason = subj instanceof Error ? String(subj.message || subj) : '端点忽略透明参数'
          island.update('主体透明不受支持，改白底生成…')
          if (subj && !(subj instanceof Error) && subj.revisedPrompt) revised.subject = subj.revisedPrompt
          subj = await attempt('主体生成失败', subjPromptWhite, '1024x1024')
          subjMode = 'white'
          console.log('[holo] 透明背景不可用（' + reason + '），回落白底+抠图')
        }
        if (subj.revisedPrompt) revised.subject = subj.revisedPrompt
        island.update('绘制卡面背景…')
        const bg = await attempt('背景生成失败', plan.backgroundPrompt + ', no people, no characters, no text, no watermark', '1024x1536')
        if (bg.revisedPrompt) revised.background = bg.revisedPrompt
        if (Object.keys(revised).length) console.log('[holo] 模型改写提示词：', revised)

        // 4) canvas 加工：主体抠图（等比贴到 1024×1536 画布）+ 文字排版
        island.update('装裱卡面…')
        const subjectCanvas = await loadToCanvas(subj.dataUrl)
        // 原生透明模式（subjMode='transparent'）模型已返回带 alpha 的主体，跳过 flood-fill 抠图；
        // 白底模式仍走 cutoutSubject（含失败回落整幅）。两路都产出 layered 判定。
        let subjectLayer, layered
        if (subjMode === 'transparent') {
          subjectLayer = subjectCanvas
          layered = true
        } else {
          const cut = cutoutSubject(subjectCanvas)
          subjectLayer = cut.canvas; layered = cut.layered
        }
        // 主体层规范画布 1024×1536：立绘等比居中放大（贴满 90% 高度）
        const norm = document.createElement('canvas')
        norm.width = 1024; norm.height = 1536
        const nd = norm.getContext('2d')
        const scale = Math.max((1024 * 0.95) / subjectLayer.width, (1536 * 0.92) / subjectLayer.height)
        const dw = subjectLayer.width * scale, dh = subjectLayer.height * scale
        nd.drawImage(subjectLayer, (1024 - dw) / 2, (1536 - dh) / 2 + 20, dw, dh)
        const textLayer = renderTextLayer(plan, { collection: (s.title || '六面世界') + ' · 典藏' })
        const bgCanvas = await loadToCanvas(bg.dataUrl)
        // lineart 描边层：从主体层像素推导（与主体严格配准），激活 shader 的轮廓金色辉光
        const lineLayer = deriveLineart(norm, layered)

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
          assets: (() => {
            const a = {
              model: './card.glb',
              subject: './subject.png',
              background: './background.png',
              text: './text.png'
            }
            if (layered) a.lineart = './lineart.png' // 整幅模式无干净 alpha，纯白线稿等于关闭 uHasLine
            return a
          })(),
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
          layers: (() => {
            const l = {
              subject: canvasToPngUrl(norm),
              background: canvasToPngUrl(bgCanvas),
              text: canvasToPngUrl(textLayer)
            }
            if (layered) l.lineart = canvasToPngUrl(lineLayer)
            return l
          })()
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
          subjectMode: subjMode, // transparent=模型原生 alpha（边缘质量最优）｜white=白底+canvas 抠图
          revisedPrompt: revised.subject || '', // 模型实际作画的提示词（gpt-image 系会内部改写）
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

    /* ---------- 独立图鉴面板（全屏浮层）：卡片墙 + 查看/删除/生成 ----------
     * 从画廊抽屉里拆出来（原 #holo-cards-body 内嵌列表）：画廊只做插图浏览，
     * 闪卡收藏独立成层，入口在顶栏「作品」菜单。卡面预览直接用查看器同源的
     * sixworlds-asset://holo/card/<id>/background.png（协议白名单已放行），零新 IPC。 */
    function cardPreviewUrl(cardId) {
      return 'sixworlds-asset://holo/card/' + encodeURIComponent(cardId) + '/background.png'
    }

    async function openCard(cardId) {
      const r = await api.cardWindow({ cardId })
      if (!r || !r.ok) toast('打开失败：' + ((r && r.error) || '未知错误'), 'err')
    }

    async function deleteCard(card) {
      const ok = await confirmDialog({
        title: '删除这张闪卡？',
        body: '将删除卡面文件与图鉴记录（不影响对话与角色数据）。',
        danger: true,
        okText: '删除'
      })
      if (!ok) return
      const r = await api.cardDelete({ cardId: card.cardId })
      if (!(r && r.ok)) { toast('删除失败：' + ((r && r.error) || '未知错误'), 'err'); return }
      const s = curSession()
      if (s) { s.cards = (s.cards || []).filter((c) => c.cardId !== card.cardId); saveSessions() }
      renderGalleryView()
      toast('已删除闪卡', 'info')
      if (typeof ctx.onCardsChanged === 'function') ctx.onCardsChanged()
    }

    function openGalleryView() {
      let mask = document.getElementById('holo-view')
      if (!mask) {
        mask = document.createElement('div')
        mask.id = 'holo-view'
        mask.className = 'holo-view'
        // 点遮罩空白处关闭（内容区点击不冒泡到遮罩）
        mask.addEventListener('click', (e) => { if (e.target === mask) closeGalleryView() })
        document.body.appendChild(mask)
      }
      mask.classList.remove('closing')
      renderGalleryView()
    }

    function closeGalleryView() {
      const mask = document.getElementById('holo-view')
      if (!mask) return
      mask.classList.add('closing')
      setTimeout(() => { const m = document.getElementById('holo-view'); if (m) m.remove() }, 180)
    }

    function renderGalleryView() {
      const mask = document.getElementById('holo-view')
      if (!mask) return
      const s = curSession()
      const cards = (s && s.cards) ? s.cards.slice().reverse() : []
      mask.innerHTML = ''

      const head = document.createElement('div')
      head.className = 'holo-view-head'
      const titleWrap = document.createElement('div')
      titleWrap.className = 'holo-view-title-wrap'
      const title = document.createElement('div')
      title.className = 'holo-view-title'
      title.textContent = '角色闪卡'
      const sub = document.createElement('div')
      sub.className = 'holo-view-sub'
      sub.textContent = s ? (s.title + ' · ' + cards.length + ' 张') : '暂无世界线'
      titleWrap.appendChild(title); titleWrap.appendChild(sub)
      const headActs = document.createElement('div')
      headActs.className = 'holo-view-actions'
      const genBtn = document.createElement('button')
      genBtn.className = 'primary holo-view-generate'
      genBtn.textContent = '生成新闪卡'
      genBtn.addEventListener('click', () => { closeGalleryView(); openPicker() })
      const closeBtn = document.createElement('button')
      closeBtn.className = 'holo-view-close'
      closeBtn.title = '关闭（Esc）'
      closeBtn.innerHTML = '×'
      closeBtn.addEventListener('click', closeGalleryView)
      headActs.appendChild(genBtn); headActs.appendChild(closeBtn)
      head.appendChild(titleWrap); head.appendChild(headActs)
      mask.appendChild(head)

      const body = document.createElement('div')
      body.className = 'holo-view-body'
      if (!cards.length) {
        const empty = document.createElement('div')
        empty.className = 'holo-view-empty'
        const msg = document.createElement('div')
        msg.textContent = '这条世界线还没有闪卡。'
        const hint = document.createElement('div')
        hint.className = 'holo-view-empty-hint'
        hint.textContent = '把世界线里的角色制成 3D 全息收藏卡（每张卡消耗 2 次生图）'
        const go = document.createElement('button')
        go.className = 'primary'
        go.textContent = '选择角色生成第一张'
        go.addEventListener('click', () => { closeGalleryView(); openPicker() })
        empty.appendChild(msg); empty.appendChild(hint); empty.appendChild(go)
        body.appendChild(empty)
      } else {
        const wall = document.createElement('div')
        wall.className = 'holo-wall'
        for (const card of cards) {
          const item = document.createElement('div')
          item.className = 'holo-card-item'
          const face = document.createElement('div')
          face.className = 'holo-card-face'
          face.title = '点击在 3D 全息查看器中打开'
          const img = document.createElement('img')
          img.className = 'holo-card-img'
          img.src = cardPreviewUrl(card.cardId)
          img.alt = card.name + ' 的闪卡'
          img.loading = 'lazy'
          img.decoding = 'async'
          const rarity = document.createElement('span')
          rarity.className = 'holo-card-rarity'
          rarity.textContent = card.rarity || 'SR'
          face.appendChild(img); face.appendChild(rarity)
          face.addEventListener('click', () => openCard(card.cardId))
          const info = document.createElement('div')
          info.className = 'holo-card-info'
          const nm = document.createElement('div')
          nm.className = 'holo-card-name'
          nm.textContent = card.name
          const sb = document.createElement('div')
          sb.className = 'holo-card-sub'
          sb.textContent = (card.subtitle ? card.subtitle + ' · ' : '') + new Date(card.createdAt || Date.now()).toLocaleDateString('zh-CN')
          info.appendChild(nm); info.appendChild(sb)
          const acts = document.createElement('div')
          acts.className = 'holo-card-actions'
          const viewBtn = document.createElement('button')
          viewBtn.textContent = '查看'
          viewBtn.title = '在 3D 全息查看器中打开'
          viewBtn.addEventListener('click', () => openCard(card.cardId))
          const delBtn = document.createElement('button')
          delBtn.textContent = '删除'
          delBtn.className = 'del'
          delBtn.addEventListener('click', () => deleteCard(card))
          acts.appendChild(viewBtn); acts.appendChild(delBtn)
          item.appendChild(face); item.appendChild(info); item.appendChild(acts)
          wall.appendChild(item)
        }
        body.appendChild(wall)
      }
      mask.appendChild(body)
    }

    return { openPicker, generateCard, openGalleryView, closeGalleryView, renderGalleryView, cutoutSubject, renderTextLayer }
  }

  window.HoloCard = { createHoloCard }
})()

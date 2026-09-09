/* ======== 六面世界 · 插图集群（就绪判定 / 风格与提示词 / 生成与重试 / 大图浏览）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第九刀（一）：illust 集群（illustReady / stylePrompt /
 * buildIllustPrompt / generateIllust / viewIllust，共 183 行）。迁移前两侧 app.js
 * 逐字相同。cfg 为可被整体重赋值的绑定，经惰性函数取当前引用；busy() 只读；
 * ILLUST_STYLES 风格表（逐字一致）一并入模块。
 * 测试保护：e2e-mock 双方案矩阵（auto-illust-b64 / lightbox-* / illust-btn-* /
 * gallery-* 断言）+ test-choices 插图链路。
 * 挂载：<script src="../shared/illust-panel.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createIllustPanel(ctx) {
    const api = ctx.api
    const cfg = ctx.cfg
    const { curSession, downloadIllust, renderMessages, saveSessions, toast } = ctx
    const busy = ctx.busy // getter：app.js 侧可变绑定，经函数取当前值（body 内以 busy() 调用）

    const ILLUST_STYLES = {
      'ln-original': 'Japanese light novel illustration, faithfully styled after the original Mushoku Tensei: Jobless Reincarnation novel illustrations by Shirotaka: clean refined lineart with delicate watercolor-like coloring, soft luminous lighting, gentle color gradients, subtle paper texture, expressive finely-drawn faces, meticulous medieval-fantasy costumes and magic details, warm slightly nostalgic palette, dreamy fantasy atmosphere, composed like a light-novel frontispiece, single key scene, high quality, no text, no watermark, no logo',
      anime: 'modern Japanese anime style light novel illustration, clean lineart, soft cel shading, harmonious colors, atmospheric composition, high quality, no text, no watermark',
      watercolor: 'soft watercolor illustration, delicate loose brushwork, pale elegant colors, visible paper grain, warm quiet mood, high quality, no text, no watermark',
      oil: 'classical oil painting illustration, rich impasto brushwork, dramatic chiaroscuro lighting, epic fantasy master style, high quality, no text, no watermark',
      ink: 'East Asian ink wash painting sumi-e illustration, elegant negative space, flowing expressive brush lines, muted monochrome palette, oriental aesthetics, high quality, no text, no watermark',
      realistic: 'cinematic photorealistic concept art illustration, film-grade lighting, rich detail, dramatic composition, high quality, no text, no watermark'
    }

  function illustReady() {
    return cfg().illustPreset !== 'off' && cfg().illustBaseUrl && cfg().illustModel &&
      (cfg().illustApiKey || cfg().apiKey)
  }


  function stylePrompt() {
    if (cfg().illustStyle === 'custom') return String(cfg().illustCustom || '').trim() || ILLUST_STYLES['ln-original']
    return ILLUST_STYLES[cfg().illustStyle] || ILLUST_STYLES['ln-original']
  }


  function buildIllustPrompt(text) {
    let t = String(text || '')
    t = t.replace(/【[^】*]*】[^【]*/g, ' ')
    t = t.replace(/【[^】]*】/g, ' ')
    t = t.replace(/\s+/g, ' ').trim()
    if (!t) t = String(text || '').slice(0, 300)
    if (t.length > 600) t = t.slice(0, 600)
    const style = stylePrompt()
    const prefix = (cfg().illustPrefixEnable && cfg().illustPrefix) ? String(cfg().illustPrefix) + ' ' : ''
    // 风格与前缀均为英文（降低噪点）；画面内容取叙事原文（图像模型可直接理解中日文场景描述）
    return prefix + style + '. Scene depicted: ' + t
  }


  async function generateIllust(idx, regen, isAuto, customPrompt) {
    const s = curSession()
    if (!s) return
    const msg = s.messages[idx]
    if (!msg || msg.role !== 'assistant' || (msg.illust && !regen) || !illustReady()) return
    // 长度门槛：仅自动触发时，过短不生成（手动点击代表用户明确需要）
    if (isAuto && cfg().illustMinLen > 0 && String(msg.content).length < cfg().illustMinLen) return
    msg.illust = null
    msg.illustPending = true
    const renderPending = (attempt, retrying) => {
      renderMessages()
      const box = document.getElementById('illust-slot-' + idx)
      if (box) {
        box.className = 'illust-pending'
        const label = retrying ? ('正在重试绘制' + (attempt > 0 ? '（第 ' + (attempt + 1) + ' 次）' : '')) : '正在绘制这一幕的插图'
        box.innerHTML = '<span class="dots">' + label + '</span>'
      }
    }
    renderPending(0, false)

    // 单次尝试抽成函数，便于失败后重试一次
    const attemptOnce = async () => api.generateImage({
      baseUrl: cfg().illustBaseUrl,
      apiKey: cfg().illustApiKey || cfg().apiKey,
      model: cfg().illustModel,
      prompt: customPrompt || buildIllustPrompt(msg.content),
      size: cfg().illustSize,
      quality: cfg().illustQuality || 'default', // 清晰度：default 不传参，standard/high 透传给支持的端点
      negative: cfg().illustNegative,
      seedLock: cfg().illustSeedLock,
      seed: cfg().illustSeed,
      n: cfg().illustN
    })

    let r = await attemptOnce()
    // 失败自动重试一次（网络抖动 / 端点偶发 5xx 常见）
    if (!r || !r.ok) {
      renderPending(1, true)
      await new Promise((res) => setTimeout(res, 800))
      r = await attemptOnce()
    }
    msg.illustPending = false
    if (r && r.ok) {
      msg.illust = r.dataUrl
      msg.illustAt = Date.now()
      msg.illustError = null
      // 端点若返回计费（usage.cost / cost），累计到本线费用（右上角用量面板可见）
      const imgCost = Number(r.cost != null ? r.cost : ((r.usage && r.usage.cost) != null ? r.usage.cost : NaN))
      if (Number.isFinite(imgCost)) {
        s.tokens = s.tokens || { prompt: 0, completion: 0, total: 0 }
        s.tokens.cost = (s.tokens.cost || 0) + imgCost
      }
      // gpt-image 系会内部改写提示词，revisedPrompt 即模型实际作画依据——存下来，
      // 插图下方以「模型改写」提示条展示（排查「图与提示词不符」的关键线索）
      msg.illustRevised = (r.revisedPrompt && String(r.revisedPrompt).slice(0, 400)) || ''
      saveSessions()
      renderMessages()
    } else {
      msg.illustError = (r && r.error) || '未知错误'
      saveSessions()
      renderMessages()
      const box2 = document.getElementById('illust-slot-' + idx)
      if (box2) {
        box2.className = 'illust-error'
        box2.textContent = '插图生成失败：' + msg.illustError
      }
      // 在错误框补重试按钮（renderMessages 分支也有一份）
      if (box2 && !busy()) {
        const rb = document.createElement('button')
        rb.className = 'retry-btn'
        rb.textContent = '↻ 重试绘制'
        rb.addEventListener('click', () => {
          msg.illustError = null
          generateIllust(idx, true)
        })
        box2.appendChild(document.createElement('br'))
        box2.appendChild(rb)
      }
      toast('插图生成失败：' + msg.illustError, 'err')
    }
  }


  function viewIllust(dataUrl, list) {
    let mask = document.getElementById('lightbox')
    if (mask) mask.remove()
    const imgs = Array.isArray(list) && list.length ? list.filter(Boolean) : [dataUrl]
    let idx = Math.max(0, imgs.indexOf(dataUrl))
    const hasNav = imgs.length > 1

    mask = document.createElement('div')
    mask.id = 'lightbox'
    mask.className = 'lightbox'
    const img = document.createElement('img')
    img.src = imgs[idx]
    img.alt = '场景插图'
    mask.appendChild(img)

    // 计数器（多图时显示）
    const counter = document.createElement('div')
    counter.className = 'lightbox-counter'
    const syncCounter = () => { counter.textContent = (idx + 1) + ' / ' + imgs.length }
    syncCounter()
    if (hasNav) mask.appendChild(counter)

    // 左右切换按钮（多图时）
    const prevBtn = document.createElement('button')
    prevBtn.className = 'lightbox-nav lightbox-prev'
    prevBtn.innerHTML = '<svg class="ic ic-lg" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>'
    prevBtn.title = '上一张（←）'
    const nextBtn = document.createElement('button')
    nextBtn.className = 'lightbox-nav lightbox-next'
    nextBtn.innerHTML = '<svg class="ic ic-lg" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5"/></svg>'
    nextBtn.title = '下一张（→）'

    // 关闭按钮（右上角）
    const closeBtn = document.createElement('button')
    closeBtn.className = 'lightbox-close'
    closeBtn.innerHTML = '<svg class="ic ic-lg" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
    closeBtn.title = '关闭（Esc）'
    mask.appendChild(closeBtn)
    // 保存按钮
    const saveBtn = document.createElement('button')
    saveBtn.className = 'lightbox-save'
    saveBtn.textContent = '保存'
    saveBtn.title = '保存这张插图'
    mask.appendChild(saveBtn)

    const step = (dir) => {
      if (!hasNav) return
      idx = (idx + dir + imgs.length) % imgs.length
      img.style.opacity = '0'
      setTimeout(() => { img.src = imgs[idx]; img.style.opacity = '1' }, 90)
      syncCounter()
    }
    if (hasNav) {
      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); step(-1) })
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); step(1) })
      mask.appendChild(prevBtn)
      mask.appendChild(nextBtn)
    }

    const close = () => {
      mask.classList.add('closing')
      setTimeout(() => mask.remove(), 160)
      document.removeEventListener('keydown', onKey)
    }
    closeBtn.addEventListener('click', close)
    saveBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadIllust(imgs[idx], -1) })
    // 点击任意位置关闭（按钮已阻止冒泡）
    mask.addEventListener('click', close)
    const onKey = (e) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    document.addEventListener('keydown', onKey)
    document.body.appendChild(mask)
  }


    return { illustReady, stylePrompt, buildIllustPrompt, generateIllust, viewIllust }
  }

  window.IllustPanel = { createIllustPanel }
})()

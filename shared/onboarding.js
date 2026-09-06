/* ======== 六面世界 · 首启引导（初始化配置向导 / 免责声明 / 入场动画）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第十刀（收官）：onboarding 集群。迁移前两侧 app.js
 * 逐字相同：WIZ_PRESETS / WIZ_IMG_PRESETS（预设表）、showSetupWizard（285 行，
 * 外观 → 文本模型 → 插图模型三步向导）、showDisclaimer（70 行，首次安装确认）、
 * splashBoot（59 行，Mineradio 式启动页；e2e 环境直接移除）。
 * cfg 为可被整体重赋值的绑定，经惰性函数取当前引用；快捷键面板（帮助面板一部分）
 * 依赖 35 个方案内函数，注入面过大，留在各自 app.js。
 * 测试保护：e2e-mock 双方案矩阵（启动序列/向导跳过 e2e 环境路径）+ test-ui-scheme。
 * 挂载：<script src="../shared/onboarding.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createOnboarding(ctx) {
    const $ = ctx.$
    const api = ctx.api
    const cfg = ctx.cfg
    const { applyTheme, applyPalettePresetLink, refreshModelSelect, saveStore, toast } = ctx
    const STORE_KEY = ctx.STORE_KEY
    const OB_KEY = ctx.OB_KEY
    const PALETTES = ctx.PALETTES

  const WIZ_PRESETS = {
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    moonshot: { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0711-preview' },
    zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    qwen: { name: '通义 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    custom: { name: '自定义', baseUrl: '', model: '' },
  }


  const WIZ_IMG_PRESETS = {
    off: { name: '暂不启用', baseUrl: '', model: '' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
    zhipu: { name: '智谱 CogView', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors' },
    dashscope: { name: '通义万相', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'wanx2.1-t2i-turbo' },
    custom: { name: '自定义', baseUrl: '', model: '' },
  }


  function showSetupWizard() {
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm wizard'
      box.style.width = '640px'
      box.style.display = 'flex'
      box.style.flexDirection = 'column'
      // 欢迎区（R75 → Finalize Design：居中 Emblem 列式头部）
      const head = document.createElement('div')
      head.className = 'wizard-head'
      head.innerHTML = '<span class="wizard-logo">六</span>' +
        '<span class="wizard-welcome">欢迎使用六面世界</span>' +
        '<span class="wizard-welcome-sub">三步完成初始配置，所有选项之后都能在设置中调整</span>'
      // 步骤条独立于 body：切步时只重绘状态，不参与内容动画
      const stepsEl = document.createElement('div')
      stepsEl.className = 'wizard-steps'
      const body = document.createElement('div')
      body.className = 'wizard-body'
      const pane = document.createElement('div')
      pane.className = 'wizard-pane'
      body.appendChild(pane)
      const foot = document.createElement('div')
      foot.className = 'confirm-foot wizard-foot'
      const prog = document.createElement('span')
      prog.className = 'wizard-progress'
      const back = document.createElement('button')
      back.className = 'cancel'
      const next = document.createElement('button')
      next.className = 'primary'
      foot.appendChild(prog); foot.appendChild(back); foot.appendChild(next)
      box.appendChild(head); box.appendChild(stepsEl); box.appendChild(body); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)

      const gv = (cls) => { const el = pane.querySelector(cls); return el ? el.value.trim() : null }
      const st = { theme: 'dark', palette: cfg().palette || 'classic', preset: 'deepseek', imgPreset: 'off' }
      const wizModels = { text: [], img: [] } // 拉取到的模型列表
      const origTheme = cfg().theme // 实时预览用：跳过时还原
      const origPalette = cfg().palette // 配色预览同理：跳过时还原
      let prevStep = 0 // 切步动画方向

      // 模型选择控件渲染：有列表 → 下拉；无 → 手填输入框（均可切换）
      function modelControl(kind) {
        const isText = kind === 'text'
        const list = isText ? wizModels.text : wizModels.img
        const valCls = isText ? '.wizard-model' : '.wizard-imgmodel'
        const cur = gv(valCls) || ''
        if (list.length) {
          let h = '<select class="' + (isText ? 'wizard-model' : 'wizard-imgmodel') + ' wizard-model-select">'
          if (!list.includes(cur) && cur) h += '<option value="' + cur + '" selected>' + cur + '（手填）</option>'
          for (const m of list) h += '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + m + '</option>'
          h += '</select>'
          return h
        }
        return '<input type="text" class="' + (isText ? 'wizard-model' : 'wizard-imgmodel') + '" value="' + cur + '" placeholder="' + (isText ? '点右侧按钮拉取，或手填' : '点右侧按钮拉取，或手填') + '">'
      }

      // 迷你界面模拟预览（R75）：CSS 画的侧栏 + 正文小窗，代替纯色块
      const themeCard = (v, name, desc) =>
        '<button class="wizard-theme-opt' + (st.theme === v ? ' sel' : '') + '" data-v="' + v + '">' +
        '<span class="wizard-theme-check">✓</span>' +
        '<span class="wizard-theme-mock ' + v + '"><span class="mock-side"><i></i><i></i><i></i></span>' +
        '<span class="mock-main"><b></b><i></i><i></i><i class="short"></i></span></span>' +
        '<span class="wizard-theme-name">' + name + '</span>' +
        '<span class="wizard-theme-desc">' + desc + '</span></button>'

      function render() {
        const steps = ['外观', '对话模型', '插图模型']
        const step = +mask.dataset.step || 0
        const seg = []
        steps.forEach((s, i) => {
          seg.push('<span class="wizard-step' + (i === step ? ' active' : '') + (i < step ? ' done' : '') + '">' +
            '<span class="wizard-step-dot">' + (i < step ? '✓' : (i + 1)) + '</span>' +
            '<span class="wizard-step-label">' + s + '</span></span>')
          if (i < steps.length - 1) seg.push('<span class="wizard-step-line' + (i < step ? ' passed' : '') + '"></span>')
        })
        stepsEl.innerHTML = seg.join('')
        let h = ''
        if (step === 0) {
          h += '<div class="wizard-title">选择外观</div><p class="wizard-sub">先选明暗基调，再挑一套界面配色——点击卡片立即预览效果</p>'
          h += '<div class="wizard-look">'
          h += '<div class="wizard-theme-row">'
          h += themeCard('light', '纯白', '明亮清爽，适合白天')
          h += themeCard('dark', '纯黑', '暗色沉浸，适合夜晚')
          h += themeCard('system', '跟随系统', '自动随系统切换')
          h += '</div>'
          // 配色预设（R76d）：与设置-外观/标题栏主题弹窗同一组调色板（原型：panel-2 圆角盒）
          h += '<div class="wizard-palette-box">'
          h += '<div class="wizard-palette-label">配色方案</div>'
          h += '<div class="wizard-palette-row">'
          for (const p of PALETTES) {
            h += '<button class="wizard-palette-opt' + (st.palette === p.id ? ' sel' : '') + '" data-pal="' + p.id + '" title="' + p.name + '">' +
              '<span class="wizard-palette-dot" style="background:linear-gradient(135deg,' + p.dot[0] + ' 50%,' + p.dot[1] + ' 50%)"></span>' +
              '<span class="wizard-palette-name">' + p.name + '</span></button>'
          }
          h += '</div>'
          h += '</div>'
          h += '<div class="wizard-hint">随时可以在右上角主题按钮或设置中更改</div>'
        } else if (step === 1) {
          const p = WIZ_PRESETS[st.preset] || WIZ_PRESETS.custom
          const cb = st.baseUrl !== undefined ? st.baseUrl : p.baseUrl
          const ck = st.apiKey !== undefined ? st.apiKey : ''
          // R75b：表单步内容整体垂直居中（与第 1 步视觉逻辑统一，消除底部大片留白）
          h += '<div class="wizard-form">'
          h += '<div class="wizard-title">配置对话模型</div><p class="wizard-sub">驱动故事生成的文本模型——填好地址与密钥后，可直接拉取可用模型列表</p>'
          h += '<div class="wizard-preset-row cols-4">'
          for (const k in WIZ_PRESETS) h += '<button class="wizard-preset-opt' + (k === st.preset ? ' sel' : '') + '" data-p="'+ k + '"><span class="wizard-preset-dot">' + (k === 'custom' ? '＋' : WIZ_PRESETS[k].name[0]) + '</span>' + WIZ_PRESETS[k].name + '</button>'
          h += '</div>'
          h += '<div class="wizard-field"><label>API 地址</label><input class="wizard-baseurl" type="text" value="' + cb + '" placeholder="https://api.deepseek.com"></div>'
          h += '<div class="wizard-field"><label>API Key</label><input class="wizard-apikey" type="password" value="' + ck + '" placeholder="sk-…（在提供商控制台获取）"></div>'
          h += '<div class="wizard-field"><label>模型</label><div class="wizard-fetch-row">' + modelControl('text')
          h += '<button class="wizard-fetch-btn" data-fetch="text">拉取模型</button></div></div>'
          h += '<div class="wizard-status" data-status="text"></div>'
          h += '</div>'
        } else {
          const p = WIZ_IMG_PRESETS[st.imgPreset] || WIZ_IMG_PRESETS.off
          const cb = st.imgBaseUrl !== undefined ? st.imgBaseUrl : p.baseUrl
          const ck = st.imgApiKey !== undefined ? st.imgApiKey : ''
          h += '<div class="wizard-form">'
          h += '<div class="wizard-title">配置插图模型</div><p class="wizard-sub">为故事生成插图的图像模型——可跳过，不影响文字游玩；Key 留空则复用对话模型的</p>'
          h += '<div class="wizard-preset-row">'
          for (const k in WIZ_IMG_PRESETS) h += '<button class="wizard-preset-opt' + (k === st.imgPreset ? ' sel' : '') + '" data-ip="'+ k + '"><span class="wizard-preset-dot">' + (k === 'custom' ? '＋' : k === 'off' ? '—' : WIZ_IMG_PRESETS[k].name[0]) + '</span>' + WIZ_IMG_PRESETS[k].name + '</button>'
          h += '</div>'
          if (st.imgPreset === 'off') {
            // 空状态（R75）：不启用时给明确的视觉反馈，不再留白
            h += '<div class="wizard-empty"><span class="wizard-empty-icon"></span>' +
              '<span class="wizard-empty-title">暂不启用插图</span>' +
              '<span class="wizard-empty-desc">不影响文字游玩；之后可以随时在设置中开启并配置图像模型</span></div>'
          } else {
            h += '<div class="wizard-field"><label>API 地址</label><input class="wizard-imgbaseurl" type="text" value="' + cb + '" placeholder="https://api.openai.com/v1"></div>'
            h += '<div class="wizard-field"><label>API Key</label><input class="wizard-imgapikey" type="password" value="' + ck + '" placeholder="留空则复用对话模型的 Key"></div>'
            h += '<div class="wizard-field"><label>模型</label><div class="wizard-fetch-row">' + modelControl('img')
            h += '<button class="wizard-fetch-btn" data-fetch="img">拉取模型</button></div></div>'
          }
          h += '<div class="wizard-status" data-status="img"></div>'
          h += '</div>'
        }
        pane.innerHTML = h
        // 切步动画（R75）：方向感知，前进从右滑入、后退从左滑入
        pane.classList.remove('anim-fwd', 'anim-back')
        void pane.offsetWidth
        pane.classList.add(step >= prevStep ? 'anim-fwd' : 'anim-back')
        prevStep = step
        // 实时预览：点击主题卡立即切换整个界面明暗（跳过时在 back 处理中还原）
        pane.querySelectorAll('.wizard-theme-opt').forEach((b) => b.addEventListener('click', () => { st.theme = b.dataset.v; applyTheme(b.dataset.v); render() }))
        // 实时预览：点击配色卡立即切换整套调色板（只动 DOM 属性不写 cfg()；完成时落库、跳过时还原）
        pane.querySelectorAll('.wizard-palette-opt').forEach((b) => b.addEventListener('click', () => {
          st.palette = b.dataset.pal
          document.documentElement.setAttribute('data-palette', st.palette)
          render()
        }))
        pane.querySelectorAll('.wizard-preset-opt[data-p]').forEach((b) => b.addEventListener('click', () => {
          cacheStep(1)
          st.preset = b.dataset.p
          const p = WIZ_PRESETS[b.dataset.p]
          st.baseUrl = p.baseUrl; st.model = p.model
          wizModels.text = [] // 换预设清空已拉取列表
          render()
        }))
        pane.querySelectorAll('.wizard-preset-opt[data-ip]').forEach((b) => b.addEventListener('click', () => {
          cacheStep(2)
          st.imgPreset = b.dataset.ip
          const p = WIZ_IMG_PRESETS[b.dataset.ip]
          st.imgBaseUrl = p.baseUrl; st.imgModel = p.model
          wizModels.img = []
          render()
        }))
        // 拉取模型按钮
        const fb = pane.querySelector('.wizard-fetch-btn')
        if (fb) fb.addEventListener('click', async () => {
          const kind = fb.dataset.fetch
          const isText = kind === 'text'
          const baseUrl = isText ? gv('.wizard-baseurl') : gv('.wizard-imgbaseurl')
          let apiKey = isText ? gv('.wizard-apikey') : (gv('.wizard-imgapikey') || gv('.wizard-apikey'))
          const status = pane.querySelector('[data-status="' + kind + '"]')
          if (!baseUrl || !apiKey) { if (status) { status.textContent = '请先填写 API 地址与密钥'; status.className = 'wizard-status err' } return }
          fb.disabled = true
          const old = fb.textContent
          fb.textContent = '获取中…'
          if (status) { status.textContent = ''; status.className = 'wizard-status' }
          const r = await api.testEndpoint({ baseUrl, apiKey })
          fb.disabled = false
          fb.textContent = old
          if (r && r.ok && r.models && r.models.length) {
            if (isText) wizModels.text = r.models; else wizModels.img = r.models
            // render 重建 DOM 前先缓存当前表单值（否则地址/密钥被预设默认覆盖）
            cacheStep(isText ? 1 : 2)
            if (status) { status.textContent = '已获取 ' + r.models.length + ' 个模型'; status.className = 'wizard-status ok' }
            render()
            // render 重建了 status 元素，重新标记
            const status2 = pane.querySelector('[data-status="' + kind + '"]')
            if (status2) { status2.textContent = '已获取 ' + r.models.length + ' 个模型'; status2.className = 'wizard-status ok' }
          } else {
            const msg = (r && r.error) || '端点未返回模型列表，可手填模型名'
            if (status) { status.textContent = msg; status.className = 'wizard-status err' }
          }
        })
        const s = +mask.dataset.step || 0
        prog.textContent = '第 ' + (s + 1) + ' / 3 步'
        back.textContent = s === 0 ? '跳过' : '上一步'
        next.innerHTML = s === 2 ? '完成' : '下一步<span class="btn-arrow">→</span>'
      }
      // 离开某步前缓存表单值（render 重建 DOM）
      const cacheStep = (step) => {
        if (step === 1) {
          const v = gv('.wizard-baseurl'); if (v !== null) st.baseUrl = v
          const k = gv('.wizard-apikey'); if (k !== null) st.apiKey = k
          const m = gv('.wizard-model'); if (m !== null) st.model = m
        } else if (step === 2) {
          const v = gv('.wizard-imgbaseurl'); if (v !== null) st.imgBaseUrl = v
          const k = gv('.wizard-imgapikey'); if (k !== null) st.imgApiKey = k
          const m = gv('.wizard-imgmodel'); if (m !== null) st.imgModel = m
        }
      }
      function close() {
        if (mask.dataset.leaving === '1') return
        mask.dataset.leaving = '1'
        document.removeEventListener('keydown', onKey)
        box.classList.add('closing'); mask.classList.add('closing')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          document.removeEventListener('keydown', onKey)
          mask.remove(); resolve(true)
        }
        box.addEventListener('animationend', (ev) => { if (ev.target === box) finish() })
        setTimeout(finish, 260)
      }
      // 键盘（R75）：Enter 前进 / Esc 退出；焦点在弹窗内按钮/下拉上时交还原生行为，
      // 焦点在弹窗外（如聊天输入框）时仍由向导接管
      function onKey(e) {
        if (mask.dataset.leaving === '1') return
        const ae = document.activeElement
        const inMask = !!(ae && mask.contains(ae))
        if (e.key === 'Escape') { e.preventDefault(); back.click(); return }
        if (e.key !== 'Enter') return
        if (inMask && (ae.tagName === 'BUTTON' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return
        e.preventDefault()
        next.click()
      }
      document.addEventListener('keydown', onKey)
      next.addEventListener('click', () => {
        const step = +mask.dataset.step || 0
        if (step < 2) { cacheStep(step); mask.dataset.step = String(step + 1); render(); return }
        cacheStep(2)
        const b = gv('.wizard-baseurl') || st.baseUrl || '', k = gv('.wizard-apikey') || st.apiKey || '', m = gv('.wizard-model') || st.model || ''
        const ib = gv('.wizard-imgbaseurl') || st.imgBaseUrl || '', ik = gv('.wizard-imgapikey') || st.imgApiKey || '', im = gv('.wizard-imgmodel') || st.imgModel || ''
        const palOk = PALETTES.some((p) => p.id === st.palette)
        if (palOk) cfg().palette = st.palette // 配色方案落库（先赋值，applyTheme 按新值写 data-palette）
        applyTheme(st.theme)
        if (palOk) applyPalettePresetLink(cfg().palette) // 与标题栏主题弹窗一致：部分配色联动推荐外观
        if (b) cfg().baseUrl = b
        if (k) cfg().apiKey = k
        if (m) cfg().model = m
        if (st.preset && WIZ_PRESETS[st.preset]) cfg().preset = st.preset
        cfg().illustPreset = st.imgPreset
        if (st.imgPreset !== 'off') {
          if (ib) cfg().illustBaseUrl = ib
          if (ik) cfg().illustApiKey = ik
          if (im) cfg().illustModel = im
        }
        saveStore()
        try { api.mainChanged({ theme: cfg().theme }) } catch { /* noop */ }
        refreshModelSelect()
        toast('配置完成，祝你转生愉快', 'ok')
        close()
      })
      back.addEventListener('click', () => {
        const step = +mask.dataset.step || 0
        if (step === 0) {
          if (origTheme !== st.theme) applyTheme(origTheme) // 跳过：还原实时预览切换的主题
          if (origPalette !== st.palette) { cfg().palette = origPalette; document.documentElement.setAttribute('data-palette', origPalette) } // 跳过：还原配色预览
          close(); return // 跳过：保留默认，稍后设置
        }
        cacheStep(step)
        mask.dataset.step = String(step - 1); render()
      })
      mask.dataset.step = '0'
      render()
    })
  }


  function showDisclaimer() {    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm disclaimer'
      box.style.width = '520px'
      const head = document.createElement('div')
      head.className = 'confirm-head disclaimer-head'
      const emblem = document.createElement('span')
      emblem.className = 'disclaimer-emblem'
      emblem.textContent = '六'
      const headTxt = document.createElement('span')
      headTxt.className = 'disclaimer-head-txt'
      const title = document.createElement('div')
      title.className = 'confirm-title'
      title.textContent = '请先阅读免责声明'
      const sub = document.createElement('div')
      sub.className = 'disclaimer-sub'
      sub.textContent = '首次启动 · 阅读以下条款后继续'
      headTxt.appendChild(title); headTxt.appendChild(sub)
      head.appendChild(emblem); head.appendChild(headTxt)
      const body = document.createElement('div')
      body.className = 'disclaimer-body'
      // 条款列表：mono 编号（§01–05）+ 文本，对齐原型 F
      const items = [
        ['§01', '<strong>本软件是纯粹的本地工具。</strong>六面世界只是一个开源的桌面壳（界面 + 本地存储），不内置、不分发、也不代理任何 AI 服务。所有故事文本与插图均由<strong>你自己在设置中配置的第三方模型提供商</strong>（DeepSeek / OpenAI / 智谱等）生成并直接返回给你。'],
        ['§02', '<strong>不涉及侵权分发。</strong>本软件不提供、不托管任何受版权保护的小说原文、插画、音频或视频。世界内核（kernel.md）为玩家自备的同人创作设定文本；生成内容的权利与合规性由所用提供商的服务条款约束。'],
        ['§03', '<strong>生成内容免责。</strong>AI 生成的内容可能存在不准确、不适宜或与原作不符之处，仅供个人娱乐，请勿用于商业用途或对外发布为官方内容。'],
        ['§04', '<strong>费用自负。</strong>调用第三方 API 产生的 token 费用与图像生成费用由你的账户承担，请自行关注用量面板与提供商账单。'],
        ['§05', '<strong>内容安全。</strong>请遵守当地法律法规与提供商的使用政策；未满 18 周岁请在监护人指导下使用。']
      ]
      body.innerHTML = items.map((it) =>
        '<div class="d-item"><span class="d-no">' + it[0] + '</span><p>' + it[1] + '</p></div>'
      ).join('') +
        '<p class="d-final">继续使用即表示你已阅读并理解以上条款，<strong>相关风险与责任由使用者自行承担</strong>。</p>'
      const check = document.createElement('label')
      check.className = 'disclaimer-check'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      const ct = document.createElement('span')
      ct.textContent = '我已阅读并同意以上声明，理解风险由我自行承担'
      check.appendChild(cb); check.appendChild(ct)
      const foot = document.createElement('div')
      foot.className = 'confirm-foot disclaimer-foot'
      const ok = document.createElement('button')
      ok.className = 'primary'
      ok.textContent = '同意并继续'
      ok.disabled = true
      foot.appendChild(ok)
      box.appendChild(head); box.appendChild(body); box.appendChild(check); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)
      cb.addEventListener('change', () => { ok.disabled = !cb.checked })
      ok.addEventListener('click', () => {
        if (mask.dataset.leaving === '1') return
        mask.dataset.leaving = '1'
        box.classList.add('closing'); mask.classList.add('closing')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          mask.remove(); resolve(true)
        }
        box.addEventListener('animationend', (ev) => { if (ev.target === box) finish() })
        setTimeout(finish, 260)
      })
      setTimeout(() => { body.scrollTop = 0; cb.focus() }, 50)
    })
  }

  function splashBoot() {
    const el = document.getElementById('splash')
    if (!el) return
    const preview = (() => { try { return !!localStorage.getItem('sixworlds.splash-preview') } catch { return false } })()
    if ((window.api && window.api.isTest) && !preview) { el.remove(); return }
    // R85：用户在设置里勾选「跳过开场动画」→ 移除启动页（窗口 show:false + ready-to-show 才显示，此处在首帧前执行，无闪现）
    const skip = (() => { try { return !!JSON.parse(localStorage.getItem(STORE_KEY) || '{}').skipSplash } catch { return false } })()
    if (skip && !preview) { el.remove(); return }

    // 粒子尘埃：约 70 颗光尘缓慢上浮（72% 琥珀 / 其余青与珊瑚），出界回收
    const cv = document.getElementById('splash-dust')
    if (cv && cv.getContext) {
      const ctx = cv.getContext('2d')
      const resize = () => { cv.width = innerWidth; cv.height = innerHeight }
      resize(); addEventListener('resize', resize)
      const dust = []
      for (let i = 0; i < 70; i++) {
        dust.push({
          x: Math.random(), y: Math.random(),
          r: .6 + Math.random() * 1.6,
          vx: (Math.random() - .5) * .00016,
          vy: -.00006 - Math.random() * .00022,
          a: .08 + Math.random() * .3,
          tint: Math.random() < .72 ? '217,154,82' : (Math.random() < .5 ? '122,215,194' : '255,83,103')
        })
      }
      ;(function tick() {
        if (!el.isConnected) return // 离场移除后停帧
        ctx.clearRect(0, 0, cv.width, cv.height)
        for (const d of dust) {
          d.x += d.vx; d.y += d.vy
          if (d.y < -.02) { d.y = 1.02; d.x = Math.random() }
          if (d.x < -.02) d.x = 1.02; else if (d.x > 1.02) d.x = -.02
          ctx.beginPath()
          ctx.arc(d.x * cv.width, d.y * cv.height, d.r, 0, 7)
          ctx.fillStyle = 'rgba(' + d.tint + ',' + d.a + ')'
          ctx.fill()
        }
        requestAnimationFrame(tick)
      })()
    }

    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.classList.add('exiting') // 粒子层先行淡出（CSS 双层时序），整层 620ms 后移除
      document.removeEventListener('keydown', onKey)
      setTimeout(() => el.remove(), 660)
    }
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); finish() }
    }
    // 主词定格（约 2.6s）后开放点击进入；「点击进入」提示 4.6s 才出现（CSS 动画时序）
    setTimeout(() => { el.classList.add('ready'); el.addEventListener('click', finish) }, 2600)
    document.addEventListener('keydown', onKey)
    setTimeout(finish, 12000) // 兜底：12s 未点击自动进入
  }


    return { showSetupWizard, showDisclaimer, splashBoot, WIZ_PRESETS, WIZ_IMG_PRESETS }
  }

  window.Onboarding = { createOnboarding }
})()

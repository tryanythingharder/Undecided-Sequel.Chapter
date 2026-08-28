/* ======== 六面世界 · 设置（独立系统窗口） ======== */
// 配置仍存 localStorage（与主窗口同源共享），保存/预览通过 settings:changed 广播给主窗口
(() => {
  'use strict'

  const api = window.api
  const $ = (id) => document.getElementById(id)

  // ---- 文本模型预设（与主窗口 app.js 保持一致）----
  const PRESETS = {
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    moonshot: { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0711-preview' },
    zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    qwen: { name: '通义 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    custom: { name: '自定义', baseUrl: '', model: '' }
  }

  // ---- 图像模型预设 ----
  const IMG_PRESETS = {
    off: { name: '关闭', baseUrl: '', model: '' },
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
    zhipu: { name: '智谱 CogView', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4' },
    silicon: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors' },
    dashscope: { name: '通义万相', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'wanx2.1-t2i-turbo' },
    custom: { name: '自定义', baseUrl: '', model: '' }
  }

  const STORE_KEY = 'sixworlds.codex.state.v3'
  const SESSIONS_KEY = 'sixworlds.sessions.v2'
  const DEFAULT_CFG = {
    preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    kernelPath: '',
    theme: 'system',
    palette: 'classic',
    fontUI: 'sans',
    radius: 'standard',
    density: 'standard',
    layout: 'sidebar',
    sbSide: 'left',
    models: [],
    thinkLevel: 'default',
    illustQuality: 'default',
    fontSize: 'standard',
    readWidth: 'standard',
    pin: false,
    skipSplash: false,
    illustAuto: false,
    illustPreset: 'off',
    illustBaseUrl: '',
    illustApiKey: '',
    illustModel: '',
    illustStyle: 'ln-original',
    illustCustom: '',
    illustSize: '1344x768',
    illustNegative: '',
    illustSeedLock: false,
    illustSeed: '',
    illustN: 1,
    illustMinLen: 80,
    illustPrefixEnable: true,
    illustPrefix: 'A scene illustration from a Japanese fantasy light novel.',
    ctxCount: 24,
    keepCount: 80,
    sidebarWidth: 200,
    sidebarCollapsed: false,
    currentSessionId: null
  }

  function loadStore() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (v) return v
      const old = JSON.parse(localStorage.getItem('sixworlds.codex.state.v2') || 'null')
      if (old) return old
      return {}
    } catch { return {} }
  }
  let cfg = Object.assign({}, DEFAULT_CFG, loadStore())
  if (cfg.palette === 'codex') cfg.palette = 'classic' // 旧版配置迁移：调色板 id 不再使用 codex 字样
  // 打开设置窗口时的模型表单初始值：用于保存时判断「用户是否改过模型」
  // 没改过 → 保留主窗口运行时切换的模型；改过 → 以表单为准
  let openedModel = String(cfg.model || '')

  // 写回前重读一次：主窗口运行期间可能改过会话等运行态键，逐一保留，避免设置窗口的旧快照覆盖
  // RUNTIME_KEYS = 主窗口运行时可改且不在设置表单里的键；model 有专门分支；models 清单只在本窗口维护不在此列
  const RUNTIME_KEYS = ['currentSessionId', 'currentWsId', 'thinkLevel', 'sidebarWidth', 'sidebarCollapsed']
  function persistCfg() {
    try {
      const fresh = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      if (fresh && typeof fresh === 'object') {
        for (const k of RUNTIME_KEYS) {
          if (fresh[k] !== undefined && fresh[k] !== null) cfg[k] = fresh[k]
        }
        // 模型以表单为准，除非用户没改过表单（此时保留主窗口运行时切换的模型）
        if ($('set-model').value.trim() === openedModel && fresh.model) cfg.model = fresh.model
      }
    } catch { /* 忽略 */ }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)) } catch { /* 忽略 */ }
  }

  // 读取共享会话数（清空世界线确认框用）
  function sessionCount() {
    try {
      const arr = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
      return Array.isArray(arr) ? arr.length : 0
    } catch { return 0 }
  }

  // ============ Toast 通知（与主窗口同款） ============
  function toast(msg, kind, dur) {
    kind = kind || 'info'
    let wrap = document.querySelector('.toast-wrap')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'toast-wrap'
      document.body.appendChild(wrap)
    }
    const el = document.createElement('div')
    el.className = 'toast ' + kind
    const icon = document.createElement('span')
    icon.className = 'toast-icon'
    icon.innerHTML = kind === 'ok'
      ? '<svg class="ic" viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 5"/></svg>'
      : (kind === 'err'
        ? '<svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
        : '<svg class="ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/></svg>')
    const m = document.createElement('span')
    m.className = 'toast-msg'
    m.textContent = msg
    el.appendChild(icon); el.appendChild(m)
    wrap.appendChild(el)
    const t = setTimeout(() => remove(), dur || 4200)
    function remove() {
      clearTimeout(t)
      el.classList.add('leaving')
      setTimeout(() => { el.remove() }, 220)
    }
    el.addEventListener('click', remove)
    return { close: remove }
  }

  // ============ 确认对话框（与主窗口同款） ============
  function confirmDialog(opts) {
    opts = opts || {}
    return new Promise((resolve) => {
      const mask = document.createElement('div')
      mask.className = 'confirm-mask'
      const box = document.createElement('div')
      box.className = 'confirm'
      const head = document.createElement('div')
      head.className = 'confirm-head'
      const title = document.createElement('div')
      title.className = 'confirm-title'
      title.textContent = opts.title || '确认'
      head.appendChild(title)
      const body = document.createElement('div')
      body.className = 'confirm-body'
      body.textContent = opts.body || ''
      const foot = document.createElement('div')
      foot.className = 'confirm-foot'
      const cancel = document.createElement('button')
      cancel.className = 'cancel'
      cancel.textContent = opts.cancelText || '取消'
      const ok = document.createElement('button')
      ok.className = opts.danger ? 'danger' : 'primary'
      ok.textContent = opts.okText || '确定'
      foot.appendChild(cancel); foot.appendChild(ok)
      box.appendChild(head); box.appendChild(body); box.appendChild(foot)
      mask.appendChild(box)
      document.body.appendChild(mask)
      function close(val) {
        mask.remove()
        resolve(val)
      }
      cancel.addEventListener('click', () => close(false))
      ok.addEventListener('click', () => close(true))
      mask.addEventListener('click', (e) => { if (e.target === mask) close(false) })
      const onKey = (e) => {
        if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey) }
        else if (e.key === 'Enter') { close(true); document.removeEventListener('keydown', onKey) }
      }
      document.addEventListener('keydown', onKey)
      setTimeout(() => ok.focus(), 50)
    })
  }

  // ============ 主题 / 外观（本窗口即时生效，主窗口走 preview 广播） ============
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)')
  function resolvedThemeLocal() {
    if (cfg.theme === 'dark' || cfg.theme === 'light') return cfg.theme
    return darkMQ.matches ? 'dark' : 'light'
  }
  // 跟随系统时，OS 明暗切换要实时反映到设置窗口（与主窗口行为一致）
  darkMQ.addEventListener('change', () => { if (cfg.theme === 'system') applyThemeLocal('system') })
  function applyThemeLocal(theme) {
    cfg.theme = theme
    const root = document.documentElement
    root.setAttribute('data-theme', resolvedThemeLocal())
    const PALETTE_IDS = ['classic', 'paper', 'forest', 'violet', 'ocean', 'rose', 'contrast']
    root.setAttribute('data-palette', PALETTE_IDS.includes(cfg.palette) ? cfg.palette : 'classic')
    const fonts = ['sans', 'serif', 'mono', 'kai']
    root.setAttribute('data-font', fonts.includes(cfg.fontUI) ? cfg.fontUI : 'sans')
    const radii = ['none', 'small', 'standard', 'round']
    if ((cfg.radius || 'standard') !== 'standard') root.setAttribute('data-radius', radii.includes(cfg.radius) ? cfg.radius : 'standard')
    else root.removeAttribute('data-radius')
    const dens = ['compact', 'standard', 'relaxed']
    if ((cfg.density || 'standard') !== 'standard') root.setAttribute('data-density', dens.includes(cfg.density) ? cfg.density : 'standard')
    else root.removeAttribute('data-density')
    api.setTheme(theme === 'dark' || theme === 'light' ? theme : 'system')
  }

  // ============ 分页签（记住上次页签，跨窗口持久化） ============
  const LAST_TAB_KEY = 'sixworlds.settings.lastTab'
  function switchTab(name) {
    try { localStorage.setItem(LAST_TAB_KEY, name) } catch { /* 忽略 */ }
    document.querySelectorAll('.modal-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === name)
    })
    document.querySelectorAll('.modal-body .tab-panel').forEach((p) => {
      const on = p.dataset.panel === name
      p.classList.toggle('active', on)
      p.hidden = !on
    })
  }
  document.querySelectorAll('.modal-tabs .tab').forEach((t) => {
    t.addEventListener('click', () => switchTab(t.dataset.tab))
  })

  // ============ 表单 ⇄ cfg ============
  function syncSettingsForm() {
    $('set-preset').value = cfg.preset
    $('set-baseurl').value = cfg.baseUrl
    $('set-apikey').value = cfg.apiKey
    $('set-model').value = cfg.model
    $('set-kernel').value = cfg.kernelPath || 'kernel.md'
    $('set-theme').value = cfg.theme
    $('set-palette').value = cfg.palette || 'classic'
    $('set-font').value = cfg.fontUI || 'sans'
    $('set-radius').value = cfg.radius || 'standard'
    $('set-density').value = cfg.density || 'standard'
    $('set-layout').value = cfg.layout || 'sidebar'
    $('set-sbside').value = cfg.sbSide || 'left'
    $('set-fontsize').value = cfg.fontSize || 'standard'
    $('set-readwidth').value = cfg.readWidth || 'standard'
    $('set-pin').checked = cfg.pin
    $('set-skip-splash').checked = !!cfg.skipSplash
    $('set-illust-quality').value = cfg.illustQuality || 'default'
    renderModelsPick()
    $('set-illust-auto').checked = cfg.illustAuto
    $('set-illust-preset').value = cfg.illustPreset
    $('set-illust-baseurl').value = cfg.illustBaseUrl
    $('set-illust-apikey').value = cfg.illustApiKey
    $('set-illust-model').value = cfg.illustModel
    $('set-illust-style').value = cfg.illustStyle
    $('set-illust-custom').value = cfg.illustCustom
    $('set-illust-size').value = cfg.illustSize
    $('set-illust-negative').value = cfg.illustNegative
    $('set-illust-seed-lock').checked = cfg.illustSeedLock
    $('set-illust-seed').value = cfg.illustSeed
    $('set-illust-n').value = cfg.illustN
    $('set-illust-minlen').value = cfg.illustMinLen
    $('set-illust-prompt-prefix-enable').checked = cfg.illustPrefixEnable
    $('set-illust-prompt-prefix').value = cfg.illustPrefix
    $('set-ctx').value = cfg.ctxCount
    $('set-keep').value = cfg.keepCount
    syncCustomStyleVisibility()
  }

  function syncCustomStyleVisibility() {
    const isCustom = cfg.illustStyle === 'custom'
    $('set-illust-custom-label').classList.toggle('hidden', !isCustom)
    $('set-illust-custom').classList.toggle('hidden', !isCustom)
  }

  // ============ 端点测试 ============
  async function testEndpoint(btn, resultEl, baseUrl, apiKey, model) {
    const box = $(resultEl)
    box.classList.remove('hidden', 'ok', 'err')
    const old = btn.textContent
    btn.disabled = true
    btn.textContent = '测试中…'
    box.textContent = '正在连接 ' + baseUrl + ' …'
    box.classList.add('pending')
    const r = await api.testEndpoint({ baseUrl, apiKey })
    btn.disabled = false
    btn.textContent = old
    box.classList.remove('pending')
    if (r && r.ok) {
      const hit = model && r.models && r.models.includes(model)
      const cnt = r.count > 0 ? ('，共 ' + r.count + ' 个模型') : ''
      box.classList.add('ok')
      box.textContent = '连接成功' + cnt + (model ? ('，当前模型「' + model + '」' + (hit ? '在列表中' : '未在列表中（可能仍可用）')) : '')
    } else {
      box.classList.add('err')
      box.textContent = (r && r.error) || '连接失败'
    }
  }

  $('btn-test-text').addEventListener('click', () => {
    const baseUrl = $('set-baseurl').value.trim()
    testEndpoint($('btn-test-text'), 'test-result-text', baseUrl, $('set-apikey').value.trim(), $('set-model').value.trim())
  })
  $('btn-test-image').addEventListener('click', () => {
    const baseUrl = $('set-illust-baseurl').value.trim()
    const apiKey = $('set-illust-apikey').value.trim() || $('set-apikey').value.trim()
    testEndpoint($('btn-test-image'), 'test-result-image', baseUrl, apiKey, $('set-illust-model').value.trim())
  })

  // ============ 模型列表获取 + 下拉选择（GET /models） ============
  // modelCache[kind] = { models: [], sig: baseUrl|apiKey }；sig 变化时点按钮重新拉取
  const modelCache = { text: null, image: null }
  // 下拉浮层离场动画（模块级：closeDD 与 document 级 Esc 共用）
  function animateHideDD(dd) {
    if (dd.dataset.leaving === '1') { dd.classList.add('hidden'); return }
    dd.dataset.leaving = '1'
    dd.classList.add('popout')
    let done = false
    const finish = () => {
      if (done) return
      done = true
      dd.classList.remove('popout')
      if (dd.dataset.leaving !== '1') return // 期间被重新打开
      dd.dataset.leaving = ''
      dd.classList.add('hidden')
    }
    dd.addEventListener('animationend', (ev) => { if (ev.target === dd) finish() })
    setTimeout(finish, 220)
  }
  function setupModelCombo(kind) {
    const inputId = kind === 'text' ? 'set-model' : 'set-illust-model'
    const btnId = kind === 'text' ? 'btn-models-text' : 'btn-models-image'
    const ddId = kind === 'text' ? 'model-dd-text' : 'model-dd-image'
    const filterId = kind === 'text' ? 'model-filter-text' : 'model-filter-image'
    const optsId = kind === 'text' ? 'model-opts-text' : 'model-opts-image'
    const emptyId = kind === 'text' ? 'model-empty-text' : 'model-empty-image'
    const input = $(inputId), btn = $(btnId), dd = $(ddId), filter = $(filterId), opts = $(optsId), empty = $(emptyId)

    function sig() {
      const baseUrl = (kind === 'text' ? $('set-baseurl') : $('set-illust-baseurl')).value.trim()
      let apiKey = $('set-apikey').value.trim()
      if (kind === 'image') apiKey = $('set-illust-apikey').value.trim() || apiKey
      return baseUrl + '|' + apiKey
    }
    function closeDD() { animateHideDD(dd) }
    function openDD() {
      filter.value = ''
      renderOptions()
      dd.dataset.leaving = ''
      dd.classList.remove('popout')
      dd.classList.remove('hidden')
      filter.focus()
    }
    function renderOptions() {
      const q = filter.value.trim().toLowerCase()
      const models = (modelCache[kind] && modelCache[kind].models) || []
      const list = q ? models.filter((m) => m.toLowerCase().includes(q)) : models
      opts.innerHTML = ''
      // 刷新行（始终在首行，点击重新拉取）
      const ref = document.createElement('div')
      ref.className = 'model-opt refresh'
      ref.textContent = '↻ 重新获取模型列表'
      ref.title = '重新请求 GET /models'
      ref.addEventListener('click', () => fetchModels())
      opts.appendChild(ref)
      for (const m of list) {
        const opt = document.createElement('div')
        opt.className = 'model-opt' + (m === input.value.trim() ? ' current' : '')
        opt.textContent = m
        opt.title = m
        opt.addEventListener('click', () => {
          input.value = m
          closeDD()
        })
        opts.appendChild(opt)
      }
      empty.classList.toggle('hidden', list.length > 0)
    }
    async function fetchModels() {
      const s = sig()
      const baseUrl = (kind === 'text' ? $('set-baseurl') : $('set-illust-baseurl')).value.trim()
      let apiKey = $('set-apikey').value.trim()
      if (kind === 'image') apiKey = $('set-illust-apikey').value.trim() || apiKey
      if (!baseUrl || !apiKey) { toast('请先填写 API 地址与密钥', 'err'); return }
      const old = btn.textContent
      btn.disabled = true
      btn.textContent = '获取中…'
      const r = await api.testEndpoint({ baseUrl, apiKey })
      btn.disabled = false
      btn.textContent = old
      if (r && r.ok) {
        const models = r.models || []
        if (!models.length) {
          toast('端点未返回模型列表，可手动填写模型名', 'info')
          return
        }
        modelCache[kind] = { models, sig: s }
        if (kind === 'text') renderModelsPick() // 刷新「在应用中使用的模型」勾选清单
        btn.title = '已获取 ' + models.length + ' 个模型（点击展开，可在面板内刷新）'
        openDD()
        toast('已获取 ' + models.length + ' 个模型', 'ok', 2000)
      } else {
        toast('获取模型列表失败：' + ((r && r.error) || '未知错误'), 'err')
      }
    }
    // 按钮：有缓存且地址/密钥未变 → 直接展开；否则拉取
    btn.addEventListener('click', () => {
      const c = modelCache[kind]
      if (c && c.sig === sig() && c.models.length) {
        if (dd.classList.contains('hidden')) openDD()
        else closeDD()
      } else {
        fetchModels()
      }
    })
    filter.addEventListener('input', renderOptions)
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeDD(); input.focus() }
      else if (e.key === 'Enter') {
        // 选中筛选后的第一个模型
        const first = opts.querySelector('.model-opt:not(.refresh)')
        if (first) { input.value = first.textContent; closeDD(); input.focus() }
      }
    })
    // 点击面板外部关闭（按钮自身切换已处理）
    document.addEventListener('click', (e) => {
      if (dd.classList.contains('hidden')) return
      if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeDD()
    })
  }
  setupModelCombo('text')
  setupModelCombo('image')

  // 密钥明文 / 密文切换
  function bindPeek(btnId, inputId) {
    $(btnId).addEventListener('click', () => {
      const el = $(inputId)
      el.type = el.type === 'password' ? 'text' : 'password'
      $(btnId).classList.toggle('on', el.type === 'text')
    })
  }
  bindPeek('btn-peek-key', 'set-apikey')
  bindPeek('btn-peek-illust-key', 'set-illust-apikey')

  // ============ 主窗口 -> 设置窗口 反向同步 ============
  // 主窗口运行时改了模型/思考程度/主题等，实时更新本窗口的 cfg 与表单；
  // 不覆盖用户正在编辑的其它字段（只在值确实变化时刷新对应控件）
  if (api.onCfgSync) {
    api.onCfgSync((data) => {
      data = data || {}
      let modelTouched = false
      if (data.model !== undefined && data.model !== cfg.model) {
        cfg.model = data.model
        const inp = $('set-model')
        // 只有用户没在编辑（值还是打开时快照）时才刷新输入框，避免打断输入
        if (inp && (inp.value.trim() === openedModel || inp.value.trim() === String(data.prevModel || ''))) {
          inp.value = data.model
        }
        openedModel = data.model
        modelTouched = true
      }
      if (data.thinkLevel !== undefined && data.thinkLevel !== cfg.thinkLevel) cfg.thinkLevel = data.thinkLevel
      if (data.palette !== undefined && data.palette !== cfg.palette) {
        cfg.palette = data.palette === 'codex' ? 'classic' : data.palette // 旧 id 兼容
        const sel = $('set-palette')
        if (sel) sel.value = cfg.palette
      }
      if (data.fontUI !== undefined && data.fontUI !== cfg.fontUI) {
        cfg.fontUI = data.fontUI
        const f = $('set-font')
        if (f) f.value = cfg.fontUI
      }
      if (data.density !== undefined && data.density !== cfg.density) {
        cfg.density = data.density
        const d = $('set-density')
        if (d) d.value = cfg.density
      }
      if (data.theme !== undefined && data.theme !== cfg.theme) {
        cfg.theme = data.theme
        const sel = $('set-theme')
        if (sel) sel.value = cfg.theme
        applyThemeLocal(cfg.theme)
      }
      if (modelTouched) renderModelsPick()
    })
  }

  // ============ 在应用中使用的模型（勾选清单：对话栏下拉可切换的模型） ============
  function cfgModelsSet() {
    const arr = Array.isArray(cfg.models) ? cfg.models : []
    return new Set(arr.filter(Boolean))
  }
  function renderModelsPick() {
    const listEl = $('models-pick-list')
    const emptyEl = $('models-pick-empty')
    if (!listEl) return
    const picked = cfgModelsSet()
    const fetched = (modelCache.text && modelCache.text.models) || []
    // 合并来源：已勾选的 + 当前输入框的 + 拉取到的
    const all = []
    const seen = new Set()
    for (const m of Array.from(picked).concat([$('set-model').value.trim()]).concat(fetched)) {
      if (m && !seen.has(m)) { seen.add(m); all.push(m) }
    }
    listEl.innerHTML = ''
    if (emptyEl) emptyEl.classList.toggle('hidden', all.length > 0)
    for (const m of all) {
      const row = document.createElement('label')
      row.className = 'models-pick-row'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = picked.has(m)
      cb.dataset.model = m
      cb.addEventListener('change', () => {
        // 立即写回 cfg（保存时统一持久化），并把当前模型保持在清单里
        const set = new Set(Array.isArray(cfg.models) ? cfg.models : [])
        if (cb.checked) set.add(m); else {
          if (m === $('set-model').value.trim()) { cb.checked = true; toast('当前使用的模型需保留在清单中', 'info'); return }
          set.delete(m)
        }
        cfg.models = Array.from(set)
      })
      const nm = document.createElement('span')
      nm.className = 'models-pick-name'
      nm.textContent = m
      nm.title = m
      row.appendChild(cb); row.appendChild(nm)
      listEl.appendChild(row)
    }
  }
  function manualAddModel() {
    const inp = $('set-model-manual')
    const v = String(inp.value || '').trim()
    if (!v) return
    const set = new Set(cfg.models || [])
    set.add(v)
    cfg.models = Array.from(set)
    inp.value = ''
    renderModelsPick()
  }
  $('btn-model-manual-add').addEventListener('click', manualAddModel)
  $('set-model-manual').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); manualAddModel() }
  })

  // ============ 预设切换 ============
  $('set-preset').addEventListener('change', (e) => {
    const p = PRESETS[e.target.value]
    if (p) {
      cfg.preset = e.target.value
      cfg.baseUrl = p.baseUrl
      cfg.model = p.model
      $('set-baseurl').value = p.baseUrl
      $('set-model').value = p.model
    }
  })
  $('set-illust-preset').addEventListener('change', (e) => {
    const p = IMG_PRESETS[e.target.value]
    if (p) {
      cfg.illustPreset = e.target.value
      cfg.illustBaseUrl = p.baseUrl
      cfg.illustModel = p.model
      $('set-illust-baseurl').value = p.baseUrl
      $('set-illust-model').value = p.model
    }
  })
  $('set-illust-style').addEventListener('change', (e) => {
    cfg.illustStyle = e.target.value
    syncCustomStyleVisibility()
  })

  // ============ 内核选择 ============
  $('btn-pick-kernel').addEventListener('click', async () => {
    const r = await api.pickKernel()
    if (r && r.ok && r.path) {
      cfg.kernelPath = r.path
      $('set-kernel').value = r.path
      toast('已选择内核文件', 'ok')
    }
  })

  // ============ 主题 / 外观 / 置顶 / 阅读体验：即时预览到主窗口（未保存可撤销） ============
  $('set-theme').addEventListener('change', (e) => {
    applyThemeLocal(e.target.value)
    api.settingsChanged({ preview: { theme: e.target.value } })
  })
  // 调色板「人设」联动（与主窗口同款逻辑，共用 sixworlds.preset-seeded.v1 标记）：
  // 首次选择 paper/forest/contrast 时联动推荐字体/密度，之后手动改过不再干预
  function palettePresetLink(paletteId) {
    const LINKS = { paper: { fontUI: 'serif' }, forest: { density: 'relaxed' }, contrast: { density: 'compact' } }
    const link = LINKS[paletteId]
    if (!link) return null
    let seeded = []
    try { seeded = JSON.parse(localStorage.getItem('sixworlds.preset-seeded.v1') || '[]') } catch { }
    if (!Array.isArray(seeded) || seeded.includes(paletteId)) return null
    seeded.push(paletteId)
    try { localStorage.setItem('sixworlds.preset-seeded.v1', JSON.stringify(seeded)) } catch { }
    return link
  }
  $('set-palette').addEventListener('change', (e) => {
    cfg.palette = e.target.value
    const link = palettePresetLink(e.target.value)
    if (link) {
      if (link.fontUI) { cfg.fontUI = link.fontUI; const f = $('set-font'); if (f) f.value = cfg.fontUI }
      if (link.density) { cfg.density = link.density; const d = $('set-density'); if (d) d.value = cfg.density }
    }
    applyThemeLocal(cfg.theme)
    const prev = { palette: e.target.value }
    if (link) { if (link.fontUI) prev.fontUI = cfg.fontUI; if (link.density) prev.density = cfg.density }
    api.settingsChanged({ preview: prev })
  })
  $('set-font').addEventListener('change', (e) => {
    cfg.fontUI = e.target.value
    applyThemeLocal(cfg.theme)
    api.settingsChanged({ preview: { fontUI: e.target.value } })
  })
  $('set-radius').addEventListener('change', (e) => {
    cfg.radius = e.target.value
    applyThemeLocal(cfg.theme)
    api.settingsChanged({ preview: { radius: e.target.value } })
  })
  $('set-density').addEventListener('change', (e) => {
    cfg.density = e.target.value
    applyThemeLocal(cfg.theme)
    api.settingsChanged({ preview: { density: e.target.value } })
  })
  $('set-layout').addEventListener('change', (e) => api.settingsChanged({ preview: { layout: e.target.value } }))
  $('set-sbside').addEventListener('change', (e) => api.settingsChanged({ preview: { sbSide: e.target.value } }))
  $('set-pin').addEventListener('change', (e) => api.settingsChanged({ preview: { pin: e.target.checked } }))
  $('set-fontsize').addEventListener('change', (e) => api.settingsChanged({ preview: { fontSize: e.target.value } }))
  $('set-readwidth').addEventListener('change', (e) => api.settingsChanged({ preview: { readWidth: e.target.value } }))

  // ============ 保存 ============
  $('btn-save-settings').addEventListener('click', () => {
    cfg.preset = $('set-preset').value
    cfg.baseUrl = $('set-baseurl').value.trim()
    cfg.apiKey = $('set-apikey').value.trim()
    cfg.model = $('set-model').value.trim()
    const kp = $('set-kernel').value.trim()
    cfg.kernelPath = kp && kp !== 'kernel.md' ? kp : ''
    cfg.theme = $('set-theme').value
    cfg.palette = $('set-palette').value
    cfg.fontUI = $('set-font').value
    cfg.radius = $('set-radius').value
    cfg.density = $('set-density').value
    cfg.layout = $('set-layout').value
    cfg.sbSide = $('set-sbside').value
    cfg.fontSize = $('set-fontsize').value
    cfg.readWidth = $('set-readwidth').value
    cfg.pin = $('set-pin').checked
    cfg.skipSplash = $('set-skip-splash').checked
    // 模型清单：当前模型必须包含在内（对话栏下拉至少有一个可选项）
    const mset = new Set(Array.isArray(cfg.models) ? cfg.models : [])
    if (cfg.model) mset.add(cfg.model)
    cfg.models = Array.from(mset)

    cfg.illustAuto = $('set-illust-auto').checked
    cfg.illustPreset = $('set-illust-preset').value
    cfg.illustBaseUrl = $('set-illust-baseurl').value.trim()
    cfg.illustApiKey = $('set-illust-apikey').value.trim()
    cfg.illustModel = $('set-illust-model').value.trim()
    cfg.illustStyle = $('set-illust-style').value
    cfg.illustCustom = $('set-illust-custom').value.trim()
    cfg.illustSize = $('set-illust-size').value
    cfg.illustQuality = $('set-illust-quality').value
    cfg.illustNegative = $('set-illust-negative').value.trim()
    cfg.illustSeedLock = $('set-illust-seed-lock').checked
    cfg.illustSeed = $('set-illust-seed').value.trim()
    const nN = Number($('set-illust-n').value)
    cfg.illustN = Number.isFinite(nN) ? Math.min(4, Math.max(1, nN)) : 1
    const ml = Number($('set-illust-minlen').value)
    cfg.illustMinLen = Number.isFinite(ml) ? Math.min(2000, Math.max(0, ml)) : 80
    cfg.illustPrefixEnable = $('set-illust-prompt-prefix-enable').checked
    cfg.illustPrefix = $('set-illust-prompt-prefix').value.trim()
    const cN = Number($('set-ctx').value)
    cfg.ctxCount = Number.isFinite(cN) ? Math.min(64, Math.max(2, cN)) : 24
    const kN = Number($('set-keep').value)
    cfg.keepCount = Number.isFinite(kN) ? Math.min(400, Math.max(8, kN)) : 80

    persistCfg()
    api.settingsChanged({ persisted: true })
    // 主窗口负责提示「设置已保存」；保存后关闭本窗口（与旧模态行为一致）
    // R70：延迟关窗——让保存反馈可见一瞬 + 消除 click 事件与关窗的竞态（自动化下 mousedown 即关窗会中断合成 click）
    setTimeout(() => api.close(), 180)
  })

  // 取消：直接关窗，主窗口收到 closed→revert 自动回滚预览
  $('btn-settings-cancel').addEventListener('click', () => api.close())

  // ============ 窗口控制（独立窗口：最小化 / 最大化 / 关闭） ============
  $('btn-win-min').addEventListener('click', () => api.minimize())
  $('btn-win-max').addEventListener('click', () => api.maximizeToggle())
  $('btn-win-close').addEventListener('click', () => api.close())

  // Esc 分层关闭：模型下拉 → 确认框（自行处理）→ 关窗
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('.confirm-mask')) return
    const openDD = document.querySelector('.model-dropdown:not(.hidden)')
    if (openDD) { animateHideDD(openDD); return }
    api.close()
  })

  // ============ 重置设置 ============
  $('btn-reset-settings').addEventListener('click', () => {
    confirmDialog({
      title: '恢复默认设置？',
      body: '所有设置项将恢复为默认值（世界线与插图不受影响）。',
      okText: '恢复默认'
    }).then((ok) => {
      if (!ok) return
      const keepSession = cfg.currentSessionId
      cfg = Object.assign({}, DEFAULT_CFG, { currentSessionId: keepSession })
      persistCfg()
      applyThemeLocal(cfg.theme)
      api.settingsChanged({ persisted: true })
      syncSettingsForm()
      toast('已恢复默认设置', 'ok')
    })
  })

  // ============ 清空全部世界线（会话存 localStorage，与主窗口共享） ============
  $('btn-clear-sessions').addEventListener('click', () => {
    const cnt = sessionCount()
    confirmDialog({
      title: '清空全部世界线？',
      body: '将永久删除所有 ' + cnt + ' 条世界线与其中全部插图，无法恢复。',
      danger: true,
      okText: '全部清空'
    }).then((ok) => {
      if (!ok) return
      try { localStorage.setItem(SESSIONS_KEY, '[]') } catch { /* 忽略 */ }
      api.settingsChanged({ persisted: true, clearSessions: true })
      toast('已清空全部世界线', 'info')
    })
  })

  // ============ 导入配置 ============
  $('btn-import-config').addEventListener('click', async () => {
    const r = await api.openFile({ title: '导入配置 JSON' })
    if (!r || !r.ok) return
    let data
    try { data = JSON.parse(r.content) } catch {
      toast('文件不是有效的 JSON', 'err')
      return
    }
    if (typeof data !== 'object' || data === null) { toast('配置格式不正确', 'err'); return }
    const keep = { apiKey: cfg.apiKey, illustApiKey: cfg.illustApiKey, currentSessionId: cfg.currentSessionId }
    cfg = Object.assign({}, DEFAULT_CFG, data, keep)
    if (cfg.palette === 'codex') cfg.palette = 'classic' // 导入文件兼容：旧 id 归一化
    persistCfg()
    applyThemeLocal(cfg.theme)
    api.settingsChanged({ persisted: true })
    syncSettingsForm()
    toast('配置已导入（密钥保留原值）', 'ok')
  })

  // ============ 导出配置 ============
  $('btn-export-config').addEventListener('click', async () => {
    const out = Object.assign({}, cfg)
    delete out.apiKey
    delete out.illustApiKey
    const content = JSON.stringify(out, null, 2)
    const r = await api.saveFile({ title: '导出配置', defaultName: 'sixworlds-config.json', content })
    if (r && r.ok) toast('配置已导出：' + r.path, 'ok')
    else if (r && r.error) toast('导出失败：' + r.error, 'err')
  })

  // ============ 启动 ============
  ;(function boot() {
    syncSettingsForm()
    applyThemeLocal(cfg.theme)
    let initialTab = 'text'
    try { initialTab = localStorage.getItem(LAST_TAB_KEY) || 'text' } catch { /* 忽略 */ }
    const valid = ['text', 'image', 'appearance', 'advanced']
    switchTab(valid.includes(initialTab) ? initialTab : 'text')
  })()
})()

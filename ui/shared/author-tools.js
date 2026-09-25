/* ======== 六面世界 · 作者工具（内核版本 / 版本差异 / 沙盒试玩 / 可重现测试记录 / 精选内核）========
 * 覆盖 docs/desktop-evolution.md 的两项验收：
 *   - 内核不可变版本、版本差异、独立试玩与可重现测试记录
 *   - 精选内核信息、版本/许可/适用模型/题材和预览
 *
 * 数据面全部在主进程 engine/author-tools.cjs（IPC channel 见 CHANNELS）：
 *   author:versions / author:version-register / author:version-read / author:diff /
 *   author:curated / author:preview / author:sandbox-list / author:sandbox-open /
 *   author:sandbox-context / author:sandbox-turn / author:sandbox-close /
 *   author:suite-run / author:records / author:record / author:replay
 * 本文件只做渲染与交互：复用 product-* CSS 与既有语义控件（button/select/input），
 * 不引入新配色，也不自行发起模型请求。
 *
 * 挂载：<script src="../shared/author-tools.js"></script>（先于 app.js，紧随 product-tools.js；
 * 只依赖已有的 product-tools.css / a11y.js / 各方案 styles.css，无需新增样式或 DOM 节点）
 * 集成：
 *   const AuthorTools = window.AuthorTools.create({
 *     api,                       // preload 暴露的 author* 方法（见上表，命名 authorXxx）
 *     shell: ProductTools,       // 可选：复用 ProductTools.create() 的 open(title)
 *     toast, confirm, prompt,    // 现有交互助手（confirm 缺失时危险操作直接拒绝）
 *     busy: () => busy || engineBusy,
 *     kernel: () => ({ id, name, text }),   // 当前内核（登记版本用；无内核时抛错提示）
 *     realTurn: null             // 可选：真实试玩回调（见下方说明），默认 null = 不调用模型
 *   })
 *   AuthorTools.mount()          // 在工作台头部（.chat-head-right）挂「作者」入口，
 *                                // 头部被 CSS 隐藏的方案自动回落到会话栏底部（.sidebar-foot）
 *
 * 验收口径：面板里所有「结构测试 / 离线回合」都显式标注为不调用模型、不代表模型叙事质量；
 * 模型质量验收只认「真实试玩（使用已配置模型）」的结果。
 * 沙盒回合以引擎为权威：回包 metadataSaved === false（引擎结果照实、meta.json 未同步）时，
 * 面板按 committed 区分提示——已提交则「已提交但元数据同步失败、请勿重复提交」，
 * 未提交则「未写入状态 + 元数据同步失败」，两者都不显示成引擎调用失败。
 *
 * 真实试玩：默认关闭。realTurn 未注入时，沙盒回合一律走离线确定性回合（不联网）。
 * 若 app 要接真实模型，传入 async ({ sandboxId, input, context }) => rawOutput 回调，
 * 并在回调内部自行确认用户意图；面板在点击「真实试玩」时仍会先弹确认框。
 */
(function () {
  'use strict'

  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el }
  const command = (text, action, cls = 'ghost') => {
    const button = node('button', cls, text)
    button.type = 'button'
    /* 异步动作的拒绝不得逃逸成未捕获异常：包一层并在按钮上给出错误提示 */
    button.addEventListener('click', () => {
      try {
        const result = action()
        if (result && typeof result.catch === 'function') result.catch((error) => console.warn('[author-tools]', (error && error.message) || error))
      } catch (error) { console.warn('[author-tools]', (error && error.message) || error) }
    })
    return button
  }
  const date = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '')
  const bytes = (value) => (Number(value) > 1024 ? (Number(value) / 1024).toFixed(1) + ' KB' : Number(value || 0) + ' B')

  function create(ctx) {
    const api = ctx.api || {}
    const shell = ctx.shell || null
    const report = (message, kind) => { try { ctx.toast(message, kind || 'info') } catch { /* 无 toast 时静默 */ } }

    /* 主进程调用：缺失通道给出可执行的提示，而不是静默失败 */
    async function call(name, payload) {
      const fn = api[name]
      if (typeof fn !== 'function') throw new Error('作者工具通道未接入：api.' + name + '（需在 preload 暴露 author:* 通道）')
      const result = await fn(payload || {})
      if (!result || result.ok !== true) throw new Error((result && result.error) || '作者工具调用失败')
      return result.data
    }
    /* 与 ProductTools 同形：withButton 直接执行并负责禁用/复位，调用点写成 () => withButton(btn, ...) */
    async function withButton(button, action) {
      button.disabled = true
      try { await action() } catch (error) { report((error && error.message) || String(error), 'err') } finally { button.disabled = false }
    }
    /* 面板：优先复用 ProductTools 的 open()，否则用同一套 product-* 结构自建（样式与焦点行为一致） */
    let active = null
    function open(title) {
      if (shell && typeof shell.open === 'function') { active = shell.open(title); return active }
      if (active) active.close()
      const trigger = document.activeElement
      const mask = node('div', 'product-mask')
      const panel = node('section', 'product-panel')
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title)
      const head = node('header', 'product-head')
      const closeButton = command('×', () => close(), 'product-close')
      closeButton.title = '关闭'; closeButton.setAttribute('aria-label', '关闭')
      head.append(node('h2', '', title), closeButton)
      const body = node('div', 'product-body')
      panel.append(head, body); mask.append(panel); document.body.append(mask)
      const onKey = (event) => {
        /* 与 ProductTools.open 同规：确认弹窗在前时不抢 Escape */
        if (document.querySelector('.confirm-mask')) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
        if (event.key === 'Tab' && window.A11y) window.A11y.trapTab(panel, event)
      }
      document.addEventListener('keydown', onKey, true)
      mask.addEventListener('click', (event) => { if (event.target === mask) close() })
      function close() {
        document.removeEventListener('keydown', onKey, true)
        mask.remove()
        if (active && active.mask === mask) active = null
        if (window.A11y) window.A11y.restore(trigger)
      }
      active = { mask, body, close }
      closeButton.focus()
      return active
    }
    /* 面板关闭后丢弃在途回调（与 ProductTools 的 live() 闸门同规） */
    const alive = (element) => !!element && document.contains(element)
    function status(host, message, error) { const el = node('p', 'product-status' + (error ? ' error' : ''), message); el.setAttribute('role', error ? 'alert' : 'status'); host.append(el); return el }
    /* 语义控件：select 用既有 .foot-select（三套界面均有，无新增配色）。
     * .foot-select 宽度有限，选项文本用 hash 这类短标识，完整名称放 title。 */
    function select(label, options) {
      const wrap = node('label')
      wrap.append(node('span', '', label))
      const el = node('select', 'foot-select')
      el.setAttribute('aria-label', label)
      for (const item of options) {
        const option = node('option', '', item.label)
        option.value = item.value
        if (item.title) option.title = item.title
        el.append(option)
      }
      wrap.append(el)
      return { wrap, el }
    }
    /* 等宽只读块：复用既有 .insp-logpre（三套界面均有）；差异删除行复用 .memory-before */
    const codeBlock = () => node('pre', 'insp-logpre')
    /* 结构测试 ≠ 模型试玩：所有涉及「测试通过/离线回合」的位置都必须带上这句口径说明，
     * 避免用户把确定性结构用例当成模型叙事质量验收。 */
    const STRUCTURAL_NOTE = '确定性结构用例：离线运行、不调用任何模型，只验证引擎与内核契约（开局/回滚/恢复/持久化/隔离），不代表模型叙事质量。'
    const OFFLINE_NOTE = '离线回合由本地确定性脚本生成，不调用模型，只验证引擎链路，不代表模型叙事质量。'
    function currentKernel() {
      const value = typeof ctx.kernel === 'function' ? ctx.kernel() : null
      if (!value || !value.id) throw new Error('请先在内核设计区选择或新建一个内核')
      return { id: String(value.id), name: String(value.name || value.id), text: String(value.text || '') }
    }
    /* 沙盒回合回包提示：引擎是权威——meta.json 未同步（metadataSaved === false）时不得显示成
     * 引擎失败（用户会重复提交并丢回合）。但 metadataSaved=false 与「是否推进状态」是两件事
     * （显式 NO_STATE_CHANGE 等合法回合 committed=false 且同样需要同步 meta），因此按 committed 区分文案。 */
    function sandboxTurnReport(result, suffix) {
      const unsynced = result.metadataSaved === false
      if (result.committed) {
        return {
          message: '沙盒回合 ' + result.turn + ' 已提交' + suffix + (unsynced ? ' · 已提交但元数据同步失败（引擎状态已生效，请勿重复提交）' : ''),
          kind: unsynced ? 'err' : 'ok'
        }
      }
      const base = '沙盒回合未写入状态：' + (result.patchStatus || '未知')
      return { message: base + (unsynced ? ' · 元数据同步失败（引擎状态为准，请勿重复提交）' : ''), kind: 'info' }
    }
    /* 危险操作确认：未注入 confirm 时明确报错，不静默继续（沙盒删除/真实试玩依赖它） */
    async function confirm(options) {
      if (typeof ctx.confirm !== 'function') throw new Error('未接入确认弹窗（ctx.confirm），已取消该操作')
      return !!(await ctx.confirm(options))
    }

    /* 四项能力都由正式「作者」入口可达，不依赖控制台调用实例方法。 */
    function openAuthor(title, current) {
      const view = open(title)
      const nav = node('nav', 'product-toolbar')
      nav.setAttribute('aria-label', '作者工具导航')
      for (const [key, label, action] of [
        ['versions', '版本与差异', versions], ['sandbox', '沙盒试玩', sandbox],
        ['records', '测试记录', records], ['library', '精选内核', library]
      ]) {
        const button = command(label, action)
        button.dataset.authorView = key
        if (key === current) button.setAttribute('aria-current', 'page')
        nav.append(button)
      }
      view.body.append(nav)
      return view
    }

    /* ---------- 内核版本与版本差异 ---------- */
    async function versions() {
      const view = openAuthor('内核版本与差异', 'versions')
      const list = node('div', 'product-list')
      let mode = 'list'
      const registerButton = command('登记当前内核版本', () => withButton(registerButton, async () => {
        if (typeof ctx.busy === 'function' && ctx.busy()) throw new Error('请等待当前回合完成')
        const kernel = currentKernel()
        const result = await call('authorVersionRegister', { kernelId: kernel.id, name: kernel.name, text: kernel.text, source: 'desktop' })
        report(result.created ? '已登记不可变版本 ' + result.version.hash : '该内容已登记过，沿用原版本 ' + result.version.hash, 'ok')
        render()
      }), 'primary')
      const compareButton = command('比较版本', () => { mode = 'diff'; render() })
      const backButton = command('返回版本列表', () => { mode = 'list'; render() })
      const toolbar = node('div', 'product-toolbar')
      toolbar.append(registerButton, compareButton, backButton)
      view.body.append(toolbar, list)

      async function render() {
        list.replaceChildren()
        let items = []
        try { items = await call('authorVersions', { kernelId: currentKernel().id }) } catch (error) { if (alive(list)) status(list, error.message, true); return }
        if (!alive(list)) return
        compareButton.disabled = items.length < 2
        backButton.hidden = mode === 'list'
        if (mode === 'diff') { await renderDiff(items); return }
        if (!items.length) { status(list, '尚无已登记版本 · 点击「登记当前内核版本」把当前内容固定为不可变版本'); return }
        for (const item of items) {
          const row = node('article', 'product-row')
          const copy = node('div', 'product-copy')
          copy.append(node('strong', '', item.title || item.name), node('small', '', 'hash ' + item.hash + ' · 版本 ' + (item.version || '未标注') + ' · ' + bytes(item.bytes) + ' · ' + date(item.createdAt) + (item.note ? ' · ' + item.note : '')))
          const actions = node('div', 'product-actions')
          actions.append(command('查看内容', () => showContent(item)))
          row.append(copy, actions)
          list.append(row)
        }
      }
      async function showContent(item) {
        const detail = await call('authorVersionRead', { kernelId: item.kernelId, hash: item.hash })
        if (!alive(list)) return
        list.replaceChildren()
        const section = node('section', 'chapter-section')
        section.append(node('h3', '', (item.title || item.name) + ' · ' + detail.hash), node('small', '', detail.intact ? '内容校验通过（与登记时一致）' : '内容校验失败：文件已被外部改写'))
        const pre = codeBlock()
        const full = String(detail.text || '')
        /* 仅显示层截断，落盘正文始终完整（hash 校验依据原文） */
        pre.textContent = full.slice(0, 8000)
        section.append(pre)
        if (full.length > 8000) section.append(node('small', '', '仅显示前 8000 字符（共 ' + full.length + ' 字符）；落盘版本为完整原文'))
        section.append(command('返回', () => render()))
        list.append(section)
      }
      async function renderDiff(items) {
        const option = (item) => ({ value: item.hash, label: item.hash, title: (item.title || item.name) + ' · ' + (item.version || '未标注') })
        const from = select('基准版本', items.map(option))
        const to = select('对比版本', items.map(option))
        to.el.selectedIndex = 0
        from.el.selectedIndex = items.length > 1 ? 1 : 0
        const runButton = command('开始比较', () => withButton(runButton, async () => {
          const result = await call('authorDiff', { kernelId: currentKernel().id, from: from.el.value, to: to.el.value })
          if (!alive(list)) return
          output.replaceChildren()
          if (result.same) { status(output, '两个版本内容一致'); return }
          status(output, '新增 ' + result.stats.added + ' 行 · 删除 ' + result.stats.removed + ' 行 · 未变 ' + result.stats.unchanged + ' 行' + (result.truncated ? '（内容过大，按整段替换展示）' : ''))
          for (const hunk of result.hunks) {
            const section = node('section', 'chapter-section')
            section.append(node('h3', '', '原 ' + (hunk.oldStart || '—') + ' 行 / 新 ' + (hunk.newStart || '—') + ' 行'))
            const pre = codeBlock()
            for (const row of hunk.rows) {
              const line = node('span', row.type === 'del' ? 'memory-before' : '', (row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  ') + row.text)
              line.dataset.diff = row.type
              pre.append(line, document.createTextNode('\n'))
            }
            section.append(pre)
            output.append(section)
          }
        }), 'primary')
        const output = node('div', 'product-list')
        list.append(from.wrap, to.wrap, runButton, output)
      }
      await render()
    }

    /* ---------- 独立沙盒试玩 ---------- */
    async function sandbox() {
      const view = openAuthor('沙盒试玩', 'sandbox')
      const list = node('div', 'product-list')
      const toolbar = node('div', 'product-toolbar')
      const versionPick = select('试玩内核版本', [])
      const openButton = command('创建独立沙盒', () => withButton(openButton, async () => {
        if (typeof ctx.busy === 'function' && ctx.busy()) throw new Error('请等待当前回合完成')
        const kernel = currentKernel()
        const hash = versionPick.el.value
        const result = hash
          ? await call('authorSandboxOpen', { kernelId: kernel.id, hash, label: kernel.name + ' 试玩' })
          : await call('authorSandboxOpen', { kernelId: kernel.id, text: kernel.text, label: kernel.name + ' 试玩' })
        report('已创建独立沙盒 ' + result.sandboxId + '（真实世界线不受影响）', 'ok')
        await render()
      }), 'primary')
      toolbar.append(versionPick.wrap, openButton)
      view.body.append(toolbar, list)
      /* 命名避免与外层面板 active 混淆：这里跟踪的是「当前选中的沙盒」 */
      let selected = null
      const input = node('input')
      input.placeholder = '沙盒里的行动（留空即观察）'; input.setAttribute('aria-label', '沙盒行动')
      const offline = command('提交离线回合（不调用模型）', () => withButton(offline, async () => {
        if (!selected) throw new Error('请先创建或选择一个沙盒')
        if (typeof ctx.busy === 'function' && ctx.busy()) throw new Error('请等待当前回合完成')
        const result = await call('authorSandboxTurn', { sandboxId: selected.sandboxId, input: input.value.trim() })
        input.value = ''
        const notice = sandboxTurnReport(result, '（离线）· 结构回合，非模型质量验收')
        report(notice.message, notice.kind)
        await render()
      }), 'primary')
      const realButton = command('真实试玩（使用已配置模型）', () => withButton(realButton, async () => {
        if (!selected) throw new Error('请先创建或选择一个沙盒')
        if (typeof ctx.realTurn !== 'function') throw new Error('真实试玩未接入：app 需注入 realTurn 回调（沙盒默认不发起模型请求）')
        if (typeof ctx.busy === 'function' && ctx.busy()) throw new Error('请等待当前回合完成')
        const confirmed = await confirm({ title: '使用已配置模型试玩？', body: '这一步会调用你已配置的文本模型，可能产生费用，并且只写入独立沙盒，不影响真实世界线。模型质量验收以这一步的结果为准。', okText: '继续试玩' })
        if (!confirmed) return
        const built = await call('authorSandboxContext', { sandboxId: selected.sandboxId, input: input.value.trim() })
        const raw = await ctx.realTurn({ sandboxId: selected.sandboxId, input: input.value.trim(), context: built })
        const result = await call('authorSandboxTurn', { sandboxId: selected.sandboxId, input: input.value.trim(), raw: String(raw || ''), model: 'user-configured' })
        input.value = ''
        const notice = sandboxTurnReport(result, '（真实模型）')
        report(notice.message, notice.kind)
        await render()
      }))
      const closeButton = command('结束沙盒', () => withButton(closeButton, async () => {
        if (!selected) return
        const confirmed = await confirm({ title: '结束沙盒？', body: '沙盒数据只用于试玩，删除后不可恢复；真实世界线不受影响。', danger: true, okText: '删除沙盒' })
        if (!confirmed) return
        await call('authorSandboxClose', { sandboxId: selected.sandboxId })
        selected = null
        report('沙盒已删除', 'ok')
        await render()
      }))
      closeButton.classList.add('danger')

      async function render() {
        list.replaceChildren()
        let versions = [], sandboxes = []
        try {
          const kernel = currentKernel()
          versions = await call('authorVersions', { kernelId: kernel.id })
          sandboxes = await call('authorSandboxList')
        } catch (error) { if (alive(list)) status(list, error.message, true); return }
        if (!alive(list)) return
        versionPick.el.replaceChildren()
        const current = node('option', '', '当前草稿（未登记版本）'); current.value = ''; versionPick.el.append(current)
        for (const item of versions) {
          const option = node('option', '', item.hash)
          option.value = item.hash
          option.title = (item.title || item.name) + ' · ' + (item.version || '未标注')
          versionPick.el.append(option)
        }
        /* 每次取最新元数据，既处理裁剪/删除，也更新已提交回合数。 */
        if (selected) selected = sandboxes.find((item) => item.sandboxId === selected.sandboxId) || null
        if (!selected && sandboxes.length) selected = sandboxes[0]
        if (selected) {
          const section = node('section', 'chapter-section')
          section.append(node('h3', '', selected.label || selected.sandboxId))
          section.append(node('small', '', '沙盒 ' + selected.sandboxId + ' · 内核 ' + selected.kernelHash + ' · 回合 ' + (selected.turns || 0) + ' · 独立目录 ' + selected.path))
          section.append(node('p', 'recap-note', OFFLINE_NOTE))
          const actions = node('div', 'product-actions')
          actions.append(offline, realButton, closeButton)
          section.append(input, actions)
          list.append(section)
        } else {
          status(list, '当前没有沙盒 · 选择内核版本后创建，试玩过程只写入独立目录')
        }
        if (sandboxes.length > 1) {
          const others = node('section', 'chapter-section')
          others.append(node('h3', '', '其他沙盒'))
          for (const item of sandboxes.slice(1)) {
            const row = node('div', 'product-row')
            row.append(node('span', '', (item.label || item.sandboxId) + ' · ' + (item.turns || 0) + ' 回合'), command('切换到此沙盒', () => { selected = item; render() }))
            others.append(row)
          }
          list.append(others)
        }
      }
      await render()
    }

    /* ---------- 可重现测试记录 ---------- */
    async function records() {
      const view = openAuthor('可重现测试记录', 'records')
      const list = node('div', 'product-list')
      const runButton = command('运行内核测试', () => withButton(runButton, async () => {
        if (typeof ctx.busy === 'function' && ctx.busy()) throw new Error('请等待当前回合完成')
        const kernel = currentKernel()
        const record = await call('authorSuiteRun', { kernelId: kernel.id, name: kernel.name, text: kernel.text })
        report(record.ok
          ? '结构测试通过：' + record.cases.length + ' 项（内核 ' + record.kernel.hash + '，未调用模型）'
          : '结构测试未全部通过，请查看记录', record.ok ? 'ok' : 'err')
        await render(record.recordId)
      }), 'primary')
      const toolbar = node('div', 'product-toolbar')
      toolbar.append(runButton)
      /* 口径声明常驻面板顶部：结构用例不是模型试玩，避免「测试通过」被误读成模型质量合格 */
      const note = node('p', 'recap-note', STRUCTURAL_NOTE)
      view.body.append(toolbar, note, list)

      async function render(highlight) {
        list.replaceChildren()
        let items = []
        try { items = await call('authorRecords', { kernelId: currentKernel().id }) } catch (error) { if (alive(list)) status(list, error.message, true); return }
        if (!alive(list)) return
        if (!items.length) { status(list, '暂无测试记录 · 点击「运行内核测试」执行开局、失败回滚、恢复与重启用例'); return }
        for (const item of items) {
          const row = node('article', 'product-row')
          const copy = node('div', 'product-copy')
          copy.append(node('strong', '', (item.ok ? '通过 · ' : '未通过 · ') + '内核 ' + item.kernel.hash), node('small', '', date(item.startedAt) + ' · 用时 ' + item.durationMs + 'ms · 引擎 ' + (item.engine && item.engine.version) + ' · 脚本 ' + (item.script && item.script.hash)))
          copy.append(node('small', '', '范围：结构用例（未调用模型）· 模型质量验收须用真实试玩'))
          const actions = node('div', 'product-actions')
          actions.append(command('查看详情', () => detail(item.recordId)), command('复跑比对', () => replay(item.recordId)))
          row.append(copy, actions)
          if (highlight && item.recordId === highlight) row.setAttribute('aria-current', 'true')
          list.append(row)
        }
      }
      async function detail(recordId) {
        const record = await call('authorRecord', { recordId })
        if (!alive(list)) return
        list.replaceChildren()
        const head = node('section', 'chapter-section')
        head.append(node('h3', '', '测试记录 ' + record.recordId), node('small', '', '内核 ' + record.kernel.hash + ' · 引擎 ' + record.engine.version + '（协议 ' + record.engine.protocol + '） · 脚本 ' + record.script.hash + ' · ' + date(record.startedAt)))
        head.append(node('p', 'recap-note', record.scopeNote || STRUCTURAL_NOTE))
        list.append(head)
        for (const item of record.cases) {
          const section = node('section', 'chapter-section')
          section.append(node('h3', '', (item.ok ? '通过 · ' : '未通过 · ') + item.title))
          section.append(node('p', '', item.detail || ''))
          section.append(node('small', '', JSON.stringify(item.evidence || {})))
          list.append(section)
        }
        list.append(command('返回记录列表', () => render(recordId)))
      }
      async function replay(recordId) {
        const result = await call('authorReplay', { recordId })
        if (!alive(list)) return
        list.replaceChildren()
        const head = node('section', 'chapter-section')
        head.append(node('h3', '', result.reproduced ? '复跑一致' : '复跑结果不一致'))
        head.append(node('small', '', '原记录 ' + result.original.recordId + '（' + (result.original.ok ? '通过' : '未通过') + '） → 复跑 ' + result.replay.recordId + '（' + (result.replay.ok ? '通过' : '未通过') + '）'))
        list.append(head)
        for (const row of result.rows) {
          const line = node('div', 'product-row')
          const before = row.before === null || row.before === undefined ? '（原记录无此项）' : (row.before ? '通过' : '未通过')
          const after = row.after ? '通过' : '未通过'
          line.append(node('span', '', row.title), node('span', '', before + ' → ' + after + (row.same ? ' · 一致' : ' · 不一致')))
          list.append(line)
        }
        list.append(command('返回记录列表', () => render(recordId)))
      }
      await render()
    }

    /* ---------- 精选内核：元数据与预览 ---------- */
    async function library() {
      const view = openAuthor('精选内核', 'library')
      const list = node('div', 'product-list')
      view.body.append(list)
      async function render() {
        list.replaceChildren()
        let items = []
        try { items = await call('authorCurated') } catch (error) { if (alive(list)) status(list, error.message, true); return }
        if (!alive(list)) return
        if (!items.length) { status(list, '内核库为空 · 先在设置中配置内核目录或新建内核'); return }
        for (const item of items) {
          const row = node('article', 'product-row')
          const copy = node('div', 'product-copy')
          copy.append(node('strong', '', item.name))
          copy.append(node('small', '', [item.tagline, item.version ? 'v' + item.version : '', item.license, item.author, item.genres.join(' / '), (item.recommendedModels || []).join(' / ')].filter(Boolean).join(' · ')))
          copy.append(node('small', '', '已登记版本 ' + item.registeredVersions + ' 个 · ' + (item.latestRecord ? '最近测试 ' + (item.latestRecord.ok ? '通过' : '未通过') + ' · ' + date(item.latestRecord.startedAt) : '尚无测试记录')))
          const actions = node('div', 'product-actions')
          const register = command('登记为版本', () => withButton(register, async () => {
            if (typeof ctx.busy === 'function' && ctx.busy()) throw new Error('请等待当前回合完成')
            const read = await call('authorVersionRegister', { kernelId: item.kernelId, name: item.name, fromLibrary: true, source: item.source })
            report('已登记版本 ' + read.version.hash, 'ok')
            await render()
          }))
          actions.append(command('预览', () => preview(item.kernelId)), register)
          row.append(copy, actions)
          list.append(row)
        }
      }
      async function preview(kernelId) {
        const detail = await call('authorPreview', { kernelId })
        if (!alive(list)) return
        list.replaceChildren()
        const head = node('section', 'chapter-section')
        head.append(node('h3', '', detail.info.name), node('small', '', [detail.info.tagline, detail.info.version ? 'v' + detail.info.version : '', detail.info.license, detail.info.author].filter(Boolean).join(' · ')))
        if (!detail.preview.available) head.append(node('p', '', '该内核内容暂不可读取（未接入内核库读取或文件缺失）'))
        else {
          head.append(node('small', '', detail.preview.lineCount + ' 行 · ' + bytes(detail.preview.bytes) + ' · 开局：' + (detail.preview.startLabel || '未声明')))
          if (detail.preview.headings.length) head.append(node('p', '', detail.preview.headings.join('\n')))
          const pre = codeBlock()
          pre.textContent = detail.preview.excerpt
          head.append(pre)
        }
        list.append(head, command('返回精选列表', render))
      }
      await render()
    }

    function mount() {
      let mounted = false
      /* 入口 1：工作台头部（经典/方案D 可见；proto 方案用 CSS 隐藏 .chat-head-right） */
      const head = document.querySelector('.chat-head-right')
      const headVisible = head && getComputedStyle(head).display !== 'none'
      if (headVisible && !document.getElementById('btn-author-tools')) {
        const button = command('作者', versions, 'tool-btn')
        button.id = 'btn-author-tools'
        button.title = '内核版本、差异、沙盒试玩与测试记录'
        head.prepend(button)
        mounted = true
      }
      /* 入口 2：会话栏底部（三套界面共有，与「存档」入口同列；头部隐藏时仍可用） */
      const foot = document.querySelector('.sidebar-foot')
      if (!document.getElementById('btn-author-tools') && foot) {
        const button = command('作者', versions, 'side-btn')
        button.id = 'btn-author-tools'
        button.title = '内核版本、差异、沙盒试玩与测试记录'
        foot.prepend(button)
        mounted = true
      }
      return mounted
    }

    return { open, mount, versions, sandbox, records, library, call }
  }

  window.AuthorTools = { create }
})()

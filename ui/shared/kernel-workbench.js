/* ======== 六面世界 · 内核工作台（桌面作者工具）UI（三方案共享） ========
 * 做什么：不可变内核发布版本（内容哈希 + 持久化，不覆盖旧版）、版本文本差异、独立引擎沙盒试跑
 *        （用户选定内核 + 固定本地 mock 叙事 + STATE_PATCH 流程 → 可重现记录）。
 * 不做什么：不调用任何模型 / 网络（真实试玩未授权一律阻断）、不触碰玩家世界线与工作区。
 *
 * 自挂载：本文件被 <script> 引入后自动：
 *   1) 注入 ui/shared/kernel-workbench.css（CSP style-src 'self' 允许）；
 *   2) 把「工作台」按钮插进三套界面共有的内核设计页顶部 .kernel-workbench-actions（在「发布」之前），
 *      无需改 index.html / app.js；找不到宿主时静默等待 DOMContentLoaded 再试一次。
 * 数据来源：window.api.kernelWb*（父代理在 main.cjs / preload.cjs 接入，通道名见 engine/kernel-workbench.js）。
 * 只读既有 DOM 做预填（#kernel-edit-name / #kernel-edit-text / #kernel-hub-title），不改其它模块状态。
 *
 * 手动接入（可选）：
 *   const wb = window.KernelWorkbench.create({ api: window.api, toast, ref: () => 'user:xxx', text: () => $('#kernel-edit-text').value })
 *   wb.open(); wb.mount('#btn-kernel-workbench')
 */
(function () {
  'use strict'

  const CSS_FALLBACK = '../shared/kernel-workbench.css'
  const scriptSrc = (() => {
    try { return (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '' } catch { return '' }
  })()

  function ensureStyle() {
    if (typeof document === 'undefined' || !document.head) return
    try {
      if (document.querySelector('link[data-kernel-workbench]')) return
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.setAttribute('data-kernel-workbench', '1')
      link.href = (scriptSrc ? scriptSrc.replace(/kernel-workbench\.js.*$/, 'kernel-workbench.css') : '') || CSS_FALLBACK
      document.head.appendChild(link)
    } catch { /* 样式注入失败不影响功能 */ }
  }

  const node = (tag, cls, text) => {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    if (text != null) el.textContent = text
    return el
  }
  const button = (text, action, cls) => {
    const b = node('button', 'kwb-btn' + (cls ? ' ' + cls : ''), text)
    b.type = 'button'
    if (action) b.addEventListener('click', action)
    return b
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild) }

  const TABS = [
    ['publish', '发布版本'],
    ['versions', '版本与差异'],
    ['cases', '沙盒试跑'],
    ['records', '试跑记录']
  ]

  /* 从内核设计页现有 DOM 推断默认 ref / 正文（只读，不写） */
  function domName() {
    try {
      const input = document.getElementById('kernel-edit-name')
      const v = input && input.value && input.value.trim()
      if (v) return v
      const title = document.getElementById('kernel-hub-title')
      return (title && title.textContent || '').trim()
    } catch { return '' }
  }
  function domText() {
    try {
      const ta = document.getElementById('kernel-edit-text')
      return (ta && ta.value) || ''
    } catch { return '' }
  }
  function domToast(msg, kind) {
    try {
      if (typeof window.toast === 'function') { window.toast(msg, kind); return }
    } catch { /* 继续回退 */ }
    try {
      const wrap = document.querySelector('.toast-wrap') || document.body
      const el = node('div', 'toast ' + (kind || 'info'), msg)
      wrap.appendChild(el)
      setTimeout(() => el.remove(), 3600)
    } catch { /* 静默 */ }
  }

  function create(ctx) {
    const c = ctx || {}
    /* api 惰性解析：脚本可能早于 preload 注入的 window.api 完成（或由父代理后置注入），
     * 因此每次调用都取当前引用，而不是创建时快照。 */
    const apiRef = () => (c.api || (typeof window !== 'undefined' && window.api) || {})
    const toast = typeof c.toast === 'function' ? c.toast : domToast
    const options = c.options || {}
    const state = { ref: '', tab: 'publish', view: null }

    const hasApi = (name) => typeof apiRef()[name] === 'function'
    const apiReady = () => hasApi('kernelWbPublish') && hasApi('kernelWbRun')

    function refValue() {
      if (typeof c.ref === 'function') { const v = c.ref(); if (v) return String(v) }
      if (options.ref) return String(options.ref)
      if (state.ref) return state.ref
      const name = domName() || 'draft'
      state.ref = 'user:' + name
      return state.ref
    }
    function textValue() {
      if (typeof c.text === 'function') { const v = c.text(); if (v) return String(v) }
      return domText()
    }

    async function call(name, payload) {
      if (!hasApi(name)) return { ok: false, error: '接口未接入：window.api.' + name + '（需父代理接 IPC）' }
      try {
        const r = await apiRef()[name](payload)
        if (!r || typeof r !== 'object') return { ok: false, error: '接口返回异常' }
        /* 兼容两种主进程接线：ipcMain.handle 直返扁平结果；main.cjs 既有 safeHandle 会再包一层 { ok, data }。
         * 后者自动拆包，父代理两种接法都不用改渲染层。 */
        if (r.ok === true && r.data && typeof r.data === 'object' && typeof r.data.ok === 'boolean') return r.data
        return r
      } catch (error) { return { ok: false, error: String((error && error.message) || error) } }
    }

    /* ---------------- 面板骨架 ---------------- */
    function open() {
      if (state.view) state.view.close()
      const trigger = document.activeElement
      const mask = node('div', 'kwb-mask')
      const panel = node('section', 'kwb-panel')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-label', '内核工作台')

      const head = node('header', 'kwb-head')
      const headCopy = node('div')
      headCopy.append(node('h2', '', '内核工作台 · 发布与沙盒试跑'))
      headCopy.append(node('p', '', '发布不可变版本（内容哈希为身份，不覆盖旧版）、对比版本文本差异，并在独立引擎沙盒里用固定本地 mock 用例跑通状态记录流程。'))
      const closeBtn = node('button', 'kwb-close', '×')
      closeBtn.type = 'button'
      closeBtn.title = '关闭'
      closeBtn.setAttribute('aria-label', '关闭')
      head.append(headCopy, closeBtn)

      const banner = node('div', 'kwb-banner')
      const bannerText = node('span')
      bannerText.append(node('strong', '', '离线模拟，不是真实试玩：'))
      bannerText.append(document.createTextNode('沙盒用例使用固定本地文本，不调用任何模型或网络；真实模型试玩需你显式授权，本工作台不会代为发起。试跑在独立引擎目录中进行，不影响你的世界线与工作区。'))
      banner.append(bannerText)

      const tabs = node('div', 'kwb-tabs')
      tabs.setAttribute('role', 'tablist')
      tabs.setAttribute('aria-label', '工作台视图')
      const tabButtons = {}
      for (const [key, label] of TABS) {
        const b = button(label, () => { state.tab = key; render() })
        b.classList.add('kwb-tab')
        b.setAttribute('role', 'tab')
        b.dataset.tab = key
        tabButtons[key] = b
        tabs.append(b)
      }

      const body = node('div', 'kwb-body')
      panel.append(head, banner, tabs, body)
      mask.append(panel)
      document.body.append(mask)

      const onKey = (event) => {
        if (document.querySelector('.confirm-mask')) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
        if (event.key === 'Tab' && window.A11y && window.A11y.trapTab) window.A11y.trapTab(panel, event)
      }
      document.addEventListener('keydown', onKey, true)
      mask.addEventListener('click', (event) => { if (event.target === mask) close() })
      function close() {
        document.removeEventListener('keydown', onKey, true)
        mask.remove()
        if (state.view && state.view.mask === mask) state.view = null
        if (window.A11y && window.A11y.restore) window.A11y.restore(trigger)
      }
      state.view = { mask, body, close, render }
      closeBtn.addEventListener('click', close)
      render()
      return state.view
    }

    function status(box, message, kind) {
      const el = node('div', 'kwb-status' + (kind ? ' ' + kind : ''))
      el.setAttribute('role', kind === 'err' ? 'alert' : 'status')
      el.textContent = message
      box.append(el)
      return el
    }

    function refRow(box, onRefresh) {
      const row = node('div', 'kwb-row')
      const field = node('label', 'kwb-field')
      field.append(node('span', '', '内核引用（与内核库 id 一致，如 user:我的世界）'))
      const input = node('input')
      input.type = 'text'
      input.value = refValue()
      input.placeholder = 'user:内核名称'
      input.addEventListener('change', () => { state.ref = input.value.trim() || 'draft' })
      field.append(input)
      row.append(field)
      if (onRefresh) row.append(button('读取版本', async () => { state.ref = input.value.trim() || 'draft'; await onRefresh() }))
      box.append(row)
      return input
    }

    /* 状态条替换：同一宿主内只保留最新一条（避免反复操作堆一屏提示） */
    function replaceStatus(host, message, kind) {
      const old = host.querySelector('.kwb-live-status')
      if (old) old.remove()
      const el = status(host, message, kind)
      el.classList.add('kwb-live-status')
      return el
    }

    /* ---------------- 发布 ---------------- */
    function renderPublish(box) {
      if (!apiReady()) {
        status(box, '内核工作台接口尚未接入：需要在 main.cjs / preload.cjs 注册 kernel-wb:* 通道（接口代码见 engine/kernel-workbench.js 顶部注释）。', 'err')
        return
      }
      refRow(box, () => render())
      const row = node('div', 'kwb-row')
      const nameField = node('label', 'kwb-field')
      nameField.append(node('span', '', '版本名称（留空沿用内核名）'))
      const nameInput = node('input')
      nameInput.type = 'text'
      nameInput.value = domName()
      nameInput.maxLength = 60
      nameField.append(nameInput)
      const noteField = node('label', 'kwb-field')
      noteField.append(node('span', '', '本次改动说明（可选）'))
      const noteInput = node('input')
      noteInput.type = 'text'
      noteInput.maxLength = 200
      noteField.append(noteInput)
      row.append(nameField, noteField)
      box.append(row)

      const textField = node('label', 'kwb-field')
      textField.append(node('span', '', '要发布的完整内核正文（默认取当前设计页编辑器内容，可改）'))
      const area = node('textarea')
      area.value = textValue()
      area.spellcheck = false
      textField.append(area)
      box.append(textField)

      const actions = node('div', 'kwb-actions')
      const fromEditor = button('从设计页取正文', () => { area.value = textValue(); toast('已取当前设计页正文', 'ok') })
      const publishBtn = button('发布为新版本', null, 'primary')
      publishBtn.addEventListener('click', async () => {
        publishBtn.disabled = true
        try {
          const r = await call('kernelWbPublish', {
            ref: refValue(), name: nameInput.value.trim(), note: noteInput.value.trim(), text: area.value
          })
          if (!r.ok) { replaceStatus(box, '发布失败：' + r.error, 'err'); return }
          if (r.duplicate) {
            replaceStatus(box, '内容与已有版本完全相同（' + r.version + ' · ' + r.shortHash + '），未新建版本 —— 版本不可变，不会覆盖旧版。', 'ok')
            toast('内容未变化，沿用 ' + r.version, 'ok')
          } else {
            const box2 = replaceStatus(box, '已发布 ' + r.version + ' · 内容哈希 ' + r.hash, 'ok')
            box2.append(node('pre', '', '内容哈希（身份）：' + r.hash + '\n短哈希：' + r.shortHash + '\n版本文件只写一次，任何后续操作都不会覆盖它。'))
            toast('已发布 ' + r.version, 'ok')
          }
          await loadVersions(versionHolder, refValue())
        } finally { publishBtn.disabled = false }
      })
      actions.append(fromEditor, publishBtn)
      box.append(actions)
      box.append(node('p', 'kwb-hint', '版本身份是正文的 sha256 内容哈希：同一内容重复发布只会沿用既有版本；不同内容一律新开版本号，旧版本文件保持只读。'))

      const versionHolder = node('div', 'kwb-versions')
      box.append(versionHolder)
      void loadVersions(versionHolder, refValue())
    }

    async function loadVersions(box, ref) {
      clear(box)
      const r = await call('kernelWbList', { ref })
      if (!r.ok) { box.append(node('p', 'kwb-empty', '版本读取失败：' + r.error)); return }
      box.append(node('h3', 'kwb-sub', '已发布版本（' + r.releases.length + '）'))
      if (!r.releases.length) { box.append(node('p', 'kwb-empty', '还没有已发布版本。')); return }
      const table = node('table', 'kwb-table')
      const thead = node('thead'); const hr = node('tr')
      for (const t of ['版本', '内容哈希', '字节', '发布时间', '说明']) hr.append(node('th', '', t))
      thead.append(hr); table.append(thead)
      const tbody = node('tbody')
      for (const v of r.releases) {
        const tr = node('tr')
        tr.append(node('td', 'mono', v.version))
        tr.append(node('td', 'mono', v.shortHash))
        tr.append(node('td', 'mono', String(v.bytes)))
        tr.append(node('td', 'mono', new Date(v.createdAt).toLocaleString('zh-CN', { hour12: false })))
        tr.append(node('td', '', v.note || '—'))
        tbody.append(tr)
      }
      table.append(tbody); box.append(table)
      const verifyBtn = button('校验完整性（重算每个版本文件的内容哈希）', null)
      verifyBtn.addEventListener('click', async () => {
        verifyBtn.disabled = true
        try {
          const vr = await call('kernelWbVerify', { ref })
          if (!vr.ok) { toast('校验失败：' + vr.error, 'err'); return }
          toast(vr.intact ? '完整性通过：' + vr.checked + ' 个版本文件与哈希一致' : '发现 ' + vr.issues.length + ' 处不一致', vr.intact ? 'ok' : 'err')
          const old = box.querySelector('.kwb-verify-result'); if (old) old.remove()
          const out = node('div', 'kwb-status kwb-verify-result' + (vr.intact ? ' ok' : ' err'))
          out.textContent = vr.intact ? '完整性通过：' + vr.checked + ' 个版本文件的内容哈希与索引一致。' : '发现问题：' + JSON.stringify(vr.issues)
          box.append(out)
        } finally { verifyBtn.disabled = false }
      })
      const actions = node('div', 'kwb-actions')
      actions.append(verifyBtn)
      box.append(actions)
    }

    /* ---------------- 版本与差异 ---------------- */
    function renderVersions(box) {
      if (!apiReady()) {
        status(box, '内核工作台接口尚未接入：需要在 main.cjs / preload.cjs 注册 kernel-wb:* 通道。', 'err')
        return
      }
      refRow(box, () => render())
      const holder = node('div', 'kwb-diff-holder')
      box.append(holder)
      void loadVersionDiff(box, holder)
    }

    async function loadVersionDiff(box, holderIn) {
      const holder = holderIn || box.querySelector('.kwb-diff-holder')
      if (!holder) return
      clear(holder)
      const list = await call('kernelWbList', { ref: refValue() })
      if (!list.ok) { holder.append(node('p', 'kwb-empty', '版本读取失败：' + list.error)); return }
      if (!list.releases.length) { holder.append(node('p', 'kwb-empty', '还没有已发布版本，先去「发布版本」发一版。')); return }
      const row = node('div', 'kwb-row')
      const mk = (label, values, def) => {
        const f = node('label', 'kwb-field')
        f.append(node('span', '', label))
        const sel = node('select')
        for (const v of values) { const o = node('option', '', v); o.value = v; sel.append(o) }
        if (def) sel.value = def
        f.append(sel); row.append(f)
        return sel
      }
      const versions = list.releases.map((v) => v.version)
      const fromSel = mk('旧版本', versions, versions[Math.max(0, versions.length - 2)])
      const toSel = mk('新版本', versions, versions[versions.length - 1])
      const goBtn = button('对比', null, 'primary')
      row.append(goBtn)
      holder.append(row)
      const out = node('div')
      holder.append(out)

      async function run() {
        clear(out)
        const r = await call('kernelWbDiff', { ref: refValue(), from: fromSel.value, to: toSel.value })
        if (!r.ok) { status(out, '差异计算失败：' + r.error, 'err'); return }
        const cards = node('div', 'kwb-cards')
        const card = (label, value, note) => {
          const el = node('div', 'kwb-card')
          el.append(node('span', '', label), node('strong', '', value))
          if (note) el.append(node('small', '', note))
          return el
        }
        cards.append(card('新增行', '+' + r.stats.added, r.stats.bLines + ' 行（新版本）'))
        cards.append(card('删除行', '-' + r.stats.removed, r.stats.aLines + ' 行（旧版本）'))
        cards.append(card('未变行', String(r.stats.same), r.identical ? '两版逐行相同' : '差异块 ' + r.hunks.length + ' 处'))
        cards.append(card('版本身份', r.from.shortHash + ' → ' + r.to.shortHash, r.from.version + ' → ' + r.to.version))
        out.append(cards)
        const pre = node('div', 'kwb-diff')
        if (r.identical) pre.append(node('div', 'kwb-diff-line meta', '两版正文逐行相同（内容哈希应相同；若版本号不同说明是重复发布被拦下的边界情况）'))
        for (const h of r.hunks) {
          pre.append(node('div', 'kwb-diff-line meta', '@@ -' + h.aStart + ',' + h.aCount + ' +' + h.bStart + ',' + h.bCount + ' @@'))
          for (const line of h.lines) {
            const cls = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : ''
            pre.append(node('div', 'kwb-diff-line' + (cls ? ' ' + cls : ''), (line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ') + line.text))
          }
        }
        out.append(pre)
        if (r.truncated) out.append(node('p', 'kwb-hint', '差异过大，展示已截断。'))
      }
      goBtn.addEventListener('click', run)
      await run()
    }

    /* ---------------- 沙盒试跑 ---------------- */
    function renderCases(box) {
      if (!apiReady()) {
        status(box, '内核工作台接口尚未接入：需要在 main.cjs / preload.cjs 注册 kernel-wb:* 通道。', 'err')
        return
      }
      refRow(box, () => render())
      const holder = node('div', 'kwb-cases')
      box.append(holder)
      void (async () => {
        const cases = await call('kernelWbCases')
        if (!cases.ok) { status(holder, '用例读取失败：' + cases.error, 'err'); return }
        const note = node('div', 'kwb-status')
        note.textContent = cases.disclaimer || '离线模拟：固定本地用例，不调用模型或网络。'
        holder.append(note)

        const row = node('div', 'kwb-row')
        const verField = node('label', 'kwb-field')
        verField.append(node('span', '', '试跑所用内核版本'))
        const verSel = node('select')
        verField.append(verSel)
        row.append(verField)
        holder.append(row)
        const list = await call('kernelWbList', { ref: refValue() })
        if (!list.ok || !list.releases.length) {
          holder.append(node('p', 'kwb-empty', '还没有已发布版本，先去「发布版本」发一版再试跑。'))
          return
        }
        for (const v of list.releases) {
          const o = node('option', '', v.version + ' · ' + v.shortHash + (v.note ? ' · ' + v.note : ''))
          o.value = v.version
          verSel.append(o)
        }
        verSel.value = list.latest

        holder.append(node('h3', 'kwb-sub', '固定离线用例（' + cases.cases.length + '）'))
        for (const c of cases.cases) {
          const card = node('div', 'kwb-case')
          card.append(node('h3', '', c.title))
          card.append(node('p', '', c.description))
          card.append(node('p', 'kwb-hint', c.turns + ' 幕 · 预期状态：' + (c.expect || []).join(' → ')))
          const runBtn = button('在此版本上运行', null, 'primary')
          runBtn.addEventListener('click', async () => {
            runBtn.disabled = true
            try {
              const r = await call('kernelWbRun', { ref: refValue(), version: verSel.value, caseId: c.id })
              const old = holder.querySelector('.kwb-run-result'); if (old) old.remove()
              const out = node('div', 'kwb-status kwb-run-result')
              if (!r.ok) { out.classList.add('err'); out.textContent = '试跑失败：' + r.error; holder.append(out); return }
              out.classList.add('ok')
              out.textContent = '试跑完成 · 摘要 ' + r.digest + '（相同用例重复运行摘要一致即为可重现）'
              const rec = r.record
              const cards = node('div', 'kwb-cards')
              const card = (label, value, small) => {
                const el = node('div', 'kwb-card')
                el.append(node('span', '', label), node('strong', '', value))
                if (small) el.append(node('small', '', small))
                return el
              }
              cards.append(card('提交回合', rec.summary.committed + ' / ' + rec.summary.turns, '冲突 ' + rec.summary.conflicts + ' · 无状态变化 ' + rec.summary.noStateChange))
              cards.append(card('引擎回合号', String(rec.summary.engine_turn), '内核绑定 ' + (r.kernel_binding || '—')))
              cards.append(card('记录文件', '已保存', r.relativeRecordPath))
              cards.append(card('模式', '离线模拟', 'realPlaytest = false · network = none'))
              out.append(cards)
              const table = node('table', 'kwb-table')
              const thead = node('thead'); const hr = node('tr')
              for (const t of ['幕', '玩家输入', '状态', '提交', '上下文', '落账']) hr.append(node('th', '', t))
              thead.append(hr); table.append(thead)
              const tbody = node('tbody')
              for (const t of rec.turns) {
                const tr = node('tr')
                tr.append(node('td', 'mono', String(t.index)))
                tr.append(node('td', '', t.playerInput))
                const st = node('td')
                const pill = node('span', 'kwb-pill ' + (t.patch_status === 'PATCH_PRESENT' ? 'ok' : t.patch_status === 'NO_STATE_CHANGE' ? 'warn' : 'err'), t.patch_status || '—')
                st.append(pill); tr.append(st)
                tr.append(node('td', '', t.committed ? '是' : '否'))
                tr.append(node('td', 'mono', t.context_chars + ' 字'))
                tr.append(node('td', 'mono', Object.keys(t.applied || {}).map((k) => k + ':' + t.applied[k].length).join(' ') || '—'))
                tbody.append(tr)
              }
              table.append(tbody); out.append(table)
              const pre = node('pre', '', rec.disclaimer + '\n\n' + rec.turns.map((t) => '【第 ' + t.index + ' 幕】\n' + t.narrative).join('\n\n'))
              out.append(pre)
              holder.append(out)
              toast('试跑完成，摘要 ' + r.digest.slice(7, 19), 'ok')
            } finally { runBtn.disabled = false }
          })
          const actions = node('div', 'kwb-actions')
          actions.append(runBtn)
          card.append(actions)
          holder.append(card)
        }
      })()
    }

    /* ---------------- 试跑记录 ---------------- */
    function renderRecords(box) {
      if (!apiReady()) {
        status(box, '内核工作台接口尚未接入：需要在 main.cjs / preload.cjs 注册 kernel-wb:* 通道。', 'err')
        return
      }
      refRow(box, () => render())
      const holder = node('div', 'kwb-records')
      box.append(holder)
      void loadRecords(box, holder)
    }

    async function loadRecords(box, holderIn) {
      const holder = holderIn || box.querySelector('.kwb-records')
      if (!holder) return
      clear(holder)
      const r = await call('kernelWbRecords', { ref: refValue() })
      if (!r.ok) { holder.append(node('p', 'kwb-empty', '记录读取失败：' + r.error)); return }
      holder.append(node('p', 'kwb-hint', r.disclaimer || '离线模拟记录。'))
      if (!r.records.length) { holder.append(node('p', 'kwb-empty', '还没有试跑记录。')); return }
      const table = node('table', 'kwb-table')
      const thead = node('thead'); const hr = node('tr')
      for (const t of ['用例', '版本', '摘要', '提交/幕', '模式', '文件']) hr.append(node('th', '', t))
      thead.append(hr); table.append(thead)
      const tbody = node('tbody')
      for (const rec of r.records.slice().reverse()) {
        const tr = node('tr')
        tr.append(node('td', '', rec.caseId))
        tr.append(node('td', 'mono', rec.version))
        tr.append(node('td', 'mono', String(rec.digest || '').slice(0, 19)))
        tr.append(node('td', 'mono', rec.summary ? rec.summary.committed + '/' + rec.summary.turns : '—'))
        tr.append(node('td', '', rec.realPlaytest ? '真实试玩' : '离线模拟'))
        tr.append(node('td', 'mono', rec.file))
        tbody.append(tr)
      }
      table.append(tbody); holder.append(table)
    }

    function render() {
      if (!state.view) return
      for (const b of state.view.body.parentElement.querySelectorAll('.kwb-tab')) {
        const on = b.dataset.tab === state.tab
        b.setAttribute('aria-selected', String(on))
        b.tabIndex = on ? 0 : -1
      }
      const box = state.view.body
      clear(box)
      if (state.tab === 'publish') renderPublish(box)
      else if (state.tab === 'versions') renderVersions(box)
      else if (state.tab === 'cases') renderCases(box)
      else renderRecords(box)
    }

    /* ---------------- 自挂载：三套界面共有的内核设计页顶部动作区 ---------------- */
    function mount(selector) {
      try {
        if (typeof document === 'undefined' || !document.body) return null
        const existing = document.getElementById('btn-kernel-workbench')
        if (existing) return existing
        const host = (selector && document.querySelector(selector)) ||
          document.querySelector('.kernel-workbench-actions') ||
          document.querySelector('.kernel-workbench-head') ||
          document.querySelector('.kernel-hub .kernel-stage-footer')
        if (!host) return null
        const btn = button('工作台', () => open())
        btn.id = 'btn-kernel-workbench'
        btn.classList.add('kernel-head-action')
        btn.title = '内核工作台：发布不可变版本 / 版本文本差异 / 独立引擎沙盒试跑（离线模拟）'
        const anchor = host.querySelector('#btn-kernel-publish') || host.querySelector('#btn-kernel-save')
        if (anchor && anchor.parentElement === host) host.insertBefore(btn, anchor)
        else host.prepend(btn)
        return btn
      } catch { return null }
    }

    ensureStyle()
    if (options.autoMount !== false) {
      if (typeof document !== 'undefined' && document.body) mount(options.hostSelector)
      else if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('DOMContentLoaded', () => mount(options.hostSelector))
    }

    return { open, close: () => state.view && state.view.close(), mount, render, call, ref: refValue, hasApi, apiReady }
  }

  const api = { create, ensureStyle, TABS }
  if (typeof window !== 'undefined') {
    window.KernelWorkbench = api
    /* 无显式 create 时也自挂一个默认实例（脚本引入即可用，零改 app.js） */
    try {
      if (!window.__kernelWorkbenchAuto) {
        window.__kernelWorkbenchAuto = create({})
      }
    } catch { /* 静默 */ }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()

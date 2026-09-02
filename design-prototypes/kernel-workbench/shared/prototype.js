(function () {
  'use strict'

  var body = document.body
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var chatLog = document.querySelector('[data-chat-log]')
  var sourceText = document.querySelector('[data-source-text]')
  var sourceName = document.querySelector('[data-source-name]')
  var saveState = document.querySelector('[data-save-state]')
  var searchInput = document.querySelector('[data-kernel-search]')
  var selectedKernel = '六面世界：人生模拟器'

  function toast(message, kind, duration) {
    var wrap = document.querySelector('.toast-wrap')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'toast-wrap'
      wrap.setAttribute('aria-live', 'polite')
      document.body.appendChild(wrap)
    }
    var el = document.createElement('div')
    el.className = 'toast ' + (kind || 'info')
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status')
    var icon = document.createElement('span')
    icon.className = 'toast-icon'
    icon.textContent = kind === 'ok' ? '✓' : (kind === 'err' ? '×' : '•')
    var text = document.createElement('span')
    text.textContent = message
    el.appendChild(icon)
    el.appendChild(text)
    wrap.appendChild(el)
    var timer = setTimeout(remove, duration || 3200)
    function remove() {
      clearTimeout(timer)
      el.classList.add('leaving')
      setTimeout(function () { el.remove() }, 300)
    }
    el.addEventListener('click', remove)
  }

  function busyIsland(message) {
    var old = document.querySelector('.island-busy')
    if (old) old.remove()
    var el = document.createElement('div')
    el.className = 'island-busy'
    el.setAttribute('aria-hidden', 'true')
    var dot = document.createElement('span')
    dot.className = 'island-dot'
    var text = document.createElement('span')
    text.textContent = message
    el.appendChild(dot)
    el.appendChild(text)
    document.body.appendChild(el)
    return function close() {
      el.classList.add('leaving')
      setTimeout(function () { el.remove() }, 320)
    }
  }

  function setMode(mode) {
    document.querySelectorAll('[data-mode]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.mode === mode)
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
    })
    document.querySelectorAll('[data-workspace]').forEach(function (workspace) {
      workspace.classList.toggle('is-hidden', workspace.dataset.workspace !== mode)
    })
    body.dataset.workspaceMode = mode
    toast(mode === 'kernel' ? '已进入内核设计' : '已返回内容区', 'info', 1600)
  }

  function setDirty() {
    if (!saveState) return
    saveState.textContent = '有未保存修改'
    saveState.classList.add('dirty')
  }

  function setKernel(button) {
    document.querySelectorAll('[data-kernel]').forEach(function (item) {
      item.classList.toggle('active', item === button)
      item.setAttribute('aria-selected', String(item === button))
    })
    selectedKernel = button.dataset.kernel || button.textContent.trim()
    document.querySelectorAll('[data-current-kernel]').forEach(function (el) { el.textContent = selectedKernel })
    if (sourceName) sourceName.value = selectedKernel
    if (sourceText) sourceText.value = button.dataset.source || sourceText.value
    if (saveState) {
      saveState.textContent = '已保存'
      saveState.classList.remove('dirty')
    }
    toast('已切换到：' + selectedKernel, 'ok', 1800)
  }

  function appendMessage(role, text) {
    if (!chatLog) return
    var row = document.createElement('article')
    row.className = 'chat-row ' + role
    var label = document.createElement('span')
    label.className = 'chat-role'
    label.textContent = role === 'user' ? '你' : 'AI 协作'
    var content = document.createElement('p')
    content.textContent = text
    row.appendChild(label)
    row.appendChild(content)
    chatLog.appendChild(row)
    chatLog.scrollTop = chatLog.scrollHeight
    if (!reducedMotion) row.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' })
  }

  function sendMessage(input) {
    var value = input.value.trim()
    if (!value) {
      toast('请先描述要设计或修改的规则', 'info', 1800)
      input.focus()
      return
    }
    appendMessage('user', value)
    input.value = ''
    var close = busyIsland('正在推演内核结构…')
    setTimeout(function () {
      close()
      appendMessage('assistant', '我会先把“' + value.slice(0, 22) + '”拆成体验目标、硬规则与可扩展模块，再同步到右侧草稿。')
      if (sourceText) sourceText.value += '\n\n## AI 协作修订\n- ' + value.replace(/\n/g, ' ')
      setDirty()
      toast('草稿已更新，等待保存', 'ok', 2200)
    }, 1050)
  }

  function addKernel(kind) {
    var list = document.querySelector('[data-kernel-list]')
    if (!list) return
    var button = document.createElement('button')
    var name = kind === 'import' ? '导入的世界内核' : '未命名世界'
    button.type = 'button'
    button.className = 'kernel-item'
    button.dataset.kernel = name
    button.dataset.kind = 'custom'
    button.dataset.source = '# KERNEL_META\nname: ' + button.dataset.kernel + '\nversion: 0.1\n\n## 核心体验\n等待与 AI 一起定义。'
    if (body.classList.contains('variant-precision')) {
      button.innerHTML = '<span class="kernel-glyph">' + (kind === 'import' ? '导' : '新') + '</span><span><strong>' + name + '</strong><small>自定义 / 刚刚创建</small></span><em>当前</em>'
    } else if (body.classList.contains('variant-spatial')) {
      button.innerHTML = '<span class="item-index">' + String.fromCharCode(65 + list.children.length) + '</span><span><strong>' + name + '</strong><small>自定义 / 当前工作层</small></span><em>NEW</em>'
    } else {
      button.innerHTML = '<strong>' + name + '</strong><span>自定义内核 / 刚刚创建</span><em>NEW</em>'
    }
    list.appendChild(button)
    button.addEventListener('click', function () { setKernel(button) })
    setKernel(button)
    updateKernelCounts()
    toast(kind === 'import' ? '示例内核已导入' : '新内核已创建', 'ok')
  }

  function updateKernelCounts() {
    var total = document.querySelectorAll('[data-kernel]').length
    var custom = document.querySelectorAll('[data-kernel][data-kind="custom"]').length
    document.querySelectorAll('[data-kernel-total]').forEach(function (el) {
      el.textContent = el.dataset.countFormat === 'pad2' ? String(total).padStart(2, '0') : total + ' 个内核'
    })
    document.querySelectorAll('[data-kernel-custom]').forEach(function (el) {
      el.textContent = '自定义 ' + custom
    })
  }

  function toggleThemePanel() {
    var panel = document.querySelector('[data-theme-panel]')
    if (!panel) return
    panel.hidden = !panel.hidden
  }

  function applyTheme(theme) {
    body.dataset.theme = theme
    var panel = document.querySelector('[data-theme-panel]')
    if (panel) panel.hidden = true
    toast('主题：' + ({ light: '浅色', dark: '深色', system: '跟随系统' }[theme] || theme), 'info', 1600)
  }

  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.addEventListener('click', function () { setMode(button.dataset.mode) })
  })

  document.querySelectorAll('[data-kernel]').forEach(function (button) {
    button.addEventListener('click', function () { setKernel(button) })
  })

  document.querySelectorAll('[data-prompt]').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = document.querySelector('[data-ai-input]')
      if (!input) return
      input.value = button.dataset.prompt
      input.focus()
    })
  })

  document.querySelectorAll('[data-theme-value]').forEach(function (button) {
    button.addEventListener('click', function () { applyTheme(button.dataset.themeValue) })
  })

  document.querySelectorAll('[data-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var action = button.dataset.action
      if (action === 'save') {
        if (saveState) { saveState.textContent = '已保存'; saveState.classList.remove('dirty') }
        toast('内核已保存到本地库', 'ok')
      } else if (action === 'send') {
        var input = document.querySelector('[data-ai-input]')
        if (input) sendMessage(input)
      } else if (action === 'new') {
        addKernel('new')
      } else if (action === 'import') {
        addKernel('import')
      } else if (action === 'theme') {
        toggleThemePanel()
      } else if (action === 'source') {
        body.classList.toggle('source-open')
      } else if (action === 'library') {
        body.classList.toggle('library-open')
      } else if (action === 'reset') {
        if (chatLog) chatLog.innerHTML = ''
        appendMessage('assistant', '新对话已开始。告诉我这个内核要服务什么类型的世界。')
        toast('已开始新的设计对话', 'info')
      } else if (action === 'content-send') {
        var contentInput = document.querySelector('[data-content-input]')
        if (contentInput && contentInput.value.trim()) {
          toast('内容请求已加入当前世界线', 'ok')
          contentInput.value = ''
        }
      }
    })
  })

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      var query = searchInput.value.trim().toLowerCase()
      document.querySelectorAll('[data-kernel]').forEach(function (item) {
        item.hidden = query && !item.textContent.toLowerCase().includes(query)
      })
    })
  }

  if (sourceName) sourceName.addEventListener('input', setDirty)
  if (sourceText) sourceText.addEventListener('input', setDirty)

  var resizer = document.querySelector('[data-resizer]')
  if (resizer) {
    resizer.addEventListener('pointerdown', function (event) {
      var startX = event.clientX
      var startWidth = parseFloat(getComputedStyle(body).getPropertyValue('--source-width')) || 390
      resizer.setPointerCapture(event.pointerId)
      function move(moveEvent) {
        var width = Math.max(300, Math.min(620, startWidth + startX - moveEvent.clientX))
        body.style.setProperty('--source-width', width + 'px')
      }
      function up(upEvent) {
        resizer.releasePointerCapture(upEvent.pointerId)
        resizer.removeEventListener('pointermove', move)
        resizer.removeEventListener('pointerup', up)
      }
      resizer.addEventListener('pointermove', move)
      resizer.addEventListener('pointerup', up)
    })
  }

  if (!reducedMotion) {
    document.querySelectorAll('[data-enter]').forEach(function (element, index) {
      element.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: index * 55, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' })
    })
  }

  setTimeout(function () { toast('原型已就绪', 'ok', 1600) }, 450)
})()

(() => {
  const pages = [...document.querySelectorAll('.page')]
  const steps = [...document.querySelectorAll('.rail-step')]
  const toast = document.querySelector('#toast')
  let toastTimer

  function showToast(message) {
    toast.querySelector('span').textContent = message
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600)
  }

  function go(route) {
    const target = document.querySelector(`[data-page="${route}"]`)
    if (!target) return
    pages.forEach((page) => {
      const active = page === target
      page.classList.toggle('active', active)
      page.hidden = !active
    })
    steps.forEach((step) => step.classList.toggle('active', step.dataset.step === route))
    document.querySelector('.workspace').scrollTo({ top: 0, behavior: 'smooth' })
  }

  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => go(button.dataset.route)))
  steps.forEach((step) => step.addEventListener('click', () => go(step.dataset.step)))
  document.querySelectorAll('[data-apply]').forEach((button) => button.addEventListener('click', () => showToast(`${button.dataset.apply} 已应用，正在创建世界线`)))
  document.querySelector('.mode-switch button:first-child').addEventListener('click', () => showToast('内容区将在内核应用后开始使用'))
  document.querySelector('.soft-button').addEventListener('click', () => showToast('设计助手：可以先从玩家身份开始想'))
  document.querySelector('.import-zone .primary-button').addEventListener('click', () => showToast('原型状态：打开本地文件选择器'))
  document.querySelector('.run-test-button').addEventListener('click', () => showToast('原型状态：正在运行临时世界线测试'))
  document.querySelector('.rules-toolbar .secondary-button').addEventListener('click', () => showToast('原型状态：打开规则 Markdown 预览'))
  document.querySelectorAll('.rule-card .row-action').forEach((button) => button.addEventListener('click', () => showToast('原型状态：打开规则编辑器')))
})()

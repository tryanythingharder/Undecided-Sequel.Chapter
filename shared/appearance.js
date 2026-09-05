/* ======== 六面世界 · 外观应用（主题/调色板/字体/圆角/密度/布局/阅读）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第四刀：appearance 集群（applyTheme / applyAppearance /
 * applyReading）。迁移前两侧 app.js 逐字相同（39 行）。cfg 为共享可变配置对象
 * （按引用注入，属性读写直通）；darkMQ / resolvedTheme / PALETTES / api.setTheme
 * 由 app.js 注入 —— 双方案差异只在注入值（如 proto 的 PALETTES 清单），不在逻辑。
 * 测试保护：e2e-mock.cjs theme-applied / palette-* / readwidth-* / fontsize-* 断言。
 * 挂载：<script src="../shared/appearance.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createAppearance(ctx) {
    // cfg 是 app.js 里可被整体重赋值的配置对象（设置保存后 cfg = Object.assign({}, ...)），
    // 因此经 ctx.cfg() 每次取当前引用，不能在闭包里捕获旧对象
    const cfg = () => ctx.cfg()
    const PALETTES = ctx.PALETTES
    const api = ctx.api

    function applyTheme(theme) {
      cfg().theme = theme
      const root = document.documentElement
      root.setAttribute('data-theme', ctx.resolvedTheme())
      root.setAttribute('data-palette', PALETTES.some((p) => p.id === cfg().palette) ? cfg().palette : 'classic')
      // nativeTheme 负责系统标题栏/滚动条：system/dark/light 原样透传
      api.setTheme(theme === 'dark' || theme === 'light' ? theme : 'system')
    }

    // 外观全量应用：调色板 / 展示字体 / 圆角 / 文字密度 / 布局 / 侧栏方向
    function applyAppearance() {
      const root = document.documentElement
      root.setAttribute('data-palette', PALETTES.some((p) => p.id === cfg().palette) ? cfg().palette : 'classic')
      root.setAttribute('data-theme', ctx.resolvedTheme())
      const fonts = ['sans', 'serif', 'mono', 'kai']
      root.setAttribute('data-font', fonts.includes(cfg().fontUI) ? cfg().fontUI : 'sans')
      const radii = ['none', 'small', 'standard', 'round']
      if ((cfg().radius || 'standard') !== 'standard') root.setAttribute('data-radius', radii.includes(cfg().radius) ? cfg().radius : 'standard')
      else root.removeAttribute('data-radius')
      const dens = ['compact', 'standard', 'relaxed']
      if ((cfg().density || 'standard') !== 'standard') root.setAttribute('data-density', dens.includes(cfg().density) ? cfg().density : 'standard')
      else root.removeAttribute('data-density')
      const layouts = ['sidebar', 'focus', 'immersive']
      document.body.classList.remove('layout-focus', 'layout-immersive')
      if (layouts.includes(cfg().layout) && cfg().layout !== 'sidebar') document.body.classList.add('layout-' + cfg().layout)
      document.body.classList.toggle('sb-right', cfg().sbSide === 'right')
    }

    // ---- 阅读体验：字号 / 栏宽（data 属性驱动 CSS 变量） ----
    function applyReading() {
      const root = document.documentElement
      const fs = { small: '13px', standard: '14.5px', large: '16px' }
      const rw = { narrow: '640px', standard: '720px', wide: '860px', xwide: '980px' }
      root.setAttribute('data-fontsize', cfg().fontSize || 'standard')
      root.style.setProperty('--read-w', rw[cfg().readWidth] || rw.standard)
      root.style.setProperty('--font-size', fs[cfg().fontSize] || fs.standard)
    }

    return { applyTheme, applyAppearance, applyReading }
  }

  window.AppearancePanel = { createAppearance }
})()

/* ======== 六面世界 · 浮层无障碍小工具（双方案共享） ========
 * 全屏浮层（画廊大图 / 漫画阅读 / 闪卡图鉴）统一需要：打开时把焦点移进浮层、
 * Tab 在浮层内循环、关闭后把焦点还给触发按钮。三处各写一遍容易漏，收在这里。
 * 用法：
 *   A11y.focusFirst(root)        打开后聚焦首个可聚焦元素
 *   A11y.trapTab(root, e)        keydown(Tab) 时调用，循环焦点
 *   A11y.restore(el)             关闭后把焦点还给触发元素（元素可能已被移除）
 * 挂载：<script src="../shared/a11y.js"></script>（先于各面板模块）
 */
(function () {
  'use strict'

  const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

  function focusables(root) {
    if (!root) return []
    return [...root.querySelectorAll(FOCUSABLE)]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  }

  function focusFirst(root) {
    const list = focusables(root)
    if (list.length) { try { list[0].focus() } catch {} }
  }

  function trapTab(root, e) {
    const list = focusables(root)
    if (!list.length) { e.preventDefault(); return }
    const first = list[0]
    const last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  function restore(el) {
    if (el && el.isConnected && typeof el.focus === 'function') { try { el.focus() } catch {} }
  }

  window.A11y = { focusFirst, trapTab, restore, focusables }
})()

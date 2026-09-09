/* ======== 六面世界 · toast 通知（经典 / 原型工作台 双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第六刀：toast。迁移前两侧 app.js 逐字相同，
 * 唯一差异是原型工作台在 toast 开头多一行 announceIsland(msg, kind, false)
 * （灵动岛通告）——差异参数化为 ctx.onToast 钩子：经典不传（无岛），
 * 原型传 (msg, kind) => announceIsland(msg, kind, false)。
 * R34 屏幕阅读器：wrap 作为状态通告区（aria-live），err 用 role=alert 强打断。
 * 测试保护：e2e-mock.cjs 全程 toast 交互（保存/删除/导入提示）+ settings 流程。
 * 挂载：<script src="../shared/toast.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createToast(ctx) {
    const onToast = ctx && ctx.onToast

    function toast(msg, kind, dur) {
      kind = kind || 'info' // ok | err | info
      if (onToast) onToast(msg, kind)
      let wrap = document.querySelector('.toast-wrap')
      if (!wrap) {
        wrap = document.createElement('div')
        wrap.className = 'toast-wrap'
        // R34 屏幕阅读器：toast 作为状态通告区（err 用 alert 强打断）
        wrap.setAttribute('aria-live', 'polite')
        document.body.appendChild(wrap)
      }
      const el = document.createElement('div')
      el.className = 'toast ' + kind
      el.setAttribute('role', kind === 'err' ? 'alert' : 'status')
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

    return { toast }
  }

  window.ToastPanel = { createToast }
})()

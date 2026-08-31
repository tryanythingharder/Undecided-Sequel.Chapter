/* 六面世界 · 移动端进度包导出（独立脚本，不侵入 app.js）
 * 悬浮按钮 → 收集 localStorage 会话/工作区 → 经主进程读取引擎文件 → 保存 JSON 进度包。
 * 手机端「设置 → 续玩码导入（进度包）」即可接续电脑进度。
 */
;(function () {
  if (window.__swProgressExportLoaded) return
  window.__swProgressExportLoaded = true

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
  }

  async function exportProgress() {
    try {
      const sessions = readJSON('sixworlds.sessions.v2', [])
      const workspaces = readJSON('sixworlds.workspaces.v1', [])
      const state = readJSON('sixworlds.codex.state.v3', {}) || {}
      if (!window.api || !window.api.exportProgress) {
        alert('桌面版本过低，不支持导出进度包。')
        return
      }
      setStatus('进度包打包中……')
      const res = await window.api.exportProgress({
        world: workspaces.find((w) => w.id === state.currentWsId) || null,
        sessions,
        workspaces,
      })
      if (res && res.ok) {
        alert('进度包已导出：\n' + res.path + '\n\n发送到手机后，在 App「设置 → 续玩码导入」选择该文件即可接续进度。')
      } else if (res && !res.canceled) {
        alert('导出失败：' + (res.error || '未知错误'))
      }
    } catch (e) {
      setStatus('导出失败：' + (e && e.message ? e.message : e))
    }
  }

  function mount() {
    const b = document.getElementById('btn-export-progress')
    if (!b || b.__swBound) return
    b.__swBound = true
    b.addEventListener('click', exportProgress)
  }

  function setStatus(text) {
    const el = document.getElementById('set-status')
    if (el) el.textContent = text
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()

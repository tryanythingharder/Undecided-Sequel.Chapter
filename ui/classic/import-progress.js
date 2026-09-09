/* 六面世界 · 进度包导入（独立脚本，不侵入 settings.js）
 * 设置 → 数据管理 → 导入进度包：主进程校验并写入引擎文件、合并落库世界线，
 * 并广播 progressImported 让主窗口重载内存态。适用于移动端导出的包在桌面接续，
 * 或桌面重装/换机后从备份恢复。
 */
;(function () {
  if (window.__swProgressImportLoaded) return
  window.__swProgressImportLoaded = true

  function setStatus(text) {
    const el = document.getElementById('set-status')
    if (el) el.textContent = text
  }

  async function importProgress() {
    if (!window.api || !window.api.importProgress) {
      alert('当前版本不支持导入进度包，请更新应用。')
      return
    }
    setStatus('导入进度包……')
    try {
      const res = await window.api.importProgress()
      if (res && res.canceled) { setStatus(''); return }
      if (!res || !res.ok) {
        alert('导入失败：' + ((res && res.error) || '未知错误'))
        setStatus('')
        return
      }
      const msg = '已导入 ' + res.count + ' 条世界线（引擎文件 ' + res.engineFiles + ' 个）。\n主窗口将自动刷新；若界面未刷新，重启应用即可。'
      alert(msg)
      setStatus('已导入 ' + res.count + ' 条世界线')
    } catch (e) {
      alert('导入失败：' + (e && e.message ? e.message : e))
      setStatus('')
    }
  }

  function mount() {
    const b = document.getElementById('btn-import-progress')
    if (!b || b.__swBound) return
    b.__swBound = true
    b.addEventListener('click', importProgress)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
})()

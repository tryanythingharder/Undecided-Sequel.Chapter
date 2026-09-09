/* ======== 六面世界 · 会话持久化客户端（经典 / 原型工作台 双方案共享） ========
 * 双 UI 方案冻结策略下，会话（世界线）的数据层是两侧逐行同构的复制体——每次共享数据结构
 * 改动都要人工双边同步。本模块把这段非 UI 逻辑收敛为单一来源：
 *   · localStorage 读取 + 主进程 sessions IPC 的三层合并（磁盘优先，测试态走本地）
 *   · 旧 key（sixworlds.sessions.v1）与无工作区归属会话的一次性迁移、孤儿会话自愈
 *   · 防抖保存（400ms 合并高频写；页面隐藏/关闭强制冲刷）+ 存储失败节流提示
 * 调用方职责：持有 sessions/workspaces/currentWsId 可变状态并传入访问器；toast 等纯 UI 回调注入。
 * 挂载：<script src="../shared/sessions-client.js"></script>（先于 app.js，全局 window.SessionsClient）
 */
(function () {
  'use strict'

  const SESSIONS_KEY = 'sixworlds.sessions.v2'
  const OLD_SESSIONS_KEY = 'sixworlds.sessions.v1'

  function createSessionsPersistence(state, ui) {
    const s = state || {}
    if (typeof s.getSessions !== 'function') throw new Error('SessionsClient: state.getSessions accessor required')
    const u = ui || {}
    const api = (typeof u.api !== 'undefined') ? u.api : window.api
    const warnSaveFail = u.warnSaveFail || function () {}

    /* 读取 + 合并（三层：主存 SQLite → localStorage → 旧 key 迁移）+ 孤儿自愈。
     * 传入 workspaces/currentWsId 的快照值（迁移归属要用），返回合并后的 sessions 数组；
     * 有归属修复时返回 needsSave=true，由调用方触发一次防抖保存。 */
    async function loadSessions(wsSnapshot, currentWsIdValue) {
      let localSessions = []
      try {
        localSessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
        if (!Array.isArray(localSessions)) localSessions = []
      } catch { localSessions = [] }
      let disk = null
      if (api.loadSessions) {
        try { disk = await api.loadSessions() } catch {}
      }
      let sessions = (!api.isTest && !api.isStorageTest && disk && disk.ok && disk.exists) ? disk.sessions : localSessions
      if (!Array.isArray(sessions)) sessions = []
      // 迁移 v1（无 createdAt）→ 补全
      for (const x of sessions) if (!x.createdAt) x.createdAt = x.updatedAt || Date.now()
      // 迁移旧 key 的会话
      if (sessions.length === 0) {
        try {
          const old = JSON.parse(localStorage.getItem(OLD_SESSIONS_KEY) || '[]')
          if (Array.isArray(old) && old.length) {
            sessions = old.map((x) => Object.assign({ createdAt: x.updatedAt || Date.now() }, x))
          }
        } catch {}
      }
      // 迁移：无工作区归属的旧会话 → 归入第一个工作区（默认世界）
      let needsSave = false
      // 自愈：记账中的临时标记只活在当次会话（补录重试期间防抖落盘会带上它）——重启后一律清除
      for (const x of sessions) {
        if (Array.isArray(x.messages)) for (const m of x.messages) { if (m && m.committing) { delete m.committing; needsSave = true } }
      }
      const homeWs = () => (wsSnapshot()[0] && wsSnapshot()[0].id) || currentWsIdValue
      if (sessions.some((x) => !x.ws)) {
        for (const x of sessions) if (!x.ws) x.ws = homeWs()
        needsSave = true
      }
      // 自愈：归属的工作区已不存在（工作区列表曾丢失重建）的孤儿会话 → 重新归入第一个工作区
      // 没有这条，用户旧对话会被隔离逻辑永久隐藏
      if (sessions.some((x) => x.ws && !wsSnapshot().some((w) => w.id === x.ws))) {
        for (const x of sessions) if (x.ws && !wsSnapshot().some((w) => w.id === x.ws)) x.ws = homeWs()
        needsSave = true
      }
      // 首次升级时把 localStorage 会话与插图迁入文件存储，成功后移除配额受限副本。
      if (!api.isTest && ((!disk || !disk.exists) || api.isStorageTest) && sessions.length && api.saveSessions) {
        const migrated = await api.saveSessions(sessions.slice(0, 50))
        if (migrated && migrated.ok) {
          try { localStorage.removeItem(SESSIONS_KEY); localStorage.removeItem(OLD_SESSIONS_KEY) } catch {}
        } else warnSaveFail('旧世界线迁移')
      }
      return { sessions, needsSave }
    }

    /* 防抖保存（规范八：前端不无限写）——高频写入合并为 400ms 一次全量落盘；
     * immediate=true 用于删除/导入/工作区切换等关键点；页面隐藏/关闭时强制冲刷，不丢尾部消息。 */
    let _saveTimer = 0
    function doSave() {
      const snapshot = s.getSessions().slice(0, 50)
      if (api.isTest) {
        try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(snapshot)) } catch { warnSaveFail('最新世界线进度') }
      }
      if (!api.saveSessions) return Promise.resolve()
      return api.saveSessions(snapshot).then((r) => {
        if (r && r.ok) {
          if (typeof u.onSaved === 'function') u.onSaved()
          if (!api.isTest) {
            try { localStorage.removeItem(SESSIONS_KEY) } catch {}
          }
        } else warnSaveFail('最新世界线进度')
      }).catch(() => warnSaveFail('最新世界线进度'))
    }
    function saveSessions(immediate) {
      if (immediate) { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = 0 } doSave(); return }
      if (_saveTimer) return
      _saveTimer = setTimeout(() => { _saveTimer = 0; doSave() }, 400)
    }
    function flushNow() { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = 0; doSave() } }
    function bindAutoFlush() {
      window.addEventListener('pagehide', () => { if (!api.isStorageTest) flushNow() })
      document.addEventListener('visibilitychange', () => { if (!api.isStorageTest && document.visibilityState === 'hidden') flushNow() })
    }

    return { loadSessions, saveSessions, bindAutoFlush, SESSIONS_KEY }
  }

  window.SessionsClient = { createSessionsPersistence, SESSIONS_KEY: 'sixworlds.sessions.v2' }
})()

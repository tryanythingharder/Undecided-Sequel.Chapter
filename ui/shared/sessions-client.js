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
    let loadFailed = false
    let freezeId = null
    let previousInert = false
    const isFrozen = () => freezeId !== null
    /* 读取 + 合并（三层：主存 SQLite → localStorage → 旧 key 迁移）+ 孤儿自愈。
     * 传入 workspaces/currentWsId 的快照值（迁移归属要用），返回合并后的 sessions 数组；
     * 有归属修复时返回 needsSave=true，由调用方触发一次防抖保存。 */
    async function loadSessions(wsSnapshot, currentWsIdValue) {
      let localSessions = []
      try {
        localSessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
        if (!Array.isArray(localSessions)) localSessions = []
      } catch { localSessions = [] }
      const preferDisk = !api.isTest || api.isStorageTest
      let disk = null
      if (api.loadSessions) {
        try { disk = await api.loadSessions() } catch (error) { disk = { ok: false, error: String(error) } }
        loadFailed = preferDisk && (!disk || !disk.ok)
        if (loadFailed) warnSaveFail('读取原有世界线失败，已暂停写入以保护存档；请重启后重试')
      }
      const useDisk = preferDisk && disk && disk.ok && disk.exists
      let sessions = useDisk ? disk.sessions : localSessions
      if (!Array.isArray(sessions)) sessions = []
      // 主进程持久化的 desktop-context 与会话同一提交：优先使用它迁移归属，
      // 避免旧 localStorage 工作区把磁盘会话误判成孤儿并在启动时创建默认线。
      const persistedContext = disk && disk.ok && disk.context && Array.isArray(disk.context.workspaces) && disk.context.workspaces.length
        ? disk.context : null
      const persistedWorkspaces = persistedContext ? persistedContext.workspaces : null
      const persistedCurrentWsId = persistedContext && persistedContext.current && typeof persistedContext.current.currentWsId === 'string'
        ? persistedContext.current.currentWsId : currentWsIdValue
      const effectiveWorkspaces = () => persistedWorkspaces || wsSnapshot()
      const effectiveCurrentWsId = () => persistedWorkspaces && persistedWorkspaces.some((w) => w.id === persistedCurrentWsId)
        ? persistedCurrentWsId : currentWsIdValue
      // 迁移 v1（无 createdAt）→ 补全
      for (const x of sessions) if (!x.createdAt) x.createdAt = x.updatedAt || Date.now()
      // 迁移旧 key 的会话
      if (sessions.length === 0 && !(disk && disk.ok && disk.exists)) {
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
      const homeWs = () => (effectiveWorkspaces()[0] && effectiveWorkspaces()[0].id) || effectiveCurrentWsId()
      if (sessions.some((x) => !x.ws)) {
        for (const x of sessions) if (!x.ws) x.ws = homeWs()
        needsSave = true
      }
      // 自愈：归属的工作区已不存在（工作区列表曾丢失重建）的孤儿会话 → 重新归入第一个工作区。
      // 磁盘上下文存在时它与 sessions 同步提交，必须优先于可能陈旧的 localStorage 工作区。
      if (sessions.some((x) => x.ws && !effectiveWorkspaces().some((w) => w.id === x.ws))) {
        for (const x of sessions) if (x.ws && !effectiveWorkspaces().some((w) => w.id === x.ws)) x.ws = homeWs()
        needsSave = true
      }
      // 首次升级时把 localStorage 会话与插图迁入文件存储，成功后移除配额受限副本。
      if (!loadFailed && !api.isTest && ((!disk || !disk.exists) || api.isStorageTest) && sessions.length && api.saveSessions) {
        const migrated = await api.saveSessions(sessions).catch(() => null)
        if (migrated && migrated.ok) {
          try { localStorage.removeItem(SESSIONS_KEY); localStorage.removeItem(OLD_SESSIONS_KEY) } catch {}
        } else warnSaveFail('旧世界线迁移')
      }
      return { sessions, needsSave, context: persistedContext }
    }

    /* 防抖保存（规范八：前端不无限写）——高频写入合并为 400ms 一次全量落盘；
     * immediate=true 用于删除/导入/工作区切换等关键点；页面隐藏/关闭时强制冲刷，不丢尾部消息。 */
    let _saveTimer = 0
    function doSave() {
      // 超限时保留磁盘正本，交给用户整理，不能按列表位置静默删除世界线。
      const all = s.getSessions()
      if (loadFailed) {
        warnSaveFail('原有世界线未成功读取，写入已暂停；请重启后重试')
        return Promise.resolve({ ok: false, error: 'SESSION_LOAD_FAILED' })
      }
      if (all.length > 200) {
        if (typeof u.onOverLimit === 'function') u.onOverLimit(all.length, all.length - 200)
        return Promise.resolve({ ok: false, error: 'SESSION_LIMIT' })
      }
      const snapshot = all
      if (api.isTest) {
        try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(snapshot)) } catch { warnSaveFail('最新世界线进度') }
      }
      if (!api.saveSessions) return Promise.resolve()
      return api.saveSessions(snapshot, typeof s.getContext === 'function' ? s.getContext() : undefined).then((r) => {
        if (r && r.ok) {
          if (typeof u.onSaved === 'function') u.onSaved()
          if (!api.isTest) {
            try { localStorage.removeItem(SESSIONS_KEY) } catch {}
          }
        } else warnSaveFail('最新世界线进度')
        return r
      }).catch((error) => { warnSaveFail('最新世界线进度'); return { ok: false, error: error.message || 'SESSION_SAVE_FAILED' } })
    }
    function saveSessions(immediate) {
      if (isFrozen()) return Promise.resolve({ ok: false, error: 'SESSION_FROZEN' })
      if (immediate) { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = 0 } return doSave() }
      if (_saveTimer) return
      _saveTimer = setTimeout(() => { _saveTimer = 0; if (!isFrozen()) doSave() }, 400)
    }
    function flushNow() { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = 0; if (!isFrozen()) return doSave() } }
    function bindFreeze(isBusy) {
      api.onSessionsFlush?.(async ({ id }) => {
        if (isFrozen() || (typeof isBusy === 'function' && isBusy())) {
          api.sessionsFlushed({ id, result: { ok: false, error: '当前仍在生成、导入或保存记忆' } })
          return
        }
        freezeId = id
        previousInert = document.body.inert
        document.body.inert = true
        document.body.setAttribute('aria-busy', 'true')
        try {
          if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = 0 }
          const result = await doSave()
          api.sessionsFlushed({ id, result: result?.ok === false ? result : { ok: true } })
        } catch (error) {
          api.sessionsFlushed({ id, result: { ok: false, error: error?.message || '保存失败，已取消导入' } })
        }
      })
      api.onSessionsRelease?.(({ id }) => {
        if (freezeId !== id) return
        freezeId = null
        document.body.inert = previousInert
        document.body.removeAttribute('aria-busy')
      })
      // document-level shortcuts still fire on an inert page; stop them before app handlers.
      for (const type of ['keydown', 'click', 'drop', 'submit']) document.addEventListener(type, (event) => {
        if (isFrozen()) { event.preventDefault(); event.stopImmediatePropagation() }
      }, true)
    }
    function bindAutoFlush() {
      window.addEventListener('pagehide', () => { if (!api.isStorageTest) flushNow() })
      document.addEventListener('visibilitychange', () => { if (!api.isStorageTest && document.visibilityState === 'hidden') flushNow() })
    }

    return { loadSessions, saveSessions, bindAutoFlush, bindFreeze, isFrozen, SESSIONS_KEY }
  }

  window.SessionsClient = { createSessionsPersistence, SESSIONS_KEY: 'sixworlds.sessions.v2' }
})()

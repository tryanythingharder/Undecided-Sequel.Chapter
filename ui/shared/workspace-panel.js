/* ======== 六面世界 · 工作区与 IF 线（菜单 / 切换 / 增删改名 / 专属内核 / IF 分歧）（双方案共享） ========
 * 双 UI 方案收敛（绞杀者迁移）第九刀（三）：workspace 集群（renderWsMenu /
 * openWsMenu / closeWsMenu / switchWorkspace / newWorkspace / renameWorkspace /
 * deleteWorkspace / wsKernelAction + branchFrom，共 196 行）。迁移前两侧 app.js
 * 逐字相同。可变绑定（workspaces / currentWsId / currentId / sessions / sbFilter /
 * busy）经 getter/setter 桥接；wsMenu / wsOutsideClose / wsEscClose 由注入方持有
 * （DOM 与一次性监听的生命周期归属 app.js）。
 * 测试保护：e2e-mock 双方案矩阵（工作区切换/新建/删除断言）+ test-sessions-persistence。
 * 挂载：<script src="../shared/workspace-panel.js"></script>（先于 app.js）
 */
(function () {
  'use strict'

  function createWorkspacePanel(ctx) {
    // 可变绑定桥接契约（C1 修复）：workspaces/sessions/currentWsId/currentId/busy 均为
    // getter 函数——调用取值、原地变更；此前被按值解构（迭代函数抛
    // "workspaces is not iterable"）且 curWs 等十余个标识符未从 ctx 解构（ReferenceError），
    // 工作区菜单/切换/新建/删除/IF 线全灭且 e2e 无断言静默漏过。
    const {
      $, api,
      workspaces: getWorkspaces,
      sessions: getSessions,
      currentWsId: getCurrentWsId, setCurrentWsId: setCurrentWsIdTo,
      currentId: getCurrentId, setCurrentId: setCurrentIdTo,
      setSbFilter: setSbFilterTo,
      busy: isBusy,
      sessionDrafts,
      curWs, wsSessions, saveWorkspaces, saveStore, saveSessions,
      renderWsBtn, renderSessionList, renderMessages, updateTitle,
      newSession, fitInput, loadKernel,
      confirmDialog, promptDialog, toast,
      curSession, cancelHideAnim, hideWithAnim,
      wsMenu, wsOutsideClose, wsEscClose,
    } = ctx

  function renderWsMenu() {
    const listEl = $('ws-menu-list')
    listEl.innerHTML = ''
    for (const w of getWorkspaces()) {
      const it = document.createElement('div')
      it.className = 'ws-menu-item' + (w.id === getCurrentWsId() ? ' current' : '')
      const cnt = getSessions().filter((s) => s.ws === w.id).length
      const name = document.createElement('span')
      name.textContent = w.name
      const meta = document.createElement('span')
      meta.className = 'ws-menu-meta'
      meta.textContent = (w.id === getCurrentWsId() ? '✓ ' : '') + cnt + ' 线' + ((w.kernelId || w.kernelPath) ? ' · 专属内核' : '')
      it.appendChild(name); it.appendChild(meta)
      it.addEventListener('click', () => { closeWsMenu(); if (w.id !== getCurrentWsId()) switchWorkspace(w.id) })
      listEl.appendChild(it)
    }
    // 专属内核操作项（有覆盖时显示清除）
    const kernelItem = $('ws-kernel')
    const ws = curWs()
    if (ws && (ws.kernelId || ws.kernelPath)) {
      kernelItem.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg> 清除专属内核（恢复全局）'
      kernelItem.dataset.mode = 'clear'
    } else {
      kernelItem.innerHTML = '<svg class="ic ic-sm" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/><path d="M8 4.5 11.5 8 8 11.5 4.5 8Z"/></svg> 设置专属内核…'
      kernelItem.dataset.mode = 'set'
    }
  }


  function openWsMenu() {
    renderWsMenu()
    cancelHideAnim(wsMenu)
    wsMenu.classList.remove('hidden')
    // 立即挂一次性关闭监听（下一拍生效，避免当次点击立刻关掉）
    setTimeout(() => {
      document.addEventListener('click', wsOutsideClose)
      document.addEventListener('keydown', wsEscClose)
    }, 0)
  }


  function closeWsMenu() {
    hideWithAnim(wsMenu, () => wsMenu.classList.add('hidden'))
    document.removeEventListener('click', wsOutsideClose)
    document.removeEventListener('keydown', wsEscClose)
  }


  async function switchWorkspace(id) {
    if (isBusy()) { toast('请等当前回合结束', 'info'); return }
    const target = getWorkspaces().find((w) => w.id === id)
    if (!target || id === getCurrentWsId()) return
    // 保存当前输入草稿与离开工作区的最近会话
    if (getCurrentId()) sessionDrafts.set(getCurrentId(), $('input').value)
    const oldWs = curWs()
    if (oldWs) oldWs.lastSessionId = getCurrentId()
    setCurrentWsIdTo(id)
    // 恢复目标工作区：优先上次会话 → 首条会话 → 新建
    const wsS = wsSessions()
    if (wsS.length) {
      setCurrentIdTo(wsS.some((s) => s.id === target.lastSessionId) ? target.lastSessionId : wsS[0].id)
    } else {
      setCurrentIdTo(null)
    }
    saveWorkspaces()
    saveStore()
    $('input').value = getCurrentId() ? (sessionDrafts.get(getCurrentId()) || '') : ''
    fitInput()
    setSbFilterTo('')
    $('sb-search').value = ''
    renderWsBtn()
    renderSessionList()
    renderMessages()
    updateTitle()
    await loadKernel() // 工作区专属内核
  }


  async function newWorkspace() {
    const name = await promptDialog({
      title: '新建工作区',
      body: '工作区之间完全隔离：各自拥有独立的世界线、搜索与画廊。适合存放不同的世界内核 / 不同的故事。',
      value: '新世界 ' + (getWorkspaces().length + 1),
      placeholder: '工作区名称',
      okText: '创建'
    })
    if (!name) return
    const w = { id: 'w' + Date.now().toString(36), name, createdAt: Date.now() }
    getWorkspaces().push(w)
    saveWorkspaces()
    await switchWorkspace(w.id)
    newSession() // 空工作区给一条新世界线
    toast('工作区「' + name + '」已创建', 'ok')
  }


  async function renameWorkspace() {
    const ws = curWs()
    if (!ws) return
    const name = await promptDialog({ title: '重命名工作区', value: ws.name, okText: '重命名' })
    if (!name || name === ws.name) return
    ws.name = name
    saveWorkspaces()
    renderWsBtn()
    toast('已重命名', 'ok')
  }


  async function deleteWorkspace() {
    const ws = curWs()
    if (!ws) return
    if (busy) { toast('世界运转中，回合结束后再删除', 'info', 1800); return } // R57：生成中禁止删除工作区（防流式写入已删会话）
    if (getWorkspaces().length <= 1) { toast('至少保留一个工作区', 'info'); return }
    const cnt = getSessions().filter((s) => s.ws === ws.id).length
    const ok = await confirmDialog({
      title: '删除工作区「' + ws.name + '」？',
      body: '该工作区的 ' + cnt + ' 条世界线及其全部对话、插图将被永久删除，无法恢复。其他工作区不受影响。',
      danger: true,
      okText: '删除工作区'
    })
    if (!ok) return
    // 原地变更（getter 桥接约束：重赋值会失联）
    const sessionArr = getSessions()
    for (let i = sessionArr.length - 1; i >= 0; i--) {
      if (sessionArr[i].ws === ws.id) sessionArr.splice(i, 1)
    }
    // 删除语义立即持久化（防抖窗口内崩溃不复活已删数据）
    const wsArr = getWorkspaces()
    for (let i = 0; i < wsArr.length; i++) {
      if (wsArr[i].id === ws.id) { wsArr.splice(i, 1); break }
    }
    // 删除后切到剩余第一个工作区
    setCurrentWsIdTo(getWorkspaces()[0].id)
    const wsS = wsSessions()
    setCurrentIdTo(wsS.length ? wsS[0].id : null)
    if (!getCurrentId()) newSession()
    saveSessions(true); saveWorkspaces(); saveStore()
    renderWsBtn()
    renderSessionList()
    renderMessages()
    updateTitle()
    await loadKernel()
    toast('工作区已删除', 'info')
  }


  async function wsKernelAction() {
    const ws = curWs()
    if (!ws) return
    const mode = $('ws-kernel').dataset.mode
    if (mode === 'clear') {
      ws.kernelId = ''
      ws.kernelPath = ''
      saveWorkspaces()
      await loadKernel()
      renderWsBtn()
      toast('已恢复全局内核', 'ok')
      return
    }
    const r = await api.pickKernel()
    if (r && r.ok && r.path) {
      ws.kernelPath = r.path
      saveWorkspaces()
      await loadKernel()
      renderWsBtn()
      toast('工作区专属内核已加载', 'ok')
    }
  }


  function branchFrom(idx) {
    const s = curSession()
    if (!s) return
    if (isBusy()) return // 生成中不可达（工具栏 !busy 才渲染，app.js:1217）；保留守卫仅作防御
    const act = String(s.messages[idx] ? s.messages[idx].content : '').slice(0, 30)
    confirmDialog({
      title: '开辟 IF 线？',
      body: '将以「' + s.title + '」为母线，在新世界线里复刻到这一步之前的历史，让你重新选择。你的原世界线保持不变。' + (act ? '（将撤销的行动：' + act + '…）' : ''),
      okText: '开辟 IF 线'
    }).then((ok) => {
      if (!ok) return
      localStorage.setItem('sixworlds.ifhint-seen.v1', '1') // 用过 IF → 一次性发现提示永不再现（R7）
      const now = Date.now()
      const ns = {
        id: 's' + now.toString(36),
        ws: s.ws, // IF 线留在母线的工作区（隔离）
        title: 'IF · ' + s.title,
        // 复刻到该行动之前（含呈现选项的那次世界回应，选项按钮会重新出现）
        messages: s.messages.slice(0, idx).map((m) => Object.assign({}, m)),
        updatedAt: now, createdAt: now,
        ifFrom: s.id
      }
      getSessions().unshift(ns) // 原地变更（getter 桥接约束）
      setCurrentIdTo(ns.id)
      saveStore()
      saveSessions()
      // IF 线状态继承（R85）：深拷贝母线引擎账本（实体/伏笔/事实/关系全量），否则 IF 线第一轮
      // 就是个「失忆世界」——模型靠历史消息记得剧情，状态引擎却谁都不认识。
      // 语义索引与快照计数不随克隆；母线尚无引擎故事（未发过言）时静默跳过
      api.engineCloneStory({ storyId: s.id, targetId: ns.id, title: ns.title }).then((r) => {
        if (r && r.ok) toast('IF 线已继承母线全部世界状态（实体/伏笔/事实）', 'ok', 2600)
      }).catch(() => {})
      renderSessionList()
      renderMessages()
      updateTitle()
      toast('IF 线已开辟：历史复刻完毕，重新选择吧', 'ok', 2600)
    })
  }


    return { renderWsMenu, openWsMenu, closeWsMenu, switchWorkspace, newWorkspace, renameWorkspace, deleteWorkspace, wsKernelAction, branchFrom }
  }

  window.WorkspacePanel = { createWorkspacePanel }
})()

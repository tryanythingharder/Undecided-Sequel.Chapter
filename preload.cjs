const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // R76：e2e 测试环境标记（SIXWORLDS_TEST=1 时渲染层跳过入场动画等仪式性延迟）
  isTest: !!process.env.SIXWORLDS_TEST,
  isStorageTest: !!process.env.SIXWORLDS_STORAGE_TEST,
  readKernel: () => ipcRenderer.invoke('kernel:read'),
  readKernelPath: (p) => ipcRenderer.invoke('kernel:readPath', p),
  pickKernel: () => ipcRenderer.invoke('kernel:pick'),
  kernelLibList: () => ipcRenderer.invoke('kernels:list'),
  kernelLibRead: (id) => ipcRenderer.invoke('kernels:read', id),
  kernelLibSave: (payload) => ipcRenderer.invoke('kernels:save', payload),
  kernelLibDelete: (id) => ipcRenderer.invoke('kernels:delete', id),
  // 离线作者工具：不可变版本、独立沙盒、结构测试与精选预览。
  authorVersions: (p) => ipcRenderer.invoke('author:versions', p),
  authorVersionRegister: (p) => ipcRenderer.invoke('author:version-register', p),
  authorVersionRead: (p) => ipcRenderer.invoke('author:version-read', p),
  authorDiff: (p) => ipcRenderer.invoke('author:diff', p),
  authorCurated: (p) => ipcRenderer.invoke('author:curated', p),
  authorPreview: (p) => ipcRenderer.invoke('author:preview', p),
  authorSandboxList: (p) => ipcRenderer.invoke('author:sandbox-list', p),
  authorSandboxOpen: (p) => ipcRenderer.invoke('author:sandbox-open', p),
  authorSandboxContext: (p) => ipcRenderer.invoke('author:sandbox-context', p),
  authorSandboxTurn: (p) => ipcRenderer.invoke('author:sandbox-turn', p),
  authorSandboxClose: (p) => ipcRenderer.invoke('author:sandbox-close', p),
  authorSuiteRun: (p) => ipcRenderer.invoke('author:suite-run', p),
  authorRecords: (p) => ipcRenderer.invoke('author:records', p),
  authorRecord: (p) => ipcRenderer.invoke('author:record', p),
  authorReplay: (p) => ipcRenderer.invoke('author:replay', p),
  // 主进程权威账本：不暴露整体快照写入，避免旧窗口覆盖新账。
  runtimeLedgerLoad: () => ipcRenderer.invoke('runtime:ledger-load'),
  runtimePriceSet: (p) => ipcRenderer.invoke('runtime:price-set', p),
  runtimePriceRemove: (p) => ipcRenderer.invoke('runtime:price-remove', p),
  runtimeDiagnosticsInfo: () => ipcRenderer.invoke('runtime:diagnostics-info'),
  runtimeDiagnosticsSave: (p) => ipcRenderer.invoke('runtime:diagnostics-save', p),
  onRuntimeLedgerChanged: (cb) => {
    const h = (_e, snapshot) => cb(snapshot)
    ipcRenderer.on('runtime:ledger-changed', h)
    return () => ipcRenderer.removeListener('runtime:ledger-changed', h)
  },
  // 体验诊断：只读统计与主进程白名单导出。
  experienceStorage: () => ipcRenderer.invoke('experience:storage'),
  experienceDiagnosticsInfo: (p) => ipcRenderer.invoke('experience:diagnostics-info', p),
  experienceReport: (p) => ipcRenderer.invoke('experience:report', p),
  experienceDiagnosticsSave: (p) => ipcRenderer.invoke('experience:diagnostics-save', p),
  experienceRecordError: (p) => ipcRenderer.invoke('experience:record-error', p),
  // 内核工作台只暴露离线能力与真实试玩状态，不暴露真实试玩执行入口。
  kernelWbCapabilities: () => ipcRenderer.invoke('kernel-wb:capabilities'),
  kernelWbPublish: (p) => ipcRenderer.invoke('kernel-wb:publish', p),
  kernelWbList: (p) => ipcRenderer.invoke('kernel-wb:list', p),
  kernelWbRead: (p) => ipcRenderer.invoke('kernel-wb:read', p),
  kernelWbDiff: (p) => ipcRenderer.invoke('kernel-wb:diff', p),
  kernelWbVerify: (p) => ipcRenderer.invoke('kernel-wb:verify', p),
  kernelWbCases: () => ipcRenderer.invoke('kernel-wb:cases'),
  kernelWbRun: (p) => ipcRenderer.invoke('kernel-wb:run', p),
  kernelWbRecords: (p) => ipcRenderer.invoke('kernel-wb:records', p),
  kernelWbRealStatus: () => ipcRenderer.invoke('kernel-wb:real-status'),
  loadSecrets: () => ipcRenderer.invoke('secrets:load'),
  saveSecrets: (value) => ipcRenderer.invoke('secrets:save', value),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSessions: (sessions, context) => ipcRenderer.invoke('sessions:save', sessions, context),
  archiveList: () => ipcRenderer.invoke('archives:list'),
  archiveCreate: (payload) => ipcRenderer.invoke('archives:create', payload),
  archiveRestore: (payload) => ipcRenderer.invoke('archives:restore', payload),
  archiveExport: (payload) => ipcRenderer.invoke('archives:export', payload),
  archiveImport: (payload) => ipcRenderer.invoke('archives:import', payload),
  archiveDelete: (payload) => ipcRenderer.invoke('archives:delete', payload),
  clearSessions: () => ipcRenderer.invoke('sessions:clear'),
  sendChat: (cfg) => ipcRenderer.invoke('chat:send', cfg),
  abortChat: (reqId) => ipcRenderer.invoke('chat:abort', reqId),
  // 故事状态引擎（结构化状态 + 长期记忆 + 检索）
  engineEnsure: (p) => ipcRenderer.invoke('engine:ensure', p),
  engineContext: (p) => ipcRenderer.invoke('engine:context', p),
  engineCommit: (p) => ipcRenderer.invoke('engine:commit', p),
  engineOverview: (p) => ipcRenderer.invoke('engine:overview', p),
  engineMemory: (p) => ipcRenderer.invoke('engine:memory', p),
  engineCorrectMemory: (p) => ipcRenderer.invoke('engine:correctMemory', p),
  engineSnapshot: (p) => ipcRenderer.invoke('engine:snapshot', p),
  engineSnapshots: (p) => ipcRenderer.invoke('engine:snapshots', p),
  engineRestore: (p) => ipcRenderer.invoke('engine:restore', p),
  engineLogs: (p) => ipcRenderer.invoke('engine:logs', p),
  engineLog: (p) => ipcRenderer.invoke('engine:log', p),
  engineProtocol: () => ipcRenderer.invoke('engine:protocol'),
  engineDeleteStory: (p) => ipcRenderer.invoke('engine:deleteStory', p),
  engineCloneStory: (p) => ipcRenderer.invoke('engine:cloneStory', p),
  engineDiscard: (p) => ipcRenderer.invoke('engine:discardTurn', p),
  enginePendings: (p) => ipcRenderer.invoke('engine:pendings', p),
  engineResolvePending: (p) => ipcRenderer.invoke('engine:resolvePending', p),
  engineDiscardPending: (p) => ipcRenderer.invoke('engine:discardPending', p),
  engineComicSource: (p) => ipcRenderer.invoke('engine:comicSource', p),
  engineCardSource: (p) => ipcRenderer.invoke('engine:cardSource', p),
  generateImage: (cfg) => ipcRenderer.invoke('image:generate', cfg),
  readImageDataUrl: (source) => ipcRenderer.invoke('image:readDataUrl', source),
  saveImage: (opts) => ipcRenderer.invoke('image:save', opts),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  testEndpoint: (opts) => ipcRenderer.invoke('net:test', opts),
  saveAllImages: async (opts) => {
    const items = Array.isArray(opts && opts.items) ? opts.items : []
    if (!items.length) return { ok: false, error: '没有可保存的插图' }
    const started = await ipcRenderer.invoke('image:saveAllBegin', { nameBase: opts && opts.nameBase, __testDirectory: opts && opts.__testDirectory })
    if (!started || !started.ok) return started || { ok: false, error: '无法开始批量保存' }
    let saved = 0
    const failed = []
    let outputPath = ''
    try {
      for (let offset = 0; offset < items.length; offset += 100) {
        const result = await ipcRenderer.invoke('image:saveAllChunk', { token: started.token, items: items.slice(offset, offset + 100) })
        if (!result || !result.ok) {
          failed.push((result && result.error) || '批量保存中断')
          break
        }
        saved += result.saved || 0
        outputPath = result.path || outputPath
        failed.push(...(Array.isArray(result.failed) ? result.failed : []))
      }
    } finally {
      await ipcRenderer.invoke('image:saveAllFinish', started.token).catch(() => {})
    }
    return { ok: saved > 0, path: outputPath, saved, failed }
  },
  pin: (pinned) => ipcRenderer.invoke('window:pin', pinned),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximize-toggle'),
  close: () => ipcRenderer.invoke('window:close'),
  notify: (opts) => ipcRenderer.invoke('notify', opts),
  sendBusy: (v) => ipcRenderer.send('chat:busy', v),
  setTheme: (src) => ipcRenderer.invoke('theme:set', src),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  settingsChanged: (payload) => ipcRenderer.invoke('settings:changed', payload),
  // 界面方案（经典 / 原型工作台）：读取当前方案；切换后主进程会把窗口重载到对应入口
  uiScheme: () => ipcRenderer.invoke('ui-scheme:get'),
  setUiScheme: (scheme) => ipcRenderer.invoke('ui-scheme:set', scheme),
  // 诊断：语义索引（sqlite-vec）状态
  vectorStats: () => ipcRenderer.invoke('vector:stats'),
  // 真实嵌入模型配置（api-v1，OpenAI 兼容 /v1/embeddings）：引擎重启后生效
  embedderConfig: () => ipcRenderer.invoke('embedder:get'),
  saveEmbedderConfig: (cfg) => ipcRenderer.invoke('embedder:set', cfg),
  // 软件更新（仅 NSIS 安装版；测试/开发环境返回 unavailable）
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  // 主窗口 -> 设置窗口：运行时改动（模型/思考程度/主题等）实时同步给已打开的设置窗口
  mainChanged: (payload) => ipcRenderer.invoke('main:changed', payload),
  onCfgSync: (cb) => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('cfg:sync', h)
    return () => ipcRenderer.removeListener('cfg:sync', h)
  },
  onCfgUpdated: (cb) => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('cfg:updated', h)
    return () => ipcRenderer.removeListener('cfg:updated', h)
  },
  onSessionsFlush: (cb) => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('sessions:flush', h)
    return () => ipcRenderer.removeListener('sessions:flush', h)
  },
  onSessionsRelease: (cb) => {
    const h = (_e, data) => cb(data)
    ipcRenderer.on('sessions:release', h)
    return () => ipcRenderer.removeListener('sessions:release', h)
  },
  sessionsFlushed: (payload) => ipcRenderer.send('sessions:flushed', payload),
  onMaximized: (cb) => {
    ipcRenderer.on('window:maximized', (_e, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('window:maximized')
  },
  onChatDelta: (cb) => {
    const h = (_e, piece) => cb(piece)
    ipcRenderer.on('chat:delta', h)
    return () => ipcRenderer.removeListener('chat:delta', h)
  },
  // 移动端进度包导出（渲染层收集 localStorage，主进程读引擎文件落盘）
  exportProgress: (payload) => ipcRenderer.invoke('progress:export', payload),
  // 进度包导入（移动端导出的包 → 桌面接续）：主进程校验并写引擎文件，会话数据由渲染层合并
  importProgress: (options) => ipcRenderer.invoke('progress:import', options),
  // 桌宠本地小模型（世界之灵的离线大脑）：状态/一键下载/取消 + 流式对话
  petModelStatus: () => ipcRenderer.invoke('pet:model-status'),
  petModelDownload: () => ipcRenderer.invoke('pet:model-download'),
  petModelDownloadCancel: () => ipcRenderer.invoke('pet:model-download-cancel'),
  petChat: (p) => ipcRenderer.invoke('pet:chat', p),
  // 桌宠智能体：结构化决策（推荐选项 / 托管代选 / 插图时机 / 生图提示词优化）
  petAgent: (p) => ipcRenderer.invoke('pet:agent', p),
  // 角色闪卡（Holo Card）：卡目录落盘（渲染层 canvas 抠图/排版后提交）/ 读取 / 删除 / 打开查看器窗口
  cardWrite: (p) => ipcRenderer.invoke('card:write', p),
  cardRead: (p) => ipcRenderer.invoke('card:read', p),
  cardDelete: (p) => ipcRenderer.invoke('card:delete', p),
  cardWindow: (p) => ipcRenderer.invoke('card:window', p),
  onPetModelProgress: (cb) => {
    ipcRenderer.on('pet:model-progress', (_e, d) => cb(d))
    return () => ipcRenderer.removeAllListeners('pet:model-progress')
  },
  onPetChatDelta: (cb) => {
    ipcRenderer.on('pet:chat-delta', (_e, piece) => cb(piece))
    return () => ipcRenderer.removeAllListeners('pet:chat-delta')
  },
})

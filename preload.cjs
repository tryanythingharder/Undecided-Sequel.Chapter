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
  loadSecrets: () => ipcRenderer.invoke('secrets:load'),
  saveSecrets: (value) => ipcRenderer.invoke('secrets:save', value),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSessions: (sessions) => ipcRenderer.invoke('sessions:save', sessions),
  clearSessions: () => ipcRenderer.invoke('sessions:clear'),
  sendChat: (cfg) => ipcRenderer.invoke('chat:send', cfg),
  abortChat: (reqId) => ipcRenderer.invoke('chat:abort', reqId),
  // 故事状态引擎（结构化状态 + 长期记忆 + 检索）
  engineEnsure: (p) => ipcRenderer.invoke('engine:ensure', p),
  engineContext: (p) => ipcRenderer.invoke('engine:context', p),
  engineCommit: (p) => ipcRenderer.invoke('engine:commit', p),
  engineOverview: (p) => ipcRenderer.invoke('engine:overview', p),
  engineSnapshot: (p) => ipcRenderer.invoke('engine:snapshot', p),
  engineSnapshots: (p) => ipcRenderer.invoke('engine:snapshots', p),
  engineRestore: (p) => ipcRenderer.invoke('engine:restore', p),
  engineLogs: (p) => ipcRenderer.invoke('engine:logs', p),
  engineLog: (p) => ipcRenderer.invoke('engine:log', p),
  engineProtocol: () => ipcRenderer.invoke('engine:protocol'),
  engineDiscard: (p) => ipcRenderer.invoke('engine:discardTurn', p),
  enginePendings: (p) => ipcRenderer.invoke('engine:pendings', p),
  engineResolvePending: (p) => ipcRenderer.invoke('engine:resolvePending', p),
  engineDiscardPending: (p) => ipcRenderer.invoke('engine:discardPending', p),
  generateImage: (cfg) => ipcRenderer.invoke('image:generate', cfg),
  readImageDataUrl: (source) => ipcRenderer.invoke('image:readDataUrl', source),
  saveImage: (opts) => ipcRenderer.invoke('image:save', opts),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  openFile: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  testEndpoint: (opts) => ipcRenderer.invoke('net:test', opts),
  saveAllImages: (opts) => ipcRenderer.invoke('image:saveAll', opts),
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
  importProgress: () => ipcRenderer.invoke('progress:import'),
})

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // R76：e2e 测试环境标记（SIXWORLDS_TEST=1 时渲染层跳过入场动画等仪式性延迟）
  isTest: !!process.env.SIXWORLDS_TEST,
  readKernel: () => ipcRenderer.invoke('kernel:read'),
  readKernelPath: (p) => ipcRenderer.invoke('kernel:readPath', p),
  pickKernel: () => ipcRenderer.invoke('kernel:pick'),
  sendChat: (cfg) => ipcRenderer.invoke('chat:send', cfg),
  abortChat: (reqId) => ipcRenderer.invoke('chat:abort', reqId),
  generateImage: (cfg) => ipcRenderer.invoke('image:generate', cfg),
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
  }
})

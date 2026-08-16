'use strict'

// 沙箱化 preload：仅暴露最小化、类型化的 API 给状态页。

const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('dshDesktop', {
  getState: () => ipcRenderer.invoke('dsh:get-state'),
  getLogTail: () => ipcRenderer.invoke('dsh:get-log-tail'),
  restart: () => ipcRenderer.invoke('dsh:restart'),
  quit: () => ipcRenderer.invoke('dsh:quit'),
  openLog: () => ipcRenderer.invoke('dsh:open-log'),
  openData: () => ipcRenderer.invoke('dsh:open-data'),
  openPresets: () => ipcRenderer.invoke('dsh:open-presets'),
  exportPresets: () => ipcRenderer.invoke('dsh:export-presets'),
  importPresets: () => ipcRenderer.invoke('dsh:import-presets'),
  openExternal: (url) => ipcRenderer.invoke('dsh:open-external', url),
  getUpdateState: () => ipcRenderer.invoke('dsh:update-state'),
  checkUpdate: () => ipcRenderer.invoke('dsh:check-update'),
  installUpdate: () => ipcRenderer.invoke('dsh:install-update'),
  onUpdate: (callback) => subscribe('dsh:update', callback),
  onPresetsMessage: (callback) => subscribe('dsh:presets-message', callback),
  onState: (callback) => subscribe('dsh:state', callback),
  onLog: (callback) => subscribe('dsh:log', callback)
})

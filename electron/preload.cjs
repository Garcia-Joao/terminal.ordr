const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ordrTerminal', {
  isElectron: true,

  getDeviceInfo: () => ipcRenderer.invoke('terminal:device-info'),

  getAppInfo: () => ipcRenderer.invoke('terminal:app-info'),

  openExternal: (url) => ipcRenderer.invoke('terminal:open-external', url),

  getPrinters: () => ipcRenderer.invoke('printers:list'),

  apiFetch: (payload) => ipcRenderer.invoke('terminal:api-fetch', payload),

  printText: (payload) => ipcRenderer.invoke('printers:print-text', payload),

  printRawText: (payload) => ipcRenderer.invoke('printers:print-raw-text', payload),

  shutdown: () => ipcRenderer.invoke('terminal:shutdown'),

  saveSession: (payload) => ipcRenderer.invoke('terminal:save-session', payload),

  loadSession: () => ipcRenderer.invoke('terminal:load-session'),

  clearSession: () => ipcRenderer.invoke('terminal:clear-session'),

  getDeviceId: (companyId) => ipcRenderer.invoke('terminal:get-device-id', companyId),

  setDeviceId: (payload) => ipcRenderer.invoke('terminal:set-device-id', payload),

  clearDeviceId: (companyId) => ipcRenderer.invoke('terminal:clear-device-id', companyId),

  setSessionActive: (active) => ipcRenderer.invoke('terminal:set-session-active', active),

  onLaunchToken: (callback) => {
    const listener = (_event, launchToken) => callback(launchToken)
    ipcRenderer.on('terminal:launch-token', listener)

    return () => {
      ipcRenderer.removeListener('terminal:launch-token', listener)
    }
  },
})

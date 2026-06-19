import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config: Partial<{ dataDir: string; serverPort: number }>) =>
    ipcRenderer.invoke('config:set', config),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('dialog:showSaveDialog', options),
  showErrorBox: (title: string, content: string) =>
    ipcRenderer.invoke('dialog:showErrorBox', title, content),
  showMessageBox: (options: { type?: 'info' | 'warning' | 'error' | 'question'; title?: string; message: string; buttons?: string[] }) =>
    ipcRenderer.invoke('dialog:showMessageBox', options),
  checkPortAvailable: (port: number) => ipcRenderer.invoke('system:checkPort', port),
  checkDirectoryWritable: (dirPath: string) => ipcRenderer.invoke('system:checkDirWritable', dirPath),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  getBackendStatus: () => ipcRenderer.invoke('backend:status'),
  onBackendError: (callback: (error: { code: string; message: string; detail?: string }) => void) => {
    const listener = (_event: any, error: any) => callback(error)
    ipcRenderer.on('backend:error', listener)
    return () => ipcRenderer.removeListener('backend:error', listener)
  },
  onBackendReady: (callback: (info: { port: number; dataDir: string }) => void) => {
    const listener = (_event: any, info: any) => callback(info)
    ipcRenderer.on('backend:ready', listener)
    return () => ipcRenderer.removeListener('backend:ready', listener)
  },
  openDirectory: (dirPath: string) => ipcRenderer.invoke('shell:openDirectory', dirPath),
  pathJoin: (...parts: string[]) => ipcRenderer.invoke('path:join', parts),
  pathBasename: (p: string) => ipcRenderer.invoke('path:basename', p),
  getDefaultDataDir: () => ipcRenderer.invoke('config:getDefaultDataDir'),
})

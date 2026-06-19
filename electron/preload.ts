import { contextBridge, ipcRenderer } from 'electron'

declare global {
  interface Window {
    electronAPI?: {
      getConfig: () => Promise<any>
      setConfig: (config: Partial<{ dataDir: string; serverPort: number }>) => Promise<{
        success: boolean
        config?: any
        error?: string
        errorCode?: string
        libraryState?: { exists: boolean; isEmpty: boolean; hasValidSchema: boolean; dbPath: string; dbSize?: number; dbModified?: string }
        needWizard?: boolean
        wizardTrigger?: string
        wizardReason?: string
        wizardComplete?: boolean
      }>
      selectDirectory: () => Promise<any>
      showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<any>
      showErrorBox: (title: string, content: string) => Promise<void>
      showMessageBox: (options: { type?: 'info' | 'warning' | 'error' | 'question'; title?: string; message: string; buttons?: string[] }) => Promise<any>
      checkPortAvailable: (port: number) => Promise<boolean>
      checkDirectoryWritable: (dirPath: string) => Promise<any>
      restartBackend: () => Promise<any>
      getBackendStatus: () => Promise<any>
      onBackendError: (callback: (error: { code: string; message: string; detail?: string }) => void) => () => void
      onBackendReady: (callback: (info: { port: number; dataDir: string }) => void) => () => void
      openDirectory: (dirPath: string) => Promise<any>
      pathJoin: (...parts: string[]) => Promise<string>
      pathBasename: (p: string) => Promise<string>
      getDefaultDataDir: () => Promise<string>
      setRecentSession: (sessionId: number | null) => void
      wizardCheckNeed: () => Promise<any>
      wizardStart: (trigger: string) => Promise<any>
      wizardGetState: () => Promise<any>
      wizardGoToStep: (step: string) => Promise<any>
      wizardRunEnvCheck: () => Promise<any>
      wizardSetDataDir: (dir: string) => Promise<any>
      wizardCheckDataDir: (dir: string) => Promise<any>
      wizardHandleData: (action: 'migrate' | 'init-new' | 'use-existing', sourceDbPath?: string) => Promise<any>
      wizardSetRestoreSession: (sessionId: number | null) => Promise<any>
      wizardDetectOldDb: () => Promise<string | null>
      wizardComplete: () => Promise<any>
      wizardCancel: () => Promise<any>
      libraryDetectState: (dir?: string) => Promise<any>
      wizardMarkComplete: (dir?: string) => Promise<any>
      workspaceSwitchAndInit: (newDir: string, dataAction: 'init-new' | 'use-existing' | 'migrate', sourceDbPath?: string) => Promise<any>
    }
  }
}

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
  setRecentSession: (sessionId: number | null) => ipcRenderer.send('recent-session:set', sessionId),
  wizardCheckNeed: () => ipcRenderer.invoke('wizard:checkNeed'),
  wizardStart: (trigger: string) => ipcRenderer.invoke('wizard:start', trigger),
  wizardGetState: () => ipcRenderer.invoke('wizard:getState'),
  wizardGoToStep: (step: string) => ipcRenderer.invoke('wizard:goToStep', step),
  wizardRunEnvCheck: () => ipcRenderer.invoke('wizard:runEnvCheck'),
  wizardSetDataDir: (dir: string) => ipcRenderer.invoke('wizard:setDataDir', dir),
  wizardCheckDataDir: (dir: string) => ipcRenderer.invoke('wizard:checkDataDir', dir),
  wizardHandleData: (action: 'migrate' | 'init-new' | 'use-existing', sourceDbPath?: string) =>
    ipcRenderer.invoke('wizard:handleData', action, sourceDbPath),
  wizardSetRestoreSession: (sessionId: number | null) => ipcRenderer.invoke('wizard:setRestoreSession', sessionId),
  wizardDetectOldDb: () => ipcRenderer.invoke('wizard:detectOldDb'),
  wizardComplete: () => ipcRenderer.invoke('wizard:complete'),
  wizardCancel: () => ipcRenderer.invoke('wizard:cancel'),
  libraryDetectState: (dir?: string) => ipcRenderer.invoke('library:detectState', dir),
  wizardMarkComplete: (dir?: string) => ipcRenderer.invoke('wizard:markComplete', dir),
  workspaceSwitchAndInit: (newDir: string, dataAction: 'init-new' | 'use-existing' | 'migrate', sourceDbPath?: string) =>
    ipcRenderer.invoke('workspace:switchAndInit', newDir, dataAction, sourceDbPath),
})

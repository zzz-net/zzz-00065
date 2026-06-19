declare global {
  interface Window {
    electronAPI?: {
      getConfig: () => Promise<{
        dataDir: string
        serverPort: number
        recentSessionId: number | null
        windowBounds: any
      }>
      setConfig: (config: Partial<{ dataDir: string; serverPort: number; recentSessionId: number | null; windowBounds: any }>) => Promise<{
        success: boolean
        config?: any
        error?: string
      }>
      selectDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>
      showSaveDialog: (options: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      }) => Promise<{ canceled: boolean; filePath?: string }>
      showErrorBox: (title: string, content: string) => Promise<void>
      showMessageBox: (options: {
        type?: 'info' | 'warning' | 'error' | 'question'
        title?: string
        message: string
        buttons?: string[]
      }) => Promise<{ response: number }>
      checkPortAvailable: (port: number) => Promise<boolean>
      checkDirectoryWritable: (dirPath: string) => Promise<{ ok: boolean; error?: string }>
      restartBackend: () => Promise<{ success: boolean; error?: any }>
      getBackendStatus: () => Promise<{
        ready: boolean
        port: number
        dataDir: string
        error: { code: string; message: string; detail?: string } | null
        recentSessionId: number | null
      }>
      onBackendError: (callback: (error: { code: string; message: string; detail?: string }) => void) => () => void
      onBackendReady: (callback: (info: { port: number; dataDir: string }) => void) => () => void
      openDirectory: (dirPath: string) => Promise<string>
      pathJoin: (...parts: string[]) => Promise<string>
      pathBasename: (p: string) => Promise<string>
      getDefaultDataDir: () => Promise<string>
    }
  }
}

export {}

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  type SaveDialogOptions,
  type MessageBoxOptions,
} from 'electron'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

interface AppConfig {
  dataDir: string
  serverPort: number
  recentSessionId: number | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
    maximized?: boolean
  } | null
}

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcessWithoutNullStreams | null = null
let config: AppConfig
let backendReady = false
let backendError: { code: string; message: string; detail?: string } | null = null

const CONFIG_FILENAME = 'app-config.json'

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME)
}

function getDefaultDataDir(): string {
  return app.getPath('userData')
}

function defaultConfig(): AppConfig {
  return {
    dataDir: getDefaultDataDir(),
    serverPort: 3001,
    recentSessionId: null,
    windowBounds: null,
  }
}

function loadConfig(): AppConfig {
  const cfgPath = getConfigPath()
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...defaultConfig(), ...parsed }
    }
  } catch (e) {
    console.warn('Failed to load config, using defaults:', e)
  }
  return defaultConfig()
}

function saveConfig() {
  try {
    const cfgPath = getConfigPath()
    const userDataDir = path.dirname(cfgPath)
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true })
    }
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

function ensureDataDir(dir: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const testFile = path.join(dir, `.write-test-${Date.now()}.tmp`)
    fs.writeFileSync(testFile, 'test', 'utf-8')
    fs.unlinkSync(testFile)
    return { ok: true }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || '未知错误',
    }
  }
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let p = startPort; p < startPort + 50; p++) {
    if (await checkPortAvailable(p)) return p
  }
  return 0
}

function createWindow() {
  const bounds = config.windowBounds
  const win = new BrowserWindow({
    width: bounds?.width || 1200,
    height: bounds?.height || 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    title: '培训考场管理系统',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  if (bounds?.maximized) {
    win.maximize()
  }

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('close', () => {
    const b = win.getBounds()
    config.windowBounds = {
      width: b.width,
      height: b.height,
      x: b.x,
      y: b.y,
      maximized: win.isMaximized(),
    }
    saveConfig()
  })

  const serverUrl = `http://localhost:${config.serverPort}`
  const tryLoad = (attempts = 0) => {
    if (!mainWindow) return
    if (backendError) {
      loadErrorPage()
      return
    }
    mainWindow.loadURL(serverUrl).catch(() => {
      if (attempts < 120) {
        setTimeout(() => tryLoad(attempts + 1), 300)
      } else {
        loadErrorPage()
      }
    })
  }

  if (backendReady) {
    tryLoad()
  } else if (backendError) {
    loadErrorPage()
  }

  mainWindow = win
}

function loadErrorPage() {
  if (!mainWindow) return
  const htmlPath = path.join(__dirname, '..', 'dist', 'index.html')
  if (fs.existsSync(htmlPath)) {
    mainWindow.loadURL(`file://${htmlPath}?startup_error=1`)
  } else {
    mainWindow.loadFile(htmlPath).catch(() => {})
  }
}

function startServer(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    backendReady = false
    backendError = null

    const dataDirCheck = ensureDataDir(config.dataDir)
    if (!dataDirCheck.ok) {
      backendError = {
        code: 'DATA_DIR_NOT_WRITABLE',
        message: `数据目录不可写：${config.dataDir}`,
        detail: `请检查目录权限或更换数据目录。错误原因：${dataDirCheck.error}`,
      }
      mainWindow?.webContents.send('backend:error', backendError)
      reject(backendError)
      return
    }

    const portAvailable = await checkPortAvailable(config.serverPort)
    if (!portAvailable) {
      const newPort = await findAvailablePort(config.serverPort + 1)
      if (newPort === 0) {
        backendError = {
          code: 'PORT_NOT_AVAILABLE',
          message: `端口 ${config.serverPort} 已被占用，且未找到可用端口`,
          detail: `请在配置中修改端口，或关闭占用 ${config.serverPort} 的程序后重试。`,
        }
        mainWindow?.webContents.send('backend:error', backendError)
        reject(backendError)
        return
      }
      config.serverPort = newPort
      saveConfig()
    }

    let serverEntry: string
    let nodeArgs: string[]
    let envExtra: Record<string, string> = {}

    if (fs.existsSync(path.join(__dirname, '..', 'api', 'server.ts'))) {
      const tsxPath = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx')
      serverEntry = path.join(__dirname, '..', 'api', 'server.ts')
      nodeArgs = [serverEntry]
      if (process.platform === 'win32') {
        serverEntry = tsxPath + '.cmd'
        nodeArgs = [path.join(__dirname, '..', 'api', 'server.ts')]
      } else {
        serverEntry = tsxPath
        nodeArgs = [path.join(__dirname, '..', 'api', 'server.ts')]
      }
    } else {
      serverEntry = process.execPath
      nodeArgs = [path.join(__dirname, 'api', 'server.js')]
      envExtra = {
        ELECTRON_RUN_AS_NODE: '1',
      }
    }

    try {
      serverProcess = spawn(serverEntry, nodeArgs, {
        env: {
          ...process.env,
          ...envExtra,
          PORT: String(config.serverPort),
          DB_DIR: config.dataDir,
          ELECTRON_RUN: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (e: any) {
      backendError = {
        code: 'DEPENDENCY_MISSING',
        message: '无法启动后端服务',
        detail: e?.message || '请确认依赖已正确安装（npm install）。',
      }
      mainWindow?.webContents.send('backend:error', backendError)
      reject(backendError)
      return
    }

    let stdoutBuffer = ''
    let resolved = false

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      console.log('[server]', text)
      stdoutBuffer += text + '\n'
      if (!resolved && text.includes(`Server ready`) || text.includes(`port ${config.serverPort}`) || text.includes(`localhost:${config.serverPort}`)) {
        resolved = true
        backendReady = true
        mainWindow?.webContents.send('backend:ready', {
          port: config.serverPort,
          dataDir: config.dataDir,
        })
        resolve()
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      console.error('[server-err]', text)
      stdoutBuffer += text + '\n'
      if (!resolved && (text.toLowerCase().includes('error') || text.toLowerCase().includes('eaddrinuse'))) {
        if (text.toLowerCase().includes('eaddrinuse') || text.toLowerCase().includes('port')) {
          backendError = {
            code: 'PORT_NOT_AVAILABLE',
            message: `端口 ${config.serverPort} 已被占用`,
            detail: text,
          }
        } else if (text.toLowerCase().includes('cannot find module') || text.toLowerCase().includes('module_not_found')) {
          backendError = {
            code: 'DEPENDENCY_MISSING',
            message: '依赖缺失或模块未找到',
            detail: text,
          }
        } else {
          backendError = {
            code: 'SERVER_UNKNOWN_ERROR',
            message: '后端服务启动失败',
            detail: text,
          }
        }
        mainWindow?.webContents.send('backend:error', backendError)
        reject(backendError)
      }
    })

    serverProcess.on('error', (err) => {
      console.error('Server spawn error:', err)
      if (!resolved) {
        backendError = {
          code: 'DEPENDENCY_MISSING',
          message: '无法启动后端服务进程',
          detail: err?.message || '请确认 Node.js 及依赖已正确安装。',
        }
        mainWindow?.webContents.send('backend:error', backendError)
        reject(backendError)
      }
    })

    serverProcess.on('exit', (code) => {
      console.log('Server process exited with code:', code)
      if (!resolved && !backendError) {
        backendError = {
          code: 'SERVER_EXITED',
          message: `后端进程意外退出（退出码: ${code ?? 'unknown'}）`,
          detail: stdoutBuffer.slice(0, 2000),
        }
        mainWindow?.webContents.send('backend:error', backendError)
        reject(backendError)
      }
    })

    setTimeout(() => {
      if (!resolved && !backendError) {
        backendError = {
          code: 'SERVER_TIMEOUT',
          message: '后端服务启动超时',
          detail: '超过 30 秒仍未检测到服务就绪，请查看日志输出。',
        }
        mainWindow?.webContents.send('backend:error', backendError)
        reject(backendError)
      }
    }, 30000)
  })
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
  backendReady = false
}

function registerIpcHandlers() {
  ipcMain.handle('config:get', () => config)

  ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>) => {
    if (patch.dataDir != null && patch.dataDir !== config.dataDir) {
      const check = ensureDataDir(patch.dataDir)
      if (!check.ok) {
        return {
          success: false,
          error: `数据目录不可用：${check.error}`,
        }
      }
    }
    if (patch.serverPort != null && patch.serverPort !== config.serverPort) {
      const ok = await checkPortAvailable(patch.serverPort)
      if (!ok) {
        return {
          success: false,
          error: `端口 ${patch.serverPort} 已被占用`,
        }
      }
    }
    config = { ...config, ...patch }
    saveConfig()
    return { success: true, config }
  })

  ipcMain.handle('config:getDefaultDataDir', () => getDefaultDataDir())

  ipcMain.handle('dialog:selectDirectory', async () => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择数据目录',
    })
    return res
  })

  ipcMain.handle('dialog:showSaveDialog', async (_e, options: SaveDialogOptions) => {
    if (!mainWindow) return { canceled: true, filePath: undefined }
    return await dialog.showSaveDialog(mainWindow, options)
  })

  ipcMain.handle('dialog:showErrorBox', (_e, title: string, content: string) => {
    dialog.showErrorBox(title, content)
  })

  ipcMain.handle('dialog:showMessageBox', async (_e, options: MessageBoxOptions) => {
    if (!mainWindow) return { response: 0 }
    return await dialog.showMessageBox(mainWindow, options)
  })

  ipcMain.handle('system:checkPort', async (_e, port: number) => {
    return await checkPortAvailable(port)
  })

  ipcMain.handle('system:checkDirWritable', (_e, dirPath: string) => {
    return ensureDataDir(dirPath)
  })

  ipcMain.handle('backend:restart', async () => {
    stopServer()
    backendError = null
    try {
      await startServer()
      if (mainWindow) {
        const serverUrl = `http://localhost:${config.serverPort}`
        mainWindow.loadURL(serverUrl).catch(() => {})
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err }
    }
  })

  ipcMain.handle('backend:status', () => {
    return {
      ready: backendReady,
      port: config.serverPort,
      dataDir: config.dataDir,
      error: backendError,
      recentSessionId: config.recentSessionId,
    }
  })

  ipcMain.handle('shell:openDirectory', (_e, dirPath: string) => {
    return shell.openPath(dirPath)
  })

  ipcMain.handle('path:join', (_e, parts: string[]) => {
    return path.join(...parts)
  })

  ipcMain.handle('path:basename', (_e, p: string) => {
    return path.basename(p)
  })

  ipcMain.on('recent-session:set', (_e, sessionId: number | null) => {
    config.recentSessionId = sessionId
    saveConfig()
  })
}

app.whenReady().then(async () => {
  config = loadConfig()
  registerIpcHandlers()

  startServer().catch((err) => {
    console.error('Initial server start failed:', err)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopServer()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopServer()
})

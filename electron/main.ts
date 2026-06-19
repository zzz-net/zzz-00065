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
import * as wizard from './wizard.js'
import * as ws from './workspace.js'

interface AppConfig {
  dataDir: string
  serverPort: number
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
    maximized?: boolean
  } | null
}

const CONFIG_FILENAME = 'app-config.json'
const APP_NAME = 'exam-session-manager'

{
  if (!app.isPackaged) {
    const fb = path.join(process.cwd(), '.electron-runtime', 'userdata')
    try { fs.mkdirSync(fb, { recursive: true }) } catch (_e) {}
    try { app.setPath('userData', fb) } catch (_e) {}
  }
}

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcessWithoutNullStreams | null = null
let config: AppConfig
let backendReady = false
let backendError: { code: string; message: string; detail?: string } | null = null

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
    ws.writeLog(getDefaultDataDir(), 'app', 'warn', '加载配置失败，使用默认值', e instanceof Error ? e.message : String(e))
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
    const tmp = cfgPath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
    fs.renameSync(tmp, cfgPath)
  } catch (e) {
    ws.writeLog(getDefaultDataDir(), 'app', 'error', '保存配置失败', e instanceof Error ? e.message : String(e))
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
    server.listen(port)
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

  const wizardState = wizard.getWizardState()
  if (wizardState.active) {
    loadWizardPage()
  } else if (backendReady) {
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
    mainWindow.loadURL(`file:///${htmlPath.replace(/\\/g, '/')}?startup_error=1`)
  } else {
    mainWindow.loadFile(htmlPath).catch(() => {})
  }
}

function loadWizardPage() {
  if (!mainWindow) return
  const htmlPath = path.join(__dirname, '..', 'dist', 'index.html')
  if (fs.existsSync(htmlPath)) {
    mainWindow.loadURL(`file:///${htmlPath.replace(/\\/g, '/')}?wizard=1`)
  } else {
    mainWindow.loadFile(htmlPath).catch(() => {})
  }
}

function resolveServerEntry(): { entry: string; args: string[]; env: NodeJS.ProcessEnv } {
  const compiledApi = path.join(__dirname, 'api', 'server.js')
  if (fs.existsSync(compiledApi)) {
    return {
      entry: process.execPath,
      args: [compiledApi],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }
  }

  const sourceApi = path.join(__dirname, '..', 'api', 'server.ts')
  const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
  if (fs.existsSync(sourceApi) && fs.existsSync(tsxBin)) {
    return {
      entry: tsxBin,
      args: [sourceApi],
      env: { ...process.env },
    }
  }

  return {
    entry: process.execPath,
    args: [compiledApi],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }
}

function startServer(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    backendReady = false
    backendError = null

    const wsEnsure = ws.ensureWorkspaceStructure(config.dataDir)
    if (!wsEnsure.ok) {
      backendError = {
        code: 'DATA_DIR_NOT_WRITABLE',
        message: `数据目录不可写：${config.dataDir}`,
        detail: `请检查目录权限或更换数据目录。错误：${wsEnsure.error}（${wsEnsure.errorCode}）`,
      }
      ws.writeLog(getDefaultDataDir(), 'app', 'error', '数据目录不可写', backendError.detail)
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
        ws.writeLog(config.dataDir, 'app', 'error', '无可用端口', backendError.detail)
        mainWindow?.webContents.send('backend:error', backendError)
        reject(backendError)
        return
      }
      ws.writeLog(config.dataDir, 'app', 'warn', `端口 ${config.serverPort} 不可用，已切换到 ${newPort}`)
      config.serverPort = newPort
      saveConfig()
    }

    const { entry, args, env: envExtra } = resolveServerEntry()

    ws.writeLog(config.dataDir, 'app', 'info', `启动后端服务`, `entry=${entry} args=${args.join(' ')} port=${config.serverPort}`)

    try {
      serverProcess = spawn(entry, args, {
        env: {
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
      ws.writeLog(config.dataDir, 'app', 'error', 'spawn 后端失败', backendError.detail)
      mainWindow?.webContents.send('backend:error', backendError)
      reject(backendError)
      return
    }

    let stdoutBuffer = ''
    let resolved = false

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      const trimmed = text.trim()
      if (trimmed.length) {
        ws.writeLog(config.dataDir, 'server', 'info', trimmed)
      }
      stdoutBuffer += text
      if (!resolved && (text.includes('Server ready') || text.includes(`port ${config.serverPort}`) || text.includes(`localhost:${config.serverPort}`))) {
        resolved = true
        backendReady = true
        ws.writeLog(config.dataDir, 'app', 'success', '后端服务就绪', `port=${config.serverPort}`)
        mainWindow?.webContents.send('backend:ready', {
          port: config.serverPort,
          dataDir: config.dataDir,
        })
        resolve()
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      const trimmed = text.trim()
      if (trimmed.length) {
        ws.writeLog(config.dataDir, 'server', 'warn', trimmed)
      }
      stdoutBuffer += text
      if (!resolved) {
        const lower = text.toLowerCase()
        if (lower.includes('eaddrinuse') || lower.includes('port')) {
          backendError = {
            code: 'PORT_NOT_AVAILABLE',
            message: `端口 ${config.serverPort} 已被占用`,
            detail: trimmed.slice(0, 500),
          }
        } else if (lower.includes('cannot find module') || lower.includes('module_not_found') || lower.includes('error: cannot')) {
          backendError = {
            code: 'DEPENDENCY_MISSING',
            message: '依赖缺失或模块未找到',
            detail: trimmed.slice(0, 1000),
          }
        } else if (lower.includes('error')) {
          backendError = {
            code: 'SERVER_UNKNOWN_ERROR',
            message: '后端服务启动失败',
            detail: trimmed.slice(0, 1000),
          }
        }
        if (backendError) {
          ws.writeLog(config.dataDir, 'app', 'error', `后端错误（${backendError.code}）`, backendError.detail)
          mainWindow?.webContents.send('backend:error', backendError)
          reject(backendError)
        }
      }
    })

    serverProcess.on('error', (err) => {
      ws.writeLog(config.dataDir, 'app', 'error', 'Server spawn error', err?.message)
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
      ws.writeLog(config.dataDir, 'app', 'warn', `后端进程退出`, `code=${code ?? 'unknown'}`)
      if (!resolved && !backendError) {
        backendError = {
          code: 'SERVER_EXITED',
          message: `后端进程意外退出（退出码: ${code ?? 'unknown'}）`,
          detail: stdoutBuffer.slice(-2000),
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
        ws.writeLog(config.dataDir, 'app', 'error', '后端启动超时')
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

function getBackendStatusPayload() {
  const libState = ws.detectLibraryState(config.dataDir)
  const metaLoaded = ws.loadMeta(config.dataDir)
  return {
    ready: backendReady,
    port: config.serverPort,
    dataDir: config.dataDir,
    error: backendError,
    libraryState: libState,
    workspaceMeta: metaLoaded.meta,
    workspaceMetaOk: metaLoaded.ok,
    workspaceMetaCorrupted: !!metaLoaded.corrupted,
    wizardComplete: ws.isWizardComplete(config.dataDir),
    recentLogFiles: ws.listRecentLogFiles(config.dataDir, 5),
  }
}

function registerIpcHandlers() {
  ipcMain.handle('config:get', () => config)

  ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>) => {
    if (patch.dataDir != null && patch.dataDir !== config.dataDir) {
      const check = ws.ensureDataDir(patch.dataDir)
      if (!check.ok) {
        return {
          success: false,
          error: `数据目录不可用：${check.error}`,
          errorCode: 'DATA_DIR_NOT_WRITABLE',
        }
      }

      const oldDir = config.dataDir
      ws.setRecentSessionId(oldDir, ws.getRecentSessionId(oldDir))

      config = { ...config, ...patch }
      saveConfig()

      const wsResult = ws.ensureWorkspaceStructure(config.dataDir)
      if (!wsResult.ok) {
        return { success: false, error: wsResult.error, errorCode: wsResult.errorCode }
      }

      const libState = ws.detectLibraryState(config.dataDir)
      const metaLoaded = ws.loadMeta(config.dataDir)
      const wizardComplete = ws.isWizardComplete(config.dataDir)

      let trigger: wizard.WizardTrigger | null = null
      let reason = ''

      if (!wizardComplete) {
        if (!libState.exists) {
          trigger = 'dir-switch'
          reason = '切换到空目录，需要初始化新数据库'
        } else if (libState.exists && !libState.hasValidSchema) {
          trigger = 'dir-switch'
          reason = '切换到的目录存在无效数据库文件'
        } else if (libState.exists && libState.hasValidSchema) {
          trigger = 'dir-switch'
          reason = '切换到已有数据库的目录，需要确认处理方式'
        }
      }

      ws.writeLog(config.dataDir, 'app', 'info', '切换数据目录', `from=${oldDir} to=${config.dataDir} trigger=${trigger ?? 'none'}`)

      return {
        success: true,
        config,
        libraryState: libState,
        workspaceMeta: metaLoaded.meta,
        needWizard: trigger != null,
        wizardTrigger: trigger,
        wizardReason: reason,
        wizardComplete,
        createdWorkspaceFiles: wsResult.createdMeta || wsResult.createdLogs,
      }
    }

    if (patch.serverPort != null && patch.serverPort !== config.serverPort) {
      const ok = await checkPortAvailable(patch.serverPort)
      if (!ok) {
        return {
          success: false,
          error: `端口 ${patch.serverPort} 已被占用`,
          errorCode: 'PORT_NOT_AVAILABLE',
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
    return ws.ensureDataDir(dirPath)
  })

  ipcMain.handle('backend:restart', async () => {
    stopServer()
    backendError = null
    ws.writeLog(config.dataDir, 'app', 'info', '重启后端服务')
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

  ipcMain.handle('backend:status', () => getBackendStatusPayload())

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
    ws.setRecentSessionId(config.dataDir, sessionId)
  })

  ipcMain.handle('workspace:getMeta', (_e, dir?: string) => {
    const targetDir = dir || config.dataDir
    return ws.loadMeta(targetDir)
  })

  ipcMain.handle('workspace:saveMeta', (_e, patch: any, dir?: string) => {
    const targetDir = dir || config.dataDir
    return ws.saveMeta(targetDir, patch)
  })

  ipcMain.handle('workspace:detectState', (_e, dir?: string) => {
    return ws.detectLibraryState(dir || config.dataDir)
  })

  ipcMain.handle('workspace:listLogs', (_e, dir?: string) => {
    return ws.listRecentLogFiles(dir || config.dataDir, 10)
  })

  ipcMain.handle('workspace:readLogTail', (_e, filePath: string, maxLines: number = 200) => {
    return ws.readLogTail(filePath, maxLines)
  })

  ipcMain.handle('workspace:ensureStructure', (_e, dir?: string) => {
    return ws.ensureWorkspaceStructure(dir || config.dataDir)
  })

  ipcMain.handle('wizard:markComplete', (_e, dir?: string) => {
    const targetDir = dir || config.dataDir
    return ws.markWizardComplete(targetDir)
  })

  ipcMain.handle('workspace:switchAndInit', async (_e, newDir: string, dataAction: 'init-new' | 'use-existing' | 'migrate', sourceDbPath?: string) => {
    const oldDir = config.dataDir
    ws.setRecentSessionId(oldDir, ws.getRecentSessionId(oldDir))

    const handleResult = await wizard.handleData(dataAction, sourceDbPath)
    if (handleResult.status !== 'success') {
      return {
        success: false,
        error: handleResult.message,
        errorDetail: handleResult.errorDetail,
      }
    }

    config.dataDir = newDir
    saveConfig()

    ws.markWizardComplete(newDir)

    const meta = ws.loadMeta(newDir)
    ws.writeLog(newDir, 'app', 'info', '完成工作区切换并初始化', `action=${dataAction} from=${oldDir}`)

    return {
      success: true,
      config,
      workspaceMeta: meta.meta,
      handleResult,
    }
  })

  ipcMain.handle('wizard:checkNeed', () => wizard.checkNeedWizard())

  ipcMain.handle('wizard:start', (_e, trigger: wizard.WizardTrigger) => {
    wizard.startWizard(trigger)
    return wizard.getWizardState()
  })

  ipcMain.handle('wizard:getState', () => wizard.getWizardState())

  ipcMain.handle('wizard:goToStep', (_e, step: wizard.WizardStep) => {
    wizard.goToStep(step)
    return wizard.getWizardState()
  })

  ipcMain.handle('wizard:runEnvCheck', async () => {
    const result = await wizard.runEnvCheck()
    return { state: wizard.getWizardState(), result }
  })

  ipcMain.handle('wizard:setDataDir', (_e, dir: string) => {
    wizard.setSelectedDataDir(dir)
    return wizard.getWizardState()
  })

  ipcMain.handle('wizard:checkDataDir', async (_e, dir: string) => {
    return await wizard.checkDataDir(dir)
  })

  ipcMain.handle('wizard:handleData', async (_e, action: 'migrate' | 'init-new' | 'use-existing', sourceDbPath?: string) => {
    const result = await wizard.handleData(action, sourceDbPath)
    return { state: wizard.getWizardState(), result }
  })

  ipcMain.handle('wizard:setRestoreSession', (_e, sessionId: number | null) => {
    wizard.setRestoreSession(sessionId)
    return wizard.getWizardState()
  })

  ipcMain.handle('wizard:detectOldDb', () => wizard.detectOldDatabase())

  ipcMain.handle('wizard:complete', async () => {
    wizard.completeWizard()
    const state = wizard.getWizardState()
    ws.markWizardComplete(config.dataDir)
    backendError = null
    stopServer()
    try {
      await startServer()
      if (mainWindow) {
        const serverUrl = `http://localhost:${config.serverPort}`
        mainWindow.loadURL(serverUrl).catch(() => {})
      }
    } catch (err: any) {
      ws.writeLog(config.dataDir, 'app', 'error', '向导完成后启动服务器失败', err?.message)
    }
    return state
  })

  ipcMain.handle('wizard:cancel', () => {
    wizard.cancelWizard()
    return wizard.getWizardState()
  })
}

app.whenReady().then(async () => {
  config = loadConfig()

  ws.ensureWorkspaceStructure(config.dataDir)
  ws.writeLog(config.dataDir, 'app', 'info', '应用启动', `version=${app.getVersion()} platform=${process.platform}`)

  registerIpcHandlers()

  wizard.initWizard(config, getConfigPath(), getDefaultDataDir())

  startServer().catch((err) => {
    ws.writeLog(config.dataDir, 'app', 'error', '初始启动后端失败', err?.message || String(err))
  })

  const needWizard = wizard.checkNeedWizard()
  if (needWizard.need) {
    wizard.startWizard(needWizard.trigger)
    ws.writeLog(config.dataDir, 'app', 'info', `启动向导触发: ${needWizard.reason}`)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  ws.writeLog(config.dataDir, 'app', 'info', '所有窗口关闭，准备退出')
  if (process.platform !== 'darwin') {
    stopServer()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopServer()
})

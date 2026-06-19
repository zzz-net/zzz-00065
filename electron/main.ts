import { app, BrowserWindow } from 'electron'
import path from 'path'
import { spawn } from 'child_process'

let mainWindow: BrowserWindow | null = null
let serverProcess: ReturnType<typeof spawn> | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '培训考场管理系统',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const serverPort = process.env.SERVER_PORT || '3001'
  const url = `http://localhost:${serverPort}`

  const tryLoad = () => {
    mainWindow!.loadURL(url).catch(() => {
      setTimeout(tryLoad, 500)
    })
  }

  tryLoad()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function startServer() {
  const serverPath = path.join(__dirname, '..', 'api', 'server.ts')
  const tsxPath = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx')

  serverProcess = spawn(process.platform === 'win32' ? tsxPath + '.cmd' : tsxPath, [serverPath], {
    env: {
      ...process.env,
      PORT: process.env.SERVER_PORT || '3001',
      DB_DIR: app.getPath('userData'),
      ELECTRON_RUN: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log('[server]', data.toString().trim())
  })

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[server]', data.toString().trim())
  })

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err)
  })

  serverProcess.on('exit', (code) => {
    console.log('Server process exited with code:', code)
  })
}

app.whenReady().then(() => {
  startServer()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverProcess) {
      serverProcess.kill()
      serverProcess = null
    }
    app.quit()
  }
})

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})

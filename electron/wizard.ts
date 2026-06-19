import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'
import { app } from 'electron'

export type WizardStep = 'welcome' | 'env-check' | 'dir-select' | 'data-handle' | 'session-restore' | 'complete'

export type WizardTrigger = 'first-run' | 'dir-switch' | 'old-db-detected' | 'manual'

export interface WizardLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  step: WizardStep | 'system'
  message: string
  detail?: string
}

export interface WizardState {
  active: boolean
  trigger: WizardTrigger
  currentStep: WizardStep
  stepsCompleted: WizardStep[]
  envCheckResult: EnvCheckResult | null
  selectedDataDir: string
  dataHandleResult: DataHandleResult | null
  restoreSessionId: number | null
  logs: WizardLogEntry[]
  completed: boolean
}

export interface EnvCheckItem {
  name: string
  status: 'pending' | 'running' | 'success' | 'error' | 'warn'
  message: string
  detail?: string
}

export interface EnvCheckResult {
  overall: 'pass' | 'fail' | 'warn'
  items: {
    dataDirWritable: EnvCheckItem
    portAvailable: EnvCheckItem
    dependencies: EnvCheckItem
  }
  resolvedPort?: number
}

export interface DataHandleResult {
  action: 'migrate' | 'init-new' | 'use-existing' | 'skip'
  sourceDb?: string
  targetDb: string
  status: 'pending' | 'running' | 'success' | 'error'
  message: string
  migratedTables?: string[]
  errorDetail?: string
}

interface AppConfig {
  dataDir: string
  serverPort: number
  recentSessionId: number | null
  windowBounds: { width: number; height: number; x?: number; y?: number; maximized?: boolean } | null
}

let state: WizardState = {
  active: false,
  trigger: 'first-run',
  currentStep: 'welcome',
  stepsCompleted: [],
  envCheckResult: null,
  selectedDataDir: '',
  dataHandleResult: null,
  restoreSessionId: null,
  logs: [],
  completed: false,
}

let config: AppConfig | null = null
let configPath = ''
let defaultDataDir = ''

const CONFIG_FILENAME = 'app-config.json'

export function initWizard(cfg: AppConfig, cfgPath: string, defDir: string) {
  config = cfg
  configPath = cfgPath
  defaultDataDir = defDir
  state.selectedDataDir = cfg.dataDir
}

export function getWizardState(): WizardState {
  return { ...state, logs: [...state.logs] }
}

export function addLog(
  level: WizardLogEntry['level'],
  step: WizardLogEntry['step'],
  message: string,
  detail?: string
) {
  const entry: WizardLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    step,
    message,
    detail,
  }
  state.logs.push(entry)
  persistLogs()
}

function getLogDir(): string {
  const dir = path.join(state.selectedDataDir || defaultDataDir, 'wizard-logs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function persistLogs() {
  try {
    const logDir = getLogDir()
    const logFile = path.join(logDir, `wizard-${Date.now()}.json`)
    fs.writeFileSync(logFile, JSON.stringify(state.logs, null, 2), 'utf-8')
  } catch (e) {
    console.warn('Failed to persist wizard logs:', e)
  }
}

export function checkNeedWizard(): { need: boolean; trigger: WizardTrigger; reason?: string } {
  if (!config) return { need: false, trigger: 'first-run' }

  const configExists = fs.existsSync(configPath)
  const dbPath = path.join(config.dataDir, 'exam-manager.db')
  const dbExists = fs.existsSync(dbPath)
  const oldDataDir = path.join(process.cwd(), 'exam-manager.db')
  const oldDbExists = fs.existsSync(oldDataDir)

  if (!configExists) {
    return { need: true, trigger: 'first-run', reason: '配置文件不存在，首次启动' }
  }

  if (!dbExists && oldDbExists) {
    return { need: true, trigger: 'old-db-detected', reason: '检测到项目目录下的旧数据库，需要迁移' }
  }

  if (!dbExists) {
    return { need: true, trigger: 'first-run', reason: '数据库不存在，需要初始化' }
  }

  if (state.active) {
    return { need: true, trigger: state.trigger, reason: '向导正在进行中' }
  }

  return { need: false, trigger: 'first-run' }
}

export function startWizard(trigger: WizardTrigger = 'first-run') {
  state = {
    active: true,
    trigger,
    currentStep: 'welcome',
    stepsCompleted: [],
    envCheckResult: null,
    selectedDataDir: config?.dataDir || defaultDataDir,
    dataHandleResult: null,
    restoreSessionId: config?.recentSessionId || null,
    logs: [],
    completed: false,
  }
  addLog('info', 'welcome', `向导已启动，触发原因: ${getTriggerText(trigger)}`)
}

function getTriggerText(trigger: WizardTrigger): string {
  const map: Record<WizardTrigger, string> = {
    'first-run': '首次启动',
    'dir-switch': '切换数据目录',
    'old-db-detected': '检测到旧数据库',
    'manual': '手动启动',
  }
  return map[trigger]
}

export function goToStep(step: WizardStep) {
  state.currentStep = step
  addLog('info', step, `进入步骤: ${getStepText(step)}`)
}

export function completeStep(step: WizardStep) {
  if (!state.stepsCompleted.includes(step)) {
    state.stepsCompleted.push(step)
  }
}

function getStepText(step: WizardStep): string {
  const map: Record<WizardStep, string> = {
    'welcome': '欢迎',
    'env-check': '环境检查',
    'dir-select': '目录选择',
    'data-handle': '数据处理',
    'session-restore': '场次恢复',
    'complete': '完成',
  }
  return map[step]
}

export async function runEnvCheck(): Promise<EnvCheckResult> {
  const result: EnvCheckResult = {
    overall: 'pass',
    items: {
      dataDirWritable: { name: '数据目录可写性', status: 'pending', message: '等待检查' },
      portAvailable: { name: '服务端口可用性', status: 'pending', message: '等待检查' },
      dependencies: { name: '运行依赖完整性', status: 'pending', message: '等待检查' },
    },
  }

  state.envCheckResult = result
  state.currentStep = 'env-check'
  addLog('info', 'env-check', '开始环境检查')

  result.items.dataDirWritable.status = 'running'
  result.items.dataDirWritable.message = '正在检查目录...'
  const dirCheck = ensureDataDir(state.selectedDataDir)
  if (dirCheck.ok) {
    result.items.dataDirWritable.status = 'success'
    result.items.dataDirWritable.message = `目录 ${state.selectedDataDir} 可写`
    addLog('success', 'env-check', '数据目录可写性检查通过', state.selectedDataDir)
  } else {
    result.items.dataDirWritable.status = 'error'
    result.items.dataDirWritable.message = `目录不可写: ${dirCheck.error}`
    result.items.dataDirWritable.detail = dirCheck.error
    result.overall = 'fail'
    addLog('error', 'env-check', '数据目录可写性检查失败', dirCheck.error)
  }

  result.items.portAvailable.status = 'running'
  result.items.portAvailable.message = `正在检查端口 ${config?.serverPort || 3001}...`
  const port = config?.serverPort || 3001
  const portOk = await checkPortAvailable(port)
  if (portOk) {
    result.items.portAvailable.status = 'success'
    result.items.portAvailable.message = `端口 ${port} 可用`
    result.resolvedPort = port
    addLog('success', 'env-check', `端口 ${port} 可用性检查通过`)
  } else {
    const newPort = await findAvailablePort(port + 1)
    if (newPort > 0) {
      result.items.portAvailable.status = 'warn'
      result.items.portAvailable.message = `端口 ${port} 已被占用，自动分配端口 ${newPort}`
      result.resolvedPort = newPort
      result.overall = result.overall === 'fail' ? 'fail' : 'warn'
      addLog('warn', 'env-check', `端口 ${port} 已被占用，自动分配 ${newPort}`)
    } else {
      result.items.portAvailable.status = 'error'
      result.items.portAvailable.message = `端口 ${port} 已被占用，且未找到可用端口`
      result.overall = 'fail'
      addLog('error', 'env-check', '端口检查失败，未找到可用端口')
    }
  }

  result.items.dependencies.status = 'running'
  result.items.dependencies.message = '正在检查依赖...'
  const depCheck = checkDependencies()
  if (depCheck.ok) {
    result.items.dependencies.status = 'success'
    result.items.dependencies.message = '依赖检查通过'
    addLog('success', 'env-check', '依赖完整性检查通过')
  } else {
    result.items.dependencies.status = 'error'
    result.items.dependencies.message = depCheck.message
    result.items.dependencies.detail = depCheck.detail
    result.overall = 'fail'
    addLog('error', 'env-check', '依赖检查失败', depCheck.detail)
  }

  state.envCheckResult = { ...result }
  completeStep('env-check')
  addLog('info', 'env-check', `环境检查完成，结果: ${result.overall}`)

  return result
}

export function setSelectedDataDir(dir: string) {
  state.selectedDataDir = dir
  addLog('info', 'dir-select', `选择数据目录: ${dir}`)
}

export async function checkDataDir(dir: string): Promise<{ ok: boolean; error?: string; hasExistingDb: boolean; dbPath: string }> {
  const dbPath = path.join(dir, 'exam-manager.db')
  const dirCheck = ensureDataDir(dir)
  const hasExistingDb = fs.existsSync(dbPath)
  return {
    ok: dirCheck.ok,
    error: dirCheck.error,
    hasExistingDb,
    dbPath,
  }
}

export async function handleData(
  action: 'migrate' | 'init-new' | 'use-existing',
  sourceDbPath?: string
): Promise<DataHandleResult> {
  const targetDbPath = path.join(state.selectedDataDir, 'exam-manager.db')

  const result: DataHandleResult = {
    action,
    sourceDb: sourceDbPath,
    targetDb: targetDbPath,
    status: 'running',
    message: '正在处理数据...',
  }

  state.dataHandleResult = result
  state.currentStep = 'data-handle'
  addLog('info', 'data-handle', `开始数据处理: ${action}`, `目标: ${targetDbPath}`)

  try {
    if (action === 'migrate' && sourceDbPath) {
      const migrateResult = await migrateDatabase(sourceDbPath, targetDbPath)
      result.status = migrateResult.success ? 'success' : 'error'
      result.message = migrateResult.message
      result.migratedTables = migrateResult.tables
      if (!migrateResult.success) {
        result.errorDetail = migrateResult.error
        addLog('error', 'data-handle', '数据迁移失败', migrateResult.error)
      } else {
        addLog('success', 'data-handle', '数据迁移成功', `迁移表: ${migrateResult.tables?.join(', ')}`)
      }
    } else if (action === 'init-new') {
      if (fs.existsSync(targetDbPath)) {
        const backupPath = targetDbPath + `.backup-${Date.now()}.db`
        fs.copyFileSync(targetDbPath, backupPath)
        addLog('info', 'data-handle', `已备份现有数据库到: ${backupPath}`)
      }
      ensureDataDir(state.selectedDataDir)
      result.status = 'success'
      result.message = '新数据库将在后端启动时自动初始化'
      addLog('success', 'data-handle', '新数据库初始化准备完成')
    } else if (action === 'use-existing') {
      result.status = 'success'
      result.message = '使用现有数据库'
      addLog('success', 'data-handle', '确认使用现有数据库', targetDbPath)
    }

    state.dataHandleResult = { ...result }
    completeStep('data-handle')

    if (result.status === 'success' && config) {
      config.dataDir = state.selectedDataDir
      if (state.envCheckResult?.resolvedPort) {
        config.serverPort = state.envCheckResult.resolvedPort
      }
      saveConfig()
    }

    return result
  } catch (e: any) {
    result.status = 'error'
    result.message = '数据处理失败'
    result.errorDetail = e?.message || '未知错误'
    state.dataHandleResult = { ...result }
    addLog('error', 'data-handle', '数据处理异常', e?.message)
    return result
  }
}

async function migrateDatabase(
  sourcePath: string,
  targetPath: string
): Promise<{ success: boolean; message: string; tables?: string[]; error?: string }> {
  try {
    if (!fs.existsSync(sourcePath)) {
      return { success: false, message: '源数据库不存在', error: sourcePath }
    }

    const targetDir = path.dirname(targetPath)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    if (fs.existsSync(targetPath)) {
      const backupPath = targetPath + `.backup-${Date.now()}.db`
      fs.copyFileSync(targetPath, backupPath)
      addLog('info', 'data-handle', `已备份目标数据库到: ${backupPath}`)
    }

    fs.copyFileSync(sourcePath, targetPath)

    const tables = await verifyDatabase(targetPath)

    return {
      success: true,
      message: `成功迁移 ${tables.length} 个表`,
      tables,
    }
  } catch (e: any) {
    return {
      success: false,
      message: '迁移失败',
      error: e?.message || '未知错误',
    }
  }
}

async function verifyDatabase(dbPath: string): Promise<string[]> {
  const tables: string[] = []
  try {
    const initSqlJs = await import('sql.js')
    const SQL = await initSqlJs.default()
    const buffer = fs.readFileSync(dbPath)
    const db = new SQL.Database(buffer)
    const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    if (result.length > 0) {
      for (const row of result[0].values) {
        tables.push(String(row[0]))
      }
    }
    db.close()
  } catch (e) {
    console.warn('Failed to verify database:', e)
  }
  return tables
}

export function setRestoreSession(sessionId: number | null) {
  state.restoreSessionId = sessionId
  if (config && sessionId != null) {
    config.recentSessionId = sessionId
    saveConfig()
  }
  addLog('info', 'session-restore', sessionId ? `设置恢复场次: ${sessionId}` : '不恢复场次')
}

export function completeWizard() {
  state.completed = true
  state.active = false
  completeStep('complete')
  addLog('success', 'complete', '向导完成，准备进入主界面')

  if (config) {
    config.dataDir = state.selectedDataDir
    if (state.envCheckResult?.resolvedPort) {
      config.serverPort = state.envCheckResult.resolvedPort
    }
    saveConfig()
  }
}

export function cancelWizard() {
  state.active = false
  addLog('warn', 'system', '向导已取消')
}

function ensureDataDir(dir: string): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const testFile = path.join(dir, `.write-test-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
    fs.writeFileSync(testFile, 'test', 'utf-8')
    fs.unlinkSync(testFile)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.code || e?.message || '未知错误' }
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

function checkDependencies(): { ok: boolean; message: string; detail?: string } {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json')
    if (!fs.existsSync(packageJsonPath)) {
      return { ok: true, message: '打包模式运行，跳过依赖检查' }
    }

    const nodeModulesPath = path.join(__dirname, '..', 'node_modules')
    if (!fs.existsSync(nodeModulesPath)) {
      return { ok: false, message: 'node_modules 不存在，请执行 npm install', detail: nodeModulesPath }
    }

    const requiredDeps = ['express', 'sql.js']
    const missing: string[] = []
    for (const dep of requiredDeps) {
      const depPath = path.join(nodeModulesPath, dep)
      if (!fs.existsSync(depPath)) {
        missing.push(dep)
      }
    }

    if (missing.length > 0) {
      return {
        ok: false,
        message: `缺失依赖: ${missing.join(', ')}，请执行 npm install`,
        detail: missing.join(', '),
      }
    }

    return { ok: true, message: '依赖检查通过' }
  } catch (e: any) {
    return { ok: false, message: '依赖检查失败', detail: e?.message }
  }
}

function saveConfig() {
  if (!config || !configPath) return
  try {
    const userDataDir = path.dirname(configPath)
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to save config from wizard:', e)
  }
}

export function detectOldDatabase(): string | null {
  const projectDb = path.join(process.cwd(), 'exam-manager.db')
  if (fs.existsSync(projectDb)) {
    return projectDb
  }

  const potentialLocations = [
    path.join(app.getPath('documents'), 'exam-session-manager', 'exam-manager.db'),
    path.join(app.getPath('desktop'), 'exam-manager.db'),
  ]

  for (const loc of potentialLocations) {
    if (fs.existsSync(loc)) {
      return loc
    }
  }

  return null
}

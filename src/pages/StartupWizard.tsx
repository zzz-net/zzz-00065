import { useState, useEffect, useCallback } from 'react'
import {
  Rocket,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  FolderOpen,
  Database,
  HardDrive,
  ArrowRight,
  ArrowLeft,
  Play,
  RotateCcw,
  ChevronRight,
  FileJson,
  Clock,
  Terminal,
  X,
  Download,
  Info,
} from 'lucide-react'

type WizardStep = 'welcome' | 'env-check' | 'dir-select' | 'data-handle' | 'session-restore' | 'complete'

interface WizardLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  step: WizardStep | 'system'
  message: string
  detail?: string
}

interface EnvCheckItem {
  name: string
  status: 'pending' | 'running' | 'success' | 'error' | 'warn'
  message: string
  detail?: string
}

interface EnvCheckResult {
  overall: 'pass' | 'fail' | 'warn'
  items: {
    dataDirWritable: EnvCheckItem
    portAvailable: EnvCheckItem
    dependencies: EnvCheckItem
  }
  resolvedPort?: number
}

interface DataHandleResult {
  action: 'migrate' | 'init-new' | 'use-existing' | 'skip'
  sourceDb?: string
  targetDb: string
  status: 'pending' | 'running' | 'success' | 'error'
  message: string
  migratedTables?: string[]
  errorDetail?: string
}

interface WizardState {
  active: boolean
  trigger: string
  currentStep: WizardStep
  stepsCompleted: WizardStep[]
  envCheckResult: EnvCheckResult | null
  selectedDataDir: string
  dataHandleResult: DataHandleResult | null
  restoreSessionId: number | null
  logs: WizardLogEntry[]
  completed: boolean
}

const STEP_CONFIG: Record<WizardStep, { title: string; icon: React.ReactNode; description: string }> = {
  'welcome': {
    title: '欢迎使用',
    icon: <Rocket className="w-6 h-6" />,
    description: '首次启动配置向导',
  },
  'env-check': {
    title: '环境检查',
    icon: <Terminal className="w-6 h-6" />,
    description: '检测系统运行环境',
  },
  'dir-select': {
    title: '目录选择',
    icon: <FolderOpen className="w-6 h-6" />,
    description: '设置数据存储目录',
  },
  'data-handle': {
    title: '数据处理',
    icon: <Database className="w-6 h-6" />,
    description: '迁移或初始化数据库',
  },
  'session-restore': {
    title: '场次恢复',
    icon: <Clock className="w-6 h-6" />,
    description: '恢复最近工作场次',
  },
  'complete': {
    title: '完成配置',
    icon: <CheckCircle2 className="w-6 h-6" />,
    description: '准备进入主界面',
  },
}

const TRIGGER_TEXT: Record<string, string> = {
  'first-run': '首次启动',
  'dir-switch': '切换数据目录',
  'old-db-detected': '检测到旧数据库',
  'manual': '手动启动',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-500',
  success: 'text-green-500',
  error: 'text-red-500',
  warn: 'text-yellow-500',
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Info className="w-5 h-5" />,
  running: <Loader2 className="w-5 h-5 animate-spin" />,
  success: <CheckCircle2 className="w-5 h-5" />,
  error: <XCircle className="w-5 h-5" />,
  warn: <AlertCircle className="w-5 h-5" />,
}

export default function StartupWizard() {
  const [state, setState] = useState<WizardState | null>(null)
  const [loading, setLoading] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const [oldDbPath, setOldDbPath] = useState<string | null>(null)
  const [dirCheckResult, setDirCheckResult] = useState<{
    ok: boolean
    error?: string
    hasExistingDb: boolean
    dbPath: string
  } | null>(null)
  const [dataAction, setDataAction] = useState<'migrate' | 'init-new' | 'use-existing' | null>(null)
  const [processing, setProcessing] = useState(false)
  const [restoreOption, setRestoreOption] = useState<'restore' | 'skip'>('skip')

  const loadState = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const s = await window.electronAPI.wizardGetState()
      setState(s)
      if (s.currentStep === 'dir-select') {
        const check = await window.electronAPI.wizardCheckDataDir(s.selectedDataDir)
        setDirCheckResult(check)
      }
      if (s.currentStep === 'data-handle') {
        const oldDb = await window.electronAPI.wizardDetectOldDb()
        setOldDbPath(oldDb)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  const goToStep = async (step: WizardStep) => {
    if (!window.electronAPI) return
    setProcessing(true)
    try {
      const s = await window.electronAPI.wizardGoToStep(step)
      setState(s)
      if (step === 'dir-select') {
        const check = await window.electronAPI.wizardCheckDataDir(s.selectedDataDir)
        setDirCheckResult(check)
      }
      if (step === 'data-handle') {
        const oldDb = await window.electronAPI.wizardDetectOldDb()
        setOldDbPath(oldDb)
      }
    } finally {
      setProcessing(false)
    }
  }

  const runEnvCheck = async () => {
    if (!window.electronAPI) return
    setProcessing(true)
    try {
      const result = await window.electronAPI.wizardRunEnvCheck()
      setState(result.state)
    } finally {
      setProcessing(false)
    }
  }

  const selectDataDir = async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.selectDirectory()
    if (!result.canceled && result.filePaths.length > 0) {
      const dir = result.filePaths[0]
      await window.electronAPI.wizardSetDataDir(dir)
      const check = await window.electronAPI.wizardCheckDataDir(dir)
      setDirCheckResult(check)
      await loadState()
    }
  }

  const checkDataDir = async (dir: string) => {
    if (!window.electronAPI) return
    const check = await window.electronAPI.wizardCheckDataDir(dir)
    setDirCheckResult(check)
  }

  const handleDataAction = async (action: 'migrate' | 'init-new' | 'use-existing') => {
    if (!window.electronAPI) return
    setProcessing(true)
    setDataAction(action)
    try {
      const source = action === 'migrate' ? oldDbPath || undefined : undefined
      const result = await window.electronAPI.wizardHandleData(action, source)
      setState(result.state)
    } finally {
      setProcessing(false)
    }
  }

  const completeWizard = async () => {
    if (!window.electronAPI) return
    setProcessing(true)
    try {
      if (restoreOption === 'restore' && state?.restoreSessionId) {
        await window.electronAPI.wizardSetRestoreSession(state.restoreSessionId)
      } else {
        await window.electronAPI.wizardSetRestoreSession(null)
      }
      await window.electronAPI.wizardComplete()
    } finally {
      setProcessing(false)
    }
  }

  const cancelWizard = async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.showMessageBox({
      type: 'warning',
      title: '取消向导',
      message: '确定要取消配置向导吗？取消后可能无法正常使用系统。',
      buttons: ['继续配置', '取消向导'],
    })
    if (result.response === 1) {
      await window.electronAPI.wizardCancel()
      window.location.reload()
    }
  }

  const exportLogs = () => {
    if (!state) return
    const logContent = JSON.stringify(state.logs, null, 2)
    const blob = new Blob([logContent], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wizard-logs-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('zh-CN')
  }

  const getLogColor = (level: string) => {
    switch (level) {
      case 'success': return 'text-green-600'
      case 'error': return 'text-red-600'
      case 'warn': return 'text-yellow-600'
      default: return 'text-gray-600'
    }
  }

  const canProceed = () => {
    if (!state) return false
    switch (state.currentStep) {
      case 'welcome':
        return true
      case 'env-check':
        return state.envCheckResult?.overall === 'pass' || state.envCheckResult?.overall === 'warn'
      case 'dir-select':
        return dirCheckResult?.ok ?? false
      case 'data-handle':
        return state.dataHandleResult?.status === 'success'
      case 'session-restore':
        return true
      case 'complete':
        return state.completed || true
      default:
        return false
    }
  }

  const renderWelcomeStep = () => (
    <div className="text-center py-8">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full text-white mb-6">
        <Rocket className="w-10 h-10" />
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">欢迎使用培训考场管理系统</h2>
      <p className="text-gray-600 mb-6">
        检测到这是 <span className="font-semibold text-blue-600">{TRIGGER_TEXT[state?.trigger || 'first-run']}</span>，
        将引导您完成系统配置。
      </p>
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 max-w-md mx-auto text-left">
        <h4 className="font-medium text-blue-800 mb-2 flex items-center gap-2">
          <Info className="w-4 h-4" /> 配置内容包括：
        </h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3" /> 运行环境检查</li>
          <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3" /> 数据存储目录设置</li>
          <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3" /> 数据库初始化或迁移</li>
          <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3" /> 最近场次恢复</li>
        </ul>
      </div>
    </div>
  )

  const renderEnvCheckStep = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">环境检测</h3>
          <p className="text-sm text-gray-500">系统将自动检查运行所需的环境条件</p>
        </div>
        {state?.envCheckResult && (
          <button
            onClick={runEnvCheck}
            disabled={processing}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
          >
            <RotateCcw className={`w-4 h-4 ${processing ? 'animate-spin' : ''}`} />
            重新检查
          </button>
        )}
      </div>

      {!state?.envCheckResult ? (
        <div className="text-center py-12">
          <button
            onClick={runEnvCheck}
            disabled={processing}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
          >
            <Play className="w-5 h-5" />
            {processing ? '正在检查...' : '开始环境检查'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`p-4 rounded-lg border ${
            state.envCheckResult.overall === 'pass' ? 'bg-green-50 border-green-200' :
            state.envCheckResult.overall === 'warn' ? 'bg-yellow-50 border-yellow-200' :
            'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-center gap-3">
              <div className={
                state.envCheckResult.overall === 'pass' ? 'text-green-500' :
                state.envCheckResult.overall === 'warn' ? 'text-yellow-500' :
                'text-red-500'
              }>
                {state.envCheckResult.overall === 'pass' ? <CheckCircle2 className="w-6 h-6" /> :
                 state.envCheckResult.overall === 'warn' ? <AlertCircle className="w-6 h-6" /> :
                 <XCircle className="w-6 h-6" />}
              </div>
              <div>
                <div className="font-medium text-gray-800">
                  {state.envCheckResult.overall === 'pass' ? '环境检查通过' :
                   state.envCheckResult.overall === 'warn' ? '环境存在警告' :
                   '环境检查失败'}
                </div>
                <div className="text-sm text-gray-500">
                  {state.envCheckResult.overall === 'pass' ? '所有检查项均已通过，可以继续配置' :
                   state.envCheckResult.overall === 'warn' ? '存在非关键问题，可继续但建议修复' :
                   '存在关键问题，请修复后再继续'}
                </div>
              </div>
            </div>
          </div>

          {Object.entries(state.envCheckResult.items).map(([key, item]) => (
            <div key={key} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={STATUS_COLORS[item.status]}>
                    {STATUS_ICONS[item.status]}
                  </div>
                  <div>
                    <div className="font-medium text-gray-800">{item.name}</div>
                    <div className="text-sm text-gray-500">{item.message}</div>
                    {item.detail && (
                      <div className="text-xs text-gray-400 mt-1 font-mono bg-gray-50 p-2 rounded">
                        {item.detail}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderDirSelectStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">选择数据存储目录</h3>
        <p className="text-sm text-gray-500">
          所有考试数据（场次、学员、座位、日志等）将保存在此目录下。建议选择非系统盘的独立目录。
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">数据目录路径</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={state?.selectedDataDir || ''}
            onChange={(e) => {
              window.electronAPI?.wizardSetDataDir(e.target.value)
              checkDataDir(e.target.value)
              loadState()
            }}
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={selectDataDir}
            disabled={processing}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            浏览...
          </button>
        </div>
      </div>

      {dirCheckResult && (
        <div className={`p-4 rounded-lg border ${
          dirCheckResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={dirCheckResult.ok ? 'text-green-500' : 'text-red-500'}>
              {dirCheckResult.ok ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            </div>
            <div className="flex-1">
              <div className={`font-medium ${dirCheckResult.ok ? 'text-green-800' : 'text-red-800'}`}>
                {dirCheckResult.ok ? '目录可用' : '目录不可用'}
              </div>
              {dirCheckResult.error && (
                <div className="text-sm text-red-600">{dirCheckResult.error}</div>
              )}
              {dirCheckResult.hasExistingDb && (
                <div className="text-sm text-blue-600 mt-1 flex items-center gap-1">
                  <Database className="w-3.5 h-3.5" />
                  检测到现有数据库：{dirCheckResult.dbPath}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-2 flex items-center gap-2">
          <HardDrive className="w-4 h-4" /> 目录说明
        </h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li className="flex items-start gap-2">
            <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
            数据库文件 <code className="bg-blue-100 px-1 py-0.5 rounded">exam-manager.db</code> 将保存在此目录
          </li>
          <li className="flex items-start gap-2">
            <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
            配置文件和日志文件也将保存在此目录
          </li>
          <li className="flex items-start gap-2">
            <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
            请确保目录有足够的读写权限，并且不会被系统清理
          </li>
        </ul>
      </div>
    </div>
  )

  const renderDataHandleStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">数据处理</h3>
        <p className="text-sm text-gray-500">
          选择如何处理数据库。系统{oldDbPath ? '检测到旧数据库' : '未检测到现有数据库'}。
        </p>
      </div>

      {oldDbPath && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-yellow-800">检测到旧数据库</div>
              <div className="text-sm text-yellow-700 font-mono mt-1">{oldDbPath}</div>
              <div className="text-sm text-yellow-600 mt-1">
                您可以选择迁移旧数据到新目录，或初始化一个全新的数据库。
              </div>
            </div>
          </div>
        </div>
      )}

      {state?.dataHandleResult ? (
        <div className={`p-4 rounded-lg border ${
          state.dataHandleResult.status === 'success' ? 'bg-green-50 border-green-200' :
          state.dataHandleResult.status === 'error' ? 'bg-red-50 border-red-200' :
          'bg-blue-50 border-blue-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 ${
              state.dataHandleResult.status === 'success' ? 'text-green-500' :
              state.dataHandleResult.status === 'error' ? 'text-red-500' :
              'text-blue-500'
            }`}>
              {state.dataHandleResult.status === 'success' ? <CheckCircle2 className="w-5 h-5" /> :
               state.dataHandleResult.status === 'error' ? <XCircle className="w-5 h-5" /> :
               <Loader2 className="w-5 h-5 animate-spin" />}
            </div>
            <div className="flex-1">
              <div className={`font-medium ${
                state.dataHandleResult.status === 'success' ? 'text-green-800' :
                state.dataHandleResult.status === 'error' ? 'text-red-800' :
                'text-blue-800'
              }`}>
                {state.dataHandleResult.message}
              </div>
              {state.dataHandleResult.migratedTables && state.dataHandleResult.migratedTables.length > 0 && (
                <div className="text-sm text-green-600 mt-1">
                  已迁移表：{state.dataHandleResult.migratedTables.join(', ')}
                </div>
              )}
              {state.dataHandleResult.errorDetail && (
                <div className="text-sm text-red-600 mt-1 font-mono bg-red-100 p-2 rounded">
                  {state.dataHandleResult.errorDetail}
                </div>
              )}
              <div className="text-xs text-gray-500 mt-2">
                目标位置：<code>{state.dataHandleResult.targetDb}</code>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {oldDbPath && (
            <button
              onClick={() => handleDataAction('migrate')}
              disabled={processing}
              className="p-4 border-2 border-blue-200 rounded-xl text-left hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-50 group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Database className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-800 group-hover:text-blue-700">迁移旧数据</div>
                  <div className="text-sm text-gray-500 mt-1">
                    将检测到的旧数据库完整迁移到新目录，保留所有历史数据
                  </div>
                </div>
              </div>
            </button>
          )}

          {dirCheckResult?.hasExistingDb && (
            <button
              onClick={() => handleDataAction('use-existing')}
              disabled={processing}
              className="p-4 border-2 border-green-200 rounded-xl text-left hover:border-green-400 hover:bg-green-50 transition-all disabled:opacity-50 group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-green-100 text-green-600 flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-gray-800 group-hover:text-green-700">使用现有数据库</div>
                  <div className="text-sm text-gray-500 mt-1">
                    当前目录已存在数据库，直接使用该数据库
                  </div>
                </div>
              </div>
            </button>
          )}

          <button
            onClick={() => handleDataAction('init-new')}
            disabled={processing}
            className="p-4 border-2 border-gray-200 rounded-xl text-left hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50 group"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center group-hover:bg-gray-600 group-hover:text-white transition-colors">
                <FileJson className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-800 group-hover:text-gray-700">初始化新数据库</div>
                <div className="text-sm text-gray-500 mt-1">
                  创建一个全新的空数据库，适用于首次使用或清空数据
                </div>
                {dirCheckResult?.hasExistingDb && (
                  <div className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    注意：现有数据库将被备份后替换
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>
      )}

      {state?.dataHandleResult?.status === 'error' && (
        <button
          onClick={() => {
            setState({ ...state, dataHandleResult: null })
            setDataAction(null)
          }}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          ← 返回重新选择
        </button>
      )}
    </div>
  )

  const renderSessionRestoreStep = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">最近场次恢复</h3>
        <p className="text-sm text-gray-500">
          选择是否在启动后自动恢复到上次访问的场次。
        </p>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-600 mb-4">
          {state?.restoreSessionId ? (
            <>检测到上次访问的场次 ID：<span className="font-mono font-semibold">{state.restoreSessionId}</span></>
          ) : (
            <>未检测到最近访问的场次记录</>
          )}
        </div>

        <div className="space-y-3">
          <label className={`flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
            restoreOption === 'restore' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="restore"
              value="restore"
              checked={restoreOption === 'restore'}
              onChange={() => setRestoreOption('restore')}
              disabled={!state?.restoreSessionId}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-gray-800">恢复上次访问的场次</div>
              <div className="text-sm text-gray-500">
                启动后自动跳转到上次离开时正在处理的场次
              </div>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
            restoreOption === 'skip' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
          }`}>
            <input
              type="radio"
              name="restore"
              value="skip"
              checked={restoreOption === 'skip'}
              onChange={() => setRestoreOption('skip')}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-gray-800">不恢复，进入首页</div>
              <div className="text-sm text-gray-500">
                直接进入系统首页，手动选择需要处理的场次
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  )

  const renderCompleteStep = () => (
    <div className="text-center py-8 space-y-6">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full text-white mb-4">
        <CheckCircle2 className="w-10 h-10" />
      </div>
      <h2 className="text-2xl font-bold text-gray-800">配置完成！</h2>
      <p className="text-gray-600 max-w-md mx-auto">
        系统已完成所有必要的配置，可以开始使用培训考场管理系统了。
      </p>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-w-md mx-auto text-left">
        <h4 className="font-medium text-gray-700 mb-3">配置摘要</h4>
        <ul className="text-sm text-gray-600 space-y-2">
          <li className="flex items-center justify-between">
            <span className="text-gray-500">数据目录：</span>
            <span className="font-mono text-gray-800">{state?.selectedDataDir}</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-gray-500">数据处理：</span>
            <span className="text-gray-800">
              {state?.dataHandleResult?.action === 'migrate' ? '迁移旧数据' :
               state?.dataHandleResult?.action === 'init-new' ? '初始化新库' :
               state?.dataHandleResult?.action === 'use-existing' ? '使用现有库' : '未处理'}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-gray-500">服务端口：</span>
            <span className="font-mono text-gray-800">{state?.envCheckResult?.resolvedPort || 3001}</span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-gray-500">场次恢复：</span>
            <span className="text-gray-800">
              {restoreOption === 'restore' && state?.restoreSessionId ? '自动恢复' : '手动选择'}
            </span>
          </li>
        </ul>
      </div>

      <button
        onClick={completeWizard}
        disabled={processing}
        className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-medium hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg shadow-green-200 disabled:opacity-50"
      >
        {processing ? (
          <><Loader2 className="w-5 h-5 animate-spin" /> 正在启动系统...</>
        ) : (
          <>进入系统 <ArrowRight className="w-5 h-5" /></>
        )}
      </button>
    </div>
  )

  const renderCurrentStep = () => {
    if (!state) return null
    switch (state.currentStep) {
      case 'welcome': return renderWelcomeStep()
      case 'env-check': return renderEnvCheckStep()
      case 'dir-select': return renderDirSelectStep()
      case 'data-handle': return renderDataHandleStep()
      case 'session-restore': return renderSessionRestoreStep()
      case 'complete': return renderCompleteStep()
      default: return null
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>正在加载配置向导...</span>
        </div>
      </div>
    )
  }

  const steps: WizardStep[] = ['welcome', 'env-check', 'dir-select', 'data-handle', 'session-restore', 'complete']
  const currentIndex = steps.indexOf(state?.currentStep || 'welcome')

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-6 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Rocket className="w-8 h-8" />
                <div>
                  <h1 className="text-xl font-bold">系统配置向导</h1>
                  <p className="text-sm opacity-90">培训考场管理系统</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogs(!showLogs)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  title="查看日志"
                >
                  <Terminal className="w-5 h-5" />
                </button>
                <button
                  onClick={cancelWizard}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  title="取消向导"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="px-8 py-4 bg-gray-50 border-b">
            <div className="flex items-center justify-between">
              {steps.map((step, idx) => (
                <div key={step} className="flex items-center">
                  <div className={`flex items-center gap-2 ${
                    idx < currentIndex ? 'text-green-600' :
                    idx === currentIndex ? 'text-blue-600' : 'text-gray-400'
                  }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                      idx < currentIndex ? 'bg-green-100' :
                      idx === currentIndex ? 'bg-blue-100' : 'bg-gray-100'
                    }`}>
                      {idx < currentIndex ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span className="text-sm font-medium hidden md:inline">
                      {STEP_CONFIG[step].title}
                    </span>
                  </div>
                  {idx < steps.length - 1 && (
                    <div className={`w-8 md:w-12 h-0.5 mx-1 ${
                      idx < currentIndex ? 'bg-green-300' : 'bg-gray-200'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="p-8">
            {renderCurrentStep()}
          </div>

          {state?.currentStep !== 'complete' && (
            <div className="px-8 py-4 bg-gray-50 border-t flex items-center justify-between">
              <button
                onClick={() => goToStep(steps[Math.max(0, currentIndex - 1)])}
                disabled={currentIndex === 0 || processing}
                className="flex items-center gap-2 px-5 py-2.5 text-gray-600 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-4 h-4" />
                上一步
              </button>
              <button
                onClick={() => {
                  if (state?.currentStep === 'complete') {
                    completeWizard()
                  } else {
                    goToStep(steps[Math.min(steps.length - 1, currentIndex + 1)])
                  }
                }}
                disabled={!canProceed() || processing}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {state?.currentStep === 'session-restore' ? '完成配置' : '下一步'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {showLogs && state && (
          <div className="mt-6 bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="px-6 py-4 bg-gray-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                <span className="font-medium">操作日志</span>
                <span className="text-xs text-gray-400">({state.logs.length} 条)</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={exportLogs}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  <Download className="w-4 h-4" />
                  导出
                </button>
                <button
                  onClick={() => setShowLogs(false)}
                  className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-auto p-4 font-mono text-xs">
              {state.logs.length === 0 ? (
                <div className="text-gray-400 text-center py-4">暂无日志记录</div>
              ) : (
                state.logs.map((log, idx) => (
                  <div key={idx} className={`py-1 border-b border-gray-100 last:border-0 ${getLogColor(log.level)}`}>
                    <span className="text-gray-400">[{formatTime(log.timestamp)}]</span>{' '}
                    <span className="font-semibold">[{log.level.toUpperCase()}]</span>{' '}
                    <span className="text-gray-500">[{log.step}]</span>{' '}
                    <span>{log.message}</span>
                    {log.detail && (
                      <span className="block pl-4 text-gray-400 mt-0.5">{log.detail}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          如有问题，请联系技术支持
        </p>
      </div>
    </div>
  )
}

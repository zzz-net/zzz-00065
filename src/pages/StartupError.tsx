import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Settings, FolderOpen, Server } from 'lucide-react'

interface BackendError {
  code: string
  message: string
  detail?: string
}

const ERROR_GUIDES: Record<string, { icon: React.ReactNode; title: string; suggestions: string[] }> = {
  PORT_NOT_AVAILABLE: {
    icon: <Server className="w-12 h-12" />,
    title: '端口被占用',
    suggestions: [
      '关闭占用端口的其他程序，然后点击「重试启动」',
      '进入「系统设置」修改服务端口为其他可用端口',
    ],
  },
  DATA_DIR_NOT_WRITABLE: {
    icon: <FolderOpen className="w-12 h-12" />,
    title: '数据目录不可写',
    suggestions: [
      '检查数据目录的读写权限',
      '进入「系统设置」选择其他可用目录',
      '如果目录位于网盘或只读分区，请切换到本地可写目录',
    ],
  },
  DEPENDENCY_MISSING: {
    icon: <AlertTriangle className="w-12 h-12" />,
    title: '依赖缺失',
    suggestions: [
      '当前为开发模式，请执行 npm install 安装依赖',
      '如果是打包后的版本，请确认完整解压后再运行',
    ],
  },
  SERVER_TIMEOUT: {
    icon: <RefreshCw className="w-12 h-12" />,
    title: '服务启动超时',
    suggestions: [
      '点击「重试启动」再次尝试',
      '如果是首次启动，可能需要更长时间，请耐心等待',
    ],
  },
  SERVER_EXITED: {
    icon: <AlertTriangle className="w-12 h-12" />,
    title: '服务进程异常退出',
    suggestions: [
      '点击「重试启动」再次尝试',
      '查看下方日志详情，排查具体原因',
    ],
  },
}

export default function StartupError() {
  const [error, setError] = useState<BackendError | null>(null)
  const [status, setStatus] = useState<'checking' | 'error' | 'retrying'>('checking')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    checkStatus()
    const unsub = window.electronAPI?.onBackendError((e) => {
      setError(e)
      setStatus('error')
    })
    const unsubReady = window.electronAPI?.onBackendReady(() => {
      window.location.reload()
    })
    return () => {
      unsub?.()
      unsubReady?.()
    }
  }, [retryCount])

  const checkStatus = async () => {
    if (!window.electronAPI) {
      setError({ code: 'NOT_ELECTRON', message: '当前不是桌面模式运行' })
      setStatus('error')
      return
    }
    const s = await window.electronAPI.getBackendStatus()
    if (s.error) {
      setError(s.error)
      setStatus('error')
    } else if (!s.ready) {
      setTimeout(checkStatus, 1000)
    } else {
      window.location.reload()
    }
  }

  const handleRetry = async () => {
    if (!window.electronAPI) return
    setStatus('retrying')
    const r = await window.electronAPI.restartBackend()
    if (r.success) {
      setRetryCount((c) => c + 1)
    } else {
      setStatus('error')
    }
  }

  const guide = error ? ERROR_GUIDES[error.code] : null

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-red-500 to-orange-500 px-8 py-6 text-white">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-8 h-8" />
              <div>
                <h1 className="text-2xl font-bold">服务启动异常</h1>
                <p className="text-sm opacity-90 mt-1">考场管理系统后端服务未能正常启动</p>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            {status === 'checking' && (
              <div className="flex items-center gap-3 text-gray-600">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>正在检测后端服务状态...</span>
              </div>
            )}

            {error && (
              <>
                <div className="flex items-start gap-4 p-4 bg-red-50 rounded-lg border border-red-100">
                  <div className="text-red-500 shrink-0">
                    {guide?.icon || <AlertTriangle className="w-12 h-12" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-red-800 text-lg">
                      {guide?.title || '未知错误'}
                    </h2>
                    <p className="text-red-700 mt-1 font-medium">{error.message}</p>
                    {error.code && (
                      <p className="text-xs text-red-500 mt-1 font-mono">错误码: {error.code}</p>
                    )}
                  </div>
                </div>

                {guide && (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <h3 className="font-medium text-blue-900 mb-2">建议处理方式</h3>
                    <ul className="space-y-1.5">
                      {guide.suggestions.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-blue-800">
                          <span className="text-blue-500 font-bold mt-0.5">{i + 1}.</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {error.detail && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">详细日志</h3>
                    <pre className="p-3 bg-gray-900 text-gray-100 text-xs rounded-lg overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                      {error.detail}
                    </pre>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    onClick={handleRetry}
                    disabled={status === 'retrying'}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${status === 'retrying' ? 'animate-spin' : ''}`} />
                    {status === 'retrying' ? '正在重启...' : '重试启动'}
                  </button>
                  {window.electronAPI && (
                    <button
                      onClick={() => (window.location.hash = '#/settings')}
                      className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      系统设置
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          如果问题持续存在，请联系技术支持
        </p>
      </div>
    </div>
  )
}

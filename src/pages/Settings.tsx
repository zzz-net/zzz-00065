import { useEffect, useState } from 'react'
import { ArrowLeft, FolderOpen, Server, RefreshCw, Check, AlertCircle, Save } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, useOperatorStore } from '@/store/operator'

interface SystemInfo {
  dataDir: string
  dbPath: string
  dbSize: number
  dbModified: string | null
  counts: { sessions: number; students: number; rooms: number; auditLogs: number }
  env: { node: string; platform: string; electron: boolean }
}

export default function Settings() {
  const navigate = useNavigate()
  const isAdmin = useOperatorStore((s) => s.isAdmin())

  const [dataDir, setDataDir] = useState('')
  const [serverPort, setServerPort] = useState(3001)
  const [defaultDataDir, setDefaultDataDir] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [portCheck, setPortCheck] = useState<{ ok: boolean; text: string } | null>(null)
  const [dirCheck, setDirCheck] = useState<{ ok: boolean; text: string } | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [restarting, setRestarting] = useState(false)

  const loadConfig = async () => {
    if (!window.electronAPI) return
    const cfg = await window.electronAPI.getConfig()
    setDataDir(cfg.dataDir)
    setServerPort(cfg.serverPort)
    const def = await window.electronAPI.getDefaultDataDir()
    setDefaultDataDir(def)
  }

  const loadSystemInfo = () => {
    apiFetch<SystemInfo>('/api/system/info')
      .then((r) => r.data && setSystemInfo(r.data))
      .catch(() => {})
  }

  useEffect(() => {
    loadConfig()
    loadSystemInfo()
  }, [])

  const checkDir = async () => {
    if (!window.electronAPI || !dataDir) return
    setDirCheck(null)
    const r = await window.electronAPI.checkDirectoryWritable(dataDir)
    setDirCheck({
      ok: r.ok,
      text: r.ok ? '目录可写 ✓' : `目录不可写: ${r.error || '未知错误'}`,
    })
  }

  const checkPort = async () => {
    if (!window.electronAPI || !serverPort) return
    setPortCheck(null)
    const ok = await window.electronAPI.checkPortAvailable(serverPort)
    setPortCheck({
      ok,
      text: ok ? `端口 ${serverPort} 可用 ✓` : `端口 ${serverPort} 已被占用`,
    })
  }

  useEffect(() => {
    const t = setTimeout(checkDir, 300)
    return () => clearTimeout(t)
  }, [dataDir])

  useEffect(() => {
    const t = setTimeout(checkPort, 300)
    return () => clearTimeout(t)
  }, [serverPort])

  const selectDir = async () => {
    if (!window.electronAPI) return
    const r = await window.electronAPI.selectDirectory()
    if (!r.canceled && r.filePaths.length > 0) {
      setDataDir(r.filePaths[0])
    }
  }

  const openDir = async () => {
    if (!window.electronAPI || !dataDir) return
    await window.electronAPI.openDirectory(dataDir)
  }

  const useDefaultDir = () => {
    if (defaultDataDir) setDataDir(defaultDataDir)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      if (window.electronAPI) {
        const r = await window.electronAPI.setConfig({ dataDir, serverPort })
        if (!r.success) {
          setSaveMsg({ type: 'error', text: r.error || '保存失败' })
          setSaving(false)
          return
        }

        const rAny = r as any
        if (rAny.needWizard && rAny.wizardTrigger) {
          const confirmResult = await window.electronAPI.showMessageBox({
            type: 'question',
            title: '数据目录变更',
            message: `检测到${rAny.libraryState?.exists ? '该目录已有数据库' : '该目录为空'}，需要进入初始化向导。\n\n${rAny.wizardReason || ''}\n\n是否立即进入配置向导？`,
            buttons: ['取消', '进入向导'],
          })

          if (confirmResult.response === 1) {
            await window.electronAPI.wizardStart(rAny.wizardTrigger)
            await window.electronAPI.wizardSetDataDir(dataDir)
            window.location.reload()
            return
          } else {
            setSaveMsg({ type: 'success', text: '配置已保存。下次启动时将自动进入配置向导。' })
            setSaving(false)
            return
          }
        }
      }

      if (dataDir !== (systemInfo?.dataDir || '')) {
        try {
          const switchResult = await apiFetch('/api/system/data-directory/switch', {
            method: 'POST',
            body: JSON.stringify({ directory: dataDir }),
          })
          if (switchResult.success) {
            setSaveMsg({ type: 'success', text: '数据目录已切换，数据库连接已重新初始化。' })
            loadSystemInfo()
            setSaving(false)
            return
          }
        } catch (e: any) {
          setSaveMsg({ type: 'error', text: `后端切换目录失败: ${e.message || '未知错误'}。配置已保存，重启后生效。` })
          setSaving(false)
          return
        }
      }
      setSaveMsg({ type: 'success', text: '设置已保存。' })
      loadSystemInfo()
    } catch (e: any) {
      setSaveMsg({ type: 'error', text: e.message || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    if (!window.electronAPI) return
    setRestarting(true)
    setSaveMsg(null)
    try {
      const r = await window.electronAPI.restartBackend()
      if (r.success) {
        setSaveMsg({ type: 'success', text: '后端服务已重启，页面即将刷新...' })
        setTimeout(() => window.location.reload(), 2000)
      } else {
        const errDetail = r.error?.message || r.error?.detail || JSON.stringify(r.error)
        setSaveMsg({ type: 'error', text: `重启失败: ${errDetail}` })
      }
    } catch (e: any) {
      setSaveMsg({ type: 'error', text: e.message || '重启失败' })
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">系统设置</h1>
      </div>

      {saveMsg && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm flex items-start gap-2 ${
            saveMsg.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {saveMsg.type === 'success' ? <Check size={16} className="mt-0.5" /> : <AlertCircle size={16} className="mt-0.5" />}
          {saveMsg.text}
        </div>
      )}

      <div className="space-y-6 max-w-3xl">
        {systemInfo && (
          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <Server size={16} /> 系统状态
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: '场次', v: systemInfo.counts.sessions },
                { label: '学员', v: systemInfo.counts.students },
                { label: '考场', v: systemInfo.counts.rooms },
                { label: '审计日志', v: systemInfo.counts.auditLogs },
              ].map((s) => (
                <div key={s.label} className="bg-gray-50 rounded p-3 text-center">
                  <div className="text-xl font-bold text-gray-800">{s.v}</div>
                  <div className="text-xs text-gray-500">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500">
              <div>数据库路径: <span className="font-mono text-gray-700">{systemInfo.dbPath}</span></div>
              <div>数据库大小: <span className="text-gray-700">{(systemInfo.dbSize / 1024).toFixed(2)} KB</span></div>
              {systemInfo.dbModified && <div className="md:col-span-2">最后修改: <span className="text-gray-700">{systemInfo.dbModified}</span></div>}
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
            <FolderOpen size={16} /> 数据目录
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">数据库文件存储目录</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={dataDir}
                  onChange={(e) => setDataDir(e.target.value)}
                  disabled={!isAdmin}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                {isAdmin && (
                  <>
                    <button
                      onClick={selectDir}
                      className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
                    >
                      选择目录
                    </button>
                    <button
                      onClick={openDir}
                      className="px-3 py-2 bg-gray-100 text-gray-700 rounded-md text-sm hover:bg-gray-200"
                    >
                      打开
                    </button>
                  </>
                )}
              </div>
              {isAdmin && dataDir !== defaultDataDir && (
                <button onClick={useDefaultDir} className="text-xs text-blue-600 hover:underline mt-1">
                  恢复默认目录
                </button>
              )}
            </div>
            {dirCheck && (
              <div className={`text-sm flex items-center gap-1.5 ${dirCheck.ok ? 'text-green-600' : 'text-red-600'}`}>
                {dirCheck.ok ? <Check size={14} /> : <AlertCircle size={14} />}
                {dirCheck.text}
              </div>
            )}
            <p className="text-xs text-gray-500">
              切换目录后需重启后端服务，新目录才会生效。考试场次、学员名单、座位映射等所有数据都保存在该目录下的 SQLite 数据库文件中。
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
            <Server size={16} /> 服务端口
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">后端服务监听端口</label>
              <input
                type="number"
                min={1024}
                max={65535}
                value={serverPort}
                onChange={(e) => setServerPort(Number(e.target.value))}
                disabled={!isAdmin}
                className="w-40 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
            {portCheck && (
              <div className={`text-sm flex items-center gap-1.5 ${portCheck.ok ? 'text-green-600' : 'text-red-600'}`}>
                {portCheck.ok ? <Check size={14} /> : <AlertCircle size={14} />}
                {portCheck.text}
              </div>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? '保存中...' : '保存设置'}
            </button>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              <RefreshCw size={16} className={restarting ? 'animate-spin' : ''} />
              {restarting ? '重启中...' : '重启后端服务'}
            </button>
          </div>
        )}

        {!isAdmin && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
            <AlertCircle size={14} className="inline mr-1 mb-0.5" />
            仅管理员可修改系统设置。如需调整请联系管理员。
          </div>
        )}
      </div>
    </div>
  )
}

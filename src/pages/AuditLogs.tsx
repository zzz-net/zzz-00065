import { useEffect, useState } from 'react'
import { apiFetch } from '@/store/operator'
import { ScrollText, RefreshCw } from 'lucide-react'

interface AuditLog {
  id: number
  session_id: number
  operator_id: number
  action: string
  detail: string
  created_at: string
  operator_name: string
}

interface Session {
  id: number
  name: string
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionId, setSessionId] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchSessions = () => {
    apiFetch<Session[]>('/api/sessions')
      .then((res) => {
        if (res.data) setSessions(res.data)
      })
      .catch(() => {})
  }

  const fetchLogs = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (sessionId) params.set('sessionId', sessionId)
    params.set('limit', '100')
    apiFetch<AuditLog[]>(`/api/audit-logs?${params.toString()}`)
      .then((res) => {
        if (res.data) setLogs(res.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchSessions()
    fetchLogs()
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [sessionId])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ScrollText size={24} />
          <h1 className="text-xl font-bold">审计日志</h1>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="mb-4">
        <select
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">全部场次</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">场次ID</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">操作人</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">操作</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">详情</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">时间</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3">{log.id}</td>
                <td className="px-4 py-3">{log.session_id}</td>
                <td className="px-4 py-3">{log.operator_name}</td>
                <td className="px-4 py-3">{log.action}</td>
                <td className="px-4 py-3 max-w-xs truncate">{log.detail}</td>
                <td className="px-4 py-3">{log.created_at}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">暂无日志记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

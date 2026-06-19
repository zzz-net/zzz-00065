import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, useOperatorStore } from '@/store/operator'
import { Calendar, Users, Building2, ScrollText, Play, ChevronRight, Clock, Database, Settings } from 'lucide-react'

interface Session {
  id: number
  name: string
  exam_date: string
  start_time: string
  status: string
  room_name: string
  created_at: string
  seat_rows: number
  seat_cols: number
}

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-700' },
  seating: { label: '排座中', className: 'bg-yellow-100 text-yellow-700' },
  checkin: { label: '签到中', className: 'bg-blue-100 text-blue-700' },
  active: { label: '进行中', className: 'bg-green-100 text-green-700' },
  completed: { label: '已结束', className: 'bg-purple-100 text-purple-700' },
}

interface CountsData {
  sessions: number
  rooms: number
  students: number
  logs: number
}

export default function Home() {
  const navigate = useNavigate()
  const operator = useOperatorStore((s) => s.operator)

  const [recent, setRecent] = useState<Session[]>([])
  const [counts, setCounts] = useState<CountsData | null>(null)
  const [recentSessionId, setRecentSessionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
    loadRecentFromConfig()
  }, [])

  const loadData = async () => {
    Promise.all([
      apiFetch<Session[]>('/api/sessions'),
      apiFetch<any>('/api/system/info'),
    ]).then(([sRes, iRes]) => {
      if (sRes.data) setRecent(sRes.data.slice(0, 5))
      if (iRes.data) setCounts({
        sessions: iRes.data.counts.sessions,
        rooms: iRes.data.counts.rooms,
        students: iRes.data.counts.students,
        logs: iRes.data.counts.auditLogs,
      })
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  const loadRecentFromConfig = async () => {
    if (!window.electronAPI) return
    const cfg = await window.electronAPI.getConfig()
    setRecentSessionId(cfg.recentSessionId)
  }

  const openSession = async (id: number) => {
    if (window.electronAPI) {
      window.electronAPI.setRecentSession(id)
    }
    navigate(`/sessions/${id}`)
  }

  const quickActions = [
    { label: '考场管理', icon: Building2, path: '/rooms', color: 'from-blue-500 to-blue-600' },
    { label: '场次管理', icon: Calendar, path: '/sessions', color: 'from-indigo-500 to-indigo-600' },
    { label: '审计日志', icon: ScrollText, path: '/audit-logs', color: 'from-gray-500 to-gray-600' },
    { label: '系统设置', icon: Settings, path: '/settings', color: 'from-emerald-500 to-emerald-600' },
  ]

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">欢迎回来，{operator?.display_name || operator?.username}</h1>
            <p className="mt-1 text-blue-100 opacity-90 text-sm">
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>
          <Database size={40} className="opacity-50" />
        </div>
      </div>

      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '考试场次', value: counts.sessions, icon: Calendar, color: 'bg-blue-50 text-blue-600' },
            { label: '考场总数', value: counts.rooms, icon: Building2, color: 'bg-indigo-50 text-indigo-500' },
            { label: '学员总数', value: counts.students, icon: Users, color: 'bg-green-50 text-green-600' },
            { label: '操作日志', value: counts.logs, icon: ScrollText, color: 'bg-orange-50 text-orange-600' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-lg p-4 shadow">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-500">{s.label}</div>
                  <div className="text-2xl font-bold text-gray-800 mt-1">{s.value}</div>
                </div>
                <div className={`p-2 rounded-lg bg-gray-50 text-gray-500`}>
                  <s.icon size={24} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {quickActions.map((a) => (
          <button
            key={a.path}
            onClick={() => navigate(a.path)}
            className={`bg-gradient-to-br ${a.color} text-white p-4 rounded-lg shadow hover:shadow-md hover:scale-[1.02] transition-all text-left`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{a.label}</div>
                <div className="text-xs opacity-80 mt-0.5">立即进入</div>
              </div>
              <ChevronRight size={20} className="opacity-80" />
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Clock size={18} className="text-gray-500" />
            最近场次
          </h2>
          <button
            onClick={() => navigate('/sessions')}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            查看全部 →
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-8">加载中...</div>
        ) : recent.length === 0 ? (
          <div className="text-center py-10">
            <Calendar size={48} className="mx-auto mb-3 opacity-20" />
            <p className="text-gray-400 text-sm">暂无场次数据</p>
            <button
              onClick={() => navigate('/sessions')}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800"
            >
              去创建第一场考试 →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((s) => {
              const cfg = statusConfig[s.status] || statusConfig.draft
              const isRecentRecent = s.id === recentSessionId
              return (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={`w-full flex items-center gap-4 p-3 rounded-lg border hover:bg-gray-50 transition-colors text-left ${isRecentRecent ? 'border-blue-300 bg-blue-50/50' : 'border-gray-100'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800 truncate">{s.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.className}`}>
                        {cfg.label}
                      </span>
                      {isRecentRecent && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                          上次访问
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                      <span>{s.room_name}</span>
                      <span>{s.exam_date} {s.start_time}</span>
                      <span>{s.seat_rows}×{s.seat_cols} 座位</span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-gray-400 shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

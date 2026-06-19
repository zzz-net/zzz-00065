import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, ApiError } from '@/store/operator'
import { Plus, Eye, Trash2, AlertTriangle, ArrowRight } from 'lucide-react'

interface Session {
  id: number
  room_id: number
  name: string
  exam_date: string
  start_time: string
  status: string
  room_name: string
  seat_rows: number
  seat_cols: number
}

interface Room {
  id: number
  name: string
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

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [examDate, setExamDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [conflictInfo, setConflictInfo] = useState<any>(null)
  const navigate = useNavigate()

  const fetchSessions = () => {
    apiFetch<Session[]>('/api/sessions')
      .then((res) => {
        if (res.data) setSessions(res.data)
      })
      .catch(() => {})
  }

  const fetchRooms = () => {
    apiFetch<Room[]>('/api/rooms')
      .then((res) => {
        if (res.data) setRooms(res.data)
      })
      .catch(() => {})
  }

  useEffect(() => {
    fetchSessions()
    fetchRooms()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !roomId || !examDate || !startTime) return
    setSubmitting(true)
    setFormError('')
    setConflictInfo(null)
    try {
      await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ roomId: Number(roomId), name, examDate, startTime }),
      })
      setShowModal(false)
      setName('')
      setRoomId('')
      setExamDate('')
      setStartTime('')
      fetchSessions()
    } catch (err: any) {
      const apiErr = err as ApiError
      setFormError(apiErr.message || '创建失败')
      if (apiErr.status === 409 && apiErr.conflict) {
        setConflictInfo(apiErr.conflict)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除该场次？')) return
    try {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' })
      fetchSessions()
    } catch {}
  }

  const openSession = async (id: number) => {
    if (window.electronAPI) {
      try {
        const cfg = await window.electronAPI.getConfig()
        await window.electronAPI.setConfig({ ...cfg, recentSessionId: id })
      } catch {}
    }
    navigate(`/sessions/${id}`)
  }

  const goToExisting = () => {
    if (conflictInfo?.existingId) {
      setShowModal(false)
      openSession(conflictInfo.existingId)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">场次管理</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} />
          新增场次
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">名称</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">考场</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">考试日期</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">开始时间</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">状态</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const cfg = statusConfig[s.status] || statusConfig.draft
              return (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{s.id}</td>
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3">{s.room_name}</td>
                  <td className="px-4 py-3">{s.exam_date}</td>
                  <td className="px-4 py-3">{s.start_time}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.className}`}>
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openSession(s.id)}
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                      >
                        <Eye size={14} />
                        查看详情
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="flex items-center gap-1 text-red-600 hover:text-red-800 text-sm"
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无场次数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">新增场次</h2>
            {formError && (
              <div className={`mb-4 text-sm px-3 py-2.5 rounded font-medium ${conflictInfo ? 'bg-orange-50 text-orange-800 border border-orange-200' : 'bg-red-50 text-red-700'}`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div>{formError}</div>
                    {conflictInfo && (
                      <button
                        onClick={goToExisting}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-orange-700 hover:text-orange-900 underline"
                      >
                        跳转至已存在的场次 <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">考场</label>
                <select
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">-- 请选择 --</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}（{r.seat_rows}×{r.seat_cols} 座位）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">考试日期</label>
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">开始时间</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '提交中...' : '确认'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

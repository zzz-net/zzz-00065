import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiFetch, ApiError, useOperatorStore } from '@/store/operator'
import { ArrowLeft, Upload, Trash2, Undo2, AlertTriangle, Download, Save, AlertCircle, Play } from 'lucide-react'

interface Session {
  id: number; name: string; status: string; room_name: string
  seat_rows: number; seat_cols: number; exam_date: string; start_time: string
}
interface Student { id: number; reg_no: string; name: string; org: string }
interface Seat { id: number; student_id: number; seat_row: number; seat_col: number; reg_no: string; student_name: string; org: string }
interface SeatChange {
  id: number; student_id: number; from_row: number; from_col: number
  to_row: number; to_col: number; reason: string; operator_id: number
  operator_name: string; undone: boolean; undone_by: number | null; undone_at: string | null
}
interface Checkin { id: number; student_id: number; status: string; operator_id: number; checked_at: string; reg_no: string; student_name: string }
interface Anomaly {
  id: number; student_id: number | null; type: string; description: string
  status: string; reported_by: number; reporter_name: string
  closed_by: number | null; closer_name: string | null; close_reason: string | null
}

const STATUS_FLOW = ['draft', 'seating', 'checkin', 'active', 'completed']
const statusLabels: Record<string, string> = { draft: '草稿', seating: '排座中', checkin: '签到中', active: '进行中', completed: '已结束' }
const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', seating: 'bg-yellow-100 text-yellow-700', checkin: 'bg-blue-100 text-blue-700', active: 'bg-green-100 text-green-700', completed: 'bg-purple-100 text-purple-700' }
const anomalyTypeLabels: Record<string, string> = { absence: '缺勤', cheating: '作弊', device: '设备', other: '其他' }
const TABS = ['学员名单', '座位安排', '签到管理', '异常处理', '导出结果']

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isAdmin = useOperatorStore(s => s.isAdmin)
  const sessionId = id!

  const [session, setSession] = useState<Session | null>(null)
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [students, setStudents] = useState<Student[]>([])
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)

  const [seats, setSeats] = useState<Seat[]>([])
  const [seatChanges, setSeatChanges] = useState<SeatChange[]>([])
  const [showForce, setShowForce] = useState(false)
  const [forceForm, setForceForm] = useState({ studentId: '', toRow: 1, toCol: 1, reason: '' })
  const [forceLoading, setForceLoading] = useState(false)

  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [checkinLoading, setCheckinLoading] = useState(false)

  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [showReport, setShowReport] = useState(false)
  const [reportForm, setReportForm] = useState({ type: 'absence', studentId: '', description: '' })
  const [showClose, setShowClose] = useState(false)
  const [closeTarget, setCloseTarget] = useState<Anomaly | null>(null)
  const [closeReason, setCloseReason] = useState('')

  const [exportData, setExportData] = useState<any>(null)
  const [exportMsg, setExportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [exportSaving, setExportSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (window.electronAPI && sessionId) {
        try {
          const cfg = await window.electronAPI.getConfig()
          await window.electronAPI.setConfig({ ...cfg, recentSessionId: Number(sessionId) })
        } catch {}
      }
    })()
  }, [sessionId])

  const fetchSession = () => {
    apiFetch<Session>(`/api/sessions/${sessionId}`)
      .then(res => { if (res.data) setSession(res.data) })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }
  const fetchStudents = () => {
    apiFetch<Student[]>(`/api/sessions/${sessionId}/students`)
      .then(res => { if (res.data) setStudents(res.data) })
      .catch(() => {})
  }
  const fetchSeats = () => {
    apiFetch<Seat[]>(`/api/sessions/${sessionId}/seats`)
      .then(res => { if (res.data) setSeats(res.data) })
      .catch(() => {})
  }
  const fetchSeatChanges = () => {
    apiFetch<SeatChange[]>(`/api/sessions/${sessionId}/seats/changes`)
      .then(res => { if (res.data) setSeatChanges(res.data) })
      .catch(() => {})
  }
  const fetchCheckins = () => {
    apiFetch<Checkin[]>(`/api/sessions/${sessionId}/checkins`)
      .then(res => { if (res.data) setCheckins(res.data) })
      .catch(() => {})
  }
  const fetchAnomalies = () => {
    apiFetch<Anomaly[]>(`/api/sessions/${sessionId}/anomalies`)
      .then(res => { if (res.data) setAnomalies(res.data) })
      .catch(() => {})
  }
  const fetchExport = () => {
    apiFetch(`/api/sessions/${sessionId}/export`)
      .then(res => { if (res.data) setExportData(res.data) })
      .catch(() => {})
  }

  useEffect(() => { fetchSession(); fetchStudents() }, [sessionId])

  useEffect(() => {
    if (activeTab === 1) { fetchSeats(); fetchSeatChanges() }
    else if (activeTab === 2) { fetchCheckins(); fetchSeats() }
    else if (activeTab === 3) fetchAnomalies()
    else if (activeTab === 4) { fetchExport(); fetchCheckins(); fetchSeats(); fetchAnomalies() }
  }, [activeTab])

  const changeStatus = async (status: string) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      fetchSession()
    } catch (err: any) { setError(err.message) }
  }

  const handleImport = async () => {
    setImporting(true); setImportError('')
    try {
      const studentArr = importText.trim().split('\n').filter(l => l.trim()).map(l => {
        const parts = l.split(',').map(s => s.trim())
        return { regNo: parts[0], name: parts[1] || '', org: parts[2] || '' }
      }).filter(s => s.regNo && s.name)
      await apiFetch(`/api/sessions/${sessionId}/students/import`, {
        method: 'POST', body: JSON.stringify({ students: studentArr }),
      })
      setShowImport(false); setImportText(''); fetchStudents()
    } catch (err: any) {
      const apiErr = err as ApiError
      let msg = apiErr.message || '导入失败'
      if (apiErr.status === 409 && apiErr.conflict) {
        const c = apiErr.conflict
        const parts = []
        if (c.inBatch?.length) parts.push(`本批内重复 ${c.inBatch.length} 个`)
        if (c.inExisting?.length) parts.push(`与现有重复 ${c.inExisting.length} 个`)
        if (parts.length) msg += `（${parts.join('，')}）`
      }
      setImportError(msg)
    } finally { setImporting(false) }
  }

  const handleDeleteStudent = async (studentId: number) => {
    if (!confirm('确认删除该学员？')) return
    try { await apiFetch(`/api/sessions/${sessionId}/students/${studentId}`, { method: 'DELETE' }); fetchStudents() } catch {}
  }

  const handleAutoSeat = async () => {
    try { await apiFetch(`/api/sessions/${sessionId}/seats/auto`, { method: 'POST' }); fetchSeats() }
    catch (err: any) { setError(err.message) }
  }

  const handleForceChange = async () => {
    setForceLoading(true)
    try {
      await apiFetch(`/api/sessions/${sessionId}/seats/force-change`, {
        method: 'POST', body: JSON.stringify({ studentId: Number(forceForm.studentId), toRow: forceForm.toRow, toCol: forceForm.toCol, reason: forceForm.reason }),
      })
      setShowForce(false); setForceForm({ studentId: '', toRow: 1, toCol: 1, reason: '' }); fetchSeats(); fetchSeatChanges()
    } catch (err: any) { setError(err.message) } finally { setForceLoading(false) }
  }

  const handleUndoChange = async (changeId: number) => {
    try {
      await apiFetch(`/api/sessions/${sessionId}/seats/undo-change`, { method: 'POST', body: JSON.stringify({ changeId }) })
      fetchSeats(); fetchSeatChanges()
    } catch (err: any) { setError(err.message) }
  }

  const handleCheckin = async (studentId: number, status: string) => {
    setCheckinLoading(true)
    try {
      await apiFetch(`/api/sessions/${sessionId}/checkins`, { method: 'POST', body: JSON.stringify({ studentId, status }) })
      fetchCheckins()
    } catch (err: any) { setError(err.message) } finally { setCheckinLoading(false) }
  }

  const handleReportAnomaly = async () => {
    try {
      await apiFetch(`/api/sessions/${sessionId}/anomalies`, {
        method: 'POST', body: JSON.stringify({ type: reportForm.type, studentId: reportForm.studentId ? Number(reportForm.studentId) : undefined, description: reportForm.description }),
      })
      setShowReport(false); setReportForm({ type: 'absence', studentId: '', description: '' }); fetchAnomalies()
    } catch (err: any) { setError(err.message) }
  }

  const handleCloseAnomaly = async () => {
    if (!closeTarget) return
    try {
      await apiFetch(`/api/sessions/${sessionId}/anomalies/${closeTarget.id}/close`, { method: 'PATCH', body: JSON.stringify({ closeReason }) })
      setShowClose(false); setCloseTarget(null); setCloseReason(''); fetchAnomalies()
    } catch (err: any) { setError(err.message) }
  }

  const handleExportJson = async () => {
    setExportMsg(null)
    try {
      if (window.electronAPI) {
        const defaultName = session
          ? `session-${sessionId}-${session.name.replace(/[\\/:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`
          : `session-${sessionId}-export.json`
        const dlg = await window.electronAPI.showSaveDialog({
          title: '导出场次数据',
          defaultPath: defaultName,
          filters: [{ name: 'JSON 文件', extensions: ['json'] }],
        })
        if (dlg.canceled || !dlg.filePath) return

        setExportSaving(true)
        try {
          const r = await apiFetch(`/api/sessions/${sessionId}/export/save`, {
            method: 'POST',
            body: JSON.stringify({ filePath: dlg.filePath, overwrite: false }),
          })
          if (r.success) {
            const d = r.data as any
            setExportMsg({
              type: 'success',
              text: `导出成功：已保存 ${d.bytes} 字节到 ${d.filePath}（${d.studentsCount} 学员，${d.anomaliesCount} 异常记录）`,
            })
            fetchExport()
          }
        } catch (err: any) {
          const apiErr = err as ApiError
          if (apiErr.status === 409 && apiErr.conflict?.type === 'file_exists') {
            const c = apiErr.conflict
            const size = (c.fileSize / 1024).toFixed(2)
            const mb = await window.electronAPI.showMessageBox({
              type: 'warning',
              title: '文件已存在',
              message: `目标文件已存在，是否覆盖？\n\n文件: ${c.filePath}\n大小: ${size} KB\n修改时间: ${new Date(c.modifiedAt).toLocaleString()}`,
              buttons: ['取消', '覆盖保存'],
            })
            if (mb.response === 1) {
              const r2 = await apiFetch(`/api/sessions/${sessionId}/export/save`, {
                method: 'POST',
                body: JSON.stringify({ filePath: dlg.filePath, overwrite: true }),
              })
              if (r2.success) {
                const d = r2.data as any
                setExportMsg({
                  type: 'success',
                  text: `导出成功：已覆盖保存 ${d.bytes} 字节到 ${d.filePath}`,
                })
                fetchExport()
              }
            } else {
              setExportMsg({ type: 'error', text: '已取消：用户未选择覆盖' })
            }
          } else {
            setExportMsg({ type: 'error', text: apiErr.message || '导出失败' })
          }
        } finally {
          setExportSaving(false)
        }
      } else {
        const res = await apiFetch(`/api/sessions/${sessionId}/export`)
        if (res.data) {
          const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = `session-${sessionId}-export.json`; a.click()
          URL.revokeObjectURL(url)
        }
      }
    } catch (err: any) {
      setExportMsg({ type: 'error', text: err.message || '导出失败' })
    }
  }

  if (loading) return <div className="p-6 text-gray-500">加载中...</div>
  if (!session) return <div className="p-6 text-red-500">场次不存在</div>

  const currentIdx = STATUS_FLOW.indexOf(session.status)
  const seatMap = new Map<string, Seat>()
  seats.forEach(s => seatMap.set(`${s.seat_row}-${s.seat_col}`, s))
  const seatByStudent = new Map<number, Seat>()
  seats.forEach(s => seatByStudent.set(s.student_id, s))
  const checkedCount = checkins.filter(c => c.status === 'checked_in').length
  const absentCount = checkins.filter(c => c.status === 'absent').length
  const notCheckedCount = students.length - checkins.length

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/sessions')} className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></button>
        <h1 className="text-xl font-bold">{session.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[session.status] || ''}`}>{statusLabels[session.status]}</span>
        <span className="text-sm text-gray-500">{session.room_name} · {session.seat_rows}×{session.seat_cols}</span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {STATUS_FLOW.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${i < currentIdx ? 'bg-green-500 text-white' : i === currentIdx ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{i + 1}</div>
            <span className={`text-xs ${i === currentIdx ? 'font-bold text-blue-600' : 'text-gray-500'}`}>{statusLabels[s]}</span>
            {i < STATUS_FLOW.length - 1 && <div className="w-8 h-0.5 bg-gray-200" />}
          </div>
        ))}
      </div>

      {currentIdx < STATUS_FLOW.length - 1 && (
        <button onClick={() => changeStatus(STATUS_FLOW[currentIdx + 1])} className="mb-4 px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
          推进到「{statusLabels[STATUS_FLOW[currentIdx + 1]]}」
        </button>
      )}

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

      {window.electronAPI && (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-1.5">
              <Play size={14} /> 桌面端主流程快捷入口
            </h3>
            <span className="text-xs text-indigo-600 opacity-80">
              步骤 {Math.min(currentIdx + 1, STATUS_FLOW.length)} / {STATUS_FLOW.length}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: '1. 导入学员名单', tab: 0, enabled: true, icon: <Upload size={14} />, active: students.length === 0, done: students.length > 0 },
              { label: '2. 自动排座', tab: 1, enabled: students.length > 0, icon: <span className="text-sm font-bold">座</span>, active: seats.length === 0 && students.length > 0, done: seats.length > 0 },
              { label: '3. 强制换座/撤销', tab: 1, enabled: isAdmin() && seats.length > 0, icon: <Undo2 size={14} />, active: false, done: seatChanges.filter((c) => !c.undone).length > 0 },
              { label: '4. 签到/异常/导出', tab: activeTab >= 2 ? activeTab : 2, enabled: seats.length > 0, icon: <Download size={14} />, active: false, done: exportData != null },
            ].map((step, i) => (
              <button
                key={i}
                disabled={!step.enabled}
                onClick={() => setActiveTab(step.tab)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  step.done
                    ? 'bg-green-100 text-green-800 border border-green-200 hover:bg-green-200'
                    : step.active
                    ? 'bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-200 shadow-sm'
                    : step.enabled
                    ? 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                    : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  step.done ? 'bg-green-500 text-white' : step.active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {step.done ? '✓' : step.icon}
                </span>
                <span>{step.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex border-b mb-4">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)} className={`px-4 py-2 text-sm ${activeTab === i ? 'border-b-2 border-blue-500 text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>{tab}</button>
        ))}
      </div>

      {activeTab === 0 && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => { setShowImport(true); setImportError(''); setImportText('') }} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"><Upload size={14} /> 导入学员</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-4 py-2 text-left">ID</th><th className="px-4 py-2 text-left">报名号</th><th className="px-4 py-2 text-left">姓名</th><th className="px-4 py-2 text-left">单位</th><th className="px-4 py-2 text-left">操作</th>
            </tr></thead>
            <tbody>
              {students.map(s => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2">{s.id}</td><td className="px-4 py-2">{s.reg_no}</td><td className="px-4 py-2">{s.name}</td><td className="px-4 py-2">{s.org}</td>
                  <td className="px-4 py-2"><button onClick={() => handleDeleteStudent(s.id)} className="text-red-600 hover:text-red-800"><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {students.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">暂无学员</td></tr>}
            </tbody>
          </table>
          {showImport && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
                <h2 className="text-lg font-bold mb-4">导入学员</h2>
                {importError && <div className="mb-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded font-medium">{importError}</div>}
                <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="每行一条：报名号,姓名,单位" className="w-full border rounded-md px-3 py-2 text-sm h-40 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div className="mt-2 mb-4">
                  <button onClick={() => setImportText('A001,张三,测试单位\nA002,李四,测试单位2\nA003,王五,测试单位3')} className="text-xs text-blue-600 hover:underline">示例</button>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">取消</button>
                  <button onClick={handleImport} disabled={importing} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50">{importing ? '导入中...' : '确认导入'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 1 && (
        <div>
          <div className="flex gap-2 mb-4">
            <button onClick={handleAutoSeat} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700">自动排座</button>
            {isAdmin() ? (
              <button onClick={() => setShowForce(true)} className="bg-orange-500 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-600">强制换座</button>
            ) : (
              <span className="bg-gray-300 text-gray-500 px-3 py-1.5 rounded text-sm cursor-not-allowed" title="仅管理员可强制换座">强制换座</span>
            )}
          </div>
          <div className="mb-6 overflow-auto">
            {Array.from({ length: session.seat_rows }, (_, r) => (
              <div key={r} className="flex gap-1 mb-1">
                {Array.from({ length: session.seat_cols }, (_, c) => {
                  const seat = seatMap.get(`${r + 1}-${c + 1}`)
                  return (
                    <div key={c} className={`w-24 h-16 rounded border text-xs flex flex-col items-center justify-center ${seat ? 'bg-green-100 border-green-300' : 'bg-gray-100 border-gray-300'}`}>
                      <span className="font-medium">{r + 1},{c + 1}</span>
                      {seat ? <span className="truncate w-full text-center px-1">{seat.reg_no} {seat.student_name}</span> : <span className="text-gray-400">空座</span>}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <h3 className="text-sm font-bold mb-2">换座记录</h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-left">学生</th><th className="px-3 py-2 text-left">从座位</th><th className="px-3 py-2 text-left">到座位</th><th className="px-3 py-2 text-left">原因</th><th className="px-3 py-2 text-left">操作人</th><th className="px-3 py-2 text-left">状态</th><th className="px-3 py-2 text-left">操作</th>
            </tr></thead>
            <tbody>
              {seatChanges.map(ch => (
                <tr key={ch.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">{ch.id}</td>
                  <td className="px-3 py-2">{ch.student_id}</td>
                  <td className="px-3 py-2">{ch.from_row},{ch.from_col}</td>
                  <td className="px-3 py-2">{ch.to_row},{ch.to_col}</td>
                  <td className="px-3 py-2">{ch.reason}</td>
                  <td className="px-3 py-2">{ch.operator_name}</td>
                  <td className="px-3 py-2">{ch.undone ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">已撤销</span> : <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">生效中</span>}</td>
                  <td className="px-3 py-2">{!ch.undone && (isAdmin() ? <button onClick={() => handleUndoChange(ch.id)} className="text-orange-600 hover:text-orange-800 flex items-center gap-1"><Undo2 size={14} /> 撤销</button> : <span className="text-xs text-gray-400 cursor-not-allowed" title="仅管理员可撤销换座">撤销</span>)}</td>
                </tr>
              ))}
              {seatChanges.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">暂无换座记录</td></tr>}
            </tbody>
          </table>
          {showForce && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
                <h2 className="text-lg font-bold mb-4">强制换座</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">学员</label>
                    <select value={forceForm.studentId} onChange={e => setForceForm(f => ({ ...f, studentId: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm">
                      <option value="">-- 请选择 --</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.reg_no} - {s.name}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1"><label className="block text-sm font-medium mb-1">目标行</label><input type="number" min={1} value={forceForm.toRow} onChange={e => setForceForm(f => ({ ...f, toRow: Number(e.target.value) }))} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                    <div className="flex-1"><label className="block text-sm font-medium mb-1">目标列</label><input type="number" min={1} value={forceForm.toCol} onChange={e => setForceForm(f => ({ ...f, toCol: Number(e.target.value) }))} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                  </div>
                  <div><label className="block text-sm font-medium mb-1">原因</label><input type="text" value={forceForm.reason} onChange={e => setForceForm(f => ({ ...f, reason: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm" /></div>
                </div>
                <div className="flex justify-end gap-3 mt-4">
                  <button onClick={() => setShowForce(false)} className="px-4 py-2 text-sm text-gray-600">取消</button>
                  <button onClick={handleForceChange} disabled={forceLoading} className="px-4 py-2 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600 disabled:opacity-50">{forceLoading ? '提交中...' : '确认换座'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 2 && (
        <div>
          <div className="flex gap-4 mb-4 text-sm">
            <span>总学员: <strong>{students.length}</strong></span>
            <span className="text-green-600">已签到: <strong>{checkedCount}</strong></span>
            <span className="text-red-600">缺勤: <strong>{absentCount}</strong></span>
            <span className="text-gray-500">未签到: <strong>{notCheckedCount}</strong></span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-4 py-2 text-left">报名号</th><th className="px-4 py-2 text-left">姓名</th><th className="px-4 py-2 text-left">座位</th><th className="px-4 py-2 text-left">签到状态</th><th className="px-4 py-2 text-left">操作</th>
            </tr></thead>
            <tbody>
              {students.map(s => {
                const ci = checkins.find(c => c.student_id === s.id)
                const seat = seatByStudent.get(s.id)
                return (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">{s.reg_no}</td>
                    <td className="px-4 py-2">{s.name}</td>
                    <td className="px-4 py-2">{seat ? `${seat.seat_row},${seat.seat_col}` : '-'}</td>
                    <td className="px-4 py-2">
                      {!ci ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">未签到</span>
                        : ci.status === 'checked_in' ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">已签到</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">缺勤</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button onClick={() => handleCheckin(s.id, 'checked_in')} disabled={checkinLoading} className="text-xs text-green-600 hover:text-green-800">签到</button>
                        <button onClick={() => handleCheckin(s.id, 'absent')} disabled={checkinLoading} className="text-xs text-red-600 hover:text-red-800">缺勤</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {students.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">暂无学员</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 3 && (
        <div>
          <div className="flex justify-end mb-3">
            <button onClick={() => setShowReport(true)} className="flex items-center gap-1 bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700"><AlertTriangle size={14} /> 报告异常</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left">ID</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">学生</th><th className="px-3 py-2 text-left">描述</th><th className="px-3 py-2 text-left">状态</th><th className="px-3 py-2 text-left">报告人</th><th className="px-3 py-2 text-left">关闭信息</th><th className="px-3 py-2 text-left">操作</th>
            </tr></thead>
            <tbody>
              {anomalies.map(a => (
                <tr key={a.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">{a.id}</td>
                  <td className="px-3 py-2">{anomalyTypeLabels[a.type] || a.type}</td>
                  <td className="px-3 py-2">{a.student_id || '-'}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{a.description}</td>
                  <td className="px-3 py-2">{a.status === 'open' ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">待处理</span> : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">已关闭</span>}</td>
                  <td className="px-3 py-2">{a.reporter_name}</td>
                  <td className="px-3 py-2">{a.status === 'closed' ? `${a.closer_name || ''}: ${a.close_reason || ''}` : '-'}</td>
                  <td className="px-3 py-2">
                    {a.status === 'open' && (
                      isAdmin() ? <button onClick={() => { setCloseTarget(a); setShowClose(true) }} className="text-xs text-blue-600 hover:text-blue-800">关闭</button>
                        : <span className="text-xs text-gray-400 cursor-not-allowed" title="仅管理员可关闭异常">关闭</span>
                    )}
                  </td>
                </tr>
              ))}
              {anomalies.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">暂无异常记录</td></tr>}
            </tbody>
          </table>
          {showReport && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
                <h2 className="text-lg font-bold mb-4">报告异常</h2>
                <div className="space-y-3">
                  <div><label className="block text-sm font-medium mb-1">类型</label><select value={reportForm.type} onChange={e => setReportForm(f => ({ ...f, type: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm"><option value="absence">缺勤</option><option value="cheating">作弊</option><option value="device">设备</option><option value="other">其他</option></select></div>
                  <div><label className="block text-sm font-medium mb-1">学生（可选）</label><select value={reportForm.studentId} onChange={e => setReportForm(f => ({ ...f, studentId: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm"><option value="">-- 无 --</option>{students.map(s => <option key={s.id} value={s.id}>{s.reg_no} - {s.name}</option>)}</select></div>
                  <div><label className="block text-sm font-medium mb-1">描述</label><textarea value={reportForm.description} onChange={e => setReportForm(f => ({ ...f, description: e.target.value }))} className="w-full border rounded-md px-3 py-2 text-sm h-24" /></div>
                </div>
                <div className="flex justify-end gap-3 mt-4">
                  <button onClick={() => setShowReport(false)} className="px-4 py-2 text-sm text-gray-600">取消</button>
                  <button onClick={handleReportAnomaly} className="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700">提交</button>
                </div>
              </div>
            </div>
          )}
          {showClose && closeTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
                <h2 className="text-lg font-bold mb-4">关闭异常</h2>
                <div><label className="block text-sm font-medium mb-1">关闭原因</label><textarea value={closeReason} onChange={e => setCloseReason(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm h-24" /></div>
                <div className="flex justify-end gap-3 mt-4">
                  <button onClick={() => { setShowClose(false); setCloseTarget(null) }} className="px-4 py-2 text-sm text-gray-600">取消</button>
                  <button onClick={handleCloseAnomaly} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">确认关闭</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 4 && (
        <div>
          {exportMsg && (
            <div className={`mb-4 p-3 rounded-lg text-sm flex items-start gap-2 ${
              exportMsg.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200'
                                            : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {exportMsg.type === 'success' ? <Save size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
              <span className="flex-1">{exportMsg.text}</span>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <h3 className="font-bold text-blue-900 mb-2 text-sm">桌面端导出说明</h3>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• 点击下方按钮可选择导出路径和文件名</li>
              <li>• 导出的 JSON 文件包含：场次信息、考场配置、学员名单（含座位和签到状态）、异常记录</li>
              <li>• 如果目标文件已存在，系统会提示是否覆盖，不会悄悄覆盖已有文件</li>
              <li>• 每次导出操作都会写入审计日志，便于追溯</li>
            </ul>
          </div>
          <div className="flex gap-3 mb-4">
            <button onClick={handleExportJson} disabled={exportSaving} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
              <Save size={14} /> {exportSaving ? '保存中...' : (window.electronAPI ? '导出到文件...' : '导出JSON')}
            </button>
            {window.electronAPI && exportData?.session && (
              <button onClick={handleExportJson} className="flex items-center gap-1 bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-200">
                <Download size={14} /> 重新下载
              </button>
            )}
          </div>
          {exportData ? (
            <>
              <div className="grid grid-cols-5 gap-3 mb-4">
                <div className="bg-gray-50 rounded p-3 text-center"><div className="text-lg font-bold">{exportData.students?.length ?? 0}</div><div className="text-xs text-gray-500">总学员</div></div>
                <div className="bg-green-50 rounded p-3 text-center"><div className="text-lg font-bold text-green-600">{seats.filter(s => s.student_id).length}</div><div className="text-xs text-gray-500">已排座</div></div>
                <div className="bg-blue-50 rounded p-3 text-center"><div className="text-lg font-bold text-blue-600">{checkedCount}</div><div className="text-xs text-gray-500">已签到</div></div>
                <div className="bg-red-50 rounded p-3 text-center"><div className="text-lg font-bold text-red-600">{absentCount}</div><div className="text-xs text-gray-500">缺勤</div></div>
                <div className="bg-orange-50 rounded p-3 text-center"><div className="text-lg font-bold text-orange-600">{anomalies.length}</div><div className="text-xs text-gray-500">异常</div></div>
              </div>
              <pre className="bg-gray-50 rounded p-4 text-xs overflow-auto max-h-96">{JSON.stringify(exportData, null, 2)}</pre>
            </>
          ) : <p className="text-sm text-gray-400">加载中...</p>}
        </div>
      )}
    </div>
  )
}

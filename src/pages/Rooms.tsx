import { useState, useEffect } from 'react'
import { apiFetch } from '@/store/operator'
import { Plus, Pencil, Trash2 } from 'lucide-react'

interface Room {
  id: number
  name: string
  seat_rows: number
  seat_cols: number
  created_at: string
}

export default function Rooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState('')
  const [formRows, setFormRows] = useState(1)
  const [formCols, setFormCols] = useState(1)

  const fetchRooms = () => {
    apiFetch<Room[]>('/api/rooms')
      .then((res) => {
        if (res.data) setRooms(res.data)
      })
      .catch((err) => setError(err.message || '获取考场列表失败'))
  }

  useEffect(() => {
    fetchRooms()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setFormName('')
    setFormRows(1)
    setFormCols(1)
    setShowModal(true)
  }

  const openEdit = (room: Room) => {
    setEditingId(room.id)
    setFormName(room.name)
    setFormRows(room.seat_rows)
    setFormCols(room.seat_cols)
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      if (editingId) {
        await apiFetch(`/api/rooms/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({ name: formName, seatRows: formRows, seatCols: formCols }),
        })
      } else {
        await apiFetch('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({ name: formName, seatRows: formRows, seatCols: formCols }),
        })
      }
      setShowModal(false)
      fetchRooms()
    } catch (err: any) {
      setError(err.message || '操作失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定删除该考场吗？')) return
    setError('')
    try {
      await apiFetch(`/api/rooms/${id}`, { method: 'DELETE' })
      fetchRooms()
    } catch (err: any) {
      setError(err.message || '删除失败')
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">考场管理</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm"
        >
          <Plus size={16} />
          新增考场
        </button>
      </div>

      {error && <div className="mb-4 text-sm text-red-500">{error}</div>}

      {rooms.length === 0 ? (
        <p className="text-sm text-gray-500">暂无考场数据</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 px-3">ID</th>
              <th className="py-2 px-3">名称</th>
              <th className="py-2 px-3">行数</th>
              <th className="py-2 px-3">列数</th>
              <th className="py-2 px-3">总座位数</th>
              <th className="py-2 px-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room, idx) => (
              <tr key={room.id} className={`border-b ${idx % 2 === 1 ? 'bg-gray-50' : ''}`}>
                <td className="py-2 px-3">{room.id}</td>
                <td className="py-2 px-3">{room.name}</td>
                <td className="py-2 px-3">{room.seat_rows}</td>
                <td className="py-2 px-3">{room.seat_cols}</td>
                <td className="py-2 px-3">{room.seat_rows * room.seat_cols}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(room)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(room.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">{editingId ? '编辑考场' : '新增考场'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">行数</label>
                <input
                  type="number"
                  min={1}
                  value={formRows}
                  onChange={(e) => setFormRows(Number(e.target.value))}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">列数</label>
                <input
                  type="number"
                  min={1}
                  value={formCols}
                  onChange={(e) => setFormCols(Number(e.target.value))}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm"
                >
                  {editingId ? '保存' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

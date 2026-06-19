import { useEffect, useState } from 'react'
import { apiFetch, useOperatorStore } from '@/store/operator'
import { Plus, UserCog } from 'lucide-react'

interface Operator {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator'
  created_at: string
}

const roleConfig: Record<string, { label: string; className: string }> = {
  admin: { label: '管理员', className: 'bg-blue-100 text-blue-700' },
  operator: { label: '操作员', className: 'bg-gray-100 text-gray-700' },
}

export default function Operators() {
  const isAdmin = useOperatorStore((s) => s.isAdmin())
  const [operators, setOperators] = useState<Operator[]>([])
  const [showModal, setShowModal] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'operator'>('operator')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const fetchOperators = () => {
    apiFetch<Operator[]>('/api/operators')
      .then((res) => {
        if (res.data) setOperators(res.data)
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (isAdmin) fetchOperators()
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500 text-sm">仅管理员可访问此页面</p>
      </div>
    )
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !displayName) return
    setSubmitting(true)
    setError('')
    try {
      await apiFetch('/api/operators', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, role }),
      })
      setShowModal(false)
      setUsername('')
      setDisplayName('')
      setRole('operator')
      fetchOperators()
    } catch (err: any) {
      if (err.message?.includes('409')) {
        setError('用户名已存在')
      } else {
        setError(err.message || '创建失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <UserCog size={24} />
          <h1 className="text-xl font-bold">操作员管理</h1>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} />
          新增操作员
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">用户名</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">显示名</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">角色</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {operators.map((op) => {
              const cfg = roleConfig[op.role] || roleConfig.operator
              return (
                <tr key={op.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{op.id}</td>
                  <td className="px-4 py-3">{op.username}</td>
                  <td className="px-4 py-3">{op.display_name}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.className}`}>
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">—</td>
                </tr>
              )
            })}
            {operators.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">暂无操作员数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">新增操作员</h2>
            {error && <div className="mb-4 text-sm text-red-500">{error}</div>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">显示名</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'operator')}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="operator">操作员</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setError('')
                  }}
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

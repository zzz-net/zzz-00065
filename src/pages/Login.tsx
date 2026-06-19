import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOperatorStore, apiFetch } from '@/store/operator'
import { LogIn } from 'lucide-react'

interface Operator {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator'
}

export default function Login() {
  const [operators, setOperators] = useState<Operator[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    apiFetch<Operator[]>('/api/operators')
      .then((res) => {
        if (res.data) setOperators(res.data)
      })
      .catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) {
      setError('请选择操作员')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch<Operator>('/api/operators/login', {
        method: 'POST',
        body: JSON.stringify({ username: selected }),
      })
      if (res.data) {
        useOperatorStore.getState().setOperator(res.data)
        navigate('/')
      }
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-center mb-6">培训考场管理系统</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">选择操作员</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- 请选择 --</option>
              {operators.map((op) => (
                <option key={op.id} value={op.username}>
                  {op.display_name}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            <LogIn size={16} />
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

import { create } from 'zustand'

interface Operator {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator'
}

interface OperatorStore {
  operator: Operator | null
  setOperator: (op: Operator | null) => void
  isAdmin: () => boolean
}

export const useOperatorStore = create<OperatorStore>((set, get) => ({
  operator: null,
  setOperator: (op) => set({ operator: op }),
  isAdmin: () => get().operator?.role === 'admin',
}))

export async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
  const operatorId = useOperatorStore.getState().operator?.id
  const headers: any = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
  }
  if (operatorId) {
    headers['X-Operator-Id'] = String(operatorId)
  }
  const res = await fetch(url, { ...options, headers })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error || `请求失败: ${res.status}`)
  }
  return json
}

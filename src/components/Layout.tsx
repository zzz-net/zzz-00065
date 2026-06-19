import { NavLink, Outlet } from 'react-router-dom'
import { Building2, Calendar, ScrollText, Users, LogOut } from 'lucide-react'
import { useOperatorStore } from '@/store/operator'

const navItems = [
  { to: '/rooms', label: '考场管理', icon: Building2 },
  { to: '/sessions', label: '场次管理', icon: Calendar },
  { to: '/audit-logs', label: '审计日志', icon: ScrollText },
  { to: '/operators', label: '操作员管理', icon: Users },
]

export default function Layout() {
  const operator = useOperatorStore((s) => s.operator)

  const handleLogout = () => {
    useOperatorStore.getState().setOperator(null)
  }

  return (
    <div className="flex h-screen">
      <aside className="hidden lg:flex flex-col w-[200px] bg-gray-800 text-white shrink-0">
        <div className="h-14 flex items-center justify-center text-lg font-bold border-b border-gray-700">
          考试管理系统
        </div>
        <nav className="flex-1 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  isActive ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center justify-between px-6 bg-white border-b shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{operator?.display_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${operator?.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {operator?.role === 'admin' ? '管理员' : '操作员'}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </header>

        <main className="flex-1 overflow-auto bg-gray-50 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

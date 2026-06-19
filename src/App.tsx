import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useOperatorStore } from '@/store/operator'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Rooms from '@/pages/Rooms'
import Sessions from '@/pages/Sessions'
import SessionDetail from '@/pages/SessionDetail'
import AuditLogs from '@/pages/AuditLogs'
import Operators from '@/pages/Operators'
import Settings from '@/pages/Settings'
import StartupError from '@/pages/StartupError'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const operator = useOperatorStore((s) => s.operator)
  if (!operator) return <Navigate to="/login" replace />
  return <>{children}</>
}

function StartupGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [hasError, setHasError] = useState(false)
  const loc = useLocation()

  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI
    const params = new URLSearchParams(window.location.search)
    if (params.get('startup_error') === '1' || loc.pathname === '/startup-error') {
      setHasError(true)
      setChecking(false)
      return
    }
    if (!isElectron) {
      setChecking(false)
      return
    }
    window.electronAPI!.getBackendStatus().then((s) => {
      if (s.error) {
        setHasError(true)
      }
      setChecking(false)
    }).catch(() => setChecking(false))
    const unsub = window.electronAPI!.onBackendError(() => setHasError(true))
    const unsubReady = window.electronAPI!.onBackendReady(() => {
      setHasError(false)
    })
    return () => { unsub(); unsubReady() }
  }, [])

  if (hasError) return <StartupError />
  if (checking) return <div className="flex items-center justify-center h-screen text-gray-400">正在启动服务...</div>
  return <>{children}</>
}

export default function App() {
  return (
    <Router>
      <StartupGate>
        <Routes>
          <Route path="/startup-error" element={<StartupError />} />
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Home />} />
            <Route path="rooms" element={<Rooms />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="sessions/:id" element={<SessionDetail />} />
            <Route path="audit-logs" element={<AuditLogs />} />
            <Route path="operators" element={<Operators />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </StartupGate>
    </Router>
  )
}

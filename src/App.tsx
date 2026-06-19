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
import StartupWizard from '@/pages/StartupWizard'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const operator = useOperatorStore((s) => s.operator)
  if (!operator) return <Navigate to="/login" replace />
  return <>{children}</>
}

function StartupGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
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

    const checkStatus = async () => {
      try {
        const wizardState = await window.electronAPI!.wizardGetState()
        if (wizardState.active) {
          setShowWizard(true)
          setChecking(false)
          return
        }

        const needWizard = await window.electronAPI!.wizardCheckNeed()
        if (needWizard.need) {
          await window.electronAPI!.wizardStart(needWizard.trigger)
          setShowWizard(true)
          setChecking(false)
          return
        }

        const s = await window.electronAPI!.getBackendStatus()
        if (s.error) {
          setHasError(true)
        }
      } catch (e) {
        console.warn('Startup check failed:', e)
      }
      setChecking(false)
    }

    checkStatus()

    const unsub = window.electronAPI!.onBackendError(() => setHasError(true))
    const unsubReady = window.electronAPI!.onBackendReady(() => {
      setHasError(false)
    })

    const checkWizardInterval = setInterval(async () => {
      try {
        const wizardState = await window.electronAPI!.wizardGetState()
        if (wizardState.active && !showWizard) {
          setShowWizard(true)
        } else if (!wizardState.active && showWizard) {
          setShowWizard(false)
          window.location.reload()
        }
      } catch {}
    }, 1000)

    return () => {
      unsub()
      unsubReady()
      clearInterval(checkWizardInterval)
    }
  }, [showWizard])

  if (showWizard) return <StartupWizard />
  if (hasError) return <StartupError />
  if (checking) return <div className="flex items-center justify-center h-screen text-gray-400">正在启动服务...</div>
  return <>{children}</>
}

export default function App() {
  return (
    <Router>
      <StartupGate>
        <Routes>
          <Route path="/startup-wizard" element={<StartupWizard />} />
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

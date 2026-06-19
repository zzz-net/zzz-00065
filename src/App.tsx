import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useOperatorStore } from '@/store/operator'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Rooms from '@/pages/Rooms'
import Sessions from '@/pages/Sessions'
import SessionDetail from '@/pages/SessionDetail'
import AuditLogs from '@/pages/AuditLogs'
import Operators from '@/pages/Operators'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const operator = useOperatorStore((s) => s.operator)
  if (!operator) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/sessions" replace />} />
          <Route path="rooms" element={<Rooms />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="operators" element={<Operators />} />
        </Route>
      </Routes>
    </Router>
  )
}

import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/store'
import api from './lib/api'
import Layout         from './components/Layout'
import Login          from './pages/Login'
import Register       from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword  from './pages/ResetPassword'
import Dashboard      from './pages/Dashboard'
import Devices        from './pages/Devices'
import Playlists      from './pages/Playlists'
import Content        from './pages/Content'
import Schedules      from './pages/Schedules'
import Users          from './pages/Users'
import Settings       from './pages/Settings'
import KioskSetup     from './pages/KioskSetup'
import Player         from './pages/Player'
import Grids          from './pages/Grids'
import PrivacyPolicy  from './pages/PrivacyPolicy'
import Guide          from './pages/Guide'
import Widgets        from './pages/Widgets'
import System         from './pages/System'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-base" />
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function RoleRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-base" />
  if (!user) return <Navigate to="/login" replace />
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

export default function App() {
  const { setUser, setLoading } = useAuth()

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setLoading(false); return }
    api.get('/auth/me')
      .then(({ data }) => { setUser(data); setLoading(false) })
      .catch(() => { localStorage.clear(); setLoading(false) })
  }, [setUser, setLoading])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"           element={<Login />} />
        <Route path="/register"        element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/player"          element={<Player />} />
        <Route path="/privacy"         element={<PrivacyPolicy />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"   element={<Dashboard />} />
          <Route path="devices"     element={<Devices />} />
          <Route path="playlists"   element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN', 'CONTENT_CREATOR']}><Playlists /></RoleRoute>} />
          <Route path="content"     element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN', 'CONTENT_CREATOR']}><Content /></RoleRoute>} />
          <Route path="schedules"   element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN']}><Schedules /></RoleRoute>} />
          <Route path="widgets"     element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN', 'CONTENT_CREATOR']}><Widgets /></RoleRoute>} />
          <Route path="users"       element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN']}><Users /></RoleRoute>} />
          <Route path="settings"    element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN']}><Settings /></RoleRoute>} />
          <Route path="grids"       element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN']}><Grids /></RoleRoute>} />
          <Route path="kiosk-setup" element={<RoleRoute allowedRoles={['SUPER_ADMIN', 'TEAM_ADMIN']}><KioskSetup /></RoleRoute>} />
          <Route path="guide"       element={<Guide />} />
          <Route path="system"      element={<RoleRoute allowedRoles={['SUPER_ADMIN']}><System /></RoleRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

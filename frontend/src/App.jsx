import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './components/ColorMode'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { NotificationProvider } from './components/Notifications'
import { DirectoryProvider } from './components/Directory'
import { Loading } from './components/common'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import UsersPage from './pages/UsersPage'
import TeamsPage from './pages/TeamsPage'
import TeamDetailPage from './pages/TeamDetailPage'
import MilestoneTemplatesPage from './pages/MilestoneTemplatesPage'
import ReportsPage from './pages/ReportsPage'
import TimeEntriesPage from './pages/TimeEntriesPage'
import AuditPage from './pages/AuditPage'
import ProfilePage from './pages/ProfilePage'
import EmployeeHomePage from './pages/EmployeeHomePage'
import CalendarPage from './pages/CalendarPage'

/** Single-page app: React Router swaps screens in the browser; the server always serves index.html. */
function AppRoutes() {
  const { user, status } = useAuth()

  if (status === 'checking') return <Loading label="Restoring your session…" />
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  if (user.must_change_password) {
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    )
  }
  if (user.role === 'employee') {
    return (
      <DirectoryProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<EmployeeHomePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/time-entries" element={<TimeEntriesPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </DirectoryProvider>
    )
  }
  return (
    <DirectoryProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamDetailPage />} />
          <Route path="/milestone-templates" element={<MilestoneTemplatesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/time-entries" element={<TimeEntriesPage />} />
          {user.role === 'admin' && <Route path="/audit" element={<AuditPage />} />}
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DirectoryProvider>
  )
}

export default function App() {
  return (
    <ColorModeProvider>
      <NotificationProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
    </ColorModeProvider>
  )
}

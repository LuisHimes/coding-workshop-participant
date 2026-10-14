import { Suspense, lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './components/ColorMode'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { NotificationProvider } from './components/Notifications'
import { DirectoryProvider } from './components/Directory'
import { Loading } from './components/common'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
// Each screen downloads the first time it's opened; the login page is part of the first download
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const TeamsPage = lazy(() => import('./pages/TeamsPage'))
const TeamDetailPage = lazy(() => import('./pages/TeamDetailPage'))
const MilestoneTemplatesPage = lazy(() => import('./pages/MilestoneTemplatesPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const TimeEntriesPage = lazy(() => import('./pages/TimeEntriesPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const EmployeeHomePage = lazy(() => import('./pages/EmployeeHomePage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))

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
            <Suspense fallback={<Loading />}>
              <AppRoutes />
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
    </ColorModeProvider>
  )
}

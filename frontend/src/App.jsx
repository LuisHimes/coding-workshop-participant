import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './components/ColorMode'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { NotificationProvider } from './components/Notifications'
import { DirectoryProvider } from './components/Directory'
import { Loading } from './components/common'
import Layout from './components/Layout'
import { prefetchWhenIdle } from './utils/prefetch'
import LoginPage from './pages/LoginPage'

// Each screen is its own download; the login page is part of the first one. Once the page is idle, the
// rest are fetched in the background (most likely next screens first), so opening them is instant.
const PAGES = {
  DashboardPage: () => import('./pages/DashboardPage'),
  EmployeeHomePage: () => import('./pages/EmployeeHomePage'),
  ProjectsPage: () => import('./pages/ProjectsPage'),
  ProjectDetailPage: () => import('./pages/ProjectDetailPage'),
  CalendarPage: () => import('./pages/CalendarPage'),
  TimeEntriesPage: () => import('./pages/TimeEntriesPage'),
  ReportsPage: () => import('./pages/ReportsPage'),
  UsersPage: () => import('./pages/UsersPage'),
  TeamsPage: () => import('./pages/TeamsPage'),
  TeamDetailPage: () => import('./pages/TeamDetailPage'),
  MilestoneTemplatesPage: () => import('./pages/MilestoneTemplatesPage'),
  ProfilePage: () => import('./pages/ProfilePage'),
  AuditPage: () => import('./pages/AuditPage'),
  ChangePasswordPage: () => import('./pages/ChangePasswordPage'),
}
const DashboardPage = lazy(PAGES.DashboardPage)
const EmployeeHomePage = lazy(PAGES.EmployeeHomePage)
const ProjectsPage = lazy(PAGES.ProjectsPage)
const ProjectDetailPage = lazy(PAGES.ProjectDetailPage)
const CalendarPage = lazy(PAGES.CalendarPage)
const TimeEntriesPage = lazy(PAGES.TimeEntriesPage)
const ReportsPage = lazy(PAGES.ReportsPage)
const UsersPage = lazy(PAGES.UsersPage)
const TeamsPage = lazy(PAGES.TeamsPage)
const TeamDetailPage = lazy(PAGES.TeamDetailPage)
const MilestoneTemplatesPage = lazy(PAGES.MilestoneTemplatesPage)
const ProfilePage = lazy(PAGES.ProfilePage)
const AuditPage = lazy(PAGES.AuditPage)
const ChangePasswordPage = lazy(PAGES.ChangePasswordPage)

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
  useEffect(() => { prefetchWhenIdle(Object.values(PAGES)) }, [])

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

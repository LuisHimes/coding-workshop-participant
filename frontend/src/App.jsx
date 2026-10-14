/** Root component: app-wide providers, lazy-loaded screens and the routes for each role. */

import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ColorModeProvider } from './context/ColorModeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationsContext'
import { DirectoryProvider } from './context/DirectoryContext'
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

/**
 * Picks the routes for whoever is logged in. Logged-out visitors only reach
 * the login page; users with a temporary password only reach "Choose a new
 * password". Employees get their home page, projects, calendar, hours and
 * profile; managers and admins also get users, teams, templates and reports,
 * and admins the audit log. React Router swaps screens in the browser; the
 * server always serves index.html.
 */
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

/** The whole app: theme, notifications and login state around the routes. Starts prefetching the other screens. */
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

import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  AppBar, Avatar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu,
  MenuItem, Toolbar, Typography,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import FolderIcon from '@mui/icons-material/Folder'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import PeopleIcon from '@mui/icons-material/People'
import GroupsIcon from '@mui/icons-material/Groups'
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline'
import AssessmentIcon from '@mui/icons-material/Assessment'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import HistoryIcon from '@mui/icons-material/History'
import { useAuth } from '../auth/AuthContext'
import { ColorModeButton } from './ColorMode'
import { ROLE_LABELS } from '../utils/format'

const DRAWER_WIDTH = 232

const ADMIN_NAV = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/projects', label: 'Projects', icon: <FolderIcon /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarMonthIcon /> },
  { to: '/users', label: 'Users', icon: <PeopleIcon /> },
  { to: '/teams', label: 'Teams', icon: <GroupsIcon /> },
  { to: '/milestone-templates', label: 'Milestone templates', icon: <ViewTimelineIcon /> },
  { to: '/reports', label: 'Reports', icon: <AssessmentIcon /> },
  { to: '/time-entries', label: 'Hours', icon: <AccessTimeIcon /> },
  { to: '/audit', label: 'Audit log', icon: <HistoryIcon /> },
]

// Managers see their own projects, team and reports; the audit log is admin-only
const MANAGER_NAV = ADMIN_NAV.filter((item) => item.to !== '/audit').map((item) =>
  item.to === '/users' ? { ...item, label: 'Employees' } : item)
// Employees see their own work: home (with the message board), their projects and calendar, and their hours
const EMPLOYEE_NAV = [
  { ...ADMIN_NAV[0], label: 'Home' },
  { to: '/projects', label: 'My projects', icon: <FolderIcon /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarMonthIcon /> },
  { to: '/time-entries', label: 'My hours', icon: <AccessTimeIcon /> },
]
const NAV_BY_ROLE = { admin: ADMIN_NAV, manager: MANAGER_NAV, employee: EMPLOYEE_NAV }

function Navigation({ items }) {
  return (
    <List component="nav" sx={{ px: 1 }}>
      {items.map((item) => (
        <ListItemButton
          key={item.to}
          component={NavLink}
          to={item.to}
          end={item.end}
          sx={{
            borderRadius: 1.5,
            mb: 0.5,
            '&.active': { bgcolor: 'primary.main', color: 'primary.contrastText', '& .MuiListItemIcon-root': { color: 'inherit' } },
          }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
          <ListItemText primary={item.label} />
        </ListItemButton>
      ))}
    </List>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuAnchor, setMenuAnchor] = useState(null)
  const items = NAV_BY_ROLE[user.role]

  const drawer = (
    <>
      <Toolbar>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Project Tracker</Typography>
      </Toolbar>
      <Divider />
      <Box sx={{ pt: 1 }}>
        <Navigation items={items} />
      </Box>
    </>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', ml: `${DRAWER_WIDTH}px`, width: `calc(100% - ${DRAWER_WIDTH}px)` }}
      >
        <Toolbar>
          <Box sx={{ flex: 1 }} />
          <ColorModeButton />
          <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="Account menu">
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
              {user.first_name[0]}{user.last_name[0]}
            </Avatar>
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{user.first_name} {user.last_name}</Typography>
              <Typography variant="caption" color="text.secondary">{user.id} · {ROLE_LABELS[user.role]}</Typography>
            </Box>
            <Divider />
            <MenuItem onClick={() => { setMenuAnchor(null); navigate('/profile') }}>Your profile</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); logout() }}>Log out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: DRAWER_WIDTH, flexShrink: 0 }}>
        <Drawer variant="permanent" open sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}>
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flex: 1, minWidth: 0, px: 3, pb: 6 }}>
        <Toolbar />
        <Box sx={{ maxWidth: 1280, mx: 'auto', pt: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}

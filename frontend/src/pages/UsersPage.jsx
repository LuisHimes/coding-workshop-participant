/** Users screen (/users), shown as "Employees" to managers. */

import { useState } from 'react'
import {
  Alert, Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
  InputAdornment, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { users as usersApi } from '../api/endpoints'
import { useAuth, useRole } from '../context/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDebounced } from '../hooks/useDebounced'
import { useDirectory } from '../context/DirectoryContext'
import { useNotify } from '../context/NotificationsContext'
import FormDialog from '../components/FormDialog'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading, PageHeader, RoleChip, UserPicker } from '../components/common'
import { ROLE_LABELS, fullName, money } from '../utils/format'

const EMPTY_USER = { role: 'employee', first_name: '', last_name: '', email: '', job_title: '', salary: '', manager_id: null, temporary_password: '' }

/** A read-only text field with a copy-to-clipboard button. */
function CopyValue({ label, value }) {
  const notify = useNotify()
  return (
    <TextField
      label={label}
      value={value}
      slotProps={{
        htmlInput: { readOnly: true, style: { fontFamily: 'monospace', letterSpacing: '0.05em' } },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title="Copy">
                <IconButton edge="end" onClick={() => navigator.clipboard?.writeText(value).then(() => notify(`${label} copied`), () => {})}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}

/** Shows a user's email and temporary password once (after creating them or resetting their password), so the admin can pass them on. */
function CredentialsDialog({ credentials, title, onClose }) {
  return (
    <Dialog open={Boolean(credentials)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {credentials && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              Give these to {fullName(credentials.user)}. They log in with their email and will be asked to choose a
              permanent password.
            </Typography>
            <CopyValue label="Email" value={credentials.user.email} />
            <CopyValue label="Temporary password" value={credentials.temporary_password} />
            <Typography variant="caption" color="text.secondary">User ID {credentials.user.id}, for reference</Typography>
            <Alert severity="warning">The temporary password isn't shown again. Reset it if it's lost.</Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions><Button variant="contained" onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  )
}

/**
 * The fields of the new and edit user forms. Employees also need a salary and a manager;
 * `creating` adds the optional temporary password.
 */
function UserFields({ form, setForm, managers, creating }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const isEmployee = form.role === 'employee'
  return (
    <>
      <TextField id="user-role" select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required>
        {Object.entries(ROLE_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>
      <Stack direction="row" spacing={2}>
        <TextField id="user-first-name" label="First name" value={form.first_name} onChange={set('first_name')} required />
        <TextField id="user-last-name" label="Last name" value={form.last_name} onChange={set('last_name')} required />
      </Stack>
      <TextField id="user-email" label="Email" type="email" value={form.email} onChange={set('email')} required />
      <Stack direction="row" spacing={2}>
        <TextField id="user-job-title" label="Job title" value={form.job_title} onChange={set('job_title')} required />
        <TextField id="user-salary" label="Annual salary (USD)" type="number" value={form.salary} onChange={set('salary')}
          required={isEmployee} helperText={isEmployee ? 'Required for employees' : 'Optional'} slotProps={{ htmlInput: { min: 0, step: '0.01' } }} />
      </Stack>
      {isEmployee && (
        <UserPicker label="Manager" options={managers} value={form.manager_id} required
          helperText="Every employee reports to one manager" onChange={(id) => setForm({ ...form, manager_id: id })} />
      )}
      {creating && (
        <TextField id="user-temp-password" label="Temporary password" value={form.temporary_password} onChange={set('temporary_password')}
          helperText="Leave empty to generate one. At least 8 characters." autoComplete="off" />
      )}
    </>
  )
}

/** The form as an API request body: trimmed text, no salary as null, and a manager only for employees. */
function userRequestBody(form) {
  return {
    role: form.role,
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim(),
    job_title: form.job_title.trim(),
    salary: form.salary === '' ? null : form.salary,
    manager_id: form.role === 'employee' ? form.manager_id : null,
  }
}

/**
 * Users list with search and filters. Admins ("Users") see everyone, including deactivated users, and
 * click a row to edit, deactivate or reset a password; managers ("Employees") get a read-only list
 * for staffing projects and teams.
 */
export default function UsersPage() {
  const { user: me } = useAuth()
  const { isAdmin } = useRole()
  const directory = useDirectory()
  const notify = useNotify()
  const [searchText, setSearchText] = useState('')
  const [role, setRole] = useState('')
  const [managerId, setManagerId] = useState(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const search = useDebounced(searchText.trim())
  const { data, error, loading, reload } = useApiData(
    () => usersApi.list({ q: search || undefined, role: role || undefined, manager_id: managerId || undefined, include_inactive: includeInactive }),
    [search, role, managerId, includeInactive],
  )
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_USER)
  const [credentials, setCredentials] = useState(null)
  const [resetting, setResetting] = useState(null)

  const managers = directory.users.filter((u) => u.role === 'manager' && u.is_active)
  // The directory holds user names, so it refreshes too
  const refreshUsers = () => { reload(); directory.refresh() }
  const employeeIncomplete = form.role === 'employee' && (!form.manager_id || form.salary === '')

  return (
    <>
      <PageHeader
        title={isAdmin ? 'Users' : 'Employees'}
        subtitle={isAdmin
          ? "Admins, managers and employees. Deactivated users can't log in."
          : 'Every employee, to staff your projects and teams. Admins add and edit users.'}
        actions={isAdmin && <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm(EMPTY_USER); setCreating(true) }}>New user</Button>}
      />
      <Card>
        <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center' }}>
          <TextField id="user-search" placeholder="Search by name, email or ID" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ maxWidth: 320 }} />
          <TextField id="user-role-filter" select label="Role" value={role} onChange={(e) => setRole(e.target.value)} sx={{ maxWidth: 160 }}
            slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
            <MenuItem value="">Any role</MenuItem>
            {Object.entries(ROLE_LABELS).filter(([value]) => isAdmin || value !== 'admin')
              .map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <Box sx={{ width: 260 }}>
            <UserPicker label="Reports to" options={managers} value={managerId} onChange={setManagerId} />
          </Box>
          {isAdmin && <FormControlLabel control={<Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />}
            label="Show deactivated" sx={{ whiteSpace: 'nowrap' }} />}
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.length === 0 ? (
          <EmptyState title="No users match">Change the filters, or add a user.</EmptyState>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>User ID</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Job title</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell align="right">Salary</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.map((u) => (
                  <TableRow key={u.id} hover={isAdmin} sx={{ cursor: isAdmin ? 'pointer' : 'default', opacity: u.is_active ? 1 : 0.6 }}
                    onClick={() => {
                      if (!isAdmin) return
                      setForm({ ...EMPTY_USER, ...u, salary: u.salary ?? '', is_active: u.is_active })
                      setEditing(u)
                    }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{fullName(u)}</Typography>
                      <Typography variant="caption" color="text.secondary">{u.email}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{u.id}</TableCell>
                    <TableCell><RoleChip role={u.role} /></TableCell>
                    <TableCell>{u.job_title}</TableCell>
                    <TableCell>
                      {/* Managers can't look up other managers; their names stay hidden */}
                      {!u.manager_id ? '—' : directory.user(u.manager_id) ? directory.userName(u.manager_id) : 'Another manager'}
                    </TableCell>
                    <TableCell align="right">{money(u.salary)}</TableCell>
                    <TableCell>
                      {!u.is_active ? 'Deactivated (can\'t log in)' : u.must_change_password ? 'Hasn\'t logged in yet' : 'Active'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <FormDialog open={creating} title="New user" submitLabel="Create user" onClose={() => setCreating(false)} disabled={employeeIncomplete}
        onSubmit={async () => {
          const created = await usersApi.create({ ...userRequestBody(form), temporary_password: form.temporary_password || null })
          refreshUsers()
          setCredentials(created)
        }}>
        <Typography variant="body2" color="text.secondary">They'll log in with this email. The system generates a 6-character user ID for reference.</Typography>
        <UserFields form={form} setForm={setForm} managers={managers} creating />
      </FormDialog>

      <FormDialog open={Boolean(editing)} title={editing ? `${fullName(editing)} (${editing.id})` : ''} submitLabel="Save changes"
        onClose={() => setEditing(null)} disabled={employeeIncomplete}
        onSubmit={async () => {
          await usersApi.update(editing.id, { ...userRequestBody(form), is_active: form.is_active })
          notify('User saved')
          refreshUsers()
        }}>
        <UserFields form={form} setForm={setForm} managers={managers.filter((m) => m.id !== editing?.id)} />
        <FormControlLabel
          control={<Switch checked={Boolean(form.is_active)} disabled={editing?.id === me.id}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
          label={form.is_active ? 'Active: can log in' : 'Deactivated: can\'t log in'}
        />
        {editing?.id === me.id && <Typography variant="caption" color="text.secondary">You can't deactivate yourself or remove your own admin role.</Typography>}
        <Box>
          <Button color="warning" onClick={() => { setResetting(editing); setEditing(null) }}>Reset password</Button>
        </Box>
      </FormDialog>

      <ConfirmDialog open={Boolean(resetting)} title="Reset password?" confirmLabel="Reset password"
        message={resetting && `${fullName(resetting)} gets a new temporary password and must choose a permanent one at their next login.`}
        onClose={() => setResetting(null)}
        onConfirm={async () => { const result = await usersApi.resetPassword(resetting.id); setCredentials(result); refreshUsers() }} />

      <CredentialsDialog credentials={credentials} title="Login details" onClose={() => setCredentials(null)} />
    </>
  )
}

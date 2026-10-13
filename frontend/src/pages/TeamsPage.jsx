import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Card, InputAdornment, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { teams as teamsApi } from '../api/endpoints'
import { useAuth, useRole } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDebounced } from '../hooks/useDebounced'
import { useDirectory } from '../components/Directory'
import { useNotify } from '../components/Notifications'
import FormDialog from '../components/FormDialog'
import { EmptyState, ErrorAlert, Loading, PageHeader, UserPicker } from '../components/common'
import { dateTime } from '../utils/format'

export default function TeamsPage() {
  const navigate = useNavigate()
  const directory = useDirectory()
  const notify = useNotify()
  const { user } = useAuth()
  const { isAdmin } = useRole()
  const [q, setQ] = useState('')
  const [managerId, setManagerId] = useState(null)
  const search = useDebounced(q.trim())
  const { data, error, loading, reload } = useApiData(
    () => teamsApi.list({ q: search || undefined, manager_id: managerId || undefined }),
    [search, managerId],
  )
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', manager_id: null })
  const managers = directory.users.filter((u) => u.role === 'manager' && u.is_active)

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle={isAdmin
          ? "Groups of a manager's direct reports, used to staff projects in one step."
          : 'Groups of your direct reports, to staff your projects in one step.'}
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setForm({ name: '', description: '', manager_id: null }); setCreating(true) }}>New team</Button>}
      />
      <Card>
        <Stack direction="row" spacing={2} sx={{ p: 2 }}>
          <TextField id="team-search" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ maxWidth: 320 }} />
          {isAdmin && (
            <Box sx={{ width: 280 }}>
              <UserPicker label="Manager" options={managers} value={managerId} onChange={setManagerId} />
            </Box>
          )}
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.length === 0 ? (
          <EmptyState title="No teams yet">Create a team for a manager, then add their direct reports.</EmptyState>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Team</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell align="right">Members</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.map((team) => (
                  <TableRow key={team.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/teams/${team.id}`)}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{team.name}</Typography>
                      {team.description && <Typography variant="caption" color="text.secondary">{team.description}</Typography>}
                    </TableCell>
                    <TableCell>{directory.userName(team.manager_id)}</TableCell>
                    <TableCell align="right">{team.member_count}</TableCell>
                    <TableCell>{dateTime(team.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <FormDialog open={creating} title="New team" submitLabel="Create team" onClose={() => setCreating(false)} disabled={isAdmin && !form.manager_id}
        onSubmit={async () => {
          // Managers' teams are always their own; admins choose the manager
          const team = await teamsApi.create({
            name: form.name.trim(), description: form.description.trim() || null, manager_id: isAdmin ? form.manager_id : user.id,
          })
          notify('Team created')
          navigate(`/teams/${team.id}`)
        }}>
        <TextField id="new-team-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextField id="new-team-description" label="Description" value={form.description} multiline minRows={2}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {isAdmin ? (
          <UserPicker label="Manager" options={managers} value={form.manager_id} required
            helperText="Only this manager's direct reports can join" onChange={(id) => setForm({ ...form, manager_id: id })} />
        ) : (
          <Typography variant="body2" color="text.secondary">Your direct reports can join this team.</Typography>
        )}
      </FormDialog>
    </>
  )
}

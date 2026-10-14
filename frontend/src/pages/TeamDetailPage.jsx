import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import {
  Box, Button, Card, CardContent, IconButton, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import { teams as teamsApi } from '../api/endpoints'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../components/Directory'
import { useNotify } from '../components/Notifications'
import FormDialog from '../components/FormDialog'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading, PageHeader, UserPicker } from '../components/common'
import { dateTime } from '../utils/format'

export default function TeamDetailPage() {
  const { teamId } = useParams()
  const id = Number(teamId)
  const navigate = useNavigate()
  const directory = useDirectory()
  const notify = useNotify()
  const team = useApiData(() => teamsApi.get(id), [id])
  const members = useApiData(() => teamsApi.members.list(id), [id])
  const [newMember, setNewMember] = useState(null)
  const [addError, setAddError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [deleting, setDeleting] = useState(false)
  const [removing, setRemoving] = useState(null)

  const back = <Link component={RouterLink} to="/teams" underline="hover" variant="body2">← Teams</Link>
  if (team.loading && !team.data) return <Loading />
  if (team.error && !team.data) return (<><PageHeader title="Team" back={back} /><ErrorAlert error={team.error} onRetry={team.reload} /></>)

  const t = team.data
  const memberIds = new Set((members.data || []).map((m) => m.user_id))
  const directReports = directory.users.filter((u) => u.role === 'employee' && u.is_active && u.manager_id === t.manager_id && !memberIds.has(u.id))
  const changed = () => { team.reload(); members.reload() }

  const add = async () => {
    setAddError(null)
    try {
      await teamsApi.members.add(id, newMember)
      setNewMember(null)
      notify('Added to the team')
      changed()
    } catch (err) {
      setAddError(err)
    }
  }

  return (
    <>
      <PageHeader
        back={back}
        title={t.name}
        subtitle={`Managed by ${directory.userName(t.manager_id)}${t.description ? ` · ${t.description}` : ''}`}
        actions={
          <>
            <Button variant="outlined" startIcon={<EditIcon />} onClick={() => { setForm({ name: t.name, description: t.description ?? '' }); setEditing(true) }}>Edit</Button>
            <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleting(true)}>Delete</Button>
          </>
        }
      />
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Members · {t.member_count}</Typography>
          <ErrorAlert error={addError} />
          <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1, maxWidth: 420 }}>
              <UserPicker label={`Add one of ${directory.userName(t.manager_id)}'s direct reports`} options={directReports}
                value={newMember} onChange={setNewMember}
                helperText={directReports.length === 0 ? 'Everyone who reports to this manager is already on the team' : ' '} />
            </Box>
            <Button variant="contained" disabled={!newMember} onClick={add}>Add</Button>
          </Stack>
          <ErrorAlert error={members.error} onRetry={members.reload} />
          {members.loading && !members.data ? <Loading /> : members.data?.length === 0 ? (
            <EmptyState title="No members yet" />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Job title</TableCell>
                    <TableCell>Added</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {members.data?.map((m) => (
                    <TableRow key={m.user_id} sx={{ opacity: m.is_active ? 1 : 0.6 }}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.first_name} {m.last_name}</Typography>
                        <Typography variant="caption" color="text.secondary">ID {m.user_id}{!m.is_active && ' · deactivated'}</Typography>
                      </TableCell>
                      <TableCell>{m.job_title}</TableCell>
                      <TableCell>{dateTime(m.added_at)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Remove from team"><IconButton size="small" onClick={() => setRemoving(m)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <FormDialog open={editing} title="Edit team" onClose={() => setEditing(false)}
        onSubmit={async () => { await teamsApi.update(id, { name: form.name.trim(), description: form.description.trim() || null }); notify('Team saved'); changed() }}>
        <TextField id="team-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextField id="team-description" label="Description" value={form.description} multiline minRows={2}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </FormDialog>

      <ConfirmDialog open={deleting} title="Delete this team?" confirmLabel="Delete team" destructive
        message="The team is removed. Its members stay on any projects the team was used to staff."
        onClose={() => setDeleting(false)}
        onConfirm={async () => { await teamsApi.remove(id); notify('Team deleted'); navigate('/teams') }} />

      <ConfirmDialog open={Boolean(removing)} title="Remove from team?" confirmLabel="Remove" destructive
        message={removing && `${removing.first_name} ${removing.last_name} leaves the team but stays on their projects.`}
        onClose={() => setRemoving(null)}
        onConfirm={async () => { await teamsApi.members.remove(id, removing.user_id); notify('Removed from the team'); changed() }} />
    </>
  )
}

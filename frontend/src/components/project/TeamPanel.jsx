/** Project page "Team" tab: project members and their planned hours. */

import { useState } from 'react'
import {
  Alert, Box, Button, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import GroupsIcon from '@mui/icons-material/Groups'
import { projects as projectsApi, teams as teamsApi } from '../../api/endpoints'
import { useApiData } from '../../hooks/useApiData'
import { useDirectory } from '../../context/DirectoryContext'
import { useNotify } from '../../context/NotificationsContext'
import FormDialog from '../FormDialog'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading, UserPicker } from '../common'
import { dateTime, fullName } from '../../utils/format'

/** The notification after adding or changing someone: their planned hours across all projects, as a warning above 40 h/week. */
function allocationMessage(name, member) {
  const total = Number(member.employee_hours_per_week)
  return member.over_limit
    ? [`${name} is now planned for ${total} h/week across their projects, which is overtime (more than 40 h a week).`, 'warning']
    : [`${name} is planned for ${total} h/week across their projects.`, 'success']
}

/**
 * Who works on the project and their planned weekly hours. Managers and admins
 * can add employees one by one or a whole team, change hours and remove people;
 * `readOnly` (employees, archived projects) hides those actions.
 */
export default function TeamPanel({ project, readOnly }) {
  const directory = useDirectory()
  const notify = useNotify()
  const { data: members, error, loading, reload } = useApiData(() => projectsApi.members.list(project.id), [project.id])
  const [addingEmployee, setAddingEmployee] = useState(false)
  const [addingTeam, setAddingTeam] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [newMember, setNewMember] = useState({ user_id: null, hours: '40' })
  const [editedHours, setEditedHours] = useState('')
  const [teamForm, setTeamForm] = useState({ team_id: '', hours: '40' })
  const teamList = useApiData(() => (addingTeam ? teamsApi.list({}) : Promise.resolve([])), [addingTeam])

  const memberIds = new Set((members || []).map((m) => m.user_id))
  const candidates = directory.users.filter((u) => u.role === 'employee' && u.is_active && !memberIds.has(u.id))

  return (
    <Box>
      {!readOnly && (
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setNewMember({ user_id: null, hours: '40' }); setAddingEmployee(true) }}>
            Add employee
          </Button>
          <Button variant="outlined" startIcon={<GroupsIcon />} onClick={() => { setTeamForm({ team_id: '', hours: '40' }); setAddingTeam(true) }}>
            Add a team
          </Button>
        </Stack>
      )}
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !members ? (
        <Loading />
      ) : members?.length === 0 ? (
        <EmptyState title="Nobody on this project yet">{readOnly ? null : 'Add employees one at a time, or a whole team.'}</EmptyState>
      ) : (
        <TableContainer>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Planned hours are how many hours a week each person is expected to spend on this project. Above 40 hours a week across
            all their projects is overtime.
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Job title</TableCell>
                <TableCell align="right">Planned hours</TableCell>
                <TableCell>Added</TableCell>
                {!readOnly && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {members?.map((member) => {
                const user = directory.user(member.user_id)
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{directory.userName(member.user_id)}</Typography>
                      <Typography variant="caption" color="text.secondary">ID {member.user_id}{user && !user.is_active && ' · deactivated'}</Typography>
                    </TableCell>
                    <TableCell>{user?.job_title ?? '—'}</TableCell>
                    <TableCell align="right">{Number(member.hours_per_week)} h/week</TableCell>
                    <TableCell>{dateTime(member.assigned_at)}</TableCell>
                    {!readOnly && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Change planned hours">
                          <IconButton size="small" onClick={() => { setEditedHours(String(Number(member.hours_per_week))); setEditing(member) }}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove from project">
                          <IconButton size="small" onClick={() => setRemoving(member)}><DeleteIcon fontSize="small" /></IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <FormDialog
        open={addingEmployee}
        title="Add an employee"
        submitLabel="Add to project"
        onClose={() => setAddingEmployee(false)}
        disabled={!newMember.user_id}
        onSubmit={async () => {
          const member = await projectsApi.members.add(project.id, newMember.user_id, newMember.hours)
          notify(...allocationMessage(directory.userName(member.user_id), member))
          reload()
        }}
      >
        <UserPicker label="Employee" options={candidates} value={newMember.user_id} required
          onChange={(id) => setNewMember({ ...newMember, user_id: id })} />
        <TextField id="member-hours" label="Planned hours per week" type="number" value={newMember.hours} required
          onChange={(e) => setNewMember({ ...newMember, hours: e.target.value })}
          helperText="A full week is 40 hours across all of their projects"
          slotProps={{ htmlInput: { min: 0.5, max: 40, step: 0.5 } }} />
      </FormDialog>

      <FormDialog
        open={addingTeam}
        title="Add a team"
        submitLabel="Add team"
        onClose={() => setAddingTeam(false)}
        disabled={!teamForm.team_id}
        onSubmit={async () => {
          const result = await projectsApi.addTeam(project.id, Number(teamForm.team_id), teamForm.hours)
          const over = result.added.filter((m) => m.over_limit).map((m) => directory.userName(m.user_id))
          const parts = [`Added ${result.added.length} ${result.added.length === 1 ? 'person' : 'people'}`]
          if (result.skipped.length) parts.push(`skipped ${result.skipped.length} (already on the project or deactivated)`)
          if (over.length) parts.push(`now in overtime (over 40 h/week): ${over.join(', ')}`)
          notify(parts.join('; '), over.length ? 'warning' : 'success')
          reload()
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Everyone on the team who isn't on this project yet joins with the same planned hours.
        </Typography>
        <ErrorAlert error={teamList.error} />
        <TextField id="team-select" select label="Team" value={teamForm.team_id} required
          onChange={(e) => setTeamForm({ ...teamForm, team_id: e.target.value })}>
          {(teamList.data || []).map((team) => (
            <MenuItem key={team.id} value={team.id}>
              {team.name} · {directory.userName(team.manager_id)} · {team.member_count} {team.member_count === 1 ? 'member' : 'members'}
            </MenuItem>
          ))}
        </TextField>
        {teamList.data?.length === 0 && <Alert severity="info">No teams exist yet. Create one from the Teams page.</Alert>}
        <TextField id="team-hours" label="Planned hours per week, each" type="number" value={teamForm.hours} required
          onChange={(e) => setTeamForm({ ...teamForm, hours: e.target.value })}
          slotProps={{ htmlInput: { min: 0.5, max: 40, step: 0.5 } }} />
      </FormDialog>

      <FormDialog
        open={Boolean(editing)}
        title={`Planned hours for ${editing ? fullName(directory.user(editing.user_id)) || editing.user_id : ''}`}
        onClose={() => setEditing(null)}
        onSubmit={async () => {
          const member = await projectsApi.members.update(project.id, editing.user_id, editedHours)
          notify(...allocationMessage(directory.userName(member.user_id), member))
          reload()
        }}
      >
        <TextField id="edit-member-hours" label="Hours per week" type="number" value={editedHours} required
          onChange={(e) => setEditedHours(e.target.value)} slotProps={{ htmlInput: { min: 0.5, max: 40, step: 0.5 } }} />
      </FormDialog>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove from project?"
        message={removing && `${directory.userName(removing.user_id)} will be taken off this project and its milestones. Hours they already logged are kept.`}
        confirmLabel="Remove"
        destructive
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await projectsApi.members.remove(project.id, removing.user_id)
          notify('Removed from the project')
          reload()
        }}
      />
    </Box>
  )
}

import { useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox, Chip, Divider, IconButton, List, ListItem,
  ListItemIcon, ListItemText, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import AddIcon from '@mui/icons-material/Add'
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { milestones as milestonesApi, projects as projectsApi } from '../../api/endpoints'
import { useAuth, useRole } from '../../auth/AuthContext'
import { useApiData } from '../../hooks/useApiData'
import { useDirectory } from '../Directory'
import { useNotify } from '../Notifications'
import FormDialog from '../FormDialog'
import ApplyTemplateDialog from './ApplyTemplateDialog'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading, MilestoneStatusChip, UserPicker } from '../common'
import { day } from '../../utils/format'

function MilestoneForm({ form, setForm }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const invalid = form.end_date && form.start_date && form.end_date < form.start_date
  return (
    <>
      <TextField id="milestone-title" label="Title" value={form.title} onChange={set('title')} required
        placeholder="250 servers decommissioned" slotProps={{ htmlInput: { maxLength: 200 } }} />
      <TextField id="milestone-description" label="Description" value={form.description} onChange={set('description')} multiline minRows={2} />
      <Stack direction="row" spacing={2}>
        <TextField id="milestone-start" label="Start date" type="date" value={form.start_date} onChange={set('start_date')} required
          slotProps={{ inputLabel: { shrink: true } }} />
        <TextField id="milestone-end" label="End date" type="date" value={form.end_date} onChange={set('end_date')} required
          error={Boolean(invalid)} helperText={invalid ? 'Must be on or after the start date' : ' '} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
    </>
  )
}

/**
 * Tasks and assignees of one milestone, loaded when it's expanded.
 * `canManage` (managers, admins): everything. `canWork` (employees): tick off
 * tasks and mark their own part finished, on milestones they're assigned to.
 */
function MilestoneDetails({ milestone, members, canManage, canWork, onChanged }) {
  const { user } = useAuth()
  const directory = useDirectory()
  const notify = useNotify()
  const tasks = useApiData(() => milestonesApi.tasks.list(milestone.id), [milestone.id])
  const assignments = useApiData(() => milestonesApi.assignments.list(milestone.id), [milestone.id])
  const [newTask, setNewTask] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(null)
  const [actionError, setActionError] = useState(null)
  const completed = milestone.status === 'completed'
  const assignedToMe = (assignments.data || []).some((a) => a.user_id === user.id)
  const canTick = canManage || (canWork && assignedToMe)

  const run = async (action, message) => {
    setActionError(null)
    try {
      await action()
      if (message) notify(message)
    } catch (err) {
      setActionError(err)
    }
  }

  const assignedIds = new Set((assignments.data || []).map((a) => a.user_id))
  const assignable = directory.users.filter((u) => members.includes(u.id) && !assignedIds.has(u.id))

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: '1fr 1fr' }}>
      {actionError && <Box sx={{ gridColumn: '1 / -1' }}><ErrorAlert error={actionError} /></Box>}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Tasks {tasks.data && `· ${tasks.data.filter((t) => t.is_done).length} of ${tasks.data.length} done`}
        </Typography>
        <ErrorAlert error={tasks.error} onRetry={tasks.reload} />
        {tasks.loading && !tasks.data ? <Loading /> : (
          <List dense disablePadding>
            {tasks.data?.map((task) => (
              <ListItem
                key={task.id}
                disableGutters
                secondaryAction={canManage && !completed && (
                  <Stack direction="row">
                    <Tooltip title="Rename"><IconButton size="small" onClick={() => { setTitle(task.title); setRenaming(task) }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" onClick={() => run(async () => { await milestonesApi.tasks.remove(task.id); tasks.reload() }, 'Task deleted')}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </Stack>
                )}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Checkbox
                    edge="start"
                    size="small"
                    checked={task.is_done}
                    disabled={!canTick || completed}
                    onChange={(e) => run(async () => { await milestonesApi.tasks.update(task.id, { is_done: e.target.checked }); tasks.reload() })}
                    slotProps={{ input: { 'aria-label': `Mark "${task.title}" done` } }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={task.title}
                  // Employees can't look up admins, so a name they can't resolve belongs to an admin
                  secondary={task.is_done && task.done_by ? `Done by ${directory.user(task.done_by) ? directory.userName(task.done_by) : 'an admin'}` : null}
                  sx={{ pr: 8, '& .MuiListItemText-primary': task.is_done ? { textDecoration: 'line-through', color: 'text.secondary' } : {} }}
                />
              </ListItem>
            ))}
            {tasks.data?.length === 0 && <Typography variant="body2" color="text.secondary">No tasks yet. A milestone is complete when its tasks are done.</Typography>}
          </List>
        )}
        {canManage && !completed && (
          <Stack component="form" direction="row" spacing={1} sx={{ mt: 1 }}
            onSubmit={(e) => { e.preventDefault(); run(async () => { await milestonesApi.tasks.create(milestone.id, newTask.trim()); setNewTask(''); tasks.reload() }) }}>
            <TextField id={`new-task-${milestone.id}`} placeholder="Add a task" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
            <Button type="submit" variant="outlined" disabled={!newTask.trim()}>Add</Button>
          </Stack>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Assigned employees</Typography>
        <ErrorAlert error={assignments.error} onRetry={assignments.reload} />
        {assignments.loading && !assignments.data ? <Loading /> : (
          <Stack spacing={1}>
            {assignments.data?.map((a) => (
              <Stack key={a.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{directory.userName(a.user_id)}</Typography>
                <Chip
                  size="small"
                  icon={a.finished_at ? <CheckCircleIcon /> : undefined}
                  label={a.finished_at ? 'Finished' : 'Working'}
                  color={a.finished_at ? 'success' : 'default'}
                  variant={a.finished_at ? 'filled' : 'outlined'}
                />
                {(canManage || (canWork && a.user_id === user.id)) && (
                  <Button size="small" onClick={() => run(async () => { await milestonesApi.assignments.setFinished(milestone.id, a.user_id, !a.finished_at); assignments.reload(); onChanged() },
                    a.finished_at ? null : a.user_id === user.id ? 'Marked finished. You can start your next milestone.' : 'Marked finished')}>
                    {a.finished_at ? 'Mark working' : a.user_id === user.id ? 'Mark my part finished' : 'Mark finished'}
                  </Button>
                )}
                {canManage && (
                  <Tooltip title="Unassign">
                    <IconButton size="small" onClick={() => run(async () => { await milestonesApi.assignments.remove(milestone.id, a.user_id); assignments.reload() }, 'Unassigned')}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            ))}
            {assignments.data?.length === 0 && <Typography variant="body2" color="text.secondary">Nobody assigned yet.</Typography>}
          </Stack>
        )}
        {canManage && !completed && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              <UserPicker label="Assign a project member" options={assignable} value={assignee} onChange={setAssignee}
                helperText={members.length === 0 ? 'Add employees to the project first' : ' '} />
            </Box>
            <Button variant="outlined" disabled={!assignee}
              onClick={() => run(async () => { await milestonesApi.assignments.add(milestone.id, assignee); setAssignee(null); assignments.reload(); onChanged() }, 'Assigned')}>
              Assign
            </Button>
          </Stack>
        )}
      </Box>

      <FormDialog open={Boolean(renaming)} title="Rename task" onClose={() => setRenaming(null)}
        onSubmit={async () => { await milestonesApi.tasks.update(renaming.id, { title: title.trim() }); tasks.reload() }}>
        <TextField id="rename-task" label="Task" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </FormDialog>
    </Box>
  )
}

/** A project's milestones. Managers and admins plan and run them; employees work on theirs. */
export default function MilestonesPanel({ project, readOnly }) {
  const notify = useNotify()
  const { isEmployee } = useRole()
  const canManage = !readOnly && !isEmployee
  const { data, error, loading, reload } = useApiData(() => projectsApi.milestones.list(project.id), [project.id])
  const members = useApiData(() => projectsApi.members.list(project.id), [project.id])
  const [creating, setCreating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [form, setForm] = useState({})
  const [statusError, setStatusError] = useState(null)
  const memberIds = (members.data || []).map((m) => m.user_id)

  const setStatus = async (milestone, status, message) => {
    setStatusError(null)
    try {
      await milestonesApi.update(milestone.id, { status })
      notify(message)
      reload()
    } catch (err) {
      setStatusError(err)
    }
  }

  const nextSequence = (data || []).reduce((max, m) => Math.max(max, m.sequence), 0) + 1

  return (
    <Box>
      {canManage && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button variant="contained" startIcon={<AddIcon />}
            onClick={() => { setForm({ title: '', description: '', start_date: project.start_date, end_date: project.projected_end_date }); setCreating(true) }}>
            Add milestone
          </Button>
          <Tooltip describeChild title="Add a saved list of milestones in one step, choosing the dates for each">
            <Button variant="outlined" startIcon={<ViewTimelineIcon />} onClick={() => setApplying(true)}>Add from template</Button>
          </Tooltip>
        </Stack>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Milestones run in order: each one can start only after the one before it is completed.
      </Typography>
      <ErrorAlert error={error} onRetry={reload} />
      <ErrorAlert error={statusError} />
      {loading && !data ? <Loading /> : data?.length === 0 ? (
        <EmptyState title="No milestones yet">{!canManage ? null : 'Break the project into milestones, such as "250 servers decommissioned by the end of Q1".'}</EmptyState>
      ) : data?.map((m) => (
        <Accordion key={m.id} disableGutters variant="outlined" sx={{ '&:not(:last-of-type)': { borderBottom: 0 } }} slotProps={{ transition: { unmountOnExit: true } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: '100%', pr: 1 }}>
              <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{m.sequence}. {m.title}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{day(m.start_date)} – {day(m.end_date)}</Typography>
              <MilestoneStatusChip status={m.status} />
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            {m.description && <Typography variant="body2" sx={{ mb: 2 }}>{m.description}</Typography>}
            {canManage && (
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
                {m.status === 'not_started' && <Button size="small" variant="contained" onClick={() => setStatus(m, 'in_progress', 'Milestone started')}>Start</Button>}
                {m.status === 'in_progress' && <Button size="small" variant="contained" color="success" onClick={() => setStatus(m, 'completed', 'Milestone completed')}>Mark completed</Button>}
                {m.status === 'completed' && <Button size="small" onClick={() => setStatus(m, 'in_progress', 'Milestone reopened')}>Reopen</Button>}
                <Button size="small" startIcon={<EditIcon />}
                  onClick={() => { setForm({ title: m.title, description: m.description ?? '', start_date: m.start_date, end_date: m.end_date }); setEditing(m) }}>
                  Edit
                </Button>
                {m.status === 'not_started' && <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDeleting(m)}>Delete</Button>}
              </Stack>
            )}
            <Divider sx={{ mb: 2 }} />
            <MilestoneDetails milestone={m} members={memberIds} canManage={canManage} canWork={!readOnly && isEmployee} onChanged={reload} />
          </AccordionDetails>
        </Accordion>
      ))}

      <FormDialog open={creating} title="Add milestone" submitLabel="Add milestone" onClose={() => setCreating(false)}
        onSubmit={async () => {
          await projectsApi.milestones.create(project.id, { ...form, title: form.title.trim(), description: form.description.trim() || null, sequence: nextSequence })
          notify('Milestone added')
          reload()
        }}>
        <Typography variant="body2" color="text.secondary">This becomes milestone {nextSequence}, after the ones already planned.</Typography>
        <MilestoneForm form={form} setForm={setForm} />
      </FormDialog>

      {canManage && (
        <ApplyTemplateDialog open={applying} project={project} existing={data || []} onClose={() => setApplying(false)} onAdded={reload} />
      )}

      <FormDialog open={Boolean(editing)} title="Edit milestone" onClose={() => setEditing(null)}
        onSubmit={async () => {
          await milestonesApi.update(editing.id, { ...form, title: form.title.trim(), description: form.description.trim() || null })
          notify('Milestone saved')
          reload()
        }}>
        <MilestoneForm form={form} setForm={setForm} />
      </FormDialog>

      <ConfirmDialog open={Boolean(deleting)} title="Delete milestone?" confirmLabel="Delete" destructive
        message={deleting && `"${deleting.title}" and its tasks will be deleted.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await milestonesApi.remove(deleting.id); notify('Milestone deleted'); reload() }} />
    </Box>
  )
}

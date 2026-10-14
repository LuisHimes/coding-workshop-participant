import { useState } from 'react'
import { MenuItem, Stack, TextField } from '@mui/material'
import { projects as projectsApi, timeEntries as timeEntriesApi } from '../api/endpoints'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from './Directory'
import { useNotify } from './Notifications'
import FormDialog from './FormDialog'
import { todayIso } from '../utils/format'

/**
 * Employees log hours on one of their open projects, optionally against a
 * milestone. The confirmation shows the week's total, flagged above 40.
 */
export default function LogHoursDialog({ open, onClose, onLogged, projectId = null, milestoneId = null }) {
  const directory = useDirectory()
  const notify = useNotify()
  const [form, setForm] = useState(null)

  const openProjects = directory.projects.filter((p) => !p.archived)
  // Start each opening from the context it was opened in; one open project is picked for you
  const defaultProject = projectId ?? (openProjects.length === 1 ? openProjects[0].id : '')
  const initial = { project_id: defaultProject, milestone_id: milestoneId ?? '', work_date: todayIso(), hours: '8', description: '' }
  const values = form ?? initial
  const set = (field) => (e) => setForm({ ...values, [field]: e.target.value, ...(field === 'project_id' && { milestone_id: '' }) })

  const milestones = useApiData(
    () => (open && values.project_id ? projectsApi.milestones.list(values.project_id) : Promise.resolve([])),
    [open, values.project_id],
  )

  const close = () => {
    setForm(null)
    onClose()
  }

  return (
    <FormDialog
      open={open}
      title="Log hours"
      submitLabel="Log hours"
      onClose={close}
      disabled={!values.project_id}
      onSubmit={async () => {
        const entry = await timeEntriesApi.create({
          project_id: Number(values.project_id),
          milestone_id: values.milestone_id ? Number(values.milestone_id) : null,
          work_date: values.work_date,
          hours: values.hours,
          description: values.description.trim() || null,
        })
        const week = Number(entry.week_hours)
        notify(entry.over_limit
          ? `Logged. You have ${week} h that week, which is overtime (more than 40 h).`
          : `Logged. You have ${week} h that week.`, entry.over_limit ? 'warning' : 'success')
        setForm(null)
        onLogged?.(entry)
      }}
    >
      <TextField id="log-project" select label="Project" value={values.project_id} onChange={set('project_id')} required
        disabled={projectId !== null}>
        {openProjects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
      </TextField>
      <TextField id="log-milestone" select label="Milestone (optional)" value={values.milestone_id} onChange={set('milestone_id')}
        disabled={!values.project_id} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
        helperText={values.project_id ? 'The milestone you worked on, if any' : 'Pick a project first'}>
        <MenuItem value="">None</MenuItem>
        {(milestones.data || []).map((m) => <MenuItem key={m.id} value={m.id}>{m.sequence}. {m.title}</MenuItem>)}
      </TextField>
      <Stack direction="row" spacing={2}>
        <TextField id="log-date" label="Date" type="date" value={values.work_date} onChange={set('work_date')} required
          slotProps={{ inputLabel: { shrink: true } }} />
        <TextField id="log-hours" label="Hours" type="number" value={values.hours} onChange={set('hours')} required
          slotProps={{ htmlInput: { min: 0.25, max: 24, step: 0.25 } }} />
      </Stack>
      <TextField id="log-description" label="What did you work on?" value={values.description} onChange={set('description')}
        multiline minRows={2} />
    </FormDialog>
  )
}

/** Create/edit project dialog for managers and admins. */

import { useState } from 'react'
import { MenuItem, Stack, TextField } from '@mui/material'
import { projects as projectsApi } from '../api/endpoints'
import { useRole } from '../context/AuthContext'
import FormDialog from './FormDialog'
import { UserPicker } from './common'
import { useDirectory } from '../context/DirectoryContext'
import { PROJECT_STATUS_LABELS, todayIso } from '../utils/format'

// start_date is filled in with today each time the dialog opens
const EMPTY = { name: '', description: '', manager_id: null, start_date: '', projected_end_date: '', allocated_hours: '', budget: '' }

/**
 * Create a project, or edit one when `project` is given. Admins can change
 * every field; managers can't change the budget or the manager.
 */
export default function ProjectFormDialog({ open, project, onClose, onSaved }) {
  const directory = useDirectory()
  const { isAdmin } = useRole()
  const editing = Boolean(project)
  const [form, setForm] = useState(EMPTY)
  const [openedFor, setOpenedFor] = useState(null)

  // Reset the form each time the dialog opens
  const key = open ? (project?.id ?? 'new') : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setForm(project ? {
        name: project.name, description: project.description ?? '', manager_id: project.manager_id,
        start_date: project.start_date, projected_end_date: project.projected_end_date,
        allocated_hours: String(project.allocated_hours), budget: String(project.budget), status: project.status,
      } : { ...EMPTY, start_date: todayIso() })
    }
  }

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const managers = directory.users.filter((u) => u.role === 'manager' && u.is_active)
  const datesInvalid = form.projected_end_date && form.start_date && form.projected_end_date < form.start_date

  const submit = async () => {
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      manager_id: form.manager_id,
      start_date: form.start_date,
      projected_end_date: form.projected_end_date,
      allocated_hours: Number(form.allocated_hours),
      budget: form.budget === '' ? '0' : form.budget,
    }
    if (!isAdmin) {
      // The backend refuses these fields from managers, even unchanged
      delete body.manager_id
      delete body.budget
    }
    const saved = editing
      ? await projectsApi.update(project.id, { ...body, ...(form.status !== project.status && { status: form.status }) })
      : await projectsApi.create(body)
    await directory.refresh()
    onSaved?.(saved)
  }

  return (
    <FormDialog
      open={open}
      title={editing ? 'Edit project' : 'New project'}
      submitLabel={editing ? 'Save changes' : 'Create project'}
      onSubmit={submit}
      onClose={onClose}
      disabled={!form.manager_id || datesInvalid}
    >
      <TextField id="project-name" label="Name" value={form.name} onChange={set('name')} required
        slotProps={{ htmlInput: { maxLength: 200 } }} />
      <TextField id="project-description" label="Description" value={form.description} onChange={set('description')}
        multiline minRows={2} />
      <UserPicker label="Manager" options={managers} value={form.manager_id} required disabled={!isAdmin}
        helperText={isAdmin ? undefined : 'Set by an admin'} onChange={(id) => setForm({ ...form, manager_id: id })} />
      <Stack direction="row" spacing={2}>
        <TextField id="project-start" label="Start date" type="date" value={form.start_date} onChange={set('start_date')}
          required slotProps={{ inputLabel: { shrink: true } }} />
        <TextField id="project-end" label="Projected end date" type="date" value={form.projected_end_date}
          onChange={set('projected_end_date')} required error={Boolean(datesInvalid)}
          helperText={datesInvalid ? 'Must be on or after the start date' : ' '} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      <Stack direction="row" spacing={2}>
        <TextField id="project-hours" label="Allocated hours" type="number" value={form.allocated_hours}
          onChange={set('allocated_hours')} required slotProps={{ htmlInput: { min: 1, step: 1 } }} />
        <TextField id="project-budget" label="Budget (USD)" type="number" value={form.budget} onChange={set('budget')}
          disabled={!isAdmin} helperText={isAdmin ? 'Use the budget estimate once the team is set' : 'Set by an admin'}
          slotProps={{ htmlInput: { min: 0, step: '0.01' } }} />
      </Stack>
      {editing && (
        <TextField id="project-status" select label="Status" value={form.status} onChange={set('status')}
          helperText={isAdmin
            ? 'Completing a project archives it; every milestone must be completed first.'
            : 'Completing a project archives it, and only admins can see archived projects. Every milestone must be completed first.'}>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
      )}
    </FormDialog>
  )
}

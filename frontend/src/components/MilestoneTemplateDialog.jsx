/** Create/edit dialog for milestone templates (reusable lists of milestones). */

import { useState } from 'react'
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteIcon from '@mui/icons-material/Delete'
import { milestones as milestonesApi } from '../api/endpoints'
import { useAuth, useRole } from '../context/AuthContext'
import { useDirectory } from '../context/DirectoryContext'
import { useNotify } from '../context/NotificationsContext'
import FormDialog from './FormDialog'
import { UserPicker } from './common'

// Each row gets a stable React key so inputs keep focus when rows are moved or removed
let nextKey = 0
/** One editable milestone row, from a saved template milestone or blank. Days are kept as text while typing. */
const row = (item = {}) => ({
  key: nextKey++, title: item.title ?? '', description: item.description ?? '', duration_days: item.duration_days ? String(item.duration_days) : '',
})
/** The usual length is optional; when given it must be a whole number of days from 1 to 3650. */
const validDays = (value) => value === '' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 3650)

/**
 * Create a milestone template, or edit one when `template` is given. Managers'
 * new templates are their own; admins pick the manager a new template is for.
 */
export default function MilestoneTemplateDialog({ open, template, onClose, onSaved }) {
  const directory = useDirectory()
  const notify = useNotify()
  const { user } = useAuth()
  const { isAdmin } = useRole()
  const [form, setForm] = useState(null)
  const [openedFor, setOpenedFor] = useState(null)

  // Start fresh each time the dialog opens
  const key = open ? (template?.id ?? 'new') : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setForm(template
        ? { name: template.name, description: template.description ?? '', manager_id: template.manager_id, rows: template.milestones.map(row) }
        : { name: '', description: '', manager_id: null, rows: [row(), row()] })
    }
  }
  if (!form) return null

  const managers = directory.users.filter((u) => u.role === 'manager' && u.is_active)
  const setRow = (index, field, value) => setForm({ ...form, rows: form.rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)) })
  const move = (index, by) => {
    const rows = [...form.rows]
    ;[rows[index], rows[index + by]] = [rows[index + by], rows[index]]
    setForm({ ...form, rows })
  }
  const invalid = !form.name.trim() || form.rows.length === 0 || form.rows.some((r) => !r.title.trim() || !validDays(r.duration_days))
    || (isAdmin && !template && !form.manager_id)

  return (
    <FormDialog open={open} maxWidth="md" title={template ? 'Edit milestone template' : 'New milestone template'}
      submitLabel={template ? 'Save template' : 'Create template'} onClose={onClose} disabled={invalid}
      onSubmit={async () => {
        const milestones = form.rows.map((r) => ({
          title: r.title.trim(), description: r.description.trim() || null, duration_days: r.duration_days ? Number(r.duration_days) : null,
        }))
        const body = { name: form.name.trim(), description: form.description.trim() || null, milestones }
        const saved = template
          ? await milestonesApi.templates.update(template.id, body)
          // Managers' templates are always their own; admins choose the manager
          : await milestonesApi.templates.create({ ...body, manager_id: isAdmin ? form.manager_id : user.id })
        notify(template ? 'Template saved' : 'Template created')
        onSaved(saved)
      }}>
      <Typography variant="body2" color="text.secondary">
        A template is a list of milestones you plan often. Add it to a project from the project's Milestones tab, where you pick
        the dates for each milestone.
      </Typography>
      <TextField id="template-name" label="Template name" value={form.name} required placeholder="Software release"
        onChange={(e) => setForm({ ...form, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
      <TextField id="template-description" label="Description (optional)" value={form.description}
        placeholder="When to use this template" onChange={(e) => setForm({ ...form, description: e.target.value })} />
      {isAdmin && !template && (
        <UserPicker label="Manager" options={managers} value={form.manager_id} required
          helperText="The manager who will use this template on their projects" onChange={(id) => setForm({ ...form, manager_id: id })} />
      )}

      <Box>
        <Typography variant="subtitle2">Milestones, in the order they run</Typography>
        <Typography variant="caption" color="text.secondary">
          The usual length is optional. It fills in end dates when you add the template to a project; you can still change them there.
        </Typography>
      </Box>
      {form.rows.map((r, index) => (
        <Stack key={r.key} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography sx={{ pt: 1, width: 24, fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{index + 1}.</Typography>
          <TextField id={`template-milestone-${r.key}-title`} label="Milestone title" value={r.title} required sx={{ flex: 2 }}
            onChange={(e) => setRow(index, 'title', e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField id={`template-milestone-${r.key}-description`} label="Description (optional)" value={r.description} sx={{ flex: 2 }}
            onChange={(e) => setRow(index, 'description', e.target.value)} />
          <TextField id={`template-milestone-${r.key}-days`} label="Usual length (days)" value={r.duration_days} sx={{ width: 150, flexShrink: 0 }}
            type="number" slotProps={{ htmlInput: { min: 1, max: 3650, step: 1 } }}
            error={!validDays(r.duration_days)} helperText={validDays(r.duration_days) ? ' ' : '1 to 3650 days'}
            onChange={(e) => setRow(index, 'duration_days', e.target.value)} />
          <Stack direction="row" sx={{ pt: 0.5 }}>
            <Tooltip title="Move up"><span>
              <IconButton size="small" aria-label={`Move milestone ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span></Tooltip>
            <Tooltip title="Move down"><span>
              <IconButton size="small" aria-label={`Move milestone ${index + 1} down`} disabled={index === form.rows.length - 1} onClick={() => move(index, 1)}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </span></Tooltip>
            <Tooltip title="Remove"><span>
              <IconButton size="small" aria-label={`Remove milestone ${index + 1}`} disabled={form.rows.length === 1}
                onClick={() => setForm({ ...form, rows: form.rows.filter((_, i) => i !== index) })}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span></Tooltip>
          </Stack>
        </Stack>
      ))}
      <Box>
        <Button startIcon={<AddIcon />} disabled={form.rows.length >= 50} onClick={() => setForm({ ...form, rows: [...form.rows, row()] })}>
          Add another milestone
        </Button>
      </Box>
    </FormDialog>
  )
}

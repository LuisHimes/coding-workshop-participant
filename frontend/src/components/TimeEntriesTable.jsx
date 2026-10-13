import { useState } from 'react'
import {
  IconButton, Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableRow, TextField, Tooltip,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import { timeEntries as timeEntriesApi } from '../api/endpoints'
import { useDirectory } from './Directory'
import { useNotify } from './Notifications'
import FormDialog from './FormDialog'
import { ConfirmDialog, EmptyState } from './common'
import { day, hours } from '../utils/format'

/** Logged hours; `editable` (admins) adds corrections and deletes. Calls onChanged after either. */
export default function TimeEntriesTable({ entries, showProject = true, editable = false, onChanged }) {
  const directory = useDirectory()
  const notify = useNotify()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [form, setForm] = useState({})

  if (!entries.length) return <EmptyState title="No hours logged">Hours appear here once employees log them.</EmptyState>
  const total = entries.reduce((sum, e) => sum + Number(e.hours), 0)

  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Employee</TableCell>
              {showProject && <TableCell>Project</TableCell>}
              <TableCell>Description</TableCell>
              <TableCell align="right">Hours</TableCell>
              {editable && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{day(entry.work_date)}</TableCell>
                <TableCell>{directory.userName(entry.user_id)}</TableCell>
                {showProject && <TableCell>{directory.projectName(entry.project_id)}</TableCell>}
                <TableCell sx={{ maxWidth: 360 }}>{entry.description || '—'}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{hours(entry.hours)}</TableCell>
                {editable && <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Correct entry">
                    <IconButton size="small" onClick={() => {
                      setForm({ work_date: entry.work_date, hours: String(Number(entry.hours)), description: entry.description ?? '' })
                      setEditing(entry)
                    }}><EditIcon fontSize="small" /></IconButton>
                  </Tooltip>
                  <Tooltip title="Delete entry">
                    <IconButton size="small" onClick={() => setDeleting(entry)}><DeleteIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={showProject ? 4 : 3} sx={{ fontWeight: 600 }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{hours(total)}</TableCell>
              {editable && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>

      <FormDialog open={Boolean(editing)} title="Correct time entry" onClose={() => setEditing(null)}
        onSubmit={async () => {
          const saved = await timeEntriesApi.update(editing.id, { ...form, description: form.description.trim() || null })
          notify(saved.over_limit
            ? `Saved. ${directory.userName(saved.user_id)} logged ${Number(saved.week_hours)} h that week, over 40.`
            : 'Time entry saved', saved.over_limit ? 'warning' : 'success')
          onChanged()
        }}>
        <TextField id="entry-date" label="Date" type="date" value={form.work_date} required
          onChange={(e) => setForm({ ...form, work_date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField id="entry-hours" label="Hours" type="number" value={form.hours} required
          onChange={(e) => setForm({ ...form, hours: e.target.value })} slotProps={{ htmlInput: { min: 0.25, max: 24, step: 0.25 } }} />
        <TextField id="entry-description" label="Description" value={form.description} multiline minRows={2}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </FormDialog>

      <ConfirmDialog open={Boolean(deleting)} title="Delete time entry?" confirmLabel="Delete" destructive
        message={deleting && `${hours(deleting.hours)} on ${day(deleting.work_date)} by ${directory.userName(deleting.user_id)} will be removed from the project's labor cost.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await timeEntriesApi.remove(deleting.id); notify('Time entry deleted'); onChanged() }} />
    </>
  )
}

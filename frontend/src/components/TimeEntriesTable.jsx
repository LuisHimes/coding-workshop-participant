/** Table of logged hours, with optional correct and delete actions. */

import { useState } from 'react'
import {
  IconButton, Table, TableBody, TableCell, TableFooter, TableHead, TableRow, TextField, Tooltip,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import { timeEntries as timeEntriesApi } from '../api/endpoints'
import { useDirectory } from '../context/DirectoryContext'
import { useNotify } from '../context/NotificationsContext'
import FormDialog from './FormDialog'
import { ConfirmDialog, EmptyState, ScrollingTable, SortableCell } from './common'
import { day, hours } from '../utils/format'
import { useRole } from '../context/AuthContext'
import { useSort } from '../hooks/useSort'

/**
 * Logged hours with a total row. `showProject` adds the project column; `editable` adds
 * corrections and deletes (admins on any entry, employees on the entries they see, which are their own).
 * Calls onChanged after either.
 */
export default function TimeEntriesTable({ entries, showProject = true, editable = false, onChanged }) {
  const directory = useDirectory()
  // Employees only ever see their own entries, so the Employee column would repeat their name
  const { isEmployee } = useRole()
  const showEmployee = !isEmployee
  const notify = useNotify()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [form, setForm] = useState({})
  const sorting = useSort(entries, {
    date: (e) => e.work_date, employee: (e) => directory.userName(e.user_id), project: (e) => directory.projectName(e.project_id),
    description: (e) => e.description, hours: (e) => Number(e.hours),
  })

  if (!entries.length) return <EmptyState title="No hours logged">Hours appear here once employees log them.</EmptyState>
  const total = entries.reduce((sum, e) => sum + Number(e.hours), 0)

  return (
    <>
      <ScrollingTable label="Time entries">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <SortableCell label="Date" sortKey="date" sorting={sorting} />
              {showEmployee && <SortableCell label="Employee" sortKey="employee" sorting={sorting} />}
              {showProject && <SortableCell label="Project" sortKey="project" sorting={sorting} />}
              <SortableCell label="Description" sortKey="description" sorting={sorting} />
              <SortableCell label="Hours" sortKey="hours" sorting={sorting} align="right" />
              {editable && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorting.sorted.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{day(entry.work_date)}</TableCell>
                {showEmployee && <TableCell>{directory.userName(entry.user_id)}</TableCell>}
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
          {/* The total stays pinned to the bottom while the entries scroll */}
          <TableFooter sx={{ position: 'sticky', bottom: 0, zIndex: 2, bgcolor: 'background.paper', '& td': { borderTop: 1, borderColor: 'divider' } }}>
            <TableRow>
              <TableCell colSpan={2 + (showEmployee ? 1 : 0) + (showProject ? 1 : 0)} sx={{ fontWeight: 600 }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{hours(total)}</TableCell>
              {editable && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </ScrollingTable>

      <FormDialog open={Boolean(editing)} title="Correct time entry" onClose={() => setEditing(null)}
        onSubmit={async () => {
          const saved = await timeEntriesApi.update(editing.id, { ...form, description: form.description.trim() || null })
          notify(saved.over_limit
            ? `Saved. ${directory.userName(saved.user_id)} logged ${Number(saved.week_hours)} h that week, which is overtime (more than 40 h).`
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

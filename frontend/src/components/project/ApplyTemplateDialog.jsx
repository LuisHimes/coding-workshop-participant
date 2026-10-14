import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box, Checkbox, Link, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { milestones as milestonesApi, projects as projectsApi } from '../../api/endpoints'
import { useRole } from '../../auth/AuthContext'
import { useApiData } from '../../hooks/useApiData'
import { useDirectory } from '../Directory'
import { useNotify } from '../Notifications'
import FormDialog from '../FormDialog'
import { Loading } from '../common'
import { day } from '../../utils/format'
import { addDays, isoDay, parseDay } from '../../utils/milestones'

/**
 * Suggested dates: the first milestone starts after the project's last
 * milestone (or on the project's start date), each one starts the day after
 * the previous ends, and a usual length fills in the end date.
 */
function suggestDates(template, project, existing) {
  const lastEnd = existing.map((m) => m.end_date).sort().at(-1)
  let start = lastEnd && lastEnd >= project.start_date ? isoDay(addDays(parseDay(lastEnd), 1)) : project.start_date
  return template.milestones.map((m) => {
    const end = start && m.duration_days ? isoDay(addDays(parseDay(start), m.duration_days - 1)) : ''
    const row = { include: true, title: m.title, description: m.description, duration_days: m.duration_days, start_date: start, end_date: end }
    start = end ? isoDay(addDays(parseDay(end), 1)) : ''
    return row
  })
}

function rowProblem(row) {
  if (!row.start_date || !row.end_date) return 'Pick a start and an end date'
  if (row.end_date < row.start_date) return 'The end date must be on or after the start date'
  return null
}

/** Adds a milestone template's milestones to a project, with a start and end date for each. */
export default function ApplyTemplateDialog({ open, project, existing, onClose, onAdded }) {
  const directory = useDirectory()
  const notify = useNotify()
  const { isAdmin } = useRole()
  // Admins use the project manager's templates; managers always get their own
  const templates = useApiData(
    () => (open ? milestonesApi.templates.list({ manager_id: isAdmin ? project.manager_id : undefined }) : Promise.resolve(null)),
    [open, project.manager_id, isAdmin],
  )
  const [templateId, setTemplateId] = useState('')
  const [rows, setRows] = useState([])
  const close = () => { setTemplateId(''); setRows([]); onClose() }

  const choose = (id) => {
    setTemplateId(id)
    setRows(suggestDates(templates.data.find((t) => String(t.id) === id), project, existing))
  }
  const setRow = (index, changes) => setRows(rows.map((r, i) => (i === index ? { ...r, ...changes } : r)))
  const included = rows.filter((r) => r.include)
  const firstSequence = existing.reduce((max, m) => Math.max(max, m.sequence), 0) + 1
  const invalid = included.length === 0 || included.some(rowProblem)
  let sequence = firstSequence

  return (
    <FormDialog open={open} maxWidth="md" title="Add milestones from a template" onClose={close} disabled={invalid}
      submitLabel={included.length ? `Add ${included.length} milestone${included.length === 1 ? '' : 's'}` : 'Add milestones'}
      onSubmit={async () => {
        await projectsApi.milestones.createMany(project.id, included.map(({ title, description, start_date, end_date }) => ({
          title, description, start_date, end_date,
        })))
        notify(`${included.length} milestone${included.length === 1 ? '' : 's'} added`)
        onAdded()
      }}>
      {templates.loading && !templates.data ? <Loading /> : templates.data?.length === 0 ? (
        <Typography variant="body2">
          {isAdmin
            ? `${directory.userName(project.manager_id)} has no milestone templates yet. `
            : "You don't have any milestone templates yet. "}
          <Link component={RouterLink} to="/milestone-templates">Create a milestone template</Link> with the milestones you plan
          often, then come back here to add them in one step.
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            The milestones are added after the ones already planned, in the template's order. Dates are suggested from each
            milestone's usual length, one after another; change any of them, or untick a milestone to leave it out.
          </Typography>
          <TextField id="apply-template" select label="Template" value={templateId} onChange={(e) => choose(e.target.value)}>
            {(templates.data || []).map((t) => (
              <MenuItem key={t.id} value={String(t.id)}>{t.name} ({t.milestones.length} milestone{t.milestones.length === 1 ? '' : 's'})</MenuItem>
            ))}
          </TextField>
          {rows.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">Add</TableCell>
                    <TableCell>Milestone</TableCell>
                    <TableCell>Start date</TableCell>
                    <TableCell>End date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r, index) => {
                    const problem = r.include ? rowProblem(r) : null
                    const number = r.include ? sequence++ : null
                    return (
                      <TableRow key={`${templateId}-${index}`} sx={{ opacity: r.include ? 1 : 0.55 }}>
                        <TableCell padding="checkbox">
                          <Checkbox checked={r.include} onChange={(e) => setRow(index, { include: e.target.checked })}
                            slotProps={{ input: { 'aria-label': `Add "${r.title}"` } }} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{number ? `${number}. ` : ''}{r.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.include ? (r.duration_days ? `Usually ${r.duration_days} day${r.duration_days === 1 ? '' : 's'}` : 'No usual length set') : 'Left out'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <TextField id={`apply-${index}-start`} type="date" label="Start" value={r.start_date} disabled={!r.include}
                            onChange={(e) => setRow(index, { start_date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 150 }}
                            helperText=" " />
                        </TableCell>
                        <TableCell>
                          <TextField id={`apply-${index}-end`} type="date" label="End" value={r.end_date} disabled={!r.include}
                            error={Boolean(problem && r.start_date && r.end_date)} helperText={problem ?? ' '}
                            onChange={(e) => setRow(index, { end_date: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 150 }} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <Typography variant="caption" color="text.secondary">
                The project runs {day(project.start_date)} – {day(project.projected_end_date)}.
              </Typography>
            </Box>
          )}
        </>
      )}
    </FormDialog>
  )
}

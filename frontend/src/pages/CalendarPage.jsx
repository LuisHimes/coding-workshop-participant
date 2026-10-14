/** Calendar screen (/calendar): milestones and deadlines by month, for every role. */

import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box, Button, Card, CardContent, IconButton, List, ListItemButton, ListItemIcon, ListItemText, MenuItem, Stack,
  TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FlagIcon from '@mui/icons-material/Flag'
import { milestones as milestonesApi } from '../api/endpoints'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../context/DirectoryContext'
import { EmptyState, ErrorAlert, PageHeader } from '../components/common'
import { day, todayIso } from '../utils/format'
import { MILESTONE_STATES, addDays, isoDay, milestoneState, parseDay } from '../utils/milestones'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Height in px of one row of bars in a week
const LANE_HEIGHT = 24

/** The weeks (Monday to Sunday, as ISO dates) covering a month. */
function monthWeeks(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const weeks = []
  for (let monday = addDays(first, -((first.getDay() + 6) % 7)); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => isoDay(addDays(monday, i))))
  }
  return weeks
}

/** Places the items that touch this week into columns and stacked lanes, so bars never overlap. */
function layoutWeek(days, items) {
  const [first, last] = [days[0], days[6]]
  const laneEnds = []
  return items
    .filter((item) => item.end >= first && item.start <= last)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))
    .map((item) => {
      const from = item.start < first ? 0 : days.indexOf(item.start)
      const to = item.end > last ? 6 : days.indexOf(item.end)
      let lane = laneEnds.findIndex((end) => end < from)
      if (lane === -1) lane = laneEnds.push(to) - 1
      else laneEnds[lane] = to
      return { ...item, from, to, lane, startsHere: item.start >= first, endsHere: item.end <= last }
    })
}

/**
 * One week's piece of a milestone bar, or a project deadline. A bar spanning several weeks is split into
 * pieces; only the first piece on screen is `focusable`, so screen readers announce each item once.
 */
function ItemBar({ item, focusable, onOpen }) {
  const { from, to, lane, startsHere, endsHere } = item
  const isProject = item.kind === 'project'
  const colors = isProject
    ? { bgcolor: 'background.paper', color: item.overdue ? 'error.main' : 'secondary.main', border: 1.5, borderColor: item.overdue ? 'error.main' : 'secondary.main' }
    : { bgcolor: MILESTONE_STATES[item.state].color, color: MILESTONE_STATES[item.state].text }
  return (
    <Tooltip title={item.tooltip}>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        aria-label={focusable ? item.ariaLabel : undefined}
        aria-hidden={focusable ? undefined : true}
        tabIndex={focusable ? undefined : -1}
        sx={{
          ...colors,
          gridColumn: `${from + 1} / ${to + 2}`, gridRow: lane + 2, zIndex: 1, my: '2px',
          ml: startsHere ? 0.5 : 0, mr: endsHere ? 0.5 : 0, px: 0.75, minWidth: 0,
          borderRadius: `${startsHere ? 4 : 0}px ${endsHere ? 4 : 0}px ${endsHere ? 4 : 0}px ${startsHere ? 4 : 0}px`,
          display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', font: 'inherit', fontSize: 12,
          fontWeight: 600, textAlign: 'left', borderStyle: isProject ? 'solid' : 'none',
          '&:hover': { filter: 'brightness(0.95)' }, '&:focus-visible': { outline: 2, outlineColor: 'text.primary', outlineOffset: 1 },
        }}
      >
        {isProject && <FlagIcon sx={{ fontSize: 14 }} />}
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.label}</Box>
        {!isProject && endsHere && <FlagIcon sx={{ fontSize: 14 }} titleAccess="Deadline" />}
      </Box>
    </Tooltip>
  )
}

/**
 * One calendar row: seven day cells (today circled, deadline days tinted, other months' days greyed)
 * with the week's bars laid over them. `gridStart` is the first day shown on the calendar.
 */
function Week({ days, month, items, deadlines, today, gridStart, onOpen }) {
  const placed = layoutWeek(days, items)
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1))
  return (
    <Box sx={{
      display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
      gridTemplateRows: `30px repeat(${lanes}, ${LANE_HEIGHT}px) minmax(12px, 1fr)`, minHeight: 112,
      borderTop: 1, borderColor: 'divider',
    }}>
      {days.map((iso, i) => {
        const due = deadlines.get(iso)
        const inMonth = parseDay(iso).getMonth() === month.getMonth()
        const tint = due?.project ? 'secondary' : due?.milestone ? 'warning' : null
        return (
          <Box key={iso} sx={{
            gridColumn: i + 1, gridRow: '1 / -1', borderLeft: i ? 1 : 0, borderColor: 'divider', p: 0.5,
            bgcolor: (t) => tint ? alpha(t.palette[tint].main, 0.1) : inMonth ? 'transparent' : t.palette.action.hover,
          }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{
                width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: iso === today ? 700 : 500,
                color: iso === today ? 'primary.contrastText' : inMonth ? 'text.primary' : 'text.disabled',
                bgcolor: iso === today ? 'primary.main' : 'transparent',
              }}>
                {parseDay(iso).getDate()}
              </Typography>
              {due && (
                <Typography variant="caption" sx={{ color: `${tint}.main`, fontWeight: 600, pr: 0.5 }}>
                  {due.project ? 'Project due' : 'Due'}
                </Typography>
              )}
            </Stack>
          </Box>
        )
      })}
      {placed.map((item) => (
        <ItemBar key={item.key} item={item} focusable={item.startsHere || days[0] === gridStart} onOpen={() => onOpen(item)} />
      ))}
    </Box>
  )
}

/**
 * Month calendar of milestones (bars across their dates, colored by state)
 * and deadlines (milestone and project end dates, highlighted). Everyone sees
 * the open projects they can see. The month and project filter are kept in
 * the URL; clicking an item opens its project.
 */
export default function CalendarPage() {
  const navigate = useNavigate()
  const directory = useDirectory()
  const [searchParams, setSearchParams] = useSearchParams()
  const today = todayIso()
  const monthParam = /^\d{4}-\d{2}$/.test(searchParams.get('month') || '') ? searchParams.get('month') : today.slice(0, 7)
  const month = parseDay(`${monthParam}-01`)
  const projectFilter = searchParams.get('project') || ''
  const weeks = monthWeeks(month)
  const [rangeStart, rangeEnd] = [weeks[0][0], weeks.at(-1)[6]]

  const { data, error, reload } = useApiData(
    () => milestonesApi.list({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd],
  )

  const setParams = (changes) => {
    const next = { month: monthParam, project: projectFilter, ...changes }
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)), { replace: true })
  }
  const shiftMonth = (by) => setParams({ month: isoDay(new Date(month.getFullYear(), month.getMonth() + by, 1)).slice(0, 7) })

  const openProjects = directory.projects.filter((p) => !p.archived)
  const shown = (projectId) => !projectFilter || String(projectId) === projectFilter

  const milestoneItems = (data || []).filter((m) => shown(m.project_id)).map((m) => {
    const state = milestoneState(m, today)
    const project = directory.projectName(m.project_id)
    return {
      kind: 'milestone', key: `m${m.id}`, start: m.start_date, end: m.end_date, state, projectId: m.project_id,
      label: `${m.sequence}. ${m.title}`,
      ariaLabel: `${project}: milestone ${m.sequence}, ${m.title}, ${MILESTONE_STATES[state].label}, due ${day(m.end_date)}`,
      tooltip: (<><b>{project}</b><br />{m.sequence}. {m.title}<br />{MILESTONE_STATES[state].label} · {day(m.start_date)} – {day(m.end_date)}</>),
    }
  })
  const projectItems = openProjects
    .filter((p) => shown(p.id) && p.projected_end_date >= rangeStart && p.projected_end_date <= rangeEnd)
    .map((p) => {
      const overdue = p.projected_end_date < today
      return {
        kind: 'project', key: `p${p.id}`, start: p.projected_end_date, end: p.projected_end_date, overdue, projectId: p.id,
        label: p.name, ariaLabel: `${p.name}: project due ${day(p.projected_end_date)}${overdue ? ', overdue' : ''}`,
        tooltip: (<><b>Project deadline</b><br />{p.name}<br />Due {day(p.projected_end_date)}{overdue ? ' · overdue' : ''}</>),
      }
    })
  const items = [...projectItems, ...milestoneItems]

  // Days with a deadline get highlighted; project deadlines outrank milestone ones
  const deadlines = new Map()
  for (const item of items) {
    const entry = deadlines.get(item.end) || {}
    entry[item.kind] = true
    deadlines.set(item.end, entry)
  }
  const monthDeadlines = items
    .filter((item) => item.end.startsWith(monthParam))
    .sort((a, b) => a.end.localeCompare(b.end) || (a.kind === 'project' ? -1 : 1))

  const open = (item) => navigate(`/projects/${item.projectId}${item.kind === 'milestone' ? '?tab=milestones' : ''}`)
  const title = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <>
      <PageHeader title="Calendar" subtitle="Milestones and deadlines across your open projects." />
      <Card>
        <Stack direction="row" spacing={1} sx={{ p: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <IconButton aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeftIcon /></IconButton>
          <IconButton aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRightIcon /></IconButton>
          <Typography variant="h6" component="h2" sx={{ minWidth: 180 }} aria-live="polite">{title}</Typography>
          <Button size="small" variant="outlined" onClick={() => setParams({ month: today.slice(0, 7) })}
            disabled={monthParam === today.slice(0, 7)}>Today</Button>
          <Box sx={{ flex: 1 }} />
          <TextField id="calendar-project" select label="Project" value={projectFilter}
            onChange={(e) => setParams({ project: e.target.value })} sx={{ maxWidth: 280 }}
            slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
            <MenuItem value="">All projects</MenuItem>
            {openProjects.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
          </TextField>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ px: 2, pb: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          {Object.entries(MILESTONE_STATES).map(([key, s]) => (
            <Stack key={key} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: s.color }} />
              <Typography variant="caption">{s.label}</Typography>
            </Stack>
          ))}
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <FlagIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption">Milestone deadline</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, border: 1.5, borderColor: 'secondary.main' }} />
            <Typography variant="caption">Project deadline</Typography>
          </Stack>
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} variant="caption" sx={{ px: 1, py: 0.75, fontWeight: 600, color: 'text.secondary' }}>{w}</Typography>
          ))}
        </Box>
        {weeks.map((days) => (
          <Week key={days[0]} days={days} month={month} items={items} deadlines={deadlines} today={today}
            gridStart={rangeStart} onOpen={open} />
        ))}
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Deadlines in {title}</Typography>
          {monthDeadlines.length === 0 ? (
            <EmptyState title="No deadlines this month">Milestone and project end dates show up here.</EmptyState>
          ) : (
            <List dense disablePadding>
              {monthDeadlines.map((item) => (
                <ListItemButton key={item.key} onClick={() => open(item)} divider>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FlagIcon fontSize="small" sx={{
                      color: item.kind === 'project' ? (item.overdue ? 'error.main' : 'secondary.main') : MILESTONE_STATES[item.state].color,
                    }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={item.kind === 'project' ? `Project due: ${item.label}` : `${directory.projectName(item.projectId)} · ${item.label}`}
                    secondary={`${day(item.end)}${item.kind === 'project' ? (item.overdue ? ' · overdue' : '') : ` · ${MILESTONE_STATES[item.state].label}`}`}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </CardContent>
      </Card>
    </>
  )
}

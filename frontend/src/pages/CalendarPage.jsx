/** Calendar screen (/calendar): each month's key dates (kickoffs, milestone starts and deadlines), for every role. */

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box, Button, Card, CardContent, Dialog, DialogContent, DialogTitle, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FlagIcon from '@mui/icons-material/Flag'
import OutlinedFlagIcon from '@mui/icons-material/OutlinedFlag'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import { milestones as milestonesApi } from '../api/endpoints'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../context/DirectoryContext'
import { EmptyState, ErrorAlert, PageHeader } from '../components/common'
import { day, todayIso } from '../utils/format'
import { MILESTONE_STATES, addDays, isoDay, milestoneState, parseDay } from '../utils/milestones'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Key dates shown in a day cell before the rest go behind "+N more"
const MAX_PER_DAY = 3

/** The kinds of key date, in the order they're listed within a day (deadlines first). */
const KINDS = {
  projectDue: { legend: 'Project deadline', Icon: OutlinedFlagIcon },
  milestoneDue: { legend: 'Milestone due', Icon: FlagIcon },
  milestoneStart: { legend: 'Milestone starts', Icon: PlayArrowIcon },
  projectStart: { legend: 'Project kickoff', Icon: RocketLaunchIcon },
}
const KIND_ORDER = Object.keys(KINDS)

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

/** Colors for a key date: milestone deadlines take their milestone's state color; the others are outlined. */
function eventColors(event) {
  if (event.kind === 'milestoneDue') {
    const state = MILESTONE_STATES[event.state]
    return { bgcolor: state.color, color: state.text, borderColor: state.color }
  }
  const tone = event.overdue ? 'error.main' : event.kind === 'milestoneStart' ? 'primary.main' : 'secondary.main'
  return { bgcolor: 'background.paper', color: tone, borderColor: tone }
}

/** One key date in a day cell: an icon and short text (full details on hover); clicking opens the project. */
function EventChip({ event, onOpen }) {
  const { Icon } = KINDS[event.kind]
  return (
    <Tooltip title={event.tooltip}>
      <Box component="button" type="button" onClick={onOpen} aria-label={event.ariaLabel}
        sx={{
          ...eventColors(event), display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', minWidth: 0, px: 0.75, py: '1px',
          border: 1.5, borderStyle: 'solid', borderRadius: 1, font: 'inherit', fontSize: 12, fontWeight: 600, textAlign: 'left',
          cursor: 'pointer', '&:hover': { filter: 'brightness(0.95)' },
          '&:focus-visible': { outline: 2, outlineColor: 'text.primary', outlineOffset: 1 },
        }}>
        <Icon sx={{ fontSize: 14, flexShrink: 0 }} />
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.label}</Box>
      </Box>
    </Tooltip>
  )
}

/**
 * One day of the month grid: the date (today circled, other months greyed, deadline days tinted) and up to
 * MAX_PER_DAY key dates, with "+N more" opening the full list for that day.
 */
function DayCell({ iso, inMonth, today, events, first, onOpen, onShowDay }) {
  const tint = events.some((e) => e.kind === 'projectDue') ? 'secondary' : events.some((e) => e.kind === 'milestoneDue') ? 'warning' : null
  const hidden = events.length - MAX_PER_DAY
  return (
    <Box sx={{
      borderLeft: first ? 0 : 1, borderColor: 'divider', p: 0.5, minHeight: 116, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5,
      bgcolor: (t) => tint ? alpha(t.palette[tint].main, 0.08) : inMonth ? 'transparent' : t.palette.action.hover,
    }}>
      <Typography variant="caption" sx={{
        width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: iso === today ? 700 : 500,
        color: iso === today ? 'primary.contrastText' : inMonth ? 'text.primary' : 'text.disabled',
        bgcolor: iso === today ? 'primary.main' : 'transparent',
      }}>
        {parseDay(iso).getDate()}
      </Typography>
      {events.slice(0, MAX_PER_DAY).map((event) => <EventChip key={event.key} event={event} onOpen={() => onOpen(event)} />)}
      {hidden > 0 && (
        <Button size="small" onClick={() => onShowDay(iso)} sx={{ alignSelf: 'flex-start', minWidth: 0, px: 0.5, py: 0, fontSize: 12 }}
          aria-label={`Show all ${events.length} key dates on ${day(iso)}`}>
          +{hidden} more
        </Button>
      )}
    </Box>
  )
}

/** Key dates as a list with icons, names and dates (the month list, and a day's "+N more" dialog). */
function EventList({ events, onOpen }) {
  return (
    <List dense disablePadding>
      {events.map((event) => {
        const { Icon } = KINDS[event.kind]
        return (
          <ListItemButton key={event.key} onClick={() => onOpen(event)} divider>
            <ListItemIcon sx={{ minWidth: 36 }}><Icon fontSize="small" sx={{ color: eventColors(event).borderColor }} /></ListItemIcon>
            <ListItemText primary={event.listTitle} secondary={event.listDetail} />
          </ListItemButton>
        )
      })}
    </List>
  )
}

/** Every key date of the visible projects that falls on the grid, sorted by date and then by kind. */
function keyDates({ milestones, projects, projectName, inGrid, today }) {
  const events = []
  for (const m of milestones) {
    const state = milestoneState(m, today)
    const project = projectName(m.project_id)
    const name = `${m.sequence}. ${m.title}`
    const status = MILESTONE_STATES[state].label
    if (inGrid(m.start_date)) {
      events.push({
        kind: 'milestoneStart', key: `ms${m.id}`, date: m.start_date, projectId: m.project_id, tab: 'milestones', state,
        label: `Starts: ${m.title}`, ariaLabel: `${project}: milestone ${name} starts ${day(m.start_date)}`,
        tooltip: <><b>{project}</b><br />{name} starts<br />{day(m.start_date)} – {day(m.end_date)} · {status}</>,
        listTitle: `${project} · ${name} starts`, listDetail: `${day(m.start_date)} · runs to ${day(m.end_date)}`,
      })
    }
    if (inGrid(m.end_date)) {
      events.push({
        kind: 'milestoneDue', key: `md${m.id}`, date: m.end_date, projectId: m.project_id, tab: 'milestones', state,
        label: `Due: ${m.title}`, ariaLabel: `${project}: milestone ${name} due ${day(m.end_date)}, ${status}`,
        tooltip: <><b>{project}</b><br />{name} due<br />{day(m.end_date)} · {status}</>,
        listTitle: `${project} · ${name} due`, listDetail: `${day(m.end_date)} · ${status}`,
      })
    }
  }
  for (const p of projects) {
    if (inGrid(p.start_date)) {
      events.push({
        kind: 'projectStart', key: `ps${p.id}`, date: p.start_date, projectId: p.id,
        label: `Kickoff: ${p.name}`, ariaLabel: `${p.name}: project kickoff ${day(p.start_date)}`,
        tooltip: <><b>Project kickoff</b><br />{p.name}<br />{day(p.start_date)}</>,
        listTitle: `Kickoff: ${p.name}`, listDetail: day(p.start_date),
      })
    }
    if (inGrid(p.projected_end_date)) {
      const overdue = p.projected_end_date < today
      events.push({
        kind: 'projectDue', key: `pd${p.id}`, date: p.projected_end_date, projectId: p.id, overdue,
        label: `Project due: ${p.name}`, ariaLabel: `${p.name}: project due ${day(p.projected_end_date)}${overdue ? ', overdue' : ''}`,
        tooltip: <><b>Project deadline</b><br />{p.name}<br />Due {day(p.projected_end_date)}{overdue ? ' · overdue' : ''}</>,
        listTitle: `Project due: ${p.name}`, listDetail: `${day(p.projected_end_date)}${overdue ? ' · overdue' : ''}`,
      })
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

/**
 * Month calendar of key dates only: project kickoffs and deadlines, and milestone starts and deadlines
 * (deadlines colored by the milestone's state, overdue in red), so busy months stay readable. Everyone sees
 * the open projects they can see. The month and project filter are kept in the URL; clicking a date opens
 * its project.
 */
export default function CalendarPage() {
  const navigate = useNavigate()
  const directory = useDirectory()
  const [searchParams, setSearchParams] = useSearchParams()
  const [shownDay, setShownDay] = useState(null)
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
  const events = keyDates({
    milestones: (data || []).filter((m) => shown(m.project_id)),
    projects: openProjects.filter((p) => shown(p.id)),
    projectName: directory.projectName,
    inGrid: (iso) => iso >= rangeStart && iso <= rangeEnd,
    today,
  })
  const byDay = Map.groupBy(events, (e) => e.date)
  const monthEvents = events.filter((e) => e.date.startsWith(monthParam))
  // The day opened with "+N more"; if a reload leaves it without dates, the dialog simply closes
  const shownDayEvents = shownDay ? byDay.get(shownDay) : undefined

  const open = (event) => { setShownDay(null); navigate(`/projects/${event.projectId}${event.tab ? `?tab=${event.tab}` : ''}`) }
  const title = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <>
      <PageHeader title="Calendar" subtitle="Key dates across your open projects: kickoffs, milestone starts and deadlines." />
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
        <Stack direction="row" spacing={2} sx={{ px: 2, pb: 1.5, flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
          {Object.entries(KINDS).map(([kind, { legend, Icon }]) => (
            <Stack key={kind} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Icon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{legend}</Typography>
            </Stack>
          ))}
          <Typography variant="caption" color="text.secondary">Milestone deadlines by status:</Typography>
          {Object.entries(MILESTONE_STATES).map(([key, s]) => (
            <Stack key={key} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: s.color }} />
              <Typography variant="caption">{s.label}</Typography>
            </Stack>
          ))}
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
          {WEEKDAYS.map((w) => (
            <Typography key={w} variant="caption" sx={{ px: 1, py: 0.75, fontWeight: 600, color: 'text.secondary' }}>{w}</Typography>
          ))}
        </Box>
        {weeks.map((days) => (
          <Box key={days[0]} sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderTop: 1, borderColor: 'divider' }}>
            {days.map((iso, i) => (
              <DayCell key={iso} iso={iso} first={i === 0} today={today} inMonth={parseDay(iso).getMonth() === month.getMonth()}
                events={byDay.get(iso) || []} onOpen={open} onShowDay={setShownDay} />
            ))}
          </Box>
        ))}
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Key dates in {title}</Typography>
          {monthEvents.length === 0 ? (
            <EmptyState title="No key dates this month">Project kickoffs and deadlines, and milestone starts and deadlines, show up here.</EmptyState>
          ) : (
            // A busy month has dozens of dates, so the list scrolls instead of stretching the page
            <Box role="region" aria-label={`Key dates in ${title}`} tabIndex={0}
              sx={{ maxHeight: 480, overflowY: 'auto', '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 } }}>
              <EventList events={monthEvents} onOpen={open} />
            </Box>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(shownDayEvents)} onClose={() => setShownDay(null)} fullWidth maxWidth="xs">
        {shownDayEvents && (
          <>
            <DialogTitle>Key dates on {day(shownDay)}</DialogTitle>
            <DialogContent sx={{ px: 1 }}><EventList events={shownDayEvents} onOpen={open} /></DialogContent>
          </>
        )}
      </Dialog>
    </>
  )
}

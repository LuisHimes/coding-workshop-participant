/** Timeline bar of a project's milestones by date and state, on the projects list and project pages. */

import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { day, todayIso } from '../utils/format'
import { MILESTONE_STATES, daysBetween, milestoneState, parseDay } from '../utils/milestones'

// Tick labels closer than this (percent of the bar) would overlap, so the crowded ones are skipped
const MIN_LABEL_GAP = 11

/** "Oct 13", or "Oct 13, 2026" when `withYear`. */
function tickLabel(iso, withYear) {
  return parseDay(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear && { year: 'numeric' }) })
}

/** Ticks at the start, at each milestone's start, and at the end; labels skip ticks too close to a labelled one. */
function timelineTicks(start, end, milestones, at) {
  const dates = [...new Set([start, ...milestones.map((m) => m.start_date)])].sort()
  const ticks = [...dates.map((iso) => ({ iso, pos: at(iso) })), { iso: end, pos: 100 }]
  let lastLabelled = null
  for (const tick of ticks) {
    const isEnd = tick.pos === 100
    if (lastLabelled && tick.pos - lastLabelled.pos < MIN_LABEL_GAP) {
      if (!isEnd) continue
      lastLabelled.label = null  // the end date matters more than the tick before it
    }
    tick.label = true
    lastLabelled = tick
  }
  let year = null
  for (const tick of ticks.filter((t) => t.label)) {
    const tickYear = tick.iso.slice(0, 4)
    tick.label = tickLabel(tick.iso, tickYear !== year)
    year = tickYear
  }
  return ticks
}

/**
 * A project's timeline as one bar: each milestone is a segment placed by its
 * dates and colored by its state, with a marker for today. Compact mode is
 * for table rows; the full bar adds a summary line and a legend.
 */
export default function ProjectProgressBar({ project, milestones, compact = false }) {
  const today = todayIso()
  const sorted = [...milestones].sort((a, b) => a.sequence - b.sequence)
  const start = [project.start_date, ...sorted.map((m) => m.start_date)].sort()[0]
  const end = [project.projected_end_date, ...sorted.map((m) => m.end_date)].sort().at(-1)
  const span = daysBetween(start, end) + 1
  const at = (iso) => (daysBetween(start, iso) / span) * 100

  const states = sorted.map((m) => milestoneState(m, today))
  const done = states.filter((s) => s === 'completed').length
  const overdue = states.filter((s) => s === 'overdue').length
  const projectDays = daysBetween(project.start_date, project.projected_end_date) + 1
  const timelinePct = Math.min(Math.max(((daysBetween(project.start_date, today) + 1) / projectDays) * 100, 0), 100)
  const showToday = today >= start && today <= end

  const summary = sorted.length === 0
    ? 'No milestones yet'
    : `${done} of ${sorted.length} milestones done · ${Math.round(timelinePct)}% of timeline used${overdue ? ` · ${overdue} overdue` : ''}`
  const label = `${project.name}: ${summary}. ${sorted.map((m, i) => `${m.title} ${MILESTONE_STATES[states[i]].label.toLowerCase()}`).join(', ')}`

  return (
    <Box sx={{ minWidth: compact ? 160 : 0 }}>
      <Box role="img" aria-label={label}
        sx={{ position: 'relative', height: compact ? 10 : 26, borderRadius: 1, bgcolor: 'action.hover', overflow: 'hidden' }}>
        {sorted.map((m, i) => {
          const state = MILESTONE_STATES[states[i]]
          const width = ((daysBetween(m.start_date, m.end_date) + 1) / span) * 100
          return (
            <Tooltip key={m.id} title={
              <>
                <b>{m.sequence}. {m.title}</b><br />
                {state.label} · {day(m.start_date)} – {day(m.end_date)}
              </>
            }>
              <Box sx={{
                position: 'absolute', top: 0, bottom: 0, left: `${at(m.start_date)}%`, width: `${width}%`,
                bgcolor: state.color, color: state.text, borderRight: 2, borderColor: 'background.paper',
                display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, px: 0.75, minWidth: 0,
              }}>
                {!compact && width >= 3 && (
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
                    {m.title}
                  </Box>
                )}
              </Box>
            </Tooltip>
          )
        })}
        {showToday && (
          <Tooltip title={`Today, ${day(today)}`}>
            <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${at(today)}% - 1px)`, width: 3, bgcolor: 'text.primary' }} />
          </Tooltip>
        )}
      </Box>
      {!compact && (
        <Box aria-hidden sx={{ position: 'relative', height: 28 }}>
          {timelineTicks(start, end, sorted, at).map((tick) => (
            <Box key={`${tick.iso}-${tick.pos}`} data-testid="timeline-tick" sx={{ position: 'absolute', left: `${tick.pos}%`, top: 0 }}>
              <Box sx={{ width: '1px', height: 6, bgcolor: 'text.secondary', ml: tick.pos === 100 ? '-1px' : 0 }} />
              {tick.label && (
                <Typography variant="caption" color="text.secondary" sx={{
                  position: 'absolute', top: 6, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                  transform: tick.pos === 0 ? 'none' : tick.pos === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}>
                  {tick.label}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
      <Typography variant="caption" color={overdue ? 'error.main' : 'text.secondary'} sx={{ display: 'block', mt: compact ? 0.5 : 0 }}>
        {compact && sorted.length ? `${done}/${sorted.length} done${overdue ? ` · ${overdue} overdue` : ''}` : summary}
      </Typography>
      {!compact && (
        <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
          {Object.entries(MILESTONE_STATES).filter(([key]) => states.includes(key)).map(([key, s]) => (
            <Stack key={key} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: s.color }} />
              <Typography variant="caption">{s.label}</Typography>
            </Stack>
          ))}
          {showToday && (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 3, height: 12, bgcolor: 'text.primary' }} />
              <Typography variant="caption">Today</Typography>
            </Stack>
          )}
          {sorted.length > 0 && (
            <Typography variant="caption" color="text.secondary">Hover over a milestone for its full name, dates and status.</Typography>
          )}
        </Stack>
      )}
    </Box>
  )
}

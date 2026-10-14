/** "Upcoming deadlines" card: milestone and project end dates in the next few weeks, soonest first. */

import { Link as RouterLink } from 'react-router-dom'
import { Button, Card, CardContent, List, ListItem, ListItemIcon, ListItemText, Stack, Typography } from '@mui/material'
import FlagIcon from '@mui/icons-material/Flag'
import { milestones as milestonesApi } from '../api/endpoints'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../context/DirectoryContext'
import { EmptyState, ErrorAlert, Loading } from './common'
import { day, todayIso } from '../utils/format'
import { addDays, isoDay, parseDay } from '../utils/milestones'

/**
 * Milestones (not yet completed) and projects due within `days` days, across
 * the open projects the viewer can see, soonest first and at most `max` of them.
 * Links to each project and to the calendar.
 */
export default function UpcomingDeadlines({ days = 30, max = 5 }) {
  const directory = useDirectory()
  const today = todayIso()
  const until = isoDay(addDays(parseDay(today), days))
  const milestones = useApiData(() => milestonesApi.list({ start: today, end: until }), [today, until])

  const due = [
    ...(milestones.data || [])
      .filter((m) => m.status !== 'completed' && m.end_date >= today && m.end_date <= until)
      .map((m) => ({ key: `m${m.id}`, date: m.end_date, projectId: m.project_id, title: m.title, kind: 'Milestone' })),
    ...directory.projects
      .filter((p) => !p.archived && p.projected_end_date >= today && p.projected_end_date <= until)
      .map((p) => ({ key: `p${p.id}`, date: p.projected_end_date, projectId: p.id, title: 'Project deadline', kind: 'Project' })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, max)

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>Upcoming deadlines</Typography>
          <Button component={RouterLink} to="/calendar" size="small">Open calendar</Button>
        </Stack>
        <ErrorAlert error={milestones.error} onRetry={milestones.reload} />
        {milestones.loading && !milestones.data ? <Loading /> : due.length === 0 ? (
          <EmptyState title={`Nothing due in the next ${days} days`}>Milestone and project end dates show up here.</EmptyState>
        ) : (
          <List disablePadding>
            {due.map((item) => (
              <ListItem key={item.key} divider disableGutters>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <FlagIcon fontSize="small" sx={{ color: item.kind === 'Project' ? 'secondary.main' : 'warning.main' }} />
                </ListItemIcon>
                <ListItemText
                  primary={`${item.title} · due ${day(item.date)}`}
                  secondary={directory.projectName(item.projectId)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  )
}

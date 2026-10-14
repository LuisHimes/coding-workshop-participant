import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box, Button, Card, CardContent, Checkbox, LinearProgress, Link, List, ListItem, ListItemIcon, ListItemText, Stack,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { milestones as milestonesApi, reports } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../components/Directory'
import { useNotify } from '../components/Notifications'
import { EmptyState, ErrorAlert, Loading, PageHeader, ProjectStatusChip } from '../components/common'
import LogHoursDialog from '../components/LogHoursDialog'
import MessageBoard from '../components/MessageBoard'
import { day, hours } from '../utils/format'

const FULL_WEEK = 40

/** The employee's current milestone: tick off its tasks, or mark their part finished. */
function CurrentWork({ milestoneId, projectId, onChanged }) {
  const { user } = useAuth()
  const directory = useDirectory()
  const notify = useNotify()
  const milestone = useApiData(() => milestonesApi.get(milestoneId), [milestoneId])
  const tasks = useApiData(() => milestonesApi.tasks.list(milestoneId), [milestoneId])
  const [error, setError] = useState(null)

  const run = async (action, message) => {
    setError(null)
    try {
      await action()
      if (message) notify(message)
    } catch (err) {
      setError(err)
    }
  }

  if (milestone.loading && !milestone.data) return <Loading />
  const m = milestone.data
  const done = (tasks.data || []).filter((t) => t.is_done).length
  return (
    <>
      <ErrorAlert error={milestone.error || tasks.error || error} />
      {m && (
        <>
          <Typography variant="h6">{m.sequence}. {m.title}</Typography>
          <Typography variant="body2" color="text.secondary">
            <Link component={RouterLink} to={`/projects/${projectId}?tab=milestones`} underline="hover">{directory.projectName(projectId)}</Link>
            {' · '}due {day(m.end_date)}
          </Typography>
          {m.description && <Typography variant="body2" sx={{ mt: 1 }}>{m.description}</Typography>}
          <Typography variant="subtitle2" sx={{ mt: 2 }}>Tasks · {done} of {tasks.data?.length ?? 0} done</Typography>
          <List dense disablePadding>
            {tasks.data?.map((task) => (
              <ListItem key={task.id} disableGutters>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Checkbox edge="start" size="small" checked={task.is_done}
                    onChange={(e) => run(async () => { await milestonesApi.tasks.update(task.id, { is_done: e.target.checked }); tasks.reload() })}
                    slotProps={{ input: { 'aria-label': `Mark "${task.title}" done` } }} />
                </ListItemIcon>
                <ListItemText primary={task.title}
                  sx={task.is_done ? { '& .MuiListItemText-primary': { textDecoration: 'line-through', color: 'text.secondary' } } : {}} />
              </ListItem>
            ))}
          </List>
          <Button variant="outlined" sx={{ mt: 1 }}
            onClick={() => run(async () => { await milestonesApi.assignments.setFinished(milestoneId, user.id, true); onChanged() },
              'Marked finished. You can start your next milestone.')}>
            Mark my part finished
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            You have one active milestone at a time. Your manager marks the milestone complete.
          </Typography>
        </>
      )}
    </>
  )
}

export default function EmployeeHomePage() {
  const { user } = useAuth()
  const directory = useDirectory()
  const home = useApiData(() => reports.home(), [])
  const [logging, setLogging] = useState(false)
  const h = home.data
  const weekHours = Number(h?.hours_this_week ?? 0)
  const overLimit = weekHours > FULL_WEEK
  const myProjects = directory.projects.filter((p) => !p.archived)

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.first_name}`}
        subtitle="Your current work, this week's hours and your projects."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setLogging(true)}>Log hours</Button>}
      />
      <ErrorAlert error={home.error} onRetry={home.reload} />
      {home.loading && !h ? <Loading /> : h && (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: 'minmax(0, 3fr) minmax(320px, 2fr)', alignItems: 'start' }}>
          <Stack spacing={3}>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Your current milestone</Typography>
                {h.active_milestone_id ? (
                  <CurrentWork key={h.active_milestone_id} milestoneId={h.active_milestone_id} projectId={h.active_project_id} onChanged={home.reload} />
                ) : (
                  <EmptyState title="No active milestone">
                    When your manager starts a milestone you're assigned to, it shows up here.
                  </EmptyState>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Your projects</Typography>
                {myProjects.length === 0 ? (
                  <EmptyState title="You're not on any projects yet">Your manager adds you to projects.</EmptyState>
                ) : (
                  <List disablePadding>
                    {myProjects.map((p) => (
                      <ListItem key={p.id} divider disableGutters secondaryAction={<ProjectStatusChip project={p} />}>
                        <ListItemText
                          primary={<Link component={RouterLink} to={`/projects/${p.id}`} underline="hover" sx={{ fontWeight: 600 }}>{p.name}</Link>}
                          secondary={`Manager: ${directory.userName(p.manager_id)} · due ${day(p.projected_end_date)}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </CardContent>
            </Card>
          </Stack>
          <Stack spacing={3}>
            <Card sx={{ borderLeft: 4, borderLeftColor: overLimit ? 'warning.main' : 'primary.main' }}>
              <CardContent>
                <Typography variant="subtitle1">This week</Typography>
                <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums', mt: 1 }}>
                  {hours(weekHours)} <Typography component="span" color="text.secondary">of {FULL_WEEK} h</Typography>
                </Typography>
                <LinearProgress variant="determinate" value={Math.min((weekHours / FULL_WEEK) * 100, 100)}
                  color={overLimit ? 'warning' : 'primary'} sx={{ height: 8, borderRadius: 4, my: 1.5 }} />
                <Typography variant="body2" color={overLimit ? 'warning.main' : 'text.secondary'}>
                  {overLimit
                    ? `You're over a 40-hour week by ${hours(weekHours - FULL_WEEK)}.`
                    : `${hours(FULL_WEEK - weekHours)} left in a 40-hour week.`}
                </Typography>
                <Button component={RouterLink} to="/time-entries" size="small" sx={{ ml: -1, mt: 1 }}>See your hours</Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Message board</Typography>
                <MessageBoard limit={10} compact />
              </CardContent>
            </Card>
          </Stack>
        </Box>
      )}
      <LogHoursDialog open={logging} onClose={() => setLogging(false)} onLogged={home.reload}
        projectId={null} milestoneId={null} />
    </>
  )
}

import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Card, CardContent, Chip, FormControlLabel, Link, List, ListItem, MenuItem, Stack, Switch, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material'
import { reports, teams as teamsApi } from '../api/endpoints'
import { useRole } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../components/Directory'
import { EmptyState, ErrorAlert, HoursChip, Loading, PageHeader, RiskChip } from '../components/common'
import ProjectHealthTable from '../components/ProjectHealthTable'
import { day, hours, money, percent } from '../utils/format'

const TABS = {
  projects: 'Project status',
  'at-risk': 'At risk',
  budget: 'Budget',
  allocation: 'Resource allocation',
  overtime: 'Overtime',
}

function ProjectStatusReport() {
  const { isAdmin } = useRole()
  const [searchParams, setSearchParams] = useSearchParams()
  const includeArchived = searchParams.get('archived') === 'true'
  const { data, error, loading, reload } = useApiData(() => reports.projects(includeArchived), [includeArchived])
  return (
    <Card>
      <CardContent>
        {isAdmin && <FormControlLabel
          control={<Switch checked={includeArchived} onChange={(e) => setSearchParams({ tab: 'projects', archived: String(e.target.checked) }, { replace: true })} />}
          label="Include archived projects" sx={{ mb: 1 }} />}
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data && <ProjectHealthTable projects={data} />}
      </CardContent>
    </Card>
  )
}

function AtRiskReport() {
  const directory = useDirectory()
  const { data, error, loading, reload } = useApiData(() => reports.atRisk(), [])
  if (loading && !data) return <Loading />
  return (
    <>
      <ErrorAlert error={error} onRetry={reload} />
      {data?.length === 0 && <Card><EmptyState title="No projects at risk">Every open project is on track.</EmptyState></Card>}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {data?.map((p) => (
          <Card key={p.project_id} sx={{ borderLeft: 4, borderLeftColor: p.risk.level === 'off_track' ? 'error.main' : 'warning.main' }}>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Link component={RouterLink} to={`/projects/${p.project_id}`} underline="hover" sx={{ fontWeight: 600, flex: 1 }}>{p.name}</Link>
                <RiskChip risk={p.risk} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {directory.userName(p.manager_id)} · due {day(p.projected_end_date)} · {percent(p.completion_pct)} of milestones done
              </Typography>
              <List dense disablePadding sx={{ mt: 1 }}>
                {p.risk.reasons.map((reason) => (
                  <ListItem key={reason} disableGutters sx={{ py: 0.25, display: 'list-item', listStyle: 'disc', ml: 2 }}>
                    <Typography variant="body2">{reason}</Typography>
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        ))}
      </Box>
    </>
  )
}

function BudgetReport() {
  const { data, error, loading, reload } = useApiData(() => reports.budget(), [])
  return (
    <Card>
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data?.length === 0 ? <EmptyState title="No open projects" /> : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell align="right">Budget</TableCell>
                <TableCell align="right">Estimated cost</TableCell>
                <TableCell align="right">Labor cost so far</TableCell>
                <TableCell align="right">Remaining</TableCell>
                <TableCell align="right">Budget used</TableCell>
                <TableCell align="right">Milestones done</TableCell>
                <TableCell align="right">Hours logged</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.map((b) => (
                <TableRow key={b.project_id}>
                  <TableCell>
                    <Link component={RouterLink} to={`/projects/${b.project_id}`} underline="hover" sx={{ fontWeight: 600 }}>{b.name}</Link>
                    {b.over_budget && <Chip size="small" color="error" label="Over budget" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell align="right">{money(b.budget)}</TableCell>
                  <TableCell align="right">{money(b.estimated_cost)}</TableCell>
                  <TableCell align="right">{money(b.labor_cost)}</TableCell>
                  <TableCell align="right" sx={{ color: b.over_budget ? 'error.main' : undefined }}>{money(b.budget_remaining)}</TableCell>
                  <TableCell align="right">{percent(b.budget_used_pct)}</TableCell>
                  <TableCell align="right">{percent(b.completion_pct)}</TableCell>
                  <TableCell align="right">{hours(b.logged_hours)} / {hours(b.allocated_hours)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 2 }}>
        Labor cost is hours logged × salary ÷ 2,080. Estimated cost is what the team's planned hours cost over the whole timeline.
      </Typography>
    </Card>
  )
}

function AllocationReport({ overAllocatedOnly }) {
  const directory = useDirectory()
  const [searchParams, setSearchParams] = useSearchParams()
  const teamId = searchParams.get('team') || ''
  const teamList = useApiData(() => teamsApi.list({}), [])
  const { data, error, loading, reload } = useApiData(
    () => (overAllocatedOnly ? reports.overAllocated(teamId || undefined) : reports.allocation(teamId || undefined)),
    [overAllocatedOnly, teamId],
  )
  const tab = overAllocatedOnly ? 'overtime' : 'allocation'

  return (
    <Card>
      <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center' }}>
        <TextField id="allocation-team" select label="Team" value={teamId} sx={{ maxWidth: 320 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
          onChange={(e) => setSearchParams(e.target.value ? { tab, team: e.target.value } : { tab }, { replace: true })}>
          <MenuItem value="">Everyone</MenuItem>
          {(teamList.data || []).map((t) => <MenuItem key={t.id} value={String(t.id)}>{t.name} ({directory.userName(t.manager_id)})</MenuItem>)}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {overAllocatedOnly
            ? 'Employees working overtime: planned for more than 40 hours a week across their projects, or logged more than 40 hours last week.'
            : 'Planned hours per week on open projects, against a 40-hour week.'}
        </Typography>
      </Stack>
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data?.length === 0 ? (
        <EmptyState title={overAllocatedOnly ? 'Nobody is working overtime' : 'No employees to show'} />
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell>Planned</TableCell>
                <TableCell>Projects</TableCell>
                <TableCell align="right">Logged last week</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.map((a) => (
                <TableRow key={a.user_id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.first_name} {a.last_name}</Typography>
                    <Typography variant="caption" color="text.secondary">ID {a.user_id}</Typography>
                  </TableCell>
                  <TableCell>{directory.userName(a.manager_id)}</TableCell>
                  <TableCell><HoursChip hours={a.hours_per_week} overLimit={a.over_limit} /></TableCell>
                  <TableCell>
                    {a.projects.length === 0 ? <Typography variant="body2" color="text.secondary">No open projects</Typography> : (
                      <Stack spacing={0.25}>
                        {a.projects.map((p) => (
                          <Typography key={p.project_id} variant="body2">
                            <Link component={RouterLink} to={`/projects/${p.project_id}`} underline="hover">{p.project_name}</Link>
                            {' · '}{Number(p.hours_per_week)} h/week
                          </Typography>
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ color: Number(a.last_week_logged_hours) > 40 ? 'warning.main' : undefined, fontWeight: Number(a.last_week_logged_hours) > 40 ? 600 : undefined }}>
                    {hours(a.last_week_logged_hours)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  )
}

export default function ReportsPage() {
  const { isAdmin } = useRole()
  const [searchParams, setSearchParams] = useSearchParams()
  // Old links used "over-allocated" for the overtime tab
  const requested = searchParams.get('tab') === 'over-allocated' ? 'overtime' : searchParams.get('tab')
  const tab = TABS[requested] ? requested : 'projects'
  return (
    <>
      <PageHeader title="Reports" subtitle={isAdmin
        ? 'Project health, deadline risk, budget and workload across the organization.'
        : 'Health, deadline risk, budget and workload for your projects and the employees on them.'} />
      <Tabs value={tab} onChange={(_, value) => setSearchParams({ tab: value }, { replace: true })} variant="scrollable"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {Object.entries(TABS).map(([value, label]) => <Tab key={value} value={value} label={label} />)}
      </Tabs>
      {tab === 'projects' && <ProjectStatusReport />}
      {tab === 'at-risk' && <AtRiskReport />}
      {tab === 'budget' && <BudgetReport />}
      {tab === 'allocation' && <AllocationReport />}
      {tab === 'overtime' && (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>A full work week is 40 hours across all of an employee's projects. Anything above that is overtime.</Alert>
          <AllocationReport overAllocatedOnly />
        </>
      )}
    </>
  )
}

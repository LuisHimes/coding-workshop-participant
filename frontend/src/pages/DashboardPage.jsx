import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { reports } from '../api/endpoints'
import { useAuth, useRole } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { ErrorAlert, Loading, PageHeader } from '../components/common'
import MessageBoard from '../components/MessageBoard'
import ProjectHealthTable from '../components/ProjectHealthTable'
import { money } from '../utils/format'

function Stat({ label, value, detail, tone, to }) {
  return (
    <Card sx={{ borderLeft: 4, borderLeftColor: tone ? `${tone}.main` : 'divider' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
        {detail && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{detail}</Typography>}
        {to && <Button component={RouterLink} to={to} size="small" sx={{ ml: -1, mt: 0.5 }}>View</Button>}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { isAdmin } = useRole()
  const { data, error, loading, reload } = useApiData(() => reports.home(), [])

  return (
    <>
      <PageHeader title={`Welcome back, ${user.first_name}`} subtitle={isAdmin ? 'Every open project at a glance.' : 'Your open projects at a glance.'} />
      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', mb: 3 }}>
            <Stat label="Open projects" value={data.active_projects} to="/projects" />
            <Stat label="At risk" value={data.projects_at_risk} tone={data.projects_at_risk ? 'warning' : null} to="/reports?tab=at-risk" />
            <Stat label="Off track" value={data.projects_off_track} tone={data.projects_off_track ? 'error' : null} to="/reports?tab=at-risk" />
            <Stat label="Over 40 h/week" value={data.over_allocated_employees} tone={data.over_allocated_employees ? 'warning' : null} to="/reports?tab=over-allocated" />
            <Stat label="Labor cost so far" value={money(data.total_labor_cost)} detail={`of ${money(data.total_budget)} budgeted`} to="/reports?tab=budget" />
          </Box>
          <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: 'minmax(0, 3fr) minmax(320px, 2fr)', alignItems: 'start' }}>
            <Card>
              <CardContent>
                <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ flex: 1 }}>Project status</Typography>
                  <Button component={RouterLink} to="/reports" size="small">Full status report</Button>
                </Stack>
                <ProjectHealthTable projects={data.projects} compact />
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>Message board</Typography>
                <MessageBoard limit={10} compact />
              </CardContent>
            </Card>
          </Box>
        </>
      )}
    </>
  )
}

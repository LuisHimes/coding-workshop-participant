import { useState } from 'react'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Link, List, ListItem, Stack, Tab, Tabs, Typography,
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import ArchiveIcon from '@mui/icons-material/Archive'
import UnarchiveIcon from '@mui/icons-material/Unarchive'
import { projects as projectsApi, reports, timeEntries } from '../api/endpoints'
import { useRole } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../components/Directory'
import { useNotify } from '../components/Notifications'
import {
  ConfirmDialog, ErrorAlert, Field, Loading, PageHeader, ProjectStatusChip, RiskChip,
} from '../components/common'
import ProjectFormDialog from '../components/ProjectFormDialog'
import ProjectProgressBar from '../components/ProjectProgressBar'
import MessageBoard from '../components/MessageBoard'
import TimeEntriesTable from '../components/TimeEntriesTable'
import LogHoursDialog from '../components/LogHoursDialog'
import TeamPanel from '../components/project/TeamPanel'
import MilestonesPanel from '../components/project/MilestonesPanel'
import DeliverablesPanel from '../components/project/DeliverablesPanel'
import { dateTime, day, hours, money, percent } from '../utils/format'

const TABS = ['overview', 'team', 'milestones', 'deliverables', 'hours', 'board']
const TAB_LABELS = { overview: 'Overview', team: 'Team', milestones: 'Milestones', deliverables: 'Deliverables', hours: 'Hours', board: 'Message board' }

function Overview({ project, onChanged }) {
  const directory = useDirectory()
  const { isAdmin, isEmployee } = useRole()
  const notify = useNotify()
  const health = useApiData(
    // Employees never see costs, so they get no health report
    () => (isEmployee ? Promise.resolve(null) : reports.projects(true).then((all) => all.find((p) => p.project_id === project.id) ?? null)),
    [project.id, project.updated_at],
  )
  const milestones = useApiData(() => projectsApi.milestones.list(project.id), [project.id, project.updated_at])
  const [estimate, setEstimate] = useState(null)
  const [estimateError, setEstimateError] = useState(null)
  const h = health.data

  const loadEstimate = async () => {
    setEstimateError(null)
    try {
      setEstimate((await projectsApi.budgetEstimate(project.id)).estimated_cost)
    } catch (err) {
      setEstimateError(err)
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
      <Card sx={{ gridColumn: '1 / -1' }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Progress</Typography>
          <ErrorAlert error={milestones.error} onRetry={milestones.reload} />
          {milestones.data && <ProjectProgressBar project={project} milestones={milestones.data} />}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Details</Typography>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Field label="Manager">{directory.userName(project.manager_id)}</Field>
            <Field label="Status"><ProjectStatusChip project={project} /></Field>
            <Field label="Start date">{day(project.start_date)}</Field>
            <Field label="Projected end">{day(project.projected_end_date)}</Field>
            <Field label="Allocated hours">{hours(project.allocated_hours)}</Field>
            {!isEmployee && <Field label="Budget">{money(project.budget)}</Field>}
            <Box sx={{ gridColumn: '1 / -1' }}><Field label="Description">{project.description}</Field></Box>
            {project.archived && (
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Field label="Archived">
                  {dateTime(project.archived_at)} by {directory.userName(project.archived_by)}
                  {project.archive_reason === 'completed' ? ' (completed)' : ' (deleted)'}
                </Field>
              </Box>
            )}
          </Box>
          {isAdmin && <Box sx={{ mt: 3, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
            <Typography variant="subtitle2">Budget estimate</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              What the team's planned hours cost over the project's timeline: salary ÷ 2,080 × hours per week × weeks.
            </Typography>
            <ErrorAlert error={estimateError} />
            {estimate === null ? (
              <Button size="small" variant="outlined" onClick={loadEstimate}>Calculate</Button>
            ) : (
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <Typography variant="h6">{money(estimate)}</Typography>
                {!project.archived && Number(estimate) !== Number(project.budget) && (
                  <Button size="small" variant="contained" onClick={async () => {
                    try {
                      await projectsApi.update(project.id, { budget: estimate })
                      notify('Budget updated')
                      onChanged()
                    } catch (err) {
                      setEstimateError(err)
                    }
                  }}>Use as budget</Button>
                )}
                <Button size="small" onClick={loadEstimate}>Recalculate</Button>
              </Stack>
            )}
          </Box>}
        </CardContent>
      </Card>

      {!isEmployee && <Card>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 2 }}>Health</Typography>
          <ErrorAlert error={health.error} onRetry={health.reload} />
          {health.loading && !h ? <Loading /> : h && (
            <>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <Field label="Milestones completed">{h.milestones_completed} of {h.milestones_total} ({percent(h.completion_pct)})</Field>
                <Field label="Timeline used">{percent(h.timeline_pct)}</Field>
                <Field label="Hours logged">{hours(h.logged_hours)} of {hours(h.allocated_hours)}</Field>
                <Field label="Team">{h.member_count} {h.member_count === 1 ? 'employee' : 'employees'}</Field>
                <Field label="Labor cost">{money(h.labor_cost)} ({percent(h.budget_used_pct)} of budget)</Field>
                <Field label="Budget remaining">{money(h.budget_remaining)}</Field>
                <Field label="Current milestone">{h.current_milestone}</Field>
                <Field label="Deadline risk"><RiskChip risk={h.risk} /></Field>
              </Box>
              {h.risk.reasons.length > 0 && (
                <Alert severity={h.risk.level === 'off_track' ? 'error' : 'warning'} sx={{ mt: 2 }}>
                  <List dense disablePadding>
                    {h.risk.reasons.map((reason) => <ListItem key={reason} disableGutters sx={{ py: 0 }}>{reason}</ListItem>)}
                  </List>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>}
    </Box>
  )
}

/** Hours on the project: everyone's for managers and admins, your own for employees, who can log more. */
function HoursPanel({ project, editable, canLog }) {
  const { data, error, loading, reload } = useApiData(() => timeEntries.list({ project_id: project.id }), [project.id])
  const [logging, setLogging] = useState(false)
  if (loading && !data) return <Loading />
  return (
    <>
      {canLog && (
        <Box sx={{ p: 2, pb: 0 }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setLogging(true)}>Log hours</Button>
        </Box>
      )}
      <ErrorAlert error={error} onRetry={reload} />
      {data && <TimeEntriesTable entries={data} showProject={false} editable={editable} onChanged={reload} />}
      {canLog && <LogHoursDialog open={logging} projectId={project.id} onClose={() => setLogging(false)} onLogged={reload} />}
    </>
  )
}

export default function ProjectDetailPage() {
  const { projectId } = useParams()
  const id = Number(projectId)
  const directory = useDirectory()
  const notify = useNotify()
  const { isAdmin, isEmployee } = useRole()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview'
  const { data: project, error, loading, reload } = useApiData(() => projectsApi.get(id), [id])
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [unarchiving, setUnarchiving] = useState(false)

  const back = <Link component={RouterLink} to="/projects" underline="hover" variant="body2">← Projects</Link>

  if (loading && !project) return <Loading />
  if (error && !project) return (<><PageHeader title="Project" back={back} /><ErrorAlert error={error} onRetry={reload} /></>)

  const readOnly = project.archived
  const changed = () => { reload(); directory.refresh() }

  return (
    <>
      <PageHeader
        back={back}
        title={project.name}
        subtitle={<ProjectStatusChip project={project} />}
        actions={
          <>
            {!readOnly && !isEmployee && <Button startIcon={<EditIcon />} variant="outlined" onClick={() => setEditing(true)}>Edit</Button>}
            {!isAdmin ? null : readOnly ? (
              <Button startIcon={<UnarchiveIcon />} variant="contained" onClick={() => setUnarchiving(true)}>Unarchive</Button>
            ) : (
              <Button startIcon={<ArchiveIcon />} color="error" variant="outlined"
                onClick={() => setArchiving(true)}>Delete</Button>
            )}
          </>
        }
      />
      {readOnly && (
        <Alert severity="info" sx={{ mb: 2 }}>This project is archived, so it can't be changed. Unarchive it to make changes.</Alert>
      )}
      <Tabs value={tab} onChange={(_, value) => setSearchParams({ tab: value }, { replace: true })}
        variant="scrollable" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t} value={t} label={TAB_LABELS[t]} />)}
      </Tabs>

      {tab === 'overview' && <Overview project={project} onChanged={changed} />}
      {tab === 'team' && <Card><CardContent><TeamPanel project={project} readOnly={readOnly || isEmployee} /></CardContent></Card>}
      {tab === 'milestones' && <MilestonesPanel project={project} readOnly={readOnly} />}
      {tab === 'deliverables' && <Card><CardContent><DeliverablesPanel project={project} /></CardContent></Card>}
      {tab === 'hours' && <Card><HoursPanel project={project} editable={isAdmin || isEmployee} canLog={isEmployee && !readOnly} /></Card>}
      {tab === 'board' && <Card><CardContent><MessageBoard projectId={project.id} readOnly={readOnly} /></CardContent></Card>}

      <ProjectFormDialog open={editing} project={project} onClose={() => setEditing(false)}
        onSaved={(saved) => { reload(); if (saved.archived) notify('Project completed and archived') }} />

      <ConfirmDialog
        open={archiving}
        title="Delete this project?"
        message="Deleting archives the project: its history, hours and audit trail are kept, and an admin can unarchive it."
        confirmLabel="Delete project"
        destructive
        onClose={() => setArchiving(false)}
        // Open projects are only ever deleted: completing a project archives it as completed already
        onConfirm={async () => { await projectsApi.remove(project.id); notify('Project archived'); changed() }}
      />

      <ConfirmDialog
        open={unarchiving}
        title="Unarchive this project?"
        message="It becomes visible to its manager and team again, and can be changed."
        confirmLabel="Unarchive"
        onClose={() => setUnarchiving(false)}
        onConfirm={async () => { await projectsApi.unarchive(project.id); notify('Project restored'); changed() }}
      />
    </>
  )
}

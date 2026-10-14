/** Projects list screen (/projects). */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Card, InputAdornment, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { milestones as milestonesApi, projects as projectsApi } from '../api/endpoints'
import { useRole } from '../context/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDebounced } from '../hooks/useDebounced'
import { useSort } from '../hooks/useSort'
import { useDirectory } from '../context/DirectoryContext'
import { EmptyState, ErrorAlert, Loading, PageHeader, ProjectStatusChip, ScrollingTable, SortableCell } from '../components/common'
import ProjectFormDialog from '../components/ProjectFormDialog'
import ProjectProgressBar from '../components/ProjectProgressBar'
import { PROJECT_STATUS_LABELS, day, hours, money } from '../utils/format'

// The All/Open/Archived toggle (admins only) -> the API's `archived` filter
const ARCHIVED_FILTER = { all: undefined, open: false, archived: true }

/**
 * Searchable list of projects with a progress bar each. Admins see every project, can include or
 * filter archived ones, and create projects; managers see the projects they manage; employees
 * ("My projects") see the projects they work on, without budgets.
 */
export default function ProjectsPage() {
  const navigate = useNavigate()
  const directory = useDirectory()
  const { isAdmin, isEmployee } = useRole()
  const [searchText, setSearchText] = useState('')
  const [status, setStatus] = useState('')
  const [archived, setArchived] = useState('all')
  const [creating, setCreating] = useState(false)
  const search = useDebounced(searchText.trim())
  const { data, error, loading, reload } = useApiData(
    () => projectsApi.list({ q: search || undefined, status: status || undefined, archived: ARCHIVED_FILTER[archived] }),
    [search, status, archived],
  )
  // One call for every open project's milestones, grouped for the progress bars
  const milestones = useApiData(() => milestonesApi.list({}), [])
  const milestonesByProject = Map.groupBy(milestones.data || [], (m) => m.project_id)
  /** Share of a project's milestones that are completed (projects without milestones count as 0). */
  const progress = (project) => {
    const list = milestonesByProject.get(project.id) || []
    return list.length ? list.filter((m) => m.status === 'completed').length / list.length : 0
  }
  const sorting = useSort(data, {
    name: (p) => p.name,
    status: (p) => `${PROJECT_STATUS_LABELS[p.status]}${p.archived ? ' (archived)' : ''}`,
    progress, due: (p) => p.projected_end_date,
    manager: (p) => directory.userName(p.manager_id),
    allocated: (p) => p.allocated_hours,
    budget: (p) => Number(p.budget),
  })

  return (
    <>
      <PageHeader
        title={isEmployee ? 'My projects' : 'Projects'}
        subtitle={isAdmin ? 'Every project, including archived ones.' : isEmployee ? 'The projects you work on.' : 'The projects you manage. Admins create projects and assign their manager.'}
        actions={isAdmin && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New project</Button>}
      />
      <Card>
        <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'center' }}>
          <TextField
            id="project-search"
            placeholder="Search by name or description"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ maxWidth: 360 }}
          />
          <TextField id="project-status-filter" select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}
            sx={{ maxWidth: 180 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
            <MenuItem value="">Any status</MenuItem>
            {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          {isAdmin && (
            <ToggleButtonGroup size="small" exclusive value={archived} onChange={(_, value) => value && setArchived(value)}>
              <ToggleButton value="all">All</ToggleButton>
              <ToggleButton value="open">Open</ToggleButton>
              <ToggleButton value="archived">Archived</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? (
          <Loading />
        ) : data?.length === 0 ? (
          <EmptyState title="No projects match">
            {isAdmin ? 'Change the filters, or create a project.' : isEmployee ? 'Change the filters. Your manager adds you to projects.' : 'Change the filters. Projects appear here once an admin makes you their manager.'}
          </EmptyState>
        ) : (
          <ScrollingTable label="Projects">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <SortableCell label="Name" sortKey="name" sorting={sorting} />
                  <SortableCell label="Status" sortKey="status" sorting={sorting} sx={{ width: 140 }} />
                  {/* One column shows both, so it sorts either way: by milestones done, or by due date */}
                  <TableCell sx={{ width: 220 }}
                    sortDirection={['progress', 'due'].includes(sorting.sort?.key) ? sorting.sort.direction : false}>
                    {/* Stacked, so the two sort controls don't widen the column */}
                    {[['progress', 'Progress'], ['due', 'Due date']].map(([key, label]) => (
                      <span key={key} style={{ display: 'block' }}>
                        <TableSortLabel active={sorting.sort?.key === key} direction={sorting.sort?.key === key ? sorting.sort.direction : 'asc'}
                          onClick={() => sorting.toggle(key)}>{label}</TableSortLabel>
                      </span>
                    ))}
                  </TableCell>
                  <SortableCell label="Manager" sortKey="manager" sorting={sorting} />
                  <SortableCell label="Allocated" sortKey="allocated" sorting={sorting} align="right" />
                  {!isEmployee && <SortableCell label="Budget" sortKey="budget" sorting={sorting} align="right" />}
                </TableRow>
              </TableHead>
              <TableBody>
                {sorting.sorted?.map((project) => (
                  <TableRow key={project.id} hover onClick={() => navigate(`/projects/${project.id}`)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{project.name}</Typography>
                      {project.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 240 }} noWrap>
                          {project.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell><ProjectStatusChip project={project} /></TableCell>
                    <TableCell>
                      {!project.archived && milestones.data && (
                        <ProjectProgressBar project={project} milestones={milestonesByProject.get(project.id) || []} compact />
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap' }}>
                        {day(project.start_date)} – {day(project.projected_end_date)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{directory.userName(project.manager_id)}</TableCell>
                    <TableCell align="right">{hours(project.allocated_hours)}</TableCell>
                    {!isEmployee && <TableCell align="right">{money(project.budget)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollingTable>
        )}
      </Card>
      <ProjectFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(project) => navigate(`/projects/${project.id}`)}
      />
    </>
  )
}

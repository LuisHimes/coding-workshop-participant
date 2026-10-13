import { useState } from 'react'
import { Box, Button, Card, MenuItem, Stack, TextField } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { timeEntries as timeEntriesApi } from '../api/endpoints'
import { useRole } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../components/Directory'
import { ErrorAlert, Loading, PageHeader, UserPicker } from '../components/common'
import TimeEntriesTable from '../components/TimeEntriesTable'
import LogHoursDialog from '../components/LogHoursDialog'

export default function TimeEntriesPage() {
  const directory = useDirectory()
  const { isAdmin, isEmployee } = useRole()
  const [logging, setLogging] = useState(false)
  const [filters, setFilters] = useState({ user_id: null, project_id: '', start: '', end: '' })
  const { data, error, loading, reload } = useApiData(
    () => timeEntriesApi.list({
      user_id: filters.user_id || undefined,
      project_id: filters.project_id || undefined,
      start: filters.start || undefined,
      end: filters.end || undefined,
    }),
    [filters.user_id, filters.project_id, filters.start, filters.end],
  )
  const employees = directory.users.filter((u) => u.role === 'employee')

  return (
    <>
      <PageHeader
        title={isEmployee ? 'My hours' : 'Hours'}
        subtitle={isAdmin
          ? 'Hours employees logged. Admins can correct or delete any entry.'
          : isEmployee ? 'Hours you logged. A full week is 40 hours across all of your projects.' : 'Hours employees logged on your projects.'}
        actions={isEmployee && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setLogging(true)}>Log hours</Button>}
      />
      <Card>
        <Stack direction="row" spacing={2} sx={{ p: 2 }}>
          {!isEmployee && (
            <Box sx={{ width: 260 }}>
              <UserPicker label="Employee" options={employees} value={filters.user_id} onChange={(id) => setFilters({ ...filters, user_id: id })} />
            </Box>
          )}
          <TextField id="hours-project" select label="Project" value={filters.project_id} sx={{ maxWidth: 280 }}
            onChange={(e) => setFilters({ ...filters, project_id: e.target.value })}>
            <MenuItem value="">Any project</MenuItem>
            {directory.projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</MenuItem>)}
          </TextField>
          <TextField id="hours-start" label="From" type="date" value={filters.start} sx={{ maxWidth: 180 }}
            onChange={(e) => setFilters({ ...filters, start: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField id="hours-end" label="To" type="date" value={filters.end} sx={{ maxWidth: 180 }}
            onChange={(e) => setFilters({ ...filters, end: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data && <TimeEntriesTable entries={data} editable={isAdmin || isEmployee} onChanged={reload} />}
      </Card>
      <LogHoursDialog open={logging} onClose={() => setLogging(false)} onLogged={reload} />
    </>
  )
}

/** Project page "Deliverables" tab. */

import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material'
import { projects as projectsApi } from '../../api/endpoints'
import { useApiData } from '../../hooks/useApiData'
import { useDirectory } from '../../context/DirectoryContext'
import { EmptyState, ErrorAlert, Loading, MilestoneStatusChip } from '../common'
import { day, percent } from '../../utils/format'

/**
 * The dependency chain: milestones in order, what each waits on, task progress
 * and who is assigned. Read-only, so it looks the same for every role.
 */
export default function DeliverablesPanel({ project }) {
  const directory = useDirectory()
  const { data, error, loading, reload } = useApiData(() => projectsApi.deliverables(project.id), [project.id])

  if (loading && !data) return <Loading />
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        What the project delivers, milestone by milestone: what each one waits on, how many of its tasks are done, and who is working on it.
      </Typography>
      <ErrorAlert error={error} onRetry={reload} />
      {data?.length === 0 && <EmptyState title="No deliverables yet">Add milestones to see the dependency chain.</EmptyState>}
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {data?.map((d, index) => (
          <Box component="li" key={d.milestone_id} sx={{ display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr)', gap: 2 }}>
            <Stack sx={{ alignItems: 'center' }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14,
                bgcolor: d.status === 'completed' ? 'success.main' : d.status === 'in_progress' ? 'primary.main' : 'action.disabledBackground',
                color: d.status === 'not_started' ? 'text.secondary' : 'common.white',
              }}>
                {d.sequence}
              </Box>
              {index < data.length - 1 && <Box sx={{ flex: 1, width: 2, bgcolor: 'divider', my: 0.5 }} />}
            </Stack>
            <Box sx={{ pb: 3 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography sx={{ fontWeight: 600 }}>{d.title}</Typography>
                <MilestoneStatusChip status={d.status} />
                {d.overdue && <Chip size="small" color="error" label="Overdue" />}
                {d.blocked && <Chip size="small" variant="outlined" label={`Waiting on milestone ${d.sequence - 1}`} />}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {day(d.start_date)} – {day(d.end_date)}
                {d.depends_on_milestone_id ? ` · depends on milestone ${d.sequence - 1}` : ' · first milestone'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1, maxWidth: 420 }}>
                <LinearProgress variant="determinate" value={Number(d.completion_pct)} sx={{ flex: 1, height: 6, borderRadius: 3 }}
                  color={d.status === 'completed' ? 'success' : 'primary'} />
                <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                  {percent(d.completion_pct)} · {d.tasks_done}/{d.tasks_total} tasks
                </Typography>
              </Stack>
              {d.assignees.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  Assigned: {d.assignees.map((id) => directory.userName(id)).join(', ')}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

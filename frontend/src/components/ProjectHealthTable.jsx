/** Project health table shown on the dashboard and the reports page. */

import { Link as RouterLink } from 'react-router-dom'
import {
  Box, LinearProgress, Link, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { useDirectory } from '../context/DirectoryContext'
import { EmptyState, RiskChip } from './common'
import { day, money, percent } from '../utils/format'

/** A thin progress bar with its percentage; the bar stops at 100% but the label shows the real value. */
function Progress({ value, color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
      <LinearProgress variant="determinate" value={Math.min(Number(value ?? 0), 100)} color={color}
        sx={{ flex: 1, height: 6, borderRadius: 3 }} />
      <Typography variant="caption" sx={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {percent(value)}
      </Typography>
    </Box>
  )
}

/**
 * Status, completion, budget and deadline risk of each project (from /reports/projects
 * or /reports/home). `compact` drops the manager, timeline, budget and cost columns.
 */
export default function ProjectHealthTable({ projects, compact = false }) {
  const directory = useDirectory()
  if (!projects.length) return <EmptyState title="No projects to show" />
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Project</TableCell>
            {!compact && <TableCell>Manager</TableCell>}
            <TableCell>Milestones done</TableCell>
            {!compact && <TableCell>Timeline used</TableCell>}
            {!compact && <TableCell>Budget used</TableCell>}
            {!compact && <TableCell align="right">Labor cost / budget</TableCell>}
            <TableCell>Due</TableCell>
            <TableCell>Risk</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {projects.map((p) => (
            <TableRow key={p.project_id} hover>
              <TableCell>
                <Link component={RouterLink} to={`/projects/${p.project_id}`} underline="hover" sx={{ fontWeight: 600 }}>
                  {p.name}
                </Link>
                {p.current_milestone && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Now: {p.current_milestone}</Typography>
                )}
              </TableCell>
              {!compact && <TableCell>{directory.userName(p.manager_id)}</TableCell>}
              <TableCell>
                <Progress value={p.completion_pct} />
                <Typography variant="caption" color="text.secondary">{p.milestones_completed} of {p.milestones_total}</Typography>
              </TableCell>
              {!compact && <TableCell><Progress value={p.timeline_pct} color="secondary" /></TableCell>}
              {!compact && (
                <TableCell>
                  <Progress value={p.budget_used_pct} color={Number(p.budget_used_pct) > 100 ? 'error' : 'primary'} />
                </TableCell>
              )}
              {!compact && (
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {money(p.labor_cost)} / {money(p.budget)}
                </TableCell>
              )}
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{day(p.projected_end_date)}</TableCell>
              <TableCell><RiskChip risk={p.risk} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

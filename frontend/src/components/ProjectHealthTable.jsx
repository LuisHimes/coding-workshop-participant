/** Project health table shown on the dashboard and the reports page. */

import { Link as RouterLink } from 'react-router-dom'
import {
  Box, LinearProgress, Link, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { useDirectory } from '../context/DirectoryContext'
import { useSort } from '../hooks/useSort'
import { EmptyState, RiskChip, ScrollingTable, SortableCell } from './common'
import { day, money, percent } from '../utils/format'

// Risk sorts from least to most serious
const RISK_ORDER = { on_track: 0, at_risk: 1, off_track: 2 }

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
 * or /reports/home). `compact` drops the manager, timeline, budget and cost columns and doesn't
 * scroll or sort (the dashboard); the full table scrolls on its own with the headings kept in view,
 * and every column sorts.
 */
export default function ProjectHealthTable({ projects, compact = false }) {
  const directory = useDirectory()
  const sorting = useSort(projects, {
    name: (p) => p.name, manager: (p) => directory.userName(p.manager_id), completion: (p) => Number(p.completion_pct),
    timeline: (p) => (p.timeline_pct === null ? null : Number(p.timeline_pct)),
    budgetUsed: (p) => (p.budget_used_pct === null ? null : Number(p.budget_used_pct)),
    laborCost: (p) => Number(p.labor_cost), due: (p) => p.projected_end_date, risk: (p) => RISK_ORDER[p.risk.level],
  })
  if (!projects.length) return <EmptyState title="No projects to show" />
  const Container = compact ? TableContainer : ScrollingTable
  /** A heading: sortable on the full table, plain on the compact one. */
  const heading = (label, sortKey, align) => (compact
    ? <TableCell align={align}>{label}</TableCell>
    : <SortableCell label={label} sortKey={sortKey} sorting={sorting} align={align} />)
  return (
    <Container label="Project status">
      <Table size="small" stickyHeader={!compact}>
        <TableHead>
          <TableRow>
            {heading('Project', 'name')}
            {!compact && heading('Manager', 'manager')}
            {heading('Milestones done', 'completion')}
            {!compact && heading('Timeline used', 'timeline')}
            {!compact && heading('Budget used', 'budgetUsed')}
            {!compact && heading('Labor cost / budget', 'laborCost', 'right')}
            {heading('Due', 'due')}
            {heading('Risk', 'risk')}
          </TableRow>
        </TableHead>
        <TableBody>
          {sorting.sorted.map((p) => (
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
    </Container>
  )
}

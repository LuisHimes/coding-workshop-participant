/** Audit log screen (/audit), admins only. */

import { useState } from 'react'
import {
  Box, Button, Card, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Typography,
} from '@mui/material'
import { audit as auditApi } from '../api/endpoints'
import { useApiData } from '../hooks/useApiData'
import { useDebounced } from '../hooks/useDebounced'
import { useDirectory } from '../context/DirectoryContext'
import { EmptyState, ErrorAlert, Loading, PageHeader, UserPicker } from '../components/common'
import { dateTime } from '../utils/format'

// Backend table names -> labels for the "What changed" filter and the Record column
const ENTITIES = {
  users: 'Users',
  projects: 'Projects',
  project_members: 'Project members',
  milestones: 'Milestones',
  milestone_tasks: 'Milestone tasks',
  milestone_assignments: 'Milestone assignments',
  time_entries: 'Hours',
  messages: 'Messages',
  teams: 'Teams',
  team_members: 'Team members',
}
const ACTION_COLORS = { INSERT: 'success', UPDATE: 'primary', DELETE: 'error', LOGIN: 'default', LOGIN_FAILED: 'warning' }
const ACTION_LABELS = { INSERT: 'Created', UPDATE: 'Changed', DELETE: 'Deleted', LOGIN: 'Logged in', LOGIN_FAILED: 'Failed login' }
// Bookkeeping fields that would only add noise to the details
const HIDDEN_FIELDS = new Set(['created_at', 'updated_at', 'manager_role', 'member_role'])

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** A logged field value as text: timestamps as local date and time, objects as JSON, missing as "—". */
function formatValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string' && TIMESTAMP.test(value)) return dateTime(value)
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** A one-line description of a created or deleted record, from its most recognizable fields. */
function summarize(record) {
  if (record.name) return record.name
  if (record.title) return record.title
  if (record.first_name) return `${record.first_name} ${record.last_name}${record.role ? ` (${record.role})` : ''}`
  if (record.body) return record.body.length > 80 ? `${record.body.slice(0, 80)}…` : record.body
  if (record.hours) return `${record.hours} h on ${record.work_date}`
  if (record.user_id) return `User ${record.user_id}`
  return null
}

/**
 * UPDATE entries list "field: old → new". INSERT and DELETE entries show a
 * one-line summary, with every field one click away.
 */
function Changes({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const changes = entry.changes
  if (!changes) return <Typography variant="body2" color="text.secondary">—</Typography>
  const isUpdate = entry.action === 'UPDATE'
  const rows = Object.entries(changes).filter(([key]) => !HIDDEN_FIELDS.has(key))
  const summary = isUpdate ? null : summarize(changes)

  if (summary && !expanded) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{summary}</Typography>
        <Button size="small" onClick={() => setExpanded(true)} sx={{ flexShrink: 0, py: 0 }}>Show all fields</Button>
      </Stack>
    )
  }
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.25, fontSize: 13 }}>
      {rows.map(([key, value]) => (
        <Box key={key} sx={{ display: 'contents' }}>
          <Box component="dt" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{key}</Box>
          <Box component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
            {isUpdate && value && typeof value === 'object' && 'old' in value ? `${formatValue(value.old)} → ${formatValue(value.new)}` : formatValue(value)}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Admin-only log of every change and login, newest first, filterable by record
 * type, record ID, who did it and date. The record ID filter waits for typing to pause.
 */
export default function AuditPage() {
  const directory = useDirectory()
  const [filters, setFilters] = useState({ entity: '', entity_id: '', actor_id: null, since: '', limit: 100 })
  const entityId = useDebounced(filters.entity_id.trim())
  const { data, error, loading, reload } = useApiData(
    () => auditApi.list({
      entity: filters.entity || undefined,
      entity_id: entityId || undefined,
      actor_id: filters.actor_id || undefined,
      since: filters.since ? new Date(`${filters.since}T00:00:00`).toISOString() : undefined,
      limit: filters.limit,
    }),
    [filters.entity, entityId, filters.actor_id, filters.since, filters.limit],
  )

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change and login: what was done, by whom, and when. Newest first." />
      <Card>
        <Stack direction="row" spacing={2} sx={{ p: 2 }}>
          <TextField id="audit-entity" select label="What changed" value={filters.entity} sx={{ maxWidth: 220 }} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
            onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
            <MenuItem value="">Anything</MenuItem>
            {Object.entries(ENTITIES).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField id="audit-entity-id" label="Record ID" value={filters.entity_id} sx={{ maxWidth: 160 }}
            onChange={(e) => setFilters({ ...filters, entity_id: e.target.value })} helperText="e.g. a project number or user ID" />
          <Box sx={{ width: 260 }}>
            <UserPicker label="Done by" options={directory.users} value={filters.actor_id} onChange={(id) => setFilters({ ...filters, actor_id: id })} />
          </Box>
          <TextField id="audit-since" label="Since" type="date" value={filters.since} sx={{ maxWidth: 180 }}
            onChange={(e) => setFilters({ ...filters, since: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField id="audit-limit" select label="Show" value={filters.limit} sx={{ maxWidth: 120 }}
            onChange={(e) => setFilters({ ...filters, limit: e.target.value })}>
            {[100, 250, 500, 1000].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </TextField>
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.length === 0 ? <EmptyState title="Nothing matches these filters" /> : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Record</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.map((entry) => (
                  <TableRow key={entry.id} sx={{ verticalAlign: 'top' }}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{dateTime(entry.occurred_at)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{entry.actor_id ? directory.userName(entry.actor_id) : 'System'}</TableCell>
                    <TableCell><Chip size="small" label={ACTION_LABELS[entry.action] ?? entry.action} color={ACTION_COLORS[entry.action] ?? 'default'} /></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{ENTITIES[entry.entity] ?? entry.entity} {entry.entity_id && `#${entry.entity_id}`}</TableCell>
                    <TableCell sx={{ minWidth: 260 }}><Changes entry={entry} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </>
  )
}

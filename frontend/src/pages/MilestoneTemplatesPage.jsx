/** Milestone templates screen (/milestone-templates) for managers and admins. */

import { useState } from 'react'
import {
  Box, Button, Card, IconButton, InputAdornment, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import SearchIcon from '@mui/icons-material/Search'
import { milestones as milestonesApi } from '../api/endpoints'
import { useRole } from '../context/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDebounced } from '../hooks/useDebounced'
import { useDirectory } from '../context/DirectoryContext'
import { useNotify } from '../context/NotificationsContext'
import MilestoneTemplateDialog from '../components/MilestoneTemplateDialog'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading, PageHeader, UserPicker } from '../components/common'

/** "1 day" or "5 days". */
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`

/**
 * Managers' predefined milestones: create, edit and delete them; they're added to projects from the
 * Milestones tab. Managers see their own templates; admins see every manager's and can filter by manager.
 */
export default function MilestoneTemplatesPage() {
  const directory = useDirectory()
  const notify = useNotify()
  const { isAdmin } = useRole()
  const [searchText, setSearchText] = useState('')
  const [managerId, setManagerId] = useState(null)
  const search = useDebounced(searchText.trim())
  const { data, error, loading, reload } = useApiData(
    () => milestonesApi.templates.list({ q: search || undefined, manager_id: managerId || undefined }),
    [search, managerId],
  )
  const [editing, setEditing] = useState(null)  // a template, 'new', or null
  const [deleting, setDeleting] = useState(null)
  const managers = directory.users.filter((u) => u.role === 'manager' && u.is_active)

  return (
    <>
      <PageHeader
        title="Milestone templates"
        subtitle={isAdmin
          ? 'Lists of milestones each manager plans often, added to their projects in one step.'
          : 'Lists of milestones you plan often (for example Plan, Build, Test, Launch). Add one to a project from its Milestones tab, then pick the dates.'}
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>New template</Button>}
      />
      <Card>
        <Stack direction="row" spacing={2} sx={{ p: 2 }}>
          <TextField id="template-search" placeholder="Search by name" value={searchText} onChange={(e) => setSearchText(e.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ maxWidth: 320 }} />
          {isAdmin && (
            <Box sx={{ width: 280 }}>
              <UserPicker label="Manager" options={managers} value={managerId} onChange={setManagerId} />
            </Box>
          )}
        </Stack>
        <ErrorAlert error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.length === 0 ? (
          <EmptyState title="No milestone templates yet">
            Save a set of milestones you use often, then add it to any project in one step instead of entering each milestone by hand.
          </EmptyState>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Template</TableCell>
                  {isAdmin && <TableCell>Manager</TableCell>}
                  <TableCell>Milestones, in order</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell sx={{ verticalAlign: 'top' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{template.name}</Typography>
                      {template.description && <Typography variant="caption" color="text.secondary">{template.description}</Typography>}
                    </TableCell>
                    {isAdmin && <TableCell sx={{ verticalAlign: 'top' }}>{directory.userName(template.manager_id)}</TableCell>}
                    <TableCell>
                      <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
                        {template.milestones.map((m) => (
                          <Typography component="li" variant="body2" key={m.id}>
                            {m.title}
                            {m.duration_days && <Typography component="span" variant="caption" color="text.secondary"> · usually {days(m.duration_days)}</Typography>}
                          </Typography>
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <Tooltip title="Edit"><IconButton size="small" aria-label={`Edit ${template.name}`} onClick={() => setEditing(template)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" aria-label={`Delete ${template.name}`} onClick={() => setDeleting(template)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <MilestoneTemplateDialog open={editing !== null} template={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)} onSaved={reload} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete this template?" confirmLabel="Delete template" destructive
        message={deleting && `"${deleting.name}" will be deleted. Milestones already added to projects from it stay as they are.`}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await milestonesApi.templates.remove(deleting.id); notify('Template deleted'); reload() }} />
    </>
  )
}

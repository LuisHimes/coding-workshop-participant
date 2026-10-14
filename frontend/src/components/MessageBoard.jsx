import { useState } from 'react'
import {
  Box, Button, IconButton, List, ListItem, ListItemText, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { messages as messagesApi } from '../api/endpoints'
import { useAuth, useRole } from '../auth/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from './Directory'
import { useNotify } from './Notifications'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading } from './common'
import { dateTime } from '../utils/format'

/**
 * The message board. `filterable` adds a picker to switch between all boards
 * and one project's board, plus "Show older posts" (the home page uses this).
 */
export default function MessageBoard({ filterable = false, ...props }) {
  return filterable ? <FilterableBoard {...props} /> : <Board {...props} />
}

function FilterableBoard({ limit: pageSize = 20, compact = false }) {
  const directory = useDirectory()
  const { isAdmin } = useRole()
  const [boardId, setBoardId] = useState('')
  const [limit, setLimit] = useState(pageSize)
  const boards = directory.projects.filter((p) => !p.archived)
  const allBoardsHelp = isAdmin ? 'Announcements and every project\'s board.' : 'Announcements to everyone, plus the boards of your projects.'
  return (
    <>
      <TextField id="board-filter" select label="Show posts from" value={boardId} sx={{ mb: 2 }}
        onChange={(e) => { setBoardId(e.target.value); setLimit(pageSize) }}
        helperText={boardId ? 'Only this project\'s board. New posts go to this project.' : allBoardsHelp}
        slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}>
        <MenuItem value="">All boards</MenuItem>
        {boards.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
      </TextField>
      <Board key={boardId || 'all'} projectId={boardId ? Number(boardId) : null} limit={limit} compact={compact}
        onShowMore={() => setLimit((current) => current + pageSize)} />
    </>
  )
}

/**
 * Posts and the form to add one. With projectId it shows one project's board;
 * without, announcements plus the reader's projects' posts. Admins can post to
 * everyone or any project, managers to their own projects. Authors delete their
 * own posts; admins delete any.
 */
function Board({ projectId = null, limit = 50, compact = false, readOnly = false, onShowMore }) {
  const directory = useDirectory()
  const notify = useNotify()
  const { user } = useAuth()
  const { isAdmin } = useRole()
  const { data, error, loading, reload } = useApiData(
    () => messagesApi.list({ project_id: projectId ?? undefined, limit }),
    [projectId, limit],
  )
  const [body, setBody] = useState('')
  const [chosenTarget, setTarget] = useState(null)
  const projectTargets = directory.projects.filter((p) => !p.archived)
  // Admins default to an announcement; managers can only post to their projects
  const target = projectId ?? chosenTarget ?? (isAdmin ? 'everyone' : projectTargets[0]?.id ?? '')
  const canPost = projectId !== null || isAdmin || projectTargets.length > 0
  const [busy, setBusy] = useState(false)
  const [postError, setPostError] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const post = async (event) => {
    event.preventDefault()
    setBusy(true)
    setPostError(null)
    try {
      await messagesApi.post(body.trim(), target === 'everyone' ? null : Number(target))
      setBody('')
      notify('Posted')
      reload()
    } catch (err) {
      setPostError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      {!readOnly && !canPost && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You can post here once you manage a project.
        </Typography>
      )}
      {!readOnly && canPost && (
        <Stack component="form" spacing={1.5} onSubmit={post} sx={{ mb: 2 }}>
          <ErrorAlert error={postError} />
          <TextField
            id={`message-body-${projectId ?? 'all'}`}
            label="Write a message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            multiline
            minRows={compact ? 2 : 3}
            required
            slotProps={{ htmlInput: { maxLength: 5000 } }}
          />
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            {projectId === null && (
              <TextField
                id="message-target"
                select
                label="Post to"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                sx={{ maxWidth: 320 }}
              >
                {isAdmin && <MenuItem value="everyone">Everyone (announcement)</MenuItem>}
                {projectTargets.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                ))}
              </TextField>
            )}
            <Box sx={{ flex: 1 }} />
            <Button type="submit" variant="contained" disabled={busy || !body.trim()}>Post</Button>
          </Stack>
        </Stack>
      )}

      <ErrorAlert error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data?.length === 0 ? (
        <EmptyState title="No messages yet">{readOnly ? null : 'Posts appear here, newest first.'}</EmptyState>
      ) : (
        <List disablePadding>
          {data?.map((message) => (
            <ListItem
              key={message.id}
              divider
              alignItems="flex-start"
              disableGutters
              secondaryAction={
                !readOnly && (isAdmin || message.author_id === user.id) && (
                  <Tooltip title="Delete">
                    <IconButton edge="end" size="small" onClick={() => setDeleting(message)} aria-label="Delete message">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              }
            >
              <ListItemText
                primary={<Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', pr: 4 }}>{message.body}</Typography>}
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    {message.author_name} · {dateTime(message.created_at)}
                    {projectId === null && ` · ${directory.projectName(message.project_id)}`}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
      {onShowMore && data?.length >= limit && (
        <Button size="small" onClick={onShowMore} sx={{ mt: 1, ml: -1 }}>Show older posts</Button>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this message?"
        message="It will be removed from the board for everyone."
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await messagesApi.remove(deleting.id)
          notify('Message deleted')
          reload()
        }}
      />
    </Box>
  )
}

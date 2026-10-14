/** Message board: announcements and project posts, used on the dashboards and project pages. */

import { useState } from 'react'
import {
  Box, Button, IconButton, List, ListItem, ListItemText, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import { messages as messagesApi } from '../api/endpoints'
import { useAuth, useRole } from '../context/AuthContext'
import { useApiData } from '../hooks/useApiData'
import { useDirectory } from '../context/DirectoryContext'
import { useNotify } from '../context/NotificationsContext'
import { ConfirmDialog, EmptyState, ErrorAlert, Loading } from './common'
import { dateTime } from '../utils/format'

/**
 * The message board. `filterable` adds a picker to switch between all boards
 * and one project's board, posts that scroll inside the card, and "Show older
 * posts" (the home page uses this).
 */
export default function MessageBoard({ filterable = false, ...props }) {
  return filterable ? <FilterableBoard {...props} /> : <Board {...props} />
}

/** The board with a "Show posts from" picker and paging by `limit` posts. Picking a project resets the paging. */
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
      <Board key={boardId || 'all'} projectId={boardId ? Number(boardId) : null} limit={limit} compact={compact} scrollable
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
function Board({ projectId = null, limit = 50, compact = false, readOnly = false, scrollable = false, onShowMore }) {
  const directory = useDirectory()
  const notify = useNotify()
  const { user } = useAuth()
  const { isAdmin } = useRole()
  const { data, error, loading, reload } = useApiData(
    () => messagesApi.list({ project_id: projectId ?? undefined, limit }),
    [projectId, limit],
  )
  const [body, setBody] = useState('')
  const [chosenTarget, setChosenTarget] = useState(null)
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
                onChange={(e) => setChosenTarget(e.target.value)}
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
      {/* On the home page the posts scroll inside the card, so it doesn't grow with every post. Focusable so
          keyboard users can scroll it with the arrow keys. */}
      <Box {...(scrollable && {
        role: 'region', 'aria-label': 'Posts', tabIndex: 0,
        // At most 480 px, and short enough that the whole card fits on screen beside the dashboard's project list
        sx: { maxHeight: 'min(480px, calc(100vh - 440px))', minHeight: 200, overflowY: 'auto', pr: 1, '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 } },
      })}>
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
      </Box>

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

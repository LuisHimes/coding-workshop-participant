import { useState } from 'react'
import { Card, CardContent, MenuItem, TextField } from '@mui/material'
import { useDirectory } from '../components/Directory'
import { PageHeader } from '../components/common'
import MessageBoard from '../components/MessageBoard'

export default function MessagesPage() {
  const directory = useDirectory()
  const [projectId, setProjectId] = useState('')

  return (
    <>
      <PageHeader
        title="Message board"
        subtitle="Announcements go to everyone; project posts reach that project's manager and team."
        actions={
          <TextField id="board-project" select label="Board" value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 240 }}>
            <MenuItem value="">All boards</MenuItem>
            {directory.projects.filter((p) => !p.archived).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
        }
      />
      <Card>
        <CardContent>
          <MessageBoard key={projectId || 'all'} projectId={projectId ? Number(projectId) : null} limit={200} />
        </CardContent>
      </Card>
    </>
  )
}

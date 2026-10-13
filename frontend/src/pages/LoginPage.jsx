import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { useAuth } from '../auth/AuthContext'
import { ErrorAlert } from '../components/common'

export default function LoginPage() {
  const { login, notice } = useAuth()
  const navigate = useNavigate()
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(userId.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" component="h1">Project Tracker</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
            Log in with your 6-character user ID.
          </Typography>
          {notice && <Alert severity="info" sx={{ mb: 2 }}>{notice}</Alert>}
          <ErrorAlert error={error} />
          <Stack component="form" spacing={2} onSubmit={submit}>
            <TextField
              id="user-id"
              label="User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value.toUpperCase())}
              autoComplete="username"
              autoFocus
              required
              slotProps={{ htmlInput: { maxLength: 6, style: { letterSpacing: '0.1em' } } }}
            />
            <TextField
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}

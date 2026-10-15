/** Login screen (/login), the only screen for visitors who aren't logged in. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { useAuth } from '../context/AuthContext'
import { ErrorAlert } from '../components/common'
import { ColorModeButton } from '../components/ColorModeButton'

/**
 * Email and password login. Shows why the user was logged out (for example an expired session), if known,
 * and warns while Caps Lock is on, since passwords are case-sensitive.
 */
export default function LoginPage() {
  const { login, notice } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  // Browsers only report Caps Lock on keyboard events, so check it on every key press in the form
  const checkCapsLock = (event) => setCapsLock(event.getModifierState('CapsLock'))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
      <Box sx={{ position: 'fixed', top: 12, right: 12 }}><ColorModeButton /></Box>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" component="h1">Project Tracker</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
            Log in with your work email.
          </Typography>
          {notice && <Alert severity="info" sx={{ mb: 2 }}>{notice}</Alert>}
          <ErrorAlert error={error} />
          <Stack component="form" spacing={2} onSubmit={submit} onKeyDown={checkCapsLock} onKeyUp={checkCapsLock}>
            <TextField
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
            <TextField
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              helperText={capsLock ? 'Caps Lock is on' : ''}
              slotProps={{ formHelperText: { sx: { color: 'warning.main' } } }}
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

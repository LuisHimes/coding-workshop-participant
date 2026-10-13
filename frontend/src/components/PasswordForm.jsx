import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import { auth } from '../api/endpoints'
import { ErrorAlert } from './common'

/** Change the logged-in user's password. Calls onChanged after success. */
export default function PasswordForm({ onChanged, submitLabel = 'Change password', currentLabel = 'Current password' }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const mismatch = confirm.length > 0 && confirm !== next
  const tooShort = next.length > 0 && next.length < 8

  const submit = async (event) => {
    event.preventDefault()
    if (mismatch || tooShort) return
    setBusy(true)
    setError(null)
    try {
      await auth.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      await onChanged?.()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack component="form" spacing={2} onSubmit={submit}>
      <ErrorAlert error={error} />
      <TextField id="current-password" label={currentLabel} type="password" value={current}
        onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      <TextField id="new-password" label="New password" type="password" value={next}
        onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required
        error={tooShort} helperText={tooShort ? 'Use at least 8 characters' : 'At least 8 characters'} />
      <TextField id="confirm-password" label="Confirm new password" type="password" value={confirm}
        onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required
        error={mismatch} helperText={mismatch ? "The passwords don't match" : ' '} />
      <Button type="submit" variant="contained" disabled={busy || mismatch || tooShort}>
        {busy ? 'Saving…' : submitLabel}
      </Button>
    </Stack>
  )
}

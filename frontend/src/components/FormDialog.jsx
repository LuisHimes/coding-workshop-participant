/** Generic dialog wrapper for create/edit forms. */

import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material'
import { ErrorAlert } from './common'

/**
 * A dialog with a form. onSubmit may be async: the dialog shows the API's
 * error message and stays open if it fails, and closes when it succeeds.
 */
export default function FormDialog({ open, title, submitLabel = 'Save', onSubmit, onClose, children, maxWidth = 'sm', disabled }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (busy) return
    setError(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth={maxWidth}>
      <form onSubmit={submit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <ErrorAlert error={error} />
          <Stack spacing={2} sx={{ pt: 1 }}>{children}</Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || disabled}>{submitLabel}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

import { useState } from 'react'
import { Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import { auth } from '../api/endpoints'
import { useAuth } from '../auth/AuthContext'
import { ErrorAlert, Field, PageHeader } from '../components/common'
import { useNotify } from '../components/Notifications'
import PasswordForm from '../components/PasswordForm'
import { ROLE_LABELS, money } from '../utils/format'

export default function ProfilePage() {
  const { user, refreshUser } = useAuth()
  const notify = useNotify()
  const [form, setForm] = useState({ first_name: user.first_name, last_name: user.last_name, email: user.email })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.updateMe(form)
      await refreshUser()
      notify('Profile saved')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Your profile" subtitle="Job title, salary and role are set by an admin." />
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>Details</Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', mb: 3 }}>
              <Field label="User ID">{user.id}</Field>
              <Field label="Role">{ROLE_LABELS[user.role]}</Field>
              <Field label="Job title">{user.job_title}</Field>
              {'salary' in user && <Field label="Salary">{money(user.salary)}</Field>}
            </Box>
            <ErrorAlert error={error} />
            <Stack component="form" spacing={2} onSubmit={save}>
              <Stack direction="row" spacing={2}>
                <TextField id="first-name" label="First name" value={form.first_name} required
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                <TextField id="last-name" label="Last name" value={form.last_name} required
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </Stack>
              <TextField id="email" label="Email" type="email" value={form.email} required
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Box>
                <Button type="submit" variant="contained" disabled={busy}>Save details</Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>Password</Typography>
            <PasswordForm onChanged={() => notify('Password changed')} />
          </CardContent>
        </Card>
      </Box>
    </>
  )
}

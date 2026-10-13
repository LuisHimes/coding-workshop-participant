import { Box, Button, Card, CardContent, Typography } from '@mui/material'
import { useAuth } from '../auth/AuthContext'
import { useNotify } from '../components/Notifications'
import PasswordForm from '../components/PasswordForm'

/** Shown after logging in with a temporary password; nothing else is available until it's changed. */
export default function ChangePasswordPage() {
  const { user, refreshUser, logout } = useAuth()
  const notify = useNotify()

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, bgcolor: 'background.default' }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" component="h1">Set your password</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
            Welcome, {user.first_name}. You logged in with a temporary password; choose a permanent one to continue.
          </Typography>
          <PasswordForm
            currentLabel="Temporary password"
            submitLabel="Save and continue"
            onChanged={async () => {
              await refreshUser()
              notify('Password saved')
            }}
          />
          <Button onClick={() => logout()} sx={{ mt: 1 }} fullWidth>Log out</Button>
        </CardContent>
      </Card>
    </Box>
  )
}

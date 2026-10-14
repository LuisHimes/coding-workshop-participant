import { useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import {
  MILESTONE_STATUS_LABELS, PROJECT_STATUS_LABELS, RISK_LABELS, ROLE_LABELS, fullName,
} from '../utils/format'

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <Stack direction="row" spacing={2} sx={{ mb: 3, alignItems: 'flex-end' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {back}
        <Typography variant="h5" component="h1" sx={{ textWrap: 'balance' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  )
}

export function ErrorAlert({ error, onRetry }) {
  if (!error) return null
  return (
    <Alert
      severity="error"
      sx={{ mb: 2 }}
      action={onRetry && <Button color="inherit" size="small" onClick={onRetry}>Try again</Button>}
    >
      {error.message || String(error)}
    </Alert>
  )
}

export function Loading({ label = 'Loading…' }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 6, justifyContent: 'center', alignItems: 'center', color: 'text.secondary' }}>
      <CircularProgress size={20} />
      <Typography variant="body2">{label}</Typography>
    </Stack>
  )
}

export function EmptyState({ title, children }) {
  return (
    <Box sx={{ py: 5, px: 2, textAlign: 'center', color: 'text.secondary' }}>
      <Typography variant="subtitle1" sx={{ color: 'text.primary' }}>{title}</Typography>
      {children && <Typography variant="body2" sx={{ mt: 0.5 }}>{children}</Typography>}
    </Box>
  )
}

/** A yes/no question before something destructive. onConfirm may be async; errors stay in the dialog. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', destructive, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [wasOpen, setWasOpen] = useState(open)

  // Clear a previous attempt's error each time the dialog opens
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setError(null)
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={error} />
        {message && <DialogContentText>{message}</DialogContentText>}
        {children}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={confirm} disabled={busy} variant="contained" color={destructive ? 'error' : 'primary'}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const PROJECT_STATUS_COLORS = { planning: 'default', active: 'primary', completed: 'success' }
const MILESTONE_STATUS_COLORS = { not_started: 'default', in_progress: 'primary', completed: 'success' }
const RISK_COLORS = { on_track: 'success', at_risk: 'warning', off_track: 'error' }
const ROLE_COLORS = { admin: 'secondary', manager: 'primary', employee: 'default' }

export function ProjectStatusChip({ project }) {
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap' }}>
      <Chip size="small" label={PROJECT_STATUS_LABELS[project.status]} color={PROJECT_STATUS_COLORS[project.status]} />
      {project.archived && (
        <Chip size="small" variant="outlined" label={project.archive_reason === 'deleted' ? 'Archived (deleted)' : 'Archived'} />
      )}
    </Stack>
  )
}

export function MilestoneStatusChip({ status }) {
  return <Chip size="small" label={MILESTONE_STATUS_LABELS[status]} color={MILESTONE_STATUS_COLORS[status]} />
}

export function RiskChip({ risk }) {
  const chip = <Chip size="small" label={RISK_LABELS[risk.level]} color={RISK_COLORS[risk.level]} />
  if (!risk.reasons?.length) return chip
  return (
    <Tooltip title={<Box component="ul" sx={{ m: 0, pl: 2 }}>{risk.reasons.map((r) => <li key={r}>{r}</li>)}</Box>}>
      {chip}
    </Tooltip>
  )
}

export function RoleChip({ role }) {
  return <Chip size="small" label={ROLE_LABELS[role]} color={ROLE_COLORS[role]} variant={role === 'employee' ? 'outlined' : 'filled'} />
}

export function HoursChip({ hours, overLimit, label }) {
  return (
    <Chip
      size="small"
      color={overLimit ? 'warning' : 'default'}
      variant={overLimit ? 'filled' : 'outlined'}
      label={`${label ? `${label} ` : ''}${Number(hours)} h/week${overLimit ? ' · overtime' : ''}`}
    />
  )
}

/** Pick a user by name or ID. `options` is a list of users; `value` and `onChange` use the user ID. */
export function UserPicker({ label, options, value, onChange, required, disabled, helperText, error }) {
  const selected = options.find((u) => u.id === value) || null
  return (
    <Autocomplete
      options={options}
      value={selected}
      disabled={disabled}
      onChange={(_, user) => onChange(user ? user.id : null)}
      getOptionLabel={(u) => `${fullName(u)} (${u.id})`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderInput={(params) => (
        <TextField {...params} label={label} required={required} helperText={helperText} error={error} />
      )}
    />
  )
}

/** A label above a value, for read-only details. */
export function Field({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ overflowWrap: 'anywhere' }}>{children ?? '—'}</Typography>
    </Box>
  )
}

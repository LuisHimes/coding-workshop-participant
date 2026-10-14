/** Display formatting. The API sends money and hours as decimal strings ("50000.00"). */

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
// Two decimals so quarter hours show exactly (40.25 h, not 40.3 h)
const hourNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function money(value) {
  return value === null || value === undefined ? '—' : currency.format(Number(value))
}

export function hours(value) {
  return value === null || value === undefined ? '—' : `${hourNumber.format(Number(value))} h`
}

export function percent(value) {
  return value === null || value === undefined ? '—' : `${number.format(Number(value))}%`
}

/** "2026-10-13" -> "Oct 13, 2026" without timezone shifts. */
export function day(value) {
  if (!value) return '—'
  const [year, month, date] = String(value).slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function dateTime(value) {
  return value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export function fullName(user) {
  return user ? `${user.first_name} ${user.last_name}` : ''
}

export function todayIso() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }
export const PROJECT_STATUS_LABELS = { planning: 'Planning', active: 'Active', completed: 'Completed' }
export const MILESTONE_STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' }
export const RISK_LABELS = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' }

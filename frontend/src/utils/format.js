/** Display formatting. The API sends money and hours as decimal strings ("50000.00"). */

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
// Two decimals so quarter hours show exactly (40.25 h, not 40.3 h)
const hourNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** Whole US dollars ("$50,000"), or "—" when missing. */
export function money(value) {
  return value === null || value === undefined ? '—' : currency.format(Number(value))
}

/** Hours with up to two decimals ("40.25 h"), or "—" when missing. */
export function hours(value) {
  return value === null || value === undefined ? '—' : `${hourNumber.format(Number(value))} h`
}

/** A percentage with up to one decimal ("62.5%"), or "—" when missing. */
export function percent(value) {
  return value === null || value === undefined ? '—' : `${number.format(Number(value))}%`
}

/** "2026-10-13" -> "Oct 13, 2026" without timezone shifts. */
export function day(value) {
  if (!value) return '—'
  const [year, month, date] = String(value).slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A timestamp in the browser's timezone ("Oct 13, 2026, 2:05 PM"), or "—" when missing. */
export function dateTime(value) {
  return value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

/** "First Last" for a user, or an empty string when there is no user. */
export function fullName(user) {
  return user ? `${user.first_name} ${user.last_name}` : ''
}

/** Today's date in the browser's timezone as "YYYY-MM-DD" (toISOString alone would use UTC). */
export function todayIso() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }
export const PROJECT_STATUS_LABELS = { planning: 'Planning', active: 'Active', completed: 'Completed' }
export const MILESTONE_STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' }
export const RISK_LABELS = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' }

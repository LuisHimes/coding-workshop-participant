/** Milestone states and calendar-day helpers shared by the progress bar and the calendar. */

import { todayIso } from './format'

/** A milestone's status, with "overdue" for unfinished milestones past their end date. */
export function milestoneState(milestone, today = todayIso()) {
  if (milestone.status === 'completed') return 'completed'
  if (milestone.end_date < today) return 'overdue'
  return milestone.status
}

// Same colors as the status chips, plus red for overdue
export const MILESTONE_STATES = {
  completed: { label: 'Completed', color: 'success.main', text: 'success.contrastText' },
  in_progress: { label: 'In progress', color: 'primary.main', text: 'primary.contrastText' },
  not_started: { label: 'Not started', color: 'grey.300', text: 'text.primary' },
  overdue: { label: 'Overdue', color: 'error.main', text: 'error.contrastText' },
}

/** "2026-10-13" -> a local Date at midnight, so no timezone shifts. */
export function parseDay(iso) {
  const [year, month, date] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, date)
}

export function isoDay(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Whole days from a to b (ISO strings), ignoring daylight-saving shifts. */
export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000)
}

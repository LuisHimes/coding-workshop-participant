import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { useSort } from '../hooks/useSort'
import { admin, respond } from './fakeApi'

function renderAt(path) {
  localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

/** The first cell's text of each body row in a scrolling table. */
const firstColumn = (regionName) => within(screen.getByRole('region', { name: regionName }))
  .getAllByRole('row').slice(1).map((row) => row.cells[0].textContent)

/** Clicks a column heading's sort control. */
const sortBy = (label) => fireEvent.click(screen.getByRole('button', { name: label }))

describe('useSort', () => {
  const rows = [
    { name: 'beta', amount: 10, note: null }, { name: 'Alpha', amount: 2, note: 'x' },
    { name: 'gamma', amount: 2, note: '' }, { name: 'alpha 10', amount: null, note: 'y' }, { name: 'alpha 9', amount: 5, note: 'z' },
  ]
  const columns = { name: (r) => r.name, amount: (r) => r.amount, note: (r) => r.note }

  it('keeps the original order until a column is picked, then sorts text ignoring case and numbers by value', () => {
    const { result } = renderHook(() => useSort(rows, columns))
    expect(result.current.sorted).toBe(rows)
    act(() => result.current.toggle('name'))
    expect(result.current.sort).toEqual({ key: 'name', direction: 'asc' })
    expect(result.current.sorted.map((r) => r.name)).toEqual(['Alpha', 'alpha 9', 'alpha 10', 'beta', 'gamma'])  // 9 before 10
    act(() => result.current.toggle('name'))
    expect(result.current.sorted.map((r) => r.name)).toEqual(['gamma', 'beta', 'alpha 10', 'alpha 9', 'Alpha'])
    act(() => result.current.toggle('name'))  // a third click goes back to ascending
    expect(result.current.sort).toEqual({ key: 'name', direction: 'asc' })
  })

  it('puts empty values last in both directions and keeps ties in their original order', () => {
    const { result } = renderHook(() => useSort(rows, columns))
    act(() => result.current.toggle('amount'))
    expect(result.current.sorted.map((r) => r.name)).toEqual(['Alpha', 'gamma', 'alpha 9', 'beta', 'alpha 10'])
    act(() => result.current.toggle('amount'))
    expect(result.current.sorted.map((r) => r.name)).toEqual(['beta', 'alpha 9', 'Alpha', 'gamma', 'alpha 10'])
    act(() => result.current.toggle('note'))  // a new column starts ascending; null and '' both count as empty
    expect(result.current.sorted.map((r) => r.note)).toEqual(['x', 'y', 'z', null, ''])
  })

  it('handles data that has not loaded yet', () => {
    const { result } = renderHook(() => useSort(null, columns))
    act(() => result.current.toggle('name'))
    expect(result.current.sorted).toBeNull()
  })
})

describe('sortable tables', () => {
  it('users sort by name, role, manager, salary and status, and say which column is sorted', async () => {
    const people = [
      { ...admin, id: 'MGR001', role: 'manager', first_name: 'Mia', last_name: 'Manager', email: 'mia@example.com', salary: '150000.00' },
      { ...admin, id: 'EMP001', role: 'employee', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com', salary: '104000.00', manager_id: 'MGR001' },
      { ...admin, id: 'EMP002', role: 'employee', first_name: 'Zed', last_name: 'Quinn', email: 'zed@example.com', salary: '90000.00', manager_id: 'MGR001', is_active: false },
      admin,
    ]
    respond('GET /api/users', people)
    renderAt('/users')
    await screen.findByText('Zed Quinn')
    sortBy('Name')
    expect(firstColumn('People').map((t) => t.replace(/@.*/, ''))).toEqual(['Ada Adminada', 'Grace Hoppergrace', 'Mia Managermia', 'Zed Quinnzed'])
    expect(screen.getByRole('columnheader', { name: 'Name' }).getAttribute('aria-sort')).toBe('ascending')
    sortBy('Salary')
    sortBy('Salary')
    expect(firstColumn('People')[0]).toMatch(/^Mia Manager/)
    expect(firstColumn('People').at(-1)).toMatch(/^Ada Admin/)  // admins have no salary, so they sort last
    expect(screen.getByRole('columnheader', { name: 'Salary' }).getAttribute('aria-sort')).toBe('descending')
    sortBy('Status')
    expect(firstColumn('People').at(-1)).toMatch(/^Zed Quinn/)  // "Active" before "Deactivated"; ties keep their order
    sortBy('Role')
    expect(firstColumn('People')[0]).toMatch(/^Ada Admin/)
    sortBy('Manager')
    expect(firstColumn('People').slice(0, 2).map((t) => t.slice(0, 5))).toEqual(['Grace', 'Zed Q'])  // those with a manager first
    // The other columns don't sort
    expect(screen.queryByRole('button', { name: 'Job title' })).toBeNull()
  })

  it('projects sort by every column, including progress or due date in the shared column', async () => {
    renderAt('/projects')
    await screen.findByText('Old intranet')
    for (const label of ['Name', 'Status', 'Manager', 'Allocated', 'Budget']) sortBy(label)
    sortBy('Progress')
    sortBy('Progress')
    expect(firstColumn('Projects')[0]).toMatch(/^Decommission/)  // most progress first (the archived one has no milestones)
    const header = screen.getByRole('columnheader', { name: /Progress/ })
    expect(header.getAttribute('aria-sort')).toBe('descending')
    sortBy('Due date')
    expect(header.getAttribute('aria-sort')).toBe('ascending')
  })

  it('the project status report sorts by every column; the dashboard\'s compact table does not sort', async () => {
    const health = (id, name, extra) => ({
      project_id: id, name, status: 'active', archived: false, manager_id: 'MGR001', start_date: '2026-09-01', projected_end_date: '2027-01-01',
      allocated_hours: 100, logged_hours: '10.00', budget: '1000.00', labor_cost: '100.00', budget_remaining: '900.00', estimated_cost: '900.00',
      member_count: 1, milestones_total: 2, milestones_completed: 1, completion_pct: '50', current_milestone: null, milestones_overdue: 0,
      timeline_pct: '10', budget_used_pct: '10', risk: { level: 'on_track', reasons: [] }, ...extra,
    })
    respond('GET /api/reports/projects', [
      health(1, 'Bravo', { risk: { level: 'off_track', reasons: ['Late'] } }),
      health(2, 'Alpha', { timeline_pct: null, budget_used_pct: null }),
    ])
    const { unmount } = renderAt('/reports')
    await screen.findByText('Bravo')
    for (const label of ['Project', 'Manager', 'Milestones done', 'Timeline used', 'Budget used', 'Labor cost / budget', 'Due']) sortBy(label)
    sortBy('Risk')
    expect(firstColumn('Project status')).toEqual(['Alpha', 'Bravo'])  // on track before off track
    sortBy('Risk')
    expect(firstColumn('Project status')).toEqual(['Bravo', 'Alpha'])
    unmount()

    renderAt('/')
    await screen.findByText('Project status')
    expect(screen.queryByRole('button', { name: 'Risk' })).toBeNull()
  })

  it('the budget and allocation reports sort by every column', async () => {
    const budget = (id, name, extra) => ({
      project_id: id, name, budget: '1000.00', estimated_cost: '900.00', labor_cost: '100.00', budget_remaining: '900.00',
      budget_used_pct: '10', completion_pct: '0', allocated_hours: 100, logged_hours: '10.00', over_budget: false, ...extra,
    })
    respond('GET /api/reports/budget', [budget(1, 'Big', { budget: '9000.00' }), budget(2, 'Small', { budget: '10.00', budget_used_pct: null })])
    const { unmount } = renderAt('/reports?tab=budget')
    await screen.findByText('Small')
    for (const label of ['Project', 'Estimated cost', 'Labor cost so far', 'Remaining', 'Budget used', 'Milestones done', 'Hours logged']) sortBy(label)
    sortBy('Budget')
    expect(firstColumn('Budget by project')).toEqual(['Small', 'Big'])
    unmount()

    const person = (id, first, extra) => ({
      user_id: id, first_name: first, last_name: 'Test', manager_id: 'MGR001', hours_per_week: '20.0', over_limit: false, projects: [],
      last_week_logged_hours: '20.00', ...extra,
    })
    respond('GET /api/reports/allocation', [
      person('EMP001', 'Una', { projects: [{ project_id: 1, project_name: 'P', hours_per_week: '20.0' }] }),
      person('EMP002', 'Ava', { hours_per_week: '45.0', last_week_logged_hours: '45.00' }),
    ])
    renderAt('/reports?tab=allocation')
    await screen.findByText('Una Test')
    for (const label of ['Employee', 'Manager', 'Planned', 'Logged last week']) sortBy(label)
    sortBy('Projects')
    expect(firstColumn('Employees and their planned hours').map((t) => t.slice(0, 3))).toEqual(['Ava', 'Una'])  // fewest projects first
  })

  it('hours sort by every column, with the total staying at the bottom', async () => {
    const entry = (id, date, hours, description) => ({
      id, user_id: 'EMP001', project_id: 1, milestone_id: null, work_date: date, hours, description, created_at: '', updated_at: '',
    })
    respond('GET /api/time-entries', [entry(1, '2026-10-05', '8.00', 'Cabling'), entry(2, '2026-10-01', '2.50', null), entry(3, '2026-10-09', '4.00', 'Audit')])
    renderAt('/time-entries')
    await screen.findByText('Cabling')
    for (const label of ['Employee', 'Project', 'Description']) sortBy(label)
    sortBy('Hours')
    const hoursColumn = () => within(screen.getByRole('region', { name: 'Time entries' })).getAllByRole('row').slice(1, -1).map((r) => r.cells[4].textContent)
    expect(hoursColumn()).toEqual(['2.5 h', '4 h', '8 h'])
    sortBy('Date')
    expect(firstColumn('Time entries')).toEqual(['Oct 1, 2026', 'Oct 5, 2026', 'Oct 9, 2026', 'Total'])
  })

  it('audit entries sort by every column', async () => {
    respond('GET /api/audit', [
      { id: 4, occurred_at: '2026-10-04T09:00:00Z', actor_id: null, action: 'PURGE', entity: 'archive', entity_id: null, changes: null },
      { id: 3, occurred_at: '2026-10-03T09:00:00Z', actor_id: 'ADMIN1', action: 'INSERT', entity: 'teams', entity_id: '5', changes: { name: 'Racking crew' } },
      { id: 2, occurred_at: '2026-10-02T09:00:00Z', actor_id: 'ADMIN1', action: 'UPDATE', entity: 'projects', entity_id: '1', changes: { budget: { old: 1, new: 2 }, updated_at: { old: 'a', new: 'b' } } },
    ])
    renderAt('/audit')
    await screen.findByText('Racking crew')
    for (const label of ['Who', 'Action', 'Record', 'Details']) sortBy(label)
    sortBy('When')
    await waitFor(() => expect(firstColumn('Audit log entries')[0]).toMatch(/Oct 2, 2026/))
    sortBy('Record')
    // "archive" (no label, no ID) sorts by its raw name; system actions show as System
    expect(within(screen.getByRole('region', { name: 'Audit log entries' })).getAllByRole('row')[1].textContent).toContain('archive')
    expect(screen.getByText('System')).toBeTruthy()
  })
})

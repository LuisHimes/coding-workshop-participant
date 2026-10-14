import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { admin, calls, respond, unexpected, users } from './fakeApi'

function renderAt(path, { loggedIn = true } = {}) {
  if (loggedIn) localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

const manager = { ...admin, id: 'MGR001', role: 'manager', first_name: 'Mia', last_name: 'Manager', salary: '150000.00' }
const employee = { ...admin, id: 'EMP001', role: 'employee', first_name: 'Grace', last_name: 'Hopper', job_title: 'Engineer', manager_id: 'MGR001' }
const alan = { ...employee, id: 'EMP002', first_name: 'Alan', last_name: 'Turing' }
const retired = { ...employee, id: 'EMP003', first_name: 'Old', last_name: 'Timer', is_active: false }

const asManager = (path) => {
  respond('GET /api/auth/me', manager)
  return renderAt(path)
}
const asEmployee = (path) => {
  respond('GET /api/auth/me', employee)
  return renderAt(path)
}

// Same shapes as the fake backend's data, for overriding one field at a time
const project = {
  id: 1, name: 'Decommission 1000 servers', description: 'Retire the old data center', manager_id: 'MGR001', status: 'active',
  start_date: '2026-09-01', projected_end_date: '2027-08-31', allocated_hours: 4000, budget: '250000.00',
  archived_at: null, archived_by: null, archive_reason: null, archived: false,
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-02T09:00:00Z',
}
const archivedProject = { ...project, id: 2, name: 'Old intranet', status: 'planning', archived: true, archived_at: '2026-10-01T10:00:00Z', archived_by: 'ADMIN1', archive_reason: 'deleted' }
const m1 = {
  id: 10, project_id: 1, sequence: 1, title: 'Q1: 250 servers', description: 'First batch', start_date: '2026-09-01',
  end_date: '2026-11-30', status: 'in_progress', completed_at: null, created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z',
}
const m2 = { ...m1, id: 11, sequence: 2, title: 'Q2: 500 servers', description: null, status: 'not_started', start_date: '2026-12-01', end_date: '2027-02-28' }
const member = (userId, hours = '45.0', id = 1) => ({ id, project_id: 1, user_id: userId, hours_per_week: hours, assigned_by: 'MGR001', assigned_at: '2026-09-02T09:00:00Z' })
const task = (id, title, isDone, doneBy = null) => ({ id, milestone_id: 10, title, is_done: isDone, done_at: isDone ? '2026-10-01T09:00:00Z' : null, done_by: doneBy, created_at: '', updated_at: '' })
const assignment = (userId, finishedAt = null, id = 1) => ({ id, milestone_id: 10, project_id: 1, user_id: userId, assigned_at: '2026-09-02T09:00:00Z', finished_at: finishedAt })
const health = {
  project_id: 1, name: project.name, status: 'active', archived: false, manager_id: 'MGR001', start_date: project.start_date,
  projected_end_date: project.projected_end_date, allocated_hours: 4000, logged_hours: '120.00', budget: '250000.00',
  labor_cost: '6000.00', budget_remaining: '244000.00', estimated_cost: '240000.00', member_count: 1, milestones_total: 2,
  milestones_completed: 0, completion_pct: '0', current_milestone: 'Q1: 250 servers', milestones_overdue: 0,
  timeline_pct: '12.3', budget_used_pct: '2.4', risk: { level: 'at_risk', reasons: ['Behind schedule'] },
}

const lastBody = (route) => JSON.parse(calls.findLast((c) => c.route === route).body)
const called = (route) => calls.filter((c) => c.route === route).length

/** Picks an option in a MUI select (TextField select) or Autocomplete by its accessible name. */
async function choose(container, comboboxName, optionName) {
  const combobox = within(container).getByRole('combobox', { name: comboboxName })
  if (combobox.tagName === 'INPUT') fireEvent.keyDown(combobox, { key: 'ArrowDown' })
  else fireEvent.mouseDown(combobox)
  fireEvent.click(await screen.findByRole('option', { name: optionName }))
}

// Only Date is faked, so "today" is fixed while promises and timers run normally
const onDay = (iso) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${iso}T12:00:00`))
}
afterEach(() => vi.useRealTimers())

describe('projects list', () => {
  it('searches by name once typing stops, ignoring blank searches', async () => {
    renderAt('/projects')
    // The file's first render also loads the app's modules, so allow it longer on a busy machine
    expect(await screen.findByText('Old intranet', {}, { timeout: 5000 })).toBeTruthy()
    const search = screen.getByPlaceholderText('Search by name or description')
    fireEvent.change(search, { target: { value: '   ' } })
    fireEvent.change(search, { target: { value: '  servers ' } })
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/projects').query).toEqual({ q: 'servers' }))
    expect(calls.some((c) => c.route === 'GET /api/projects' && 'q' in c.query && c.query.q.trim() === '')).toBe(false)
  })

  it('filters by status and by archived state', async () => {
    renderAt('/projects')
    expect(await screen.findByText('Old intranet')).toBeTruthy()
    await choose(document.body, /Status/, 'Active')
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/projects').query).toEqual({ status: 'active' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }))
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/projects').query).toEqual({ status: 'active', archived: 'true' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/projects').query).toEqual({ status: 'active', archived: 'false' }))

    // Clicking the selected toggle again doesn't clear the filter
    const before = called('GET /api/projects')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('true')
    expect(called('GET /api/projects')).toBe(before)
  })

  it.each([
    ['admin', admin, 'Change the filters, or create a project.'],
    ['manager', manager, 'Change the filters. Projects appear here once an admin makes you their manager.'],
    ['employee', employee, 'Change the filters. Your manager adds you to projects.'],
  ])('tells a %s what to do when no project matches', async (_, me, hint) => {
    respond('GET /api/auth/me', me)
    respond('GET /api/projects', [])
    renderAt('/projects')
    expect(await screen.findByText('No projects match')).toBeTruthy()
    expect(screen.getByText(hint)).toBeTruthy()
  })

  it('shows the API error when projects fail to load', async () => {
    respond('GET /api/projects', { detail: 'Database unavailable' }, 503)
    renderAt('/projects')
    expect(await screen.findByText('Database unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows projects without a description or milestones, and opens a project on click', async () => {
    const bare = { ...project, id: 3, name: 'Build new DC', description: null }
    respond('GET /api/projects', [project, bare])
    renderAt('/projects')
    const row = (await screen.findByText('Build new DC')).closest('tr')
    expect(within(row).getByText('No milestones yet')).toBeTruthy()
    expect(row.querySelectorAll('.MuiTypography-caption')).toHaveLength(2)  // no description line, just progress and dates
    fireEvent.click(screen.getByText('Decommission 1000 servers'))
    expect(await screen.findByRole('heading', { name: 'Decommission 1000 servers' })).toBeTruthy()
    expect(window.location.pathname).toBe('/projects/1')
  })

  it('still lists projects with their dates when milestones fail to load', async () => {
    respond('GET /api/milestones', { detail: 'boom' }, 500)
    renderAt('/projects')
    const row = (await screen.findByText('Decommission 1000 servers')).closest('tr')
    expect(within(row).getByText('Sep 1, 2026 – Aug 31, 2027')).toBeTruthy()
    expect(within(row).queryByRole('img')).toBeNull()
  })

  it('the compact progress bar counts overdue milestones', async () => {
    onDay('2026-12-05')
    renderAt('/projects')
    expect(await screen.findByText('0/2 done · 1 overdue')).toBeTruthy()
  })
})

describe('project form', () => {
  const inactiveManager = { ...manager, id: 'MGR002', first_name: 'Max', last_name: 'Gone', is_active: false }

  it('a new project starts today, even when the app was opened on an earlier day', async () => {
    onDay('2026-10-13')
    renderAt('/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    let dialog = await screen.findByRole('dialog', { name: 'New project' })
    expect(within(dialog).getByLabelText(/Start date/).value).toBe('2026-10-13')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    vi.setSystemTime(new Date('2026-10-14T00:30:00'))
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    dialog = await screen.findByRole('dialog', { name: 'New project' })
    expect(within(dialog).getByLabelText(/Start date/).value).toBe('2026-10-14')
  })

  it('admins create a project and land on it', async () => {
    onDay('2026-10-14')
    respond('GET /api/users', [...users, inactiveManager])
    respond('POST /api/projects', { ...project, id: 3, name: 'New DC' })
    respond('GET /api/projects/3', { ...project, id: 3, name: 'New DC' })
    respond('GET /api/projects/3/milestones', [])
    renderAt('/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    const create = within(dialog).getByRole('button', { name: 'Create project' })
    expect(create.disabled).toBe(true)  // no manager yet

    // Only active managers can be picked
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: /Manager/ }), { key: 'ArrowDown' })
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Mia Manager (MGR001)'])
    fireEvent.click(screen.getByRole('option', { name: 'Mia Manager (MGR001)' }))

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: '  New DC  ' } })
    fireEvent.change(within(dialog).getByLabelText(/Projected end date/), { target: { value: '2026-01-01' } })
    expect(within(dialog).getByText('Must be on or after the start date')).toBeTruthy()
    expect(create.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Projected end date/), { target: { value: '2027-06-30' } })
    expect(within(dialog).queryByText('Must be on or after the start date')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText(/Allocated hours/), { target: { value: '100' } })
    expect(within(dialog).getByText('Use the budget estimate once the team is set')).toBeTruthy()
    expect(within(dialog).queryByLabelText(/^Status/)).toBeNull()  // new projects start in planning
    fireEvent.click(create)

    expect(await screen.findByRole('heading', { name: 'New DC' })).toBeTruthy()
    expect(lastBody('POST /api/projects')).toEqual({
      name: 'New DC', description: null, manager_id: 'MGR001', start_date: '2026-10-14', projected_end_date: '2027-06-30',
      allocated_hours: 100, budget: '0',
    })
    expect(window.location.pathname).toBe('/projects/3')
  })

  it('keeps the dialog open with the API error, and cancel closes it', async () => {
    respond('POST /api/projects', { detail: 'A project with that name exists' }, 409)
    renderAt('/projects')
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog')
    await choose(dialog, /Manager/, 'Mia Manager (MGR001)')
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Dup' } })
    fireEvent.change(within(dialog).getByLabelText(/Projected end date/), { target: { value: '2030-01-01' } })
    fireEvent.change(within(dialog).getByLabelText(/Allocated hours/), { target: { value: '10' } })
    fireEvent.change(within(dialog).getByLabelText(/Budget/), { target: { value: '5000' } })
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: ' A copy ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await within(dialog).findByText('A project with that name exists')).toBeTruthy()
    expect(lastBody('POST /api/projects')).toMatchObject({ budget: '5000', description: 'A copy' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.pathname).toBe('/projects')
  })

  it('admins edit every field and only send the status when it changes', async () => {
    respond('GET /api/projects/1', { ...project, description: null })
    respond('PATCH /api/projects/1', { ...project, archived: false })
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
    expect(within(dialog).getByLabelText(/Description/).value).toBe('')
    expect(within(dialog).getByText('Completing a project archives it; every milestone must be completed first.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/Budget/), { target: { value: '260000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(lastBody('PATCH /api/projects/1')).toEqual({
      name: project.name, description: null, manager_id: 'MGR001', start_date: '2026-09-01', projected_end_date: '2027-08-31',
      allocated_hours: 4000, budget: '260000',
    })
    // The dialog refreshes the directory once so other screens show the new details
    await waitFor(() => expect(called('GET /api/users')).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(called('GET /api/users')).toBe(2)
  })

  it('completing a project from the edit dialog archives it', async () => {
    respond('PATCH /api/projects/1', { ...project, status: 'completed', archived: true })
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    await choose(dialog, /Status/, 'Completed')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Project completed and archived')).toBeTruthy()
    expect(lastBody('PATCH /api/projects/1').status).toBe('completed')
  })

  it('managers see why the manager and budget are locked', async () => {
    asManager('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Set by an admin')).toHaveLength(2)
    expect(within(dialog).getByRole('combobox', { name: /Manager/ }).disabled).toBe(true)
    expect(within(dialog).getByText(/only admins can see archived projects/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.route === 'PATCH /api/projects/1')).toBe(false)
  })

  it('managers save without sending the budget, the manager, or an unchanged status', async () => {
    respond('PATCH /api/projects/1', project)
    asManager('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Allocated hours/), { target: { value: '4500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(lastBody('PATCH /api/projects/1')).toEqual({
      name: project.name, description: 'Retire the old data center', start_date: '2026-09-01', projected_end_date: '2027-08-31',
      allocated_hours: 4500,
    })
    expect(screen.queryByText('Project completed and archived')).toBeNull()
  })
})

describe('project page', () => {
  it('an archived project\'s message board is read-only', async () => {
    renderAt('/projects/2?tab=board')
    expect(await screen.findByText(/This project is archived/)).toBeTruthy()
    expect(await screen.findByText('Welcome to Project Tracker')).toBeTruthy()
    expect(screen.queryByLabelText(/Write a message/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete message/ })).toBeNull()
  })

  it('shows the error with a way back when the project can\'t be loaded', async () => {
    respond('GET /api/projects/99', { detail: 'Project not found' }, 404)
    renderAt('/projects/99')
    expect(await screen.findByText('Project not found')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Project' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '← Projects' }).getAttribute('href')).toBe('/projects')
  })

  it('falls back to the overview for an unknown tab and switches tabs through the URL', async () => {
    renderAt('/projects/1?tab=nonsense')
    expect(await screen.findByText('Health')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Team' }))
    expect(await screen.findByText('45 h/week')).toBeTruthy()
    expect(window.location.search).toBe('?tab=team')
  })

  it('admins calculate the budget estimate and use it as the budget', async () => {
    respond('PATCH /api/projects/1', project)
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }))
    expect(await screen.findByText('$240,000')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use as budget' }))
    expect(await screen.findByText('Budget updated')).toBeTruthy()
    expect(lastBody('PATCH /api/projects/1')).toEqual({ budget: '240000.00' })
    await waitFor(() => expect(called('GET /api/projects/1')).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }))
    await waitFor(() => expect(called('GET /api/projects/1/budget-estimate')).toBe(2))
  })

  it('offers no "Use as budget" when the estimate already matches', async () => {
    respond('GET /api/projects/1/budget-estimate', { project_id: 1, estimated_cost: '250000' })
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }))
    expect(await screen.findByRole('button', { name: 'Recalculate' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use as budget' })).toBeNull()
  })

  it('shows errors from calculating and from using the estimate', async () => {
    respond('GET /api/projects/1/budget-estimate', { detail: 'Add team members first' }, 400)
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate' }))
    expect(await screen.findByText('Add team members first')).toBeTruthy()

    respond('GET /api/projects/1/budget-estimate', { project_id: 1, estimated_cost: '240000.00' })
    respond('PATCH /api/projects/1', { detail: 'Budget must be positive' }, 422)
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use as budget' }))
    expect(await screen.findByText('Budget must be positive')).toBeTruthy()
    expect(screen.queryByText('Add team members first')).toBeNull()
  })

  it('archived projects show who archived them and why, without letting the estimate change the budget', async () => {
    respond('GET /api/projects/2/budget-estimate', { project_id: 2, estimated_cost: '240000.00' })
    renderAt('/projects/2')
    expect(await screen.findByText(/by Ada Admin \(deleted\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(await screen.findByText('$240,000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use as budget' })).toBeNull()
  })

  it('projects archived as completed say so', async () => {
    respond('GET /api/projects/2', { ...archivedProject, status: 'completed', archive_reason: 'completed' })
    renderAt('/projects/2')
    expect(await screen.findByText(/by Ada Admin \(completed\)/)).toBeTruthy()
  })

  it('shows an off-track project\'s health with an error-level alert', async () => {
    respond('GET /api/reports/projects', [{ ...health, member_count: 2, risk: { level: 'off_track', reasons: ['Past the deadline'] } }])
    renderAt('/projects/1')
    expect(await screen.findByText('2 employees')).toBeTruthy()
    expect(screen.getByText('Past the deadline').closest('.MuiAlert-root').className).toContain('Error')
  })

  it('shows health without a risk alert when nothing is wrong', async () => {
    respond('GET /api/reports/projects', [{ ...health, risk: { level: 'on_track', reasons: [] } }])
    renderAt('/projects/1')
    expect(await screen.findByText('1 employee')).toBeTruthy()
    expect(screen.getByText('On track')).toBeTruthy()
    expect(screen.queryByText('Behind schedule')).toBeNull()
  })

  it('shows no health figures when the report has no entry for the project', async () => {
    respond('GET /api/reports/projects', [{ ...health, project_id: 99 }])
    renderAt('/projects/1')
    expect(await screen.findByText('Health')).toBeTruthy()
    await waitFor(() => expect(called('GET /api/reports/projects')).toBe(1))
    expect(screen.queryByText('Milestones completed')).toBeNull()
  })

  it('shows the errors when health or milestones fail to load', async () => {
    respond('GET /api/reports/projects', { detail: 'Reports are down' }, 500)
    respond('GET /api/projects/1/milestones', { detail: 'Milestones are down' }, 500)
    renderAt('/projects/1')
    expect(await screen.findByText('Reports are down')).toBeTruthy()
    expect(await screen.findByText('Milestones are down')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('deleting a project archives it as deleted without asking for a reason; failures stay in the dialog', async () => {
    respond('DELETE /api/projects/1', { detail: 'Not allowed right now' }, 409)
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this project?' })
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }))
    expect(await within(dialog).findByText('Not allowed right now')).toBeTruthy()
    expect(lastBody('DELETE /api/projects/1')).toEqual({ reason: 'deleted' })

    respond('DELETE /api/projects/1', { ...project, archived: true })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }))
    expect(await screen.findByText('Project archived')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('cancelling a delete deletes nothing', async () => {
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.route === 'DELETE /api/projects/1')).toBe(false)
  })

  it('admins unarchive an archived project after confirming', async () => {
    respond('POST /api/projects/2/unarchive', { ...archivedProject, archived: false })
    renderAt('/projects/2')
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive' }))
    let dialog = await screen.findByRole('dialog', { name: 'Unarchive this project?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(called('POST /api/projects/2/unarchive')).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unarchive' }))
    expect(await screen.findByText('Project restored')).toBeTruthy()
    expect(called('POST /api/projects/2/unarchive')).toBe(1)
  })

  it('employees see the overview without budget, estimate or health', async () => {
    asEmployee('/projects/1')
    expect(await screen.findByRole('img', { name: /^Decommission 1000 servers: 0 of 2 milestones done/ })).toBeTruthy()
    expect(screen.getByText('Retire the old data center')).toBeTruthy()
    expect(screen.queryByText('Budget')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Calculate' })).toBeNull()
    expect(screen.queryByText('Health')).toBeNull()
    expect(calls.some((c) => c.route.startsWith('GET /api/reports'))).toBe(false)
  })

  it('the message board tab shows the project\'s messages', async () => {
    renderAt('/projects/1?tab=board')
    expect(await screen.findByText('Welcome to Project Tracker')).toBeTruthy()
    expect(calls.findLast((c) => c.route === 'GET /api/messages').query).toMatchObject({ project_id: '1' })
  })

  it('managers get neither delete nor unarchive', async () => {
    asManager('/projects/1')
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull()
  })

  it('employees log hours from the project\'s hours tab', async () => {
    asEmployee('/projects/1?tab=hours')
    fireEvent.click(await screen.findByRole('button', { name: 'Log hours' }))
    const dialog = await screen.findByRole('dialog', { name: 'Log hours' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.findLast((c) => c.route === 'GET /api/time-entries').query).toEqual({ project_id: '1' })
  })

  it('employees can\'t log hours on an archived project', async () => {
    respond('GET /api/projects/2', archivedProject)
    respond('GET /api/time-entries', [])
    asEmployee('/projects/2?tab=hours')
    expect(await screen.findByText(/This project is archived/)).toBeTruthy()
    await waitFor(() => expect(called('GET /api/time-entries')).toBe(1))
    expect(screen.queryByRole('button', { name: 'Log hours' })).toBeNull()
  })

  it('shows the error when hours fail to load', async () => {
    respond('GET /api/time-entries', { detail: 'Hours unavailable' }, 500)
    renderAt('/projects/1?tab=hours')
    expect(await screen.findByText('Hours unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Log hours' })).toBeNull()  // only employees log hours
  })
})

describe('project team', () => {
  it('adds an employee and warns when they go over a 40-hour week', async () => {
    respond('GET /api/users', [...users, alan, retired])
    respond('POST /api/projects/1/members', { ...member('EMP002', '30.0', 2), employee_hours_per_week: '50.0', over_limit: true })
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByRole('button', { name: 'Add employee' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add an employee' })
    expect(within(dialog).getByRole('button', { name: 'Add to project' }).disabled).toBe(true)
    // Only active employees who aren't on the project yet
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: /Employee/ }), { key: 'ArrowDown' })
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Alan Turing (EMP002)'])
    fireEvent.click(screen.getByRole('option', { name: 'Alan Turing (EMP002)' }))
    fireEvent.change(within(dialog).getByLabelText(/Planned hours per week/), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to project' }))
    expect(await screen.findByText('Alan Turing is now planned for 50 h/week across their projects, more than a 40-hour week.')).toBeTruthy()
    expect(lastBody('POST /api/projects/1/members')).toEqual({ user_id: 'EMP002', hours_per_week: '30' })
    await waitFor(() => expect(called('GET /api/projects/1/members')).toBe(2))
  })

  it('keeps the add dialog open when adding fails', async () => {
    respond('GET /api/users', [...users, alan])
    respond('POST /api/projects/1/members', { detail: 'Already on the project' }, 409)
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByRole('button', { name: 'Add employee' }))
    const dialog = await screen.findByRole('dialog')
    await choose(dialog, /Employee/, 'Alan Turing (EMP002)')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to project' }))
    expect(await within(dialog).findByText('Already on the project')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('changes planned hours and confirms the new weekly total', async () => {
    respond('PATCH /api/projects/1/members/EMP001', { ...member('EMP001', '20.0'), employee_hours_per_week: '20.0', over_limit: false })
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByLabelText('Change planned hours'))
    const dialog = await screen.findByRole('dialog', { name: 'Planned hours for Grace Hopper' })
    expect(within(dialog).getByLabelText(/Hours per week/).value).toBe('45')
    fireEvent.change(within(dialog).getByLabelText(/Hours per week/), { target: { value: '20' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Grace Hopper is planned for 20 h/week across their projects.')).toBeTruthy()
    expect(lastBody('PATCH /api/projects/1/members/EMP001')).toEqual({ hours_per_week: '20' })
  })

  it('shows deactivated members and members missing from the directory by ID', async () => {
    respond('GET /api/users', [...users, retired])
    respond('GET /api/projects/1/members', [member('EMP003', '10.0', 1), member('GONE01', '5.0', 2)])
    renderAt('/projects/1?tab=team')
    expect(await screen.findByText('EMP003 · deactivated')).toBeTruthy()
    const unknownRow = screen.getAllByText('GONE01')[0].closest('tr')
    expect(within(unknownRow).getByText('—')).toBeTruthy()  // no job title
    fireEvent.click(within(unknownRow).getByLabelText('Change planned hours'))
    const dialog = await screen.findByRole('dialog', { name: 'Planned hours for GONE01' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('adds a whole team and reports who was skipped or is over 40 hours', async () => {
    respond('GET /api/users', [...users, alan])
    respond('GET /api/teams', [
      { id: 5, name: 'Racking crew', manager_id: 'MGR001', member_count: 1 },
      { id: 6, name: 'Night shift', manager_id: 'MGR001', member_count: 3 },
    ])
    respond('POST /api/projects/1/teams', {
      added: [{ user_id: 'EMP001', over_limit: true }, { user_id: 'EMP002', over_limit: false }], skipped: [{ user_id: 'EMP003' }],
    })
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a team' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a team' })
    expect(within(dialog).getByRole('button', { name: 'Add team' }).disabled).toBe(true)
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Team/ }))
    expect(await screen.findByRole('option', { name: 'Racking crew · Mia Manager · 1 member' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: 'Night shift · Mia Manager · 3 members' }))
    fireEvent.change(within(dialog).getByLabelText(/Planned hours per week, each/), { target: { value: '10' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add team' }))
    expect(await screen.findByText('Added 2 people; skipped 1 (already on the project or deactivated); over 40 h/week: Grace Hopper')).toBeTruthy()
    expect(lastBody('POST /api/projects/1/teams')).toEqual({ team_id: 6, hours_per_week: '10' })
  })

  it('adding a team of one says so plainly', async () => {
    respond('POST /api/projects/1/teams', { added: [{ user_id: 'EMP002', over_limit: false }], skipped: [] })
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a team' }))
    const dialog = await screen.findByRole('dialog')
    await choose(dialog, /Team/, 'Racking crew · Mia Manager · 1 member')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add team' }))
    expect(await screen.findByText('Added 1 person')).toBeTruthy()
  })

  it('explains when no teams exist, and shows errors loading teams', async () => {
    respond('GET /api/teams', [])
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a team' }))
    expect(await screen.findByText('No teams exist yet. Create one from the Teams page.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    respond('GET /api/teams', { detail: 'Teams unavailable' }, 500)
    fireEvent.click(screen.getByRole('button', { name: 'Add a team' }))
    expect(await screen.findByText('Teams unavailable')).toBeTruthy()
  })

  it('removes a member only after confirming', async () => {
    respond('DELETE /api/projects/1/members/EMP001', null, 204)
    renderAt('/projects/1?tab=team')
    fireEvent.click(await screen.findByLabelText('Remove from project'))
    let dialog = await screen.findByRole('dialog', { name: 'Remove from project?' })
    expect(within(dialog).getByText(/Grace Hopper will be taken off this project/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByLabelText('Remove from project'))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Removed from the project')).toBeTruthy()
    expect(called('DELETE /api/projects/1/members/EMP001')).toBe(1)
  })

  it('shows the error when members fail to load and retries', async () => {
    respond('GET /api/projects/1/members', { detail: 'Members unavailable' }, 500)
    renderAt('/projects/1?tab=team')
    expect(await screen.findByText('Members unavailable')).toBeTruthy()
    respond('GET /api/projects/1/members', [member('EMP001')])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('45 h/week')).toBeTruthy()
    expect(screen.queryByText('Members unavailable')).toBeNull()
  })

  it('an empty team invites adding people', async () => {
    respond('GET /api/projects/1/members', [])
    renderAt('/projects/1?tab=team')
    expect(await screen.findByText('Nobody on this project yet')).toBeTruthy()
    expect(screen.getByText('Add employees one at a time, or a whole team.')).toBeTruthy()
  })

  it('archived projects show the team read-only', async () => {
    renderAt('/projects/2?tab=team')
    expect(await screen.findByText('Nobody on this project yet')).toBeTruthy()
    expect(screen.queryByText('Add employees one at a time, or a whole team.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add employee' })).toBeNull()
  })

  it('employees see the team without actions', async () => {
    asEmployee('/projects/1?tab=team')
    expect(await screen.findByText('45 h/week')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a team' })).toBeNull()
  })
})

describe('project milestones', () => {
  const expand = async (title) => {
    fireEvent.click(await screen.findByText(title))
    return screen.getByText(title).closest('.MuiAccordion-root')
  }
  const milestonesWithWork = (id) => {
    respond('GET /api/projects/1/milestones', [m1, m2])
    noWork(id)
  }
  const noWork = (id) => {
    respond(`GET /api/milestones/${id}/tasks`, [])
    respond(`GET /api/milestones/${id}/assignments`, [])
  }

  it('adds a milestone after the existing ones', async () => {
    respond('POST /api/projects/1/milestones', { ...m2, id: 12, sequence: 3 })
    renderAt('/projects/1?tab=milestones')
    fireEvent.click(await screen.findByRole('button', { name: 'Add milestone' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add milestone' })
    expect(within(dialog).getByText('This becomes milestone 3, after the ones already planned.')).toBeTruthy()
    expect(within(dialog).getByLabelText(/Start date/).value).toBe('2026-09-01')
    expect(within(dialog).getByLabelText(/End date/).value).toBe('2027-08-31')
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: '  Q3: 250 servers  ' } })
    fireEvent.change(within(dialog).getByLabelText(/End date/), { target: { value: '2026-08-01' } })
    expect(within(dialog).getByText('Must be on or after the start date')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/End date/), { target: { value: '2027-05-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add milestone' }))
    expect(await screen.findByText('Milestone added')).toBeTruthy()
    expect(lastBody('POST /api/projects/1/milestones')).toEqual({
      title: 'Q3: 250 servers', description: null, start_date: '2026-09-01', end_date: '2027-05-31', sequence: 3,
    })
    await waitFor(() => expect(called('GET /api/projects/1/milestones')).toBe(2))
  })

  it('shows validation errors from adding a milestone in the dialog', async () => {
    respond('POST /api/projects/1/milestones', { detail: [{ loc: ['body', 'end_date'], msg: 'must be within the project' }] }, 422)
    renderAt('/projects/1?tab=milestones')
    fireEvent.click(await screen.findByRole('button', { name: 'Add milestone' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: 'Late' } })
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: ' Extra ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add milestone' }))
    expect(await within(dialog).findByText('end_date: must be within the project')).toBeTruthy()
    expect(lastBody('POST /api/projects/1/milestones').description).toBe('Extra')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a project without milestones invites planning, starting at milestone 1', async () => {
    respond('GET /api/projects/1/milestones', [])
    renderAt('/projects/1?tab=milestones')
    expect(await screen.findByText('No milestones yet')).toBeTruthy()
    expect(screen.getByText(/Break the project into milestones/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    expect(await screen.findByText('This becomes milestone 1, after the ones already planned.')).toBeTruthy()
  })

  it('employees see an empty milestone list without planning hints', async () => {
    respond('GET /api/projects/1/milestones', [])
    asEmployee('/projects/1?tab=milestones')
    expect(await screen.findByText('No milestones yet')).toBeTruthy()
    expect(screen.queryByText(/Break the project into milestones/)).toBeNull()
  })

  it('shows the error when milestones fail to load', async () => {
    respond('GET /api/projects/1/milestones', { detail: 'Milestones unavailable' }, 500)
    renderAt('/projects/1?tab=milestones')
    expect(await screen.findByText('Milestones unavailable')).toBeTruthy()
  })

  it('starts a milestone and marks one completed', async () => {
    milestonesWithWork(11)
    respond('PATCH /api/milestones/11', { ...m2, status: 'in_progress' })
    respond('PATCH /api/milestones/10', { ...m1, status: 'completed' })
    renderAt('/projects/1?tab=milestones')
    const second = await expand('2. Q2: 500 servers')
    expect(within(second).queryByText('First batch')).toBeNull()  // no description
    fireEvent.click(within(second).getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('Milestone started')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/11')).toEqual({ status: 'in_progress' })

    const first = await expand('1. Q1: 250 servers')
    expect(within(first).getByText('First batch')).toBeTruthy()
    expect(within(first).queryByRole('button', { name: 'Delete' })).toBeNull()  // only not-started milestones
    fireEvent.click(within(first).getByRole('button', { name: 'Mark completed' }))
    expect(await screen.findByText('Milestone completed')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/10')).toEqual({ status: 'completed' })
  })

  it('shows why a status change was refused', async () => {
    noWork(11)
    respond('PATCH /api/milestones/11', { detail: 'Complete milestone 1 first' }, 409)
    renderAt('/projects/1?tab=milestones')
    const second = await expand('2. Q2: 500 servers')
    fireEvent.click(within(second).getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('Complete milestone 1 first')).toBeTruthy()
  })

  it('completed milestones can be reopened but their tasks and assignees are locked', async () => {
    respond('GET /api/projects/1/milestones', [{ ...m1, status: 'completed' }])
    respond('PATCH /api/milestones/10', m1)
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    await waitFor(() => expect(within(first).getByLabelText('Mark "Unrack 250 servers" done').disabled).toBe(true))
    expect(within(first).queryByPlaceholderText('Add a task')).toBeNull()
    expect(within(first).queryByLabelText('Rename')).toBeNull()
    expect(within(first).queryByRole('combobox', { name: /Assign a project member/ })).toBeNull()
    fireEvent.click(within(first).getByRole('button', { name: 'Reopen' }))
    expect(await screen.findByText('Milestone reopened')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/10')).toEqual({ status: 'in_progress' })
  })

  it('edits a milestone\'s details', async () => {
    respond('PATCH /api/milestones/10', m1)
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    fireEvent.click(within(first).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit milestone' })
    expect(within(dialog).getByLabelText(/Title/).value).toBe('Q1: 250 servers')
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: '  Updated plan ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Milestone saved')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/10')).toEqual({
      title: 'Q1: 250 servers', description: 'Updated plan', start_date: '2026-09-01', end_date: '2026-11-30',
    })
  })

  it('editing a milestone without a description keeps it empty, and cancel discards changes', async () => {
    milestonesWithWork(11)
    respond('PATCH /api/milestones/11', m2)
    renderAt('/projects/1?tab=milestones')
    const second = await expand('2. Q2: 500 servers')
    fireEvent.click(within(second).getByRole('button', { name: 'Edit' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Description/).value).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(second).getByRole('button', { name: 'Edit' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Milestone saved')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/11').description).toBeNull()
  })

  it('deletes a not-started milestone only after confirming', async () => {
    noWork(11)
    respond('DELETE /api/milestones/11', null, 204)
    renderAt('/projects/1?tab=milestones')
    const second = await expand('2. Q2: 500 servers')
    fireEvent.click(within(second).getByRole('button', { name: 'Delete' }))
    let dialog = await screen.findByRole('dialog', { name: 'Delete milestone?' })
    expect(within(dialog).getByText('"Q2: 500 servers" and its tasks will be deleted.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(called('DELETE /api/milestones/11')).toBe(0)

    fireEvent.click(within(second).getByRole('button', { name: 'Delete' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Milestone deleted')).toBeTruthy()
    expect(called('DELETE /api/milestones/11')).toBe(1)
  })

  it('lists tasks with who finished them, including admins employees can\'t look up', async () => {
    respond('GET /api/milestones/10/tasks', [
      task(100, 'Unrack 250 servers', true, 'EMP001'), task(101, 'Unrack row 5', false), task(102, 'Wipe disks', true, 'ZZZ999'),
      task(103, 'Label cables', true, null),
    ])
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(await within(first).findByText('Tasks · 3 of 4 done')).toBeTruthy()
    expect(within(first).getByText('Done by Grace Hopper')).toBeTruthy()
    expect(within(first).getByText('Done by an admin')).toBeTruthy()
    expect(within(first).getAllByText(/^Done by/)).toHaveLength(2)  // nobody recorded for "Label cables"
  })

  it('ticks, renames, deletes and adds tasks', async () => {
    respond('GET /api/milestones/10/tasks', [task(100, 'Unrack 250 servers', true, 'EMP001'), task(101, 'Unrack row 5', false)])
    respond('PATCH /api/milestones/tasks/101', task(101, 'Unrack row 5', true, 'ADMIN1'))
    respond('DELETE /api/milestones/tasks/100', null, 204)
    respond('POST /api/milestones/10/tasks', task(104, 'Label cables', false))
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')

    fireEvent.click(await within(first).findByLabelText('Mark "Unrack row 5" done'))
    await waitFor(() => expect(called('PATCH /api/milestones/tasks/101')).toBe(1))
    expect(lastBody('PATCH /api/milestones/tasks/101')).toEqual({ is_done: true })

    fireEvent.click(within(first).getAllByLabelText('Rename')[1])
    const dialog = await screen.findByRole('dialog', { name: 'Rename task' })
    expect(within(dialog).getByLabelText(/Task/).value).toBe('Unrack row 5')
    fireEvent.change(within(dialog).getByLabelText(/Task/), { target: { value: '  Unrack row five ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(lastBody('PATCH /api/milestones/tasks/101')).toEqual({ title: 'Unrack row five' })

    fireEvent.click(within(first).getAllByLabelText('Delete')[0])
    expect(await screen.findByText('Task deleted')).toBeTruthy()
    expect(called('DELETE /api/milestones/tasks/100')).toBe(1)

    const input = within(first).getByPlaceholderText('Add a task')
    const add = within(first).getByRole('button', { name: 'Add' })
    fireEvent.change(input, { target: { value: '   ' } })
    expect(add.disabled).toBe(true)
    fireEvent.change(input, { target: { value: ' Label cables ' } })
    fireEvent.click(add)
    await waitFor(() => expect(input.value).toBe(''))
    expect(lastBody('POST /api/milestones/10/tasks')).toEqual({ title: 'Label cables' })
  })

  it('closing the rename dialog leaves the task alone', async () => {
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    fireEvent.click(await within(first).findByLabelText('Rename'))
    const dialog = await screen.findByRole('dialog', { name: 'Rename task' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.route.startsWith('PATCH /api/milestones/tasks'))).toBe(false)
  })

  it('shows the error when a task action fails', async () => {
    respond('DELETE /api/milestones/tasks/100', { detail: 'Task is locked' }, 409)
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    fireEvent.click(await within(first).findByLabelText('Delete'))
    expect(await within(first).findByText('Task is locked')).toBeTruthy()
    expect(screen.queryByText('Task deleted')).toBeNull()
  })

  it('assigns a project member to a milestone with no tasks or assignees yet', async () => {
    noWork(10)
    respond('POST /api/milestones/10/assignments', assignment('EMP001'))
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(await within(first).findByText('No tasks yet. A milestone is complete when its tasks are done.')).toBeTruthy()
    expect(within(first).getByText('Tasks · 0 of 0 done')).toBeTruthy()
    expect(await within(first).findByText('Nobody assigned yet.')).toBeTruthy()
    const assign = within(first).getByRole('button', { name: 'Assign' })
    expect(assign.disabled).toBe(true)
    await choose(first, /Assign a project member/, 'Grace Hopper (EMP001)')
    fireEvent.click(assign)
    expect(await screen.findByText('Assigned')).toBeTruthy()
    expect(lastBody('POST /api/milestones/10/assignments')).toEqual({ user_id: 'EMP001' })
  })

  it('tells managers to staff the project before assigning', async () => {
    respond('GET /api/projects/1/members', [])
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(await within(first).findByText('Add employees to the project first')).toBeTruthy()
  })

  it('shows errors loading tasks and assignees', async () => {
    respond('GET /api/milestones/10/tasks', { detail: 'Tasks unavailable' }, 500)
    respond('GET /api/milestones/10/assignments', { detail: 'Assignments unavailable' }, 500)
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(await within(first).findByText('Tasks unavailable')).toBeTruthy()
    expect(await within(first).findByText('Assignments unavailable')).toBeTruthy()
    expect(within(first).getByText('Tasks')).toBeTruthy()  // no count without tasks
  })

  it('managers mark people finished or working again, and unassign them', async () => {
    respond('GET /api/milestones/10/assignments', [assignment('EMP001', '2026-10-10T09:00:00Z', 1), assignment('EMP002', null, 2)])
    respond('GET /api/users', [...users, alan])
    respond('PATCH /api/milestones/10/assignments/EMP001', assignment('EMP001'))
    respond('PATCH /api/milestones/10/assignments/EMP002', assignment('EMP002', '2026-10-14T09:00:00Z', 2))
    respond('DELETE /api/milestones/10/assignments/EMP002', null, 204)
    renderAt('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(await within(first).findByText('Finished')).toBeTruthy()
    expect(within(first).getByText('Working')).toBeTruthy()

    fireEvent.click(within(first).getByRole('button', { name: 'Mark working' }))
    await waitFor(() => expect(called('PATCH /api/milestones/10/assignments/EMP001')).toBe(1))
    expect(lastBody('PATCH /api/milestones/10/assignments/EMP001')).toEqual({ finished: false })

    fireEvent.click(within(first).getByRole('button', { name: 'Mark finished' }))
    expect(await screen.findByText('Marked finished')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/10/assignments/EMP002')).toEqual({ finished: true })

    fireEvent.click(within(first).getAllByLabelText('Unassign')[1])
    expect(await screen.findByText('Unassigned')).toBeTruthy()
    expect(called('DELETE /api/milestones/10/assignments/EMP002')).toBe(1)
  })

  it('employees tick tasks and mark only their own part finished', async () => {
    respond('GET /api/users', [employee, alan])
    respond('GET /api/milestones/10/assignments', [assignment('EMP001', null, 1), assignment('EMP002', null, 2)])
    respond('GET /api/milestones/10/tasks', [task(101, 'Unrack row 5', false)])
    respond('PATCH /api/milestones/tasks/101', task(101, 'Unrack row 5', true, 'EMP001'))
    respond('PATCH /api/milestones/10/assignments/EMP001', assignment('EMP001', '2026-10-14T09:00:00Z'))
    asEmployee('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(within(first).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(first).queryByPlaceholderText('Add a task')).toBeNull()
    expect(within(first).queryByLabelText('Rename')).toBeNull()
    expect(await within(first).findAllByRole('button', { name: /Mark/ })).toHaveLength(1)  // nothing for Alan's row

    const checkbox = within(first).getByLabelText('Mark "Unrack row 5" done')
    await waitFor(() => expect(checkbox.disabled).toBe(false))
    fireEvent.click(checkbox)
    await waitFor(() => expect(called('PATCH /api/milestones/tasks/101')).toBe(1))

    fireEvent.click(within(first).getByRole('button', { name: 'Mark my part finished' }))
    expect(await screen.findByText('Marked finished. You can start your next milestone.')).toBeTruthy()
    expect(lastBody('PATCH /api/milestones/10/assignments/EMP001')).toEqual({ finished: true })
    await waitFor(() => expect(called('GET /api/projects/1/milestones')).toBe(2))
  })

  it('employees not assigned to a milestone can\'t tick its tasks', async () => {
    respond('GET /api/milestones/10/assignments', [assignment('EMP002')])
    asEmployee('/projects/1?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(await within(first).findByText('EMP002')).toBeTruthy()
    expect(within(first).getByLabelText('Mark "Unrack 250 servers" done').disabled).toBe(true)
    expect(within(first).queryByRole('button', { name: /Mark/ })).toBeNull()
  })

  it('archived projects show milestones read-only', async () => {
    respond('GET /api/projects/2/milestones', [{ ...m1, project_id: 2 }])
    renderAt('/projects/2?tab=milestones')
    const first = await expand('1. Q1: 250 servers')
    expect(screen.queryByRole('button', { name: 'Add milestone' })).toBeNull()
    expect(within(first).queryByRole('button', { name: 'Mark completed' })).toBeNull()
    await waitFor(() => expect(within(first).getByLabelText('Mark "Unrack 250 servers" done').disabled).toBe(true))
    expect(within(first).queryByLabelText('Unassign')).toBeNull()
    expect(within(first).queryByRole('button', { name: 'Mark finished' })).toBeNull()
  })
})

describe('project deliverables', () => {
  const deliverable = (overrides) => ({
    milestone_id: 10, sequence: 1, title: 'Q1: 250 servers', status: 'completed', start_date: '2026-09-01', end_date: '2026-11-30',
    overdue: false, depends_on_milestone_id: null, blocked: false, tasks_total: 3, tasks_done: 3, completion_pct: '100',
    assignees: ['EMP001', 'MGR001'], tasks: [], ...overrides,
  })

  it('shows the dependency chain with progress, delays and assignees', async () => {
    respond('GET /api/projects/1/deliverables', [
      deliverable(),
      deliverable({ milestone_id: 11, sequence: 2, title: 'Q2: 500 servers', status: 'in_progress', overdue: true, depends_on_milestone_id: 10, tasks_done: 1, completion_pct: '33.3', assignees: [] }),
      deliverable({ milestone_id: 12, sequence: 3, title: 'Q3: 250 servers', status: 'not_started', blocked: true, depends_on_milestone_id: 11, tasks_total: 0, tasks_done: 0, completion_pct: '0', assignees: [] }),
    ])
    renderAt('/projects/1?tab=deliverables')
    expect(await screen.findByText('Q3: 250 servers')).toBeTruthy()
    expect(screen.getByText('100% · 3/3 tasks')).toBeTruthy()
    expect(screen.getByText('33.3% · 1/3 tasks')).toBeTruthy()
    expect(screen.getByText(/· first milestone/)).toBeTruthy()
    expect(screen.getByText(/· depends on milestone 1$/)).toBeTruthy()
    expect(screen.getAllByText('Overdue')).toHaveLength(1)
    expect(screen.getByText('Waiting on milestone 2')).toBeTruthy()
    expect(screen.getByText('Assigned: Grace Hopper, Mia Manager')).toBeTruthy()
    expect(screen.getAllByText(/^Assigned:/)).toHaveLength(1)
  })

  it('explains an empty chain', async () => {
    respond('GET /api/projects/1/deliverables', [])
    renderAt('/projects/1?tab=deliverables')
    expect(await screen.findByText('No deliverables yet')).toBeTruthy()
    expect(screen.getByText('Add milestones to see the dependency chain.')).toBeTruthy()
  })

  it('shows the error and retries', async () => {
    respond('GET /api/projects/1/deliverables', { detail: 'Deliverables unavailable' }, 500)
    renderAt('/projects/1?tab=deliverables')
    expect(await screen.findByText('Deliverables unavailable')).toBeTruthy()
    respond('GET /api/projects/1/deliverables', [deliverable()])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('100% · 3/3 tasks')).toBeTruthy()
  })
})

describe('project progress bar', () => {
  it('marks completed and overdue milestones and hides the today marker after the project', async () => {
    onDay('2028-01-15')
    respond('GET /api/projects/1/milestones', [
      { ...m1, status: 'completed' },
      { ...m2, start_date: '2027-01-01', end_date: '2027-01-02' },  // too short to label
    ])
    renderAt('/projects/1')
    const bar = await screen.findByRole('img', { name: /^Decommission 1000 servers: 1 of 2 milestones done · 100% of timeline used · 1 overdue/ })
    expect(bar.getAttribute('aria-label')).toContain('Q1: 250 servers completed, Q2: 500 servers overdue')
    expect(bar.textContent).toBe('1')
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.queryByText('Today')).toBeNull()
    expect(screen.queryByText('In progress')).toBeNull()  // the legend lists only states in use
    expect(screen.getByText('Sep 1, 2026 – Aug 31, 2027')).toBeTruthy()
  })

  it('stretches to milestones outside the project dates and hides the today marker before the start', async () => {
    onDay('2026-01-15')
    respond('GET /api/projects/1/milestones', [{ ...m2, start_date: '2026-08-01', end_date: '2027-09-30' }])
    renderAt('/projects/1')
    expect(await screen.findByText('0 of 1 milestones done · 0% of timeline used')).toBeTruthy()
    expect(screen.getByText('Aug 1, 2026 – Sep 30, 2027')).toBeTruthy()
    expect(screen.queryByText('Today')).toBeNull()
  })

  it('a project without milestones shows its timeline and today', async () => {
    onDay('2026-10-14')
    respond('GET /api/projects/1/milestones', [])
    renderAt('/projects/1')
    expect(await screen.findByRole('img', { name: 'Decommission 1000 servers: No milestones yet.' })).toBeTruthy()
    expect(screen.getByText('No milestones yet')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
  })
})

describe('calendar', () => {
  const newDc = { ...project, id: 3, name: 'Build new DC', start_date: '2026-10-01', projected_end_date: '2026-10-31' }
  const dcMilestone = { ...m1, id: 30, project_id: 3, title: 'Pour concrete', start_date: '2026-10-05', end_date: '2026-10-09' }

  it('falls back to this month for a bad month and moves between months', async () => {
    onDay('2026-11-10')
    renderAt('/calendar?month=bad')
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Today' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy()
    expect(window.location.search).toBe('?month=2026-10')
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/milestones').query).toEqual({ start: '2026-09-28', end: '2026-11-01' }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy()
    expect(window.location.search).toBe('?month=2026-11')
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeTruthy()
    expect(window.location.search).toBe('?month=2026-12')
  })

  it('filters to one project and opens its milestones', async () => {
    onDay('2026-10-14')
    respond('GET /api/projects', [project, archivedProject, newDc])
    respond('GET /api/milestones', [m1, dcMilestone])
    respond('GET /api/projects/3', newDc)
    respond('GET /api/projects/3/milestones', [dcMilestone])
    respond('GET /api/projects/3/members', [])
    renderAt('/calendar')
    expect(await screen.findByRole('button', { name: /Build new DC: milestone 1, Pour concrete/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Decommission 1000 servers: milestone 1/ })).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Project/ }))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['All projects', 'Decommission 1000 servers', 'Build new DC'])  // no archived projects
    fireEvent.click(screen.getByRole('option', { name: 'Build new DC' }))
    await waitFor(() => expect(window.location.search).toBe('?month=2026-10&project=3'))
    expect(screen.queryByRole('button', { name: /Decommission 1000 servers: milestone 1/ })).toBeNull()

    fireEvent.click(screen.getByText('Build new DC · 1. Pour concrete'))
    expect(await screen.findByRole('heading', { name: 'Build new DC' })).toBeTruthy()
    expect(window.location.search).toBe('?tab=milestones')
  })

  it('flags overdue project deadlines and lists project deadlines before milestones on the same day', async () => {
    onDay('2026-11-10')
    const sameDay = { ...newDc, id: 4, name: 'Move racks' }
    respond('GET /api/projects', [project, newDc, sameDay])
    respond('GET /api/milestones', [{ ...dcMilestone, start_date: '2026-10-20', end_date: '2026-10-31', status: 'completed' }])
    renderAt('/calendar?month=2026-10')
    expect(await screen.findByRole('button', { name: 'Build new DC: project due Oct 31, 2026, overdue' })).toBeTruthy()
    const list = screen.getByText('Deadlines in October 2026').parentElement
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Project due: (Build new DC|Move racks)Oct 31, 2026 · overdue$/),
      expect.stringMatching(/^Project due: (Build new DC|Move racks)Oct 31, 2026 · overdue$/),
      'Build new DC · 1. Pour concreteOct 31, 2026 · Completed',
    ])
    // The day shows the project deadline, which outranks the milestone's
    expect(screen.getByText('Project due')).toBeTruthy()
    expect(screen.queryByText('Due')).toBeNull()

    // A project deadline opens the project's overview
    respond('GET /api/projects/3', newDc)
    respond('GET /api/projects/3/milestones', [])
    fireEvent.click(screen.getByRole('button', { name: 'Build new DC: project due Oct 31, 2026, overdue' }))
    expect(await screen.findByRole('heading', { name: 'Build new DC' })).toBeTruthy()
    expect(window.location.pathname).toBe('/projects/3')
    expect(window.location.search).toBe('')
  })

  it('stacks overlapping milestones and reuses free lanes within a week', async () => {
    onDay('2026-10-14')
    respond('GET /api/milestones', [
      { ...m1, id: 40, title: 'Long one', start_date: '2026-10-12', end_date: '2026-10-16' },
      { ...m1, id: 41, title: 'Same start', start_date: '2026-10-12', end_date: '2026-10-13' },
      { ...m1, id: 42, title: 'Later', start_date: '2026-10-15', end_date: '2026-10-17' },
    ])
    renderAt('/calendar?month=2026-10')
    for (const title of ['Long one', 'Same start', 'Later']) {
      expect(await screen.findByRole('button', { name: new RegExp(`milestone 1, ${title},`) })).toBeTruthy()
    }
    // "Later" fits in the lane "Same start" freed, so the week needs two lanes
    const week = screen.getByRole('button', { name: /milestone 1, Long one,/ }).parentElement
    expect(week.querySelectorAll('button')).toHaveLength(3)
  })

  it('shows the error when milestones fail to load', async () => {
    respond('GET /api/milestones', { detail: 'Calendar unavailable' }, 500)
    renderAt('/calendar?month=2026-10')
    expect(await screen.findByText('Calendar unavailable')).toBeTruthy()
    expect(screen.getByText('No deadlines this month')).toBeTruthy()
    expect(unexpected).toEqual([])
  })
})

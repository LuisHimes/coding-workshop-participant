import { afterEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { AuthProvider, useAuth } from '../auth/AuthContext'
import { DirectoryProvider } from '../components/Directory'
import MessageBoard from '../components/MessageBoard'
import { admin, calls, respond } from './fakeApi'

// Screens for day-to-day work: hours, the message board, the dashboards and reports.

// Several tests open MUI selects a few times; give them room when the whole suite runs in parallel
vi.setConfig({ testTimeout: 20000 })
configure({ asyncUtilTimeout: 5000 })

function renderAt(path) {
  localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

const manager = { ...admin, id: 'MGR001', role: 'manager', first_name: 'Mia', last_name: 'Manager', salary: '150000.00' }
const employee = { ...admin, id: 'EMP001', role: 'employee', first_name: 'Grace', last_name: 'Hopper', manager_id: 'MGR001' }
delete employee.salary

const project = {
  id: 1, name: 'Decommission 1000 servers', description: '', manager_id: 'MGR001', status: 'active',
  start_date: '2026-09-01', projected_end_date: '2027-08-31', allocated_hours: 4000, budget: '250000.00',
  archived_at: null, archived_by: null, archive_reason: null, archived: false,
}
const secondProject = { ...project, id: 3, name: 'Move the network core' }
const entry = { id: 1, user_id: 'EMP001', project_id: 1, milestone_id: 10, work_date: '2026-10-12', hours: '8.00', description: 'Unracked row 4' }
const health = {
  project_id: 1, name: project.name, status: 'active', archived: false, manager_id: 'MGR001', projected_end_date: '2027-08-31',
  logged_hours: '120.00', budget: '250000.00', labor_cost: '6000.00', milestones_total: 2, milestones_completed: 0,
  completion_pct: '0', current_milestone: 'Q1: 250 servers', timeline_pct: '12.3', budget_used_pct: '2.4',
  risk: { level: 'at_risk', reasons: ['Behind schedule'] },
}
const homeReport = { active_projects: 1, projects_at_risk: 1, projects_off_track: 0, over_allocated_employees: 1, total_budget: '250000.00', total_labor_cost: '6000.00', projects: [health] }
const employeeHome = {
  active_milestone_id: 10, active_milestone_title: 'Q1: 250 servers', active_project_id: 1,
  project_ids: [1], hours_this_week: '42.00', over_limit_this_week: true,
}

const asManager = (path) => {
  respond('GET /api/auth/me', manager)
  return renderAt(path)
}
const asEmployee = (path, home = {}) => {
  respond('GET /api/auth/me', employee)
  respond('GET /api/reports/home', { ...employeeHome, ...home })
  return renderAt(path)
}

const lastCall = (route) => calls.findLast((c) => c.route === route)
const bodyOf = (route) => JSON.parse(lastCall(route).body)
const countOf = (route) => calls.filter((c) => c.route === route).length

async function choose(container, label, option) {
  fireEvent.mouseDown(within(container).getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

// Only Date is faked, so "today" is fixed while promises and timers run normally
const onDay = (iso) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${iso}T12:00:00`))
}
afterEach(() => vi.useRealTimers())

describe('message board', () => {
  it('admins post announcements to everyone by default', async () => {
    respond('POST /api/messages', { id: 2 })
    renderAt('/')
    expect(await screen.findByText('Welcome to Project Tracker')).toBeTruthy()
    expect(screen.getByText(/Ada Admin · .* · Everyone/)).toBeTruthy()
    const box = screen.getByLabelText(/Write a message/)
    fireEvent.change(box, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Post' }).disabled).toBe(true)  // blank posts aren't allowed
    fireEvent.change(box, { target: { value: '  Servers arrive Monday  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByText('Posted')).toBeTruthy()
    expect(bodyOf('POST /api/messages')).toEqual({ body: 'Servers arrive Monday', project_id: null })
    expect(box.value).toBe('')
    await waitFor(() => expect(countOf('GET /api/messages')).toBe(2))
  })

  it('admins can post to a project instead', async () => {
    respond('POST /api/messages', { id: 2 })
    renderAt('/')
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: /Post to/ }))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['Everyone (announcement)', 'Decommission 1000 servers'])  // archived projects are left out
    fireEvent.click(screen.getByRole('option', { name: 'Decommission 1000 servers' }))
    fireEvent.change(screen.getByLabelText(/Write a message/), { target: { value: 'Row 5 next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByText('Posted')
    expect(bodyOf('POST /api/messages')).toEqual({ body: 'Row 5 next', project_id: 1 })
  })

  it('keeps the draft and shows the error when posting fails', async () => {
    respond('POST /api/messages', { detail: 'Message is too long' }, 422)
    renderAt('/')
    const box = await screen.findByLabelText(/Write a message/)
    fireEvent.change(box, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByText('Message is too long')).toBeTruthy()
    expect(box.value).toBe('Hello')
    expect(screen.getByRole('button', { name: 'Post' }).disabled).toBe(false)
  })

  it('admins delete any message after confirming', async () => {
    respond('DELETE /api/messages/1', null, 204)
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete message' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('It will be removed from the board for everyone.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(countOf('DELETE /api/messages/1')).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Delete message' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Message deleted')).toBeTruthy()
    expect(countOf('DELETE /api/messages/1')).toBe(1)
    await waitFor(() => expect(countOf('GET /api/messages')).toBe(2))
  })

  it('keeps the confirm dialog open with the error when deleting fails', async () => {
    respond('DELETE /api/messages/1', { detail: 'Message not found' }, 404)
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete message' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await within(dialog).findByText('Message not found')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('managers delete their own posts and post to their first project by default', async () => {
    respond('GET /api/messages', [
      { id: 1, project_id: null, author_id: 'ADMIN1', author_name: 'Ada Admin', body: 'Welcome', created_at: '2026-10-01T09:00:00Z' },
      { id: 2, project_id: 1, author_id: 'MGR001', author_name: 'Mia Manager', body: 'Row 4 done', created_at: '2026-10-02T09:00:00Z' },
    ])
    respond('POST /api/messages', { id: 3 })
    asManager('/')
    expect(await screen.findByText('Row 4 done')).toBeTruthy()
    expect(screen.getByText(/Mia Manager · .* · Decommission 1000 servers/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Delete message' })).toHaveLength(1)  // only their own
    fireEvent.change(screen.getByLabelText(/Write a message/), { target: { value: 'Row 5 next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByText('Posted')
    expect(bodyOf('POST /api/messages')).toEqual({ body: 'Row 5 next', project_id: 1 })
  })

  it('managers without an open project are told they cannot post yet', async () => {
    respond('GET /api/projects', [{ ...project, archived: true }])
    asManager('/')
    expect(await screen.findByText('You can post here once you manage a project.')).toBeTruthy()
    expect(screen.queryByLabelText(/Write a message/)).toBeNull()
  })

  it('shows an empty board and load errors', async () => {
    respond('GET /api/messages', [])
    const { unmount } = renderAt('/')
    expect(await screen.findByText('No messages yet')).toBeTruthy()
    expect(screen.getByText('Posts appear here, newest first.')).toBeTruthy()
    unmount()

    respond('GET /api/messages', { detail: 'Messages are unavailable' }, 503)
    renderAt('/')
    expect(await screen.findByText('Messages are unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('the home page\'s filter switches between one project\'s posts and all boards', async () => {
    renderAt('/')
    await screen.findByText('Welcome to Project Tracker')
    expect(lastCall('GET /api/messages').query).toEqual({ limit: '20' })
    expect(screen.getByText('Announcements and every project\'s board.')).toBeTruthy()
    const filter = screen.getByRole('combobox', { name: /Show posts from/ })
    expect(filter.textContent).toBe('All boards')
    fireEvent.mouseDown(filter)
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toEqual(['All boards', 'Decommission 1000 servers'])  // archived projects are left out
    fireEvent.click(screen.getByRole('option', { name: 'Decommission 1000 servers' }))
    await waitFor(() => expect(lastCall('GET /api/messages').query).toEqual({ project_id: '1', limit: '20' }))
    expect(screen.getByText('Only this project\'s board. New posts go to this project.')).toBeTruthy()
    // A project's board posts there, so there's no "Post to" choice
    expect(await screen.findByLabelText(/Write a message/)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Post to/ })).toBeNull()

    await choose(document.body, /Show posts from/, 'All boards')
    await waitFor(() => expect(lastCall('GET /api/messages').query).toEqual({ limit: '20' }))
    expect(screen.getByRole('combobox', { name: /Post to/ })).toBeTruthy()
  })

  it('managers and employees are told which boards "All boards" covers', async () => {
    asManager('/')
    expect(await screen.findByText('Announcements to everyone, plus the boards of your projects.')).toBeTruthy()
  })

  it('shows older posts on request, 20 at a time', async () => {
    const page = (count, from = 1) => Array.from({ length: count }, (_, i) => ({
      id: from + i, project_id: null, author_id: 'ADMIN1', author_name: 'Ada Admin', body: `Post ${from + i}`, created_at: '2026-10-01T09:00:00Z',
    }))
    respond('GET /api/messages', page(20))
    renderAt('/')
    expect(await screen.findByText('Post 20')).toBeTruthy()
    respond('GET /api/messages', page(25))
    fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }))
    expect(await screen.findByText('Post 25')).toBeTruthy()
    expect(lastCall('GET /api/messages').query).toEqual({ limit: '40' })
    // Fewer posts than asked for means there are no older ones
    expect(screen.queryByRole('button', { name: 'Show older posts' })).toBeNull()
  })

  it('a project\'s board posts to that project and omits the project name', async () => {
    respond('GET /api/messages', [{ id: 2, project_id: 1, author_id: 'MGR001', author_name: 'Mia Manager', body: 'Row 4 done', created_at: '2026-10-02T09:00:00Z' }])
    respond('POST /api/messages', { id: 3 })
    renderAt('/projects/1?tab=board')
    expect(await screen.findByText('Row 4 done')).toBeTruthy()
    expect(screen.getByText(/^Mia Manager · /).textContent).not.toContain('Decommission')
    expect(lastCall('GET /api/messages').query).toEqual({ project_id: '1', limit: '50' })
    fireEvent.change(screen.getByLabelText(/Write a message/), { target: { value: 'Hi team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByText('Posted')
    expect(bodyOf('POST /api/messages')).toEqual({ body: 'Hi team', project_id: 1 })
  })

  describe('read-only', () => {
    // No screen uses readOnly yet, so the board is rendered on its own
    function SignedIn({ children }) {
      const { user } = useAuth()
      return user ? children : null
    }
    const renderReadOnly = () => {
      localStorage.setItem('project-tracker.token', 'test-token')
      return render(<AuthProvider><DirectoryProvider><SignedIn><MessageBoard readOnly /></SignedIn></DirectoryProvider></AuthProvider>)
    }

    it('shows posts without the form or delete buttons', async () => {
      renderReadOnly()
      expect(await screen.findByText('Welcome to Project Tracker')).toBeTruthy()
      expect(screen.queryByLabelText(/Write a message/)).toBeNull()
      expect(screen.queryByText('You can post here once you manage a project.')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Delete message' })).toBeNull()
    })

    it('shows an empty board without the posting hint', async () => {
      respond('GET /api/messages', [])
      renderReadOnly()
      expect(await screen.findByText('No messages yet')).toBeTruthy()
      expect(screen.queryByText('Posts appear here, newest first.')).toBeNull()
    })
  })
})

describe('hours', () => {
  it('admins filter hours by employee, project and dates', async () => {
    renderAt('/time-entries')
    expect(await screen.findByText('Unracked row 4')).toBeTruthy()
    expect(screen.getByText('Hours employees logged. Admins can correct or delete any entry.')).toBeTruthy()
    expect(lastCall('GET /api/time-entries').query).toEqual({})

    const picker = screen.getByRole('combobox', { name: 'Employee' })
    fireEvent.change(picker, { target: { value: 'Grace' } })
    const employeeOptions = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(employeeOptions).toEqual(['Grace Hopper (EMP001)'])  // employees only
    fireEvent.click(screen.getByRole('option', { name: 'Grace Hopper (EMP001)' }))
    await waitFor(() => expect(lastCall('GET /api/time-entries').query).toEqual({ user_id: 'EMP001' }))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Project/ }))
    const projectOptions = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(projectOptions).toEqual(['Any project', 'Decommission 1000 servers', 'Old intranet (archived)'])
    fireEvent.click(screen.getByRole('option', { name: 'Old intranet (archived)' }))
    await waitFor(() => expect(lastCall('GET /api/time-entries').query).toEqual({ user_id: 'EMP001', project_id: '2' }))

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } })
    await waitFor(() => expect(lastCall('GET /api/time-entries').query).toEqual({ user_id: 'EMP001', project_id: '2', start: '2026-10-01', end: '2026-10-31' }))

    // Clearing the employee drops it from the query
    fireEvent.change(picker, { target: { value: '' } })
    await waitFor(() => expect(lastCall('GET /api/time-entries').query).toEqual({ project_id: '2', start: '2026-10-01', end: '2026-10-31' }))
  })

  it('shows the totals and an empty state', async () => {
    respond('GET /api/time-entries', [entry, { ...entry, id: 2, hours: '0.50', description: null }])
    const { unmount } = renderAt('/time-entries')
    const totalRow = (await screen.findByText('Total')).closest('tr')
    expect(within(totalRow).getByText('8.5 h')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()  // no description
    unmount()

    respond('GET /api/time-entries', [])
    renderAt('/time-entries')
    expect(await screen.findByText('No hours logged')).toBeTruthy()
  })

  it('shows load errors with a retry', async () => {
    respond('GET /api/time-entries', { detail: 'Hours are unavailable' }, 503)
    renderAt('/time-entries')
    expect(await screen.findByText('Hours are unavailable')).toBeTruthy()
    respond('GET /api/time-entries', [entry])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Unracked row 4')).toBeTruthy()
  })

  it('admins correct an entry and are warned when the week goes over 40', async () => {
    respond('PATCH /api/time-entries/1', { ...entry, hours: '10.00', week_hours: '44.00', over_limit: true })
    renderAt('/time-entries')
    await screen.findByText('Unracked row 4')
    fireEvent.click(screen.getByRole('button', { name: 'Correct entry' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Hours/).value).toBe('8')
    fireEvent.change(within(dialog).getByLabelText(/Hours/), { target: { value: '10' } })
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2026-10-13' } })
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: '  Unracked row 5  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved. Grace Hopper logged 44 h that week, which is overtime (more than 40 h).')).toBeTruthy()
    expect(bodyOf('PATCH /api/time-entries/1')).toEqual({ work_date: '2026-10-13', hours: '10', description: 'Unracked row 5' })
    await waitFor(() => expect(countOf('GET /api/time-entries')).toBe(2))
  })

  it('a correction that keeps the week at exactly 40 hours is not flagged; a blank description is cleared', async () => {
    respond('GET /api/time-entries', [{ ...entry, description: null }])
    respond('PATCH /api/time-entries/1', { ...entry, week_hours: '40.00', over_limit: false })
    renderAt('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Correct entry' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Description/).value).toBe('')
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Time entry saved')).toBeTruthy()
    expect(bodyOf('PATCH /api/time-entries/1')).toMatchObject({ description: null })
  })

  it('a failed correction keeps the dialog open; cancelling sends nothing', async () => {
    respond('PATCH /api/time-entries/1', { detail: [{ loc: ['body', 'hours'], msg: 'Week would exceed 60 hours' }] }, 422)
    renderAt('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Correct entry' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Hours/), { target: { value: '12' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText('hours: Week would exceed 60 hours')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(countOf('GET /api/time-entries')).toBe(1)
  })

  it('deleting an entry asks first and says what is removed', async () => {
    respond('DELETE /api/time-entries/1', null, 204)
    renderAt('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete entry' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("8 h on Oct 12, 2026 by Grace Hopper will be removed from the project's labor cost.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(countOf('DELETE /api/time-entries/1')).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Time entry deleted')).toBeTruthy()
    expect(countOf('DELETE /api/time-entries/1')).toBe(1)
    await waitFor(() => expect(countOf('GET /api/time-entries')).toBe(2))
  })

  it('a failed delete shows the error in the dialog', async () => {
    respond('DELETE /api/time-entries/1', { detail: 'You can only delete your own hours' }, 403)
    asEmployee('/time-entries')
    expect(await screen.findByRole('heading', { name: 'My hours' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete entry' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await within(dialog).findByText('You can only delete your own hours')).toBeTruthy()
  })

  it('employees see only their own hours, without the employee filter', async () => {
    asEmployee('/time-entries')
    expect(await screen.findByText('Hours you logged. A full week is 40 hours across all of your projects.')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Employee' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Correct entry' })).toBeTruthy()
  })

  it('managers see hours on their projects read-only', async () => {
    asManager('/time-entries')
    expect(await screen.findByText('Hours employees logged on your projects.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Hours' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Log hours' })).toBeNull()
    expect(await screen.findByText('Unracked row 4')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
  })

  it('a project\'s hours tab leaves out the project column', async () => {
    renderAt('/projects/1?tab=hours')
    expect(await screen.findByText('Unracked row 4')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull()
    expect(screen.getByText('Total').closest('td').getAttribute('colspan')).toBe('3')
  })
})

describe('logging hours', () => {
  it('logs hours against a milestone; exactly 40 h a week is not over the limit', async () => {
    onDay('2026-10-13')
    respond('POST /api/time-entries', { ...entry, id: 9, week_hours: '40.00', over_limit: false })
    asEmployee('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Log hours' }))
    const dialog = await screen.findByRole('dialog')
    // Their only open project is picked for them
    await waitFor(() => expect(calls.some((c) => c.route === 'GET /api/projects/1/milestones')).toBe(true))
    await choose(dialog, /Milestone/, '1. Q1: 250 servers')
    fireEvent.change(within(dialog).getByLabelText(/Hours/), { target: { value: '7.5' } })
    fireEvent.change(within(dialog).getByLabelText(/What did you work on/), { target: { value: '  Racked row 6  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log hours' }))
    expect(await screen.findByText('Logged. You have 40 h that week.')).toBeTruthy()
    expect(bodyOf('POST /api/time-entries')).toEqual({ project_id: 1, milestone_id: 10, work_date: '2026-10-13', hours: '7.5', description: 'Racked row 6' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(countOf('GET /api/time-entries')).toBe(2))
  })

  it('with several projects, a project must be picked and changing it clears the milestone', async () => {
    respond('GET /api/projects', [project, secondProject])
    respond('GET /api/projects/3/milestones', [])
    respond('POST /api/time-entries', { ...entry, id: 9, week_hours: '8.00', over_limit: false })
    asEmployee('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Log hours' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Log hours' }).disabled).toBe(true)
    expect(within(dialog).getByRole('combobox', { name: /Milestone/ }).getAttribute('aria-disabled')).toBe('true')
    expect(countOf('GET /api/projects/1/milestones')).toBe(0)  // nothing to load yet

    await choose(dialog, /Project/, 'Decommission 1000 servers')
    await choose(dialog, /Milestone/, '1. Q1: 250 servers')
    await choose(dialog, /Project/, 'Move the network core')
    await waitFor(() => expect(countOf('GET /api/projects/3/milestones')).toBe(1))
    expect(within(dialog).getByRole('combobox', { name: /Milestone/ }).textContent).not.toContain('Q1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log hours' }))
    expect(await screen.findByText('Logged. You have 8 h that week.')).toBeTruthy()
    expect(bodyOf('POST /api/time-entries')).toMatchObject({ project_id: 3, milestone_id: null, hours: '8', description: null })
  })

  it('cancelling throws away what was typed', async () => {
    asEmployee('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Log hours' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Hours/), { target: { value: '3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Log hours' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Hours/).value).toBe('8')
    expect(countOf('POST /api/time-entries')).toBe(0)
  })

  it('shows the API error and keeps the dialog open', async () => {
    respond('POST /api/time-entries', { detail: 'You can only log hours on your projects' }, 403)
    asEmployee('/time-entries')
    fireEvent.click(await screen.findByRole('button', { name: 'Log hours' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log hours' }))
    expect(await within(dialog).findByText('You can only log hours on your projects')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('from a project\'s hours tab the project is fixed', async () => {
    respond('GET /api/projects', [project, secondProject])
    respond('POST /api/time-entries', { ...entry, id: 9, week_hours: '50.00', over_limit: true })
    asEmployee('/projects/1?tab=hours')
    fireEvent.click(await screen.findByRole('button', { name: 'Log hours' }))
    const dialog = await screen.findByRole('dialog')
    const picker = within(dialog).getByRole('combobox', { name: /Project/ })
    expect(picker.getAttribute('aria-disabled')).toBe('true')
    expect(picker.textContent).toBe('Decommission 1000 servers')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log hours' }))
    expect(await screen.findByText('Logged. You have 50 h that week, which is overtime (more than 40 h).')).toBeTruthy()
    expect(bodyOf('POST /api/time-entries')).toMatchObject({ project_id: 1 })
  })
})

describe('employee home', () => {
  it('this week\'s warning follows the hours shown, not only the server\'s flag', async () => {
    asEmployee('/', { hours_this_week: '42', over_limit_this_week: false })
    expect(await screen.findByText("You're in overtime: 2 h over a 40-hour week.")).toBeTruthy()
  })

  it('ticking a task saves it and reloads the list', async () => {
    respond('GET /api/milestones/10/tasks', [
      { id: 100, milestone_id: 10, title: 'Unrack 250 servers', is_done: true },
      { id: 101, milestone_id: 10, title: 'Wipe the disks', is_done: false },
    ])
    respond('PATCH /api/milestones/tasks/100', { id: 100, is_done: false })
    asEmployee('/')
    const box = await screen.findByLabelText('Mark "Unrack 250 servers" done')
    expect(box.checked).toBe(true)
    expect(screen.getByLabelText('Mark "Wipe the disks" done').checked).toBe(false)
    expect(screen.getByText('Tasks · 1 of 2 done')).toBeTruthy()
    // Done tasks are struck through
    expect(getComputedStyle(screen.getByText('Unrack 250 servers')).textDecoration).toContain('line-through')
    expect(getComputedStyle(screen.getByText('Wipe the disks')).textDecoration).not.toContain('line-through')
    expect(screen.getByText('First batch')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: 'Decommission 1000 servers' }).map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/projects/1?tab=milestones', '/projects/1'])
    fireEvent.click(box)
    await waitFor(() => expect(countOf('GET /api/milestones/10/tasks')).toBe(2))
    expect(bodyOf('PATCH /api/milestones/tasks/100')).toEqual({ is_done: false })
  })

  it('shows the error when a task cannot be ticked', async () => {
    respond('PATCH /api/milestones/tasks/100', { detail: 'This milestone is completed' }, 409)
    asEmployee('/')
    fireEvent.click(await screen.findByLabelText('Mark "Unrack 250 servers" done'))
    expect(await screen.findByText('This milestone is completed')).toBeTruthy()
  })

  it('marking their part finished confirms and reloads home', async () => {
    respond('PATCH /api/milestones/10/assignments/EMP001', { finished_at: '2026-10-13T12:00:00Z' })
    asEmployee('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark my part finished' }))
    expect(await screen.findByText('Marked finished. You can start your next milestone.')).toBeTruthy()
    expect(bodyOf('PATCH /api/milestones/10/assignments/EMP001')).toEqual({ finished: true })
    await waitFor(() => expect(countOf('GET /api/reports/home')).toBe(2))
  })

  it('shows the error when marking finished fails', async () => {
    respond('PATCH /api/milestones/10/assignments/EMP001', { detail: 'Finish your tasks first' }, 409)
    asEmployee('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark my part finished' }))
    expect(await screen.findByText('Finish your tasks first')).toBeTruthy()
    expect(countOf('GET /api/reports/home')).toBe(1)
  })

  it('a milestone without a description, and tasks that fail to load', async () => {
    respond('GET /api/milestones/10', { id: 10, project_id: 1, sequence: 1, title: 'Q1: 250 servers', description: null, end_date: '2026-11-30' })
    respond('GET /api/milestones/10/tasks', { detail: 'Tasks are unavailable' }, 503)
    asEmployee('/')
    expect(await screen.findByText('Tasks are unavailable')).toBeTruthy()
    expect(screen.getByText('1. Q1: 250 servers')).toBeTruthy()
    expect(screen.getByText('Tasks · 0 of 0 done')).toBeTruthy()
    expect(screen.queryByText('First batch')).toBeNull()
  })

  it('shows the error when the milestone cannot be loaded', async () => {
    respond('GET /api/milestones/10', { detail: 'Milestone not found' }, 404)
    asEmployee('/')
    expect(await screen.findByText('Milestone not found')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark my part finished' })).toBeNull()
  })

  it.each([
    ['exactly 40 h is a full week, not over it', { hours_this_week: '40.00', over_limit_this_week: false }, '0 h left in a 40-hour week.'],
    ['40.25 h is over', { hours_this_week: '40.25', over_limit_this_week: true }, "You're in overtime: 0.25 h over a 40-hour week."],
    ['under 40 h shows what is left', { hours_this_week: '12.50', over_limit_this_week: false }, '27.5 h left in a 40-hour week.'],
    ['no hours yet', { hours_this_week: null, over_limit_this_week: false }, '40 h left in a 40-hour week.'],
  ])('this week: %s', async (_, home, text) => {
    asEmployee('/', home)
    expect(await screen.findByText(text)).toBeTruthy()
    const bar = screen.getAllByRole('progressbar').find((p) => p.getAttribute('aria-valuenow') !== null)
    expect(Number(bar.getAttribute('aria-valuenow'))).toBe(Math.min(Number(home.hours_this_week ?? 0) / 40 * 100, 100))
  })

  it('without an active milestone or projects it says so', async () => {
    respond('GET /api/projects', [])
    asEmployee('/', { active_milestone_id: null, active_project_id: null })
    expect(await screen.findByText('No active milestone')).toBeTruthy()
    expect(screen.getByText("You're not on any projects yet")).toBeTruthy()
    expect(countOf('GET /api/milestones/10')).toBe(0)
  })

  it('lists their open projects with the manager and due date', async () => {
    asEmployee('/')
    expect(await screen.findByText('Manager: Mia Manager · due Aug 31, 2027')).toBeTruthy()
    expect(screen.queryByText('Old intranet')).toBeNull()
  })

  it('shows the error when home fails to load', async () => {
    respond('GET /api/auth/me', employee)
    respond('GET /api/reports/home', { detail: 'Reports are unavailable' }, 503)
    renderAt('/')
    expect(await screen.findByText('Reports are unavailable')).toBeTruthy()
    expect(screen.queryByText('This week')).toBeNull()
  })

  it('logs hours from home and refreshes the week', async () => {
    respond('POST /api/time-entries', { ...entry, id: 9, week_hours: '50.00', over_limit: true })
    asEmployee('/')
    await screen.findByText('This week')
    fireEvent.click(screen.getByRole('button', { name: 'Log hours' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Log hours' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log hours' }))
    expect(await screen.findByText('Logged. You have 50 h that week, which is overtime (more than 40 h).')).toBeTruthy()
    await waitFor(() => expect(countOf('GET /api/reports/home')).toBe(2))
  })
})

describe('dashboard', () => {
  it('stats link to their reports and are highlighted only when non-zero', async () => {
    respond('GET /api/reports/home', { ...homeReport, projects_at_risk: 0, projects_off_track: 2, over_allocated_employees: 0 })
    renderAt('/')
    expect(await screen.findByText('Every open project at a glance.')).toBeTruthy()
    expect(await screen.findByText('of $250,000 budgeted')).toBeTruthy()
    expect(screen.getByText('$6,000')).toBeTruthy()
    const hrefs = screen.getAllByRole('link', { name: 'View' }).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/projects', '/reports?tab=at-risk', '/reports?tab=at-risk', '/reports?tab=overtime', '/reports?tab=budget'])
    expect(screen.getByText('Now: Q1: 250 servers')).toBeTruthy()
    // compact: no manager or budget columns
    expect(screen.queryByRole('columnheader', { name: 'Manager' })).toBeNull()
  })

  it('managers see their own projects\' summary', async () => {
    asManager('/')
    expect(await screen.findByText('Your open projects at a glance.')).toBeTruthy()
    expect(await screen.findByText('Now: Q1: 250 servers')).toBeTruthy()
  })

  it('shows an empty project table', async () => {
    respond('GET /api/reports/home', { ...homeReport, active_projects: 0, projects_at_risk: 0, over_allocated_employees: 0, projects: [] })
    renderAt('/')
    expect(await screen.findByText('No projects to show')).toBeTruthy()
  })

  it('shows the error with a retry when it fails to load', async () => {
    respond('GET /api/reports/home', { detail: 'Reports are unavailable' }, 503)
    renderAt('/')
    expect(await screen.findByText('Reports are unavailable')).toBeTruthy()
    respond('GET /api/reports/home', homeReport)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Project status')).toBeTruthy()
  })
})

describe('reports', () => {
  it('an unknown tab falls back to project status, and tabs switch the report', async () => {
    renderAt('/reports?tab=nope')
    expect(await screen.findByText('Labor cost / budget')).toBeTruthy()
    expect(screen.getByText('Project health, deadline risk, budget and workload across the organization.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Budget' }))
    expect(await screen.findByText('Estimated cost')).toBeTruthy()
    expect(window.location.search).toBe('?tab=budget')
  })

  it('admins can include archived projects in project status', async () => {
    renderAt('/reports')
    await screen.findByText('Labor cost / budget')
    expect(lastCall('GET /api/reports/projects').query).toEqual({ include_archived: 'false' })
    fireEvent.click(screen.getByLabelText('Include archived projects'))
    await waitFor(() => expect(lastCall('GET /api/reports/projects').query).toEqual({ include_archived: 'true' }))
    expect(window.location.search).toBe('?tab=projects&archived=true')
    expect(screen.getByLabelText('Include archived projects').checked).toBe(true)
  })

  it('project status flags over-budget projects and handles missing values', async () => {
    respond('GET /api/reports/projects', [
      health,
      { ...health, project_id: 3, name: 'Move the network core', manager_id: 'NOBODY', current_milestone: null, timeline_pct: null, budget_used_pct: '120.5', labor_cost: '301250.00', risk: { level: 'off_track', reasons: [] } },
    ])
    renderAt('/reports')
    const row = (await screen.findByRole('link', { name: 'Move the network core' })).closest('tr')
    expect(within(row).queryByText(/^Now:/)).toBeNull()
    expect(within(row).getByText('NOBODY')).toBeTruthy()  // unknown manager shows the ID
    expect(within(row).getByText('120.5%')).toBeTruthy()
    expect(within(row).getByText('—')).toBeTruthy()
    expect(within(row).getByText('$301,250 / $250,000')).toBeTruthy()
    expect(within(row).getByText('Off track')).toBeTruthy()
    const bars = within(row).getAllByRole('progressbar')
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['0', '0', '100'])  // capped at 100
  })

  it('managers get reports for their projects without the archived toggle', async () => {
    asManager('/reports')
    expect(await screen.findByText('Health, deadline risk, budget and workload for your projects and the employees on them.')).toBeTruthy()
    expect(await screen.findByText('Labor cost / budget')).toBeTruthy()
    expect(screen.queryByLabelText('Include archived projects')).toBeNull()
  })

  it('project status shows errors', async () => {
    respond('GET /api/reports/projects', { detail: 'Reports are unavailable' }, 503)
    renderAt('/reports')
    expect(await screen.findByText('Reports are unavailable')).toBeTruthy()
  })

  it('at-risk cards show each reason, off-track and at-risk alike', async () => {
    respond('GET /api/reports/at-risk', [
      { ...health, risk: { level: 'at_risk', reasons: ['Behind schedule', 'Budget 90% used'] } },
      { ...health, project_id: 3, name: 'Move the network core', completion_pct: null, risk: { level: 'off_track', reasons: ['Past the projected end date'] } },
    ])
    renderAt('/reports?tab=at-risk')
    expect(await screen.findByText('Past the projected end date')).toBeTruthy()
    expect(screen.getByText('Behind schedule')).toBeTruthy()
    expect(screen.getByText('Budget 90% used')).toBeTruthy()
    expect(screen.getByText('Off track')).toBeTruthy()
    expect(await screen.findByText('Mia Manager · due Aug 31, 2027 · — of milestones done')).toBeTruthy()
  })

  it('at-risk shows an empty state and errors', async () => {
    respond('GET /api/reports/at-risk', [])
    const { unmount } = renderAt('/reports?tab=at-risk')
    expect(await screen.findByText('No projects at risk')).toBeTruthy()
    unmount()

    respond('GET /api/reports/at-risk', { detail: 'Reports are unavailable' }, 503)
    renderAt('/reports?tab=at-risk')
    expect(await screen.findByText('Reports are unavailable')).toBeTruthy()
    expect(screen.queryByText('No projects at risk')).toBeNull()
  })

  it('budget marks over-budget projects', async () => {
    respond('GET /api/reports/budget', [
      { project_id: 1, name: project.name, budget: '250000.00', estimated_cost: '240000.00', labor_cost: '6000.00', budget_remaining: '244000.00', budget_used_pct: '2.4', completion_pct: '0', allocated_hours: 4000, logged_hours: '120.00', over_budget: false },
      { project_id: 3, name: 'Move the network core', budget: '1000.00', estimated_cost: null, labor_cost: '1500.00', budget_remaining: '-500.00', budget_used_pct: '150', completion_pct: '50', allocated_hours: 10, logged_hours: '15.00', over_budget: true },
    ])
    renderAt('/reports?tab=budget')
    const over = (await screen.findByRole('link', { name: 'Move the network core' })).closest('tr')
    expect(within(over).getByText('Over budget')).toBeTruthy()
    expect(within(over).getByText('-$500')).toBeTruthy()
    expect(within(over).getByText('150%')).toBeTruthy()
    expect(within(over).getByText('15 h / 10 h')).toBeTruthy()
    const ok = screen.getByRole('link', { name: project.name }).closest('tr')
    expect(within(ok).queryByText('Over budget')).toBeNull()
  })

  it('budget shows an empty state and errors', async () => {
    respond('GET /api/reports/budget', [])
    const { unmount } = renderAt('/reports?tab=budget')
    expect(await screen.findByText('No open projects')).toBeTruthy()
    unmount()

    respond('GET /api/reports/budget', { detail: 'Reports are unavailable' }, 503)
    renderAt('/reports?tab=budget')
    expect(await screen.findByText('Reports are unavailable')).toBeTruthy()
  })

  it('allocation filters by team and back to everyone', async () => {
    renderAt('/reports?tab=allocation')
    expect(await screen.findByText('Planned hours per week on open projects, against a 40-hour week.')).toBeTruthy()
    expect(lastCall('GET /api/reports/allocation').query).toEqual({})
    await choose(document.body, /Team/, 'Racking crew (Mia Manager)')
    await waitFor(() => expect(lastCall('GET /api/reports/allocation').query).toEqual({ team_id: '5' }))
    expect(window.location.search).toBe('?tab=allocation&team=5')
    await choose(document.body, /Team/, 'Everyone')
    await waitFor(() => expect(window.location.search).toBe('?tab=allocation'))
    expect(lastCall('GET /api/reports/allocation').query).toEqual({})
  })

  it('allocation shows employees without projects and highlights only more than 40 logged', async () => {
    respond('GET /api/reports/allocation', [
      { user_id: 'EMP001', first_name: 'Grace', last_name: 'Hopper', manager_id: 'MGR001', hours_per_week: '40.0', over_limit: false,
        projects: [{ project_id: 1, project_name: project.name, hours_per_week: '40.0' }], last_week_logged_hours: '40.00' },
      { user_id: 'EMP002', first_name: 'Alan', last_name: 'Turing', manager_id: null, hours_per_week: '0', over_limit: false,
        projects: [], last_week_logged_hours: '40.25' },
    ])
    renderAt('/reports?tab=allocation')
    const grace = (await screen.findByText('ID EMP001')).closest('tr')
    expect(within(grace).getByText('40 h/week')).toBeTruthy()  // exactly 40 is not over
    expect(within(grace).getByText('· 40 h/week', { exact: false })).toBeTruthy()
    const graceLogged = within(grace).getByText('40 h')
    const alan = screen.getByText('ID EMP002').closest('tr')
    expect(within(alan).getByText('No open projects')).toBeTruthy()
    expect(within(alan).getByText('—')).toBeTruthy()  // no manager
    const alanLogged = within(alan).getByText('40.25 h')
    expect(getComputedStyle(alanLogged).fontWeight).toBe('600')
    expect(getComputedStyle(graceLogged).fontWeight).not.toBe('600')
  })

  it('overtime filters by a team from the URL and shows an empty state (old over-allocated links still work)', async () => {
    respond('GET /api/reports/over-allocated', [])
    renderAt('/reports?tab=over-allocated&team=5')
    expect(await screen.findByText('Nobody is working overtime')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overtime', selected: true })).toBeTruthy()
    expect(screen.getByText('A full work week is 40 hours across all of an employee\'s projects. Anything above that is overtime.')).toBeTruthy()
    expect(screen.getByText(/^Employees working overtime: planned for more than 40 hours a week/)).toBeTruthy()
    expect(lastCall('GET /api/reports/over-allocated').query).toEqual({ team_id: '5' })
    await choose(document.body, /Team/, 'Everyone')
    await waitFor(() => expect(window.location.search).toBe('?tab=overtime'))
  })

  it('allocation shows an empty state and still works when teams fail to load', async () => {
    respond('GET /api/reports/allocation', [])
    respond('GET /api/teams', { detail: 'Teams are unavailable' }, 503)
    renderAt('/reports?tab=allocation')
    expect(await screen.findByText('No employees to show')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Team/ }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Everyone'])
  })

  it('allocation shows errors', async () => {
    respond('GET /api/reports/allocation', { detail: 'Reports are unavailable' }, 503)
    renderAt('/reports?tab=allocation')
    expect(await screen.findByText('Reports are unavailable')).toBeTruthy()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { admin, calls, respond, unexpected } from './test/fakeApi'

function renderAt(path, { loggedIn = true } = {}) {
  if (loggedIn) localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('logging in', () => {
  it('logs in and opens the dashboard', async () => {
    renderAt('/', { loggedIn: false })
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'a long password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Welcome back, Ada')).toBeTruthy()
    const login = calls.find((c) => c.route === 'POST /api/auth/token')
    expect(String(login.body)).toBe('username=ada%40example.com&password=a+long+password')
  })

  it('shows the API error when login fails', async () => {
    respond('POST /api/auth/token', { detail: 'Incorrect email or password' }, 401)
    renderAt('/', { loggedIn: false })
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('Incorrect email or password')).toBeTruthy()
  })

  it('requires a new password after logging in with a temporary one', async () => {
    respond('GET /api/auth/me', { ...admin, must_change_password: true })
    renderAt('/projects')
    expect(await screen.findByText('Set your password')).toBeTruthy()
    expect(window.location.pathname).toBe('/change-password')
  })

  it('sends people back to login when their session ends', async () => {
    respond('GET /api/reports/home', { detail: 'Not logged in or session expired' }, 401)
    renderAt('/')
    expect(await screen.findByText('Your session has ended. Log in again to continue.')).toBeTruthy()
    expect(localStorage.getItem('project-tracker.token')).toBeNull()
  })

})

describe('admin screens', () => {
  const pages = [
    ['/', 'Welcome back, Ada', 'Decommission 1000 servers'],
    ['/projects', 'Projects', 'Old intranet'],
    ['/calendar?month=2026-10', 'Calendar', '1. Q1: 250 servers'],
    ['/users', 'Users', 'grace@example.com'],
    ['/teams', 'Teams', 'Racking crew'],
    ['/teams/5', 'Racking crew', 'Engineer'],
    ['/reports', 'Reports', 'Labor cost / budget'],
    ['/reports?tab=at-risk', 'Reports', /Behind schedule/],
    ['/reports?tab=budget', 'Reports', '$240,000'],
    ['/reports?tab=allocation', 'Reports', 'Logged last week'],
    ['/reports?tab=over-allocated', 'Reports', '45 h/week · over 40'],
    ['/time-entries', 'Hours', 'Unracked row 4'],
    ['/messages', 'Message board', 'Welcome to Project Tracker'],
    ['/audit', 'Audit log', '200000 → 250000'],
    ['/profile', 'Your profile', 'Administrator'],
  ]

  it.each(pages)('%s renders', async (path, heading, content) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderAt(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    expect((await screen.findAllByText(content)).length).toBeGreaterThan(0)
    expect(unexpected).toEqual([])
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it.each(['overview', 'team', 'milestones', 'deliverables', 'hours', 'board'])('project %s tab renders', async (tab) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderAt(`/projects/1?tab=${tab}`)
    expect(await screen.findByRole('heading', { name: 'Decommission 1000 servers' })).toBeTruthy()
    const expected = {
      overview: /^0 of 2 milestones done · \d+% of timeline used$/,
      team: '45 h/week',
      milestones: '1. Q1: 250 servers',
      deliverables: 'Waiting on milestone 1',
      hours: 'Unracked row 4',
      board: 'Write a message',
    }[tab]
    expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0)
    expect(unexpected).toEqual([])
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('archived projects are read-only and can be unarchived', async () => {
    renderAt('/projects/2')
    expect(await screen.findByText(/This project is archived/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy()
  })

  it('expanding a milestone loads its tasks and assignees', async () => {
    renderAt('/projects/1?tab=milestones')
    fireEvent.click(await screen.findByText('1. Q1: 250 servers'))
    expect(await screen.findByText('Unrack 250 servers')).toBeTruthy()
    expect(await screen.findByText('Mark finished')).toBeTruthy()
  })

  it('deleting a project archives it as deleted', async () => {
    respond('DELETE /api/projects/1', { id: 1, archived: true })
    renderAt('/projects/1')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(calls.some((c) => c.route === 'DELETE /api/projects/1')).toBe(true))
    expect(JSON.parse(calls.find((c) => c.route === 'DELETE /api/projects/1').body)).toEqual({ reason: 'deleted' })
  })

  it('creating a user shows their login email and temporary password', async () => {
    respond('POST /api/users', { user: { ...admin, id: 'NEW123', role: 'manager', first_name: 'New', last_name: 'Manager', email: 'new@example.com' }, temporary_password: 'temp-secret-1' })
    renderAt('/users')
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Role/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Manager' }))
    for (const [label, value] of [['First name', 'New'], ['Last name', 'Manager'], ['Email', 'new@example.com'], ['Job title', 'Manager']]) {
      fireEvent.change(within(dialog).getByLabelText(new RegExp(label)), { target: { value } })
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await screen.findByDisplayValue('new@example.com')).toBeTruthy()
    expect(screen.getByDisplayValue('temp-secret-1')).toBeTruthy()
    const body = JSON.parse(calls.find((c) => c.route === 'POST /api/users').body)
    expect(body).toMatchObject({ role: 'manager', first_name: 'New', email: 'new@example.com', manager_id: null, temporary_password: null })
  })
})


describe('progress bars and calendar', () => {
  // Only Date is faked, so "today" is fixed while promises and timers run normally
  const onDay = (iso) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${iso}T12:00:00`))
  }
  afterEach(() => vi.useRealTimers())

  it('the projects list shows each open project\'s milestone progress', async () => {
    onDay('2026-10-13')
    renderAt('/projects')
    const bar = await screen.findByRole('img', { name: /^Decommission 1000 servers: 0 of 2 milestones done/ })
    expect(bar.getAttribute('aria-label')).toContain('Q1: 250 servers in progress, Q2: 500 servers not started')
    expect(screen.getByText('0/2 done')).toBeTruthy()
    // Archived projects show their dates without a progress bar
    const archivedRow = screen.getByText('Old intranet').closest('tr')
    expect(within(archivedRow).queryByRole('img')).toBeNull()
    expect(within(archivedRow).getByText('Sep 1, 2026 – Aug 31, 2027')).toBeTruthy()
    expect(calls.filter((c) => c.route === 'GET /api/milestones')).toHaveLength(1)
  })

  it('the project overview flags overdue milestones', async () => {
    onDay('2026-12-05')
    renderAt('/projects/1')
    expect(await screen.findByText(/0 of 2 milestones done · \d+% of timeline used · 1 overdue/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /Q1: 250 servers overdue/ })).toBeTruthy()
  })

  it('the calendar shows milestones and highlights deadlines for the month', async () => {
    onDay('2026-11-10')
    renderAt('/calendar')
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy()
    // The grid runs Monday Oct 26 to Sunday Dec 6
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/milestones').query).toEqual({ start: '2026-10-26', end: '2026-12-06' }))
    expect(await screen.findByRole('button', { name: 'Decommission 1000 servers: milestone 1, Q1: 250 servers, In progress, due Nov 30, 2026' })).toBeTruthy()
    // Q2 starts Dec 1, inside the grid's last week
    expect(screen.getByRole('button', { name: /milestone 2, Q2: 500 servers, Not started/ })).toBeTruthy()
    expect(screen.getByText('Due')).toBeTruthy()
    expect(screen.getByText('Decommission 1000 servers · 1. Q1: 250 servers')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeTruthy()
    expect(window.location.search).toBe('?month=2026-12')
    await waitFor(() => expect(calls.findLast((c) => c.route === 'GET /api/milestones').query).toEqual({ start: '2026-11-30', end: '2027-01-03' }))
    expect(await screen.findByText('No deadlines this month')).toBeTruthy()
  })

  it('the calendar shows project deadlines and opens the project', async () => {
    onDay('2027-08-02')
    renderAt('/calendar?month=2027-08')
    const deadline = await screen.findByRole('button', { name: 'Decommission 1000 servers: project due Aug 31, 2027' })
    expect(screen.getByText('Project due')).toBeTruthy()
    expect(screen.getByText('Project due: Decommission 1000 servers')).toBeTruthy()
    fireEvent.click(deadline)
    expect(await screen.findByRole('heading', { name: 'Decommission 1000 servers' })).toBeTruthy()
    expect(window.location.pathname).toBe('/projects/1')
  })
})

describe('manager screens', () => {
  const manager = { ...admin, id: 'MGR001', role: 'manager', first_name: 'Mia', last_name: 'Manager', salary: '150000.00' }
  const asManager = (path) => {
    respond('GET /api/auth/me', manager)
    return renderAt(path)
  }

  it('shows the manager navigation without the audit log', async () => {
    asManager('/')
    expect(await screen.findByText('Your open projects at a glance.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Employees' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull()
  })

  it('sends managers away from the audit log', async () => {
    asManager('/audit')
    expect(await screen.findByText('Your open projects at a glance.')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
  })

  it('managers can edit their projects but not create, delete, or set the budget', async () => {
    respond('PATCH /api/projects/1', { id: 1, archived: false })
    asManager('/projects/1')
    expect(await screen.findByRole('heading', { name: 'Decommission 1000 servers' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByText('Budget estimate')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Budget/).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.some((c) => c.route === 'PATCH /api/projects/1')).toBe(true))
    const body = JSON.parse(calls.find((c) => c.route === 'PATCH /api/projects/1').body)
    expect(body).not.toHaveProperty('budget')
    expect(body).not.toHaveProperty('manager_id')
  })

  it('managers only see the projects list without admin controls', async () => {
    asManager('/projects')
    expect(await screen.findByText(/The projects you manage/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archived' })).toBeNull()
  })

  it('managers see employees read-only', async () => {
    asManager('/users')
    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New user' })).toBeNull()
    fireEvent.click(await screen.findByText('Grace Hopper'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('managers create teams for themselves', async () => {
    respond('POST /api/teams', { id: 6, name: 'Night shift', manager_id: 'MGR001' })
    asManager('/teams')
    fireEvent.click(await screen.findByRole('button', { name: 'New team' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(/Manager/)).toBeNull()
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Night shift' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create team' }))
    await waitFor(() => expect(calls.some((c) => c.route === 'POST /api/teams')).toBe(true))
    expect(JSON.parse(calls.find((c) => c.route === 'POST /api/teams').body).manager_id).toBe('MGR001')
  })

  it('managers post to their projects, not to everyone, and only delete their own posts', async () => {
    asManager('/messages')
    expect(await screen.findByText('Welcome to Project Tracker')).toBeTruthy()
    expect(screen.getByText(/Ada Admin/)).toBeTruthy()  // the author's name comes with the message
    expect(screen.queryByRole('button', { name: 'Delete message' })).toBeNull()  // posted by an admin
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /Post to/ }))
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(options).toContain('Decommission 1000 servers')
    expect(options).not.toContain('Everyone (announcement)')
  })

  it('managers see hours read-only', async () => {
    asManager('/time-entries')
    expect(await screen.findByText('Unracked row 4')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Correct entry|Delete entry/ })).toBeNull()
    expect(screen.queryByLabelText('Correct entry')).toBeNull()
  })

  it('managers get their reports without the archived toggle', async () => {
    asManager('/reports')
    expect(await screen.findByText(/for your projects and the employees on them/)).toBeTruthy()
    expect(screen.queryByText('Include archived projects')).toBeNull()
  })
})


describe('employee screens', () => {
  const employee = { ...admin, id: 'EMP001', role: 'employee', first_name: 'Grace', last_name: 'Hopper', manager_id: 'MGR001' }
  delete employee.salary
  const asEmployee = (path) => {
    respond('GET /api/auth/me', employee)
    respond('GET /api/reports/home', {
      active_milestone_id: 10, active_milestone_title: 'Q1: 250 servers', active_project_id: 1,
      project_ids: [1], hours_this_week: '42.00', over_limit_this_week: true,
    })
    return renderAt(path)
  }

  it('home shows the current milestone, its tasks and this week\'s hours', async () => {
    asEmployee('/')
    expect(await screen.findByText('Welcome back, Grace')).toBeTruthy()
    expect(await screen.findByText('1. Q1: 250 servers')).toBeTruthy()
    expect(await screen.findByText('Unrack 250 servers')).toBeTruthy()
    expect(screen.getByText(/over a 40-hour week by 2 h/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark my part finished' })).toBeTruthy()
  })

  it('shows the employee navigation only', async () => {
    asEmployee('/')
    expect(await screen.findByRole('link', { name: 'My projects' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'My hours' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Calendar' })).toBeTruthy()
    for (const hidden of ['Employees', 'Users', 'Teams', 'Reports', 'Audit log']) {
      expect(screen.queryByRole('link', { name: hidden })).toBeNull()
    }
  })

  it('sends employees away from manager screens', async () => {
    asEmployee('/reports')
    expect(await screen.findByText('Welcome back, Grace')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
  })

  it('employees see their projects without budgets or costs', async () => {
    asEmployee('/projects')
    expect(await screen.findByRole('heading', { name: 'My projects' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Budget' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New project' })).toBeNull()
  })

  it('project pages are read-only apart from their own milestone work', async () => {
    asEmployee('/projects/1')
    expect(await screen.findByRole('heading', { name: 'Decommission 1000 servers' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByText('Budget')).toBeNull()
    expect(screen.queryByText('Health')).toBeNull()
    expect(calls.some((c) => c.route.startsWith('GET /api/reports'))).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: 'Milestones' }))
    expect(screen.queryByRole('button', { name: 'Add milestone' })).toBeNull()
    fireEvent.click(await screen.findByText('1. Q1: 250 servers'))
    expect(await screen.findByRole('button', { name: 'Mark my part finished' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull()
    expect(screen.queryByLabelText('Unassign')).toBeNull()
    await waitFor(() => expect(screen.getByLabelText('Mark "Unrack 250 servers" done').disabled).toBe(false))
  })

  it('logging hours warns when the week goes over 40', async () => {
    respond('POST /api/time-entries', { id: 9, user_id: 'EMP001', project_id: 1, milestone_id: null, work_date: '2026-10-13',
      hours: '4.00', description: null, week_hours: '46.00', over_limit: true, created_at: '', updated_at: '' })
    asEmployee('/time-entries')
    expect(await screen.findByRole('heading', { name: 'My hours' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Log hours' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: /Project/ }))
    fireEvent.click(await screen.findByRole('option', { name: 'Decommission 1000 servers' }))
    fireEvent.change(within(dialog).getByLabelText(/Hours/), { target: { value: '4' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log hours' }))
    expect(await screen.findByText('Logged. You have 46 h that week, more than a 40-hour week.')).toBeTruthy()
    const body = JSON.parse(calls.find((c) => c.route === 'POST /api/time-entries').body)
    expect(body).toMatchObject({ project_id: 1, hours: '4', milestone_id: null })
  })
})

/**
 * People, admin and infrastructure: users, teams, the audit log, profile and
 * passwords, the layout's account menu, the auth context, the API client and
 * endpoints, and the shared components, hooks and helpers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, configure, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { admin, calls, fakeFetch, respond, users as fakeUsers } from './fakeApi'
import * as api from '../api/endpoints'
import { ApiError, request, setAccessToken, setUnauthorizedHandler } from '../api/client'
import { NotificationProvider, useNotify } from '../components/Notifications'
import { DirectoryProvider, useDirectory } from '../components/Directory'
import FormDialog from '../components/FormDialog'
import PasswordForm from '../components/PasswordForm'
import {
  ConfirmDialog, EmptyState, ErrorAlert, Field, HoursChip, Loading, MilestoneStatusChip, PageHeader, ProjectStatusChip,
  RiskChip, RoleChip,
} from '../components/common'
import { useApiData } from '../hooks/useApiData'
import { useDebounced } from '../hooks/useDebounced'
import {
  MILESTONE_STATUS_LABELS, PROJECT_STATUS_LABELS, RISK_LABELS, ROLE_LABELS, dateTime, day, fullName, hours, money,
  percent, todayIso,
} from '../utils/format'
import { MILESTONE_STATES, addDays, daysBetween, isoDay, milestoneState, parseDay } from '../utils/milestones'

// The first render in a file also pays for loading MUI, so allow findBy* a little longer than the 1 s default
configure({ asyncUtilTimeout: 3000 })

const manager = fakeUsers[1]
const employee = fakeUsers[2]
const team = { id: 5, name: 'Racking crew', description: 'Hands on hardware', manager_id: 'MGR001', member_count: 1, created_at: '2026-09-05T09:00:00Z', updated_at: '2026-09-05T09:00:00Z' }
const member = { team_id: 5, user_id: 'EMP001', first_name: 'Grace', last_name: 'Hopper', job_title: 'Engineer', is_active: true, added_at: '2026-09-05T09:00:00Z' }

function renderAt(path, { loggedIn = true } = {}) {
  if (loggedIn) localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

const renderAs = (user, path) => {
  respond('GET /api/auth/me', user)
  return renderAt(path)
}

const lastCall = (route) => calls.findLast((c) => c.route === route)
const bodyOf = (route) => JSON.parse(lastCall(route).body)
const called = (route, query) => calls.some((c) => c.route === route && Object.entries(query).every(([k, v]) => c.query[k] === v))

/** Opens a MUI select and picks an option. */
async function choose(scope, label, option) {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

/** Types into a UserPicker (Autocomplete) and picks the matching person. */
async function pickUser(scope, label, name) {
  fireEvent.change(await within(scope).findByRole('combobox', { name: label }), { target: { value: name.split(' ')[0] } })
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }))
}

/** Holds one route's response until the returned function is called, to see in-flight states. */
function holdRoute(route) {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  globalThis.fetch.mockImplementation(async (input, options = {}) => {
    if (`${options.method || 'GET'} ${new URL(String(input)).pathname}` === route) await gate
    return fakeFetch(input, options)
  })
  return release
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Full-page flows render a lot of MUI; leave room for slow machines and coverage runs
describe('users page (admin)', { timeout: 15000 }, () => {
  it('filters by search and role', async () => {
    renderAt('/users')
    expect(await screen.findByText('grace@example.com')).toBeTruthy()
    expect(called('GET /api/users', { include_inactive: 'false' })).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('Search by name, email or ID'), { target: { value: '  grace ' } })
    await waitFor(() => expect(called('GET /api/users', { q: 'grace' })).toBe(true))

    // Admins can filter by every role, including admins
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Role' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Any role', 'Admin', 'Manager', 'Employee'])
    fireEvent.click(screen.getByRole('option', { name: 'Manager' }))
    await waitFor(() => expect(called('GET /api/users', { q: 'grace', role: 'manager' })).toBe(true))
  })

  it('filters by manager and shows deactivated users', async () => {
    renderAt('/users')
    await pickUser(document.body, 'Reports to', 'Mia Manager')
    await waitFor(() => expect(called('GET /api/users', { manager_id: 'MGR001' })).toBe(true))
    // Clearing the picker drops the filter again
    fireEvent.change(screen.getByRole('combobox', { name: 'Reports to' }), { target: { value: '' } })
    await waitFor(() => expect(lastCall('GET /api/users').query).not.toHaveProperty('manager_id'))

    fireEvent.click(screen.getByLabelText('Show deactivated'))
    await waitFor(() => expect(lastCall('GET /api/users').query.include_inactive).toBe('true'))
  })

  it('shows each user\'s manager, salary and status', async () => {
    respond('GET /api/users', [
      admin,
      employee,
      { ...employee, id: 'EMP002', first_name: 'Old', last_name: 'Timer', email: 'old@example.com', is_active: false, manager_id: 'GONE01' },
      { ...employee, id: 'EMP003', first_name: 'New', last_name: 'Hire', email: 'new@example.com', must_change_password: true },
    ])
    renderAt('/users')
    const row = async (name) => (await screen.findByText(name)).closest('tr')
    const adminRow = within(await row('Ada Admin'))
    expect(adminRow.getAllByText('—')).toHaveLength(2)  // no manager and no salary
    expect(adminRow.getByText('Active')).toBeTruthy()
    await waitFor(() => expect(within(screen.getByText('Grace Hopper').closest('tr')).queryByText('Mia Manager')).toBeNull())
    // Grace's manager isn't in the list (the directory loads the same users), so the name stays hidden
    const graceRow = within(await row('Grace Hopper'))
    expect(graceRow.getByText('Another manager')).toBeTruthy()
    expect(graceRow.getByText('$104,000')).toBeTruthy()
    expect(within(await row('Old Timer')).getByText("Deactivated (can't log in)")).toBeTruthy()
    expect(within(await row('New Hire')).getByText("Hasn't logged in yet")).toBeTruthy()
  })

  it('names the manager when the directory knows them', async () => {
    renderAt('/users')
    const graceRow = (await screen.findByText('Grace Hopper')).closest('tr')
    expect(await within(graceRow).findByText('Mia Manager')).toBeTruthy()
  })

  it('shows an empty state when no users match', async () => {
    respond('GET /api/users', [])
    renderAt('/users')
    expect(await screen.findByText('No users match')).toBeTruthy()
    expect(screen.getByText('Change the filters, or add a user.')).toBeTruthy()
  })

  it('shows a loading error and retries', async () => {
    respond('GET /api/users', { detail: 'Users are unavailable' }, 503)
    renderAt('/users')
    expect(await screen.findByText('Users are unavailable')).toBeTruthy()
    respond('GET /api/users', fakeUsers)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('grace@example.com')).toBeTruthy()
    expect(screen.queryByText('Users are unavailable')).toBeNull()
  })

  it('new employees need a manager and salary before they can be created', async () => {
    respond('POST /api/users', { user: { ...employee, id: 'EMP009', first_name: 'Alan', last_name: 'Turing', email: 'alan@example.com' }, temporary_password: 'chosen-pass' })
    renderAt('/users')
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    for (const [label, value] of [['First name', ' Alan '], ['Last name', 'Turing'], ['Email', 'alan@example.com '], ['Job title', 'Engineer']]) {
      fireEvent.change(within(dialog).getByLabelText(new RegExp(label)), { target: { value } })
    }
    const create = within(dialog).getByRole('button', { name: 'Create user' })
    expect(within(dialog).getByText('Required for employees')).toBeTruthy()
    expect(create.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Annual salary/), { target: { value: '90000' } })
    expect(create.disabled).toBe(true)  // still no manager
    await pickUser(dialog, /^Manager/, 'Mia Manager')
    expect(create.disabled).toBe(false)
    fireEvent.change(within(dialog).getByLabelText(/Temporary password/), { target: { value: 'chosen-pass' } })
    fireEvent.click(create)

    const credentials = await screen.findByRole('dialog', { name: 'Login details' })
    expect(within(credentials).getByText(/Give these to Alan Turing/)).toBeTruthy()
    expect(within(credentials).getByDisplayValue('alan@example.com')).toBeTruthy()
    expect(within(credentials).getByDisplayValue('chosen-pass')).toBeTruthy()
    expect(within(credentials).getByText('User ID EMP009, for reference')).toBeTruthy()
    expect(bodyOf('POST /api/users')).toEqual({
      role: 'employee', first_name: 'Alan', last_name: 'Turing', email: 'alan@example.com', job_title: 'Engineer',
      salary: '90000', manager_id: 'MGR001', temporary_password: 'chosen-pass',
    })
    fireEvent.click(within(credentials).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('switching a new user to admin drops the manager requirement', async () => {
    renderAt('/users')
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: /^Manager/ })).toBeTruthy()
    await choose(dialog, /Role/, 'Admin')
    expect(within(dialog).queryByRole('combobox', { name: /^Manager/ })).toBeNull()
    expect(within(dialog).getByText('Optional')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Create user' }).disabled).toBe(false)
  })

  it('keeps the dialog open with the error when creating fails, and cancel closes it', async () => {
    respond('POST /api/users', { detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address' }] }, 422)
    renderAt('/users')
    fireEvent.click(await screen.findByRole('button', { name: 'New user' }))
    const dialog = await screen.findByRole('dialog')
    await choose(dialog, /Role/, 'Manager')
    for (const [label, value] of [['First name', 'Mo'], ['Last name', 'Lead'], ['Email', 'mo@example'], ['Job title', 'Lead']]) {
      fireEvent.change(within(dialog).getByLabelText(new RegExp(label)), { target: { value } })
    }
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByText('email: value is not a valid email address')).toBeTruthy()
    expect(bodyOf('POST /api/users')).toMatchObject({ role: 'manager', salary: null, manager_id: null, temporary_password: null })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('copies login details to the clipboard when it is available', async () => {
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    respond('POST /api/users/EMP001/reset-password', { user: employee, temporary_password: 'reset-pass-9' })
    try {
      renderAt('/users')
      fireEvent.click(await screen.findByText('Grace Hopper'))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }))
      const confirm = await screen.findByRole('dialog', { name: 'Reset password?' })
      fireEvent.click(within(confirm).getByRole('button', { name: 'Reset password' }))
      const credentials = await screen.findByRole('dialog', { name: 'Login details' })
      const [copyEmail, copyPassword] = within(credentials).getAllByRole('button', { name: 'Copy' })
      fireEvent.click(copyEmail)
      expect(await screen.findByText('Email copied')).toBeTruthy()
      expect(writeText).toHaveBeenCalledWith('grace@example.com')
      // A refused clipboard is ignored
      fireEvent.click(copyPassword)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('reset-pass-9'))
      expect(screen.queryByText('Temporary password copied')).toBeNull()
    } finally {
      delete navigator.clipboard
    }
  })

  it('copy does nothing without a clipboard', async () => {
    respond('POST /api/users/EMP001/reset-password', { user: employee, temporary_password: 'reset-pass-9' })
    renderAt('/users')
    fireEvent.click(await screen.findByText('Grace Hopper'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Reset password?' })).getByRole('button', { name: 'Reset password' }))
    const credentials = await screen.findByRole('dialog', { name: 'Login details' })
    fireEvent.click(within(credentials).getAllByRole('button', { name: 'Copy' })[0])
    expect(screen.queryByText('Email copied')).toBeNull()
    expect(within(credentials).getByDisplayValue('reset-pass-9')).toBeTruthy()
  })

  it('edits an employee and deactivates them', async () => {
    respond('PATCH /api/users/EMP001', { ...employee, is_active: false })
    renderAt('/users')
    fireEvent.click(await screen.findByText('Grace Hopper'))
    const dialog = await screen.findByRole('dialog', { name: 'Grace Hopper (EMP001)' })
    expect(within(dialog).getByDisplayValue('104000.00')).toBeTruthy()
    expect(within(dialog).queryByText(/You can't deactivate yourself/)).toBeNull()
    fireEvent.change(within(dialog).getByLabelText(/Job title/), { target: { value: 'Senior Engineer' } })
    fireEvent.click(within(dialog).getByLabelText('Active: can log in'))
    expect(within(dialog).getByLabelText('Deactivated: can\'t log in')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('User saved')).toBeTruthy()
    expect(bodyOf('PATCH /api/users/EMP001')).toEqual({
      role: 'employee', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com', job_title: 'Senior Engineer',
      salary: '104000.00', manager_id: 'MGR001', is_active: false,
    })
    // The list and the directory reload after the change
    await waitFor(() => expect(calls.filter((c) => c.route === 'GET /api/users').length).toBeGreaterThanOrEqual(4))
  })

  it('admins can\'t deactivate themselves; a manager is never their own manager', async () => {
    renderAt('/users')
    fireEvent.click(await screen.findByText('mia@example.com'))
    let dialog = await screen.findByRole('dialog', { name: 'Mia Manager (MGR001)' })
    await choose(dialog, /Role/, 'Employee')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Manager/ }), { target: { value: 'Mia' } })
    expect(screen.queryByRole('option', { name: /Mia Manager/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByText('Ada Admin'))
    dialog = await screen.findByRole('dialog', { name: 'Ada Admin (ADMIN1)' })
    expect(within(dialog).getByLabelText('Active: can log in').disabled).toBe(true)
    expect(within(dialog).getByText('You can\'t deactivate yourself or remove your own admin role.')).toBeTruthy()
  })

  it('saving an admin sends no salary or manager; save errors stay in the dialog', async () => {
    respond('PATCH /api/users/ADMIN1', { detail: 'Email already in use' }, 409)
    renderAt('/users')
    fireEvent.click(await screen.findByText('Ada Admin'))
    const dialog = await screen.findByRole('dialog', { name: 'Ada Admin (ADMIN1)' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('Email already in use')).toBeTruthy()
    expect(bodyOf('PATCH /api/users/ADMIN1')).toMatchObject({ role: 'admin', salary: null, manager_id: null, is_active: true })
  })

  it('resetting a password can be cancelled, and failures stay in the dialog', async () => {
    respond('POST /api/users/EMP001/reset-password', { detail: 'Try again later' }, 429)
    renderAt('/users')
    fireEvent.click(await screen.findByText('Grace Hopper'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }))
    let confirm = await screen.findByRole('dialog', { name: 'Reset password?' })
    expect(within(confirm).getByText(/Grace Hopper gets a new temporary password/)).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.route === 'POST /api/users/EMP001/reset-password')).toBe(false)

    fireEvent.click(screen.getByText('Grace Hopper'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }))
    confirm = await screen.findByRole('dialog', { name: 'Reset password?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Reset password' }))
    expect(await within(confirm).findByText('Try again later')).toBeTruthy()
  })
})

describe('users page (manager)', { timeout: 15000 }, () => {
  it('managers can filter employees but not by admin or deactivated', async () => {
    renderAs(manager, '/users')
    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeTruthy()
    expect(screen.getByText(/Admins add and edit users/)).toBeTruthy()
    expect(screen.queryByLabelText('Show deactivated')).toBeNull()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Role' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Any role', 'Manager', 'Employee'])
  })

  it('clicking an employee opens nothing for managers', async () => {
    renderAs(manager, '/users')
    fireEvent.click(await screen.findByText('grace@example.com'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New user' })).toBeNull()
  })
})

describe('teams', { timeout: 15000 }, () => {
  it('admins filter teams by name and manager', async () => {
    respond('GET /api/teams', [team, { ...team, id: 7, name: 'Bare team', description: null, member_count: 0 }])
    renderAt('/teams')
    expect(await screen.findByText(/Groups of a manager's direct reports/)).toBeTruthy()
    const bare = (await screen.findByText('Bare team')).closest('tr')
    expect(within(bare).getByText('0')).toBeTruthy()
    expect(screen.getByText('Hands on hardware')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search by name'), { target: { value: ' rack ' } })
    await waitFor(() => expect(called('GET /api/teams', { q: 'rack' })).toBe(true))
    await pickUser(document.body, 'Manager', 'Mia Manager')
    await waitFor(() => expect(called('GET /api/teams', { q: 'rack', manager_id: 'MGR001' })).toBe(true))
  })

  it('opens a team from the list', async () => {
    renderAt('/teams')
    fireEvent.click(await screen.findByText('Racking crew'))
    expect(await screen.findByRole('heading', { name: 'Racking crew' })).toBeTruthy()
    expect(window.location.pathname).toBe('/teams/5')
  })

  it('shows an empty state when there are no teams', async () => {
    respond('GET /api/teams', [])
    renderAt('/teams')
    expect(await screen.findByText('No teams yet')).toBeTruthy()
  })

  it('shows a loading error with a retry', async () => {
    respond('GET /api/teams', {}, 500)
    renderAt('/teams')
    expect(await screen.findByText('Something went wrong on the server. Try again shortly.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('managers see no manager filter', async () => {
    renderAs(manager, '/teams')
    expect(await screen.findByText(/Groups of your direct reports/)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Manager' })).toBeNull()
  })

  it('admins must pick a manager for a new team, then land on it', async () => {
    respond('POST /api/teams', { ...team, id: 6, name: 'Night shift' })
    respond('GET /api/teams/6', { ...team, id: 6, name: 'Night shift', description: 'Late crew', member_count: 0 })
    respond('GET /api/teams/6/members', [])
    renderAt('/teams')
    fireEvent.click(await screen.findByRole('button', { name: 'New team' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: ' Night shift ' } })
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: ' Late crew ' } })
    const create = within(dialog).getByRole('button', { name: 'Create team' })
    expect(create.disabled).toBe(true)
    await pickUser(dialog, /Manager/, 'Mia Manager')
    fireEvent.click(create)
    expect(await screen.findByRole('heading', { name: 'Night shift' })).toBeTruthy()
    expect(window.location.pathname).toBe('/teams/6')
    expect(screen.getByText('Team created')).toBeTruthy()
    expect(screen.getByText('No members yet')).toBeTruthy()
    expect(bodyOf('POST /api/teams')).toEqual({ name: 'Night shift', description: 'Late crew', manager_id: 'MGR001' })
  })

  it('shows validation errors from creating a team and cancels', async () => {
    respond('POST /api/teams', { detail: [{ loc: ['body', 'name'], msg: 'String should have at least 1 character' }] }, 422)
    renderAs(manager, '/teams')
    fireEvent.click(await screen.findByRole('button', { name: 'New team' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Your direct reports can join this team.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create team' }))
    expect(await within(dialog).findByText('name: String should have at least 1 character')).toBeTruthy()
    expect(bodyOf('POST /api/teams')).toEqual({ name: '', description: null, manager_id: 'MGR001' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('team detail', { timeout: 15000 }, () => {
  it('shows the manager and description and says when everyone is already on the team', async () => {
    renderAt('/teams/5')
    expect(await screen.findByText('Managed by Mia Manager · Hands on hardware')).toBeTruthy()
    expect(screen.getByText('Members · 1')).toBeTruthy()
    expect(screen.getByText('Everyone who reports to this manager is already on the team')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true)
    expect(screen.getByRole('link', { name: '← Teams' }).getAttribute('href')).toBe('/teams')
  })

  it('shows a load error with the page header, and retries', async () => {
    respond('GET /api/teams/5', { detail: 'Team not found' }, 404)
    renderAt('/teams/5')
    expect(await screen.findByText('Team not found')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Team' })).toBeTruthy()
    respond('GET /api/teams/5', team)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Racking crew' })).toBeTruthy()
  })

  it('adds one of the manager\'s active direct reports', async () => {
    respond('GET /api/users', [
      ...fakeUsers,
      { ...employee, id: 'EMP002', first_name: 'Alan', last_name: 'Turing' },
      { ...employee, id: 'EMP003', first_name: 'Inactive', last_name: 'Person', is_active: false },
      { ...employee, id: 'EMP004', first_name: 'Other', last_name: 'Report', manager_id: 'MGR999' },
    ])
    respond('POST /api/teams/5/members', { team_id: 5, user_id: 'EMP002' })
    renderAt('/teams/5')
    const picker = await screen.findByRole('combobox', { name: 'Add one of Mia Manager\'s direct reports' })
    fireEvent.mouseDown(picker)
    fireEvent.change(picker, { target: { value: 'e' } })
    // Only Alan: Grace is already a member, the others are inactive or report elsewhere
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Alan Turing (EMP002)'])
    fireEvent.click(screen.getByRole('option', { name: 'Alan Turing (EMP002)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Added to the team')).toBeTruthy()
    expect(bodyOf('POST /api/teams/5/members')).toEqual({ user_id: 'EMP002' })
    await waitFor(() => expect(calls.filter((c) => c.route === 'GET /api/teams/5/members')).toHaveLength(2))
  })

  it('shows why adding a member failed', async () => {
    respond('GET /api/users', [...fakeUsers, { ...employee, id: 'EMP002', first_name: 'Alan', last_name: 'Turing' }])
    respond('POST /api/teams/5/members', { detail: 'Alan is already on another team' }, 409)
    renderAt('/teams/5')
    await pickUser(document.body, /direct reports/, 'Alan Turing')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Alan is already on another team')).toBeTruthy()
  })

  it('marks deactivated members and shows an empty team', async () => {
    respond('GET /api/teams/5/members', [{ ...member, is_active: false }])
    const { unmount } = renderAt('/teams/5')
    expect(await screen.findByText('ID EMP001 · deactivated')).toBeTruthy()
    unmount()

    respond('GET /api/teams/5/members', [])
    renderAt('/teams/5')
    expect(await screen.findByText('No members yet')).toBeTruthy()
  })

  it('shows member load errors with a retry', async () => {
    respond('GET /api/teams/5/members', { detail: 'Members unavailable' }, 503)
    renderAt('/teams/5')
    expect(await screen.findByText('Members unavailable')).toBeTruthy()
    respond('GET /api/teams/5/members', [member])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Grace Hopper')).toBeTruthy()
  })

  it('edits the name and description', async () => {
    respond('PATCH /api/teams/5', { ...team, description: 'Cables and racks' })
    renderAt('/teams/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit team' })
    expect(within(dialog).getByDisplayValue('Hands on hardware')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: ' Cables and racks ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Team saved')).toBeTruthy()
    expect(bodyOf('PATCH /api/teams/5')).toEqual({ name: 'Racking crew', description: 'Cables and racks' })
  })

  it('a team without a description edits with an empty one', async () => {
    respond('GET /api/teams/5', { ...team, description: null })
    respond('PATCH /api/teams/5', { ...team, description: null })
    renderAt('/teams/5')
    expect(await screen.findByText('Managed by Mia Manager')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit team' })
    expect(within(dialog).getByLabelText(/Description/).value).toBe('')
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Rack team ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastCall('PATCH /api/teams/5')).toBeTruthy())
    expect(bodyOf('PATCH /api/teams/5')).toEqual({ name: 'Rack team', description: null })
  })

  it('deleting a team returns to the list; failures stay in the dialog', async () => {
    respond('DELETE /api/teams/5', { detail: 'Team is in use' }, 409)
    renderAt('/teams/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this team?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete team' }))
    expect(await within(dialog).findByText('Team is in use')).toBeTruthy()

    respond('DELETE /api/teams/5', null, 204)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete team' }))
    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeTruthy()
    expect(window.location.pathname).toBe('/teams')
    expect(screen.getByText('Team deleted')).toBeTruthy()
  })

  it('removing a member asks first and can be cancelled', async () => {
    respond('DELETE /api/teams/5/members/EMP001', null, 204)
    renderAt('/teams/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from team' }))
    let dialog = await screen.findByRole('dialog', { name: 'Remove from team?' })
    expect(within(dialog).getByText('Grace Hopper leaves the team but stays on their projects.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Remove from team' }))
    dialog = await screen.findByRole('dialog', { name: 'Remove from team?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Removed from the team')).toBeTruthy()
    expect(lastCall('DELETE /api/teams/5/members/EMP001')).toBeTruthy()
  })

  it('cancelling the delete keeps the team', async () => {
    renderAt('/teams/5')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this team?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.some((c) => c.route === 'DELETE /api/teams/5')).toBe(false)
  })
})

describe('audit log', { timeout: 15000 }, () => {
  const at = '2026-10-01T10:00:00Z'
  const entries = [
    { id: 1, occurred_at: at, actor_id: 'ADMIN1', action: 'INSERT', entity: 'projects', entity_id: '1', changes: { name: 'New project', budget: null, created_at: at } },
    { id: 2, occurred_at: at, actor_id: 'ADMIN1', action: 'DELETE', entity: 'milestones', entity_id: '10', changes: { title: 'Old milestone' } },
    { id: 3, occurred_at: at, actor_id: 'ADMIN1', action: 'INSERT', entity: 'users', entity_id: 'NEW001', changes: { first_name: 'New', last_name: 'Person', role: 'manager' } },
    { id: 4, occurred_at: at, actor_id: 'ADMIN1', action: 'INSERT', entity: 'team_members', entity_id: '5', changes: { first_name: 'Solo', last_name: 'Member' } },
    { id: 5, occurred_at: at, actor_id: 'MGR001', action: 'INSERT', entity: 'messages', entity_id: '7', changes: { body: 'x'.repeat(100) } },
    { id: 6, occurred_at: at, actor_id: 'MGR001', action: 'INSERT', entity: 'messages', entity_id: '8', changes: { body: 'Short note' } },
    { id: 7, occurred_at: at, actor_id: 'EMP001', action: 'INSERT', entity: 'time_entries', entity_id: '9', changes: { hours: '8.00', work_date: '2026-10-12' } },
    { id: 8, occurred_at: at, actor_id: 'MGR001', action: 'DELETE', entity: 'project_members', entity_id: '3', changes: { user_id: 'EMP001' } },
    { id: 9, occurred_at: at, actor_id: null, action: 'PURGE', entity: 'widgets', entity_id: null, changes: { size: 3, meta: { a: 1 }, seen_at: at, gone: null } },
    { id: 10, occurred_at: at, actor_id: 'ADMIN1', action: 'UPDATE', entity: 'projects', entity_id: '1', changes: {
      status: { old: 'planning', new: 'active' }, archived_at: { old: null, new: at }, note: 'plain', tags: ['a'], cleared: null,
      updated_at: { old: at, new: at },
    } },
    { id: 11, occurred_at: at, actor_id: 'ADMIN1', action: 'LOGIN_FAILED', entity: 'users', entity_id: 'ADMIN1', changes: null },
  ]

  it('summarizes each kind of change', async () => {
    respond('GET /api/audit', entries)
    renderAt('/audit')
    const row = async (text) => within((await screen.findByText(text)).closest('tr'))

    expect((await row('New project')).getByText('Created')).toBeTruthy()
    expect((await row('Old milestone')).getByText('Deleted')).toBeTruthy()
    expect((await row('Old milestone')).getByText('Milestones #10')).toBeTruthy()
    expect(await row('New Person (manager)')).toBeTruthy()
    expect(await row('Solo Member')).toBeTruthy()
    expect(await row(`${'x'.repeat(80)}…`)).toBeTruthy()
    expect(await row('Short note')).toBeTruthy()
    expect((await row('8.00 h on 2026-10-12')).getByText('Hours #9')).toBeTruthy()
    expect((await row('User EMP001')).getByText('Project members #3')).toBeTruthy()

    // Unknown actions and entities show as-is; records with nothing recognizable list every field
    const system = await row('System')
    expect(system.getByText('PURGE')).toBeTruthy()
    expect(system.getByText('widgets')).toBeTruthy()
    expect(system.getByText('3')).toBeTruthy()
    expect(system.getByText('{"a":1}')).toBeTruthy()
    expect(system.getByText(/Oct 1, 2026/, { selector: 'dd' })).toBeTruthy()
    expect(system.getByText('—', { selector: 'dd' })).toBeTruthy()

    const update = await row('planning → active')
    expect(update.getByText('Changed')).toBeTruthy()
    expect(update.getByText(/^— → Oct 1, 2026/)).toBeTruthy()
    expect(update.getByText('plain')).toBeTruthy()
    expect(update.getByText('["a"]')).toBeTruthy()
    expect(update.getByText('—', { selector: 'dd' })).toBeTruthy()
    expect(update.queryByText('updated_at')).toBeNull()

    expect((await row('Failed login')).getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Mia Manager').length).toBeGreaterThan(0)
  })

  it('shows every field of a created record on request, minus timestamps', async () => {
    respond('GET /api/audit', [entries[0]])
    renderAt('/audit')
    fireEvent.click(await screen.findByRole('button', { name: 'Show all fields' }))
    expect(screen.queryByRole('button', { name: 'Show all fields' })).toBeNull()
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('New project')).toBeTruthy()
    expect(screen.getByText('budget')).toBeTruthy()
    expect(screen.queryByText('created_at')).toBeNull()
  })

  it('filters by record type, ID, person, date and page size', async () => {
    renderAt('/audit')
    expect(await screen.findByText('200000 → 250000')).toBeTruthy()
    expect(lastCall('GET /api/audit').query).toEqual({ limit: '100' })

    await choose(document.body, 'What changed', 'Projects')
    await waitFor(() => expect(called('GET /api/audit', { entity: 'projects' })).toBe(true))
    fireEvent.change(screen.getByLabelText('Record ID'), { target: { value: ' 1 ' } })
    await waitFor(() => expect(called('GET /api/audit', { entity: 'projects', entity_id: '1' })).toBe(true))
    await pickUser(document.body, 'Done by', 'Ada Admin')
    await waitFor(() => expect(called('GET /api/audit', { actor_id: 'ADMIN1' })).toBe(true))
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(called('GET /api/audit', { since: new Date('2026-10-01T00:00:00').toISOString() })).toBe(true))
    await choose(document.body, 'Show', '250')
    await waitFor(() => expect(lastCall('GET /api/audit').query).toMatchObject({ limit: '250', entity: 'projects', entity_id: '1', actor_id: 'ADMIN1' }))
  })

  it('shows an empty state when nothing matches', async () => {
    respond('GET /api/audit', [])
    renderAt('/audit')
    expect(await screen.findByText('Nothing matches these filters')).toBeTruthy()
  })

  it('shows load errors with a retry', async () => {
    respond('GET /api/audit', { detail: 'Audit log unavailable' }, 503)
    renderAt('/audit')
    expect(await screen.findByText('Audit log unavailable')).toBeTruthy()
    respond('GET /api/audit', [])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Nothing matches these filters')).toBeTruthy()
  })
})

describe('profile and passwords', { timeout: 15000 }, () => {
  it('saves your name and email and reloads your details', async () => {
    respond('PATCH /api/auth/me', { ...admin, first_name: 'Augusta' })
    renderAt('/profile')
    expect(await screen.findByText('ADMIN1')).toBeTruthy()
    expect(screen.getByText('Salary')).toBeTruthy()  // admins have a salary field, even if empty
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Augusta' } })
    fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'King' } })
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'augusta@example.com' } })
    respond('GET /api/auth/me', { ...admin, first_name: 'Augusta', last_name: 'King' })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await screen.findByText('Profile saved')).toBeTruthy()
    expect(bodyOf('PATCH /api/auth/me')).toEqual({ first_name: 'Augusta', last_name: 'King', email: 'augusta@example.com' })
    expect(calls.filter((c) => c.route === 'GET /api/auth/me')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Save details' }).disabled).toBe(false)
  })

  it('shows why saving your profile failed', async () => {
    respond('PATCH /api/auth/me', { detail: 'Email already in use' }, 409)
    renderAt('/profile')
    fireEvent.click(await screen.findByRole('button', { name: 'Save details' }))
    expect(await screen.findByText('Email already in use')).toBeTruthy()
  })

  it('shows a manager\'s salary but not to employees without one', async () => {
    const { unmount } = renderAs(manager, '/profile')
    expect(await screen.findByText('$150,000')).toBeTruthy()
    expect(screen.getByText('Engineering Manager')).toBeTruthy()
    unmount()

    const withoutSalary = { ...employee }
    delete withoutSalary.salary
    renderAs(withoutSalary, '/profile')
    expect(await screen.findByText('Employee')).toBeTruthy()
    expect(screen.queryByText('Salary')).toBeNull()
  })

  it('changes your password and clears the form', async () => {
    respond('POST /api/auth/change-password', null, 204)
    renderAt('/profile')
    fireEvent.change(await screen.findByLabelText(/Current password/), { target: { value: 'old password' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new password' } })
    fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: 'new password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Password changed')).toBeTruthy()
    expect(bodyOf('POST /api/auth/change-password')).toEqual({ current_password: 'old password', new_password: 'new password' })
    expect(screen.getByLabelText(/Current password/).value).toBe('')
    expect(screen.getByLabelText(/^New password/).value).toBe('')
  })

  it('validates the new password before sending it', async () => {
    render(<PasswordForm />)
    const next = screen.getByLabelText(/^New password/)
    const confirm = screen.getByLabelText(/Confirm new password/)
    const submit = screen.getByRole('button', { name: 'Change password' })
    expect(screen.getByText('At least 8 characters')).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: 'old password' } })
    fireEvent.change(next, { target: { value: 'short' } })
    expect(screen.getByText('Use at least 8 characters')).toBeTruthy()
    expect(submit.disabled).toBe(true)
    // Submitting anyway (e.g. pressing Enter) sends nothing
    fireEvent.submit(submit.closest('form'))

    fireEvent.change(next, { target: { value: 'long enough' } })
    fireEvent.change(confirm, { target: { value: 'long enougg' } })
    expect(screen.getByText('The passwords don\'t match')).toBeTruthy()
    expect(submit.disabled).toBe(true)
    fireEvent.submit(submit.closest('form'))
    expect(calls).toEqual([])

    fireEvent.change(confirm, { target: { value: 'long enough' } })
    expect(screen.queryByText('The passwords don\'t match')).toBeNull()
    expect(submit.disabled).toBe(false)
  })

  it('shows "Saving…" while busy and works without an onChanged callback', async () => {
    const release = holdRoute('POST /api/auth/change-password')
    respond('POST /api/auth/change-password', null, 204)
    render(<PasswordForm submitLabel="Set it" currentLabel="Old one" />)
    fireEvent.change(screen.getByLabelText(/Old one/), { target: { value: 'old password' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new password' } })
    fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: 'new password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set it' }))
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeTruthy()
    release()
    expect(await screen.findByRole('button', { name: 'Set it' })).toBeTruthy()
    expect(screen.getByLabelText(/Old one/).value).toBe('')
  })

  it('shows a wrong current password', async () => {
    respond('POST /api/auth/change-password', { detail: 'Current password is incorrect' }, 400)
    render(<PasswordForm onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Current password/), { target: { value: 'wrong' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'new password' } })
    fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: 'new password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Current password is incorrect')).toBeTruthy()
    // Fields are kept so it can be corrected
    expect(screen.getByLabelText(/^New password/).value).toBe('new password')
  })

  it('a temporary password must be replaced before anything else', async () => {
    respond('GET /api/auth/me', { ...admin, must_change_password: true })
    respond('POST /api/auth/change-password', null, 204)
    renderAt('/users')
    expect(await screen.findByText(/Welcome, Ada. You logged in with a temporary password/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Temporary password/), { target: { value: 'temp-pass' } })
    fireEvent.change(screen.getByLabelText(/^New password/), { target: { value: 'permanent pass' } })
    fireEvent.change(screen.getByLabelText(/Confirm new password/), { target: { value: 'permanent pass' } })
    respond('GET /api/auth/me', admin)
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(await screen.findByText('Password saved')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Welcome back, Ada' })).toBeTruthy()
    expect(bodyOf('POST /api/auth/change-password')).toEqual({ current_password: 'temp-pass', new_password: 'permanent pass' })
  })

  it('people with a temporary password can log out instead', async () => {
    respond('GET /api/auth/me', { ...admin, must_change_password: true })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(window.location.pathname).toBe('/login')
    expect(localStorage.getItem('project-tracker.token')).toBeNull()
  })
})

describe('layout account menu', { timeout: 15000 }, () => {
  it('shows who is logged in and opens the profile', async () => {
    renderAs(manager, '/')
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Mia Manager')).toBeTruthy()
    expect(within(menu).getByText('MGR001 · Manager')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Your profile' }))
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeTruthy()
    expect(window.location.pathname).toBe('/profile')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('closes with Escape and logs out', async () => {
    renderAt('/')
    expect(screen.getByText('Restoring your session…')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }))
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }))
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(localStorage.getItem('project-tracker.token')).toBeNull()
    // A deliberate logout shows no "session ended" notice
    expect(screen.queryByText(/Your session has ended/)).toBeNull()
  })
})

describe('auth context', { timeout: 15000 }, () => {
  it('a stored session that can\'t be restored goes back to login without a notice', async () => {
    respond('GET /api/auth/me', {}, 500)
    renderAt('/projects')
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
    expect(localStorage.getItem('project-tracker.token')).toBeNull()
    expect(screen.queryByText(/Your session has ended/)).toBeNull()
  })

  it('a request rejected as logged out ends the session with a notice', async () => {
    respond('GET /api/teams', { detail: 'Not logged in or session expired' }, 401)
    renderAt('/teams')
    expect(await screen.findByText('Your session has ended. Log in again to continue.')).toBeTruthy()
    expect(window.location.pathname).toBe('/login')
  })

  it('still logs in when browser storage is blocked', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      renderAt('/', { loggedIn: false })
      fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'ada@example.com' } })
      fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'a long password' } })
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
      expect(await screen.findByText('Welcome back, Ada')).toBeTruthy()
      expect(setItem).toHaveBeenCalledWith('project-tracker.token', 'test-token')
      // Logging out with blocked storage doesn't throw either
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
      fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }))
      expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
      vi.restoreAllMocks()
    }
  })
})

describe('api client', () => {
  afterEach(() => {
    setAccessToken(null)
    setUnauthorizedHandler(() => {})
  })

  it('builds the URL and skips empty query values', async () => {
    respond('GET /api/users', [])
    await request('users', '', { query: { q: 'ada', role: '', manager_id: null, team: undefined, include_inactive: false, limit: 0 } })
    expect(lastCall('GET /api/users').query).toEqual({ q: 'ada', include_inactive: 'false', limit: '0' })
    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(String(url)).toBe('http://localhost:3001/api/users?q=ada&include_inactive=false&limit=0')
    expect(options).toEqual({ method: 'GET', headers: { Accept: 'application/json' }, body: undefined })
  })

  it('sends JSON bodies and the bearer token', async () => {
    setAccessToken('abc')
    respond('POST /api/teams', { id: 1 })
    expect(await request('teams', '', { method: 'POST', body: { name: 'A' } })).toEqual({ id: 1 })
    const [, options] = globalThis.fetch.mock.calls[0]
    expect(options.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer abc', 'Content-Type': 'application/json' })
    expect(options.body).toBe('{"name":"A"}')
  })

  it('sends forms URL-encoded', async () => {
    await request('auth', '/token', { method: 'POST', form: { username: 'a@b.c', password: 'p w' } })
    const [, options] = globalThis.fetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(String(options.body)).toBe('username=a%40b.c&password=p+w')
  })

  it('returns null for empty responses and text for non-JSON ones', async () => {
    respond('DELETE /api/teams/1', null, 204)
    expect(await request('teams', '/1', { method: 'DELETE' })).toBeNull()
    globalThis.fetch.mockResolvedValueOnce(new Response('plain words', { status: 200 }))
    expect(await request('teams')).toBe('plain words')
  })

  it.each([
    ['a string detail', 400, { detail: 'Nope' }, 'Nope'],
    ['validation errors', 422, { detail: [
      { loc: ['body', 'name'], msg: 'Field required' },
      { loc: ['query', 'limit'], msg: 'Input should be a valid integer' },
      { loc: ['body', 'members', 0, 'user_id'], msg: 'Bad id' },
      { loc: ['body'], msg: 'Invalid JSON' },
      { msg: 'Something else' },
    ] }, 'name: Field required; limit: Input should be a valid integer; members.0.user_id: Bad id; Invalid JSON; Something else'],
    ['a server error without detail', 502, {}, 'Something went wrong on the server. Try again shortly.'],
    ['a client error without detail', 404, null, 'Request failed (404)'],
  ])('turns %s into a message', async (_, status, body, message) => {
    respond('GET /api/teams', body, status)
    const error = await request('teams').catch((err) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(status)
    expect(error.message).toBe(message)
    expect(error.detail).toEqual(body?.detail)
  })

  it('reports a non-JSON error body by status', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 500 }))
    await expect(request('teams')).rejects.toMatchObject({ status: 500, message: 'Something went wrong on the server. Try again shortly.', detail: undefined })
  })

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(request('teams')).rejects.toMatchObject({ status: 0, message: 'Can\'t reach the server. Check your connection and try again.' })
  })

  it('calls the unauthorized handler only for logged-in 401s', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    respond('POST /api/auth/token', { detail: 'Incorrect email or password' }, 401)
    await expect(request('auth', '/token', { method: 'POST', form: {} })).rejects.toMatchObject({ status: 401 })
    expect(handler).not.toHaveBeenCalled()

    setAccessToken('expired')
    await expect(request('auth', '/token', { method: 'POST', form: {} })).rejects.toMatchObject({ status: 401 })
    expect(handler).toHaveBeenCalledTimes(1)
    respond('GET /api/teams', { detail: 'Forbidden' }, 403)
    await expect(request('teams')).rejects.toMatchObject({ status: 403 })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('uses same-origin URLs without VITE_API_URL, and ignores 401s before a handler is set', async () => {
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()
    try {
      const fresh = await import('../api/client.js')
      fresh.setAccessToken('t')
      respond('GET /api/teams', { detail: 'expired' }, 401)
      await expect(fresh.request('teams')).rejects.toMatchObject({ status: 401, message: 'expired' })
      expect(String(globalThis.fetch.mock.calls[0][0])).toBe(`${window.location.origin}/api/teams`)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('api endpoints', () => {
  const B = 'http://localhost:3001/api'
  const cases = [
    ['auth.login', () => api.auth.login('a@b.c', 'pw'), 'POST', '/auth/token', 'username=a%40b.c&password=pw'],
    ['auth.me', () => api.auth.me(), 'GET', '/auth/me'],
    ['auth.updateMe', () => api.auth.updateMe({ first_name: 'A' }), 'PATCH', '/auth/me', { first_name: 'A' }],
    ['auth.changePassword', () => api.auth.changePassword('old', 'new'), 'POST', '/auth/change-password', { current_password: 'old', new_password: 'new' }],
    ['users.list', () => api.users.list({ role: 'manager' }), 'GET', '/users?role=manager'],
    ['users.get', () => api.users.get('EMP001'), 'GET', '/users/EMP001'],
    ['users.create', () => api.users.create({ email: 'x' }), 'POST', '/users', { email: 'x' }],
    ['users.update', () => api.users.update('EMP001', { job_title: 'X' }), 'PATCH', '/users/EMP001', { job_title: 'X' }],
    ['users.resetPassword', () => api.users.resetPassword('EMP001'), 'POST', '/users/EMP001/reset-password'],
    ['projects.list', () => api.projects.list({ include_archived: true }), 'GET', '/projects?include_archived=true'],
    ['projects.get', () => api.projects.get(1), 'GET', '/projects/1'],
    ['projects.create', () => api.projects.create({ name: 'P' }), 'POST', '/projects', { name: 'P' }],
    ['projects.update', () => api.projects.update(1, { name: 'Q' }), 'PATCH', '/projects/1', { name: 'Q' }],
    ['projects.remove (default reason)', () => api.projects.remove(1), 'DELETE', '/projects/1', { reason: 'deleted' }],
    ['projects.remove (completed)', () => api.projects.remove(1, 'completed'), 'DELETE', '/projects/1', { reason: 'completed' }],
    ['projects.unarchive', () => api.projects.unarchive(2), 'POST', '/projects/2/unarchive'],
    ['projects.budgetEstimate', () => api.projects.budgetEstimate(1), 'GET', '/projects/1/budget-estimate'],
    ['projects.deliverables', () => api.projects.deliverables(1), 'GET', '/projects/1/deliverables'],
    ['projects.addTeam', () => api.projects.addTeam(1, 5, '20'), 'POST', '/projects/1/teams', { team_id: 5, hours_per_week: '20' }],
    ['projects.members.list', () => api.projects.members.list(1), 'GET', '/projects/1/members'],
    ['projects.members.add', () => api.projects.members.add(1, 'EMP001', '10'), 'POST', '/projects/1/members', { user_id: 'EMP001', hours_per_week: '10' }],
    ['projects.members.update', () => api.projects.members.update(1, 'EMP001', '15'), 'PATCH', '/projects/1/members/EMP001', { hours_per_week: '15' }],
    ['projects.members.remove', () => api.projects.members.remove(1, 'EMP001'), 'DELETE', '/projects/1/members/EMP001'],
    ['projects.milestones.list', () => api.projects.milestones.list(1), 'GET', '/projects/1/milestones'],
    ['projects.milestones.create', () => api.projects.milestones.create(1, { title: 'M' }), 'POST', '/projects/1/milestones', { title: 'M' }],
    ['projects.milestones.createMany', () => api.projects.milestones.createMany(1, [{ title: 'M' }]), 'POST', '/projects/1/milestones/batch', { milestones: [{ title: 'M' }] }],
    ['milestones.list', () => api.milestones.list({ start: '2026-10-01', end: '2026-10-31' }), 'GET', '/milestones?start=2026-10-01&end=2026-10-31'],
    ['milestones.active', () => api.milestones.active(), 'GET', '/milestones/active'],
    ['milestones.get', () => api.milestones.get(10), 'GET', '/milestones/10'],
    ['milestones.templates.list', () => api.milestones.templates.list({ manager_id: 'MGR001' }), 'GET', '/milestones/templates?manager_id=MGR001'],
    ['milestones.templates.get', () => api.milestones.templates.get(7), 'GET', '/milestones/templates/7'],
    ['milestones.templates.create', () => api.milestones.templates.create({ name: 'T' }), 'POST', '/milestones/templates', { name: 'T' }],
    ['milestones.templates.update', () => api.milestones.templates.update(7, { name: 'U' }), 'PATCH', '/milestones/templates/7', { name: 'U' }],
    ['milestones.templates.remove', () => api.milestones.templates.remove(7), 'DELETE', '/milestones/templates/7'],
    ['milestones.update', () => api.milestones.update(10, { status: 'completed' }), 'PATCH', '/milestones/10', { status: 'completed' }],
    ['milestones.remove', () => api.milestones.remove(10), 'DELETE', '/milestones/10'],
    ['milestones.tasks.list', () => api.milestones.tasks.list(10), 'GET', '/milestones/10/tasks'],
    ['milestones.tasks.create', () => api.milestones.tasks.create(10, 'T'), 'POST', '/milestones/10/tasks', { title: 'T' }],
    ['milestones.tasks.update', () => api.milestones.tasks.update(100, { is_done: true }), 'PATCH', '/milestones/tasks/100', { is_done: true }],
    ['milestones.tasks.remove', () => api.milestones.tasks.remove(100), 'DELETE', '/milestones/tasks/100'],
    ['milestones.assignments.list', () => api.milestones.assignments.list(10), 'GET', '/milestones/10/assignments'],
    ['milestones.assignments.add', () => api.milestones.assignments.add(10, 'EMP001'), 'POST', '/milestones/10/assignments', { user_id: 'EMP001' }],
    ['milestones.assignments.setFinished', () => api.milestones.assignments.setFinished(10, 'EMP001', true), 'PATCH', '/milestones/10/assignments/EMP001', { finished: true }],
    ['milestones.assignments.remove', () => api.milestones.assignments.remove(10, 'EMP001'), 'DELETE', '/milestones/10/assignments/EMP001'],
    ['timeEntries.list', () => api.timeEntries.list({ user_id: 'EMP001' }), 'GET', '/time-entries?user_id=EMP001'],
    ['timeEntries.create', () => api.timeEntries.create({ hours: '4' }), 'POST', '/time-entries', { hours: '4' }],
    ['timeEntries.update', () => api.timeEntries.update(1, { hours: '5' }), 'PATCH', '/time-entries/1', { hours: '5' }],
    ['timeEntries.remove', () => api.timeEntries.remove(1), 'DELETE', '/time-entries/1'],
    ['messages.list', () => api.messages.list({ project_id: 1 }), 'GET', '/messages?project_id=1'],
    ['messages.post (project)', () => api.messages.post('Hi', 1), 'POST', '/messages', { body: 'Hi', project_id: 1 }],
    ['messages.post (everyone)', () => api.messages.post('Hello all'), 'POST', '/messages', { body: 'Hello all', project_id: null }],
    ['messages.remove', () => api.messages.remove(3), 'DELETE', '/messages/3'],
    ['teams.list', () => api.teams.list({ q: 'rack' }), 'GET', '/teams?q=rack'],
    ['teams.get', () => api.teams.get(5), 'GET', '/teams/5'],
    ['teams.create', () => api.teams.create({ name: 'T' }), 'POST', '/teams', { name: 'T' }],
    ['teams.update', () => api.teams.update(5, { name: 'U' }), 'PATCH', '/teams/5', { name: 'U' }],
    ['teams.remove', () => api.teams.remove(5), 'DELETE', '/teams/5'],
    ['teams.members.list', () => api.teams.members.list(5), 'GET', '/teams/5/members'],
    ['teams.members.add', () => api.teams.members.add(5, 'EMP001'), 'POST', '/teams/5/members', { user_id: 'EMP001' }],
    ['teams.members.remove', () => api.teams.members.remove(5, 'EMP001'), 'DELETE', '/teams/5/members/EMP001'],
    ['reports.home', () => api.reports.home(), 'GET', '/reports/home'],
    ['reports.projects (default)', () => api.reports.projects(), 'GET', '/reports/projects?include_archived=false'],
    ['reports.projects (archived)', () => api.reports.projects(true), 'GET', '/reports/projects?include_archived=true'],
    ['reports.atRisk', () => api.reports.atRisk(), 'GET', '/reports/at-risk'],
    ['reports.budget', () => api.reports.budget(), 'GET', '/reports/budget'],
    ['reports.allocation', () => api.reports.allocation(5), 'GET', '/reports/allocation?team_id=5'],
    ['reports.overAllocated', () => api.reports.overAllocated(), 'GET', '/reports/over-allocated'],
    ['audit.list', () => api.audit.list({ entity: 'users' }), 'GET', '/audit?entity=users'],
  ]

  it.each(cases)('%s', async (_, call, method, path, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    expect(await call()).toBeNull()
    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(String(url)).toBe(`${B}${path}`)
    expect(options.method).toBe(method)
    if (body === undefined) expect(options.body).toBeUndefined()
    else if (typeof body === 'string') expect(String(options.body)).toBe(body)
    else expect(JSON.parse(options.body)).toEqual(body)
  })
})

describe('notifications', () => {
  function Buttons() {
    const notify = useNotify()
    return (
      <>
        <button onClick={() => notify('Saved')}>success</button>
        <button onClick={() => notify('Careful', 'warning')}>warning</button>
      </>
    )
  }
  afterEach(() => vi.useRealTimers())

  it('a success hides itself after 4 seconds but not on a click elsewhere', () => {
    vi.useFakeTimers()
    render(<NotificationProvider><Buttons /></NotificationProvider>)
    fireEvent.click(screen.getByText('success'))
    expect(screen.getByRole('alert').textContent).toBe('Saved')
    act(() => vi.advanceTimersByTime(100))  // the click-away listener activates after mounting
    fireEvent.click(document.body)
    expect(screen.getByRole('alert')).toBeTruthy()
    act(() => vi.advanceTimersByTime(3800))
    expect(screen.getByRole('alert')).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    act(() => vi.advanceTimersByTime(1000))  // exit transition
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a warning stays for 8 seconds and can be closed', () => {
    vi.useFakeTimers()
    render(<NotificationProvider><Buttons /></NotificationProvider>)
    fireEvent.click(screen.getByText('warning'))
    expect(screen.getByRole('alert').textContent).toBe('Careful')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('notify is a harmless no-op outside the provider', () => {
    const { result } = renderHook(() => useNotify())
    expect(result.current('Nobody listening')).toBeUndefined()
  })
})

describe('dialogs', () => {
  it('a confirm dialog opens without the previous attempt\'s error', async () => {
    const props = { title: 'Delete team?', onClose: () => {}, onConfirm: vi.fn().mockRejectedValue(new Error('Team is in use')) }
    const { rerender } = render(<ConfirmDialog open {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Team is in use')).toBeTruthy()
    rerender(<ConfirmDialog open={false} {...props} />)
    rerender(<ConfirmDialog open {...props} />)
    expect(screen.queryByText('Team is in use')).toBeNull()
  })

  it('a form dialog stays open while saving and ignores Escape until done', async () => {
    const save = deferred()
    const onClose = vi.fn()
    render(<FormDialog open title="Edit thing" onSubmit={() => save.promise} onClose={onClose}><input aria-label="Thing" /></FormDialog>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true))
    expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => save.resolve())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a form dialog shows a failure and clears it on cancel', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <FormDialog open title="Edit thing" submitLabel="Go" disabled={false} onSubmit={() => Promise.reject(new Error('Nope'))} onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText('Nope')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Nope')).toBeNull()
    rerender(<FormDialog open title="Edit thing" submitLabel="Go" disabled onSubmit={vi.fn()} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Go' }).disabled).toBe(true)
  })

  it('a confirm dialog can\'t be dismissed while busy', async () => {
    const work = deferred()
    const onClose = vi.fn()
    render(<ConfirmDialog open title="Sure?" onConfirm={() => work.promise} onClose={onClose}><p>Extra detail</p></ConfirmDialog>)
    expect(screen.getByText('Extra detail')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' }).disabled).toBe(true))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => work.reject(new ApiError(409, 'In use')))
    expect(screen.getByText('In use')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('shared components', () => {
  it('status chips cover every state', async () => {
    render(
      <>
        <ProjectStatusChip project={{ status: 'active', archived: false }} />
        <ProjectStatusChip project={{ status: 'completed', archived: true, archive_reason: 'completed' }} />
        <ProjectStatusChip project={{ status: 'planning', archived: true, archive_reason: 'deleted' }} />
        <MilestoneStatusChip status="not_started" />
        <RiskChip risk={{ level: 'on_track', reasons: [] }} />
        <RiskChip risk={{ level: 'off_track' }} />
        <RiskChip risk={{ level: 'at_risk', reasons: ['Over budget'] }} />
        <RoleChip role="admin" />
        <RoleChip role="employee" />
      </>,
    )
    for (const label of ['Active', 'Completed', 'Archived', 'Planning', 'Archived (deleted)', 'Not started', 'On track', 'Off track', 'At risk', 'Admin', 'Employee']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // Risks with reasons explain them on hover
    fireEvent.mouseOver(screen.getByText('At risk'))
    expect((await screen.findByRole('tooltip')).textContent).toBe('Over budget')
  })

  it('hours chips show an optional label and the over-40 warning', () => {
    render(<><HoursChip hours="45.0" overLimit label="Planned" /><HoursChip hours="20.50" /></>)
    expect(screen.getByText('Planned 45 h/week · overtime')).toBeTruthy()
    expect(screen.getByText('20.5 h/week')).toBeTruthy()
  })

  it('small building blocks fall back sensibly', () => {
    render(
      <>
        <PageHeader title="Bare page" />
        <Field label="Missing">{null}</Field>
        <Field label="Present">value</Field>
        <ErrorAlert error="Plain string failure" />
        <ErrorAlert error={null} />
        <Loading />
        <Loading label="Fetching…" />
        <EmptyState title="Nothing here" />
      </>,
    )
    expect(screen.getByRole('heading', { name: 'Bare page' })).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('value')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Plain string failure')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.getByText('Fetching…')).toBeTruthy()
    expect(screen.getByText('Nothing here')).toBeTruthy()
  })
})

describe('directory', () => {
  const wrapper = ({ children }) => <DirectoryProvider>{children}</DirectoryProvider>

  it('names users and projects by ID with fallbacks, and refreshes', async () => {
    const { result } = renderHook(() => useDirectory(), { wrapper })
    await waitFor(() => expect(result.current.users).toHaveLength(3))
    expect(result.current.projects).toHaveLength(2)
    expect(result.current.user('EMP001').email).toBe('grace@example.com')
    expect(result.current.userName('EMP001')).toBe('Grace Hopper')
    expect(result.current.userName('NOBODY')).toBe('NOBODY')
    expect(result.current.userName(null)).toBe('—')
    expect(result.current.projectName(1)).toBe('Decommission 1000 servers')
    expect(result.current.projectName(99)).toBe('Project 99')
    expect(result.current.projectName(null)).toBe('Everyone')
    expect(called('GET /api/users', { include_inactive: 'true' })).toBe(true)

    respond('GET /api/users', [admin])
    await act(() => result.current.refresh())
    expect(result.current.users).toEqual([admin])
  })

  it('a failed refresh keeps the names already loaded', async () => {
    const { result } = renderHook(() => useDirectory(), { wrapper })
    await waitFor(() => expect(result.current.users).toHaveLength(3))
    respond('GET /api/users', { detail: 'Database unavailable' }, 503)
    await act(() => result.current.refresh())  // resolves instead of rejecting unhandled
    expect(result.current.userName('EMP001')).toBe('Grace Hopper')
  })

  it('stays empty when loading fails', async () => {
    respond('GET /api/users', {}, 500)
    const { result } = renderHook(() => useDirectory(), { wrapper })
    await waitFor(() => expect(calls.some((c) => c.route === 'GET /api/projects')).toBe(true))
    expect(result.current.users).toEqual([])
    expect(result.current.userName('EMP001')).toBe('EMP001')
  })

  it('ignores a load that finishes after unmounting', async () => {
    const release = holdRoute('GET /api/users')
    const { result, unmount } = renderHook(() => useDirectory(), { wrapper })
    unmount()
    release()
    await waitFor(() => expect(calls.some((c) => c.route === 'GET /api/projects')).toBe(true))
    await act(async () => {})
    expect(result.current.users).toEqual([])
  })
})

describe('hooks', () => {
  it('useApiData loads, keeps data while reloading, and keeps it on error', async () => {
    let next = deferred()
    const load = vi.fn(() => next.promise)
    const { result } = renderHook(() => useApiData(load, []))
    expect(result.current).toMatchObject({ data: null, error: null, loading: true })
    await act(async () => next.resolve([1]))
    expect(result.current).toMatchObject({ data: [1], error: null, loading: false })

    next = deferred()
    act(() => result.current.reload())
    expect(result.current).toMatchObject({ data: [1], loading: true })
    const failure = new Error('down')
    await act(async () => next.reject(failure))
    expect(result.current).toMatchObject({ data: [1], error: failure, loading: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('useApiData reloads when its dependencies change and ignores stale results', async () => {
    const pending = { a: deferred(), b: deferred() }
    const { result, rerender } = renderHook(({ key }) => useApiData(() => pending[key].promise, [key]), { initialProps: { key: 'a' } })
    rerender({ key: 'b' })
    await act(async () => pending.b.resolve('B'))
    // "a" answers late, but it was superseded
    await act(async () => pending.a.resolve('A'))
    expect(result.current.data).toBe('B')
    const stale = deferred()
    const { result: second, unmount } = renderHook(() => useApiData(() => stale.promise))
    unmount()
    await act(async () => stale.reject(new Error('late')))
    expect(second.current.error).toBeNull()
  })

  it('useDebounced waits for the value to settle', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(({ value, delay }) => useDebounced(value, delay), { initialProps: { value: 'a' } })
      rerender({ value: 'ab' })
      act(() => vi.advanceTimersByTime(299))
      expect(result.current).toBe('a')
      rerender({ value: 'abc' })
      act(() => vi.advanceTimersByTime(299))
      expect(result.current).toBe('a')
      act(() => vi.advanceTimersByTime(1))
      expect(result.current).toBe('abc')
      rerender({ value: 'x', delay: 50 })
      act(() => vi.advanceTimersByTime(50))
      expect(result.current).toBe('x')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('format helpers', () => {
  it.each([
    [money, '250000.00', '$250,000'],
    [money, 0, '$0'],
    [money, null, '—'],
    [money, undefined, '—'],
    [hours, '7.25', '7.25 h'],
    [hours, 0, '0 h'],
    [hours, null, '—'],
    [hours, undefined, '—'],
    [percent, '12.34', '12.3%'],
    [percent, null, '—'],
    [percent, undefined, '—'],
    [day, '2026-10-13', 'Oct 13, 2026'],
    [day, '2026-01-01T23:30:00Z', 'Jan 1, 2026'],
    [day, null, '—'],
    [day, '', '—'],
    [dateTime, null, '—'],
    [dateTime, undefined, '—'],
    [fullName, { first_name: 'Ada', last_name: 'Lovelace' }, 'Ada Lovelace'],
    [fullName, null, ''],
    [fullName, undefined, ''],
  ])('%o(%o) is %o', (format, value, expected) => {
    expect(format(value)).toBe(expected)
  })

  it('dateTime shows the local date and time', () => {
    const local = new Date(2026, 9, 13, 14, 5)
    // Newer ICU versions put a narrow no-break space before PM
    expect(dateTime(local.toISOString())).toMatch(/^Oct 13, 2026, 2:05\sPM$/)
  })

  it('todayIso is the local calendar date', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 11, 31, 23, 59))
      expect(todayIso()).toBe('2026-12-31')
      vi.setSystemTime(new Date(2027, 0, 1, 0, 1))
      expect(todayIso()).toBe('2027-01-01')
    } finally {
      vi.useRealTimers()
    }
  })

  it('has a label for every status', () => {
    expect(ROLE_LABELS).toEqual({ admin: 'Admin', manager: 'Manager', employee: 'Employee' })
    expect(Object.keys(PROJECT_STATUS_LABELS)).toEqual(['planning', 'active', 'completed'])
    expect(Object.keys(MILESTONE_STATUS_LABELS)).toEqual(['not_started', 'in_progress', 'completed'])
    expect(Object.keys(RISK_LABELS)).toEqual(['on_track', 'at_risk', 'off_track'])
  })
})

describe('milestone helpers', () => {
  it('milestoneState marks unfinished milestones past their end date overdue', () => {
    expect(milestoneState({ status: 'completed', end_date: '2026-01-01' }, '2026-10-13')).toBe('completed')
    expect(milestoneState({ status: 'in_progress', end_date: '2026-10-12' }, '2026-10-13')).toBe('overdue')
    expect(milestoneState({ status: 'not_started', end_date: '2026-10-13' }, '2026-10-13')).toBe('not_started')
    expect(milestoneState({ status: 'in_progress', end_date: '2026-10-14' }, '2026-10-13')).toBe('in_progress')
    // Defaults to today
    expect(milestoneState({ status: 'in_progress', end_date: '1999-01-01' })).toBe('overdue')
    expect(milestoneState({ status: 'in_progress', end_date: '2999-01-01' })).toBe('in_progress')
    expect(Object.keys(MILESTONE_STATES)).toEqual(['completed', 'in_progress', 'not_started', 'overdue'])
  })

  it('day arithmetic works in local calendar days', () => {
    const d = parseDay('2026-03-08T12:00:00Z')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 8, 0])
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(isoDay(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02')
    expect(isoDay(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28')
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)  // across a daylight-saving change
    expect(daysBetween('2026-10-13', '2026-10-01')).toBe(-12)
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(0)
  })
})

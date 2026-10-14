import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { admin, calls, respond } from './fakeApi'

function renderAt(path) {
  localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

const manager = { ...admin, id: 'MGR001', role: 'manager', first_name: 'Mia', last_name: 'Manager', salary: '150000.00' }
const asManager = (path) => {
  respond('GET /api/auth/me', manager)
  return renderAt(path)
}
const template = {
  id: 7, name: 'Software release', description: 'Our usual plan', manager_id: 'MGR001', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
  milestones: [
    { id: 1, sequence: 1, title: 'Plan', description: null, duration_days: 10 },
    { id: 2, sequence: 2, title: 'Build', description: 'Write the code', duration_days: null },
  ],
}
const lastCall = (route) => calls.findLast((c) => c.route === route)
const bodyOf = (route) => JSON.parse(lastCall(route).body)
const titleField = (dialog, n) => within(dialog).getAllByLabelText(/Milestone title/)[n]

async function choose(scope, label, option) {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: label }))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('milestone templates page', () => {
  it('admins see every manager\'s templates, with their milestones in order, and can filter', async () => {
    renderAt('/milestone-templates')
    expect(await screen.findByText('Software release')).toBeTruthy()
    expect(screen.getByText('Lists of milestones each manager plans often, added to their projects in one step.')).toBeTruthy()
    const row = screen.getByText('Software release').closest('tr')
    expect(within(row).getByText('Mia Manager')).toBeTruthy()
    expect(within(row).getByText('Our usual plan')).toBeTruthy()
    expect(within(row).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Plan · usually 10 days', 'Build'])

    fireEvent.change(screen.getByPlaceholderText('Search by name'), { target: { value: ' release ' } })
    await waitFor(() => expect(lastCall('GET /api/milestones/templates').query).toEqual({ q: 'release' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Manager' }), { target: { value: 'Mia' } })
    fireEvent.click(await screen.findByRole('option', { name: /Mia Manager/ }))
    await waitFor(() => expect(lastCall('GET /api/milestones/templates').query).toEqual({ q: 'release', manager_id: 'MGR001' }))
  })

  it('managers see their own templates without a manager column or filter', async () => {
    respond('GET /api/milestones/templates', [{ ...template, description: null, milestones: [{ ...template.milestones[0], duration_days: 1 }] }])
    asManager('/milestone-templates')
    expect(await screen.findByText('Software release')).toBeTruthy()
    expect(screen.getByText(/Add one to a project from its Milestones tab, then pick the dates/)).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Manager' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Manager' })).toBeNull()
    expect(screen.getByRole('listitem').textContent).toBe('Plan · usually 1 day')
    // A template without a description edits with an empty one
    fireEvent.click(screen.getByRole('button', { name: 'Edit Software release' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit milestone template' })
    expect(within(dialog).getByLabelText(/^Description \(optional\)/, { selector: '#template-description' }).value).toBe('')
  })

  it('explains what templates are when there are none, and shows load errors', async () => {
    respond('GET /api/milestones/templates', [])
    const { unmount } = renderAt('/milestone-templates')
    expect(await screen.findByText('No milestone templates yet')).toBeTruthy()
    expect(screen.getByText(/add it to any project in one step instead of entering each milestone by hand/)).toBeTruthy()
    unmount()

    respond('GET /api/milestones/templates', { detail: 'Templates are unavailable' }, 503)
    renderAt('/milestone-templates')
    expect(await screen.findByText('Templates are unavailable')).toBeTruthy()
    respond('GET /api/milestones/templates', [template])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Software release')).toBeTruthy()
  })

  it('admins create a template for a manager, building its list of milestones', async () => {
    respond('POST /api/milestones/templates', { ...template, id: 8 })
    renderAt('/milestone-templates')
    fireEvent.click(await screen.findByRole('button', { name: 'New template' }))
    const dialog = await screen.findByRole('dialog', { name: 'New milestone template' })
    const create = within(dialog).getByRole('button', { name: 'Create template' })
    expect(create.disabled).toBe(true)
    expect(within(dialog).getByText(/Add it to a project from the project's Milestones tab/)).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText(/Template name/), { target: { value: ' Office move ' } })
    fireEvent.change(titleField(dialog, 0), { target: { value: 'Pack' } })
    fireEvent.change(titleField(dialog, 1), { target: { value: 'Unpack' } })
    expect(create.disabled).toBe(true)  // admins must pick the manager
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Manager' }), { target: { value: 'Mia' } })
    fireEvent.click(await screen.findByRole('option', { name: /Mia Manager/ }))
    expect(create.disabled).toBe(false)

    // Lengths must be whole days from 1 to 3650
    const days = within(dialog).getAllByLabelText(/Usual length/)
    for (const bad of ['0', '2.5', '3651']) {
      fireEvent.change(days[0], { target: { value: bad } })
      expect(within(dialog).getByText('1 to 3650 days')).toBeTruthy()
      expect(create.disabled).toBe(true)
    }
    fireEvent.change(days[0], { target: { value: '3' } })
    expect(create.disabled).toBe(false)

    // Add a third milestone, move it to the top, then remove the second
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add another milestone' }))
    fireEvent.change(titleField(dialog, 2), { target: { value: 'Book movers' } })
    fireEvent.change(within(dialog).getAllByLabelText(/Description \(optional\)/)[3], { target: { value: ' Two quotes ' } })
    expect(within(dialog).getByRole('button', { name: 'Move milestone 3 down' }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Move milestone 1 up' }).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move milestone 3 up' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move milestone 2 up' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move milestone 2 down' }))
    expect(within(dialog).getAllByLabelText(/Milestone title/).map((f) => f.value)).toEqual(['Book movers', 'Unpack', 'Pack'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove milestone 2' }))

    fireEvent.click(create)
    expect(await screen.findByText('Template created')).toBeTruthy()
    expect(bodyOf('POST /api/milestones/templates')).toEqual({
      name: 'Office move', description: null, manager_id: 'MGR001',
      milestones: [{ title: 'Book movers', description: 'Two quotes', duration_days: null }, { title: 'Pack', description: null, duration_days: 3 }],
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a template keeps at least one milestone, and blank titles block saving', async () => {
    asManager('/milestone-templates')
    fireEvent.click(await screen.findByRole('button', { name: 'New template' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('combobox', { name: 'Manager' })).toBeNull()  // managers' templates are their own
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove milestone 2' }))
    expect(within(dialog).getByRole('button', { name: 'Remove milestone 1' }).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/Template name/), { target: { value: 'Quick' } })
    fireEvent.change(titleField(dialog, 0), { target: { value: '   ' } })
    expect(within(dialog).getByRole('button', { name: 'Create template' }).disabled).toBe(true)
  })

  it('managers create templates for themselves; failures stay in the dialog', async () => {
    respond('POST /api/milestones/templates', { detail: 'This manager already has a milestone template with that name' }, 409)
    asManager('/milestone-templates')
    fireEvent.click(await screen.findByRole('button', { name: 'New template' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Template name/), { target: { value: 'Software release' } })
    fireEvent.change(within(dialog).getByLabelText(/^Description \(optional\)/, { selector: '#template-description' }), { target: { value: ' Ours ' } })
    fireEvent.change(titleField(dialog, 0), { target: { value: 'Plan' } })
    fireEvent.change(titleField(dialog, 1), { target: { value: 'Ship' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }))
    expect(await within(dialog).findByText('This manager already has a milestone template with that name')).toBeTruthy()
    expect(bodyOf('POST /api/milestones/templates')).toMatchObject({ name: 'Software release', description: 'Ours', manager_id: 'MGR001' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('edits a template, prefilled with its milestones', async () => {
    respond('PATCH /api/milestones/templates/7', template)
    asManager('/milestone-templates')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Software release' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit milestone template' })
    expect(within(dialog).getByLabelText(/Template name/).value).toBe('Software release')
    expect(within(dialog).getAllByLabelText(/Milestone title/).map((f) => f.value)).toEqual(['Plan', 'Build'])
    expect(within(dialog).getAllByLabelText(/Usual length/).map((f) => f.value)).toEqual(['10', ''])
    fireEvent.change(within(dialog).getByLabelText(/Template name/), { target: { value: 'Release v2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Template saved')).toBeTruthy()
    expect(bodyOf('PATCH /api/milestones/templates/7')).toEqual({
      name: 'Release v2', description: 'Our usual plan',
      milestones: [{ title: 'Plan', description: null, duration_days: 10 }, { title: 'Build', description: 'Write the code', duration_days: null }],
    })
  })

  it('deletes a template after confirming, keeping milestones already added', async () => {
    respond('DELETE /api/milestones/templates/7', null, 204)
    renderAt('/milestone-templates')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Software release' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Milestones already added to projects from it stay as they are/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Delete Software release' }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete template' }))
    expect(await screen.findByText('Template deleted')).toBeTruthy()
  })
})

describe('adding milestones from a template', () => {
  const openDialog = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Add from template' }))
    return screen.findByRole('dialog', { name: 'Add milestones from a template' })
  }

  it('suggests dates after the last milestone, checks them, and adds the milestones in order', async () => {
    respond('POST /api/projects/1/milestones/batch', [])
    renderAt('/projects/1?tab=milestones')
    const dialog = await openDialog()
    // Admins get the project manager's templates
    await waitFor(() => expect(lastCall('GET /api/milestones/templates').query).toEqual({ manager_id: 'MGR001' }))
    const add = within(dialog).getByRole('button', { name: 'Add milestones' })
    expect(add.disabled).toBe(true)
    await choose(dialog, 'Template', 'Software release (2 milestones)')

    // The last milestone ends Feb 28, 2027, so Plan starts Mar 1 and lasts its usual 10 days
    expect(within(dialog).getByText('3. Plan')).toBeTruthy()
    expect(within(dialog).getByText('4. Build')).toBeTruthy()
    expect(within(dialog).getByText('Usually 10 days')).toBeTruthy()
    expect(within(dialog).getByText('No usual length set')).toBeTruthy()
    const starts = within(dialog).getAllByLabelText('Start')
    const ends = within(dialog).getAllByLabelText('End')
    expect([starts[0].value, ends[0].value, starts[1].value, ends[1].value]).toEqual(['2027-03-01', '2027-03-10', '2027-03-11', ''])
    expect(within(dialog).getByText('Pick a start and an end date')).toBeTruthy()  // Build has no usual length
    expect(within(dialog).getByRole('button', { name: 'Add 2 milestones' }).disabled).toBe(true)
    expect(within(dialog).getByText('The project runs Sep 1, 2026 – Aug 31, 2027.')).toBeTruthy()

    fireEvent.change(ends[1], { target: { value: '2027-03-01' } })
    expect(within(dialog).getByText('The end date must be on or after the start date')).toBeTruthy()
    fireEvent.change(ends[1], { target: { value: '2027-04-30' } })
    fireEvent.change(starts[0], { target: { value: '2027-03-02' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 milestones' }))
    expect(await screen.findByText('2 milestones added')).toBeTruthy()
    expect(bodyOf('POST /api/projects/1/milestones/batch')).toEqual({ milestones: [
      { title: 'Plan', description: null, start_date: '2027-03-02', end_date: '2027-03-10' },
      { title: 'Build', description: 'Write the code', start_date: '2027-03-11', end_date: '2027-04-30' },
    ] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('milestones can be left out, and numbering follows what is added', async () => {
    renderAt('/projects/1?tab=milestones')
    const dialog = await openDialog()
    await choose(dialog, 'Template', 'Software release (2 milestones)')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Add "Plan"' }))
    expect(within(dialog).getByText('Left out')).toBeTruthy()
    expect(within(dialog).getByText('3. Build')).toBeTruthy()
    expect(within(dialog).getAllByLabelText('Start')[0].disabled).toBe(true)
    fireEvent.change(within(dialog).getAllByLabelText('End')[1], { target: { value: '2027-03-31' } })
    expect(within(dialog).getByRole('button', { name: 'Add 1 milestone' }).disabled).toBe(false)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Add "Build"' }))
    expect(within(dialog).getByRole('button', { name: 'Add milestones' }).disabled).toBe(true)
  })

  it('a project without milestones starts on the project\'s start date; one-day lengths read naturally', async () => {
    respond('GET /api/projects/1/milestones', [])
    respond('GET /api/milestones/templates', [{ ...template, milestones: [{ ...template.milestones[0], duration_days: 1 }] }])
    asManager('/projects/1?tab=milestones')
    const dialog = await openDialog()
    await waitFor(() => expect(lastCall('GET /api/milestones/templates').query).toEqual({}))  // managers get their own
    await choose(dialog, 'Template', 'Software release (1 milestone)')
    expect(within(dialog).getByText('1. Plan')).toBeTruthy()
    expect(within(dialog).getByText('Usually 1 day')).toBeTruthy()
    expect([within(dialog).getByLabelText('Start').value, within(dialog).getByLabelText('End').value]).toEqual(['2026-09-01', '2026-09-01'])
  })

  it('ignores milestones that end before the project starts when suggesting dates', async () => {
    respond('GET /api/projects/1/milestones', [{ id: 10, project_id: 1, sequence: 1, title: 'Prep', description: null, start_date: '2026-08-01', end_date: '2026-08-15', status: 'completed', completed_at: '2026-08-15T09:00:00Z', created_at: '', updated_at: '' }])
    renderAt('/projects/1?tab=milestones')
    const dialog = await openDialog()
    await choose(dialog, 'Template', 'Software release (2 milestones)')
    expect(within(dialog).getAllByLabelText('Start')[0].value).toBe('2026-09-01')
    expect(within(dialog).getByText('2. Plan')).toBeTruthy()
  })

  it('keeps the dialog open when adding fails, and adds once fixed', async () => {
    respond('POST /api/projects/1/milestones/batch', { detail: 'Archived projects can\'t be changed; unarchive it first' }, 409)
    renderAt('/projects/1?tab=milestones')
    const dialog = await openDialog()
    await choose(dialog, 'Template', 'Software release (2 milestones)')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Add "Build"' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 milestone' }))
    expect(await within(dialog).findByText('Archived projects can\'t be changed; unarchive it first')).toBeTruthy()
    respond('POST /api/projects/1/milestones/batch', [])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 1 milestone' }))
    expect(await screen.findByText('1 milestone added')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('points to the templates page when there are no templates yet', async () => {
    respond('GET /api/milestones/templates', [])
    const { unmount } = renderAt('/projects/1?tab=milestones')
    let dialog = await openDialog()
    expect(await within(dialog).findByText(/Mia Manager has no milestone templates yet/)).toBeTruthy()
    unmount()

    asManager('/projects/1?tab=milestones')
    dialog = await openDialog()
    expect(await within(dialog).findByText(/You don't have any milestone templates yet/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('link', { name: 'Create a milestone template' }))
    expect(await screen.findByRole('heading', { name: 'Milestone templates' })).toBeTruthy()
  })
})

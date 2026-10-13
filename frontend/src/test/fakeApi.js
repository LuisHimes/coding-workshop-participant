/**
 * A fake backend for tests: answers fetch() with realistic responses shaped
 * like the real API's, and records every call.
 */

export const admin = {
  id: 'ADMIN1', role: 'admin', first_name: 'Ada', last_name: 'Admin', email: 'ada@example.com', job_title: 'Administrator',
  salary: null, manager_id: null, is_active: true, must_change_password: false,
  created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
}
const manager = { ...admin, id: 'MGR001', role: 'manager', first_name: 'Mia', last_name: 'Manager', email: 'mia@example.com', job_title: 'Engineering Manager', salary: '150000.00' }
const employee = { ...admin, id: 'EMP001', role: 'employee', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com', job_title: 'Engineer', salary: '104000.00', manager_id: 'MGR001' }
export const users = [admin, manager, employee]

const project = {
  id: 1, name: 'Decommission 1000 servers', description: 'Retire the old data center', manager_id: 'MGR001', status: 'active',
  start_date: '2026-09-01', projected_end_date: '2027-08-31', allocated_hours: 4000, budget: '250000.00',
  archived_at: null, archived_by: null, archive_reason: null, archived: false,
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-02T09:00:00Z',
}
const archivedProject = { ...project, id: 2, name: 'Old intranet', status: 'planning', archived: true, archived_at: '2026-10-01T10:00:00Z', archived_by: 'ADMIN1', archive_reason: 'deleted' }
const milestone = {
  id: 10, project_id: 1, sequence: 1, title: 'Q1: 250 servers', description: 'First batch', start_date: '2026-09-01',
  end_date: '2026-11-30', status: 'in_progress', completed_at: null, created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z',
}
const milestone2 = { ...milestone, id: 11, sequence: 2, title: 'Q2: 500 servers', status: 'not_started', start_date: '2026-12-01', end_date: '2027-02-28' }
const health = {
  project_id: 1, name: project.name, status: 'active', archived: false, manager_id: 'MGR001', start_date: project.start_date,
  projected_end_date: project.projected_end_date, allocated_hours: 4000, logged_hours: '120.00', budget: '250000.00',
  labor_cost: '6000.00', budget_remaining: '244000.00', estimated_cost: '240000.00', member_count: 1, milestones_total: 2,
  milestones_completed: 0, completion_pct: '0', current_milestone: 'Q1: 250 servers', milestones_overdue: 0,
  timeline_pct: '12.3', budget_used_pct: '2.4', risk: { level: 'at_risk', reasons: ['Behind schedule: 0% of milestones complete with 12.3% of the timeline used'] },
}
const allocation = {
  user_id: 'EMP001', first_name: 'Grace', last_name: 'Hopper', manager_id: 'MGR001', hours_per_week: '45.0', over_limit: true,
  projects: [{ project_id: 1, project_name: project.name, hours_per_week: '45.0' }], last_week_logged_hours: '42.00',
}
const team = { id: 5, name: 'Racking crew', description: 'Hands on hardware', manager_id: 'MGR001', member_count: 1, created_at: '2026-09-05T09:00:00Z', updated_at: '2026-09-05T09:00:00Z' }

const routes = {
  'POST /api/auth/token': { access_token: 'test-token', token_type: 'bearer', expires_in: 3600, must_change_password: false },
  'GET /api/auth/me': admin,
  'GET /api/users': users,
  'GET /api/projects': [project, archivedProject],
  'GET /api/projects/1': project,
  'GET /api/projects/2': archivedProject,
  'GET /api/projects/1/members': [{ id: 1, project_id: 1, user_id: 'EMP001', hours_per_week: '45.0', assigned_by: 'MGR001', assigned_at: '2026-09-02T09:00:00Z' }],
  'GET /api/projects/1/milestones': [milestone, milestone2],
  'GET /api/projects/2/milestones': [],
  'GET /api/projects/2/members': [],
  'GET /api/projects/1/deliverables': [
    { milestone_id: 10, sequence: 1, title: milestone.title, status: 'in_progress', start_date: milestone.start_date, end_date: milestone.end_date, overdue: false, depends_on_milestone_id: null, blocked: false, tasks_total: 2, tasks_done: 1, completion_pct: '50.0', assignees: ['EMP001'], tasks: [] },
    { milestone_id: 11, sequence: 2, title: milestone2.title, status: 'not_started', start_date: milestone2.start_date, end_date: milestone2.end_date, overdue: false, depends_on_milestone_id: 10, blocked: true, tasks_total: 0, tasks_done: 0, completion_pct: '0', assignees: [], tasks: [] },
  ],
  'GET /api/projects/1/budget-estimate': { project_id: 1, estimated_cost: '240000.00' },
  'GET /api/milestones': [milestone, milestone2],
  'GET /api/milestones/10': milestone,
  'GET /api/milestones/10/tasks': [{ id: 100, milestone_id: 10, title: 'Unrack 250 servers', is_done: true, done_at: '2026-10-01T09:00:00Z', done_by: 'EMP001', created_at: '2026-09-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z' }],
  'GET /api/milestones/10/assignments': [{ id: 1, milestone_id: 10, project_id: 1, user_id: 'EMP001', assigned_at: '2026-09-02T09:00:00Z', finished_at: null }],
  'GET /api/reports/home': { active_projects: 1, projects_at_risk: 1, projects_off_track: 0, over_allocated_employees: 1, total_budget: '250000.00', total_labor_cost: '6000.00', projects: [health] },
  'GET /api/reports/projects': [health],
  'GET /api/reports/at-risk': [health],
  'GET /api/reports/budget': [{ project_id: 1, name: project.name, budget: '250000.00', estimated_cost: '240000.00', labor_cost: '6000.00', budget_remaining: '244000.00', budget_used_pct: '2.4', completion_pct: '0', allocated_hours: 4000, logged_hours: '120.00', over_budget: false }],
  'GET /api/reports/allocation': [allocation],
  'GET /api/reports/over-allocated': [allocation],
  'GET /api/teams': [team],
  'GET /api/teams/5': team,
  'GET /api/teams/5/members': [{ team_id: 5, user_id: 'EMP001', first_name: 'Grace', last_name: 'Hopper', job_title: 'Engineer', is_active: true, added_at: '2026-09-05T09:00:00Z' }],
  'GET /api/messages': [{ id: 1, project_id: null, author_id: 'ADMIN1', author_name: 'Ada Admin', body: 'Welcome to Project Tracker', created_at: '2026-10-01T09:00:00Z' }],
  'GET /api/time-entries': [{ id: 1, user_id: 'EMP001', project_id: 1, milestone_id: 10, work_date: '2026-10-12', hours: '8.00', description: 'Unracked row 4', created_at: '2026-10-12T17:00:00Z', updated_at: '2026-10-12T17:00:00Z' }],
  'GET /api/audit': [
    { id: 2, occurred_at: '2026-10-02T09:00:00Z', actor_id: 'ADMIN1', action: 'UPDATE', entity: 'projects', entity_id: '1', changes: { budget: { old: 200000, new: 250000 } } },
    { id: 1, occurred_at: '2026-10-01T09:00:00Z', actor_id: 'ADMIN1', action: 'LOGIN', entity: 'users', entity_id: 'ADMIN1', changes: null },
  ],
}

export const calls = []
export const unexpected = []
let overrides = {}

/** Replace a route's response for one test, e.g. respond('GET /api/auth/me', {...}). */
export function respond(route, body, status = 200) {
  overrides[route] = { body, status }
}

export function resetFakeApi() {
  calls.length = 0
  unexpected.length = 0
  overrides = {}
}

export async function fakeFetch(input, options = {}) {
  const url = new URL(String(input))
  const route = `${options.method || 'GET'} ${url.pathname}`
  calls.push({ route, query: Object.fromEntries(url.searchParams), body: options.body })
  if (route in overrides) {
    const { body, status } = overrides[route]
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  if (route in routes) {
    return new Response(JSON.stringify(routes[route]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  unexpected.push(route)
  return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
}

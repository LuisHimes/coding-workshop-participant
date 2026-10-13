/**
 * Every backend endpoint the app calls, grouped by feature Lambda.
 * If a backend route changes, this is the only file to update.
 */

import { request } from './client'

export const auth = {
  // OAuth2's password flow names the login field "username"; it holds the email
  login: (email, password) => request('auth', '/token', { method: 'POST', form: { username: email, password } }),
  me: () => request('auth', '/me'),
  updateMe: (body) => request('auth', '/me', { method: 'PATCH', body }),
  changePassword: (currentPassword, newPassword) =>
    request('auth', '/change-password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),
}

export const users = {
  list: (filters) => request('users', '', { query: filters }),
  get: (userId) => request('users', `/${userId}`),
  create: (body) => request('users', '', { method: 'POST', body }),
  update: (userId, body) => request('users', `/${userId}`, { method: 'PATCH', body }),
  resetPassword: (userId) => request('users', `/${userId}/reset-password`, { method: 'POST' }),
}

export const projects = {
  list: (filters) => request('projects', '', { query: filters }),
  get: (projectId) => request('projects', `/${projectId}`),
  create: (body) => request('projects', '', { method: 'POST', body }),
  update: (projectId, body) => request('projects', `/${projectId}`, { method: 'PATCH', body }),
  /** Deleting archives the project; reason is "deleted" (default) or "completed". */
  remove: (projectId, reason = 'deleted') =>
    request('projects', `/${projectId}`, { method: 'DELETE', body: { reason } }),
  unarchive: (projectId) => request('projects', `/${projectId}/unarchive`, { method: 'POST' }),
  budgetEstimate: (projectId) => request('projects', `/${projectId}/budget-estimate`),
  deliverables: (projectId) => request('projects', `/${projectId}/deliverables`),
  addTeam: (projectId, teamId, hoursPerWeek) =>
    request('projects', `/${projectId}/teams`, {
      method: 'POST',
      body: { team_id: teamId, hours_per_week: hoursPerWeek },
    }),
  members: {
    list: (projectId) => request('projects', `/${projectId}/members`),
    add: (projectId, userId, hoursPerWeek) =>
      request('projects', `/${projectId}/members`, {
        method: 'POST',
        body: { user_id: userId, hours_per_week: hoursPerWeek },
      }),
    update: (projectId, userId, hoursPerWeek) =>
      request('projects', `/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: { hours_per_week: hoursPerWeek },
      }),
    remove: (projectId, userId) => request('projects', `/${projectId}/members/${userId}`, { method: 'DELETE' }),
  },
  milestones: {
    list: (projectId) => request('projects', `/${projectId}/milestones`),
    create: (projectId, body) => request('projects', `/${projectId}/milestones`, { method: 'POST', body }),
  },
}

export const milestones = {
  /** Milestones of every open project you can see that overlap start..end (ISO dates, both optional). */
  list: (range) => request('milestones', '', { query: range }),
  active: () => request('milestones', '/active'),
  get: (milestoneId) => request('milestones', `/${milestoneId}`),
  update: (milestoneId, body) => request('milestones', `/${milestoneId}`, { method: 'PATCH', body }),
  remove: (milestoneId) => request('milestones', `/${milestoneId}`, { method: 'DELETE' }),
  tasks: {
    list: (milestoneId) => request('milestones', `/${milestoneId}/tasks`),
    create: (milestoneId, title) => request('milestones', `/${milestoneId}/tasks`, { method: 'POST', body: { title } }),
    update: (taskId, body) => request('milestones', `/tasks/${taskId}`, { method: 'PATCH', body }),
    remove: (taskId) => request('milestones', `/tasks/${taskId}`, { method: 'DELETE' }),
  },
  assignments: {
    list: (milestoneId) => request('milestones', `/${milestoneId}/assignments`),
    add: (milestoneId, userId) =>
      request('milestones', `/${milestoneId}/assignments`, { method: 'POST', body: { user_id: userId } }),
    setFinished: (milestoneId, userId, finished) =>
      request('milestones', `/${milestoneId}/assignments/${userId}`, { method: 'PATCH', body: { finished } }),
    remove: (milestoneId, userId) =>
      request('milestones', `/${milestoneId}/assignments/${userId}`, { method: 'DELETE' }),
  },
}

export const timeEntries = {
  list: (filters) => request('time-entries', '', { query: filters }),
  create: (body) => request('time-entries', '', { method: 'POST', body }),
  update: (entryId, body) => request('time-entries', `/${entryId}`, { method: 'PATCH', body }),
  remove: (entryId) => request('time-entries', `/${entryId}`, { method: 'DELETE' }),
}

export const messages = {
  list: (filters) => request('messages', '', { query: filters }),
  post: (body, projectId) => request('messages', '', { method: 'POST', body: { body, project_id: projectId ?? null } }),
  remove: (messageId) => request('messages', `/${messageId}`, { method: 'DELETE' }),
}

export const teams = {
  list: (filters) => request('teams', '', { query: filters }),
  get: (teamId) => request('teams', `/${teamId}`),
  create: (body) => request('teams', '', { method: 'POST', body }),
  update: (teamId, body) => request('teams', `/${teamId}`, { method: 'PATCH', body }),
  remove: (teamId) => request('teams', `/${teamId}`, { method: 'DELETE' }),
  members: {
    list: (teamId) => request('teams', `/${teamId}/members`),
    add: (teamId, userId) => request('teams', `/${teamId}/members`, { method: 'POST', body: { user_id: userId } }),
    remove: (teamId, userId) => request('teams', `/${teamId}/members/${userId}`, { method: 'DELETE' }),
  },
}

export const reports = {
  home: () => request('reports', '/home'),
  projects: (includeArchived = false) => request('reports', '/projects', { query: { include_archived: includeArchived } }),
  atRisk: () => request('reports', '/at-risk'),
  budget: () => request('reports', '/budget'),
  allocation: (teamId) => request('reports', '/allocation', { query: { team_id: teamId } }),
  overAllocated: (teamId) => request('reports', '/over-allocated', { query: { team_id: teamId } }),
}

export const audit = {
  list: (filters) => request('audit', '', { query: filters }),
}

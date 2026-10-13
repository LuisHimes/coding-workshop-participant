import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { projects as projectsApi, users as usersApi } from '../api/endpoints'
import { fullName } from '../utils/format'

const DirectoryContext = createContext(null)

function loadDirectory() {
  return Promise.all([usersApi.list({ include_inactive: true }), projectsApi.list({})])
}

/**
 * Users and projects by ID, so screens can show names instead of IDs
 * ("Grace Hopper" rather than "K3P9QZ"). Refreshed after changes.
 */
export function DirectoryProvider({ children }) {
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])

  const refresh = useCallback(
    () => loadDirectory().then(([userList, projectList]) => {
      setUsers(userList)
      setProjects(projectList)
    }),
    [],
  )

  useEffect(() => {
    let current = true
    loadDirectory().then(([userList, projectList]) => {
      if (!current) return
      setUsers(userList)
      setProjects(projectList)
    }, () => {})
    return () => {
      current = false
    }
  }, [])

  const value = useMemo(() => {
    const userById = new Map(users.map((u) => [u.id, u]))
    const projectById = new Map(projects.map((p) => [p.id, p]))
    return {
      users,
      projects,
      refresh,
      user: (id) => userById.get(id),
      userName: (id) => (id ? (userById.has(id) ? fullName(userById.get(id)) : id) : '—'),
      projectName: (id) => (id ? projectById.get(id)?.name ?? `Project ${id}` : 'Everyone'),
    }
  }, [users, projects, refresh])

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDirectory() {
  return useContext(DirectoryContext)
}

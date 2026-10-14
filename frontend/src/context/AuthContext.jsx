/** Login state for the whole app: the logged-in user, login/logout, and role checks. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setAccessToken, setUnauthorizedHandler } from '../api/client'
import { auth } from '../api/endpoints'

const TOKEN_KEY = 'project-tracker.token'
const AuthContext = createContext(null)

/** The saved token, or null when there is none or storage is blocked. */
function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Saves the token, or removes it when `token` is null. */
function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked (private window): the session lasts until the tab closes
  }
}

/**
 * Holds the logged-in user. The token is kept in localStorage so a refresh
 * keeps you logged in; it expires on the backend's schedule.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState(storedToken() ? 'checking' : 'anonymous')
  const [notice, setNotice] = useState(null)

  const logout = useCallback((message = null) => {
    setAccessToken(null)
    storeToken(null)
    setUser(null)
    setStatus('anonymous')
    setNotice(message)
  }, [])

  const refreshUser = useCallback(async () => {
    const me = await auth.me()
    setUser(me)
    setStatus('authenticated')
    return me
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => logout('Your session has ended. Log in again to continue.'))
  }, [logout])

  // Resume a stored session on load
  useEffect(() => {
    const token = storedToken()
    if (!token) return
    setAccessToken(token)
    auth.me().then(
      (me) => {
        setUser(me)
        setStatus('authenticated')
      },
      () => logout(),
    )
  }, [logout])

  const login = useCallback(
    async (email, password) => {
      const result = await auth.login(email, password)
      setAccessToken(result.access_token)
      storeToken(result.access_token)
      setNotice(null)
      return refreshUser()
    },
    [refreshUser],
  )

  const value = useMemo(
    () => ({ user, status, notice, login, logout, refreshUser }),
    [user, status, notice, login, logout, refreshUser],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * The logged-in user and session actions: `{ user, status, notice, login, logout, refreshUser }`.
 * `status` is 'checking' while a saved session is verified, then 'authenticated' or 'anonymous';
 * `notice` explains why the user was logged out (shown on the login page).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}

/** What the logged-in user's role allows the screens to show. The backend enforces the same rules. */
// eslint-disable-next-line react-refresh/only-export-components
export function useRole() {
  const { user } = useContext(AuthContext)
  return { isAdmin: user?.role === 'admin', isManager: user?.role === 'manager', isEmployee: user?.role === 'employee' }
}

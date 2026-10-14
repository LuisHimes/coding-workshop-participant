import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { ColorModeButton } from '../components/ColorMode'
import { admin, respond } from './fakeApi'

const STORAGE_KEY = 'project-tracker.color-mode'
const LIGHT_BACKGROUND = 'rgb(245, 247, 248)'
const DARK_BACKGROUND = 'rgb(15, 20, 25)'

function renderAt(path, { loggedIn = true } = {}) {
  if (loggedIn) localStorage.setItem('project-tracker.token', 'test-token')
  window.history.pushState({}, '', path)
  return render(<App />)
}

/** Pretends the browser is set to dark (or light) mode; setup.js removes the stub after each test. */
function browserPrefers(scheme) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: scheme === 'dark' && query.includes('dark'), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {},
  }))
}

const root = () => document.documentElement

async function choose(label) {
  fireEvent.click(await screen.findByRole('button', { name: 'Appearance' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(label) }))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

describe('light and dark mode', () => {
  it('follows a light browser by default', async () => {
    renderAt('/login', { loggedIn: false })
    expect(await screen.findByLabelText(/Email/)).toBeTruthy()
    expect(root().dataset.colorMode).toBe('light')
    expect(root().style.colorScheme).toBe('light')
    expect(root().style.backgroundColor).toBe(LIGHT_BACKGROUND)
  })

  it('follows a dark browser by default', async () => {
    browserPrefers('dark')
    renderAt('/login', { loggedIn: false })
    expect(await screen.findByLabelText(/Email/)).toBeTruthy()
    expect(root().dataset.colorMode).toBe('dark')
    expect(root().style.backgroundColor).toBe(DARK_BACKGROUND)
  })

  it('remembers a chosen mode, marks it as selected, and can go back to the browser\'s setting', async () => {
    renderAt('/login', { loggedIn: false })
    await choose('Dark')
    expect(root().dataset.colorMode).toBe('dark')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    const dark = await screen.findByRole('menuitem', { name: /Dark/ })
    expect(within(dark).getByTitle('Selected')).toBeTruthy()
    expect(within(screen.getByRole('menuitem', { name: /Light/ })).queryByTitle('Selected')).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    await choose('Match browser')
    expect(root().dataset.colorMode).toBe('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('a saved choice wins over the browser\'s setting; an unknown saved value is ignored', async () => {
    browserPrefers('dark')
    localStorage.setItem(STORAGE_KEY, 'light')
    const { unmount } = renderAt('/login', { loggedIn: false })
    expect(await screen.findByLabelText(/Email/)).toBeTruthy()
    expect(root().dataset.colorMode).toBe('light')
    unmount()

    localStorage.setItem(STORAGE_KEY, 'purple')
    renderAt('/login', { loggedIn: false })
    expect(await screen.findByLabelText(/Email/)).toBeTruthy()
    expect(root().dataset.colorMode).toBe('dark')
  })

  it('logged-in screens offer the choice in the top bar', async () => {
    renderAt('/')
    expect(await screen.findByText('Welcome back, Ada')).toBeTruthy()
    await choose('Dark')
    expect(root().dataset.colorMode).toBe('dark')
  })

  it('the set-password screen offers the choice too', async () => {
    respond('GET /api/auth/me', { ...admin, must_change_password: true })
    renderAt('/change-password')
    expect(await screen.findByText('Set your password')).toBeTruthy()
    await choose('Light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('still switches when browser storage is blocked, without saving', async () => {
    const blocked = () => { throw new Error('Storage is blocked') }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    try {
      renderAt('/login', { loggedIn: false })
      expect(root().dataset.colorMode).toBe('light')
      await choose('Dark')
      expect(root().dataset.colorMode).toBe('dark')
      await choose('Match browser')
      expect(root().dataset.colorMode).toBe('light')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('the button is harmless outside the provider', async () => {
    render(<ColorModeButton />)
    await choose('Dark')
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeTruthy()
  })
})

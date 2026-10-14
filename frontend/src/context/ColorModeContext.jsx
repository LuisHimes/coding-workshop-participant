/** App-wide light/dark mode: the provider that applies the theme, and the hook to read or change it. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { CssBaseline, useMediaQuery } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { createAppTheme } from '../theme'

const STORAGE_KEY = 'project-tracker.color-mode'

const ColorModeContext = createContext({ preference: 'system', mode: 'light', setPreference: () => {} })

/**
 * The saved choice, or 'system'. Storage can be blocked (private windows, strict settings), so
 * that falls back to the browser's setting too.
 */
function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/** Remembers the choice in this browser; 'system' clears it so the browser's setting is followed again. */
function savePreference(preference) {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Not saved: the choice lasts until the page is reloaded
  }
}

/**
 * Light or dark mode: follows the browser's setting unless the person picks
 * one, which is remembered in this browser.
 */
export function ColorModeProvider({ children }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
  const [preference, setPreferenceState] = useState(readPreference)
  const mode = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference
  const theme = useMemo(() => createAppTheme(mode), [mode])

  const setPreference = useCallback((value) => {
    setPreferenceState(value)
    savePreference(value)
  }, [])

  // The page behind the app (and the browser's scrollbars and form controls) match too
  useEffect(() => {
    const root = document.documentElement
    root.dataset.colorMode = mode
    root.style.colorScheme = mode
    root.style.backgroundColor = theme.palette.background.default
  }, [mode, theme])

  const value = useMemo(() => ({ preference, mode, setPreference }), [preference, mode, setPreference])
  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

/** `{ preference, mode, setPreference }`: the choice ('system', 'light' or 'dark') and the mode in effect. */
// eslint-disable-next-line react-refresh/only-export-components
export function useColorMode() {
  return useContext(ColorModeContext)
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { CssBaseline, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, useMediaQuery } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import CheckIcon from '@mui/icons-material/Check'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness'
import { createAppTheme } from '../theme'

const STORAGE_KEY = 'project-tracker.color-mode'

const CHOICES = [
  { value: 'system', label: 'Match browser', icon: <SettingsBrightnessIcon fontSize="small" /> },
  { value: 'light', label: 'Light', icon: <LightModeIcon fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkModeIcon fontSize="small" /> },
]

const ColorModeContext = createContext({ preference: 'system', mode: 'light', setPreference: () => {} })

// Storage can be blocked (private windows, strict settings); fall back to the browser's setting
function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

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

// eslint-disable-next-line react-refresh/only-export-components
export function useColorMode() {
  return useContext(ColorModeContext)
}

/** A button that lets people choose light, dark, or their browser's setting. */
export function ColorModeButton() {
  const { preference, mode, setPreference } = useColorMode()
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <Tooltip title="Appearance">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Appearance">
          {mode === 'dark' ? <DarkModeIcon /> : <LightModeIcon />}
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {CHOICES.map((choice) => (
          <MenuItem key={choice.value} selected={choice.value === preference}
            onClick={() => { setPreference(choice.value); setAnchor(null) }}>
            <ListItemIcon>{choice.icon}</ListItemIcon>
            <ListItemText>{choice.label}</ListItemText>
            {choice.value === preference && <CheckIcon fontSize="small" sx={{ ml: 2 }} titleAccess="Selected" />}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

import { createTheme } from '@mui/material/styles'

// The same teal and navy brand in both modes, lightened for dark backgrounds
const PALETTES = {
  light: {
    primary: { main: '#0e7c74', contrastText: '#ffffff' },
    secondary: { main: '#3d5a80' },
    warning: { main: '#b26a00' },
    background: { default: '#f5f7f8', paper: '#ffffff' },
    text: { primary: '#1c2330', secondary: '#5d6878' },
    divider: '#dde3ea',
  },
  dark: {
    primary: { main: '#4fc1b6', contrastText: '#06201e' },
    secondary: { main: '#93b4dc' },
    warning: { main: '#f0a742' },
    background: { default: '#0f1419', paper: '#171d24' },
    text: { primary: '#e6eaef', secondary: '#9aa5b4' },
    divider: '#2a333d',
  },
}

/** The app's theme for 'light' or 'dark' mode. */
export function createAppTheme(mode) {
  return createTheme({
    palette: { mode, ...PALETTES[mode] },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h5: { fontWeight: 600, letterSpacing: '-0.01em' },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiTableCell: {
        styleOverrides: { head: ({ theme }) => ({ fontWeight: 600, color: theme.palette.text.secondary, whiteSpace: 'nowrap' }) },
      },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiSelect: { defaultProps: { size: 'small' } },
    },
  })
}

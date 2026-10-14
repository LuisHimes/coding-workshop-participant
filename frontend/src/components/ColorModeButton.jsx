/** The "Appearance" button in the top bar and on the login screens. */

import { useState } from 'react'
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness'
import { useColorMode } from '../context/ColorModeContext'

const CHOICES = [
  { value: 'system', label: 'Match browser', icon: <SettingsBrightnessIcon fontSize="small" /> },
  { value: 'light', label: 'Light', icon: <LightModeIcon fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkModeIcon fontSize="small" /> },
]

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

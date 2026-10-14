/** App-wide snackbar for short confirmations and warnings. */

import { createContext, useCallback, useContext, useState } from 'react'
import { Alert, Snackbar } from '@mui/material'

const NotificationContext = createContext(() => {})

/** Short confirmations and warnings ("Project archived") at the bottom of the screen. */
export function NotificationProvider({ children }) {
  const [current, setCurrent] = useState(null)

  const notify = useCallback((message, severity = 'success') => {
    setCurrent({ message, severity, key: Date.now() })
  }, [])

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      <Snackbar
        key={current?.key}
        open={Boolean(current)}
        autoHideDuration={current?.severity === 'success' ? 4000 : 8000}
        onClose={(_, reason) => reason !== 'clickaway' && setCurrent(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert severity={current.severity} variant="filled" onClose={() => setCurrent(null)} sx={{ width: '100%' }}>
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotificationContext.Provider>
  )
}

/** Returns `notify(message, severity = 'success')`. Successes hide after 4 s, warnings and errors after 8 s. */
// eslint-disable-next-line react-refresh/only-export-components
export function useNotify() {
  return useContext(NotificationContext)
}

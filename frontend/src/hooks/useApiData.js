/** Hook for loading API data with loading, error and reload handling. */

import { useCallback, useEffect, useState } from 'react'

/**
 * Loads data from the API and tracks loading and error state.
 * `load` runs whenever `deps` change; call `reload()` after a change.
 * While a reload is in flight the previous data stays on screen.
 */
export function useApiData(load, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    load().then(
      (data) => current && setState({ data, error: null, loading: false }),
      (error) => current && setState((previous) => ({ ...previous, error, loading: false })),
    )
    return () => {
      current = false
    }
    // `load` is a new function every render; `deps` says when it actually changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true }))
    setVersion((v) => v + 1)
  }, [])

  return { ...state, reload }
}

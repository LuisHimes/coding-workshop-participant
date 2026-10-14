/**
 * Downloads code for other screens in the background once the page has
 * loaded and the browser is idle, so opening them later is instant. Loaders
 * run in order (most likely next screen first). Skipped when the visitor has
 * data saver on. Returns whether prefetching was scheduled.
 */
export function prefetchWhenIdle(loaders, win = window) {
  if (win.navigator?.connection?.saveData) return false
  // A failed prefetch is harmless: the screen downloads again when it's opened
  const run = () => loaders.forEach((load) => load().catch(() => {}))
  const whenIdle = () => (win.requestIdleCallback ? win.requestIdleCallback(run, { timeout: 3000 }) : win.setTimeout(run, 1000))
  if (win.document.readyState === 'complete') whenIdle()
  else win.addEventListener('load', whenIdle, { once: true })
  return true
}

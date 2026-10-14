import { describe, expect, it, vi } from 'vitest'
import { prefetchWhenIdle } from '../utils/prefetch'

/** A stand-in for window: records listeners and idle callbacks instead of waiting for them. */
function fakeWindow({ readyState = 'complete', idle = true, saveData = false } = {}) {
  const win = {
    document: { readyState },
    navigator: { connection: { saveData } },
    listeners: {},
    addEventListener: vi.fn((event, fn) => { win.listeners[event] = fn }),
    setTimeout: vi.fn((fn) => fn()),
  }
  if (idle) win.requestIdleCallback = vi.fn((fn) => fn())
  return win
}
const loaders = () => [vi.fn().mockResolvedValue({}), vi.fn().mockResolvedValue({})]

describe('prefetching screens in the background', () => {
  it('waits for the browser to be idle once the page has loaded, then fetches every screen in order', () => {
    const win = fakeWindow()
    const [first, second] = loaders()
    expect(prefetchWhenIdle([first, second], win)).toBe(true)
    expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 })
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0])
  })

  it('waits for the page to finish loading before starting', () => {
    const win = fakeWindow({ readyState: 'loading' })
    const [first] = loaders()
    prefetchWhenIdle([first], win)
    expect(first).not.toHaveBeenCalled()
    expect(win.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true })
    win.listeners.load()
    expect(first).toHaveBeenCalled()
  })

  it('falls back to a short delay in browsers without idle callbacks', () => {
    const win = fakeWindow({ idle: false })
    const [first] = loaders()
    prefetchWhenIdle([first], win)
    expect(win.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(first).toHaveBeenCalled()
  })

  it('respects data saver and ignores failed downloads', async () => {
    const saver = fakeWindow({ saveData: true })
    const [first] = loaders()
    expect(prefetchWhenIdle([first], saver)).toBe(false)
    expect(first).not.toHaveBeenCalled()

    const failing = vi.fn().mockRejectedValue(new Error('offline'))
    prefetchWhenIdle([failing], fakeWindow())
    await expect(failing.mock.results[0].value.catch(() => 'handled')).resolves.toBe('handled')
  })

  it('works with the real window', () => {
    expect(prefetchWhenIdle([], window)).toBe(true)
  })
})

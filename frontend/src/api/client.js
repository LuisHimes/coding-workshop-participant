/**
 * HTTP client for the backend.
 *
 * Every call goes to `${VITE_API_URL}/api/<feature>/<path>`: locally VITE_API_URL
 * is the dev proxy (http://localhost:3001), on AWS it is the CloudFront domain.
 * The first path segment picks the feature Lambda (auth, users, projects, ...).
 */

const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

let accessToken = null
let onUnauthorized = () => {}

export function setAccessToken(token) {
  accessToken = token
}

/** Called when a logged-in request comes back 401 (session expired or user deactivated). */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

/** Turns FastAPI error bodies into one readable sentence. */
function errorMessage(status, body) {
  const detail = body?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // Validation errors: [{ loc: ['body', 'name'], msg: 'Field required' }, ...]
    return detail
      .map((item) => {
        const field = item.loc?.filter((part) => part !== 'body' && part !== 'query').join('.')
        return field ? `${field}: ${item.msg}` : item.msg
      })
      .join('; ')
  }
  if (status >= 500) return 'Something went wrong on the server. Try again shortly.'
  return `Request failed (${status})`
}

/**
 * Calls the API and returns the parsed JSON (or null for empty responses).
 * Throws ApiError with a message that can be shown to the user.
 */
export async function request(feature, path = '', { method = 'GET', query, body, form } = {}) {
  const url = new URL(`${BASE_URL}/api/${feature}${path}`, window.location.origin)
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
  })

  const headers = { Accept: 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  let payload
  if (form) {
    payload = new URLSearchParams(form)
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }

  let response
  try {
    response = await fetch(url, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.")
  }

  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    if (response.status === 401 && accessToken) onUnauthorized()
    throw new ApiError(response.status, errorMessage(response.status, data), data?.detail)
  }
  return data
}

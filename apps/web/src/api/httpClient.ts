import { getAuthToken, getAuthTokenFromCookie } from '../auth/store'
import type { ZodType } from 'zod'

type ViteEnv = Record<string, string | boolean | undefined>

const viteEnv = ((import.meta as unknown) as { env?: ViteEnv }).env || {}
const explicitApiBase =
  typeof viteEnv.VITE_API_BASE === 'string' && viteEnv.VITE_API_BASE.trim()
    ? viteEnv.VITE_API_BASE.trim()
    : null

function isLocalDevApiBase(value: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(value)
}

export function resolveApiBaseForEnv(env: ViteEnv): string {
  const configuredBase =
    typeof env.VITE_API_BASE === 'string' && env.VITE_API_BASE.trim()
      ? env.VITE_API_BASE.trim()
      : null

  if (env.DEV === true) {
    if (!configuredBase || isLocalDevApiBase(configuredBase)) return '/api'
    return configuredBase.replace(/\/+$/, '')
  }
  return configuredBase ? configuredBase.replace(/\/+$/, '') : ''
}

export const API_BASE = resolveApiBaseForEnv(viteEnv)

export function getApiBaseConfig(): { apiBase: string; explicitApiBase: string | null; dev: boolean } {
  return {
    apiBase: API_BASE,
    explicitApiBase,
    dev: viteEnv.DEV === true,
  }
}

export function buildApiUrl(path: string): string {
  const trimmedPath = path.trim()
  if (!trimmedPath) return API_BASE || '/'
  if (/^https?:\/\//.test(trimmedPath)) return trimmedPath

  const base = (API_BASE || '').replace(/\/+$/, '')
  if (base && trimmedPath === base) return base || '/'
  if (base && trimmedPath.startsWith(`${base}/`)) return trimmedPath

  const normalizedPath = trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`
  const relativeUrl = `${base}${normalizedPath}`
  if (relativeUrl.startsWith('/')) return relativeUrl

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  return new URL(relativeUrl, origin).toString()
}

export function withAuth(init?: RequestInit): RequestInit {
  const token = getAuthToken() || getAuthTokenFromCookie()
  return {
    credentials: init?.credentials ?? 'include',
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = String(init?.method || 'GET').trim().toUpperCase()
  const shouldRetry = method === 'GET' || method === 'HEAD'
  const maxAttempts = shouldRetry ? 3 : 1
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(input, init)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message.trim().toLowerCase() : ''
      const transient =
        error instanceof TypeError ||
        message.includes('failed to fetch') ||
        message.includes('networkerror') ||
        message.includes('socket')
      if (!shouldRetry || !transient || attempt >= maxAttempts) {
        throw error
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, attempt * 250))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('api fetch failed')
}

export type ApiJsonError = Error & {
  status?: number
  details?: unknown
}

function createApiJsonError(message: string, patch?: { status?: number; details?: unknown }): ApiJsonError {
  const error = new Error(message) as ApiJsonError
  if (typeof patch?.status === 'number') error.status = patch.status
  if (typeof patch?.details !== 'undefined') error.details = patch.details
  return error
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw createApiJsonError('API response is not valid JSON', {
      status: response.status,
      details: error instanceof Error ? error.message : error,
    })
  }
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const record = body as { message?: unknown; error?: unknown }
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  return fallback
}

export async function apiFetchJson<T>(
  input: RequestInfo | URL,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(input, init)
  const body = await readJsonBody(response)
  if (!response.ok) {
    throw createApiJsonError(readErrorMessage(body, `API request failed: ${response.status}`), {
      status: response.status,
      details: body,
    })
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw createApiJsonError('API response schema mismatch', {
      status: response.status,
      details: parsed.error.flatten(),
    })
  }
  return parsed.data
}

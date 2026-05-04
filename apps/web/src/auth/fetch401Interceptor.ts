import { API_BASE } from '../api/httpClient'
import { toast } from '../ui/toast'
import { useAuth } from './store'

const FETCH_INTERCEPTOR_FLAG = '__tapcanvas_fetch401_installed__'
let lastUnauthorizedNotice = 0

function getRequestUrl(input: Parameters<typeof window.fetch>[0]): string {
  if (typeof input === 'string') return input
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return ''
}

const normalizedApiBase = typeof API_BASE === 'string' ? API_BASE.replace(/\/+$/, '') : ''
const apiBasePath = (() => {
  if (!normalizedApiBase || /^https?:\/\//i.test(normalizedApiBase)) return ''
  return normalizedApiBase.startsWith('/') ? normalizedApiBase : `/${normalizedApiBase}`
})()
const apiOrigin = (() => {
  if (!normalizedApiBase) return ''
  try {
    return new URL(normalizedApiBase).origin
  } catch {
    return ''
  }
})()

function isInternalApiRequest(input: Parameters<typeof window.fetch>[0]): boolean {
  const url = getRequestUrl(input)
  if (!url) return false
  if (url.startsWith('/')) return true
  if (normalizedApiBase && url.startsWith(normalizedApiBase)) return true
  if (apiOrigin && url.startsWith(apiOrigin)) return true
  if (typeof window !== 'undefined') {
    try {
      const origin = window.location.origin
      if (origin && url.startsWith(origin)) return true
    } catch {
      // ignore
    }
  }
  return false
}

function normalizeApiPathname(pathname: string): string {
  if (!apiBasePath || apiBasePath === '/') return pathname
  if (pathname === apiBasePath) return '/'
  return pathname.startsWith(`${apiBasePath}/`) ? pathname.slice(apiBasePath.length) : pathname
}

function isPublicApiRequest(input: Parameters<typeof window.fetch>[0]): boolean {
  const raw = getRequestUrl(input)
  if (!raw) return false
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined
    const parsed = new URL(raw, base)
    return normalizeApiPathname(parsed.pathname).startsWith('/public/')
  } catch {
    return false
  }
}

function isPublicAgentsChatRequest(input: Parameters<typeof window.fetch>[0]): boolean {
  const raw = getRequestUrl(input)
  if (!raw) return false
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : undefined
    const parsed = new URL(raw, base)
    return normalizeApiPathname(parsed.pathname) === '/public/agents/chat'
  } catch {
    return false
  }
}

async function isSessionAuthFailure(response: Response): Promise<boolean> {
  try {
    const body = await response.clone().json() as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false
    const code = (body as { code?: unknown }).code
    return code === 'auth_missing' || code === 'api_key_invalid' || code === 'unauthorized'
  } catch {
    return false
  }
}

function handleUnauthorized() {
  const { token, clear } = useAuth.getState()
  if (!token) return
  clear()
  const now = Date.now()
  if (now - lastUnauthorizedNotice > 2000) {
    lastUnauthorizedNotice = now
    toast('登录状态已过期，请重新登录', 'error')
  }
}

export function installAuth401Interceptor() {
  if (typeof window === 'undefined') return
  if ((window as any)[FETCH_INTERCEPTOR_FLAG]) return
  const originalFetch = window.fetch.bind(window)
  ;(window as any)[FETCH_INTERCEPTOR_FLAG] = true
  window.fetch = (async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
    const response = await originalFetch(...args)
    // /public/* may fail with upstream vendor auth (not user session expiry).
    // Do not clear current canvas login for those errors.
    if (
      response.status === 401 &&
      isInternalApiRequest(args[0]) &&
      (!isPublicApiRequest(args[0]) || (isPublicAgentsChatRequest(args[0]) && await isSessionAuthFailure(response)))
    ) {
      handleUnauthorized()
    }
    return response
  }) as typeof window.fetch
}

import { API_BASE, apiFetch, withAuth } from '../../api/httpClient'

export const WORKBENCH_API_BASE = API_BASE

export type WorkbenchApiError = Error & {
  status?: number
  code?: unknown
  details?: unknown
}

export function withWorkbenchAuth(init?: RequestInit): RequestInit {
  return withAuth(init)
}

export async function workbenchApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return apiFetch(input, init)
}

export async function readWorkbenchError(response: Response, fallbackMessage: string): Promise<WorkbenchApiError> {
  let message = fallbackMessage
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (body && typeof body === 'object') {
    const candidate = body as { message?: unknown; error?: unknown; code?: unknown; details?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      message = candidate.message
    } else if (typeof candidate.error === 'string' && candidate.error.trim()) {
      message = candidate.error
    }
  }
  const error = new Error(message) as WorkbenchApiError
  error.status = response.status
  if (body && typeof body === 'object') {
    const candidate = body as { code?: unknown; details?: unknown }
    error.code = candidate.code
    if (response.status < 500) {
      error.details = candidate.details
    }
  }
  return error
}

export async function throwWorkbenchApiError(response: Response, fallbackMessage: string): Promise<never> {
  throw await readWorkbenchError(response, fallbackMessage)
}

/**
 * A renderer-only display cache for completed tool calls.
 *
 * ProjectAgentToolItem deliberately keeps the Host record ref-only. The
 * resident still needs a useful, stable summary after a turn (and after a
 * renderer refresh), so this module stores only redacted display strings. It
 * never stores raw arguments, credentials, receipts, or task state; the Host
 * snapshot remains the source of truth for lifecycle and results.
 */

export type ResidentToolProjection = Readonly<{
  effect: string
  target: string
  technicalDetails: string
}>

export type ResidentToolProjectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_PREFIX = 'nomi.agent.resident.tool-projections.v1:'
const MAX_ENTRIES = 256
const MAX_TEXT_LENGTH = 2_000

function storageOrNull(storage?: ResidentToolProjectionStorage): ResidentToolProjectionStorage | null {
  if (storage) return storage
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function trimDisplayText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : ''
}

/** Remove common credential forms before any display text crosses storage. */
export function redactResidentSensitiveText(value: string): string {
  return trimDisplayText(value)
    .replace(/\b(?:sk|rk|pk|key|token)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/\b(?:bearer)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization|lease(?:handle)?|credential)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
}

export function normalizeResidentToolProjection(input: Partial<ResidentToolProjection>): ResidentToolProjection {
  return Object.freeze({
    effect: redactResidentSensitiveText(trimDisplayText(input.effect)),
    target: redactResidentSensitiveText(trimDisplayText(input.target)),
    technicalDetails: redactResidentSensitiveText(trimDisplayText(input.technicalDetails)),
  })
}

export function residentToolProjectionScope(bindingKey: string, threadId: string): string {
  return bindingKey && threadId ? `${bindingKey}:${threadId}` : ''
}

export function residentToolProjectionKey(scope: string, turnId: string, toolCallId: string): string {
  return `${scope}:${turnId}:${toolCallId}`
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`
}

function isProjection(value: unknown): value is ResidentToolProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.effect === 'string' && typeof record.target === 'string' && typeof record.technicalDetails === 'string'
}

/** Read only the current thread's derived display cache; malformed data is ignored. */
export function readResidentToolProjections(scope: string, storage?: ResidentToolProjectionStorage): Record<string, ResidentToolProjection> {
  const source = storageOrNull(storage)
  if (!source || !scope) return {}
  try {
    const raw = source.getItem(storageKey(scope))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, ResidentToolProjection> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>).slice(-MAX_ENTRIES)) {
      if (!key || !isProjection(value)) continue
      result[key] = normalizeResidentToolProjection(value)
    }
    return result
  } catch {
    return {}
  }
}

/** Persist a bounded map of redacted display strings, never raw tool args. */
export function writeResidentToolProjections(scope: string, projections: ReadonlyMap<string, ResidentToolProjection>, storage?: ResidentToolProjectionStorage): void {
  const target = storageOrNull(storage)
  if (!target || !scope) return
  try {
    const entries = Array.from(projections.entries()).slice(-MAX_ENTRIES)
    const payload = Object.fromEntries(entries.map(([key, value]) => [key, normalizeResidentToolProjection(value)]))
    target.setItem(storageKey(scope), JSON.stringify(payload))
  } catch {
    // Storage can be disabled or full in a hardened Electron profile. The
    // current render still works from the in-memory projection.
  }
}

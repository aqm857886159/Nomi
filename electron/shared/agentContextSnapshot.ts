import type { DocumentAnchorRef } from './capabilityTargeting'

/** Wire version for the immutable selection context attached to a turn. */
export const AGENT_CONTEXT_SNAPSHOT_VERSION = 1 as const

/**
 * Context kinds intentionally follow the resident interaction contract.  A
 * domain may add a kind later, but existing consumers must continue to treat
 * the handle as an opaque, traceable reference rather than inventing state.
 */
export const AGENT_CONTEXT_KINDS = [
  'image',
  'video',
  'audio',
  'document',
  'model3d',
  'webSelection',
  'canvasNode',
  'timelineClip',
] as const
export type AgentContextKind = typeof AGENT_CONTEXT_KINDS[number]

export const AGENT_CONTEXT_INTENT_ROLES = [
  'subject',
  'style',
  'structure',
  'motion',
  'audio',
  'source',
  'target',
] as const
export type AgentContextIntentRole = typeof AGENT_CONTEXT_INTENT_ROLES[number]

/** Domain locators are explicit so a target can be re-found after the UI moves on. */
export type AgentContextLocator =
  | Readonly<{ type: 'documentAnchor'; anchor: DocumentAnchorRef }>
  | Readonly<{ type: 'canvasSelection'; nodeIds: readonly string[] }>
  | Readonly<{ type: 'timeRange'; startMs: number; endMs: number }>
  | Readonly<{ type: 'clipSelection'; clipIds: readonly string[] }>
  | Readonly<{ type: 'custom'; key: string; value: unknown }>

export type AgentContextDisplay = Readonly<{
  title: string
  subtitle?: string
  posterUrl?: string
}>

/** One immutable reference captured by the resident composer at send time. */
export type AgentContextHandle = Readonly<{
  /** Stable handle identity within the request, independent of revision. */
  id: string
  kind: AgentContextKind
  /** Domain-owner identity; never a display label or array index. */
  targetId: string
  /** Revision observed at capture time, normalized to a wire string. */
  revision: string
  locator?: AgentContextLocator
  display: AgentContextDisplay
  intentRole: AgentContextIntentRole
  /** Forward-compatible, display-only domain extensions. */
  extensions?: Readonly<Record<string, unknown>>
}>

export type AgentContextSnapshot = Readonly<{
  version: typeof AGENT_CONTEXT_SNAPSHOT_VERSION
  handles: readonly AgentContextHandle[]
}>

function cloneAndFreeze(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(cloneAndFreeze(item, seen))
    return Object.freeze(copy)
  }

  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [key, item] of Object.entries(value)) copy[key] = cloneAndFreeze(item, seen)
  return Object.freeze(copy)
}

/**
 * Detach and recursively freeze a snapshot before it crosses the renderer →
 * Host boundary.  Freezing the caller's object in place would leave nested
 * arrays owned by Zustand/React, so this always creates a detached copy.
 */
export function freezeAgentContextSnapshot(snapshot: AgentContextSnapshot): AgentContextSnapshot {
  return cloneAndFreeze(snapshot) as AgentContextSnapshot
}

function compactText(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function compactAnchor(anchor: DocumentAnchorRef): Record<string, unknown> {
  if (anchor.kind === 'whole-document') return { kind: anchor.kind }
  if (anchor.kind === 'range') return {
    kind: anchor.kind,
    from: anchor.from,
    to: anchor.to,
    selectedTextHash: compactText(anchor.selectedTextHash, 64),
  }
  if (anchor.kind === 'cursor') return {
    kind: anchor.kind,
    position: anchor.position,
    beforeHash: compactText(anchor.beforeHash, 64),
    afterHash: compactText(anchor.afterHash, 64),
  }
  return { kind: anchor.kind, trailingTextHash: compactText(anchor.trailingTextHash, 64) }
}

function compactLocator(locator: NonNullable<AgentContextHandle['locator']>): Record<string, unknown> {
  if (locator.type === 'documentAnchor') return { type: locator.type, anchor: compactAnchor(locator.anchor) }
  if (locator.type === 'canvasSelection') return { type: locator.type, nodeIds: locator.nodeIds.slice(0, 16).map((id) => compactText(id, 96)) }
  if (locator.type === 'clipSelection') return { type: locator.type, clipIds: locator.clipIds.slice(0, 16).map((id) => compactText(id, 96)) }
  if (locator.type === 'timeRange') return { type: locator.type, startMs: locator.startMs, endMs: locator.endMs }
  const rawValue = locator.value
  let value: unknown
  if (typeof rawValue === 'string') value = compactText(rawValue, 160)
  else if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || rawValue === null) value = rawValue
  else value = '[omitted]'
  return { type: locator.type, key: compactText(locator.key, 64), value }
}

const MAX_TRANSIENT_CONTEXT_CHARS = 6000

function contextHeader(version: AgentContextSnapshot['version']): string {
  return `[Nomi current selection — read-only ContextSnapshot v${version}]\n`
}

type CompactContextHandle = {
  id: string
  kind: AgentContextKind
  targetId: string
  revision: string
  intentRole: AgentContextIntentRole
  display: { title: string; subtitle?: string }
  locator?: Record<string, unknown>
}

/**
 * Build a display-safe projection at a known detail level.  The runtime must
 * retain stable identity/revision even when it has to shed optional locator
 * detail to stay inside the hard context budget.
 */
function compactHandle(handle: AgentContextHandle, detail: 'full' | 'reduced' | 'minimal'): CompactContextHandle {
  if (detail === 'minimal') {
    return {
      id: compactText(handle.id, 64),
      kind: handle.kind,
      targetId: compactText(handle.targetId, 96),
      revision: compactText(handle.revision, 64),
      intentRole: handle.intentRole,
      display: { title: compactText(handle.display.title, 96) },
    }
  }
  const display = {
    title: compactText(handle.display.title),
    ...(detail === 'full' && handle.display.subtitle ? { subtitle: compactText(handle.display.subtitle) } : {}),
  }
  return {
    id: compactText(handle.id),
    kind: handle.kind,
    targetId: compactText(handle.targetId),
    revision: compactText(handle.revision, 96),
    intentRole: handle.intentRole,
    display,
    ...(detail === 'full' && handle.locator ? { locator: compactLocator(handle.locator) } : {}),
  }
}

/**
 * Encode as many handles as fit, preserving deterministic order.  A single
 * pathological handle is progressively compacted before it can be emitted;
 * this guarantees that the returned block (header included) never exceeds
 * MAX_TRANSIENT_CONTEXT_CHARS and is always valid JSON after the header.
 */
function encodeBoundedHandles(handles: readonly AgentContextHandle[], headerLength: number): string {
  const budget = Math.max(256, MAX_TRANSIENT_CONTEXT_CHARS - headerLength)
  const attempts: readonly CompactContextHandle[][] = [
    handles.map((handle) => compactHandle(handle, 'full')),
    handles.map((handle) => compactHandle(handle, 'reduced')),
    handles.map((handle) => compactHandle(handle, 'minimal')),
  ]
  for (const candidate of attempts) {
    let end = candidate.length
    while (end > 0) {
      const encoded = JSON.stringify(candidate.slice(0, end))
      if (encoded.length <= budget) return encoded
      end -= 1
    }
  }
  // `minimal` has bounded scalar fields, so this branch is only defensive
  // against future schema changes that add an unexpectedly large fixed field.
  return '[]'
}

/**
 * Project the snapshot into a small transient model context. It deliberately
 * omits posters/extensions and bounds labels so a large title or custom
 * locator cannot evict the conversation from the model's KV cache.
 */
export function formatAgentContextSnapshot(snapshot: AgentContextSnapshot | undefined): string {
  if (!snapshot?.handles.length) return ''
  // Keep only a deterministic first page.  The full immutable snapshot stays
  // on the Host request; this projection is model context, not a second owner.
  const handles = snapshot.handles.slice(0, 16)
  const header = contextHeader(snapshot.version)
  return `${header}${encodeBoundedHandles(handles, header.length)}`
}

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

/** Cut an already-normalized label to `limit`.  Cutting a cut label gives the same result as cutting once. */
function clipText(normalized: string, limit: number): string {
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function compactText(value: string, limit = 160): string {
  return clipText(value.replace(/\s+/g, ' ').trim(), limit)
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

/**
 * A locator is part of a handle's meaning (a document range, a time range, which director shot), so
 * the projection keeps it at every detail level.  The one exception is a selection locator: the
 * producer stamps the WHOLE selection into every handle, but each selected target is already its
 * own handle (or is counted in `omitted`), so repeating the ids per handle only burns the budget
 * quadratically (12 nodes already overflowed it).  Only ids that no handle names are written out.
 */
function compactLocator(
  locator: NonNullable<AgentContextHandle['locator']>,
  named: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (locator.type === 'documentAnchor') return { type: locator.type, anchor: compactAnchor(locator.anchor) }
  if (locator.type === 'canvasSelection' || locator.type === 'clipSelection') {
    const ids = locator.type === 'canvasSelection' ? locator.nodeIds : locator.clipIds
    const unnamed = ids.filter((id) => !named.has(id)).slice(0, 16).map((id) => compactText(id, 96))
    if (!unnamed.length) return undefined
    return locator.type === 'canvasSelection' ? { type: locator.type, nodeIds: unnamed } : { type: locator.type, clipIds: unnamed }
  }
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

/**
 * Said whenever handles are left out.  A constant sentence on purpose: the counts live in numeric
 * fields, so the same truncation always produces the same text (KV cache), and the model is never
 * left to assume the list it was given is the whole selection.
 */
const OMITTED_NOTE = 'The omitted handles are still part of the current selection, so the listed handles are not all of it. Do not guess the rest; read the live state first (canvas nodes: look_at_canvas).'

type CompactContextHandle = {
  id: string
  kind: AgentContextKind
  targetId: string
  revision: string
  intentRole: AgentContextIntentRole
  display: { title: string; subtitle?: string }
  locator?: Record<string, unknown>
}

type ProjectionDetail = Readonly<{ subtitle: boolean; titleLimit: number; tightIdentity: boolean }>

/**
 * Richest first.  The projection takes the first rung that lists EVERY handle, so a long title costs
 * detail (a shorter title, no subtitle) before it ever costs an entry.  Identity, role and locator
 * are never shed.  Only when even the last rung cannot list everything are handles left out, and
 * then the projection says how many.
 */
const PROJECTION_LADDER: readonly ProjectionDetail[] = [
  { subtitle: true, titleLimit: 160, tightIdentity: false },
  { subtitle: false, titleLimit: 160, tightIdentity: false },
  { subtitle: false, titleLimit: 96, tightIdentity: true },
  { subtitle: false, titleLimit: 48, tightIdentity: true },
  { subtitle: false, titleLimit: 24, tightIdentity: true },
  { subtitle: false, titleLimit: 12, tightIdentity: true },
]

/** A handle with every label normalized and cut to its widest rung once, so each rung only slices. */
type PreparedHandle = Readonly<{
  handle: AgentContextHandle
  id: string
  targetId: string
  revision: string
  title: string
  subtitle: string | undefined
  locator: Record<string, unknown> | undefined
}>

function prepareHandle(handle: AgentContextHandle, named: ReadonlySet<string>): PreparedHandle {
  return {
    handle,
    id: compactText(handle.id, 160),
    targetId: compactText(handle.targetId, 160),
    revision: compactText(handle.revision, 96),
    title: compactText(handle.display.title, 160),
    subtitle: handle.display.subtitle ? compactText(handle.display.subtitle, 160) : undefined,
    locator: handle.locator ? compactLocator(handle.locator, named) : undefined,
  }
}

/**
 * Build a display-safe projection at a known detail level.  The runtime must
 * retain stable identity/revision even when it has to shed optional display
 * detail to stay inside the hard context budget.
 */
function compactHandle(prepared: PreparedHandle, detail: ProjectionDetail): CompactContextHandle {
  const tight = detail.tightIdentity
  return {
    id: clipText(prepared.id, tight ? 64 : 160),
    kind: prepared.handle.kind,
    targetId: clipText(prepared.targetId, tight ? 96 : 160),
    revision: clipText(prepared.revision, tight ? 64 : 96),
    intentRole: prepared.handle.intentRole,
    display: {
      title: clipText(prepared.title, detail.titleLimit),
      ...(detail.subtitle && prepared.subtitle ? { subtitle: prepared.subtitle } : {}),
    },
    ...(prepared.locator ? { locator: prepared.locator } : {}),
  }
}

/** The accounting travels with the data: total = listed + omitted, always written, never inferred. */
function encodeProjection(total: number, rows: readonly CompactContextHandle[]): string {
  const omitted = total - rows.length
  return JSON.stringify({
    total,
    listed: rows.length,
    ...(omitted > 0 ? { omitted, omittedNote: OMITTED_NOTE } : {}),
    handles: rows,
  })
}

/**
 * Encode the snapshot inside the hard budget.  Preference order: list every handle at the richest
 * detail that fits; otherwise list the longest prefix (snapshot order, deterministic) of the leanest
 * rows and state how many were left out.  The returned block (header included) never exceeds
 * MAX_TRANSIENT_CONTEXT_CHARS and is always valid JSON after the header.
 */
function encodeBoundedHandles(handles: readonly AgentContextHandle[], headerLength: number): { body: string; listed: number } {
  const budget = Math.max(256, MAX_TRANSIENT_CONTEXT_CHARS - headerLength)
  const total = handles.length
  const named: ReadonlySet<string> = new Set(handles.map((handle) => handle.targetId))
  const prepared = handles.map((handle) => prepareHandle(handle, named))
  for (const detail of PROJECTION_LADDER) {
    const body = encodeProjection(total, prepared.map((item) => compactHandle(item, detail)))
    if (body.length <= budget) return { body, listed: total }
  }
  // Nothing fits whole: take the leanest rows and the longest prefix that fits.  Size grows with the
  // prefix (a row is far larger than the digits the omitted count can save), so bisecting is exact.
  const leanest = PROJECTION_LADDER[PROJECTION_LADDER.length - 1]!
  const rows = prepared.map((item) => compactHandle(item, leanest))
  let low = 0
  let high = total - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (encodeProjection(total, rows.slice(0, middle)).length <= budget) low = middle
    else high = middle - 1
  }
  return { body: encodeProjection(total, rows.slice(0, low)), listed: low }
}

/**
 * What the model is shown for a snapshot, plus the facts about it.  The `listed` handles are always
 * the first `listed` of `snapshot.handles`; the rest are counted in `omitted` and the text says so,
 * so a caller (the composer chip, a test) can tell whether the model saw the whole selection.
 */
export type AgentContextProjection = Readonly<{
  /** Transient model context; empty when nothing is selected. */
  text: string
  /** Handles in the snapshot. */
  total: number
  /** Handles written into `text`. */
  listed: number
  /** `total - listed`: handles the model was told about but not shown. */
  omitted: number
  truncated: boolean
}>

const EMPTY_PROJECTION: AgentContextProjection = Object.freeze({ text: '', total: 0, listed: 0, omitted: 0, truncated: false })

/**
 * Project the snapshot into a small transient model context. It deliberately
 * omits posters/extensions and bounds labels so a large title or custom
 * locator cannot evict the conversation from the model's KV cache.  The full
 * immutable snapshot stays on the Host request; this projection is model
 * context, not a second owner — and it never drops a handle silently.
 */
export function projectAgentContextSnapshot(snapshot: AgentContextSnapshot | undefined): AgentContextProjection {
  if (!snapshot?.handles.length) return EMPTY_PROJECTION
  const header = contextHeader(snapshot.version)
  const { body, listed } = encodeBoundedHandles(snapshot.handles, header.length)
  const total = snapshot.handles.length
  return { text: `${header}${body}`, total, listed, omitted: total - listed, truncated: listed < total }
}

export function formatAgentContextSnapshot(snapshot: AgentContextSnapshot | undefined): string {
  return projectAgentContextSnapshot(snapshot).text
}

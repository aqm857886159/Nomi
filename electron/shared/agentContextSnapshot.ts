import type { DocumentAnchorRef } from './capabilityTargeting'

/** Wire version for the immutable selection context attached to a turn. */
export const AGENT_CONTEXT_SNAPSHOT_VERSION = 1 as const

/**
 * Context kinds intentionally follow the resident interaction contract.  A
 * domain may add a kind later, but existing consumers must continue to treat
 * the handle as an opaque, traceable reference rather than inventing state.
 */
const AGENT_CONTEXT_KINDS = [
  'image',
  'video',
  'audio',
  'document',
  'model3d',
  'webSelection',
  'canvasNode',
  'timelineClip',
] as const
type AgentContextKind = typeof AGENT_CONTEXT_KINDS[number]

type AgentContextIntentRole =
  | 'subject'
  | 'style'
  | 'structure'
  | 'motion'
  | 'audio'
  | 'source'
  | 'target'

/** Domain locators are explicit so a target can be re-found after the UI moves on. */
type AgentContextLocator =
  | Readonly<{ type: 'documentAnchor'; anchor: DocumentAnchorRef }>
  | Readonly<{ type: 'canvasSelection'; nodeIds: readonly string[] }>
  | Readonly<{ type: 'timeRange'; startMs: number; endMs: number }>
  | Readonly<{ type: 'clipSelection'; clipIds: readonly string[] }>
  | Readonly<{ type: 'custom'; key: string; value: unknown }>

type AgentContextDisplay = Readonly<{
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
  selectionCache: Map<readonly string[], readonly string[]>,
): Record<string, unknown> | undefined {
  if (locator.type === 'documentAnchor') return { type: locator.type, anchor: compactAnchor(locator.anchor) }
  if (locator.type === 'canvasSelection' || locator.type === 'clipSelection') {
    const ids = locator.type === 'canvasSelection' ? locator.nodeIds : locator.clipIds
    const cached = selectionCache.get(ids)
    const unnamed = cached ?? (() => {
      const found = ids.filter((id) => !named.has(id)).slice(0, 16)
      selectionCache.set(ids, found)
      return found
    })()
    const compactUnnamed = unnamed.map((id) => compactText(id, 96))
    if (!compactUnnamed.length) return undefined
    return locator.type === 'canvasSelection' ? { type: locator.type, nodeIds: compactUnnamed } : { type: locator.type, clipIds: compactUnnamed }
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
 * The only source for omitted-kind recovery guidance.  Keep this beside the snapshot encoder rather
 * than in a model-facing schema: it describes how an already available read verb recovers a kind,
 * without spending resident tool-schema budget.  The note below is derived from this table.
 */
const OMITTED_KIND_GUIDANCE: Readonly<Partial<Record<AgentContextKind, string>>> = Object.freeze({
  canvasNode: 'For omitted canvas nodes, call look_at_canvas with no arguments; its node rows mark selected nodes and include all selected nodes. If its selected count differs from the canvasNode count in omittedByKind, the selection changed after send; tell the user.',
})
const OMITTED_FALLBACK_GUIDANCE = 'For omitted kinds without a selected-marker reader, ask the user to shrink the selection or send it in batches.'

function hasCompleteRead(kind: AgentContextKind): boolean {
  return Object.prototype.hasOwnProperty.call(OMITTED_KIND_GUIDANCE, kind)
}

type OmittedKind = Readonly<{
  kind: AgentContextKind
  count: number
}>

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

function prepareHandle(handle: AgentContextHandle, named: ReadonlySet<string>, selectionCache: Map<readonly string[], readonly string[]>): PreparedHandle {
  return {
    handle,
    id: compactText(handle.id, 160),
    targetId: compactText(handle.targetId, 160),
    revision: compactText(handle.revision, 96),
    title: compactText(handle.display.title, 160),
    subtitle: handle.display.subtitle ? compactText(handle.display.subtitle, 160) : undefined,
    locator: handle.locator ? compactLocator(handle.locator, named, selectionCache) : undefined,
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
function encodeProjection(total: number, rows: readonly CompactContextHandle[], omittedByKind: readonly OmittedKind[] = []): string {
  const omitted = total - rows.length
  return JSON.stringify({
    total,
    listed: rows.length,
    ...(omitted > 0 ? {
      omitted,
      ...(omittedByKind.length ? { omittedByKind } : {}),
      omittedNote: omittedNoteForKinds(omittedByKind),
    } : {}),
    handles: rows,
  })
}

function omittedByKindFromCounts(counts: ReadonlyMap<AgentContextKind, number>): OmittedKind[] {
  return AGENT_CONTEXT_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0
    return count > 0 ? [{ kind, count }] : []
  })
}

function omittedNoteForKinds(omittedByKind: readonly OmittedKind[]): string {
  const guidance = omittedByKind.map(({ kind }) => OMITTED_KIND_GUIDANCE[kind] ?? OMITTED_FALLBACK_GUIDANCE)
  return `The omitted handles are still part of the current selection. Use omittedByKind to see how many were not listed. ${guidance.join(' ')}`
}

function projectionLength(total: number, listed: number, handlePrefixLength: number, omittedByKind: readonly OmittedKind[]): number {
  let length = `{"total":${total},"listed":${listed}`.length
  const omitted = total - listed
  if (omitted > 0) {
    length += `,"omitted":${omitted}`.length
    if (omittedByKind.length) length += `,"omittedByKind":${JSON.stringify(omittedByKind)}`.length
    length += `,"omittedNote":${JSON.stringify(omittedNoteForKinds(omittedByKind))}`.length
  }
  return length + ',"handles":['.length + handlePrefixLength + 2
}

function tryEncodeRows({
  total,
  budget,
  rows,
  sourceHandles,
  initialOmittedCounts,
  allowPrefix,
}: {
  total: number
  budget: number
  rows: readonly CompactContextHandle[]
  sourceHandles: readonly AgentContextHandle[]
  initialOmittedCounts: ReadonlyMap<AgentContextKind, number>
  allowPrefix: boolean
}): { body: string; listed: number } | undefined {
  const rowLengths = rows.map((row) => JSON.stringify(row).length)
  const omittedCounts = new Map(initialOmittedCounts)
  let lastListed = 0
  let lastOmittedByKind: OmittedKind[] | undefined
  let handlePrefixLength = 0
  for (let listed = 0; listed <= rows.length; listed += 1) {
    const omittedByKind = omittedByKindFromCounts(omittedCounts)
    if (projectionLength(total, listed, handlePrefixLength, omittedByKind) > budget) break
    lastListed = listed
    lastOmittedByKind = omittedByKind
    if (listed === rows.length) return { body: encodeProjection(total, rows, omittedByKind), listed }
    const next = sourceHandles[listed]
    if (next) omittedCounts.set(next.kind, (omittedCounts.get(next.kind) ?? 0) - 1)
    handlePrefixLength += rowLengths[listed] + (listed > 0 ? 1 : 0)
  }
  if (allowPrefix && lastOmittedByKind !== undefined) {
    return { body: encodeProjection(total, rows.slice(0, lastListed), lastOmittedByKind), listed: lastListed }
  }
  return undefined
}

/**
 * Encode the snapshot inside the hard budget. Preference order: every detail rung first gets the
 * chance to list every handle; only if none can, omit every kind with a complete reader as a whole,
 * then give the remaining kinds the first rung that lists them all, or the least detailed rung's
 * longest prefix. The returned block (header included) never exceeds the hard bound.
 */
function encodeBoundedHandles(handles: readonly AgentContextHandle[], headerLength: number): { body: string; listed: number } {
  const budget = Math.max(256, MAX_TRANSIENT_CONTEXT_CHARS - headerLength)
  const total = handles.length
  const named: ReadonlySet<string> = new Set(handles.map((handle) => handle.targetId))
  const selectionCache = new Map<readonly string[], readonly string[]>()
  const prepared = handles.map((handle) => prepareHandle(handle, named, selectionCache))
  const fullOmittedCounts = new Map<AgentContextKind, number>()
  for (const handle of handles) fullOmittedCounts.set(handle.kind, (fullOmittedCounts.get(handle.kind) ?? 0) + 1)
  const rungRows: CompactContextHandle[][] = []
  for (const detail of PROJECTION_LADDER) {
    const rows = prepared.map((item) => compactHandle(item, detail))
    const fullProjection = tryEncodeRows({
      total,
      budget,
      rows,
      sourceHandles: handles,
      initialOmittedCounts: fullOmittedCounts,
      allowPrefix: false,
    })
    if (fullProjection) return fullProjection
    rungRows.push(rows)
  }

  // No rung lists the whole selection. A kind with a complete reader is all-or-nothing: remove
  // those rows as a class and spend the recovered budget on the kinds that have no selected-marker
  // reader, which keep the ladder and, on the least detailed rung, the longest prefix.
  const fallbackIndexes = handles.flatMap((handle, index) => hasCompleteRead(handle.kind) ? [] : [index])
  const fallbackHandles = fallbackIndexes.map((index) => handles[index])
  for (const [rung, rows] of rungRows.entries()) {
    const fallbackProjection = tryEncodeRows({
      total,
      budget,
      rows: fallbackIndexes.map((index) => rows[index]),
      sourceHandles: fallbackHandles,
      initialOmittedCounts: fullOmittedCounts,
      allowPrefix: rung === rungRows.length - 1,
    })
    if (fallbackProjection) return fallbackProjection
  }
  /* istanbul ignore next -- the final rung always fits the ledger-only projection */
  return { body: encodeProjection(total, [], omittedByKindFromCounts(fullOmittedCounts)), listed: 0 }
}

/**
 * What the model is shown for a snapshot, plus the facts about it. When a full projection does not
 * fit, every kind is omitted wholesale and the text carries a stable per-kind ledger instead of
 * implying completeness.
 */
export type AgentContextProjection = Readonly<{
  /** Transient model context; empty when nothing is selected. */
  text: string
  /** Handles in the snapshot. */
  total: number
  /** Number of handles written into `text` (readable kinds may be omitted wholesale). */
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

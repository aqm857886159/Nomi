import type { ProjectAgentReference } from '../../workbenchStore'
import type { AgentContextHandle } from '../../../../electron/shared/agentContextSnapshot'

export type ResidentReferenceContext = Readonly<{
  documentId: string | null
  nodeIds: readonly string[]
  clipIds: readonly string[]
}>

/** Capture the selected domain identity alongside the compact chip label. */
export function buildResidentReference(
  kind: ProjectAgentReference['kind'],
  label: string,
  context: ResidentReferenceContext,
  contextHandle?: AgentContextHandle,
): ProjectAgentReference {
  const value = kind === 'document'
    ? context.documentId ?? undefined
    : kind === 'canvas'
      ? context.nodeIds.length ? `nodes:${context.nodeIds.join(',')}` : undefined
      : kind === 'preview'
        ? context.clipIds.length ? `clips:${context.clipIds.join(',')}` : undefined
        : kind === 'timeline'
          ? context.clipIds.length ? `range:${context.clipIds.join(',')}` : undefined
          : undefined
  return Object.freeze({ id: value ? `${kind}:${value}` : `${kind}:selection`, label, kind, ...(value ? { value } : {}), ...(contextHandle ? { contextHandle } : {}) })
}

export function buildResidentAssetReference(assetId: string, label: string): ProjectAgentReference {
  return Object.freeze({ id: `asset:${assetId}`, label, kind: 'asset' as const, value: `asset:${assetId}` })
}

/** Stable reference emitted by a real storyboard row/result selection. */
export function buildStoryboardReference(
  scope: 'shot' | 'result',
  shotIndex: number,
  label: string,
  _role?: string,
): ProjectAgentReference {
  const value = `storyboard:${scope}:${shotIndex}`
  return Object.freeze({ id: value, label, kind: 'canvas' as const, value })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Decode only deterministic storyboard references; display labels never become targets. */
export function storyboardShotIndexesFromReferences(references: readonly ProjectAgentReference[]): number[] {
  return [...new Set(references.flatMap((reference) => {
    const match = reference.value?.match(/^storyboard:(?:shot|result):(\d+)$/)
    const index = match ? Number(match[1]) : NaN
    return Number.isInteger(index) && index > 0 ? [index] : []
  }))].sort((left, right) => left - right)
}

/**
 * Inject the current row selection into the canonical approval payload. This
 * is intentionally a no-op for the retired public `patch_shots` tool name.
 */
export function applyStoryboardSelectionToToolArgs(
  toolName: string,
  args: unknown,
  references: readonly ProjectAgentReference[],
): unknown {
  if (toolName !== 'nomi_canvas_plan' || !isRecord(args) || args.operation !== 'patch_shots') return args
  const indexes = storyboardShotIndexesFromReferences(references)
  return indexes.length ? { ...args, select: { kind: 'indexes', indexes } } : args
}

export function residentReferencePromptValue(reference: ProjectAgentReference): string {
  return reference.value ? `${reference.label} (${reference.value})` : reference.label
}

function referenceKindForContextHandle(handle: AgentContextHandle): ProjectAgentReference['kind'] | null {
  if (handle.kind === 'document') return 'document'
  if (handle.kind === 'canvasNode') return 'canvas'
  if (handle.kind === 'webSelection') return 'browser'
  if (handle.kind === 'timelineClip') {
    return handle.locator?.type === 'timeRange' ? 'timeline' : 'preview'
  }
  if (handle.kind === 'image' || handle.kind === 'video' || handle.kind === 'audio') return 'preview'
  return null
}

function referenceValueForContextHandle(kind: ProjectAgentReference['kind'], handle: AgentContextHandle): string | undefined {
  if (kind === 'document') return handle.targetId
  if (kind === 'canvas') {
    const locator = handle.locator?.type === 'canvasSelection' ? handle.locator.nodeIds : [handle.targetId]
    return locator.length ? `nodes:${locator.join(',')}` : undefined
  }
  if (kind === 'timeline') return handle.targetId ? `range:${handle.targetId}` : undefined
  if (kind === 'preview') return handle.targetId ? `clips:${handle.targetId}` : undefined
  return undefined
}

/** Convert a frozen Host handle into the compact composer reference projection. */
export function residentReferenceFromContextHandle(
  handle: AgentContextHandle,
  label = handle.display.title,
): ProjectAgentReference | null {
  const kind = referenceKindForContextHandle(handle)
  if (!kind) return null
  const value = referenceValueForContextHandle(kind, handle)
  return Object.freeze({
    id: value ? `${kind}:${value}` : `${kind}:selection`,
    label: label.trim() || handle.display.title,
    kind,
    ...(value ? { value } : {}),
    contextHandle: handle,
  })
}

function contextKindMatchesReference(kind: ProjectAgentReference['kind'], handle: AgentContextHandle): boolean {
  const projectedKind = referenceKindForContextHandle(handle)
  // Preview and timeline are two views over the same timeline clip owner.
  // Keep one immutable clip handle while allowing either surface's compact
  // reference chip to resolve it; no second preview/timeline identity is made.
  return projectedKind === kind || (kind === 'preview' && handle.kind === 'timelineClip')
}

function targetIdsInReference(reference: ProjectAgentReference): ReadonlySet<string> {
  if (!reference.value) return new Set<string>()
  if (reference.kind === 'document') return new Set([reference.value])
  const separator = reference.value.indexOf(':')
  const prefix = separator >= 0 ? reference.value.slice(0, separator) : ''
  const raw = separator >= 0 ? reference.value.slice(separator + 1) : reference.value
  if (!raw) return new Set<string>()
  if (reference.kind === 'canvas' && prefix === 'nodes') return new Set(raw.split(',').filter(Boolean))
  if (reference.kind === 'preview' && prefix === 'clips') return new Set(raw.split(',').filter(Boolean))
  if (reference.kind === 'timeline' && prefix === 'range') return new Set(raw.split(',').filter(Boolean))
  if (reference.kind === 'asset' && prefix === 'asset') return new Set([raw])
  return new Set([reference.value])
}

/**
 * Resolve a legacy/compact reference against the current immutable snapshot.
 * The function never manufactures a handle from a label. Composite canvas
 * references resolve to the first matching domain handle; the full current
 * selection remains represented by the snapshot's other handles.
 */
export function contextHandleForResidentReference(
  reference: ProjectAgentReference,
  handles: readonly AgentContextHandle[],
): AgentContextHandle | undefined {
  if (reference.contextHandle && contextKindMatchesReference(reference.kind, reference.contextHandle)) return reference.contextHandle
  const targetIds = targetIdsInReference(reference)
  return handles.find((handle) => contextKindMatchesReference(reference.kind, handle) && (targetIds.size === 0 || targetIds.has(handle.targetId)))
}

import type {
  AgentContextHandle,
  AgentContextSnapshot,
} from '../../../../electron/shared/agentContextSnapshot'
import { freezeAgentContextSnapshot } from '../../../../electron/shared/agentContextSnapshot'
import type { DocumentAnchorRef } from '../../../../electron/shared/capabilityTargeting'
import type { TimelineClipType } from '../../timeline/timelineTypes'
import type { ResidentSurface } from './residentShellDisplay'

export type ResidentDocumentSelection = Readonly<{
  id: string
  revision: string | number
  anchor: DocumentAnchorRef
  title?: string
  subtitle?: string
  posterUrl?: string
}>

export type ResidentCanvasNodeSelection = Readonly<{
  id: string
  title?: string
  kind?: string
  subtitle?: string
  posterUrl?: string
}>

export type ResidentTimelineClipSelection = Readonly<{
  id: string
  type: TimelineClipType
  label?: string
  startFrame: number
  endFrame: number
  thumbnailUrl?: string
}>

export type ResidentTimelineTextSelection = Readonly<{
  id: string
  text: string
  startFrame: number
  endFrame: number
}>

export type ResidentContextCaptureInput = Readonly<{
  document?: ResidentDocumentSelection | null
  canvas?: Readonly<{
    revision: string | number
    nodes: readonly ResidentCanvasNodeSelection[]
    selectedNodeIds: readonly string[]
  }> | null
  timeline?: Readonly<{
    revision: string | number
    fps: number
    clips: readonly ResidentTimelineClipSelection[]
    selectedClipIds: readonly string[]
    /** Text overlays are timeline clips the user can select too; they ride the same selection. */
    textClips?: readonly ResidentTimelineTextSelection[]
    selectedTextClipId?: string
  }> | null
}>

/** One selected object as the creator sees it: the chip, the target and the model handle all use this. */
export type ResidentSelectionMember = Readonly<{ id: string; title: string }>

export type ResidentSelection = Readonly<{
  snapshot: AgentContextSnapshot
  canvasNodeIds: readonly string[]
  /** Media clips first, then the selected text clip; the order the creator sees. */
  timelineClipIds: readonly string[]
  canvasMembers: readonly ResidentSelectionMember[]
  timelineMembers: readonly ResidentSelectionMember[]
}>

export type { AgentContextHandle, AgentContextSnapshot }

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function revision(value: string | number): string {
  const normalized = String(value).trim()
  return normalized || 'unknown'
}

function uniqueExistingIds(ids: readonly string[], existing: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of ids) {
    if (!nonEmpty(raw)) continue
    const id = raw.trim()
    if (seen.has(id) || !existing.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function displayTitle(value: string | undefined, fallback: string): string {
  return nonEmpty(value) ? value.trim() : fallback
}

function frameToMs(frame: number, fps: number): number {
  return Math.round((Number.isFinite(frame) ? frame : 0) / fps * 1000)
}

type CanvasInput = NonNullable<ResidentContextCaptureInput['canvas']>
type TimelineInput = NonNullable<ResidentContextCaptureInput['timeline']>
type TimelineMember = Readonly<{
  id: string
  title: string
  subtitle: string
  startFrame: number
  endFrame: number
  thumbnailUrl?: string
}>

/**
 * The single place that decides which objects are selected: drop ids that no
 * longer exist, drop duplicates, keep the creator's order, and name each one
 * the same way (a blank name falls back to the id).
 */
function selectCanvas(canvas: CanvasInput | null | undefined): Array<{ id: string; node: ResidentCanvasNodeSelection }> {
  if (!canvas) return []
  const nodesById = new Map(canvas.nodes.filter((node) => nonEmpty(node.id)).map((node) => [node.id.trim(), node]))
  return uniqueExistingIds(canvas.selectedNodeIds, new Set(nodesById.keys()))
    .map((id) => ({ id, node: nodesById.get(id)! }))
}

function selectTimeline(timeline: TimelineInput | null | undefined): TimelineMember[] {
  if (!timeline) return []
  const clipsById = new Map(timeline.clips.filter((clip) => nonEmpty(clip.id)).map((clip) => [clip.id.trim(), clip]))
  const media = uniqueExistingIds(timeline.selectedClipIds, new Set(clipsById.keys())).map((id): TimelineMember => {
    const clip = clipsById.get(id)!
    return {
      id,
      title: displayTitle(clip.label, id),
      subtitle: clip.type,
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
      ...(nonEmpty(clip.thumbnailUrl) ? { thumbnailUrl: clip.thumbnailUrl.trim() } : {}),
    }
  })
  const textById = new Map((timeline.textClips ?? []).filter((clip) => nonEmpty(clip.id)).map((clip) => [clip.id.trim(), clip]))
  const text = uniqueExistingIds(timeline.selectedTextClipId ? [timeline.selectedTextClipId] : [], new Set(textById.keys()))
    .filter((id) => !clipsById.has(id))
    .map((id): TimelineMember => {
      const clip = textById.get(id)!
      return { id, title: displayTitle(clip.text, id), subtitle: 'text', startFrame: clip.startFrame, endFrame: clip.endFrame }
    })
  return [...media, ...text]
}

/**
 * Chip-side view of the selection: the same members and names as the send
 * path, without building handles (no revision needed; cheap on every render).
 */
export function resolveResidentSelectionMembers(
  input: ResidentContextCaptureInput,
): Pick<ResidentSelection, 'canvasMembers' | 'timelineMembers'> {
  return {
    canvasMembers: selectCanvas(input.canvas).map(({ id, node }) => ({ id, title: displayTitle(node.title, id) })),
    timelineMembers: selectTimeline(input.timeline).map(({ id, title }) => ({ id, title })),
  }
}

/**
 * Resolve the current surface selection once: a detached, revisioned snapshot
 * plus the ids and members that the send target and the composer chips read.
 * Callers pass only the surface's active selection; the function never
 * guesses a target from a label or from a stale manual @ reference.
 */
export function resolveResidentSelection(input: ResidentContextCaptureInput): ResidentSelection {
  const handles: AgentContextHandle[] = []

  const document = input.document
  if (document && nonEmpty(document.id)) {
    const targetId = document.id.trim()
    handles.push({
      id: `document:${targetId}`,
      kind: 'document',
      targetId,
      revision: revision(document.revision),
      locator: { type: 'documentAnchor', anchor: document.anchor },
      display: {
        title: displayTitle(document.title, targetId),
        ...(nonEmpty(document.subtitle) ? { subtitle: document.subtitle.trim() } : {}),
        ...(nonEmpty(document.posterUrl) ? { posterUrl: document.posterUrl.trim() } : {}),
      },
      intentRole: 'source',
    })
  }

  const canvasSelected = selectCanvas(input.canvas)
  const canvasNodeIds = canvasSelected.map(({ id }) => id)
  for (const { id: nodeId, node } of canvasSelected) {
    handles.push({
      id: `canvas-node:${nodeId}`,
      kind: 'canvasNode',
      targetId: nodeId,
      revision: revision(input.canvas!.revision),
      locator: { type: 'canvasSelection', nodeIds: canvasNodeIds },
      display: {
        title: displayTitle(node.title, nodeId),
        ...(nonEmpty(node.subtitle) ? { subtitle: node.subtitle.trim() } : nonEmpty(node.kind) ? { subtitle: node.kind.trim() } : {}),
        ...(nonEmpty(node.posterUrl) ? { posterUrl: node.posterUrl.trim() } : {}),
      },
      intentRole: 'subject',
    })
  }

  const timeline = input.timeline
  const timelineSelected = selectTimeline(timeline)
  if (timeline) {
    const fps = Number.isFinite(timeline.fps) && timeline.fps > 0 ? timeline.fps : 30
    for (const member of timelineSelected) {
      // A timeline clip is a domain object, not merely a media MIME kind: it uses
      // the dedicated wire kind so references resolve after the surface changes;
      // the media type (or `text`) stays in the display subtitle.
      handles.push({
        id: `timeline-clip:${member.id}`,
        kind: 'timelineClip',
        targetId: member.id,
        revision: revision(timeline.revision),
        locator: {
          type: 'timeRange',
          startMs: frameToMs(member.startFrame, fps),
          endMs: frameToMs(member.endFrame, fps),
        },
        display: {
          title: member.title,
          subtitle: member.subtitle,
          ...(member.thumbnailUrl ? { posterUrl: member.thumbnailUrl } : {}),
        },
        intentRole: 'target',
      })
    }
  }

  return Object.freeze({
    snapshot: freezeAgentContextSnapshot({ version: 1, handles }),
    canvasNodeIds: Object.freeze(canvasNodeIds),
    timelineClipIds: Object.freeze(timelineSelected.map(({ id }) => id)),
    canvasMembers: Object.freeze(canvasSelected.map(({ id, node }) => Object.freeze({ id, title: displayTitle(node.title, id) }))),
    timelineMembers: Object.freeze(timelineSelected.map(({ id, title }) => Object.freeze({ id, title }))),
  })
}

/** What the two stores hold, as plain data (the caller passes `getState()` or live slices). */
export type ResidentSelectionSources = Readonly<{
  document?: ResidentDocumentSelection | null
  workbench: Readonly<{
    timeline: Readonly<{
      fps: number
      tracks: ReadonlyArray<Readonly<{ clips: readonly ResidentTimelineClipSelection[] }>>
      textClips: readonly ResidentTimelineTextSelection[]
    }>
    selectedTimelineClipIds: readonly string[]
    selectedTextClipId: string
  }>
  canvas: Readonly<{
    persistRevision: string | number
    nodes: readonly ResidentCanvasNodeSelection[]
    selectedNodeIds: readonly string[]
  }>
  /** Computed by the caller only when a snapshot is built (hashing the whole timeline is not per-render work). */
  readTimelineRevision: () => string | number
}>

/**
 * Surface → which domain's selection counts this turn. The raw selection
 * fields of both stores are read here and nowhere else in the assistant panel.
 */
export function residentSelectionInput(surface: ResidentSurface, sources: ResidentSelectionSources): ResidentContextCaptureInput {
  const { workbench, canvas } = sources
  return {
    document: sources.document ?? null,
    canvas: surface === 'generation'
      ? { revision: canvas.persistRevision, nodes: canvas.nodes, selectedNodeIds: canvas.selectedNodeIds }
      : null,
    timeline: surface === 'preview'
      ? {
          revision: sources.readTimelineRevision(),
          fps: workbench.timeline.fps,
          clips: workbench.timeline.tracks.flatMap((track) => track.clips),
          selectedClipIds: workbench.selectedTimelineClipIds,
          textClips: workbench.timeline.textClips,
          selectedTextClipId: workbench.selectedTextClipId,
        }
      : null,
  }
}

/** Alias used by callers that already hold a structurally complete snapshot. */
export function freezeResidentContextSnapshot(snapshot: AgentContextSnapshot): AgentContextSnapshot {
  return freezeAgentContextSnapshot(snapshot)
}

/**
 * Add explicit manual references to the send-time snapshot without creating a
 * second mutable context owner. A manual handle wins when its stable identity
 * is also present in the current selection: that preserves the revision the
 * user actually referenced if the object changed while they were composing.
 */
export function mergeResidentContextHandles(
  snapshot: AgentContextSnapshot,
  handles: readonly AgentContextHandle[],
): AgentContextSnapshot {
  if (!handles.length) return snapshot
  const merged = [...snapshot.handles]
  const indexById = new Map(merged.map((handle, index) => [handle.id, index]))
  for (const handle of handles) {
    if (!handle) continue
    const index = indexById.get(handle.id)
    if (index === undefined) {
      indexById.set(handle.id, merged.length)
      merged.push(handle)
    } else {
      merged[index] = handle
    }
  }
  return freezeAgentContextSnapshot({ version: 1, handles: merged })
}

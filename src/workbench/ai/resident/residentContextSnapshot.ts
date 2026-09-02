import type {
  AgentContextHandle,
  AgentContextSnapshot,
} from '../../../../electron/shared/agentContextSnapshot'
import { freezeAgentContextSnapshot } from '../../../../electron/shared/agentContextSnapshot'
import type { DocumentAnchorRef } from '../../../../electron/shared/capabilityTargeting'
import type { TimelineClipType } from '../../timeline/timelineTypes'

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
  }> | null
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
  for (const id of ids) {
    if (!nonEmpty(id) || seen.has(id) || !existing.has(id)) continue
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

function clipKind(_type: TimelineClipType): AgentContextHandle['kind'] {
  // A timeline clip is a domain object, not merely a media MIME kind.  Keep
  // its media type in the display projection while using the dedicated wire
  // kind so timeline references can be resolved after the surface changes.
  return 'timelineClip'
}

/**
 * Build the current surface selection as a detached, revisioned snapshot.
 * Callers should pass only the surface's active selection; the function never
 * guesses a target from a label or from a stale manual @ reference.
 */
export function buildResidentContextSnapshot(input: ResidentContextCaptureInput): AgentContextSnapshot {
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

  const canvas = input.canvas
  if (canvas) {
    const nodesById = new Map(canvas.nodes.filter((node) => nonEmpty(node.id)).map((node) => [node.id.trim(), node]))
    const selectedNodeIds = uniqueExistingIds(canvas.selectedNodeIds, new Set(nodesById.keys()))
    for (const nodeId of selectedNodeIds) {
      const node = nodesById.get(nodeId)
      if (!node) continue
      handles.push({
        id: `canvas-node:${nodeId}`,
        kind: 'canvasNode',
        targetId: nodeId,
        revision: revision(canvas.revision),
        locator: { type: 'canvasSelection', nodeIds: selectedNodeIds },
        display: {
          title: displayTitle(node.title, nodeId),
          ...(nonEmpty(node.subtitle) ? { subtitle: node.subtitle.trim() } : nonEmpty(node.kind) ? { subtitle: node.kind.trim() } : {}),
          ...(nonEmpty(node.posterUrl) ? { posterUrl: node.posterUrl.trim() } : {}),
        },
        intentRole: 'subject',
      })
    }
  }

  const timeline = input.timeline
  if (timeline) {
    const clipsById = new Map(timeline.clips.filter((clip) => nonEmpty(clip.id)).map((clip) => [clip.id.trim(), clip]))
    const selectedClipIds = uniqueExistingIds(timeline.selectedClipIds, new Set(clipsById.keys()))
    const fps = Number.isFinite(timeline.fps) && timeline.fps > 0 ? timeline.fps : 30
    for (const clipId of selectedClipIds) {
      const clip = clipsById.get(clipId)
      if (!clip) continue
      handles.push({
        id: `timeline-clip:${clipId}`,
        kind: clipKind(clip.type),
        targetId: clipId,
        revision: revision(timeline.revision),
        locator: {
          type: 'timeRange',
          startMs: frameToMs(clip.startFrame, fps),
          endMs: frameToMs(clip.endFrame, fps),
        },
        display: {
          title: displayTitle(clip.label, clipId),
          subtitle: clip.type,
          ...(nonEmpty(clip.thumbnailUrl) ? { posterUrl: clip.thumbnailUrl.trim() } : {}),
        },
        intentRole: 'target',
      })
    }
  }

  return freezeAgentContextSnapshot({
    version: 1,
    handles,
  })
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

import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'

export const TIMELINE_GENERATION_NODE_DRAG_MIME = 'application/x-tapcanvas-generation-node'
export const TIMELINE_CLIP_DRAG_MIME = 'application/x-tapcanvas-workbench-clip'

export type TimelineClipDragPayload = {
  kind: 'clip'
  clipId: string
}

export type TimelineGenerationNodeDragPayload = {
  kind: 'generationNode'
  node: GenerationCanvasNode
  resultId?: string
}

function parseJsonPayload(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function encodeTimelineGenerationNodeDragPayload(node: GenerationCanvasNode, resultId?: string): string {
  return JSON.stringify({
    kind: 'generationNode',
    node,
    ...(resultId ? { resultId } : {}),
  } satisfies TimelineGenerationNodeDragPayload)
}

export function decodeTimelineGenerationNodeDragPayload(value: string): TimelineGenerationNodeDragPayload | null {
  const parsed = parseJsonPayload(value)
  if (!parsed || typeof parsed !== 'object') return null
  const payload = parsed as { kind?: unknown; node?: unknown; resultId?: unknown }
  if (payload.kind !== 'generationNode' || !payload.node || typeof payload.node !== 'object') return null
  const node = payload.node as GenerationCanvasNode
  const id = typeof node.id === 'string' ? node.id.trim() : ''
  if (!id) return null
  return {
    kind: 'generationNode',
    node: {
      ...node,
      id,
    },
    ...(typeof payload.resultId === 'string' && payload.resultId.trim() ? { resultId: payload.resultId.trim() } : {}),
  }
}

export function encodeTimelineClipDragPayload(clipId: string): string {
  return JSON.stringify({ kind: 'clip', clipId: String(clipId || '').trim() } satisfies TimelineClipDragPayload)
}

export function decodeTimelineClipDragPayload(value: string): TimelineClipDragPayload | null {
  const parsed = parseJsonPayload(value)
  if (!parsed || typeof parsed !== 'object') return null
  const payload = parsed as { kind?: unknown; clipId?: unknown }
  const clipId = typeof payload.clipId === 'string' ? payload.clipId.trim() : ''
  if (payload.kind !== 'clip' || !clipId) return null
  return { kind: 'clip', clipId }
}

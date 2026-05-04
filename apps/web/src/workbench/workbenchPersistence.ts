import { createDefaultWorkbenchDocument, type WorkbenchDocument } from './workbenchTypes'
import { createDefaultTimeline, normalizeTimeline } from './timeline/timelineMath'
import type { TimelineState } from './timeline/timelineTypes'
import type { GenerationCanvasSnapshot } from './generationCanvasV2/model/generationCanvasTypes'

export type SerializedWorkbenchState = {
  workbenchDocument: WorkbenchDocument
  timeline: TimelineState
  generationCanvas: GenerationCanvasSnapshot
}

export function normalizeWorkbenchDocument(input: unknown): WorkbenchDocument {
  if (!input || typeof input !== 'object') return createDefaultWorkbenchDocument()
  const raw = input as Record<string, unknown>
  return {
    version: 1,
    title: typeof raw.title === 'string' ? raw.title : '',
    contentJson: raw.contentJson ?? createDefaultWorkbenchDocument().contentJson,
    updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  }
}

export function serializeWorkbenchState(input: {
  workbenchDocument?: unknown
  timeline?: unknown
  generationCanvas?: unknown
}): SerializedWorkbenchState {
  return {
    workbenchDocument: normalizeWorkbenchDocument(input.workbenchDocument),
    timeline: input.timeline ? normalizeTimeline(input.timeline) : createDefaultTimeline(),
    generationCanvas: normalizeGenerationCanvasSnapshot(input.generationCanvas),
  }
}

function isGenerationCanvasSnapshot(input: unknown): input is GenerationCanvasSnapshot {
  if (!input || typeof input !== 'object') return false
  const raw = input as Record<string, unknown>
  return Array.isArray(raw.nodes) && Array.isArray(raw.edges) && Array.isArray(raw.selectedNodeIds)
}

export function normalizeGenerationCanvasSnapshot(input: unknown): GenerationCanvasSnapshot {
  if (!isGenerationCanvasSnapshot(input)) {
    return {
      nodes: [],
      edges: [],
      selectedNodeIds: [],
    }
  }
  return input
}

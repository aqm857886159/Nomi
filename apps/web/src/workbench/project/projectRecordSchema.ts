import { z } from 'zod'
import { generationCanvasSnapshotSchema } from '../generationCanvasV2/model/generationCanvasSchema'
import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import { createDefaultWorkbenchDocument, type WorkbenchDocument } from '../workbenchTypes'
import { createDefaultGenerationCanvasSnapshot } from '../generationCanvasV2/store/generationCanvasDefaults'
import type { GenerationCanvasSnapshot } from '../generationCanvasV2/model/generationCanvasTypes'

export const workbenchProjectRecordVersionSchema = z.literal(1)

export const workbenchProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  revision: z.number().int().nonnegative().optional(),
  savedAt: z.number().finite().optional(),
  lastWriteSource: z.enum(['local', 'server']).optional(),
  thumbStyle: z.string().optional(),
  thumbnail: z.string().optional(),
  thumbnailUrls: z.array(z.string()).optional(),
})

export const workbenchProjectPayloadSchema = z.object({
  workbenchDocument: z.object({
    version: z.literal(1),
    title: z.string(),
    contentJson: z.unknown().refine((value) => value !== undefined, 'contentJson is required'),
    updatedAt: z.number().finite(),
  }),
  timeline: z.object({
    version: z.literal(1),
    fps: z.literal(30),
    scale: z.number().finite(),
    playheadFrame: z.number().finite(),
    tracks: z.array(z.object({
      id: z.string(),
      type: z.enum(['text', 'image', 'video']),
      label: z.string(),
      clips: z.array(z.unknown().refine((value) => value !== undefined, 'clip is required')),
    })),
  }),
  generationCanvas: generationCanvasSnapshotSchema,
})

export const workbenchProjectRecordSchema = workbenchProjectSummarySchema.extend({
  version: workbenchProjectRecordVersionSchema,
  payload: workbenchProjectPayloadSchema,
})

export type WorkbenchProjectSummary = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  revision?: number
  savedAt?: number
  lastWriteSource?: 'local' | 'server'
  thumbStyle?: string
  thumbnail?: string
  thumbnailUrls?: string[]
}

export type WorkbenchProjectPayload = {
  workbenchDocument: WorkbenchDocument
  timeline: TimelineState
  generationCanvas: GenerationCanvasSnapshot
}

export type WorkbenchProjectRecordV1 = WorkbenchProjectSummary & {
  version: 1
  payload: WorkbenchProjectPayload
}

export type WorkbenchProjectRecordLegacy = {
  id?: unknown
  name?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  thumbStyle?: unknown
  workbenchDocument?: unknown
  timeline?: unknown
  generationCanvas?: unknown
}

export function createDefaultWorkbenchProjectPayload(): WorkbenchProjectPayload {
  return {
    workbenchDocument: createDefaultWorkbenchDocument(),
    timeline: createDefaultTimeline(),
    generationCanvas: createDefaultGenerationCanvasSnapshot(),
  }
}

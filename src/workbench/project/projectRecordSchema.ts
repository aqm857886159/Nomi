import { z } from 'zod'

import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import { createDefaultWorkbenchDocument, type WorkbenchDocument } from '../workbenchTypes'
import { createDefaultGenerationCanvasSnapshot } from '../generationCanvas/store/generationCanvasDefaults'
import type { GenerationCanvasSnapshot } from '../generationCanvas/model/generationCanvasTypes'
import { cloneBuiltinCategories, projectCategorySchema, type ProjectCategory } from './projectCategories'

// Persisted records come in two shapes that carry an identical `payload`:
//   v1 = legacy single-file project.json
//   v2 = workspace folder manifest (.nomi/project.json), adds lastKnownRootPath
// The renderer keeps a single in-memory representation (version 1); both
// persisted versions normalize into it, so we accept either tag here.
export const workbenchProjectRecordVersionSchema = z
  .union([z.literal(1), z.literal(2)])
  .transform(() => 1 as const)

const workbenchProjectGenerationCanvasPayloadSchema = z.object({
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()).default([]),
  selectedNodeIds: z.array(z.string()).default([]),
  groups: z.array(z.unknown()).optional(),
}).passthrough().transform((value) => value as GenerationCanvasSnapshot)

export const workbenchProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  revision: z.number().int().nonnegative().optional(),
  savedAt: z.number().finite().optional(),
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
  // Keep project loading tolerant of legacy v0.5 category ids so the
  // v5→v6 migration can run before the stricter canvas schema is enforced.
  generationCanvas: workbenchProjectGenerationCanvasPayloadSchema,
  categories: z.array(projectCategorySchema).optional(),
})

export const workbenchProjectRecordSchema = workbenchProjectSummarySchema.extend({
  version: workbenchProjectRecordVersionSchema,
  payload: workbenchProjectPayloadSchema,
})

/** 项目来源：原生（默认根新建）/ 外部文件夹（「打开文件夹」绑定）。桌面端由后端按目录位置派生。 */
export type WorkbenchProjectSource = 'native' | 'folder'

export type WorkbenchProjectSummary = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  revision?: number
  savedAt?: number
  thumbStyle?: string
  thumbnail?: string
  thumbnailUrls?: string[]
  /** 仅桌面端有；Web 端无文件夹概念，缺省按 native 处理。 */
  source?: WorkbenchProjectSource
}

export type WorkbenchProjectPayload = {
  workbenchDocument: WorkbenchDocument
  timeline: TimelineState
  generationCanvas: GenerationCanvasSnapshot
  categories?: ProjectCategory[]
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
    categories: cloneBuiltinCategories(),
  }
}

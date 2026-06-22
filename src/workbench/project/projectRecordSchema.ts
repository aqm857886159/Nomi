import { z } from 'zod'

import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import { createDefaultWorkbenchDocument, type WorkbenchDocument } from '../workbenchTypes'
import { createDefaultGenerationCanvasSnapshot } from '../generationCanvas/store/generationCanvasDefaults'
import type { GenerationCanvasSnapshot } from '../generationCanvas/model/generationCanvasTypes'
import { storyboardPlanSchema, type StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
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
  seedKey: z.string().min(1).optional(),
  draft: z.boolean().optional(),
})

export const workbenchProjectPayloadSchema = z.object({
  // 健壮性根因（2026-06-22，真机 elicit走查 打不开）：workbenchDocument / timeline 的校验+默认
  // 本就由下游容错 normalizer（normalizeWorkbenchDocument / normalizeTimeline，吃 undefined/非法
  // 一律回工厂默认）全权负责。此处再用严格 z.object 当硬必填门是冗余且有害的——payload 只缺这两个
  // 可默认字段（画布内容完好）时会 safeParse 失败 → 整个项目硬抛「缺少必要字段」打不开。降为
  // z.unknown().optional()：缺失或 present-but-malformed 都交给 normalizer 降级，不再让项目锁死。
  // generationCanvas（真实画布内容）保持必填——它是关键字段，缺它才走空项目兜底/上报。
  workbenchDocument: z.unknown().optional(),
  timeline: z.unknown().optional(),
  // Keep project loading tolerant of legacy v0.5 category ids so the
  // v5→v6 migration can run before the stricter canvas schema is enforced.
  generationCanvas: workbenchProjectGenerationCanvasPayloadSchema,
  categories: z.array(projectCategorySchema).optional(),
  /** S5-b-1:快照覆盖到事件日志的哪个 seq——hydrate 时重放其后的尾巴(崩溃恢复)。可选,老项目无。 */
  generationCanvasLastSeq: z.number().optional(),
  /**
   * P0-6:创作区分镜方案(用户手改过锚/镜序的结构化产物)。此前是纯内存态,切项目/重载即蒸发。
   * 可选 + nullable 让老项目向后兼容(无此字段即无方案)。
   */
  storyboardPlan: storyboardPlanSchema.nullable().optional(),
  /** 方案落画布状态(草稿/已落画布)。老项目无字段 → 归一化为 false(当草稿)。 */
  storyboardPlanCommitted: z.boolean().optional(),
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
  /**
   * 播种来源的幂等键（如 `example:product-demo`）。「一键示例」等程序化创建入口
   * 用它识别「这个种子已经播过」——名字不是身份，靠名字去重必堆重复项目（审计 A8）。
   * 用户手动新建的项目无此字段。
   */
  seedKey?: string
  /**
   * 草稿态：新建空白零编辑项目的标记。首次真实保存即清除（promote 为持久态）。
   * 启动 GC 只回收带此标记且 revision===0 的 native 空壳 → 库不再堆「未命名」垃圾（审计 P0-3）。
   * example（有 seedKey）/打开文件夹（有 rootPath）/老项目都无此字段，GC 永不碰。
   */
  draft?: boolean
  /** 仅桌面端有；Web 端无文件夹概念，缺省按 native 处理。 */
  source?: WorkbenchProjectSource
  /** 仅桌面端有；项目真实根目录，用于打开 assets / exports 所在文件夹。 */
  rootPath?: string
  /** 仅桌面端有；最近项目指向的文件夹已不存在。 */
  missing?: boolean
}

export type WorkbenchProjectPayload = {
  workbenchDocument: WorkbenchDocument
  timeline: TimelineState
  generationCanvas: GenerationCanvasSnapshot
  categories?: ProjectCategory[]
  /** S5-b-1:快照覆盖到日志的 seq(尾部重放游标);老项目无此字段则跳过重放。 */
  generationCanvasLastSeq?: number
  /** P0-6:创作分镜方案(per-project 工作产物);无则 null/缺省。 */
  storyboardPlan?: StoryboardPlan | null
  /** 方案落画布状态(草稿/已落画布);无则 false。 */
  storyboardPlanCommitted?: boolean
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

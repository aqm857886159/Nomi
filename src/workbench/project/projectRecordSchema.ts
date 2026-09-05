import { z } from 'zod'

import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import {
  createDefaultWorkbenchDocument,
  STORYBOARD_DESIGN_STATUSES,
  type WorkbenchDocument,
} from '../workbenchTypes'
import type { StoryboardDesign } from '../workbenchTypes'
import { createDefaultGenerationCanvasSnapshot } from '../generationCanvas/store/generationCanvasDefaults'
import type { GenerationCanvasSnapshot } from '../generationCanvas/model/generationCanvasTypes'
import { storyboardPlanSchema } from '../generationCanvas/agent/storyboardPlanSchema'
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
  // P2 多文档：workbenchDocuments[]（新）+ activeDocumentId 取代单 workbenchDocument；
  // 单 workbenchDocument 保留只读兼容（老项目迁移用）。
  workbenchDocument: z.unknown().optional(),
  workbenchDocuments: z.array(z.unknown()).optional(),
  activeDocumentId: z.string().optional(),
  timeline: z.unknown().optional(),
  // Keep project loading tolerant of legacy v0.5 category ids so the
  // v5→v6 migration can run before the stricter canvas schema is enforced.
  generationCanvas: workbenchProjectGenerationCanvasPayloadSchema,
  categories: z.array(projectCategorySchema).optional(),
  /** S5-b-1:快照覆盖到事件日志的哪个 seq——hydrate 时重放其后的尾巴(崩溃恢复)。可选,老项目无。 */
  generationCanvasLastSeq: z.number().optional(),
  /** 每篇原稿的分镜设计（唯一持久化 owner）。 */
  storyboardDesignsByDocumentId: z.record(
    z.array(z.object({
      id: z.string().min(1),
      documentId: z.string().min(1),
      title: z.string(),
      plan: storyboardPlanSchema,
      committed: z.boolean(),
      status: z.enum(STORYBOARD_DESIGN_STATUSES),
      sourceDocumentUpdatedAt: z.number().finite(),
      createdAt: z.number().finite(),
      updatedAt: z.number().finite(),
    })),
  ).optional(),
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
  /** 可 `<img>` 渲染的封面（图片结果 / 视频 poster）。thumbnail = thumbnailUrls[0]。 */
  thumbnail?: string
  thumbnailUrls?: string[]
  /**
   * 无任何可 `<img>` 封面时的兜底：首个视频结果 url，项目库卡片用 `<video>` 首帧当封面
   * （纯导入视频素材项目靠它有真封面）。**transient**：list/save 时从画布内容现场派生，
   * 刻意不进持久化 schema——封面 URL 持久化会随环境/会话腐坏（bundle-asset 教训同族）。
   */
  coverVideoUrl?: string
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
  /** P2 多文档：原稿集合（新真相源）。旧项目读侧兼容见 normalizePayload。 */
  workbenchDocuments?: WorkbenchDocument[]
  activeDocumentId?: string
  /** @deprecated 单文档（旧字段，读侧迁移用，写侧不再产出）。 */
  workbenchDocument?: WorkbenchDocument
  timeline: TimelineState
  generationCanvas: GenerationCanvasSnapshot
  categories?: ProjectCategory[]
  /** S5-b-1:快照覆盖到日志的 seq(尾部重放游标);老项目无此字段则跳过重放。 */
  generationCanvasLastSeq?: number
  storyboardDesignsByDocumentId?: Record<string, StoryboardDesign[]>
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
  const doc = createDefaultWorkbenchDocument()
  return {
    workbenchDocuments: [doc],
    activeDocumentId: doc.id,
    timeline: createDefaultTimeline(),
    generationCanvas: createDefaultGenerationCanvasSnapshot(),
    categories: cloneBuiltinCategories(),
  }
}

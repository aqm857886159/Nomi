import { z } from 'zod'
import { quantizeShotSeconds } from './shotTime'

const identitySchema = z.string().trim().min(1)
const viewSchema = z.object({
  selectedRowIds: z.array(identitySchema).refine((ids) => new Set(ids).size === ids.length),
  density: z.enum(['auto', 'full', 'compact', 'card']),
}).strict()
const commonShape = {
  schemaVersion: z.literal(1),
  view: viewSchema,
  revision: z.number().int().nonnegative().safe(),
  updatedAt: z.string().datetime(),
}

export const shotTableColumnSchema = z.object({
  columnId: identitySchema,
  kind: z.enum(['builtin', 'custom']),
  labelKey: identitySchema,
  order: z.number().finite(),
  visible: z.boolean(),
  hint: z.string().optional(),
}).strict()

export const shotTableFactRowSchema = z.object({
  rowId: identitySchema,
  order: z.number().finite(),
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().nonnegative(),
  carriedOver: z.boolean(),
  visionFailed: z.boolean().optional(),
  keyframeRef: z.string().startsWith('nomi-local://').optional(),
  cells: z.record(z.string()),
  imagePrompt: z.string().optional(),
  motionPrompt: z.string().optional(),
}).strict().refine((row) => row.endSeconds >= row.startSeconds, {
  message: 'Fact row end must not precede start',
// Every read and write of a fact row goes through this schema (`readShotTable` /
// `normalizeShotTableMeta` / `deconstructionShotTableSchema.parse`), so quantizing here is what
// normalizes the long-decimal rows already sitting in saved projects — no display-side fallback.
// `durationSeconds` is derived from the quantized ends instead of trusted: it was never a second
// truth, only a cached subtraction.
}).transform((row) => {
  const startSeconds = quantizeShotSeconds(row.startSeconds)
  const endSeconds = quantizeShotSeconds(row.endSeconds)
  return { ...row, startSeconds, endSeconds, durationSeconds: quantizeShotSeconds(endSeconds - startSeconds) }
})

export const storyboardShotTableSchema = z.object({
  ...commonShape,
  source: z.object({
    kind: z.literal('storyboard'),
    documentId: identitySchema,
    designId: identitySchema,
  }).strict(),
  columnSetId: z.literal('production'),
  // A view never owns a cached copy of the storyboard rows.
  rows: z.never().optional(),
}).strict()

export const deconstructionShotTableSchema = z.object({
  ...commonShape,
  source: z.object({
    kind: z.literal('deconstruction'),
    sourceNodeId: identitySchema,
    sourceAssetRef: z.string().startsWith('nomi-local://').optional(),
    title: z.string(),
    durationSeconds: z.number().finite().nonnegative().transform(quantizeShotSeconds).optional(),
    status: z.enum(['idle', 'running', 'ready', 'failed']),
    phase: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    failedShotIndexes: z.array(z.number().int().nonnegative()).optional(),
    errorMessage: z.string().optional(),
    /**
     * 阶段内部那句更细的进度话（「首次使用本地转写，正在下载引擎与模型 120/575 MB」）。
     * 与 `errorMessage` **分开两个字段**：错误是红的、带 role=alert，进度不是——
     * 共用一个字段就等于把每一条进度都渲染成一次失败。
     */
    progressDetail: z.string().optional(),
    /**
     * 这次失败是**哪一类**的机器可读判据。今天只有一个值：`local-speech`（本地离线转写那一路挂了）。
     * 为什么需要它而不是让 UI 去认错误文案：文案会翻译、会改写，拿它当判据就是把
     * 「给不给『改用云端』这个出口」这件事绑在字符串比对上——那正是最容易静默失效的那种判据。
     */
    failureKind: z.literal('local-speech').optional(),
  }).strict(),
  columnSetId: z.literal('facts'),
  columns: z.array(shotTableColumnSchema).refine((columns) => new Set(columns.map((column) => column.columnId)).size === columns.length),
  rows: z.array(shotTableFactRowSchema).refine((rows) => new Set(rows.map((row) => row.rowId)).size === rows.length),
}).strict()

/** Cross-process persistence owner. Storyboard rows remain in the existing design/node owners. */
export const shotTableDocumentSchema = z.union([storyboardShotTableSchema, deconstructionShotTableSchema])
export type StoryboardShotTableDocument = z.infer<typeof storyboardShotTableSchema>
export type DeconstructionShotTableDocument = z.infer<typeof deconstructionShotTableSchema>
export type ShotTableDocument = z.infer<typeof shotTableDocumentSchema>
export type ShotTableColumn = z.infer<typeof shotTableColumnSchema>
export type ShotTableFactRow = z.infer<typeof shotTableFactRowSchema>

export function readShotTable(meta: unknown): ShotTableDocument | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const parsed = shotTableDocumentSchema.safeParse((meta as Record<string, unknown>).shotTable)
  return parsed.success ? parsed.data : undefined
}

/** Snapshot readers fail closed instead of dropping a future or corrupt table. */
export function normalizeShotTableMeta(meta: unknown): Record<string, unknown> {
  const value = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {}
  return { ...value, shotTable: shotTableDocumentSchema.parse(value.shotTable) }
}

export function createStoryboardShotTable(
  documentId: string,
  designId: string,
  updatedAt = new Date().toISOString(),
): StoryboardShotTableDocument {
  return storyboardShotTableSchema.parse({
    schemaVersion: 1,
    source: { kind: 'storyboard', documentId, designId },
    columnSetId: 'production',
    view: { selectedRowIds: [], density: 'auto' },
    revision: 0,
    updatedAt,
  })
}

/**
 * 拆解进度。`phase` 是三大阶段（切点 / 读图 / 对白）；`detail` 是**阶段内部**那句更细的话
 * （「下载引擎与权重 120/575 MB」「转写第 2/6 段」）。
 *
 * 为什么要 detail：云端转写几秒就回来了，一个阶段名够用；本地转写第一次用要先下几百 MB、
 * 之后按段跑几分钟——一条没有进度的几分钟等待在用户那里和「卡死了」长得一模一样。
 * 文案在主进程按用户语言生成（`desktopT`），渲染层原样显示，不在两边各拼一次。
 */
export type DeconstructionProgress = { requestId: string; projectId: string; phase: 0 | 1 | 2; detail?: string }

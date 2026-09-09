import { z } from 'zod'

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
    durationSeconds: z.number().finite().nonnegative().optional(),
    status: z.enum(['idle', 'running', 'ready', 'failed']),
    phase: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    failedShotIndexes: z.array(z.number().int().nonnegative()).optional(),
    errorMessage: z.string().optional(),
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

export type DeconstructionProgress = { requestId: string; projectId: string; phase: 0 | 1 | 2 }

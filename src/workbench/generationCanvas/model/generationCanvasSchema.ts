import { z } from 'zod'
import { CATEGORY_IDS } from './generationCanvasTypes'
import { GENERATION_NODE_KINDS } from './generationNodeKinds'

export const generationNodeKindSchema = z.enum(GENERATION_NODE_KINDS)

export const generationNodeStatusSchema = z.enum(['idle', 'queued', 'running', 'success', 'error', 'recoverable'])
export const generationNodeTaskKindSchema = z.enum(['text', 'image', 'video', 'workflow', 'asset', 'unknown'])
export const generationNodeRunStatusSchema = z.enum(['queued', 'running', 'success', 'error', 'cancelled', 'recoverable'])
export const categoryIdSchema = z.enum(CATEGORY_IDS)

export const generationNodeProgressSchema = z.object({
  runId: z.string().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  phase: z.string().optional(),
  message: z.string().optional(),
  percent: z.number().optional(),
  updatedAt: z.number(),
})

export const generationProvenanceSchema = z.object({
  provider: z.string().optional(),
  modelKey: z.string().optional(),
  modelVersion: z.string().optional(),
  prompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  seed: z.number().optional(),
  params: z.record(z.unknown()).optional(),
  vendorRequestId: z.string().optional(),
  timestamp: z.number(),
  agentRunId: z.string().optional(),
}).strict()

export const generationNodeResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'video', 'text']),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  text: z.string().optional(),
  model: z.string().optional(),
  durationSeconds: z.number().optional(),
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  assetId: z.string().optional(),
  assetRefId: z.string().optional(),
  raw: z.unknown().optional(),
  createdAt: z.number(),
  provenance: generationProvenanceSchema.optional(),
})

export const generationNodeRunRecordSchema = z.object({
  id: z.string().min(1),
  status: generationNodeRunStatusSchema,
  taskId: z.string().optional(),
  taskKind: generationNodeTaskKindSchema.optional(),
  assetId: z.string().optional(),
  assetRefId: z.string().optional(),
  progress: generationNodeProgressSchema.optional(),
  resultId: z.string().optional(),
  error: z.string().optional(),
  raw: z.unknown().optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
  durationSeconds: z.number().optional(),
})

export const generationCanvasNodeSchema = z.object({
  id: z.string().min(1),
  kind: generationNodeKindSchema,
  title: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number(),
    height: z.number(),
  }).optional(),
  prompt: z.string().optional(),
  references: z.array(z.string()).optional(),
  result: generationNodeResultSchema.optional(),
  history: z.array(generationNodeResultSchema).optional(),
  progress: generationNodeProgressSchema.optional(),
  runs: z.array(generationNodeRunRecordSchema).optional(),
  status: generationNodeStatusSchema.optional(),
  error: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  categoryId: categoryIdSchema.optional(),
  groupId: z.string().optional(),
  derivedFrom: z.string().optional(),
  // E.2C-15 新增字段
  regeneratedFrom: z.string().optional(),
  shotIndex: z.number().int().nonnegative().optional(),
  renderKind: z
    .enum(['shot-frame', 'character-card', 'scene-card', 'prop-card', 'audio-strip'])
    .optional(),
  // Phase C5: Tiptap document body for inline-editable text nodes. passthrough so
  // unknown marks/attrs survive; optional so legacy nodes without it still parse.
  contentJson: z.object({ type: z.literal('doc') }).passthrough().optional(),
})

export const nodeGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  categoryId: categoryIdSchema,
  nodeIds: z.array(z.string()),
  color: z.string().optional(),
  frameBounds: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }).optional(),
  collapsed: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const generationCanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  mode: z.enum([
    'reference',
    'first_frame',
    'last_frame',
    'style_ref',
    'character_ref',
    'composition_ref',
  ]).optional(),
  // 落入同一 target 的放入顺序（数组参考 character1..N 的真相源；旧快照无 → undefined，排序退化为原序）。
  order: z.number().optional(),
})

export const generationCanvasSnapshotSchema = z.object({
  nodes: z.array(generationCanvasNodeSchema),
  edges: z.array(generationCanvasEdgeSchema),
  selectedNodeIds: z.array(z.string()),
  groups: z.array(nodeGroupSchema).default([]),
})

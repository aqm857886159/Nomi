import { z } from 'zod'

export const generationNodeKindSchema = z.enum([
  'text',
  'character',
  'scene',
  'image',
  'keyframe',
  'video',
  'shot',
  'output',
])

export const generationNodeStatusSchema = z.enum(['idle', 'queued', 'running', 'success', 'error'])

export const generationNodeResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['image', 'video', 'text']),
  url: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  text: z.string().optional(),
  model: z.string().optional(),
  createdAt: z.number(),
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
  status: generationNodeStatusSchema.optional(),
  error: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
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
})

export const generationCanvasSnapshotSchema = z.object({
  nodes: z.array(generationCanvasNodeSchema),
  edges: z.array(generationCanvasEdgeSchema),
  selectedNodeIds: z.array(z.string()),
})

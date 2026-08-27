import { z } from 'zod'

const nonNegativeFrame = z.number().int().safe().nonnegative()
const integerFrame = z.number().int().safe()

const moveOperation = z.object({
  kind: z.literal('move'),
  clipId: z.string().trim().min(1),
  startFrame: nonNegativeFrame,
  targetTrackId: z.string().trim().min(1).optional(),
})

const removeOperation = z.object({
  kind: z.literal('remove'),
  clipId: z.string().trim().min(1).optional(),
  clipIds: z.array(z.string().trim().min(1)).min(1).optional(),
  ripple: z.boolean().optional().describe('When true, ripple only the single track containing the removed clips; it never shifts other media or text tracks.'),
}).refine((value) => Boolean(value.clipId || value.clipIds?.length), {
  message: 'remove requires clipId or clipIds',
})

const splitOperation = z.object({
  kind: z.literal('split'),
  clipId: z.string().trim().min(1),
  atFrame: nonNegativeFrame,
  rightClipId: z.string().trim().min(1).optional(),
})

const trimOperation = z.object({
  kind: z.literal('trim'),
  clipId: z.string().trim().min(1),
  edge: z.enum(['left', 'right']),
  deltaFrame: integerFrame,
})

const sourceWindowOperation = z.object({
  kind: z.literal('source-window'),
  clipId: z.string().trim().min(1),
  sourceStartFrame: nonNegativeFrame,
  sourceEndFrame: nonNegativeFrame,
})

const rippleOperation = z.object({
  kind: z.literal('ripple'),
  fromFrame: nonNegativeFrame,
  deltaFrame: integerFrame,
  trackId: z.string().trim().min(1).optional(),
  includeText: z.boolean().optional(),
})

export const timelineOperationSchema = z.union([
  moveOperation,
  removeOperation,
  splitOperation,
  trimOperation,
  sourceWindowOperation,
  rippleOperation,
])

export const timelineEditPlanSchema = z.object({
  planId: z.string().trim().min(1).max(120),
  baseRevision: z.string().trim().min(1).max(64),
  summary: z.string().trim().min(1).max(500),
  operations: z.array(timelineOperationSchema).min(1).max(128),
})

export type TimelineEditPlanInput = z.infer<typeof timelineEditPlanSchema>
export type TimelineOperationInput = z.infer<typeof timelineOperationSchema>

const rangeSchema = z.object({
  startFrame: nonNegativeFrame,
  endFrame: nonNegativeFrame,
}).refine((value) => value.endFrame > value.startFrame, {
  message: 'endFrame must be greater than startFrame',
})

export const timelineToolDescriptors = {
  read_timeline: {
    name: 'read_timeline',
    description: 'Read the canonical Nomi timeline. Returns tracks, clip ids, visible/source windows, text overlays, transitions, duration, and a stable revision. Read-only.',
    parameters: z.object({}),
  },
  inspect_timeline_range: {
    name: 'inspect_timeline_range',
    description: 'Inspect only the clips and text overlays intersecting a frame range. Use this before planning a local edit. Read-only.',
    parameters: rangeSchema,
  },
  propose_edit_plan: {
    name: 'propose_edit_plan',
    description: 'Validate and preview an atomic timeline EditPlan without changing the project. Always read the current revision first and include it as baseRevision.',
    parameters: timelineEditPlanSchema,
  },
  apply_edit_plan: {
    name: 'apply_edit_plan',
    description: 'Apply a previously validated atomic EditPlan after user approval. The baseRevision is compare-and-swap guarded; stale plans are rejected. One plan creates one undo entry.',
    parameters: timelineEditPlanSchema,
  },
  undo_timeline_edit: {
    name: 'undo_timeline_edit',
    description: 'Undo the most recent Agent-applied timeline plan as one user-visible action. Use the undoToken and expectedRevision returned by apply_edit_plan; stale or non-Agent edits are rejected. Requires user approval and never touches canvas nodes.',
    parameters: z.object({
      undoToken: z.string().trim().min(1).max(160),
      expectedRevision: z.string().trim().min(1).max(64),
      reason: z.string().trim().max(300).optional(),
    }),
  },
} as const

export type TimelineToolName = keyof typeof timelineToolDescriptors
export const timelineToolNames = Object.keys(timelineToolDescriptors) as TimelineToolName[]

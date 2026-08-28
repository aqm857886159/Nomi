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

const assetIdSchema = z.string().trim().min(1).max(240)
const mediaKindSchema = z.enum(['image', 'video', 'audio'])
const exportJobIdSchema = z.string().trim().min(1).max(160)

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
  get_media: {
    name: 'get_media',
    description: 'Read one active-project media record by stable asset id. Returns allowlisted metadata only and never returns a local URL, relative path, or absolute path. Read-only.',
    parameters: z.object({ assetId: assetIdSchema }),
  },
  inspect_media: {
    name: 'inspect_media',
    description: 'Inspect technical metadata for one active-project media asset, such as duration, dimensions, frame rate, codecs, and audio presence when known. This does not claim visual understanding or transcription. Read-only.',
    parameters: z.object({ assetId: assetIdSchema }),
  },
  search_media: {
    name: 'search_media',
    description: 'Search active-project media by name and optional media kinds. Returns stable asset ids and allowlisted metadata without local paths. Use the returned id with inspect_media, inspect_source_range, or read_waveform. Read-only.',
    parameters: z.object({
      query: z.string().trim().max(200).optional(),
      kinds: z.array(mediaKindSchema).max(3).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  },
  inspect_source_range: {
    name: 'inspect_source_range',
    description: 'Validate a source-frame range for an active-project asset and report timeline clips that use the range. Frames use the current timeline FPS. This is structural inspection, not semantic vision analysis. Read-only.',
    parameters: z.object({
      assetId: assetIdSchema,
      startFrame: nonNegativeFrame,
      endFrame: nonNegativeFrame,
    }).refine((value) => value.endFrame > value.startFrame, { message: 'endFrame must be greater than startFrame' }),
  },
  read_waveform: {
    name: 'read_waveform',
    description: 'Decode an active-project audio or video asset locally and return bounded waveform peak/RMS buckets for a time range. Media bytes and local paths are never sent to the model. Read-only; decode failures are explicit.',
    parameters: z.object({
      assetId: assetIdSchema,
      startSeconds: z.number().finite().nonnegative().optional(),
      endSeconds: z.number().finite().positive().optional(),
      buckets: z.number().int().min(1).max(256).optional(),
    }).refine((value) => value.endSeconds === undefined || value.endSeconds > (value.startSeconds ?? 0), {
      message: 'endSeconds must be greater than startSeconds',
    }),
  },
  export_timeline: {
    name: 'export_timeline',
    description: 'Start a production MP4 export of the current timeline after explicit user approval. Requires the exact revision from read_timeline, uses the existing Nomi export pipeline, and returns a cancellable job id for later inspection.',
    parameters: z.object({
      expectedRevision: z.string().trim().min(1).max(64),
      outputName: z.string().trim().min(1).max(120).optional(),
      aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5', '3:4', '4:3', '21:9']).optional(),
      resolution: z.enum(['720p', '1080p']).optional(),
      quality: z.enum(['small', 'standard', 'high']).optional(),
    }),
  },
  inspect_export_job: {
    name: 'inspect_export_job',
    description: 'Read progress, terminal status, warning count, and a path-free output receipt for one export job in the active project. Read-only.',
    parameters: z.object({ jobId: exportJobIdSchema }),
  },
  verify_render: {
    name: 'verify_render',
    description: 'Verify that an active-project export job completed with a non-empty persisted output receipt. This is receipt-level verification and explicitly does not claim decoded-frame, audio, or visual-quality inspection. Read-only.',
    parameters: z.object({ jobId: exportJobIdSchema }),
  },
  cancel_export_job: {
    name: 'cancel_export_job',
    description: 'Cancel an active export job in the current project after explicit user approval. Refuses a job that is already completed, failed, or cancelled when inspected.',
    parameters: z.object({ jobId: exportJobIdSchema }),
  },
} as const

export type TimelineToolName = keyof typeof timelineToolDescriptors
export const timelineToolNames = Object.keys(timelineToolDescriptors) as TimelineToolName[]

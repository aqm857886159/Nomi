import { z } from 'zod'
import {
  TIMELINE_READ_CAPABILITY,
  timelineReadPiDescriptionForAlias,
  timelineReadPiInputSchemaForAlias,
} from '../../shared/agentCapabilities/timelineRead'
import {
  TIMELINE_WRITE_CAPABILITY,
  timelineWritePiDescriptionForAlias,
  timelineWritePiInputSchemaForAlias,
} from '../../shared/agentCapabilities/timelineWrite'
import { capabilityAliasesFor, capabilityOperationAliasesFor } from '../../shared/agentCapabilities/registry'

export { timelineEditPlanSchema, timelineOperationSchema } from '../../shared/agentCapabilities/timelineRead'

const nonNegativeFrame = z.number().int().safe().nonnegative()

type TimelineDescriptor = Readonly<{ name: string; description: string; parameters: z.ZodTypeAny }>

function registryDescriptors(
  capability: typeof TIMELINE_READ_CAPABILITY | typeof TIMELINE_WRITE_CAPABILITY,
  descriptionForAlias: (alias: string) => string | undefined,
  schemaForAlias: (alias: string) => z.ZodTypeAny | undefined,
): Record<string, TimelineDescriptor> {
  const aliases = [
    ...capabilityAliasesFor(capability.id, 'pi'),
    ...capabilityOperationAliasesFor(capability.id, 'pi'),
  ]
  return Object.fromEntries(aliases.map((alias) => [alias, {
    name: alias,
    description: descriptionForAlias(alias) ?? capability.projections.pi.description,
    parameters: schemaForAlias(alias) ?? z.never(),
  }]))
}

const timelineCapabilityToolDescriptors = {
  ...registryDescriptors(
    TIMELINE_READ_CAPABILITY,
    timelineReadPiDescriptionForAlias,
    timelineReadPiInputSchemaForAlias,
  ),
  ...registryDescriptors(
    TIMELINE_WRITE_CAPABILITY,
    timelineWritePiDescriptionForAlias,
    timelineWritePiInputSchemaForAlias,
  ),
}

const assetIdSchema = z.string().trim().min(1).max(240)
const mediaKindSchema = z.enum(['image', 'video', 'audio'])
const exportJobIdSchema = z.string().trim().min(1).max(160)

export const timelineToolDescriptors = {
  ...timelineCapabilityToolDescriptors,
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
    description: 'Start a production MP4 export of the current timeline after explicit user approval. Requires the exact canonical Timeline revision, uses the existing Nomi export pipeline, and returns a cancellable job id for later inspection.',
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

import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

const assetIdSchema = z.string().trim().min(1).max(512);
const boundedTextSchema = z.string().max(4_096);
const mediaKindSchema = z.enum(["image", "video", "audio"]);
const nonNegativeIntegerSchema = z.number().int().safe().nonnegative();
const positiveIntegerSchema = z.number().int().safe().positive();
const positiveNumberSchema = z.number().finite().positive();

const getMediaPiInputSchema = z.object({ assetId: assetIdSchema }).strict();
const inspectMediaPiInputSchema = getMediaPiInputSchema;
const searchMediaPiInputSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    kinds: z.array(mediaKindSchema).max(3).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const inspectSourceRangeFields = {
  assetId: assetIdSchema,
  startFrame: nonNegativeIntegerSchema,
  endFrame: positiveIntegerSchema,
} as const;
const inspectSourceRangePiInputSchema = z
  .object(inspectSourceRangeFields)
  .strict()
  .refine((value) => value.endFrame > value.startFrame, {
    message: "endFrame must be greater than startFrame",
  });
const readWaveformFields = {
  assetId: assetIdSchema,
  startSeconds: z.number().finite().nonnegative().optional(),
  endSeconds: positiveNumberSchema.optional(),
  buckets: z.number().int().min(1).max(256).optional(),
} as const;
const readWaveformPiInputSchema = z
  .object(readWaveformFields)
  .strict()
  .refine((value) => value.endSeconds === undefined || value.endSeconds > (value.startSeconds ?? 0), {
    message: "endSeconds must be greater than startSeconds",
  });

export const assetReadSemanticInputSchema = z.union([
  getMediaPiInputSchema.extend({ operation: z.literal("get_media") }),
  inspectMediaPiInputSchema.extend({ operation: z.literal("inspect_media") }),
  searchMediaPiInputSchema.extend({ operation: z.literal("search_media") }),
  z
    .object({ operation: z.literal("inspect_source_range"), ...inspectSourceRangeFields })
    .strict()
    .refine((value) => value.endFrame > value.startFrame, {
      message: "endFrame must be greater than startFrame",
    }),
  z
    .object({ operation: z.literal("read_waveform"), ...readWaveformFields })
    .strict()
    .refine((value) => value.endSeconds === undefined || value.endSeconds > (value.startSeconds ?? 0), {
      message: "endSeconds must be greater than startSeconds",
    }),
]);

export type AssetReadInput = z.infer<typeof assetReadSemanticInputSchema>;

const projectedMediaSchema = z
  .object({
    id: assetIdSchema,
    name: boundedTextSchema,
    kind: mediaKindSchema,
    createdAt: z.string().max(64),
    updatedAt: z.string().max(64),
    contentType: z.string().max(256).optional(),
    sizeBytes: nonNegativeIntegerSchema.optional(),
    ownerNodeId: assetIdSchema.optional(),
  })
  .strict();

const technicalMetadataSchema = z
  .object({
    durationSeconds: positiveNumberSchema.optional(),
    width: positiveIntegerSchema.optional(),
    height: positiveIntegerSchema.optional(),
    fps: positiveNumberSchema.optional(),
    videoCodec: z.string().max(128).optional(),
    audioCodec: z.string().max(128).optional(),
    hasAudio: z.boolean().optional(),
    sampleRate: positiveIntegerSchema.optional(),
    channels: positiveIntegerSchema.optional(),
  })
  .strict();

const sourceUsageSchema = z
  .object({
    clipId: assetIdSchema,
    trackId: assetIdSchema,
    timelineRange: z.object({ startFrame: nonNegativeIntegerSchema, endFrame: positiveIntegerSchema }).strict(),
    sourceWindow: z.object({ startFrame: nonNegativeIntegerSchema, endFrame: positiveIntegerSchema }).strict(),
  })
  .strict();

const waveformBucketSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: positiveNumberSchema,
    peak: z.number().finite().min(0).max(1),
    rms: z.number().finite().min(0).max(1),
  })
  .strict();

export const ASSET_SOURCE_USAGE_LIMIT = 4_096;

export const assetReadResultSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("get_media"), media: projectedMediaSchema }).strict(),
  z
    .object({
      operation: z.literal("inspect_media"),
      media: projectedMediaSchema,
      technical: technicalMetadataSchema,
      semanticInspection: z.literal("not_performed"),
    })
    .strict(),
  z
    .object({
      operation: z.literal("search_media"),
      query: z.string().max(200),
      total: nonNegativeIntegerSchema,
      truncated: z.boolean(),
      media: z.array(projectedMediaSchema).max(100),
    })
    .strict(),
  z
    .object({
      operation: z.literal("inspect_source_range"),
      assetId: assetIdSchema,
      timelineFps: positiveNumberSchema,
      sourceRange: z.object({ startFrame: nonNegativeIntegerSchema, endFrame: positiveIntegerSchema }).strict(),
      valid: z.boolean(),
      knownSourceFrames: positiveIntegerSchema.optional(),
      totalUsageCount: nonNegativeIntegerSchema,
      truncated: z.boolean(),
      usages: z.array(sourceUsageSchema).max(ASSET_SOURCE_USAGE_LIMIT),
      semanticInspection: z.literal("not_performed"),
    })
    .strict(),
  z
    .object({
      operation: z.literal("read_waveform"),
      assetId: assetIdSchema,
      durationSeconds: positiveNumberSchema,
      sampleRate: positiveIntegerSchema,
      channels: positiveIntegerSchema,
      startSeconds: z.number().finite().nonnegative(),
      endSeconds: positiveNumberSchema,
      buckets: z.array(waveformBucketSchema).max(256),
    })
    .strict(),
]);

export type AssetReadResult = z.infer<typeof assetReadResultSchema>;

export function projectAssetReadResult(source: unknown, operation: AssetReadInput["operation"]): AssetReadResult {
  const result = assetReadResultSchema.parse(source);
  if (result.operation !== operation) throw new Error("asset operation mismatch");
  return result;
}

export const ASSET_READ_ALIASES = Object.freeze({
  get: "get_media",
  inspect: "inspect_media",
  search: "search_media",
  inspectRange: "inspect_source_range",
  waveform: "read_waveform",
});

export function assetReadPiInputSchemaForAlias(alias: string): z.ZodTypeAny | undefined {
  switch (alias) {
    case ASSET_READ_ALIASES.get:
      return getMediaPiInputSchema;
    case ASSET_READ_ALIASES.inspect:
      return inspectMediaPiInputSchema;
    case ASSET_READ_ALIASES.search:
      return searchMediaPiInputSchema;
    case ASSET_READ_ALIASES.inspectRange:
      return inspectSourceRangePiInputSchema;
    case ASSET_READ_ALIASES.waveform:
      return readWaveformPiInputSchema;
    default:
      return undefined;
  }
}

export function assetReadInputForAlias(alias: string, value: unknown): AssetReadInput | undefined {
  const schema = assetReadPiInputSchemaForAlias(alias);
  if (!schema) return undefined;
  return assetReadSemanticInputSchema.parse({ operation: alias, ...schema.parse(value) });
}

export function assetReadPiDescriptionForAlias(alias: string): string | undefined {
  switch (alias) {
    case ASSET_READ_ALIASES.get:
      return "Read one active-project media record by stable asset id without returning any path or URL.";
    case ASSET_READ_ALIASES.inspect:
      return "Inspect bounded technical metadata without claiming semantic visual or audio understanding.";
    case ASSET_READ_ALIASES.search:
      return "Search active-project media and return bounded path-free records.";
    case ASSET_READ_ALIASES.inspectRange:
      return "Validate one source-frame range and list its bounded structural timeline usages.";
    case ASSET_READ_ALIASES.waveform:
      return "Read bounded peak and RMS waveform buckets without exposing media bytes or local paths.";
    default:
      return undefined;
  }
}

export const ASSET_READ_CAPABILITY = {
  id: "asset.read",
  version: 1,
  aliases: { pi: ASSET_READ_ALIASES.get, mcp: "nomi_media_query" },
  additionalAliases: {
    pi: Object.freeze([
      ASSET_READ_ALIASES.inspect,
      ASSET_READ_ALIASES.search,
      ASSET_READ_ALIASES.inspectRange,
      ASSET_READ_ALIASES.waveform,
    ]),
  },
  inputSchema: assetReadSemanticInputSchema,
  outputSchema: assetReadResultSchema,
  effect: "read",
  execution: { port: "asset", availability: "renderer_required" },
  exposure: "mcp_safe",
  requiredScope: "asset:read",
  targetKind: "asset",
  approval: "none",
  projections: {
    pi: { description: "Read bounded technical facts about active-project media." },
    mcp: { description: "Query project media, metadata, source usage, or waveform data without changing the project." },
  },
} as const satisfies CapabilityContract<AssetReadInput, AssetReadResult>;

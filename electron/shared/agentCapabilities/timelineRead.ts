import { z } from "zod";
import { flattenDiscriminatedUnion } from "./flatModelInput";

import type { CapabilityContract } from "./capabilityContract";

const canonicalIdSchema = z.string().trim().min(1);
const revisionSchema = canonicalIdSchema.max(64);
const nonNegativeFrameSchema = z.number().int().safe().nonnegative();
const positiveFrameSchema = z.number().int().safe().positive();
const integerFrameSchema = z.number().int().safe();

const moveOperationSchema = z
  .object({
    kind: z.literal("move"),
    clipId: canonicalIdSchema,
    startFrame: nonNegativeFrameSchema,
    targetTrackId: canonicalIdSchema.optional(),
  })
  .strict();

const removeOperationSchema = z
  .object({
    kind: z.literal("remove"),
    clipId: canonicalIdSchema.optional(),
    clipIds: z.array(canonicalIdSchema).min(1).optional(),
    ripple: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.clipId || value.clipIds?.length), {
    message: "remove requires clipId or clipIds",
  });

const splitOperationSchema = z
  .object({
    kind: z.literal("split"),
    clipId: canonicalIdSchema,
    atFrame: nonNegativeFrameSchema,
    rightClipId: canonicalIdSchema.optional(),
  })
  .strict();

const trimOperationSchema = z
  .object({
    kind: z.literal("trim"),
    clipId: canonicalIdSchema,
    edge: z.enum(["left", "right"]),
    deltaFrame: integerFrameSchema,
  })
  .strict();

const sourceWindowOperationSchema = z
  .object({
    kind: z.literal("source-window"),
    clipId: canonicalIdSchema,
    sourceStartFrame: nonNegativeFrameSchema,
    sourceEndFrame: nonNegativeFrameSchema,
  })
  .strict();

const rippleOperationSchema = z
  .object({
    kind: z.literal("ripple"),
    fromFrame: nonNegativeFrameSchema,
    deltaFrame: integerFrameSchema,
    trackId: canonicalIdSchema.optional(),
    includeText: z.boolean().optional(),
  })
  .strict();

const transitionOperationSchema = z
  .object({
    kind: z.literal("transition"),
    action: z.enum(["set", "remove"]),
    fromClipId: canonicalIdSchema,
    toClipId: canonicalIdSchema,
    type: z.enum(["cut", "dissolve", "fade", "match_cut", "whip_pan"]).optional(),
    durationFrames: z.number().int().safe().positive().optional(),
  })
  .strict()
  .refine((value) => value.action === "remove" || value.type !== undefined, {
    message: "transition set requires type",
    path: ["type"],
  })
  .refine((value) => value.action !== "remove" || value.type === undefined && value.durationFrames === undefined, {
    message: "transition remove only accepts endpoints",
    path: ["action"],
  });

const textOperationSchema = z.object({
  kind: z.literal("text"), action: z.enum(["add", "edit", "style", "time"]),
  id: canonicalIdSchema.optional(), clipId: canonicalIdSchema.optional(), sourceNodeId: canonicalIdSchema.optional(),
  text: z.string().trim().min(1).optional(), style: z.enum(["caption", "title"]).optional(),
  startFrame: nonNegativeFrameSchema.optional(), endFrame: nonNegativeFrameSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "add" && (!value.id || !value.text || !value.style || value.startFrame === undefined || value.endFrame === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "text add requires id, text, style, startFrame, endFrame" });
  if (value.action !== "add" && !value.clipId) context.addIssue({ code: z.ZodIssueCode.custom, message: "text edit/style/time requires clipId" });
  if (value.action === "edit" && !value.text) context.addIssue({ code: z.ZodIssueCode.custom, message: "text edit requires text" });
  if (value.action === "style" && !value.style) context.addIssue({ code: z.ZodIssueCode.custom, message: "text style requires style" });
  if (value.action === "time" && (value.startFrame === undefined || value.endFrame === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "text time requires startFrame and endFrame" });
});

const clipAudioOperationSchema = z
  .object({
    kind: z.literal("clip-audio"),
    clipId: canonicalIdSchema,
    /**
     * Patch: omitted fields keep the clip's current value. Gain range and fade bounds are owned by
     * the timeline kernel (clip_audio_gain_invalid / clip_audio_fade_*) so the limits live in one place.
     */
    audio: z
      .object({
        gainDb: z.number().finite().optional(),
        muted: z.boolean().optional(),
        fadeInFrames: nonNegativeFrameSchema.optional(),
        fadeOutFrames: nonNegativeFrameSchema.optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: "audio patch requires at least one field",
      }),
  })
  .strict();

export const timelineOperationSchema = z.union([
  moveOperationSchema,
  removeOperationSchema,
  splitOperationSchema,
  trimOperationSchema,
  sourceWindowOperationSchema,
  rippleOperationSchema,
  transitionOperationSchema,
  textOperationSchema,
  clipAudioOperationSchema,
]);

export const timelineEditPlanSchema = z
  .object({
    planId: canonicalIdSchema.max(120),
    baseRevision: revisionSchema,
    summary: canonicalIdSchema.max(500),
    operations: z.array(timelineOperationSchema).min(1).max(128),
  })
  .strict();

/** Preserve the canonical array bounds while publishing object-shaped operations. */
export const timelineEditPlanModelSchema = timelineEditPlanSchema.extend({
  operations: new z.ZodArray({ ...timelineEditPlanSchema.shape.operations._def,
    type: flattenDiscriminatedUnion(timelineOperationSchema, { name: "timeline operation", mergeEnumFields: ["action"] }) }),
});

const timelineRangeFields = {
  startFrame: nonNegativeFrameSchema,
  // `endFrame > startFrame ≥ 0` ⇒ endFrame 至少是 1。把它写进**类型**而不是只写进下面的
  // refine，是因为 refine 到不了模型可见 schema：模型读到的只有 `minimum: 0`，于是
  // `{startFrame:0, endFrame:0}` 在它看来完全合法，要撞一次执行边界才知道不行。
  // 阶段 5a 之前对外那份手抄的传输 schema 恰恰写对了这条（`endFrame: {minimum: 1}`），
  // 而内部那份没有——同源要求两边一致，那就取更准的那一版，两边一起变准。
  endFrame: positiveFrameSchema,
} as const;
const timelineRangeSchema = z
  .object(timelineRangeFields)
  .strict()
  .refine((value) => value.endFrame > value.startFrame, {
    message: "endFrame must be greater than startFrame",
  });

const readTimelineInputSchema = z.object({ operation: z.literal("read_timeline") }).strict();
const inspectTimelineRangeInputSchema = z
  .object({ operation: z.literal("inspect_timeline_range"), ...timelineRangeFields })
  .strict()
  .refine((value) => value.endFrame > value.startFrame, {
    message: "endFrame must be greater than startFrame",
  });
const proposeEditPlanInputSchema = timelineEditPlanSchema.extend({
  operation: z.literal("propose_edit_plan"),
});

export const timelineReadSemanticInputSchema = z.union([
  readTimelineInputSchema,
  inspectTimelineRangeInputSchema,
  proposeEditPlanInputSchema,
]);

export type TimelineOperationInput = z.infer<typeof timelineOperationSchema>;
export type TimelineEditPlanInput = z.infer<typeof timelineEditPlanSchema>;
export type TimelineReadInput = z.infer<typeof timelineReadSemanticInputSchema>;

const timelineDiagnosticSchema = z
  .object({
    code: canonicalIdSchema.max(120),
    severity: z.enum(["error", "warning"]),
    path: z.string().max(500),
    message: z.string().max(1_000),
    operationIndex: z.number().int().safe().nonnegative().optional(),
  })
  .strict();

const timelineDiffEntrySchema = z
  .object({
    path: z.string().max(500),
    change: z.enum(["added", "removed", "changed"]),
  })
  .strict();

export const TIMELINE_DIFF_ENTRY_LIMIT = 4_096;

export const timelineDiffResultSchema = z
  .object({
    changed: z.boolean(),
    totalEntryCount: z.number().int().safe().nonnegative(),
    truncated: z.boolean(),
    entries: z.array(timelineDiffEntrySchema).max(TIMELINE_DIFF_ENTRY_LIMIT),
  })
  .strict();

const sourceWindowSchema = z
  .object({ startFrame: nonNegativeFrameSchema, endFrame: nonNegativeFrameSchema })
  .strict()
  .nullable();
const projectedClipAudioSchema = z.object({
  gainDb: z.number().finite(),
  muted: z.boolean(),
  fadeInFrames: nonNegativeFrameSchema,
  fadeOutFrames: nonNegativeFrameSchema,
}).strict();
const projectedClipSchema = z
  .object({
    id: canonicalIdSchema,
    type: z.enum(["image", "video", "audio"]),
    trackId: canonicalIdSchema,
    sourceNodeId: canonicalIdSchema,
    label: z.string(),
    startFrame: nonNegativeFrameSchema,
    endFrame: nonNegativeFrameSchema,
    durationFrames: nonNegativeFrameSchema,
    sourceWindow: sourceWindowSchema,
    audio: projectedClipAudioSchema.optional(),
    text: z.string().optional(),
    sourceAvailable: z.boolean(),
  })
  .strict();
const projectedTrackSchema = z
  .object({
    id: canonicalIdSchema,
    type: z.enum(["image", "video", "audio"]),
    label: z.string().optional(),
    clips: z.array(projectedClipSchema),
  })
  .strict();
const projectedTextClipSchema = z
  .object({
    id: canonicalIdSchema,
    sourceNodeId: canonicalIdSchema.optional(),
    text: z.string(),
    style: z.enum(["caption", "title"]),
    startFrame: nonNegativeFrameSchema,
    endFrame: nonNegativeFrameSchema,
  })
  .strict();
const projectedTransitionSchema = z
  .object({
    fromClipId: canonicalIdSchema,
    toClipId: canonicalIdSchema,
    type: z.enum(["cut", "dissolve", "fade", "match_cut", "whip_pan"]),
    durationFrames: z.number().int().safe().positive().optional(),
  })
  .strict();
const projectedTimelineFields = {
  revision: revisionSchema,
  fps: z.number().finite().positive(),
  scale: z.number().finite().positive(),
  playheadFrame: nonNegativeFrameSchema,
  durationFrames: nonNegativeFrameSchema,
  valid: z.boolean(),
  diagnostics: z.array(timelineDiagnosticSchema).optional(),
  tracks: z.array(projectedTrackSchema),
  textClips: z.array(projectedTextClipSchema),
  transitions: z.array(projectedTransitionSchema),
} as const;

export const projectedTimelineSchema = z.object(projectedTimelineFields).strict();

export const timelineReadResultSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("read_timeline"), ...projectedTimelineFields }).strict(),
  z
    .object({
      operation: z.literal("inspect_timeline_range"),
      revision: revisionSchema,
      startFrame: nonNegativeFrameSchema,
      endFrame: nonNegativeFrameSchema,
      tracks: z.array(projectedTrackSchema),
      textClips: z.array(projectedTextClipSchema),
    })
    .strict(),
  z
    .object({
      operation: z.literal("propose_edit_plan"),
      planId: canonicalIdSchema.max(120),
      summary: canonicalIdSchema.max(500),
      ok: z.boolean(),
      validateOnly: z.literal(true),
      baseRevision: revisionSchema,
      revision: revisionSchema,
      appliedOperationCount: z.number().int().safe().nonnegative(),
      diagnostics: z.array(timelineDiagnosticSchema),
      diff: timelineDiffResultSchema,
      preview: projectedTimelineSchema.optional(),
    })
    .strict(),
]);

export type TimelineReadResult = z.infer<typeof timelineReadResultSchema>;

export function projectTimelineReadResult(
  source: unknown,
  expectedOperation: TimelineReadInput["operation"],
): TimelineReadResult {
  const result = timelineReadResultSchema.parse(source);
  if (result.operation !== expectedOperation) throw new Error("timeline operation mismatch");
  return result;
}

export const TIMELINE_READ_ALIASES = Object.freeze({
  read: "read_timeline",
  inspectRange: "inspect_timeline_range",
  proposePlan: "propose_edit_plan",
});

const readTimelinePiInputSchema = z.object({}).strict();

export function timelineReadPiInputSchemaForAlias(alias: string): z.ZodTypeAny | undefined {
  switch (alias) {
    case TIMELINE_READ_ALIASES.read:
      return readTimelinePiInputSchema;
    case TIMELINE_READ_ALIASES.inspectRange:
      return timelineRangeSchema;
    case TIMELINE_READ_ALIASES.proposePlan:
      return timelineEditPlanSchema;
    default:
      return undefined;
  }
}

export function timelineReadInputForAlias(alias: string, value: unknown): TimelineReadInput | undefined {
  const schema = timelineReadPiInputSchemaForAlias(alias);
  if (!schema) return undefined;
  return timelineReadSemanticInputSchema.parse({ operation: alias, ...schema.parse(value) });
}


export const TIMELINE_READ_CAPABILITY = {
  id: "timeline.read",
  version: 1,
  aliases: { pi: TIMELINE_READ_ALIASES.read, mcp: "nomi_timeline_read" },
  additionalAliases: {
    pi: Object.freeze([TIMELINE_READ_ALIASES.inspectRange, TIMELINE_READ_ALIASES.proposePlan]),
  },
  inputSchema: timelineReadSemanticInputSchema,
  outputSchema: timelineReadResultSchema,
  effect: "read",
  effectClass: "reversible_local",
  execution: { port: "timeline", availability: "renderer_required" },
  exposure: "mcp_safe",
  requiredScope: "timeline:read",
  targetKind: "timeline",
} as const satisfies CapabilityContract<TimelineReadInput, TimelineReadResult>;

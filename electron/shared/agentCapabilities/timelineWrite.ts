import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";
import { timelineDiffResultSchema, timelineEditPlanSchema } from "./timelineRead";

const canonicalIdSchema = z.string().trim().min(1);
const revisionSchema = canonicalIdSchema.max(64);
const applyEditPlanInputSchema = timelineEditPlanSchema.extend({ operation: z.literal("apply_edit_plan") });
const undoTimelineEditPiInputSchema = z
  .object({
    undoToken: canonicalIdSchema.max(160),
    expectedRevision: revisionSchema,
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
const undoTimelineEditInputSchema = undoTimelineEditPiInputSchema.extend({
  operation: z.literal("undo_timeline_edit"),
});

export const timelineWriteSemanticInputSchema = z.union([
  applyEditPlanInputSchema,
  undoTimelineEditInputSchema,
]);

const timelineDiagnosticSchema = z
  .object({
    code: canonicalIdSchema.max(120),
    severity: z.enum(["error", "warning"]),
    path: z.string().max(500),
    message: z.string().max(1_000),
    operationIndex: z.number().int().safe().nonnegative().optional(),
  })
  .strict();

export const timelineWriteResultSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("apply_edit_plan"),
      ok: z.boolean(),
      revision: revisionSchema,
      code: canonicalIdSchema.max(120).optional(),
      planId: canonicalIdSchema.max(120).optional(),
      summary: z.string().max(500).optional(),
      applied: z.boolean().optional(),
      replayed: z.boolean().optional(),
      validateOnly: z.boolean().optional(),
      baseRevision: revisionSchema.optional(),
      appliedOperationCount: z.number().int().safe().nonnegative().optional(),
      diagnostics: z.array(timelineDiagnosticSchema).optional(),
      diff: timelineDiffResultSchema.optional(),
      undoToken: canonicalIdSchema.max(160).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("undo_timeline_edit"),
      ok: z.boolean(),
      revision: revisionSchema,
      code: canonicalIdSchema.max(120).optional(),
      undone: z.boolean(),
    })
    .strict(),
]);

export type TimelineWriteInput = z.infer<typeof timelineWriteSemanticInputSchema>;
export type TimelineWriteResult = z.infer<typeof timelineWriteResultSchema>;

export function projectTimelineWriteResult(
  source: unknown,
  expectedOperation: TimelineWriteInput["operation"],
): TimelineWriteResult {
  const result = timelineWriteResultSchema.parse(source);
  if (result.operation !== expectedOperation) throw new Error("timeline operation mismatch");
  return result;
}

export const TIMELINE_WRITE_ALIASES = Object.freeze({
  applyPlan: "apply_edit_plan",
  undo: "undo_timeline_edit",
});

export function timelineWritePiInputSchemaForAlias(alias: string): z.ZodTypeAny | undefined {
  switch (alias) {
    case TIMELINE_WRITE_ALIASES.applyPlan:
      return timelineEditPlanSchema;
    case TIMELINE_WRITE_ALIASES.undo:
      return undoTimelineEditPiInputSchema;
    default:
      return undefined;
  }
}

export function timelineWriteInputForAlias(alias: string, value: unknown): TimelineWriteInput | undefined {
  const schema = timelineWritePiInputSchemaForAlias(alias);
  if (!schema) return undefined;
  return timelineWriteSemanticInputSchema.parse({ operation: alias, ...schema.parse(value) });
}

export function timelineWritePiDescriptionForAlias(alias: string): string | undefined {
  switch (alias) {
    case TIMELINE_WRITE_ALIASES.applyPlan:
      return "Apply one compare-and-swap guarded timeline edit plan after user approval.";
    case TIMELINE_WRITE_ALIASES.undo:
      return "Undo the exact most recent Agent timeline edit after user approval.";
    default:
      return undefined;
  }
}

export const TIMELINE_WRITE_CAPABILITY = {
  id: "timeline.write",
  version: 1,
  aliases: { pi: TIMELINE_WRITE_ALIASES.applyPlan, mcp: "nomi_timeline_edit" },
  additionalAliases: { pi: Object.freeze([TIMELINE_WRITE_ALIASES.undo]) },
  inputSchema: timelineWriteSemanticInputSchema,
  outputSchema: timelineWriteResultSchema,
  effect: "reversible_write",
  execution: { port: "timeline", availability: "renderer_required" },
  exposure: "mcp_safe",
  requiredScope: "timeline:write",
  targetKind: "timeline",
  approval: "proposal",
  projections: {
    pi: { description: "Apply or undo an approved project timeline edit." },
    mcp: { description: "Preview, apply, or undo a revision-guarded timeline edit after Host approval." },
  },
} as const satisfies CapabilityContract<TimelineWriteInput, TimelineWriteResult>;

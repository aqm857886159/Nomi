import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";
import { timelineDiffResultSchema, timelineEditPlanSchema } from "./timelineRead";

const canonicalIdSchema = z.string().trim().min(1);
const revisionSchema = canonicalIdSchema.max(64);
const changeIdSchema = canonicalIdSchema.max(200).describe("Versioned reversible change id returned by a write.");
const applyEditPlanInputSchema = timelineEditPlanSchema.extend({ operation: z.literal("apply_edit_plan") });
export const undoTimelineEditInputBaseSchema = z.object({
    changeId: changeIdSchema.optional(),
    // Kept at the transport edge for existing MCP callers; semantic callers use changeId.
    undoToken: canonicalIdSchema.max(160).optional(),
    expectedRevision: revisionSchema.optional(),
    reason: z.string().trim().max(300).optional(),
  });
const undoTimelineEditLegacyPiInputSchema = z.object({
  undoToken: canonicalIdSchema.max(160),
  expectedRevision: revisionSchema,
  reason: z.string().trim().max(300).optional(),
}).strict();
const undoTimelineEditInputSchema = undoTimelineEditInputBaseSchema.extend({
  operation: z.literal("undo_timeline_edit"),
}).superRefine((value, context) => {
  if (!value.changeId && !value.undoToken) context.addIssue({ code: z.ZodIssueCode.custom, path: ["changeId"], message: "changeId is required" });
  if (value.changeId && value.undoToken) context.addIssue({ code: z.ZodIssueCode.custom, path: ["undoToken"], message: "give changeId, not both changeId and undoToken" });
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
      changeId: changeIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("undo_timeline_edit"),
      ok: z.boolean(),
      revision: revisionSchema,
      code: canonicalIdSchema.max(120).optional(),
      undone: z.boolean(),
      changeId: changeIdSchema.optional(),
    })
    .strict(),
]);

export type TimelineWriteInput = z.infer<typeof timelineWriteSemanticInputSchema>;
export type TimelineWriteResult = z.infer<typeof timelineWriteResultSchema>;

export function projectTimelineWriteResult(
  source: unknown,
  expectedOperation: TimelineWriteInput["operation"] | "edit_timeline",
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
      return undoTimelineEditLegacyPiInputSchema;
    default:
      return undefined;
  }
}

export function timelineWriteInputForAlias(alias: string, value: unknown): TimelineWriteInput | undefined {
  if (alias === TIMELINE_WRITE_ALIASES.undo && value && typeof value === "object" && "changeId" in value) {
    return timelineWriteSemanticInputSchema.parse({ operation: alias, ...(value as Record<string, unknown>) });
  }
  const schema = timelineWritePiInputSchemaForAlias(alias);
  if (!schema) return undefined;
  const parsed = schema.parse(value) as Record<string, unknown>;
  if (alias === TIMELINE_WRITE_ALIASES.undo && parsed.changeId === undefined && parsed.undoToken !== undefined) {
    parsed.changeId = parsed.undoToken;
    delete parsed.undoToken;
  }
  return timelineWriteSemanticInputSchema.parse({ operation: alias, ...parsed });
}


export const TIMELINE_WRITE_CAPABILITY = {
  id: "timeline.write",
  version: 1,
  // 模型可见动词是 `edit_timeline` 与 `undo`；apply_edit_plan / undo_timeline_edit 是传输层的方法词表。
  aliases: { pi: "edit_timeline", mcp: "nomi_timeline_edit", method: TIMELINE_WRITE_ALIASES.applyPlan },
  additionalAliases: { pi: Object.freeze(["undo"]), method: Object.freeze([TIMELINE_WRITE_ALIASES.undo]) },
  inputSchema: timelineWriteSemanticInputSchema,
  outputSchema: timelineWriteResultSchema,
  effect: "reversible_write",
  effectClass: "reversible_local",
  // 只有「一份编辑计划」要用户先读（高亮、再批）；撤销没有可读的载荷，它就是把上一笔放回去——
  // 真实测试 ④：撤销一笔画布改动弹出「调整时间线」确认卡，用户没法撤销。认不出 operation 时仍按整契约要复审（fail-closed）。
  requiresPlanReview: true,
  operationPlanReview: Object.freeze({ [TIMELINE_WRITE_ALIASES.applyPlan]: Object.freeze({ allowReuse: true }) }),
  execution: { port: "timeline", availability: "renderer_required" },
  exposure: "mcp_safe",
  requiredScope: "timeline:write",
  targetKind: "timeline",
} as const satisfies CapabilityContract<TimelineWriteInput, TimelineWriteResult>;

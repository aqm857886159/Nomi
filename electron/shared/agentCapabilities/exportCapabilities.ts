import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";
import { EXPORT_JOB_STATUSES } from "../contracts/exportTypes";

const revisionSchema = z.string().trim().min(1).max(64);
const exportJobIdSchema = z.string().trim().min(1).max(160);
const exportStatusSchema = z.enum(EXPORT_JOB_STATUSES);

const exportTimelinePiInputSchema = z
  .object({
    expectedRevision: revisionSchema,
    outputName: z.string().trim().min(1).max(120).optional(),
    aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5", "3:4", "4:3", "21:9"]).optional(),
    resolution: z.enum(["720p", "1080p"]).optional(),
    quality: z.enum(["small", "standard", "high"]).optional(),
  })
  .strict();
const exportJobPiInputSchema = z.object({ jobId: exportJobIdSchema }).strict();

export const exportReadSemanticInputSchema = z.discriminatedUnion("operation", [
  exportJobPiInputSchema.extend({ operation: z.literal("inspect_export_job") }),
  exportJobPiInputSchema.extend({ operation: z.literal("verify_render") }),
]);

export const exportWriteSemanticInputSchema = z.discriminatedUnion("operation", [
  exportTimelinePiInputSchema.extend({ operation: z.literal("export_timeline") }),
  exportJobPiInputSchema.extend({ operation: z.literal("cancel_export_job") }),
]);

export type ExportReadInput = z.infer<typeof exportReadSemanticInputSchema>;
export type ExportWriteInput = z.infer<typeof exportWriteSemanticInputSchema>;

const safeOutputReceiptSchema = z
  .object({
    available: z.boolean(),
    bytes: z.number().int().safe().nonnegative().optional(),
    durationMs: z.number().finite().nonnegative().optional(),
  })
  .strict();
const safeFailureSchema = z.object({ category: z.string().trim().min(1).max(64) }).strict();

export const exportReadResultSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("inspect_export_job"),
      jobId: exportJobIdSchema,
      status: exportStatusSchema,
      progress: z
        .object({
          ratio: z.number().finite().min(0).max(1),
          stage: z.string().trim().min(1).max(64),
        })
        .strict(),
      cancellable: z.boolean(),
      createdAt: z.string().max(64),
      updatedAt: z.string().max(64),
      completedAt: z.string().max(64).optional(),
      output: safeOutputReceiptSchema,
      warningCount: z.number().int().safe().nonnegative(),
      failure: safeFailureSchema.optional(),
      manifestIntegrity: z.enum(["canonical", "legacy_complete", "legacy_incomplete"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("verify_render"),
      jobId: exportJobIdSchema,
      verified: z.boolean(),
      verificationLevel: z.literal("export_job_receipt"),
      contentDecoded: z.literal(false),
      status: exportStatusSchema,
      bytes: z.number().int().safe().positive().optional(),
      durationMs: z.number().finite().nonnegative().nullable().optional(),
      code: z.string().trim().min(1).max(96).optional(),
      failure: z.string().trim().min(1).max(64).nullable().optional(),
      manifestIntegrity: z.enum(["canonical", "legacy_complete", "legacy_incomplete"]),
    })
    .strict(),
]);

export const exportWriteResultSchema = z.union([
  z
    .object({
      operation: z.literal("export_timeline"),
      accepted: z.literal(false),
      code: z.enum(["stale_revision", "empty_timeline"]),
      expectedRevision: revisionSchema.optional(),
      currentRevision: revisionSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("export_timeline"),
      accepted: z.literal(true),
      jobId: exportJobIdSchema,
      backend: z.enum(["filtergraph", "webm"]),
      timelineRevision: revisionSchema,
      durationFrames: z.number().int().safe().positive(),
      profile: z
        .object({
          aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5", "3:4", "4:3", "21:9"]),
          resolution: z.enum(["720p", "1080p"]),
          quality: z.enum(["small", "standard", "high"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("cancel_export_job"),
      jobId: exportJobIdSchema,
      cancelled: z.boolean(),
      status: exportStatusSchema,
      code: z.literal("export_not_cancellable").optional(),
    })
    .strict(),
]);

export type ExportReadResult = z.infer<typeof exportReadResultSchema>;
export type ExportWriteResult = z.infer<typeof exportWriteResultSchema>;

export function projectExportReadResult(source: unknown, operation: ExportReadInput["operation"]): ExportReadResult {
  const result = exportReadResultSchema.parse(source);
  if (result.operation !== operation) throw new Error("export operation mismatch");
  return result;
}

export function projectExportWriteResult(source: unknown, operation: ExportWriteInput["operation"]): ExportWriteResult {
  const result = exportWriteResultSchema.parse(source);
  if (result.operation !== operation) throw new Error("export operation mismatch");
  return result;
}

export const EXPORT_READ_ALIASES = Object.freeze({ inspect: "inspect_export_job", verify: "verify_render" });
export const EXPORT_WRITE_ALIASES = Object.freeze({ start: "export_timeline", cancel: "cancel_export_job" });

export function exportReadPiInputSchemaForAlias(alias: string): z.ZodTypeAny | undefined {
  return alias === EXPORT_READ_ALIASES.inspect || alias === EXPORT_READ_ALIASES.verify
    ? exportJobPiInputSchema
    : undefined;
}

export function exportWritePiInputSchemaForAlias(alias: string): z.ZodTypeAny | undefined {
  if (alias === EXPORT_WRITE_ALIASES.start) return exportTimelinePiInputSchema;
  if (alias === EXPORT_WRITE_ALIASES.cancel) return exportJobPiInputSchema;
  return undefined;
}

export function exportReadInputForAlias(alias: string, value: unknown): ExportReadInput | undefined {
  const schema = exportReadPiInputSchemaForAlias(alias);
  if (!schema) return undefined;
  return exportReadSemanticInputSchema.parse({ operation: alias, ...schema.parse(value) });
}

export function exportWriteInputForAlias(alias: string, value: unknown): ExportWriteInput | undefined {
  const schema = exportWritePiInputSchemaForAlias(alias);
  if (!schema) return undefined;
  return exportWriteSemanticInputSchema.parse({ operation: alias, ...schema.parse(value) });
}

export function exportReadPiDescriptionForAlias(alias: string): string | undefined {
  if (alias === EXPORT_READ_ALIASES.inspect) return "Inspect one active-project export job through a path-free receipt.";
  if (alias === EXPORT_READ_ALIASES.verify) return "Verify one non-empty export receipt without claiming decoded media inspection.";
  return undefined;
}

export function exportWritePiDescriptionForAlias(alias: string): string | undefined {
  if (alias === EXPORT_WRITE_ALIASES.start) return "Start an approved export at one exact canonical Timeline revision.";
  if (alias === EXPORT_WRITE_ALIASES.cancel) return "Cancel one active-project export job after explicit approval.";
  return undefined;
}

export const EXPORT_READ_CAPABILITY = {
  id: "export.read",
  version: 1,
  aliases: { pi: EXPORT_READ_ALIASES.inspect, mcp: "nomi_export_job" },
  additionalAliases: { pi: Object.freeze([EXPORT_READ_ALIASES.verify]) },
  inputSchema: exportReadSemanticInputSchema,
  outputSchema: exportReadResultSchema,
  effect: "read",
  execution: { port: "export", availability: "renderer_required" },
  exposure: "mcp_safe",
  requiredScope: "export:read",
  targetKind: "export",
  approval: "none",
  projections: {
    pi: { description: "Inspect and verify active-project export receipts." },
    mcp: { description: "Inspect/verify export receipts; Host starts/cancels exports." },
  },
} as const satisfies CapabilityContract<ExportReadInput, ExportReadResult>;

export const EXPORT_WRITE_CAPABILITY = {
  id: "export.write",
  version: 1,
  aliases: { pi: EXPORT_WRITE_ALIASES.start },
  additionalAliases: { pi: Object.freeze([EXPORT_WRITE_ALIASES.cancel]) },
  inputSchema: exportWriteSemanticInputSchema,
  outputSchema: exportWriteResultSchema,
  effect: "destructive",
  execution: { port: "export", availability: "renderer_required" },
  exposure: "internal_only",
  requiredScope: "export:write",
  targetKind: "export",
  approval: "proposal",
  projections: { pi: { description: "Start or cancel an approved active-project export job." } },
} as const satisfies CapabilityContract<ExportWriteInput, ExportWriteResult>;

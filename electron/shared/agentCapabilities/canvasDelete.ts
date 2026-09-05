import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

const canonicalIdSchema = z.string().trim().min(1).max(512);

export const canvasDeletePiInputSchema = z
  .object({
    nodeIds: z.array(canonicalIdSchema).min(1).max(24).refine((ids) => new Set(ids).size === ids.length, {
      message: "nodeIds must be unique",
    }),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export const canvasDeleteSemanticInputSchema = canvasDeletePiInputSchema.extend({
  operation: z.literal("delete_canvas_nodes"),
});

const canvasDeleteReceiptBase = {
  applied: z.literal(true),
  proposalId: canonicalIdSchema,
  recoveryActions: z.array(canonicalIdSchema).max(4).optional(),
  reconciliation: z.object({ ok: z.boolean(), deviationCount: z.number().int().safe().nonnegative() }).strict(),
};

export const canvasDeleteResultSchema = z.discriminatedUnion("operation", [
  z.object({ ...canvasDeleteReceiptBase, operation: z.literal("delete_canvas_nodes"), deletedNodeIds: z.array(canonicalIdSchema).min(1).max(24), undoToken: canonicalIdSchema.optional() }).strict(),
  z.object({ ...canvasDeleteReceiptBase, operation: z.literal("undo_canvas_delete"), restoredNodeIds: z.array(canonicalIdSchema).min(1).max(24) }).strict(),
]);

export type CanvasDeleteInput = z.infer<typeof canvasDeleteSemanticInputSchema>;
export type CanvasDeleteResult = z.infer<typeof canvasDeleteResultSchema>;

export const CANVAS_DELETE_ALIAS = "delete_canvas_nodes" as const;

export function canvasDeleteInputForAlias(alias: string, value: unknown): CanvasDeleteInput | undefined {
  if (alias !== CANVAS_DELETE_ALIAS) return undefined;
  return canvasDeleteSemanticInputSchema.parse({ operation: alias, ...canvasDeletePiInputSchema.parse(value) });
}

export function canvasDeletePiDescriptionForAlias(alias: string): string | undefined {
  return alias === CANVAS_DELETE_ALIAS
    ? "Delete exact unlocked Canvas nodes through one approved and reversible proposal transaction."
    : undefined;
}

export const CANVAS_DELETE_CAPABILITY = {
  id: "canvas.delete",
  version: 1,
  aliases: { pi: CANVAS_DELETE_ALIAS, mcp: "nomi_canvas_maintenance" },
  inputSchema: canvasDeleteSemanticInputSchema,
  outputSchema: canvasDeleteResultSchema,
  effect: "destructive",
  effectClass: "irreversible",
  operationEffectClasses: Object.freeze({ undo_canvas_delete: "reversible_local" }),
  execution: { port: "canvas", availability: "renderer_required" },
  exposure: "mcp_safe",
  requiredScope: "canvas:write",
  targetKind: "canvas",
  projections: {
    pi: { description: "Delete exact Canvas nodes after explicit approval." },
    mcp: { description: "Confirm or undo destructive Canvas maintenance." },
  },
} as const satisfies CapabilityContract<CanvasDeleteInput, CanvasDeleteResult>;

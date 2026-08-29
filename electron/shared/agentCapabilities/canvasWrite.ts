import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

const canonicalIdSchema = z.string().trim().min(1);
export const CANVAS_WRITE_MAX_PROMPT_CHARS = 262_144;
const nonBlankPromptSchema = z.string().max(CANVAS_WRITE_MAX_PROMPT_CHARS).refine((value) => value.trim().length > 0, {
  message: "Prompt must contain non-whitespace content",
});

export const canvasWriteSemanticInputSchema = z
  .object({
    operation: z.literal("set_node_prompt"),
    nodeId: canonicalIdSchema,
    prompt: nonBlankPromptSchema,
  })
  .strict();

/** Pi derives the operation from the Registry alias; callers provide only semantic arguments. */
export const canvasWritePiInputSchema = canvasWriteSemanticInputSchema.omit({ operation: true });

export const canvasWriteResultSchema = z
  .object({
    applied: z.literal(true),
    proposalId: canonicalIdSchema,
    operation: z.literal("set_node_prompt"),
    affectedNodeIds: z.array(canonicalIdSchema).length(1),
    reconciliation: z
      .object({
        ok: z.boolean(),
        deviationCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type CanvasWriteInput = z.infer<typeof canvasWriteSemanticInputSchema>;
export type CanvasWriteResult = z.infer<typeof canvasWriteResultSchema>;

export const CANVAS_WRITE_ALIASES = Object.freeze({
  setNodePrompt: "set_node_prompt",
});

export function canvasWriteOperationForAlias(alias: string): CanvasWriteInput["operation"] | undefined {
  return alias === CANVAS_WRITE_ALIASES.setNodePrompt ? "set_node_prompt" : undefined;
}

export const CANVAS_WRITE_CAPABILITY = {
  id: "canvas.write",
  version: 1,
  aliases: {
    pi: CANVAS_WRITE_ALIASES.setNodePrompt,
  },
  inputSchema: canvasWriteSemanticInputSchema,
  outputSchema: canvasWriteResultSchema,
  effect: "reversible_write",
  execution: {
    port: "canvas",
    availability: "renderer_required",
  },
  exposure: "internal_only",
  requiredScope: "canvas:write",
  targetKind: "canvas",
  approval: "proposal",
  projections: {
    pi: {
      description: "Propose an exact, reversible update to a generation canvas node.",
    },
  },
} as const satisfies CapabilityContract<CanvasWriteInput, CanvasWriteResult>;

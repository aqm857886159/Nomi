import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/** One semantic write operation; surface aliases only choose the operation. */
export const documentWriteSemanticInputSchema = z
  .object({
    operation: z.enum(["insert", "replace", "append"]),
    content: z.string().min(1),
  })
  .strict();

/** Safe write receipt. Editor/provider internals never cross the capability boundary. */
export const documentWriteResultSchema = z
  .object({
    applied: z.literal(true),
    revision: z.number().int().nonnegative(),
    contentHash: z.string().min(1),
  })
  .strict();

export type DocumentWriteInput = z.infer<typeof documentWriteSemanticInputSchema>;
export type DocumentWriteResult = z.infer<typeof documentWriteResultSchema>;

export const DOCUMENT_WRITE_ALIASES = Object.freeze({
  insert: "insert_at_cursor",
  replace: "replace_selection",
  append: "append_to_end",
});

export function documentWriteOperationForAlias(alias: string): DocumentWriteInput["operation"] | undefined {
  if (alias === DOCUMENT_WRITE_ALIASES.insert) return "insert";
  if (alias === DOCUMENT_WRITE_ALIASES.replace) return "replace";
  if (alias === DOCUMENT_WRITE_ALIASES.append) return "append";
  return undefined;
}

export const DOCUMENT_WRITE_CAPABILITY = {
  id: "document.write",
  version: 1,
  aliases: {
    pi: DOCUMENT_WRITE_ALIASES.insert,
    mcp: "nomi_document_edit",
  },
  additionalAliases: {
    pi: Object.freeze([DOCUMENT_WRITE_ALIASES.replace, DOCUMENT_WRITE_ALIASES.append]),
  },
  inputSchema: documentWriteSemanticInputSchema,
  outputSchema: documentWriteResultSchema,
  effect: "reversible_write",
  execution: {
    port: "document",
    availability: "renderer_required",
  },
  exposure: "mcp_safe",
  requiredScope: "document:write",
  targetKind: "document",
  approval: "proposal",
  projections: {
    pi: {
      description: "Propose an insertion, selection replacement, or append to the current creation document.",
    },
    mcp: {
      description: "Propose an insertion, selection replacement, or append to the current creation document.",
    },
  },
} as const satisfies CapabilityContract<DocumentWriteInput, DocumentWriteResult>;

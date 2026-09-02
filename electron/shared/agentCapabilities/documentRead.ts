import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/** The only semantic input for the document read capability. */
export const documentReadSemanticInputSchema = z
  .object({
    scope: z.enum(["full", "selection"]),
  })
  .strict();

/** Safe document projection. Document identity and editor state stay in the invocation/port. */
export const documentReadResultSchema = z
  .object({
    text: z.string(),
  })
  .strict();

export type DocumentReadInput = z.infer<typeof documentReadSemanticInputSchema>;
export type DocumentReadResult = z.infer<typeof documentReadResultSchema>;

export const DOCUMENT_READ_SELECTION_ALIAS = "read_selection" as const;

/**
 * Project a domain adapter response into the one safe document.read result.
 * Adapters may return plain text or a `{ text }` envelope; all other fields are dropped.
 */
export function projectDocumentRead(source: unknown): DocumentReadResult {
  if (typeof source === "string") return { text: source };
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return documentReadResultSchema.parse(source);
  }
  return documentReadResultSchema.parse({ text: (source as Record<string, unknown>).text });
}

export const DOCUMENT_READ_CAPABILITY = {
  id: "document.read",
  version: 1,
  aliases: {
    pi: "read_full_text",
    mcp: "nomi_document_read",
  },
  additionalAliases: {
    pi: Object.freeze([DOCUMENT_READ_SELECTION_ALIAS]),
  },
  inputSchema: documentReadSemanticInputSchema,
  outputSchema: documentReadResultSchema,
  effect: "read",
  execution: {
    port: "document",
    availability: "renderer_required",
  },
  exposure: "mcp_safe",
  requiredScope: "document:read",
  targetKind: "document",
  approval: "none",
  projections: {
    pi: {
      description: "Read the current creation document or selection as plain text.",
    },
    mcp: {
      description: "Read the current creation document or a bounded selection as plain text.",
    },
  },
} as const satisfies CapabilityContract<DocumentReadInput, DocumentReadResult>;

/** Registry-owned aliases for the two semantic scopes of one capability. */
export const DOCUMENT_READ_ALIASES = Object.freeze({
  full: DOCUMENT_READ_CAPABILITY.aliases.pi,
  selection: DOCUMENT_READ_SELECTION_ALIAS,
});

export function documentReadScopeForAlias(alias: string): DocumentReadInput["scope"] | undefined {
  if (alias === DOCUMENT_READ_ALIASES.full) return "full";
  if (alias === DOCUMENT_READ_ALIASES.selection) return "selection";
  return undefined;
}

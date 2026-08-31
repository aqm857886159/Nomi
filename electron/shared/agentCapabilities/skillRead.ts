import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/**
 * Read one Skill body from the same catalog used by the Workbench and Pi.
 *
 * The envelope lives in the shared capability layer on purpose: callers can
 * describe and validate `load_skill` without importing the filesystem-backed
 * Skill store.  Loading knowledge is read-only and never changes the
 * capability ceiling declared by a Skill manifest.
 */
export const skillReadSemanticInputSchema = z
  .object({
    operation: z.literal("load_skill"),
    name: z.string().trim().min(1).max(240),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  })
  .strict();

export const skillReadResultSchema = z
  .object({
    loaded: z.literal(true),
    name: z.string().trim().min(1),
    directoryName: z.string().trim().min(1),
    description: z.string().max(4_096),
    body: z.string().min(1),
    origin: z.enum(["builtin", "user"]),
    packageVersion: z.string().trim().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export type SkillReadInput = z.infer<typeof skillReadSemanticInputSchema>;
export type SkillReadResult = z.infer<typeof skillReadResultSchema>;

export const SKILL_READ_ALIASES = Object.freeze({
  load: "load_skill",
});

export const SKILL_READ_CAPABILITY = {
  id: "skill.read",
  version: 1,
  aliases: { pi: SKILL_READ_ALIASES.load },
  inputSchema: skillReadSemanticInputSchema,
  outputSchema: skillReadResultSchema,
  effect: "read",
  execution: { port: "skills", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "skills:read",
  targetKind: "project",
  approval: "none",
  projections: {
    pi: {
      description: "Load one named Skill body from the approved Nomi catalog without granting its permissions.",
    },
  },
} as const satisfies CapabilityContract<SkillReadInput, SkillReadResult>;

export function skillReadInputForAlias(alias: string, args: unknown): SkillReadInput | undefined {
  if (alias !== SKILL_READ_ALIASES.load) return undefined;
  return skillReadSemanticInputSchema.parse({ operation: "load_skill", ...(args ?? {}) });
}

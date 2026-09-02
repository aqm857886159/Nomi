import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/**
 * Skill authoring is a project-scoped, reversible package write.  The
 * authoritative manifest parser lives in electron/skills; this shared schema
 * intentionally validates only the wire envelope so the capability boundary
 * does not import the skill loader (which would create a registry cycle).
 */
const skillManifestWireSchema = z.record(z.unknown());

export const skillWriteSemanticInputSchema = z
  .object({
    operation: z.literal("author_skill"),
    dirName: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "dirName must be a safe ASCII slug"),
    manifest: skillManifestWireSchema,
    skillMarkdown: z.string().trim().min(1).max(1024 * 1024),
  })
  .strict();

export const skillWriteResultSchema = z
  .object({
    applied: z.literal(true),
    dirName: z.string().trim().min(1),
    skillName: z.string().trim().min(1),
    packageVersion: z.string().trim().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    created: z.boolean(),
  })
  .strict();

export type SkillWriteInput = z.infer<typeof skillWriteSemanticInputSchema>;
export type SkillWriteResult = z.infer<typeof skillWriteResultSchema>;

export const SKILL_WRITE_ALIASES = Object.freeze({
  author: "author_skill",
});

export const SKILL_WRITE_CAPABILITY = {
  id: "skill.write",
  version: 1,
  aliases: { pi: SKILL_WRITE_ALIASES.author },
  inputSchema: skillWriteSemanticInputSchema,
  outputSchema: skillWriteResultSchema,
  effect: "reversible_write",
  execution: { port: "skills", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "skills:write",
  targetKind: "project",
  approval: "proposal",
  projections: {
    pi: {
      description: "Save a validated Nomi Skill package to the user's Skill library.",
    },
  },
} as const satisfies CapabilityContract<SkillWriteInput, SkillWriteResult>;

export function skillWriteInputForAlias(alias: string, args: unknown): SkillWriteInput | undefined {
  if (alias !== SKILL_WRITE_ALIASES.author) return undefined;
  return skillWriteSemanticInputSchema.parse({ operation: "author_skill", ...(args ?? {}) });
}

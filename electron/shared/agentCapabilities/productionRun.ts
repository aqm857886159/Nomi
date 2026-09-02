import { z } from "zod";
import type { CapabilityContract } from "./capabilityContract";

/**
 * ProductionRun is one domain owner with three narrow permission groups. The
 * Pi aliases are deliberately grouped here so a Skill can request read-only
 * run visibility without accidentally gaining artifact or control writes.
 */
const productionInputSchema = z.record(z.unknown());
const productionOutputSchema = z.unknown();

export const PRODUCTION_RUN_READ_CAPABILITY = {
  id: "production.run.read",
  version: 1,
  aliases: { pi: "get_production_run" },
  additionalAliases: {
    pi: Object.freeze(["subscribe_production_run", "read_production_artifact", "read_production_artifact_content"]),
  },
  inputSchema: productionInputSchema,
  outputSchema: productionOutputSchema,
  effect: "read",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "production:read",
  targetKind: "production",
  approval: "none",
  projections: { pi: { description: "Read the current ProductionRun projection or resumable progress." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const PRODUCTION_RUN_WRITE_CAPABILITY = {
  id: "production.run.write",
  version: 1,
  aliases: { pi: "start_production_run" },
  additionalAliases: { pi: Object.freeze(["control_production_run", "decide_production_gate"]) },
  inputSchema: productionInputSchema,
  outputSchema: productionOutputSchema,
  effect: "reversible_write",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "production:write",
  targetKind: "production",
  approval: "proposal",
  projections: { pi: { description: "Create a draft or control a ProductionRun without submitting paid work." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const PRODUCTION_ARTIFACT_WRITE_CAPABILITY = {
  id: "production.artifact.write",
  version: 1,
  aliases: { pi: "revise_production_artifact" },
  additionalAliases: {
    pi: Object.freeze(["review_production_artifact", "materialize_production_storyboard"]),
  },
  inputSchema: productionInputSchema,
  outputSchema: productionOutputSchema,
  effect: "reversible_write",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "production:artifact:write",
  targetKind: "production",
  approval: "proposal",
  projections: { pi: { description: "Revise, review, or materialize a versioned production artifact." } },
} as const satisfies CapabilityContract<unknown, unknown>;

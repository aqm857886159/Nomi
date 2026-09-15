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
  // Run 家族不上模型面（设计正本 §5.3）：这些名字只是宿主传输的方法词表。
  aliases: { method: "get_production_run" },
  additionalAliases: {
    method: Object.freeze(["subscribe_production_run", "read_production_artifact", "read_production_artifact_content"]),
  },
  inputSchema: productionInputSchema,
  outputSchema: productionOutputSchema,
  effect: "read",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "production:read",
  targetKind: "production",
} as const satisfies CapabilityContract<unknown, unknown>;

export const PRODUCTION_RUN_WRITE_CAPABILITY = {
  id: "production.run.write",
  version: 1,
  aliases: { method: "start_production_run" },
  additionalAliases: { method: Object.freeze(["control_production_run", "decide_production_gate"]) },
  inputSchema: productionInputSchema,
  outputSchema: productionOutputSchema,
  effect: "reversible_write",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "production:write",
  targetKind: "production",
} as const satisfies CapabilityContract<unknown, unknown>;

export const PRODUCTION_ARTIFACT_WRITE_CAPABILITY = {
  id: "production.artifact.write",
  version: 1,
  aliases: { method: "revise_production_artifact" },
  additionalAliases: {
    method: Object.freeze(["review_production_artifact", "materialize_production_storyboard"]),
  },
  inputSchema: productionInputSchema,
  outputSchema: productionOutputSchema,
  effect: "reversible_write",
  effectClass: "reversible_local",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "production:artifact:write",
  targetKind: "production",
} as const satisfies CapabilityContract<unknown, unknown>;

export const ARTIFACT_REVIEW_DECISIONS = ["approved", "changes_requested", "rejected"] as const;
export type ArtifactReviewDecision = (typeof ARTIFACT_REVIEW_DECISIONS)[number];

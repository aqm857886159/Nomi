import { z } from "zod";
import type { CapabilityContract } from "./capabilityContract";

const input = z.record(z.unknown());
const output = z.unknown();

/**
 * Semantic generation tools are registered here only for capability
 * projection/Skill shrink-only checks. Their execution still belongs to the
 * main-process generation Host adapter; this registry never calls a provider.
 */
export const GENERATION_CONTEXT_READ_CAPABILITY = {
  id: "generation.context.read",
  version: 1,
  aliases: { pi: "nomi_get_generation_context" },
  inputSchema: input,
  outputSchema: output,
  effect: "read",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "context:read",
  targetKind: "generation",
  approval: "none",
  projections: { pi: { description: "Read the current catalog-backed generation context." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_PLAN_CAPABILITY = {
  id: "generation.plan",
  version: 1,
  aliases: { pi: "nomi_generation_plan" },
  additionalAliases: Object.freeze({ pi: Object.freeze(["nomi_operation_create", "nomi_submit_generation_plan", "nomi_preview_execution"]) }),
  inputSchema: input,
  outputSchema: output,
  effect: "reversible_write",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:plan",
  targetKind: "generation",
  approval: "none",
  projections: { pi: { description: "Create, edit, or preview a generation plan without submitting paid work." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_GATE_CAPABILITY = {
  id: "generation.gate",
  version: 1,
  aliases: { pi: "nomi_request_generation_gate" },
  additionalAliases: { pi: Object.freeze(["nomi_start_generation"]) },
  inputSchema: input,
  outputSchema: output,
  effect: "paid",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:submit",
  targetKind: "generation",
  approval: "human_receipt",
  projections: { pi: { description: "Confirm and start one frozen generation plan." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_RUN_READ_CAPABILITY = {
  id: "generation.run.read",
  version: 1,
  aliases: { pi: "nomi_generation_status" },
  additionalAliases: Object.freeze({ pi: Object.freeze(["nomi_operation_read"]) }),
  inputSchema: input,
  outputSchema: output,
  effect: "read",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:read",
  targetKind: "generation",
  approval: "none",
  projections: { pi: { description: "Read a generation plan, task, or artifact state." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_CONTROL_CAPABILITY = {
  id: "generation.control",
  version: 1,
  aliases: { pi: "nomi_cancel_generation" },
  additionalAliases: { pi: Object.freeze(["nomi_reconcile_generation"]) },
  inputSchema: input,
  outputSchema: output,
  effect: "reversible_write",
  execution: { port: "production-run", availability: "main_only" },
  exposure: "internal_only",
  requiredScope: "generation:control",
  targetKind: "generation",
  approval: "proposal",
  projections: { pi: { description: "Cancel or reconcile a generation operation without retrying unknown work." } },
} as const satisfies CapabilityContract<unknown, unknown>;

export const GENERATION_CAPABILITIES = Object.freeze([
  GENERATION_CONTEXT_READ_CAPABILITY,
  GENERATION_PLAN_CAPABILITY,
  GENERATION_GATE_CAPABILITY,
  GENERATION_RUN_READ_CAPABILITY,
  GENERATION_CONTROL_CAPABILITY,
] as const);

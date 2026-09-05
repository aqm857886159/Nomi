import { resolveCapabilityAlias, resolveCapabilityEffectClass } from "../shared/agentCapabilities/registry";
import type { CapabilityEffectClass } from "../shared/agentCapabilities/capabilityContract";
import {
  projectAgentApprovalPolicyOf,
  projectAgentWorkModeOf,
  type ProjectAgentApprovalPolicy,
  type ProjectAgentWorkMode,
} from "../shared/projectAgentContracts";

export type ProjectAgentExecutionRisk = "safe-reversible" | "hard-gate";

export type ProjectAgentWorkModeDecision = Readonly<{
  allowed: boolean;
  reason?: string;
}>;

/** Resolve the descriptor-owned side-effect class before any adapter can write. */
export function projectAgentExecutionEffectClass(toolName: string, args?: unknown): CapabilityEffectClass | undefined {
  return resolveCapabilityEffectClass(toolName, args);
}

/**
 * Keep the legacy Host risk result for callers that only need a gate/no-gate
 * distinction. The descriptor effectClass is the sole classification source;
 * unknown aliases fail closed.
 */
export function projectAgentExecutionRisk(toolName: string, args?: unknown): ProjectAgentExecutionRisk {
  return projectAgentExecutionEffectClass(toolName, args) === "reversible_local"
    ? "safe-reversible"
    : "hard-gate";
}

/**
 * Apply the renderer-selected work posture at the Host boundary. The model
 * prompt is guidance only; this decision is the enforcement point before a
 * tool call can reach an adapter. Unknown aliases fail closed for the narrow
 * modes because the Host cannot prove that they are read-only or selection
 * scoped.
 */
export function projectAgentWorkModeDecision(
  mode: ProjectAgentWorkMode | undefined,
  toolName: string,
  args?: unknown,
): ProjectAgentWorkModeDecision {
  const workMode = projectAgentWorkModeOf(mode);
  if (workMode === "agent") return { allowed: true };

  const capability = resolveCapabilityAlias(toolName)?.contract;
  const effect = capability?.effect;
  if (workMode === "ask") {
    return effect === "read"
      ? { allowed: true }
      : { allowed: false, reason: "Ask mode only permits read-only Agent actions" };
  }

  // Edit-selection may inspect the project and propose reversible edits, but
  // it must not start paid/destructive work. The existing target/precondition
  // gate remains the owner of the exact frozen selection scope.
  if (effect === "read" || projectAgentExecutionEffectClass(toolName, args) === "reversible_local") {
    return { allowed: true };
  }
  return { allowed: false, reason: "Edit-selection mode only permits read or reversible selection edits" };
}

/**
 * `project` ("always") lets a descriptor-marked local reversible action run with
 * no card at all. `safe-auto` — the default — *reuses one explicit approval*:
 * the first reversible write of an execution still asks, and the reuse is
 * granted only by an approval the user did not scope to `once`. `step` always
 * asks. Spend, irreversible and unknown actions keep the per-action gate in
 * every mode.
 *
 * The granted flag has to be load-bearing here or the whole intervention slot
 * is theatre: without it `safe-auto` auto-applies the very first reversible
 * write, so a timeline edit plan lands before its highlight is ever shown and
 * the slot's "this session" / "always" choices have nothing left to change.
 */
export function projectAgentMayReuseSafeApproval(
  policy: ProjectAgentApprovalPolicy | undefined,
  toolName: string,
  args: unknown,
  safeApprovalGranted: boolean,
): boolean {
  const normalized = projectAgentApprovalPolicyOf(policy);
  if (projectAgentExecutionEffectClass(toolName, args) !== "reversible_local") return false;
  if (normalized.mode === "project") return true;
  return normalized.mode === "safe-auto" && safeApprovalGranted;
}

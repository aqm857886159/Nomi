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
 * `safe-auto` and `project` allow descriptor-marked local reversible actions
 * without a confirmation card. Spend, irreversible, and unknown actions keep
 * the per-action gate in every mode. `step` always asks for local writes too.
 */
export function projectAgentMayReuseSafeApproval(
  policy: ProjectAgentApprovalPolicy | undefined,
  toolName: string,
  args: unknown,
  _safeApprovalGranted: boolean,
): boolean {
  const normalized = projectAgentApprovalPolicyOf(policy);
  return normalized.mode !== "step" && projectAgentExecutionEffectClass(toolName, args) === "reversible_local";
}

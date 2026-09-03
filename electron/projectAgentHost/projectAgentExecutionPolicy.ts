import { isPiGenerationToolName } from "../capabilityCore/generationTransportAdapters";
import { resolveCapabilityAlias } from "../shared/agentCapabilities/registry";
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

/**
 * Classify at the Host boundary, before any adapter can write. The allow-list
 * is deliberately small: unknown or provider-facing operations remain hard
 * gated until a domain owner gives them an explicit policy.
 */
export function projectAgentExecutionRisk(toolName: string, args?: unknown): ProjectAgentExecutionRisk {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return "hard-gate";
  if (isPiGenerationToolName(toolName)) return "hard-gate";

  const record = args && typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown>
    : {};
  const operation = typeof record.operation === "string" ? record.operation.toLowerCase() : "";
  const hardGatePattern = /(delete|remove|destroy|export|publish|submit|start|cancel|reconcile|provider|external|production|payment|purchase|credential|account)/;
  if (hardGatePattern.test(normalized) || hardGatePattern.test(operation)) return "hard-gate";

  const safePattern = /(^|[._:-])(append_to_end|insert_at_cursor|replace_selection|document\.write|document_write|canvas\.write|create_canvas_nodes|set_node_prompt|timeline\.write|apply_edit_plan|undo_timeline_edit)([._:-]|$)/;
  if (safePattern.test(normalized) || safePattern.test(operation)) return "safe-reversible";
  return "hard-gate";
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

  const effect = resolveCapabilityAlias(toolName)?.contract.effect;
  if (workMode === "ask") {
    return effect === "read"
      ? { allowed: true }
      : { allowed: false, reason: "Ask mode only permits read-only Agent actions" };
  }

  // Edit-selection may inspect the project and propose reversible edits, but
  // it must not start paid/destructive work. The existing target/precondition
  // gate remains the owner of the exact frozen selection scope.
  if (effect === "read" || (effect === "reversible_write" && projectAgentExecutionRisk(toolName, args) === "safe-reversible")) {
    return { allowed: true };
  }
  return { allowed: false, reason: "Edit-selection mode only permits read or reversible selection edits" };
}

/**
 * `safe-auto` and `project` mean one explicit approval can cover subsequent
 * reversible writes in this Host turn. They never waive the first approval,
 * paid generation, export, deletion, or unknown operations.
 */
export function projectAgentMayReuseSafeApproval(
  policy: ProjectAgentApprovalPolicy | undefined,
  toolName: string,
  args: unknown,
  safeApprovalGranted: boolean,
): boolean {
  const normalized = projectAgentApprovalPolicyOf(policy);
  if (normalized.mode === "step" || !safeApprovalGranted) return false;
  return projectAgentExecutionRisk(toolName, args) === "safe-reversible";
}

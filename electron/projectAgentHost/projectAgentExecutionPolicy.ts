import { isPiGenerationToolName } from "../capabilityCore/generationTransportAdapters";
import {
  projectAgentApprovalPolicyOf,
  type ProjectAgentApprovalPolicy,
} from "../shared/projectAgentContracts";

export type ProjectAgentExecutionRisk = "safe-reversible" | "hard-gate";

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

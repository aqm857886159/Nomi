// 旧宿主侧的审批**名字解析**那一半。判据本体住在
// `../shared/agentCapabilities/capabilityApprovalPolicy.ts`——两个宿主共用一份，
// 免得阶段 4 删掉本目录时新 lane 跟着断，或者反过来长出第二份判据（P1）。
import { capabilityRequiresPlanReview, resolveCapabilityAlias, resolveCapabilityEffectClass } from "../shared/agentCapabilities/registry";
import type { CapabilityEffectClass } from "../shared/agentCapabilities/capabilityContract";
import {
  capabilityIsHardGated,
  capabilityMayReuseSafeApproval,
  capabilityWorkModeDecision,
  type CapabilityApprovalSubject,
} from "../shared/agentCapabilities/capabilityApprovalPolicy";
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from "../shared/projectAgentContracts";

export type ProjectAgentExecutionRisk = "safe-reversible" | "hard-gate";

export type ProjectAgentWorkModeDecision = Readonly<{
  allowed: boolean;
  reason?: string;
}>;

/** pi 别名 → 审批需要的那三个契约事实。旧宿主的工具名就是 pi 别名，所以解析只有这一步。 */
function subjectOf(toolName: string, args?: unknown): CapabilityApprovalSubject {
  return {
    effect: resolveCapabilityAlias(toolName)?.contract.effect,
    effectClass: resolveCapabilityEffectClass(toolName, args),
    requiresPlanReview: capabilityRequiresPlanReview(toolName),
    // 旧宿主这条路上的工具全是原生能力，没有外部 MCP 服务器的 hint 可读。
    destructiveHint: false,
  };
}

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
  return capabilityIsHardGated(subjectOf(toolName, args)) ? "hard-gate" : "safe-reversible";
}

/**
 * Apply the renderer-selected work posture at the Host boundary. The model
 * prompt is guidance only; this decision is the enforcement point before a
 * tool call can reach an adapter.
 */
export function projectAgentWorkModeDecision(
  mode: ProjectAgentWorkMode | undefined,
  toolName: string,
  args?: unknown,
): ProjectAgentWorkModeDecision {
  return capabilityWorkModeDecision(mode, subjectOf(toolName, args));
}

/**
 * `safe-auto` and `project` allow descriptor-marked local reversible actions
 * without a confirmation card; spend, irreversible and unknown actions keep the
 * per-action gate in every mode. See the shared policy for the full reasoning.
 */
export function projectAgentMayReuseSafeApproval(
  policy: ProjectAgentApprovalPolicy | undefined,
  toolName: string,
  args: unknown,
  safeApprovalGranted: boolean,
): boolean {
  return capabilityMayReuseSafeApproval(policy, subjectOf(toolName, args), safeApprovalGranted);
}

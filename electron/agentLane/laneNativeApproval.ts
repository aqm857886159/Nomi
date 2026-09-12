import { classifyCommand } from '../shared/agentCapabilities/codingCommandPolicy';
import type { LaneApprovalSubjectResolver } from '../shared/agentLane/laneApproval';
import { laneToolApprovalFacets, type LaneToolEffect } from '../shared/agentLane/laneToolContract';

/** Main-process effects are trusted. Model arguments cannot add a tool or relax a shell verdict. */
export function createLaneNativeApprovalResolver(input: {
  projectDir: string;
  sandboxActive: boolean;
  effects: Readonly<Record<string, LaneToolEffect>>;
}): LaneApprovalSubjectResolver {
  return (request) => {
    const effect = Object.hasOwn(input.effects, request.toolName) ? input.effects[request.toolName] : undefined;
    if (!effect) return undefined;
    // 审批闸眼里的两个事实从同一个四值效果派生（`approvalFacetsOf`，唯一的对应表）。
    const subject = {
      toolName: request.toolName,
      capabilityId: `native:${request.toolName}`,
      ...laneToolApprovalFacets(effect),
      requiresPlanReview: false,
      destructiveHint: false,
    };
    if (request.toolName !== 'bash') return { subject };
    const args = request.args && typeof request.args === 'object' ? request.args as Record<string, unknown> : {};
    const verdict = classifyCommand({
      command: typeof args.command === 'string' ? args.command : '',
      projectDir: input.projectDir, sandboxActive: input.sandboxActive,
    });
    if (verdict.decision === 'deny') return { subject, denialReason: verdict.modelReason, grantable: false };
    if (verdict.decision === 'auto-allow') return { subject };
    // An escaped command may reuse only its own classifier-derived pattern, never a blanket bash grant.
    const pattern = verdict.tier === 'escape' && input.sandboxActive ? verdict.rememberablePattern : null;
    return {
      subject: {
        ...subject,
        ...(verdict.tier === 'hard-list' ? { effect: 'destructive' as const, effectClass: 'irreversible' as const } : {}),
        capabilityId: pattern ? `native:bash:${pattern}` : subject.capabilityId,
      },
      forceConfirmation: true,
      grantable: Boolean(pattern),
    };
  };
}

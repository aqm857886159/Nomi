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
    const subject = {
      toolName: request.toolName,
      capabilityId: `native:${request.toolName}`,
      ...laneToolApprovalFacets(effect),
      requiresPlanReview: false,
      destructiveHint: false,
    };
    if (request.toolName !== 'bash' && request.toolName !== 'powershell') return { subject };
    // PowerShell has no OS-level seatbelt/bwrap wrapper: treat its sandboxActive as false so every command requires confirmation or hard-list denial.
    const effectiveSandboxActive = request.toolName === 'bash' ? input.sandboxActive : false;
    const args = request.args && typeof request.args === 'object' ? request.args as Record<string, unknown> : {};
    const verdict = classifyCommand({
      command: typeof args.command === 'string' ? args.command : '',
      projectDir: input.projectDir,
      sandboxActive: effectiveSandboxActive,
    });
    if (verdict.decision === 'deny') return { subject, denialReason: verdict.modelReason, grantable: false };
    if (verdict.decision === 'auto-allow') return { subject };
    const pattern = verdict.tier === 'escape' && effectiveSandboxActive ? verdict.rememberablePattern : null;
    return {
      subject: {
        ...subject,
        ...(verdict.tier === 'hard-list' ? { effect: 'destructive' as const, effectClass: 'irreversible' as const } : {}),
        capabilityId: pattern ? `native:${request.toolName}:${pattern}` : subject.capabilityId,
      },
      forceConfirmation: true,
      grantable: Boolean(pattern),
    };
  };
}

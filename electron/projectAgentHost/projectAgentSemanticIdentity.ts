import type {
  ProjectAgentArtifactItem,
  ProjectAgentItem,
  ProjectAgentProposalApproval,
} from "../shared/projectAgentContracts";

export function hasDuplicateProjectAgentToolIdentity(items: readonly ProjectAgentItem[]): boolean {
  const toolCallIds = new Set<string>();
  const invocationIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "tool") continue;
    const scope = `${item.threadId}\0${item.turnId}`;
    const toolCallKey = `${scope}\0${item.toolCallId}`;
    const invocationKey = `${scope}\0${item.invocationId}`;
    if (toolCallIds.has(toolCallKey) || invocationIds.has(invocationKey)) return true;
    toolCallIds.add(toolCallKey);
    invocationIds.add(invocationKey);
  }
  return false;
}

export function hasDuplicateProjectAgentApprovalIdentity(approvals: readonly ProjectAgentProposalApproval[]): boolean {
  const toolCallIds = new Set<string>();
  const receiptProposalIds = new Set<string>();
  for (const approval of approvals) {
    const ref = approval.ref;
    const key = `${ref.threadId}\0${ref.turnId}\0${ref.toolCallId}`;
    if (toolCallIds.has(key) || receiptProposalIds.has(ref.receiptProposalId)) return true;
    toolCallIds.add(key);
    receiptProposalIds.add(ref.receiptProposalId);
  }
  return false;
}

export function hasDuplicateProjectAgentProposalReceiptIdentity(items: readonly ProjectAgentItem[]): boolean {
  const receiptProposalIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "proposal" || !item.approval) continue;
    if (receiptProposalIds.has(item.approval.receiptProposalId)) return true;
    receiptProposalIds.add(item.approval.receiptProposalId);
  }
  return false;
}

export function hasDuplicateProjectAgentArtifactIdentity(items: readonly ProjectAgentItem[]): boolean {
  const artifactKeys = new Set<string>();
  for (const item of items) {
    if (item.kind !== "artifact") continue;
    const artifact = (item as ProjectAgentArtifactItem).artifact;
    const key = `${artifact.runId}\0${artifact.artifactId}\0${artifact.version}`;
    if (artifactKeys.has(key)) return true;
    artifactKeys.add(key);
  }
  return false;
}

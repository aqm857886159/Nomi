import type { ProjectAgentStatus } from "../shared/projectAgentContracts";

export function isProjectAgentQueueBlockingStatus(status: ProjectAgentStatus): boolean {
  return status === "queued" || status === "proposed" || status === "running";
}

export function isProjectAgentAbortStatus(status: ProjectAgentStatus): boolean {
  return status === "declined" || status === "failed" || status === "stopped";
}

export function isProjectAgentProposalSettlementStatus(status: ProjectAgentStatus): boolean {
  return status === "done" || status === "failed" || status === "stopped";
}

export function isProjectAgentAsyncTurnStatus(status: ProjectAgentStatus): boolean {
  return status === "running" || status === "declined" || isProjectAgentProposalSettlementStatus(status);
}

export function isProjectAgentClaimedProposalItemStatus(status: ProjectAgentStatus): boolean {
  return status === "running" || isProjectAgentProposalSettlementStatus(status);
}

export function isProjectAgentLiveProposalItemStatus(status: ProjectAgentStatus): boolean {
  return status === "proposed" || status === "running";
}

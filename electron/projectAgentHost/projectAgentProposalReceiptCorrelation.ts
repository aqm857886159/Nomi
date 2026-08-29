import type { ProposalApprovalRef } from "../shared/projectAgentContracts";
import type {
  ProjectAgentCommittedProposalRecord,
  ProjectAgentProposalReceiptView,
} from "../shared/projectAgentProposalReceipt";
import type { ProjectBinding } from "../shared/projectBinding";
import { sameProjectAgentBinding } from "./projectAgentIdentity";

export function projectAgentProposalMatchesApproval(
  proposalId: string,
  proposal: ProjectAgentCommittedProposalRecord,
  approval: ProposalApprovalRef,
): boolean {
  return proposalId === approval.receiptProposalId
    && proposal.proposalId === approval.receiptProposalId
    && proposal.hostApprovalId === approval.approvalId
    && proposal.hostActionHash === approval.actionHash;
}

export function committedProjectAgentReceiptMatchesApproval(
  binding: ProjectBinding,
  receipt: ProjectAgentProposalReceiptView | null,
  approval: ProposalApprovalRef,
): boolean {
  return Boolean(
    receipt
    && receipt.lifecycle === "committed"
    && sameProjectAgentBinding(receipt.binding, binding)
    && projectAgentProposalMatchesApproval(receipt.proposalId, receipt.proposal, approval),
  );
}

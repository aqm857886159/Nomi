import { documentWriteOperationForAlias } from '../shared/agentCapabilities/documentWrite'
import type { ProposalApprovalRef } from '../shared/projectAgentContracts'
import type {
  ProjectAgentCommittedProposalRecord,
  ProjectAgentProposalReceiptView,
} from '../shared/projectAgentProposalReceipt'
import type { ProjectAgentProposalReceiptWriter } from './projectAgentExecutionCoordinatorTypes'

type ProjectAgentDocumentReceiptCall = Readonly<{ toolName: string; args: unknown }>
type PreparedDocumentReceipt = Readonly<{
  invocation: Readonly<{ input?: Readonly<{ operation: 'insert' | 'replace' | 'append' }> }>
}>

export function documentProposalReceiptFor(
  call: ProjectAgentDocumentReceiptCall,
  persisted: ProposalApprovalRef,
  prepared: PreparedDocumentReceipt,
): ProjectAgentCommittedProposalRecord {
  const operation = prepared.invocation.input?.operation
    ?? documentWriteOperationForAlias(call.toolName)
    ?? (call.args && typeof call.args === 'object' && typeof (call.args as Record<string, unknown>).operation === 'string'
      ? (call.args as Record<string, unknown>).operation as 'insert' | 'replace' | 'append'
      : 'write')
  return Object.freeze({
    proposalId: persisted.receiptProposalId,
    hostApprovalId: persisted.approvalId,
    hostActionHash: persisted.actionHash,
    summary: `${operation} ${call.toolName}`,
    stepLabels: Object.freeze([`${operation}:${call.toolName}`]),
    compensation: Object.freeze([]),
    watchNodes: Object.freeze([]),
    reconciliationOk: true,
  })
}

export function prepareDocumentProposalReceipt(
  writer: ProjectAgentProposalReceiptWriter,
  proposal: ProjectAgentCommittedProposalRecord,
  approvalId: string,
): ProjectAgentProposalReceiptView {
  const current = writer.read()
  return writer.write({
    expectedRevision: current?.revision ?? 0,
    proposalId: proposal.proposalId,
    operationId: `document-prepare:${approvalId}`,
    lifecycle: 'preparing',
    proposal,
  })
}

export function commitDocumentProposalReceipt(
  writer: ProjectAgentProposalReceiptWriter,
  prepared: ProjectAgentProposalReceiptView,
  proposal: ProjectAgentCommittedProposalRecord,
  approvalId: string,
): ProjectAgentProposalReceiptView {
  return writer.write({
    expectedRevision: prepared.revision,
    proposalId: proposal.proposalId,
    operationId: `document-commit:${approvalId}`,
    lifecycle: 'committed',
    proposal,
  })
}

export function abandonDocumentProposalReceipt(
  writer: ProjectAgentProposalReceiptWriter,
  prepared: ProjectAgentProposalReceiptView,
  proposal: ProjectAgentCommittedProposalRecord,
  approvalId: string,
): void {
  try {
    writer.transition({
      expectedRevision: prepared.revision,
      proposalId: proposal.proposalId,
      operationId: `document-failed:${approvalId}`,
      lifecycle: 'undone',
    })
  } catch {
    // Keep the preparing receipt as recovery evidence if the failure settlement loses its CAS race.
  }
}

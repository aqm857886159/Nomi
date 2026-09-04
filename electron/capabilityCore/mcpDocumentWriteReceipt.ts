import crypto from 'node:crypto'

import type { ProjectAgentCommittedProposalRecord } from '../shared/projectAgentProposalReceipt'
import type { ProjectAgentProposalReceiptService } from '../projectAgentHost/projectAgentProposalReceiptStore'

function proposalFor(input: Readonly<{
  proposalId: string
  operation: string
}>): ProjectAgentCommittedProposalRecord {
  return {
    proposalId: input.proposalId,
    summary: `MCP document ${input.operation}`,
    stepLabels: [`document.write:${input.operation}`],
    compensation: [],
    watchNodes: [],
    reconciliationOk: true,
  }
}

/**
 * The MCP transport is allowed to request a document write, but it never owns
 * the durable journal. The main-process service prepares before crossing the
 * renderer/disk boundary and commits only after the real write succeeds.
 */
export async function executeMcpDocumentWriteWithReceipt(input: Readonly<{
  service: ProjectAgentProposalReceiptService
  operation: string
  execute: () => Promise<unknown>
}>): Promise<unknown> {
  const proposalId = `mcp-document-${crypto.randomUUID()}`
  const proposal = proposalFor({ proposalId, operation: input.operation })
  const current = input.service.read()
  const preparing = input.service.write({
    expectedRevision: current?.revision ?? 0,
    proposalId,
    operationId: `mcp-document-prepare:${proposalId}`,
    lifecycle: 'preparing',
    proposal,
  })
  try {
    const result = await input.execute()
    if (!result || typeof result !== 'object' || (result as { applied?: unknown }).applied !== true) {
      throw new Error('capability_execution_failed')
    }
    input.service.write({
      expectedRevision: preparing.revision,
      proposalId,
      operationId: `mcp-document-commit:${proposalId}`,
      lifecycle: 'committed',
      proposal,
    })
    return result
  } catch (error) {
    // Close a failed prepare with durable evidence. A lost CAS remains a
    // preparing receipt, which is intentionally recovered/fail-closed later.
    try {
      input.service.transition({
        expectedRevision: preparing.revision,
        proposalId,
        operationId: `mcp-document-failed:${proposalId}`,
        lifecycle: 'undone',
      })
    } catch {
      // Preserve the original failure; the orphan is evidence for recovery.
    }
    throw error
  }
}

import crypto from 'node:crypto'

import type { ProjectAgentCommittedProposalRecord } from '../shared/projectAgentProposalReceipt'
import type { ProjectAgentProposalReceiptService } from '../projectAgentHost/projectAgentProposalReceiptStore'

type McpWriteReceiptKind = 'document' | 'canvas'

function proposalFor(input: Readonly<{
  proposalId: string
  kind: McpWriteReceiptKind
  operation: string
}>): ProjectAgentCommittedProposalRecord {
  return {
    proposalId: input.proposalId,
    summary: `MCP ${input.kind} ${input.operation}`,
    stepLabels: [`${input.kind}.write:${input.operation}`],
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
function proposalIdFor(kind: McpWriteReceiptKind, requestId?: string): string {
  const seed = requestId?.trim() || crypto.randomUUID()
  const digest = crypto.createHash('sha256').update(`${kind}\0${seed}`).digest('hex').slice(0, 40)
  return `mcp-${kind}-${digest}`
}

function cancellationError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason
  return new Error('MCP request cancelled')
}

/**
 * Shared main-process receipt boundary for semantic MCP writes. Preparation is
 * durable before the effect, commit follows an applied result, and failed or
 * cancelled work closes as recovery evidence without allowing a late commit.
 */
export async function executeMcpWriteWithReceipt(input: Readonly<{
  service: ProjectAgentProposalReceiptService
  kind: McpWriteReceiptKind
  operation: string
  requestId?: string
  signal?: AbortSignal
  execute: (proposalId: string) => Promise<unknown>
}>): Promise<unknown> {
  if (input.signal?.aborted) throw cancellationError(input.signal)
  const proposalId = proposalIdFor(input.kind, input.requestId)
  const proposal = proposalFor({ proposalId, kind: input.kind, operation: input.operation })
  const current = input.service.read()
  const preparing = input.service.write({
    expectedRevision: current?.revision ?? 0,
    proposalId,
    operationId: `mcp-${input.kind}-prepare:${proposalId}`,
    lifecycle: 'preparing',
    proposal,
  })
  try {
    if (input.signal?.aborted) throw cancellationError(input.signal)
    const result = await input.execute(proposalId)
    if (input.signal?.aborted) throw cancellationError(input.signal)
    if (!result || typeof result !== 'object' || (result as { applied?: unknown }).applied !== true) {
      throw new Error('capability_execution_failed')
    }
    input.service.write({
      expectedRevision: preparing.revision,
      proposalId,
      operationId: `mcp-${input.kind}-commit:${proposalId}`,
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
        operationId: `mcp-${input.kind}-failed:${proposalId}`,
        lifecycle: 'undone',
      })
    } catch {
      // Preserve the original failure; the orphan is evidence for recovery.
    }
    throw error
  }
}

export async function executeMcpDocumentWriteWithReceipt(input: Readonly<{
  service: ProjectAgentProposalReceiptService
  operation: string
  execute: () => Promise<unknown>
}>): Promise<unknown> {
  return executeMcpWriteWithReceipt({
    service: input.service,
    kind: 'document',
    operation: input.operation,
    execute: () => input.execute(),
  })
}

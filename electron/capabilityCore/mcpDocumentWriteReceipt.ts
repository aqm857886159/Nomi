import crypto from 'node:crypto'

import type { ProjectAgentCommittedProposalRecord } from '../shared/projectAgentProposalReceipt'
import type { ProjectAgentProposalReceiptService } from '../projectAgentHost/projectAgentProposalReceiptStore'

type McpWriteReceiptKind = 'document' | 'canvas'
export type McpWriteEffectState = 'effect_unknown' | 'partial' | 'commit_failed'

export function markMcpWriteEffect(error: unknown, state: McpWriteEffectState): unknown {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return error
  try {
    Object.defineProperty(error, 'mcpWriteEffect', { value: state, configurable: true })
  } catch {
    try { (error as { mcpWriteEffect?: McpWriteEffectState }).mcpWriteEffect = state } catch { /* preserve original error */ }
  }
  return error
}

function effectState(error: unknown): McpWriteEffectState | undefined {
  const value = error && typeof error === 'object' ? (error as { mcpWriteEffect?: unknown }).mcpWriteEffect : undefined
  return value === 'effect_unknown' || value === 'partial' || value === 'commit_failed' ? value : undefined
}

function proposalFor(input: Readonly<{
  proposalId: string
  kind: McpWriteReceiptKind
  operation: string
  requestFingerprint?: string
}>): ProjectAgentCommittedProposalRecord {
  const requestHash = input.requestFingerprint
    ? crypto.createHash('sha256').update(`nomi-mcp-write-request\0${input.requestFingerprint}`).digest('hex')
    : undefined
  return {
    proposalId: input.proposalId,
    ...(requestHash ? { requestHash } : {}),
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
  requestFingerprint?: string
  signal?: AbortSignal
  execute: (proposalId: string) => Promise<unknown>
}>): Promise<unknown> {
  if (input.signal?.aborted) throw cancellationError(input.signal)
  const proposalId = proposalIdFor(input.kind, input.requestId)
  const proposal = proposalFor({ proposalId, kind: input.kind, operation: input.operation, requestFingerprint: input.requestFingerprint })
  input.service.reconcileInDoubt?.()
  const current = input.service.read()
  if (current?.proposalId === proposalId) {
    if (current.proposal.requestHash !== proposal.requestHash) {
      throw new Error('Project Agent proposal receipt operation conflicts with its first request')
    }
    if (current.lifecycle === 'committed') {
      return current.result ?? { applied: true, proposalId, operation: input.operation }
    }
    if (current.lifecycle === 'effect_unknown' || current.lifecycle === 'partial' || current.lifecycle === 'commit_failed') {
      throw new Error(`MCP write receipt is ${current.lifecycle}; manual reconciliation is required`)
    }
  }
  const preparing = input.service.write({
    expectedRevision: current?.revision ?? 0,
    proposalId,
    operationId: `mcp-${input.kind}-prepare:${proposalId}`,
    lifecycle: 'preparing',
    proposal,
  })
  try {
    const result = await input.execute(proposalId)
    const applied = Boolean(result && typeof result === 'object' && (result as { applied?: unknown }).applied === true)
    if (input.signal?.aborted) {
      if (applied) throw markMcpWriteEffect(cancellationError(input.signal), 'effect_unknown')
      throw cancellationError(input.signal)
    }
    if (!applied) {
      throw new Error('capability_execution_failed')
    }
    try {
      input.service.write({
        expectedRevision: preparing.revision,
        proposalId,
        operationId: `mcp-${input.kind}-commit:${proposalId}`,
        lifecycle: 'committed',
        proposal,
        result,
      })
    } catch (error) {
      throw markMcpWriteEffect(error, 'commit_failed')
    }
    return result
  } catch (error) {
    const lifecycle = effectState(error) ?? 'undone'
    try {
      input.service.transition({
        expectedRevision: preparing.revision,
        proposalId,
        operationId: `mcp-${input.kind}-failed:${proposalId}`,
        lifecycle,
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
  requestId?: string
  requestFingerprint?: string
  signal?: AbortSignal
  execute: () => Promise<unknown>
}>): Promise<unknown> {
  return executeMcpWriteWithReceipt({
    service: input.service,
    kind: 'document',
    operation: input.operation,
    requestId: input.requestId,
    requestFingerprint: input.requestFingerprint,
    signal: input.signal,
    execute: () => input.execute(),
  })
}

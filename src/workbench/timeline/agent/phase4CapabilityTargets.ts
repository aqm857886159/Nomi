import {
  assetReadSemanticInputSchema,
  type AssetReadResult,
} from '../../../../electron/shared/agentCapabilities/assetRead'
import {
  exportReadSemanticInputSchema,
  exportWriteSemanticInputSchema,
  type ExportReadResult,
  type ExportWriteResult,
} from '../../../../electron/shared/agentCapabilities/exportCapabilities'
import { SurfacePortWireError } from '../../../../electron/shared/surfacePortBinding'
import { createProposalReceiptCoordinator } from '../../generationCanvas/agent/proposalUndo'
import { applyExportToolCall } from './exportToolCall'
import { applyMediaToolCall } from './mediaToolCall'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function exactTarget(actual: unknown, expected: Record<string, unknown>): void {
  const value = record(actual)
  if (!value || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new SurfacePortWireError('capability_target_stale')
  }
}

export async function executeAssetReadTarget(request: Readonly<{
  input: unknown
  target: unknown
}>): Promise<AssetReadResult> {
  const parsed = assetReadSemanticInputSchema.safeParse(request.input)
  if (!parsed.success) throw new SurfacePortWireError('capability_input_invalid')
  const input = parsed.data
  exactTarget(request.target, {
    kind: 'asset',
    assetIds: 'assetId' in input ? [input.assetId] : [],
  })
  return applyMediaToolCall(input.operation, input) as Promise<AssetReadResult>
}

export async function executeExportReadTarget(request: Readonly<{
  input: unknown
  target: unknown
}>): Promise<ExportReadResult> {
  const parsed = exportReadSemanticInputSchema.safeParse(request.input)
  if (!parsed.success) throw new SurfacePortWireError('capability_input_invalid')
  exactTarget(request.target, { kind: 'export', jobId: parsed.data.jobId })
  return applyExportToolCall(parsed.data.operation, parsed.data) as Promise<ExportReadResult>
}

export async function executeExportWriteTarget(request: Readonly<{
  input: unknown
  target: unknown
  receiptProposalId: string
  approvalId: string
  actionHash: string
  signal: AbortSignal
  assertCurrent(): void
}>): Promise<ExportWriteResult> {
  const assertCurrent = (): void => {
    if (request.signal.aborted) throw new SurfacePortWireError('capability_cancelled')
    request.assertCurrent()
  }
  assertCurrent()
  const parsed = exportWriteSemanticInputSchema.safeParse(request.input)
  if (!parsed.success) throw new SurfacePortWireError('capability_input_invalid')
  const input = parsed.data
  exactTarget(
    request.target,
    input.operation === 'export_timeline'
      ? { kind: 'export', timelineRevision: input.expectedRevision }
      : { kind: 'export', jobId: input.jobId },
  )
  const receipts = createProposalReceiptCoordinator({
    summary: input.operation,
    stepLabels: [input.operation],
    hostApprovalId: request.approvalId,
    hostActionHash: request.actionHash,
    prepareCompensation: 'none',
  })
  const prior = await receipts.disposition(request.receiptProposalId)
  assertCurrent()
  if (prior === 'preparing' || prior === 'undoing') {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  if (prior === 'committed') {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  if (!await receipts.prepare(request.receiptProposalId, { nodes: [], edges: [], groups: [] })) {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  let effectStarted = false
  try {
    assertCurrent()
    effectStarted = true
    const result = await applyExportToolCall(input.operation, input) as ExportWriteResult
    assertCurrent()
    const committed = await receipts.commit({
      proposalId: request.receiptProposalId,
      compensation: [],
      watchNodes: [],
      reconciliationOk: true,
    })
    if (!committed) throw new SurfacePortWireError('capability_receipt_unresolved')
    return result
  } catch (error) {
    if (!effectStarted) await receipts.abort(request.receiptProposalId).catch(() => undefined)
    throw error
  }
}

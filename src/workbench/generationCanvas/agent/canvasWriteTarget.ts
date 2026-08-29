import {
  assertCanvasWriteAdmissionMatches,
  CanvasWriteEvidenceError,
  canvasWriteRawEvidenceSchema,
  type CanvasWriteRawEvidence,
} from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import {
  canvasWriteSemanticInputSchema,
  type CanvasWriteResult,
} from '../../../../electron/shared/agentCapabilities/canvasWrite'
import { SurfacePortWireError } from '../../../../electron/shared/surfacePortBinding'
import type { GenerationCanvasSnapshot, GenerationNodeResult } from '../model/generationCanvasTypes'
import { buildStepDetailLabels, summarizeToolCall } from '../components/toolCallSummary'
import { resolveCanvasToolNodeId } from './clientIdRegistry'
import { createProposalReceiptCoordinator } from './proposalUndo'
import { applyProposalBatch } from './proposalTxn'

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(meta: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = trimmedString(meta[key])
    if (value) return value
  }
  return null
}

function resultPointer(result: GenerationNodeResult | undefined): CanvasWriteRawEvidence['node']['currentResult'] {
  if (!result) return null
  return {
    id: result.id,
    type: result.type,
    ...(trimmedString(result.taskId) ? { taskId: trimmedString(result.taskId)! } : {}),
    ...(trimmedString(result.assetId) ? { assetId: trimmedString(result.assetId)! } : {}),
    ...(trimmedString(result.assetRefId) ? { assetRefId: trimmedString(result.assetRefId)! } : {}),
  }
}

export function captureCanvasWriteRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  requestedNodeId: string,
  resolveNodeId: (nodeId: string) => string = resolveCanvasToolNodeId,
): CanvasWriteRawEvidence {
  const canonicalNodeId = resolveNodeId(requestedNodeId.trim())
  const node = snapshot.nodes.find((candidate) => candidate.id === canonicalNodeId)
  if (!node) throw new CanvasWriteEvidenceError('capability_target_stale')

  const meta = node.meta ?? {}
  const archetype = meta.archetype && typeof meta.archetype === 'object' && !Array.isArray(meta.archetype)
    ? meta.archetype as Record<string, unknown>
    : {}
  const evidence = {
    node: {
      id: node.id,
      kind: node.kind,
      title: node.title,
      prompt: node.prompt ?? '',
      locked: Boolean(node.locked),
      categoryId: trimmedString(node.categoryId),
      groupId: trimmedString(node.groupId),
      model: {
        modelKey: firstString(meta, ['modelKey', 'modelAlias', 'imageModel', 'videoModel']),
        vendorKey: firstString(meta, ['modelVendor', 'vendor', 'imageModelVendor', 'videoModelVendor']),
        archetypeId: trimmedString(archetype.id),
        modeId: trimmedString(archetype.modeId),
        variantId: trimmedString(archetype.variantId),
      },
      currentResult: resultPointer(node.result),
    },
    groups: snapshot.groups
      .filter((group) => group.id === node.groupId || group.nodeIds.includes(node.id))
      .map((group) => ({ id: group.id, categoryId: group.categoryId, nodeIds: [...group.nodeIds] })),
  }
  const parsed = canvasWriteRawEvidenceSchema.safeParse(evidence)
  if (!parsed.success) throw new CanvasWriteEvidenceError('capability_input_invalid')
  return parsed.data
}

export type CanvasWriteTargetExecution = Readonly<{
  input: unknown
  target: unknown
  preconditions: unknown
  receiptProposalId: string
  approvalId: string
  actionHash: string
}>

function wireError(error: unknown): SurfacePortWireError {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return new SurfacePortWireError(
    code === 'capability_input_invalid' || code === 'capability_target_stale'
      ? code
      : 'capability_receipt_unresolved',
  )
}

export async function executeCanvasWriteTarget(
  request: CanvasWriteTargetExecution,
  readSnapshot: () => GenerationCanvasSnapshot,
): Promise<CanvasWriteResult> {
  const parsed = canvasWriteSemanticInputSchema.safeParse(request.input)
  if (!parsed.success) throw new SurfacePortWireError('capability_input_invalid')
  const input = parsed.data
  const receiptCoordinator = createProposalReceiptCoordinator({
    summary: summarizeToolCall(input.operation, input),
    stepLabels: buildStepDetailLabels(input.operation, input),
    hostApprovalId: request.approvalId,
    hostActionHash: request.actionHash,
  })
  let admittedNodeId: string | undefined
  let outcome: Awaited<ReturnType<typeof applyProposalBatch>>
  try {
    outcome = await applyProposalBatch(
      [{ toolCallId: request.approvalId, toolName: input.operation, effectiveArgs: input }],
      undefined,
      receiptCoordinator,
      {
        proposalId: request.receiptProposalId,
        beforePrepare() {
          try {
            const admission = assertCanvasWriteAdmissionMatches(
              captureCanvasWriteRawEvidence(readSnapshot(), input.nodeId),
              { target: request.target, preconditions: request.preconditions },
            )
            admittedNodeId = admission.target.nodeIds[0]
          } catch (error) {
            throw wireError(error)
          }
        },
      },
    )
  } catch (error) {
    throw wireError(error)
  }
  if (outcome.status !== 'committed') {
    throw wireError(Object.assign(new Error(outcome.reason), {
      code: outcome.reason === 'capability_input_invalid' || outcome.reason === 'capability_target_stale'
        ? outcome.reason
        : 'capability_receipt_unresolved',
    }))
  }
  if (!admittedNodeId) throw new SurfacePortWireError('capability_receipt_unresolved')
  return {
    applied: true,
    proposalId: outcome.proposalId,
    operation: input.operation,
    affectedNodeIds: [admittedNodeId],
    reconciliation: {
      ok: outcome.reconciliation.ok,
      deviationCount: outcome.reconciliation.deviations.length,
    },
  }
}

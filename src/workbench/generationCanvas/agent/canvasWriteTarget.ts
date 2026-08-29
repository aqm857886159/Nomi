import {
  assertCanvasWriteAdmissionMatches,
  canvasWriteBatchRawEvidenceSchema,
  CanvasWriteEvidenceError,
  canvasWriteRawEvidenceSchema,
  type CanvasWriteBatchRawEvidence,
  type CanvasWriteRawEvidence,
} from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import {
  canvasWriteSemanticInputSchema,
  type CanvasWriteInput,
  type CanvasWriteOperation,
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

function nodeModelEvidence(
  node: GenerationCanvasSnapshot['nodes'][number],
): CanvasWriteBatchRawEvidence['nodes'][number]['model'] {
  const meta = node.meta ?? {}
  const archetype =
    meta.archetype && typeof meta.archetype === 'object' && !Array.isArray(meta.archetype)
      ? (meta.archetype as Record<string, unknown>)
      : {}
  const read = (keys: readonly string[]): string | null => {
    for (const key of keys) {
      const value = meta[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
  const optional = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
  return {
    modelKey: read(['modelKey', 'modelAlias', 'imageModel', 'videoModel']),
    vendorKey: read(['modelVendor', 'vendor', 'imageModelVendor', 'videoModelVendor']),
    archetypeId: optional(archetype.id),
    modeId: optional(archetype.modeId),
    variantId: optional(archetype.variantId),
  }
}

export function captureCanvasWriteBatchRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  input?: Exclude<CanvasWriteInput, { operation: 'set_node_prompt' }>,
): CanvasWriteBatchRawEvidence {
  const requestedIds =
    input?.operation === 'tidy_canvas'
      ? []
      : (input?.edges ?? []).flatMap((edge) => [edge.sourceClientId, edge.targetClientId])
  const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id))
  const resolvedReferences = Array.from(new Set(requestedIds)).flatMap((requestedId) => {
    const nodeId = resolveCanvasToolNodeId(requestedId)
    return knownNodeIds.has(nodeId) ? [{ requestedId, nodeId }] : []
  })
  const evidence = {
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      prompt: node.prompt ?? '',
      locked: Boolean(node.locked),
      categoryId: typeof node.categoryId === 'string' && node.categoryId.trim() ? node.categoryId.trim() : null,
      groupId: typeof node.groupId === 'string' && node.groupId.trim() ? node.groupId.trim() : null,
      position: {
        x: Number.isFinite(node.position.x) ? node.position.x : 0,
        y: Number.isFinite(node.position.y) ? node.position.y : 0,
      },
      model: nodeModelEvidence(node),
      currentResult: resultPointer(node.result),
    })),
    edges: snapshot.edges.map((edge, index) => ({
      id: edge.id || `edge-${index + 1}`,
      source: edge.source,
      target: edge.target,
      mode: edge.mode ?? 'reference',
      ...(typeof edge.order === 'number' ? { order: edge.order } : {}),
    })),
    groups: snapshot.groups.map((group) => ({
      id: group.id,
      categoryId: group.categoryId,
      nodeIds: [...group.nodeIds],
    })),
    resolvedReferences,
  }
  const parsed = canvasWriteBatchRawEvidenceSchema.safeParse(evidence)
  if (!parsed.success) throw new CanvasWriteEvidenceError('capability_input_invalid')
  return parsed.data
}

export function captureCanvasWriteRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  requestedNodeId: string | Readonly<{ operation: CanvasWriteOperation; input?: unknown }>,
  resolveNodeId: (nodeId: string) => string = resolveCanvasToolNodeId,
): CanvasWriteRawEvidence | CanvasWriteBatchRawEvidence {
  if (typeof requestedNodeId !== 'string') {
    if (requestedNodeId.operation === 'set_node_prompt') {
      const input =
        requestedNodeId.input && typeof requestedNodeId.input === 'object'
          ? (requestedNodeId.input as Record<string, unknown>)
          : {}
      return captureCanvasWriteRawEvidence(snapshot, String(input.nodeId ?? ''), resolveNodeId)
    }
    const parsed = canvasWriteSemanticInputSchema.safeParse(requestedNodeId.input)
    return captureCanvasWriteBatchRawEvidence(
      snapshot,
      parsed.success && parsed.data.operation !== 'set_node_prompt' ? parsed.data : undefined,
    )
  }
  const canonicalNodeId = resolveNodeId(requestedNodeId.trim())
  const node = snapshot.nodes.find((candidate) => candidate.id === canonicalNodeId)
  if (!node) throw new CanvasWriteEvidenceError('capability_target_stale')

  const meta = node.meta ?? {}
  const archetype =
    meta.archetype && typeof meta.archetype === 'object' && !Array.isArray(meta.archetype)
      ? (meta.archetype as Record<string, unknown>)
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
    code === 'capability_input_invalid' || code === 'capability_target_stale' ? code : 'capability_receipt_unresolved',
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
  const beforeSnapshot = readSnapshot()
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
              captureCanvasWriteRawEvidence(
                readSnapshot(),
                input.operation === 'set_node_prompt' ? input.nodeId : { operation: input.operation, input },
              ),
              { target: request.target, preconditions: request.preconditions },
              input,
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
    throw wireError(
      Object.assign(new Error(outcome.reason), {
        code:
          outcome.reason === 'capability_input_invalid' || outcome.reason === 'capability_target_stale'
            ? outcome.reason
            : 'capability_receipt_unresolved',
      }),
    )
  }
  const afterSnapshot = readSnapshot()
  const reconciliation = {
    ok: outcome.reconciliation.ok,
    deviationCount: outcome.reconciliation.deviations.length,
  }
  if (input.operation === 'set_node_prompt') {
    if (!admittedNodeId) throw new SurfacePortWireError('capability_receipt_unresolved')
    return {
      applied: true,
      proposalId: outcome.proposalId,
      operation: input.operation,
      affectedNodeIds: [admittedNodeId],
      reconciliation,
    } satisfies CanvasWriteResult
  }
  if (input.operation === 'create_canvas_nodes') {
    const createdNodeIds = afterSnapshot.nodes
      .filter((node) => !beforeSnapshot.nodes.some((before) => before.id === node.id))
      .map((node) => node.id)
    const createdEdgeIds = afterSnapshot.edges
      .filter((edge) => !beforeSnapshot.edges.some((before) => before.id === edge.id))
      .map((edge) => edge.id)
    const result = (outcome.results[0] ?? {}) as Record<string, unknown>
    const skippedEdges = Array.isArray(result.skippedEdges) ? result.skippedEdges : []
    return {
      applied: true,
      proposalId: outcome.proposalId,
      operation: input.operation,
      reconciliation,
      affectedNodeIds: createdNodeIds,
      affectedEdgeIds: createdEdgeIds,
      clientIdToNodeId:
        result.clientIdToNodeId && typeof result.clientIdToNodeId === 'object'
          ? (result.clientIdToNodeId as Record<string, string>)
          : {},
      connectedCount: typeof result.connectedCount === 'number' ? result.connectedCount : 0,
      skippedEdges,
    } satisfies CanvasWriteResult
  }
  if (input.operation === 'connect_canvas_edges') {
    const createdEdgeIds = afterSnapshot.edges
      .filter((edge) => !beforeSnapshot.edges.some((before) => before.id === edge.id))
      .map((edge) => edge.id)
    const affectedNodeIds = Array.from(
      new Set(
        createdEdgeIds.flatMap((edgeId) => {
          const edge = afterSnapshot.edges.find((candidate) => candidate.id === edgeId)
          return edge ? [edge.source, edge.target] : []
        }),
      ),
    )
    const result = (outcome.results[0] ?? {}) as Record<string, unknown>
    return {
      applied: true,
      proposalId: outcome.proposalId,
      operation: input.operation,
      reconciliation,
      affectedNodeIds,
      affectedEdgeIds: createdEdgeIds,
      connectedCount: typeof result.connectedCount === 'number' ? result.connectedCount : createdEdgeIds.length,
      skippedEdges: Array.isArray(result.skippedEdges) ? result.skippedEdges : [],
    } satisfies CanvasWriteResult
  }
  const categoryId = input.categoryId ?? 'shots'
  return {
    applied: true,
    proposalId: outcome.proposalId,
    operation: input.operation,
    reconciliation,
    affectedNodeIds: afterSnapshot.nodes
      .filter((node) => (node.categoryId ?? 'shots') === categoryId)
      .map((node) => node.id),
    categoryId,
    nodeCount: afterSnapshot.nodes.filter((node) => (node.categoryId ?? 'shots') === categoryId).length,
  } satisfies CanvasWriteResult
}

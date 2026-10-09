import {
  assertCanvasWriteAdmissionMatches,
  canvasWriteBatchRawEvidenceSchema,
  CanvasWriteEvidenceError,
  canvasWriteEvidenceHash,
  canvasWriteRawEvidenceSchema,
  type CanvasWriteBatchRawEvidence,
  type CanvasWriteRawEvidence,
} from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import {
  canvasWriteSemanticInputSchema,
  type CanvasWriteInput,
  isNodeTargetedWriteOperation,
  type NodeTargetedWriteOperation,
  type CanvasWriteOperation,
  type CanvasWriteResult,
} from '../../../../electron/shared/agentCapabilities/canvasWrite'
import { makeChangeId } from '../../../../electron/shared/agentCapabilities/changeId'
import {
  canvasDeleteSemanticInputSchema,
  type CanvasDeleteInput,
  type CanvasDeleteResult,
} from '../../../../electron/shared/agentCapabilities/canvasDelete'
import {
  assertCanvasDeleteAdmissionMatches,
} from '../../../../electron/shared/agentCapabilities/canvasDeleteEvidence'
import { assertDirectorWriteAdmissionMatches } from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import {
  directorWriteReferenceIds,
  directorWriteResultSchema,
  directorWriteSemanticInputSchema,
  type DirectorWriteInput,
  type DirectorWriteResult,
} from '../../../../electron/shared/agentCapabilities/directorWrite'
import { surfacePortFailure, SurfacePortWireError } from '../../../../electron/shared/surfacePortBinding'
import type { GenerationCanvasSnapshot, GenerationNodeResult } from '../model/generationCanvasTypes'
import { textDocumentDigest } from '../runner/textGenerationDocument'
import { buildStepDetailLabels, summarizeToolCall } from '../components/toolCallSummary'
import { resolveCanvasToolNodeId } from './clientIdRegistry'
import { createProposalReceiptCoordinator } from './proposalUndo'
import { applyProposalBatch } from './proposalTxn'
import { useWorkbenchStore } from '../../workbenchStore'

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

function captureStoryboardTarget(input: CanvasWriteInput): CanvasWriteBatchRawEvidence['storyboard'] {
  if (input.operation !== 'propose_storyboard_plan' && input.operation !== 'patch_shots') return undefined
  const state = useWorkbenchStore.getState()
  const document = state.workbenchDocuments.find(item => item.id === state.activeDocumentId)
  if (!document) throw new CanvasWriteEvidenceError('capability_target_stale')
  const designs = state.storyboardDesignsByDocumentId[document.id] ?? []
  const design = state.activeStoryboardId
    ? designs.find(item => item.id === state.activeStoryboardId)
    : designs[0]
  if ((state.activeStoryboardId && !design) || (input.operation === 'patch_shots' && !design)) {
    throw new CanvasWriteEvidenceError('capability_target_stale')
  }
  return { documentId: document.id, storyboardId: design?.id ?? null,
    contentHash: canvasWriteEvidenceHash('storyboard', { document, design: design ?? null }) }
}

export function captureCanvasWriteBatchRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  input?: Exclude<CanvasWriteInput, { operation: NodeTargetedWriteOperation }>,
): CanvasWriteBatchRawEvidence {
  const requestedIds = (() => {
    if (!input || input.operation === 'tidy_canvas' || input.operation === 'propose_storyboard_plan' || input.operation === 'patch_shots') return []
    if (input.operation === 'arrange_storyboard_to_timeline') return [...input.nodeIds]
    if (input.operation === 'create_staging_reference' || input.operation === 'create_camera_move') {
      return input.shotClientId ? [input.shotClientId] : []
    }
    return (input.edges ?? []).flatMap((edge) => [edge.sourceClientId, edge.targetClientId])
  })()
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
    ...(input ? { storyboard: captureStoryboardTarget(input) } : {}),
  }
  const parsed = canvasWriteBatchRawEvidenceSchema.safeParse(evidence)
  if (!parsed.success) throw new CanvasWriteEvidenceError('capability_input_invalid')
  return parsed.data
}

/** 3D-BOX（director.write）取证：整张画布的批量证据 + 它点名的那一个节点（目标镜头 / 要改的 3D-BOX 节点）。 */
export function captureDirectorWriteRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  input: DirectorWriteInput,
): CanvasWriteBatchRawEvidence {
  const evidence = captureCanvasWriteBatchRawEvidence(snapshot)
  const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id))
  const resolvedReferences = directorWriteReferenceIds(input).flatMap((requestedId) => {
    const nodeId = resolveCanvasToolNodeId(requestedId)
    return knownNodeIds.has(nodeId) ? [{ requestedId, nodeId }] : []
  })
  const parsed = canvasWriteBatchRawEvidenceSchema.safeParse({ ...evidence, resolvedReferences })
  if (!parsed.success) throw new CanvasWriteEvidenceError('capability_input_invalid')
  return parsed.data
}

export function captureCanvasDeleteRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  input: CanvasDeleteInput,
): CanvasWriteBatchRawEvidence {
  const evidence = captureCanvasWriteBatchRawEvidence(snapshot)
  const knownNodeIds = new Set(snapshot.nodes.map((node) => node.id))
  const resolvedReferences = input.nodeIds.flatMap((requestedId) => {
    const nodeId = resolveCanvasToolNodeId(requestedId)
    return knownNodeIds.has(nodeId) ? [{ requestedId, nodeId }] : []
  })
  const parsed = canvasWriteBatchRawEvidenceSchema.safeParse({ ...evidence, resolvedReferences })
  if (!parsed.success) throw new CanvasWriteEvidenceError('capability_input_invalid')
  return parsed.data
}

export function captureCanvasWriteRawEvidence(
  snapshot: GenerationCanvasSnapshot,
  requestedNodeId: string | Readonly<{ operation: CanvasWriteOperation; input?: unknown }>,
  resolveNodeId: (nodeId: string) => string = resolveCanvasToolNodeId,
): CanvasWriteRawEvidence | CanvasWriteBatchRawEvidence {
  if (typeof requestedNodeId !== 'string') {
    if (isNodeTargetedWriteOperation(requestedNodeId.operation)) {
      const input =
        requestedNodeId.input && typeof requestedNodeId.input === 'object'
          ? (requestedNodeId.input as Record<string, unknown>)
          : {}
      return captureCanvasWriteRawEvidence(snapshot, String(input.nodeId ?? ''), resolveNodeId)
    }
    const parsed = canvasWriteSemanticInputSchema.safeParse(requestedNodeId.input)
    return captureCanvasWriteBatchRawEvidence(
      snapshot,
      parsed.success && !isNodeTargetedWriteOperation(parsed.data.operation)
        ? (parsed.data as Exclude<CanvasWriteInput, { operation: NodeTargetedWriteOperation }>) : undefined,
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
      ...(node.kind === 'text' ? { bodyHash: textDocumentDigest(node.contentJson) } : {}),
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
  /** Optional for direct MCP calls: only Host-claimed executions may carry Host correlation. */
  actionHash?: string
  signal: AbortSignal
  assertCurrent(): void
}>

function wireError(error: unknown): SurfacePortWireError {
  const failure = surfacePortFailure(error)
  return new SurfacePortWireError(failure.code, failure.reason)
}

function assertExecutionCurrent(request: CanvasWriteTargetExecution): void {
  if (request.signal.aborted) throw new SurfacePortWireError('capability_cancelled')
  request.assertCurrent()
}

export async function executeCanvasWriteTarget(
  request: CanvasWriteTargetExecution,
  readSnapshot: () => GenerationCanvasSnapshot,
): Promise<CanvasWriteResult | CanvasDeleteResult | DirectorWriteResult> {
  assertExecutionCurrent(request)
  const deleteParsed = canvasDeleteSemanticInputSchema.safeParse(request.input)
  if (deleteParsed.success) return executeCanvasDeleteTarget(request, deleteParsed.data, readSnapshot)
  const directorParsed = directorWriteSemanticInputSchema.safeParse(request.input)
  if (directorParsed.success) return executeDirectorWriteTarget(request, directorParsed.data, readSnapshot)
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
  const storyboardTarget = captureStoryboardTarget(input)
  let outcome: Awaited<ReturnType<typeof applyProposalBatch>>
  try {
    outcome = await applyProposalBatch(
      [{
        toolCallId: request.approvalId,
        // Keep the public canonical tool name all the way through the
        // proposal transaction; patch_shots is an args.operation, never a
        // direct tool name.
        toolName: input.operation === 'patch_shots' ? 'nomi_canvas_plan' : input.operation,
        effectiveArgs: input,
        ...(storyboardTarget ? { storyboardTarget } : {}),
      }],
      { canWrite: () => {
        assertExecutionCurrent(request)
        return true
      } },
      receiptCoordinator,
      {
        proposalId: request.receiptProposalId,
        beforeApply() {
          if (storyboardTarget && canvasWriteEvidenceHash('storyboard-target', captureStoryboardTarget(input))
            !== canvasWriteEvidenceHash('storyboard-target', storyboardTarget)) {
            throw new SurfacePortWireError('capability_target_stale')
          }
        },
        beforePrepare() {
          try {
            assertExecutionCurrent(request)
            const admission = assertCanvasWriteAdmissionMatches(
              captureCanvasWriteRawEvidence(
                readSnapshot(),
                input.operation === 'set_node_prompt' || input.operation === 'set_node_text' ? input.nodeId : { operation: input.operation, input },
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
  if (outcome.status !== 'committed') throw wireError(outcome.failure)
  const afterSnapshot = readSnapshot()
  const reconciliation = {
    ok: outcome.reconciliation.ok,
    deviationCount: outcome.reconciliation.deviations.length,
  }
  if (input.operation === 'set_node_prompt' || input.operation === 'set_node_text') {
    if (!admittedNodeId) throw new SurfacePortWireError('capability_receipt_unresolved')
    return {
      applied: true,
      proposalId: outcome.proposalId,
      changeId: makeChangeId('canvas', outcome.proposalId),
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
      changeId: makeChangeId('canvas', outcome.proposalId),
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
      changeId: makeChangeId('canvas', outcome.proposalId),
      operation: input.operation,
      reconciliation,
      affectedNodeIds,
      affectedEdgeIds: createdEdgeIds,
      connectedCount: typeof result.connectedCount === 'number' ? result.connectedCount : createdEdgeIds.length,
      skippedEdges: Array.isArray(result.skippedEdges) ? result.skippedEdges : [],
    } satisfies CanvasWriteResult
  }
  // Storyboard/staging/camera actions are domain-owned by applyCanvasToolCall,
  // but they still travel through the same canvas.write proposal/receipt
  // boundary.  Return the domain result inside a small canonical envelope so
  // the main executor can validate it instead of treating an approved call as
  // a generic no-op.
  if (
    input.operation === 'patch_shots' ||
    input.operation === 'propose_storyboard_plan' ||
    input.operation === 'arrange_storyboard_to_timeline' ||
    input.operation === 'create_staging_reference' ||
    input.operation === 'create_camera_move'
  ) {
    if (input.operation === 'patch_shots') {
      const domain = (outcome.results[0] ?? null) as { changedShotIndexes?: unknown; changedFields?: unknown } | null
      return {
        applied: true,
        proposalId: outcome.proposalId,
        changeId: makeChangeId('canvas', outcome.proposalId),
        operation: input.operation,
        changedShotIndexes: Array.isArray(domain?.changedShotIndexes)
          ? domain.changedShotIndexes.filter((value): value is number => typeof value === 'number')
          : [],
        changedFields: Array.isArray(domain?.changedFields)
          ? domain.changedFields.filter((value): value is string => typeof value === 'string')
          : [],
        result: outcome.results[0] ?? null,
        reconciliation,
      } satisfies CanvasWriteResult
    }
    return {
      applied: true,
      proposalId: outcome.proposalId,
      changeId: makeChangeId('canvas', outcome.proposalId),
      operation: input.operation,
      result: outcome.results[0] ?? null,
      reconciliation,
    } satisfies CanvasWriteResult
  }
  const categoryId = input.categoryId ?? 'shots'
  return {
    applied: true,
    proposalId: outcome.proposalId,
    changeId: makeChangeId('canvas', outcome.proposalId),
    operation: input.operation,
    reconciliation,
    affectedNodeIds: afterSnapshot.nodes
      .filter((node) => (node.categoryId ?? 'shots') === categoryId)
      .map((node) => node.id),
    categoryId,
    nodeCount: afterSnapshot.nodes.filter((node) => (node.categoryId ?? 'shots') === categoryId).length,
  } satisfies CanvasWriteResult
}

/**
 * 3D-BOX 计划写入：与画布写同一条提议事务（审批、收据、changeId、撤销日志）。领域拒绝也照常提交一条
 * 空收据（这一步什么都没写），把原因交回主进程翻给模型——传输错误码装不下「当前修订号是什么」。
 */
async function executeDirectorWriteTarget(
  request: CanvasWriteTargetExecution,
  input: DirectorWriteInput,
  readSnapshot: () => GenerationCanvasSnapshot,
): Promise<DirectorWriteResult> {
  assertExecutionCurrent(request)
  const receiptCoordinator = createProposalReceiptCoordinator({
    summary: summarizeToolCall(input.operation, input),
    stepLabels: buildStepDetailLabels(input.operation, input),
    hostApprovalId: request.approvalId,
    hostActionHash: request.actionHash,
  })
  const referenceIds = directorWriteReferenceIds(input)
  let outcome: Awaited<ReturnType<typeof applyProposalBatch>>
  try {
    outcome = await applyProposalBatch(
      [{ toolCallId: request.approvalId, toolName: input.operation, effectiveArgs: input as unknown as Record<string, unknown> }],
      { canWrite: () => {
        assertExecutionCurrent(request)
        return true
      } },
      receiptCoordinator,
      {
        proposalId: request.receiptProposalId,
        beforePrepare() {
          try {
            assertExecutionCurrent(request)
            assertDirectorWriteAdmissionMatches(
              captureDirectorWriteRawEvidence(readSnapshot(), input),
              { target: request.target, preconditions: request.preconditions },
              referenceIds,
            )
          } catch (error) {
            throw wireError(error)
          }
        },
      },
    )
  } catch (error) {
    throw wireError(error)
  }
  if (outcome.status !== 'committed') throw wireError(outcome.failure)
  const domain = (outcome.results[0] ?? null) as Record<string, unknown> | null
  if (!domain) throw new SurfacePortWireError('capability_receipt_unresolved')
  const parsed = directorWriteResultSchema.safeParse(domain.applied === true
    ? { ...domain, proposalId: outcome.proposalId, changeId: makeChangeId('canvas', outcome.proposalId), operation: input.operation }
    : { ...domain, proposalId: outcome.proposalId, operation: input.operation })
  if (!parsed.success) throw new SurfacePortWireError('capability_execution_failed')
  return parsed.data
}

async function executeCanvasDeleteTarget(
  request: CanvasWriteTargetExecution,
  input: CanvasDeleteInput,
  readSnapshot: () => GenerationCanvasSnapshot,
): Promise<CanvasDeleteResult> {
  assertExecutionCurrent(request)
  const receiptCoordinator = createProposalReceiptCoordinator({
    summary: summarizeToolCall(input.operation, input),
    stepLabels: buildStepDetailLabels(input.operation, input),
    hostApprovalId: request.approvalId,
    hostActionHash: request.actionHash,
  })
  const beforeSnapshot = readSnapshot()
  let outcome: Awaited<ReturnType<typeof applyProposalBatch>>
  try {
    outcome = await applyProposalBatch(
      [{ toolCallId: request.approvalId, toolName: input.operation, effectiveArgs: input }],
      { canWrite: () => {
        assertExecutionCurrent(request)
        return true
      } },
      receiptCoordinator,
      {
        proposalId: request.receiptProposalId,
        beforePrepare() {
          try {
            assertExecutionCurrent(request)
            assertCanvasDeleteAdmissionMatches(
              captureCanvasDeleteRawEvidence(readSnapshot(), input),
              input,
              { target: request.target, preconditions: request.preconditions },
            )
          } catch (error) {
            throw wireError(error)
          }
        },
      },
    )
  } catch (error) {
    throw wireError(error)
  }
  if (outcome.status !== 'committed') throw wireError(outcome.failure)
  const afterIds = new Set(readSnapshot().nodes.map((node) => node.id))
  const deletedNodeIds = beforeSnapshot.nodes
    .filter((node) => !afterIds.has(node.id) && (request.target as { nodeIds?: unknown }).nodeIds instanceof Array &&
      (request.target as { nodeIds: string[] }).nodeIds.includes(node.id))
    .map((node) => node.id)
  if (deletedNodeIds.length !== input.nodeIds.length) {
    throw new SurfacePortWireError('capability_receipt_unresolved')
  }
  return {
    operation: input.operation,
    applied: true,
    proposalId: outcome.proposalId,
    deletedNodeIds,
    reconciliation: {
      ok: outcome.reconciliation.ok,
      deviationCount: outcome.reconciliation.deviations.length,
    },
  }
}

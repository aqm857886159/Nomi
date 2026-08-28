import type { ToolCallEvent } from '../../ai/workbenchAgentRunner'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { listAvailableModelsForAgent } from './availableModels'
import { resolvePlannedNodeArgs } from './plannedNodeMeta'
import { partitionConnectableEdges, type PlannedEdgeLike } from './referenceEdgeCapability'
import type { ProposalStep } from './proposalTxn'
import { assertTurnCanWrite, type AgentTurnHandle } from '../../ai/agentTurnLifecycle'
import {
  firstCanvasAssistantTimelineAnchor,
  type CanvasAssistantTimelineAnchor,
} from './canvasAssistantTimelineAnchor'

export type CanvasApprovalRequest = { toolCallId: string; overrides?: Record<string, unknown> }

export type PendingCallStore<Call> = Readonly<{
  get(toolCallId: string): Call | undefined
  delete(toolCallId: string): boolean
}>

export type CanvasApprovalStep = ProposalStep & {
  overridesDelta?: Record<string, unknown>
  transport: ToolCallEvent['confirm']
}

/** Claim the entire visible batch synchronously. Missing/expired calls reject
 * the batch, never reduce it to a different set of user-approved operations. */
export function claimCanvasApprovalBatch<Call extends ToolCallEvent & Partial<CanvasAssistantTimelineAnchor>>(
  requests: CanvasApprovalRequest[],
  pending: PendingCallStore<Call> | Map<string, Call>,
  turn: AgentTurnHandle,
  hostTurnId: string,
) {
  if (
    !turn.canWrite() ||
    !requests.length ||
    new Set(requests.map((request) => request.toolCallId)).size !== requests.length
  )
    return null
  const items: Array<{ request: CanvasApprovalRequest; call: Call }> = []
  for (const request of requests) {
    const call = pending.get(request.toolCallId)
    if (!call || call.turnId !== hostTurnId || !call.isPending()) return null
    items.push({ request, call })
  }
  for (const { call } of items) pending.delete(call.toolCallId)
  const rawSteps: CanvasApprovalStep[] = items.map(({ request, call }) => {
    const baseArgs = call.args && typeof call.args === 'object' ? (call.args as Record<string, unknown>) : {}
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      effectiveArgs: { ...baseArgs, ...request.overrides },
      overridesDelta: request.overrides,
      transport: call.confirm,
    }
  })
  return {
    items,
    rawSteps,
    timelineAnchor: firstCanvasAssistantTimelineAnchor(items.map(({ call }) => call)),
    // Execution eligibility is call/turn-scoped. The transaction itself owns
    // the loaded-canvas identity used for compensation after this expires.
    owner: { canWrite: () => turn.canWrite() && items.every(({ call }) => call.isPending()) },
  }
}

/** Resolve the exact approved values with the existing model/edge rules before
 * the same proposal executor applies them. It does not perform any mutation. */
export async function resolveCanvasApprovalSteps(
  rawSteps: CanvasApprovalStep[],
  canWrite: () => boolean,
): Promise<CanvasApprovalStep[]> {
  assertTurnCanWrite(canWrite)
  const needsModels = rawSteps.some(
    (step) =>
      step.toolName === 'create_canvas_nodes' &&
      Array.isArray(step.effectiveArgs.nodes) &&
      step.effectiveArgs.nodes.some(
        (node) => node && typeof node === 'object' && typeof (node as Record<string, unknown>).modelKey === 'string',
      ),
  )
  const entryByKey = needsModels
    ? new Map((await listAvailableModelsForAgent()).map((entry) => [entry.modelKey, entry]))
    : new Map()
  assertTurnCanWrite(canWrite)
  const nodeResolvedSteps = rawSteps.map((step) => {
    const args = step.effectiveArgs
    if (step.toolName !== 'create_canvas_nodes' || !Array.isArray(args.nodes)) return step
    const nodes = (args.nodes as Record<string, unknown>[]).map((node) =>
      node && typeof node === 'object' ? resolvePlannedNodeArgs(node, entryByKey) : node,
    )
    return { ...step, effectiveArgs: { ...args, nodes } }
  })
  const plannedById = new Map<string, GenerationCanvasNode>()
  for (const step of nodeResolvedSteps) {
    const args = step.effectiveArgs
    if (step.toolName !== 'create_canvas_nodes' || !Array.isArray(args.nodes)) continue
    for (const node of args.nodes as Record<string, unknown>[]) {
      if (node && typeof node === 'object' && typeof node.clientId === 'string') {
        plannedById.set(node.clientId, {
          id: node.clientId,
          kind: node.kind,
          meta: typeof node.modelKey === 'string' ? { modelKey: node.modelKey } : {},
        } as GenerationCanvasNode)
      }
    }
  }
  const existingById = new Map(readGenerationCanvasSnapshot().nodes.map((node) => [node.id, node]))
  const resolveNodeForEdge = (id: string): GenerationCanvasNode | null =>
    plannedById.get(id) ?? existingById.get(id) ?? null
  return nodeResolvedSteps.map((step) => {
    if (!Array.isArray(step.effectiveArgs.edges)) return step
    const { connectable } = partitionConnectableEdges(step.effectiveArgs.edges as PlannedEdgeLike[], resolveNodeForEdge)
    return { ...step, effectiveArgs: { ...step.effectiveArgs, edges: connectable } }
  })
}

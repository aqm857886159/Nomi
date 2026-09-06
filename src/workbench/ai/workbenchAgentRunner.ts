import type { AgentAttachmentPayload, AgentsChatResponseDto } from '../../api/desktopClient'
import type {
  AgentChatCapability,
  AgentChatToolDecision,
  AgentToolProfile,
} from '../../../electron/harness/agentChatContracts'
import type { ProjectAgentExecutionRequest } from '../../../electron/shared/contracts/agentChatContracts'
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentAttachmentClaim,
  ProjectAgentAssistantTextAnchor,
  ProjectAgentHostState,
  ProjectAgentStatus,
  ProjectAgentOriginSurfaceRef,
  ProjectAgentApprovalPolicy,
  ProjectAgentWorkMode,
} from '../../../electron/shared/projectAgentContracts'
import type { PreconditionSet, TargetRef } from '../../../electron/shared/capabilityTargeting'
import type {
  CapturedCanvasReadSnapshotHandleWire,
  SurfacePortBindingWire,
} from '../../../electron/shared/surfacePortBinding'
import { freezeAgentContextSnapshot, type AgentContextSnapshot } from '../../../electron/shared/agentContextSnapshot'
import { getAssistantModelPref } from './assistantModelPref'
import {
  decideProjectAgentTool,
  enqueueProjectAgentTurn,
  stopProjectAgentTurn,
  subscribeProjectAgentEvents,
} from './projectAgentTurnCommands'
import { projectAgentProjectionStore } from './projectAgentProjectionStore'
import { useAgentUsageStore } from './agentUsageStore'


export type ToolCallEvent = {
  turnId: string
  /** Host transport identity used by non-semantic panel registries. */
  subscriptionId?: string
  subscriptionEpoch?: number
  executionToken?: string
  toolCallId: string
  toolName: string
  args: unknown
  assistantTextAnchor?: ProjectAgentAssistantTextAnchor
  isPending: () => boolean
  confirm: (decision: AgentChatToolDecision) => Promise<void>
}

export type ProjectAgentToolError = {
  toolCallId: string
  toolName: string
  message: string
  denied?: boolean
  cancelled?: boolean
}

export type RunWorkbenchAgentInput = {
  turnId?: string
  prompt: string
  systemPrompt?: string
  displayPrompt: string
  capability: AgentChatCapability
  featureKey?: string
  selectedNodeIds?: readonly string[]
  skillKey: string
  skillName: string
  projectId?: string
  surfaceBinding?: SurfacePortBindingWire
  capturedCanvasReadSnapshot?: CapturedCanvasReadSnapshotHandleWire
  mode?: 'auto' | 'chat'
  /** User-facing execution posture; independent from approval/spend policy. */
  workMode?: ProjectAgentWorkMode
  /** Explicit Host approval/spend snapshot; omitted values remain safe-default. */
  approvalPolicy?: ProjectAgentApprovalPolicy
  attachments?: AgentAttachmentPayload[]
  /** Immutable current document/node/clip selection captured immediately before enqueue. */
  contextSnapshot?: AgentContextSnapshot
  attachmentClaims?: readonly ProjectAgentAttachmentClaim[]
  onContent?: (delta: string, text: string) => void
  onToolCall?: (event: ToolCallEvent) => void | Promise<void>
  onToolError?: (error: ProjectAgentToolError) => void
  onCancelReady?: (cancel: () => void) => void
  onEnqueued?: (result: { queueItemId: string; turnId: string; userItemId: string }) => void
  /** Optional exact domain target captured by a surface owner before enqueue. */
  target?: TargetRef
  preconditions?: PreconditionSet
  originSurface?: ProjectAgentOriginSurfaceRef
  /** Optional Host-selected profile for a surface-specific tool projection. */
  toolProfile?: AgentToolProfile
}

type ObservedToolCall = {
  toolCallId: string
  toolName: string
  args: unknown
  pending: boolean
  decision?: AgentChatToolDecision
}

const EMPTY_USAGE = Object.freeze({
  promptTokens: 0,
  completionTokens: 0,
  cachedPromptTokens: 0,
  totalTokens: 0,
})

function isTerminal(status: ProjectAgentStatus | undefined): boolean {
  return Boolean(status && !['queued', 'drafting', 'proposed', 'running'].includes(status))
}

function responseStatus(status: ProjectAgentStatus): AgentsChatResponseDto['status'] {
  if (status === 'stopped' || status === 'declined') return 'cancelled'
  if (status === 'failed') return 'error'
  return 'finished'
}

/** History is deliberately absent: the Host owns a thread's conversation context. */
function buildRequest(input: RunWorkbenchAgentInput): ProjectAgentExecutionRequest {
  const pref = getAssistantModelPref()
  // The Host context resolver intentionally reads the canonical nested skill
  // identity (`chatContext.skill`).  Keep the renderer-facing convenience
  // fields (`skillKey`/`skillName`) for attribution and queue snapshots, but
  // bridge them into that one runtime contract here so selecting a Skill in
  // the resident composer actually loads its body instead of merely drawing a
  // chip.  This is projection data, not a second Skill owner.
  return {
    prompt: input.prompt,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    displayPrompt: input.displayPrompt,
    capability: input.capability,
    ...(input.featureKey ? { featureKey: input.featureKey } : {}),
    ...(input.selectedNodeIds ? { selectedNodeIds: [...input.selectedNodeIds] } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    skillKey: input.skillKey,
    skillName: input.skillName,
    chatContext: {
      skill: {
        key: input.skillKey,
        name: input.skillName,
      },
    },
    mode: input.mode ?? 'auto',
    ...(input.workMode ? { workMode: input.workMode } : {}),
    ...(input.toolProfile ? { toolProfile: input.toolProfile } : {}),
    ...(pref ? { agentModelKey: pref.modelKey, agentVendorKey: pref.vendorKey } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments.map((item) => ({ ...item })) } : {}),
    ...(input.contextSnapshot ? { contextSnapshot: freezeAgentContextSnapshot(input.contextSnapshot) } : {}),
  }
}

function turnTarget(input: RunWorkbenchAgentInput) {
  if (input.target) {
    return {
      target: input.target,
      ...(input.preconditions ? { preconditions: input.preconditions } : {}),
      originSurface: input.originSurface ?? { surfaceId: 'workbench-agent-runner', kind: 'project' as const },
    }
  }
  if (input.capability.startsWith('canvas-') || input.capability === 'storyboard') {
    return {
      target: { kind: 'canvas' as const, nodeIds: Object.freeze([...(input.selectedNodeIds ?? [])]) },
      originSurface: { surfaceId: 'workbench-agent-runner', kind: 'canvas' as const },
    }
  }
  const projectId = projectAgentProjectionStore.getState().snapshot?.binding.projectId ?? input.projectId ?? 'active'
  return {
    target: {
      kind: 'document' as const,
      documentId: `${projectId}:document`,
      anchor: { kind: 'whole-document' as const },
    },
    originSurface: { surfaceId: 'workbench-agent-runner', kind: 'document' as const },
  }
}

function assistantText(state: ProjectAgentHostState, turnId: string): string {
  const item = state.items.find((candidate) => candidate.kind === 'assistant' && candidate.turnId === turnId)
  return item?.kind === 'assistant' ? item.text : ''
}

/** Existing workbench callers observe one canonical ProjectAgentHost turn. */
export async function runWorkbenchAgent(input: RunWorkbenchAgentInput): Promise<AgentsChatResponseDto> {
  if (input.surfaceBinding && input.capturedCanvasReadSnapshot) {
    throw new Error('canvas read admission must be unique')
  }
  const snapshot = projectAgentProjectionStore.getState().snapshot
  if (!snapshot) throw new Error('project_agent_unavailable')
  if (input.projectId && input.projectId !== snapshot.binding.projectId) throw new Error('project_binding_stale')

  const turnId = input.turnId ?? `turn-workbench-${globalThis.crypto.randomUUID()}`
  const tools = new Map<string, ObservedToolCall>()
  let lastText = ''
  let executionError: Error | null = null
  const execution = { result: null as AgentsChatResponseDto | null }
  let settled = false
  let resolveTerminal!: (state: ProjectAgentHostState) => void
  const terminal = new Promise<ProjectAgentHostState>((resolve) => {
    resolveTerminal = resolve
  })

  const observeState = (): void => {
    const current = projectAgentProjectionStore.getState().snapshot
    if (!current) return
    const text = assistantText(current, turnId)
    if (text !== lastText) {
      const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text
      lastText = text
      if (delta) input.onContent?.(delta, text)
    }
    const status = current.turns.find((turn) => turn.turnId === turnId)?.status
    const resultRequired = status === 'done' || status === 'stopped' || (status === 'failed' && !executionError)
    if (!settled && isTerminal(status) && (!resultRequired || execution.result)) {
      settled = true
      for (const tool of tools.values()) tool.pending = false
      resolveTerminal(current)
    }
  }

  const unsubscribeState = projectAgentProjectionStore.subscribe(observeState)
  const unsubscribeEvents = subscribeProjectAgentEvents((event: ProjectAgentExecutionEvent) => {
    if (event.type === 'patch' || event.turnId !== turnId) return
    if (event.type === 'execution-error') {
      executionError = new Error(event.message)
      observeState()
      return
    }
    if (event.type === 'execution-result') {
      execution.result = event.response
      for (const record of event.response.toolCalls) {
        const observed = tools.get(record.toolCallId)
        if (observed) observed.pending = false
        if (record.status === 'ok') continue
        const denied = record.status === 'denied'
        const cancelled = record.status === 'cancelled'
        input.onToolError?.({
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          message:
            record.error ??
            (record.decision && !record.decision.ok ? record.decision.message : undefined) ??
            (cancelled ? 'Agent tool call was cancelled' : denied ? 'Agent tool call was denied' : 'Agent tool call failed'),
          ...(denied ? { denied: true } : {}),
          ...(cancelled ? { cancelled: true } : {}),
        })
      }
      observeState()
      return
    }
    const observed: ObservedToolCall = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      pending: true,
    }
    tools.set(event.toolCallId, observed)
    const call: ToolCallEvent = {
      turnId,
      subscriptionId: event.subscriptionId,
      subscriptionEpoch: event.subscriptionEpoch,
      executionToken: event.executionToken,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      ...(event.assistantTextAnchor ? { assistantTextAnchor: event.assistantTextAnchor } : {}),
      isPending: () => !settled && observed.pending && tools.get(event.toolCallId) === observed,
      confirm: async (decision) => {
        if (!call.isPending()) throw new DOMException('Agent tool call is no longer pending', 'AbortError')
        observed.pending = false
        observed.decision = decision
        await decideProjectAgentTool({ turnId, toolCallId: event.toolCallId, decision })
      },
    }
    if (!input.onToolCall) {
      void call.confirm({ ok: false, denied: true, message: 'This request has no tool handler' }).catch(() => undefined)
      return
    }
    const rejectFailedView = (error: unknown): void => {
      if (!call.isPending()) return
      void call
        .confirm({ ok: false, message: error instanceof Error ? error.message : String(error) })
        .catch(() => undefined)
    }
    try {
      void Promise.resolve(input.onToolCall(call)).catch(rejectFailedView)
    } catch (error) {
      rejectFailedView(error)
    }
  })

  try {
    const enqueued = await enqueueProjectAgentTurn({
      turnId,
      request: buildRequest(input),
      displayPrompt: input.displayPrompt,
      ...(input.capturedCanvasReadSnapshot
        ? { capturedCanvasReadSnapshot: input.capturedCanvasReadSnapshot }
        : {}),
      ...(input.attachmentClaims?.length ? { attachmentClaims: input.attachmentClaims } : {}),
      ...(input.workMode ? { workMode: input.workMode } : {}),
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...turnTarget(input),
    })
    input.onEnqueued?.(enqueued)
    input.onCancelReady?.(() => {
      for (const tool of tools.values()) tool.pending = false
      void stopProjectAgentTurn(turnId).catch(() => undefined)
    })
    const initialStatus = enqueued.state.turns.find((turn) => turn.turnId === turnId)?.status
    if (isTerminal(initialStatus)) observeState()
    const finalState = await terminal
    const status = finalState.turns.find((turn) => turn.turnId === turnId)?.status ?? 'failed'
    const response = {
      ...(execution.result ?? {}),
      id: turnId,
      status: responseStatus(status),
      text: assistantText(finalState, turnId),
      toolCalls:
        execution.result?.toolCalls ??
        [...tools.values()].map((tool) => ({
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          args: tool.args,
          status: tool.decision?.ok ? ('ok' as const) : tool.decision?.denied ? ('denied' as const) : ('error' as const),
          ...(tool.decision ? { decision: tool.decision } : {}),
          ...(tool.decision?.ok && tool.decision.result !== undefined ? { result: tool.decision.result } : {}),
          ...(!tool.decision?.ok && tool.decision?.message ? { error: tool.decision.message } : {}),
        })),
      artifacts: execution.result?.artifacts ?? [],
      usage: execution.result?.usage ?? EMPTY_USAGE,
      finishReason:
        execution.result?.finishReason ??
        (status === 'stopped' ? ('aborted' as const) : status === 'failed' ? ('error' as const) : ('stop' as const)),
      ...(status === 'stopped' ? { raw: { cancelled: true } as const } : {}),
    } satisfies AgentsChatResponseDto
    if (execution.result) useAgentUsageStore.getState().addUsage(execution.result.usage)
    if (response.status === 'error') throw executionError ?? new Error('project_agent_execution_failed')
    return response
  } finally {
    settled = true
    for (const tool of tools.values()) tool.pending = false
    unsubscribeEvents()
    unsubscribeState()
  }
}

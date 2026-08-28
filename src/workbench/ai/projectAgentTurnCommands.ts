import type { AgentChatRequest, AgentChatToolDecision } from '../../../electron/harness/agentChatContracts'
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentHostState,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
  ProjectBinding,
  TargetRef,
  PreconditionSet,
} from '../../../electron/shared/projectAgentContracts'
import { createProjectAgentContextBinding } from '../../../electron/projectAgentHost/projectAgentContextBinding'
import { projectAgentClient } from './projectAgentClient'
import { projectAgentProjectionStore } from './projectAgentProjectionStore'
import { installProjectAgentSnapshotToUi } from './projectAgentUiProjection'

export type ProjectAgentTurnTarget = Readonly<{
  target: TargetRef
  preconditions?: PreconditionSet
  originSurface: { surfaceId: string; kind: 'document' | 'canvas' | 'project' | 'preview' | 'timeline' }
}>

export type ProjectAgentTurnCommandInput = ProjectAgentTurnTarget &
  Readonly<{
    request: AgentChatRequest
    displayPrompt: string
    threadTitle?: string
    turnId?: string
  }>

export type ProjectAgentTurnCommandResult = Readonly<{
  state: ProjectAgentHostState
  turnId: string
  queueItemId: string
  userItemId: string
}>

function id(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function bindingOf(snapshot: ProjectAgentHostState): ProjectBinding {
  return snapshot.binding
}

function activeWritableThread(snapshot: ProjectAgentHostState, now: string): ProjectAgentThread {
  const active = snapshot.threads.find((thread) => thread.threadId === snapshot.activeThreadId)
  if (!active || active.provenance?.kind === 'legacy') {
    return Object.freeze({
      threadId: id('thread'),
      createdAt: now,
      updatedAt: now,
      provenance: { kind: 'canonical' as const },
    })
  }
  return Object.freeze({ ...active, ...(active.title ? { title: active.title } : {}), updatedAt: now })
}

function modelRef(request: AgentChatRequest): ProjectAgentTurn['model'] {
  const vendor =
    typeof request.agentVendorKey === 'string' && request.agentVendorKey.trim()
      ? request.agentVendorKey.trim()
      : 'configured'
  const model =
    typeof request.agentModelKey === 'string' && request.agentModelKey.trim()
      ? request.agentModelKey.trim()
      : 'configured'
  return Object.freeze({ id: `${vendor}:${model}`, version: 1 })
}

function buildRecords(
  input: ProjectAgentTurnCommandInput,
  snapshot: ProjectAgentHostState,
): Readonly<{
  thread: ProjectAgentThread
  turn: ProjectAgentTurn
  userItem: ProjectAgentUserItem
  queueItem: ProjectAgentQueueItem
}> {
  const now = new Date().toISOString()
  const thread = activeWritableThread(snapshot, now)
  const turnId = input.turnId ?? id('turn')
  const executionToken = id('execution')
  const contextRef = Object.freeze({
    binding: createProjectAgentContextBinding(bindingOf(snapshot), thread.threadId),
    contextRevision: 0,
    recordId: `canonical-context-${thread.threadId}`,
  })
  const model = modelRef(input.request)
  const skillVersions = input.request.skillKey
    ? Object.freeze([{ id: input.request.skillKey, version: 1 }])
    : Object.freeze([])
  const capabilityVersions = Object.freeze([{ id: input.request.capability, version: 1 }])
  const userItem = Object.freeze({
    itemId: id('item-user'),
    threadId: thread.threadId,
    turnId,
    kind: 'user' as const,
    text: input.displayPrompt,
    status: 'done' as const,
    retryable: false,
    deviated: false,
    createdAt: now,
    updatedAt: now,
  })
  const turn = Object.freeze({
    turnId,
    threadId: thread.threadId,
    executionToken,
    model,
    skillVersions,
    capabilityVersions,
    contextRef,
    status: 'queued' as const,
    retryable: false,
    deviated: false,
    createdAt: now,
    updatedAt: now,
  })
  const queueItem = Object.freeze({
    queueItemId: id('queue'),
    threadId: thread.threadId,
    turnId,
    binding: bindingOf(snapshot),
    target: input.target,
    preconditions: input.preconditions ?? {},
    contextRef,
    model,
    skillVersions,
    capabilityVersions,
    policyRevision: 1,
    attachmentRefs: [],
    originSurface: input.originSurface,
    enqueuedAt: now,
    status: 'queued' as const,
    retryable: false,
    deviated: false,
    updatedAt: now,
  })
  return Object.freeze({ thread, turn, userItem, queueItem })
}

export async function enqueueProjectAgentTurn(
  input: ProjectAgentTurnCommandInput,
): Promise<ProjectAgentTurnCommandResult> {
  const snapshot = projectAgentProjectionStore.getState().snapshot
  const subscriptionId = projectAgentProjectionStore.getState().subscriptionId
  if (!snapshot || !subscriptionId) throw new Error('project_agent_unavailable')
  const records = buildRecords(input, snapshot)
  const result = await projectAgentClient.command({
    subscriptionId,
    clientCommandId: id('ui-enqueue'),
    knownRevision: snapshot.hostRevision,
    type: 'turn.enqueue',
    payload: { ...records, request: { ...input.request, history: { kind: 'ephemeral' as const } } },
  })
  projectAgentProjectionStore.applySnapshot(result.state)
  installProjectAgentSnapshotToUi(result.state)
  return Object.freeze({
    state: result.state,
    turnId: records.turn.turnId,
    queueItemId: records.queueItem.queueItemId,
    userItemId: records.userItem.itemId,
  })
}

export async function decideProjectAgentTool(
  input: Readonly<{
    turnId: string
    toolCallId: string
    decision: AgentChatToolDecision
  }>,
): Promise<void> {
  const snapshot = projectAgentProjectionStore.getState().snapshot
  const subscriptionId = projectAgentProjectionStore.getState().subscriptionId
  if (!snapshot || !subscriptionId) throw new Error('project_agent_unavailable')
  const result = await projectAgentClient.command({
    subscriptionId,
    clientCommandId: id('ui-tool-decision'),
    knownRevision: snapshot.hostRevision,
    type: 'tool.decision',
    payload: input,
  })
  projectAgentProjectionStore.applySnapshot(result.state)
  installProjectAgentSnapshotToUi(result.state)
}

export async function stopProjectAgentTurn(turnId: string): Promise<void> {
  const subscriptionId = projectAgentProjectionStore.getState().subscriptionId
  if (!subscriptionId) throw new Error('project_agent_unavailable')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = projectAgentProjectionStore.getState().snapshot
    if (!snapshot) throw new Error('project_agent_unavailable')
    try {
      const result = await projectAgentClient.command({
        subscriptionId,
        clientCommandId: id('ui-stop'),
        knownRevision: snapshot.hostRevision,
        type: 'turn.transition',
        payload: { turnId, status: 'stopped', updatedAt: new Date().toISOString() },
      })
      projectAgentProjectionStore.applySnapshot(result.state)
      installProjectAgentSnapshotToUi(result.state)
      return
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'revision_conflict' || attempt === 2) throw error
      const fresh = await projectAgentClient.snapshot(subscriptionId)
      projectAgentProjectionStore.applySnapshot(fresh)
      installProjectAgentSnapshotToUi(fresh)
    }
  }
}

export function subscribeProjectAgentEvents(listener: (event: ProjectAgentExecutionEvent) => void): () => void {
  return projectAgentClient.onEvent(listener)
}

export function projectAgentEventBelongsToTurn(event: ProjectAgentExecutionEvent, turnId: string): boolean {
  return event.type !== 'patch' && event.turnId === turnId
}

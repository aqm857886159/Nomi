import type { AgentChatToolDecision, ProjectAgentExecutionRequest } from '../../../electron/shared/contracts/agentChatContracts'
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentAttachmentClaim,
  ProjectAgentHostState,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectAgentUserItem,
  ProjectAgentApprovalPolicy,
  ProjectAgentWorkMode,
  ProjectBinding,
  TargetRef,
  PreconditionSet,
} from '../../../electron/shared/projectAgentContracts'
import type { CapturedCanvasReadSnapshotHandleWire } from '../../../electron/shared/surfacePortBinding'
import {
  DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
  DEFAULT_PROJECT_AGENT_WORK_MODE,
  isProjectAgentLiveStatus,
} from '../../../electron/shared/projectAgentContracts'
import { createProjectAgentContextBinding } from '../../../electron/shared/contracts/projectAgentContextBinding'
import { projectAgentClient } from './projectAgentClient'
import { projectAgentProjectionStore } from './projectAgentProjectionStore'
import type { ProjectAgentProjectionState } from './projectAgentProjectionStore'
import type { AgentTurnHandle } from './agentTurnLifecycle'

export type ProjectAgentTurnTarget = Readonly<{
  target: TargetRef
  preconditions?: PreconditionSet
  originSurface: { surfaceId: string; kind: 'document' | 'canvas' | 'project' | 'preview' | 'timeline' }
}>

export type ProjectAgentTurnCommandInput = ProjectAgentTurnTarget &
  Readonly<{
    request: ProjectAgentExecutionRequest
    displayPrompt: string
    threadTitle?: string
    turnId?: string
    attachmentClaims?: readonly ProjectAgentAttachmentClaim[]
    /** User-facing execution posture; approval/spend policy remains independent. */
    workMode?: ProjectAgentWorkMode
    /** Explicit Host approval/spend snapshot; omitted values keep the safe default. */
    approvalPolicy?: ProjectAgentApprovalPolicy
    /** Main-sealed production canvas read admission; consumed once by Host IPC. */
    capturedCanvasReadSnapshot?: CapturedCanvasReadSnapshotHandleWire
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
  if (!active) {
    return Object.freeze({
      threadId: id('thread'),
      createdAt: now,
      updatedAt: now,
    })
  }
  return Object.freeze({ ...active, ...(active.title ? { title: active.title } : {}), updatedAt: now })
}

function modelRef(request: ProjectAgentExecutionRequest): ProjectAgentTurn['model'] {
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
  const workMode = input.workMode ?? DEFAULT_PROJECT_AGENT_WORK_MODE
  const approvalPolicy = input.approvalPolicy
    ? Object.freeze({ mode: input.approvalPolicy.mode, spend: input.approvalPolicy.spend })
    : DEFAULT_PROJECT_AGENT_APPROVAL_POLICY
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
    workMode,
    approvalPolicy,
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
    workMode,
    approvalPolicy,
    skillVersions,
    capabilityVersions,
    policyRevision: 1,
    attachmentRefs: Object.freeze([]),
    originSurface: input.originSurface,
    enqueuedAt: now,
    status: 'queued' as const,
    retryable: false,
    deviated: false,
    paused: false,
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
  // Approval/spend belongs to the Host turn/queue snapshot.  Keep the
  // renderer request projection incapable of carrying a second authority
  // field, even when a stale caller sends one at runtime.
  const { approvalPolicy: _ignoredApprovalPolicy, ...requestWithoutHostPolicy } = input.request as ProjectAgentExecutionRequest & {
    approvalPolicy?: unknown
  }
  const result = await projectAgentClient.command({
    subscriptionId,
    clientCommandId: id('ui-enqueue'),
    knownRevision: snapshot.hostRevision,
    type: 'turn.enqueue',
    payload: {
      ...records,
      request: {
        ...requestWithoutHostPolicy,
        workMode: records.turn.workMode,
      },
      ...(input.capturedCanvasReadSnapshot
        ? { capturedCanvasReadSnapshot: { ...input.capturedCanvasReadSnapshot } }
        : {}),
      attachmentClaims: Object.freeze((input.attachmentClaims ?? []).map((claim) => Object.freeze({ ...claim }))),
    },
  })
  projectAgentProjectionStore.applySnapshot(result.state)
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
      return
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'revision_conflict' || attempt === 2) throw error
      const fresh = await projectAgentClient.snapshot(subscriptionId)
      projectAgentProjectionStore.applySnapshot(fresh)
    }
  }
}

export function subscribeProjectAgentEvents(listener: (event: ProjectAgentExecutionEvent) => void): () => void {
  return projectAgentClient.onEvent((event) => {
    const state = projectAgentProjectionStore.getState()
    if (
      event.subscriptionId !== state.subscriptionId ||
      event.subscriptionEpoch !== state.subscriptionEpoch ||
      event.type === 'patch'
    )
      return
    const snapshot = state.snapshot
    const turn = snapshot?.turns.find((candidate) => candidate.turnId === event.turnId)
    if (!snapshot || !turn || turn.executionToken !== event.executionToken) return
    if (!sameBinding(snapshot.binding, event.binding)) return
    listener(event)
  })
}

export function projectAgentEventBelongsToTurn(event: ProjectAgentExecutionEvent, turnId: string): boolean {
  if (event.type === 'patch' || event.turnId !== turnId) return false
  const turn = projectAgentProjectionStore.getState().snapshot?.turns.find((candidate) => candidate.turnId === turnId)
  return Boolean(turn && turn.executionToken === event.executionToken)
}

function sameBinding(left: ProjectBinding, right: ProjectBinding): boolean {
  return (
    left.projectId === right.projectId &&
    left.immutableProjectUuid === right.immutableProjectUuid &&
    left.projectGeneration === right.projectGeneration
  )
}

/**
 * Renderer adapter for a Host-owned turn. It is writable before the enqueue
 * response exists, then follows the canonical Host turn until terminality.
 * The invalidation hook covers a local submit that is abandoned before Host
 * has materialized its first snapshot.
 */
export function createProjectAgentTurnHandle(turnId: string): Readonly<{
  handle: AgentTurnHandle
  invalidate: () => void
}> {
  const initial = projectAgentProjectionStore.getState()
  const subscriptionId = initial.subscriptionId
  const subscriptionEpoch = initial.subscriptionEpoch
  let invalidated = false
  const isCurrent = (): boolean => {
    if (invalidated) return false
    const state = projectAgentProjectionStore.getState()
    if (!state.snapshot || state.subscriptionId !== subscriptionId || state.subscriptionEpoch !== subscriptionEpoch)
      return false
    const turn = state.snapshot.turns.find((candidate) => candidate.turnId === turnId)
    return !turn || isProjectAgentLiveStatus(turn.status)
  }
  return Object.freeze({
    handle: Object.freeze({
      id: 0,
      isCurrent,
      canWrite: isCurrent,
      isCancelled: () => !isCurrent(),
    }),
    invalidate: () => {
      invalidated = true
    },
  })
}

type PendingToolRegistryEntry<Value> = Readonly<{
  event: Extract<ProjectAgentExecutionEvent, { type: 'tool-call' }>
  value: Value
}>

export function createProjectAgentPendingToolRegistry<Value>(): Readonly<{
  install(event: Extract<ProjectAgentExecutionEvent, { type: 'tool-call' }>, value: Value): void
  select(state: ProjectAgentProjectionState, surfaceKind: 'document' | 'canvas'): readonly Value[]
  find(toolCallId: string): { event: Extract<ProjectAgentExecutionEvent, { type: 'tool-call' }>; value: Value } | null
  removeByToolCallId(toolCallId: string): void
  remove(event: Extract<ProjectAgentExecutionEvent, { type: 'tool-call' }>): void
  clear(): void
}> {
  const entries = new Map<string, PendingToolRegistryEntry<Value>>()
  const key = (event: Extract<ProjectAgentExecutionEvent, { type: 'tool-call' }>): string =>
    [event.subscriptionId, event.subscriptionEpoch, event.executionToken, event.turnId, event.toolCallId].join(':')
  return Object.freeze({
    install(event, value) {
      entries.set(key(event), Object.freeze({ event, value }))
    },
    select(state, surfaceKind) {
      const visible: Value[] = []
      for (const [entryKey, entry] of entries) {
        if (
          entry.event.subscriptionId !== state.subscriptionId ||
          entry.event.subscriptionEpoch !== state.subscriptionEpoch
        ) {
          entries.delete(entryKey)
          continue
        }
        const snapshot = state.snapshot
        const turn = snapshot?.turns.find((candidate) => candidate.turnId === entry.event.turnId)
        if (
          !snapshot ||
          !turn ||
          turn.executionToken !== entry.event.executionToken ||
          !sameBinding(snapshot.binding, entry.event.binding) ||
          !isProjectAgentLiveStatus(turn.status)
        ) {
          entries.delete(entryKey)
          continue
        }
        if (turn.threadId !== snapshot.activeThreadId) continue
        const queueItem = snapshot.queue.find((candidate) => candidate.turnId === turn.turnId)
        if (queueItem?.originSurface.kind !== surfaceKind) continue
        visible.push(entry.value)
      }
      return Object.freeze(visible)
    },
    find(toolCallId) {
      for (const entry of entries.values()) if (entry.event.toolCallId === toolCallId) return entry
      return null
    },
    removeByToolCallId(toolCallId) {
      for (const [entryKey, entry] of entries) if (entry.event.toolCallId === toolCallId) entries.delete(entryKey)
    },
    remove(event) {
      entries.delete(key(event))
    },
    clear() {
      entries.clear()
    },
  })
}

import type {
  ProjectAgentChange,
  ProjectAgentHostState,
  ProjectAgentPatch,
  ProjectAgentProposalApproval,
  ProjectAgentQueueItem,
  ProjectAgentThread,
  ProjectAgentTurn,
  ProjectBinding,
} from '../../../electron/shared/projectAgentContracts'

export type ProjectAgentProjectionState = Readonly<{
  binding: ProjectBinding | null
  subscriptionId: string | null
  subscriptionEpoch: number | null
  snapshot: ProjectAgentHostState | null
  lastError: string | null
}>

export type ProjectAgentProjectionStore = Readonly<{
  getState(): ProjectAgentProjectionState
  subscribe(listener: () => void): () => void
  install(subscriptionId: string, subscriptionEpoch: number, snapshot: ProjectAgentHostState): void
  applySnapshot(snapshot: ProjectAgentHostState): void
  applyPatch(patch: ProjectAgentPatch): boolean
  clear(error?: string): void
}>

function sameBinding(left: ProjectBinding | null, right: ProjectBinding): boolean {
  return Boolean(
    left &&
    left.projectId === right.projectId &&
    left.immutableProjectUuid === right.immutableProjectUuid &&
    left.projectGeneration === right.projectGeneration,
  )
}

function replaceById<T>(values: readonly T[], id: string, readId: (value: T) => string, next: T): readonly T[] {
  const index = values.findIndex((value) => readId(value) === id)
  if (index < 0) return [...values, next]
  const copy = [...values]
  copy[index] = next
  return copy
}

function removeById<T>(values: readonly T[], id: string, readId: (value: T) => string): readonly T[] {
  return values.filter((value) => readId(value) !== id)
}

function applyChange(state: ProjectAgentHostState, change: ProjectAgentChange): ProjectAgentHostState {
  switch (change.kind) {
    case 'thread-upserted':
      return {
        ...state,
        threads: replaceById(state.threads, change.thread.threadId, (value) => value.threadId, change.thread),
      }
    case 'thread-removed':
      return { ...state, threads: removeById(state.threads, change.threadId, (value) => value.threadId) }
    case 'active-thread-changed':
      return { ...state, activeThreadId: change.activeThreadId }
    case 'turn-upserted':
      return { ...state, turns: replaceById(state.turns, change.turn.turnId, (value) => value.turnId, change.turn) }
    case 'turn-removed':
      return { ...state, turns: removeById(state.turns, change.turnId, (value) => value.turnId) }
    case 'item-upserted':
      return { ...state, items: replaceById(state.items, change.item.itemId, (value) => value.itemId, change.item) }
    case 'item-removed':
      return { ...state, items: removeById(state.items, change.itemId, (value) => value.itemId) }
    case 'queue-upserted':
      return {
        ...state,
        queue: replaceById(state.queue, change.queueItem.queueItemId, (value) => value.queueItemId, change.queueItem),
      }
    case 'queue-removed':
      return { ...state, queue: removeById(state.queue, change.queueItemId, (value) => value.queueItemId) }
    case 'queue-reordered': {
      const byId = new Map(state.queue.map((item) => [item.queueItemId, item]))
      if (new Set(change.queueItemIds).size !== state.queue.length) return state
      const reordered = change.queueItemIds
        .map((queueItemId) => byId.get(queueItemId))
        .filter((item) => item !== undefined)
      return reordered.length === state.queue.length ? { ...state, queue: reordered } : state
    }
    case 'proposal-upserted':
      return {
        ...state,
        proposalApprovals: replaceById(
          state.proposalApprovals,
          change.approval.ref.approvalId,
          (value) => value.ref.approvalId,
          change.approval,
        ),
      }
    case 'proposal-removed':
      return {
        ...state,
        proposalApprovals: removeById(state.proposalApprovals, change.approvalId, (value) => value.ref.approvalId),
      }
  }
}

function freezeState(state: ProjectAgentProjectionState): ProjectAgentProjectionState {
  return Object.freeze(state)
}

export function createProjectAgentProjectionStore(): ProjectAgentProjectionStore {
  let state: ProjectAgentProjectionState = freezeState({
    binding: null,
    subscriptionId: null,
    subscriptionEpoch: null,
    snapshot: null,
    lastError: null,
  })
  const listeners = new Set<() => void>()
  const publish = (next: ProjectAgentProjectionState): void => {
    state = freezeState(next)
    listeners.forEach((listener) => listener())
  }
  return Object.freeze({
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    install(subscriptionId, subscriptionEpoch, snapshot) {
      publish({ subscriptionId, subscriptionEpoch, binding: snapshot.binding, snapshot, lastError: null })
    },
    applySnapshot(snapshot) {
      if (!sameBinding(state.binding, snapshot.binding)) return
      if (state.snapshot && snapshot.hostRevision < state.snapshot.hostRevision) return
      publish({ ...state, binding: snapshot.binding, snapshot, lastError: null })
    },
    applyPatch(patch) {
      const current = state.snapshot
      if (!current || !sameBinding(state.binding, patch.binding) || current.hostRevision !== patch.previousRevision)
        return false
      let next = current
      for (const change of patch.changes) next = applyChange(next, change)
      publish({
        ...state,
        snapshot: Object.freeze({
          ...next,
          hostRevision: patch.hostRevision,
          commandLedgerHighWater: patch.hostRevision,
        }),
        lastError: null,
      })
      return true
    },
    clear(error) {
      publish({ binding: null, subscriptionId: null, subscriptionEpoch: null, snapshot: null, lastError: error ?? null })
    },
  })
}

export const projectAgentProjectionStore = createProjectAgentProjectionStore()

export function selectProjectAgentThreads(state: ProjectAgentProjectionState): readonly ProjectAgentThread[] {
  return state.snapshot?.threads ?? []
}

export function selectProjectAgentTurns(state: ProjectAgentProjectionState): readonly ProjectAgentTurn[] {
  return state.snapshot?.turns ?? []
}

export function selectProjectAgentQueue(state: ProjectAgentProjectionState): readonly ProjectAgentQueueItem[] {
  return state.snapshot?.queue ?? []
}

export function selectProjectAgentApprovals(
  state: ProjectAgentProjectionState,
): readonly ProjectAgentProposalApproval[] {
  return state.snapshot?.proposalApprovals ?? []
}

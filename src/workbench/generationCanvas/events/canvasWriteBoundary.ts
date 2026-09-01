import type { GenerationCanvasState } from '../store/canvasStoreTypes'
import { getActiveCanvasGestureContext } from './canvasGestureContext'

type ActionName = {
  [K in keyof GenerationCanvasState]: GenerationCanvasState[K] extends (...args: never[]) => unknown ? K : never
}[keyof GenerationCanvasState]

// Classify every store action, including future additions. Attention/read-only
// actions must not cancel a proposal; document writes must enter before reading
// their state or opening an Undo barrier. Runtime result attachment is a write;
// status/progress is not a new edit. Previously accepted jobs are never cancelled.
const documentActions = {
  markReady: false, captureHistory: true, setCanvasTransform: false, setCanvasZoom: false,
  setGenerationAiDraft: false, setGenerationAiMessages: false, setGenerationAiCollapsed: false,
  resetGenerationAiConversation: false, copySelectedNodes: false, cutSelectedNodes: true,
  openVideoDeconstruction: false, closeVideoDeconstruction: false,
  setVideoDeconstructionEntry: false, toggleVideoDeconstructionShot: false,
  pasteNodes: true, undo: true, redo: true, readSnapshot: false, readDocumentSnapshot: false,
  restoreSnapshot: true, applyEventTail: true, applyExternalGraph: true,
  addNode: true, commitPersistedChange: false, updateNode: true, updateNodes: true,
  updateNodePrompt: true, setNodeLocked: true, moveNode: true, moveSelectedNodes: true,
  tidyCategory: true, deleteSelectedNodes: true, selectNode: false, selectNodes: false,
  clearSelection: false, selectAllNodes: false, selectNodesInRect: false,
  duplicateNodeForRegeneration: true, reassignNodeCategory: true, copyNodeToCategory: true, deleteNode: true,
  saveSelectedAsWorkflowTemplate: true, instantiateWorkflowTemplate: true, instantiateWorkflowTemplateSnapshot: true,
  startConnection: false, startGroupConnection: false, cancelConnection: false, connectToNode: true, connectNodes: true,
  connectToGroup: true, updateEdgeMode: true, disconnectEdge: true, moveGroupNodes: true,
  createGroup: true, groupSelectedNodes: true, renameGroup: true, setGroupColor: true, setGroupCollapsed: true,
  ungroup: true, ungroupGroups: true, deleteGroup: true, moveNodeToGroup: true,
  removeNodeFromGroup: true, reorderGroup: true, restoreGraph: true,
  setNodeStatus: false, dismissNodeError: false, setNodeProgress: false, appendNodeRun: false,
  trackNodeRun: false, addNodeResult: true, rollbackHistory: true,
} satisfies Record<ActionName, boolean>

type PendingWrite = { proposalId: string; cancel: () => void | false }
let pending: PendingWrite | undefined
let cancelling = false
let settledWaiters: Array<() => void> = []

function resolveSettledWaiters(): void {
  if (pending || cancelling) return
  const waiters = settledWaiters
  settledWaiters = []
  for (const resolve of waiters) resolve()
}

function waitUntilSettled(): Promise<void> {
  return new Promise<void>((resolve) => settledWaiters.push(resolve))
}

/**
 * Derived renderer metadata (for example a newly mounted node's default
 * model) must not interrupt a durable proposal receipt commit. Callers can
 * defer that non-user write until the transaction has released ownership.
 * User edits still go through interruptPendingCanvasWrite synchronously.
 */
export function whenCanvasWriteBoundarySettled(): Promise<void> {
  return pending || cancelling ? waitUntilSettled() : Promise.resolve()
}

function cancelPending(): boolean {
  const previous = pending
  if (!previous) return true
  cancelling = true
  try {
    if (previous.cancel() === false) return false
    if (pending === previous) pending = undefined
    return true
  } finally {
    cancelling = false
    resolveSettledWaiters()
  }
}

/** End the old compensatable segment synchronously, before its successor can
 * read a partial projection or put an Undo barrier inside that old segment. */
export function interruptPendingCanvasWrite(): void {
  const context = getActiveCanvasGestureContext()
  if (cancelling && !context?.allowDuringCleanup) throw new DOMException('Canvas proposal cleanup is in progress', 'AbortError')
  if (context?.canWrite && !context.canWrite()) throw new DOMException('Canvas proposal no longer owns this write', 'AbortError')
  if (!pending || context?.proposalId === pending.proposalId) return
  if (!cancelPending()) throw new DOMException('Canvas proposal receipt commit is in progress', 'AbortError')
}

/** Project replacement drops only renderer ownership. Durable recovery evidence
 * remains main-owned and is replayed when that exact project is installed. */
export function abandonPendingCanvasWrite(): void {
  pending = undefined
  resolveSettledWaiters()
}

export function ownPendingCanvasWrite(proposalId: string, cancel: () => void | false): (() => void) | Promise<() => void> {
  // This is an explicitly new owner, including one started by a synchronous
  // store subscriber. During compensation it queues until the old event and
  // Undo segment are both closed; it never writes inside the cleanup stack.
  if (cancelling) {
    return waitUntilSettled()
      .then(() => ownPendingCanvasWrite(proposalId, cancel))
      .then((release) => release)
  }
  if (pending?.proposalId === proposalId) {
    const owner = pending
    return () => {
      if (pending !== owner) return
      pending = undefined
      resolveSettledWaiters()
    }
  }
  if (!cancelPending()) {
    return waitUntilSettled()
      .then(() => ownPendingCanvasWrite(proposalId, cancel))
      .then((release) => release)
  }
  const owner = { proposalId, cancel }
  pending = owner
  return () => {
    if (pending !== owner) return
    pending = undefined
    resolveSettledWaiters()
  }
}

/** One entry for UI, Agent and external graph actions; no panel-specific lock. */
export function withCanvasWriteBoundary(state: GenerationCanvasState): GenerationCanvasState {
  for (const [name, isDocumentWrite] of Object.entries(documentActions)) {
    if (!isDocumentWrite) continue
    const action = Reflect.get(state, name) as (...args: unknown[]) => unknown
    Reflect.set(state, name, (...args: unknown[]) => {
      interruptPendingCanvasWrite()
      return action(...args)
    })
  }
  return state
}

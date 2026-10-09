import type { CanvasDocumentActions, CanvasRunActions, GenerationCanvasState } from '../store/canvasStoreTypes'
import { getActiveCanvasGestureContext } from './canvasGestureContext'

type ActionName = {
  [K in keyof GenerationCanvasState]: GenerationCanvasState[K] extends (...args: never[]) => unknown ? K : never
}[keyof GenerationCanvasState]

/**
 * 画布 store 每个动作写的是哪一层——必须声明，不声明编译不过（表 `satisfies Record<ActionName, …>`）。
 * - `session`：不改项目文档（选区、对话草稿、读、连线手势、落盘计数）；不打断进行中的提议。
 * - `edit`：编辑层（用户 / Agent 的编辑）；先打断别的提议的未提交批次，再读状态 / 打撤销点。
 * - `fact:landing`：付费结局落到节点上（只由运行写）；它是一笔写，同样先打断。
 * - `fact:run`：运行态（状态 / 进度 / 运行记录 / 暂存）；不是新编辑，不打断，已接受的任务从不取消。
 * - `document`：整图 / 整节点写回；**只能**由统一提交口实现（store/canvasDocumentCommit.ts），
 *   编辑层取传进来的、事实层取活的。下面两条类型断言把「哪一层由哪个切片实现」钉死：
 *   document 层的动作恰好是 CanvasDocumentActions 的键，fact 层的动作恰好是 CanvasRunActions 的键——
 *   新写手不归类、归错层、或把整写塞进编辑切片，都编译不过。
 */
export type CanvasActionLayer = 'session' | 'edit' | 'fact:landing' | 'fact:run' | 'document'

export const CANVAS_ACTION_LAYERS = {
  captureHistory: 'edit',
  setGenerationAiDraft: 'session', setGenerationAiMessages: 'session', setGenerationAiCollapsed: 'session',
  resetGenerationAiConversation: 'session', copySelectedNodes: 'session', cutSelectedNodes: 'edit',
  duplicateNodesForDrag: 'edit', duplicateSelectedNodes: 'edit', pasteNodes: 'edit', readSnapshot: 'session', readDocumentSnapshot: 'session',
  addNode: 'edit', commitPersistedChange: 'session', updateNode: 'edit', updateNodes: 'edit',
  updateNodePrompt: 'edit', setNodeResultStackOpen: 'edit', setNodeMainResult: 'edit', setNodeLocked: 'edit', moveNode: 'edit', moveNodes: 'edit', moveSelectedNodes: 'edit',
  tidyCategory: 'edit', deleteSelectedNodes: 'edit', selectNode: 'session', selectNodes: 'session',
  clearSelection: 'session', selectAllNodes: 'session',
  duplicateNodeForRegeneration: 'edit', reassignNodeCategory: 'edit', copyNodeToCategory: 'edit', deleteNode: 'edit',
  saveSelectedAsWorkflowTemplate: 'edit', instantiateWorkflowTemplate: 'edit', instantiateWorkflowTemplateSnapshot: 'edit',
  startConnection: 'session', startGroupConnection: 'session', cancelConnection: 'session', connectToNode: 'edit', connectNodes: 'edit', addDerivedOutput: 'edit',
  connectToGroup: 'edit', updateEdgeMode: 'edit', disconnectEdge: 'edit', moveGroupNodes: 'edit', duplicateGroupForDrag: 'edit',
  createGroup: 'edit', createFrame: 'edit', groupSelectedNodes: 'edit', renameGroup: 'edit', setGroupDescription: 'edit',
  setGroupColor: 'edit', arrangeGroup: 'edit', setGroupCollapsed: 'edit',
  ungroup: 'edit', ungroupGroups: 'edit', deleteGroup: 'edit', moveNodeToGroup: 'edit',
  removeNodeFromGroup: 'edit', reorderGroup: 'edit',
  setNodeStatus: 'fact:run', dismissNodeError: 'fact:run', setNodeProgress: 'fact:run', appendNodeRun: 'fact:run',
  trackNodeRun: 'fact:run', holdRunOutcome: 'fact:run', addNodeResult: 'fact:landing', landNodeContent: 'fact:landing',
  restoreSnapshot: 'document', applyEventTail: 'document', undo: 'document', redo: 'document',
  applyExternalGraph: 'document', restoreGraph: 'document', restoreNodeFields: 'document',
} as const satisfies Record<ActionName, CanvasActionLayer>

type ActionsOfLayer<Layer extends CanvasActionLayer> = {
  [K in ActionName]: (typeof CANVAS_ACTION_LAYERS)[K] extends Layer ? K : never
}[ActionName]
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const documentLayerIsTheCommitPort: SameKeys<ActionsOfLayer<'document'>, keyof CanvasDocumentActions> = true
const factLayerIsTheRunSlice: SameKeys<ActionsOfLayer<'fact:landing' | 'fact:run'>, keyof CanvasRunActions> = true
void documentLayerIsTheCommitPort
void factLayerIsTheRunSlice

/** 写项目文档的动作（session / fact:run 之外）进门前先接管进行中的提议批次。 */
const interruptsPendingWrite = (layer: CanvasActionLayer) => layer !== 'session' && layer !== 'fact:run'

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

/** Derived projections share their owning transaction, but wait behind foreign
 * durable writes. Recheck on wake-up because another owner may have claimed it. */
export function runWhenCanvasWriteBoundarySettled(write: () => void): void {
  const context = getActiveCanvasGestureContext()
  if ((!pending && !cancelling) || (pending && context?.proposalId === pending.proposalId)) {
    write()
    return
  }
  void whenCanvasWriteBoundarySettled().then(() => runWhenCanvasWriteBoundarySettled(write))
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
  for (const [name, layer] of Object.entries(CANVAS_ACTION_LAYERS)) {
    if (!interruptsPendingWrite(layer)) continue
    const action = Reflect.get(state, name) as (...args: unknown[]) => unknown
    Reflect.set(state, name, (...args: unknown[]) => {
      interruptPendingCanvasWrite()
      return action(...args)
    })
  }
  return state
}

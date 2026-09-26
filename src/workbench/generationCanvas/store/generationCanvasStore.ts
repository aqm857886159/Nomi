import { declareStoreLifetime } from '../../project/storeLifetime'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { removeNodes } from '../model/graphOps'
import { bumpPersistRevision } from './canvasGuards'
import {
  getHistoryFlags,
  popRedo,
  popUndo,
  pushUndoSnapshot,
  seedUndoJournalBase,
} from '../events/canvasUndoJournal'
import {
  buildSelectedClipboard,
  clearClipboard,
  cloneClipboardPayload,
  getClipboard,
  setClipboard,
} from './canvasClipboard'
import { resolveGroupInsertionDelta } from './resolveInsertionPosition'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'
import { convergeDeconstructionNodes } from '../nodes/shotTable/deconstructionLifecycle'
import { createDefaultGenerationCanvasSnapshot } from './generationCanvasDefaults'
import { assignClonedShotIndexes } from '../model/shotNumbering'
import { placementOrigin } from '../model/canvasPlacement'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { replayCanvasEvents } from '../events/canvasEventReducer'
import { withCanvasWriteBoundary } from '../events/canvasWriteBoundary'
import type { GenerationCanvasState } from './canvasStoreTypes'
import { createCanvasNodeActions } from './canvasNodeActions'
import { createCanvasGraphActions } from './canvasGraphActions'
import { createCanvasRunActions } from './canvasRunActions'

export { __resetCanvasUndoJournalForTests as __resetGenerationCanvasHistoryForTests } from '../events/canvasUndoJournal'

/**
 * 复制类动作（拖动复制 / Cmd+D）借用剪贴板走 pasteNodes，这样复制与粘贴只有一条落地路径；
 * 借完必须还——用户刚 ⌘C 的内容不能被一次复制悄悄换掉。
 */
function pasteThroughBorrowedClipboard<T>(payload: NonNullable<ReturnType<typeof getClipboard>>, run: () => T): T {
  const previousClipboard = getClipboard()
  try {
    setClipboard(payload)
    return run()
  } finally {
    setClipboard(previousClipboard)
  }
}

export const useGenerationCanvasStore = create<GenerationCanvasState>()(subscribeWithSelector(immer((set, get, store) => withCanvasWriteBoundary({
  isReady: false,
  persistRevision: 0,
  // 初始画布走默认快照单一真相源（勿再内联一份节点/边，见审计 A4）。
  ...createDefaultGenerationCanvasSnapshot(),
  workflowTemplates: [],
  selectedNodeIds: [],
  pendingConnectionSourceId: '',
  pendingConnectionSourceSide: 'right',
  pendingConnectionSourceKind: 'node',
  generationAiDraft: '',
  generationAiMessages: [],
  generationAiCollapsed: true,
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  captureHistory: () => {
    pushUndoSnapshot(get())
    set((state) => {
      Object.assign(state, getHistoryFlags())
    })
  },
  setGenerationAiDraft: (generationAiDraft) => {
    set({ generationAiDraft })
  },
  setGenerationAiMessages: (messages) => {
    set((state) => {
      state.generationAiMessages = typeof messages === 'function' ? messages(state.generationAiMessages) : messages
    })
  },
  setGenerationAiCollapsed: (generationAiCollapsed) => {
    set({ generationAiCollapsed })
  },
  resetGenerationAiConversation: () => {
    set({ generationAiDraft: '', generationAiMessages: [] })
  },
  duplicateNodesForDrag: (nodeIds) => {
    const payload = buildSelectedClipboard({ ...get(), selectedNodeIds: nodeIds })
    if (!payload) return new Map()
    return pasteThroughBorrowedClipboard(payload, () => {
      get().pasteNodes({ x: Math.min(...payload.nodes.map((node) => node.position.x)), y: Math.min(...payload.nodes.map((node) => node.position.y)) })
      const copies = get().selectedNodeIds
      const mapping = new Map(payload.nodes.map((node, index) => [node.id, copies[index]]))
      for (const original of payload.nodes) get().moveNode(mapping.get(original.id)!, original.position)
      return mapping
    })
  },
  duplicateSelectedNodes: () => {
    // Cmd/Ctrl+D：所选节点 + 它们**之间**的边原地偏移复制（LibTV「复制节点和连线」）。
    // 与拖动复制同一套原语：借剪贴板走 pasteNodes（一个撤销点、镜头领新号、整簇避让），用完把用户的 ⌘C 还回去。
    const payload = buildSelectedClipboard(get())
    if (!payload) return
    pasteThroughBorrowedClipboard(payload, () => get().pasteNodes())
  },
  copySelectedNodes: () => {
    const nextClipboard = buildSelectedClipboard(get())
    if (!nextClipboard) return
    setClipboard(nextClipboard)
    set({ hasClipboard: true })
  },
  cutSelectedNodes: () => {
    const currentState = get()
    const nextClipboard = buildSelectedClipboard(currentState)
    if (!nextClipboard) return
    const removedIds = [...currentState.selectedNodeIds]
    setClipboard(nextClipboard)
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags(), { hasClipboard: true })
    })
    emitCanvasGesture(removedIds.map((nodeId) => ({ type: 'canvas.node.removed', payload: { nodeId } })))
  },
  pasteNodes: (basePosition, anchor) => {
    const currentState = get()
    const clipboardPayload = getClipboard()
    if (!clipboardPayload) return
    const cloned = cloneClipboardPayload(clipboardPayload)
    if (!cloned.nodes.length) return
    // 粘贴产物是新身份：镜头节点逐个领新编号，不复制原号（编号唯一，审计 A2）。
    const numberedNodes = assignClonedShotIndexes(currentState.nodes, cloned.nodes)
    const positionedNodes = basePosition
      ? (() => {
          const minX = Math.min(...numberedNodes.map((node) => node.position.x))
          const minY = Math.min(...numberedNodes.map((node) => node.position.y))
          // 锚点按粘贴簇**看得见的**外接盒算（卡面尺寸唯一真相源 resolveNodeVisualSize），
          // 「中心压在光标下」才是真的中心，不是按默认尺寸猜的。
          const origin = anchor
            ? placementOrigin({ point: basePosition, anchor }, {
                width: Math.max(...numberedNodes.map((node) => node.position.x + resolveNodeVisualSize(node).width)) - minX,
                height: Math.max(...numberedNodes.map((node) => node.position.y + resolveNodeVisualSize(node).height)) - minY,
              })
            : basePosition
          const dx = Math.round(origin.x - minX)
          const dy = Math.round(origin.y - minY)
          return numberedNodes.map((node) => ({
            ...node,
            position: {
              x: Math.round(node.position.x + dx),
              y: Math.round(node.position.y + dy),
            },
          }))
        })()
      : numberedNodes
    // 整簇避让：粘贴簇（已 +OFFSET）拿相关分类的已有卡求一个统一位移，整体挪开不遮挡，
    // 保住簇内相对排布（刚体平移不变形）。只比簇内出现过的分类——跨分类不同屏、不遮挡。
    const clusterCategories = new Set(positionedNodes.map((node) => node.categoryId || 'shots'))
    const relevantExisting = currentState.nodes.filter((node) => clusterCategories.has(node.categoryId || 'shots'))
    const delta = basePosition ? { x: 0, y: 0 } : resolveGroupInsertionDelta(positionedNodes, relevantExisting)
    const pastedNodes =
      delta.x === 0 && delta.y === 0
        ? positionedNodes
        : positionedNodes.map((node) => ({
            ...node,
            position: { x: node.position.x + delta.x, y: node.position.y + delta.y },
          }))
    pushUndoSnapshot(currentState)
    setClipboard({
      nodes: pastedNodes,
      edges: cloned.edges,
    })
    set((state) => {
      state.nodes = [...state.nodes, ...pastedNodes]
      state.edges = [...state.edges, ...cloned.edges]
      state.selectedNodeIds = cloned.selectedNodeIds
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([
      ...pastedNodes.map((node) => ({ type: 'canvas.node.added', payload: { node } })),
      ...cloned.edges.map((edge) => ({ type: 'canvas.edge.added', payload: { edge } })),
    ])
  },
  undo: () => {
    // S5-b-2 翻正:撤销 = 会话日志前缀重放(canvasHistory 状态栈已删)
    const previous = popUndo()
    if (!previous) return
    set((state) => {
      state.nodes = previous.nodes
      state.edges = previous.edges
      state.groups = previous.groups
      // S5-b-0 session 摘除:撤销不回放选区(tldraw 教训)——保留当前选区,clamp 到仍存在的节点
      const surviving = new Set(previous.nodes.map((node) => node.id))
      state.selectedNodeIds = state.selectedNodeIds.filter((id) => surviving.has(id))
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    // 影子记账:撤销=全量后态(S5-b 翻正后改为按 txn 重放;此处先保 replay≡snapshot 恒真)
    emitCanvasGesture([{ type: 'canvas.snapshot.restored', payload: { snapshot: { nodes: previous.nodes, edges: previous.edges, groups: previous.groups } } }])
  },
  redo: () => {
    const next = popRedo()
    if (!next) return
    set((state) => {
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = next.groups
      const surviving = new Set(next.nodes.map((node) => node.id))
      state.selectedNodeIds = state.selectedNodeIds.filter((id) => surviving.has(id))
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([{ type: 'canvas.snapshot.restored', payload: { snapshot: { nodes: next.nodes, edges: next.edges, groups: next.groups } } }])
  },
  readSnapshot: () => {
    // 工具/会话视图(agent read_canvas 用,含选区)
    const state = get()
    return {
      nodes: state.nodes,
      edges: state.edges,
      groups: state.groups,
      selectedNodeIds: state.selectedNodeIds,
    }
  },
  readDocumentSnapshot: () => {
    // 持久化视图(S5-b-0 session 摘除):选区是会话态,不进项目文件(tldraw document/session 分离)
    const state = get()
    return {
      nodes: state.nodes,
      edges: state.edges,
      groups: state.groups,
      workflowTemplates: state.workflowTemplates,
    }
  },
  restoreSnapshot: (snapshot) => {
    const normalized = normalizeStoreSnapshot(snapshot)
    // S5-b-2:journal 起点 = 恢复出的画布(undo 最远只回放到这帧,不会塌到空白)
    seedUndoJournalBase({ nodes: normalized.nodes, edges: normalized.edges, groups: normalized.groups })
    clearClipboard()
    set({
      isReady: true,
      persistRevision: get().persistRevision,
      nodes: normalized.nodes,
      edges: normalized.edges,
      groups: normalized.groups,
      workflowTemplates: normalized.workflowTemplates || [],
      // S5-b-0:重开项目不再恢复幽灵选区(老 payload 里残存的 selectedNodeIds 忽略)
      selectedNodeIds: [],
      pendingConnectionSourceId: '',
      pendingConnectionSourceSide: 'right',
      hasClipboard: false,
      ...getHistoryFlags(),
    })
    // genesis 事件不在这里发(S5-b-1):必须等 hydrate 尾部重放完成后由
    // workbenchProjectSession 以"含尾巴的后态"发,否则磁盘日志最终态会丢尾巴。
  },
  applyEventTail: (events) => {
    // S5-b-1 崩溃恢复:把快照之后落盘的事件(lastSeq 尾巴)重放回投影。
    // reducer 全 case 幂等,重看快照内已有事件安全。
    if (!events.length) return
    const state = get()
    const projection = replayCanvasEvents(events, { nodes: state.nodes, edges: state.edges, groups: state.groups })
    // 拆解进度的每一下写都走 canvas.node.updated 进了事件日志，重放会把 `status: 'running'`
    // 原样写回来——快照那一步的收敛因此等于没发生（T-ED-06 的重启卡死正是这一下）。
    // 终态判定的 owner 只有一份，重放完再问它一次；已终态的表它原样返回，幂等。
    set({ nodes: convergeDeconstructionNodes(projection.nodes), edges: projection.edges, groups: projection.groups })
  },
  applyExternalGraph: (snapshot) => {
    // A 模式实时桥:外部 MCP 改动经主进程算好整张快照,这里应用进运行中 store。
    // 与 restoreSnapshot 的区别:不重置视口/不清 undo 基线——会话中应用,保住用户当前视角与撤销历史。
    const normalized = normalizeStoreSnapshot(snapshot)
    pushUndoSnapshot(get()) // 入历史:外部改动可被用户 Ctrl+Z 撤销
    set((state) => {
      state.nodes = normalized.nodes
      state.edges = normalized.edges
      state.groups = normalized.groups
      state.workflowTemplates = normalized.workflowTemplates || state.workflowTemplates
      // 选区是会话态:clamp 到仍存在的节点(外部可能删了选中的)。
      const surviving = new Set(normalized.nodes.map((node) => node.id))
      state.selectedNodeIds = state.selectedNodeIds.filter((id) => surviving.has(id))
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state) // 触发 700ms 防抖落盘
      Object.assign(state, getHistoryFlags())
    })
    // 影子记账:与 undo/redo 同口径,发 snapshot.restored 全量后态(replay≡snapshot 恒真)。
    emitCanvasGesture([
      { type: 'canvas.snapshot.restored', payload: { snapshot: { nodes: normalized.nodes, edges: normalized.edges, groups: normalized.groups } } },
    ])
  },
  ...createCanvasNodeActions(set, get, store),
  ...createCanvasGraphActions(set, get, store),
  ...createCanvasRunActions(set, get, store),
}))))

/**
 * C1 寿命声明 + 释放（原来是 `releaseWorkbenchProjectSession.ts` 里那份 10/13 的手写清单）。
 *
 * 三个原来没被清的字段，各有各的理由：
 * - `persistRevision`：落盘计数，进程级。切项目把它归零会让「有没有未保存改动」的判断出错。
 * - `workflowTemplates`：ComfyUI 工作流模板是**装机级**目录数据，不是项目内容。
 * - `pendingConnectionSourceKind`：和它的两个同伴（`...Id` / `...Side`）是一次连线手势的三个
 *   分量，原清单只清了两个——**这正是手写清单的典型漏法**：同一件事的三个字段，漏一个。
 */
export const generationCanvasStoreLifetime = declareStoreLifetime({
  store: 'useGenerationCanvasStore',
  fields: {
    persistRevision: 'process',
    workflowTemplates: 'process',
    // 画布内容本体：项目就是它。
    nodes: 'project',
    edges: 'project',
    groups: 'project',
    isReady: 'project',
    selectedNodeIds: 'project',
    pendingConnectionSourceId: 'project',
    pendingConnectionSourceSide: 'project',
    pendingConnectionSourceKind: 'project',
    generationAiDraft: 'project',
    generationAiMessages: 'project',
    generationAiCollapsed: 'project',
    canUndo: 'project',
    canRedo: 'project',
    hasClipboard: 'project',
  },
  releaseProject: () => {
    const empty = createDefaultGenerationCanvasSnapshot()
    useGenerationCanvasStore.setState({
      isReady: false,
      nodes: empty.nodes,
      edges: empty.edges,
      groups: empty.groups,
      selectedNodeIds: [],
      pendingConnectionSourceId: '',
      pendingConnectionSourceSide: 'right',
      pendingConnectionSourceKind: 'node',
      generationAiDraft: '',
      generationAiMessages: [],
      generationAiCollapsed: true,
      canUndo: false,
      canRedo: false,
      hasClipboard: false,
    })
  },
})

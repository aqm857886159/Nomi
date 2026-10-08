import { declareStoreLifetime } from '../../project/storeLifetime'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { removeNodes } from '../model/graphOps'
import { bumpPersistRevision } from './canvasGuards'
import { getHistoryFlags, pushUndoSnapshot } from '../events/canvasUndoJournal'
import {
  buildSelectedClipboard,
  cloneClipboardPayload,
  getClipboard,
  setClipboard,
} from './canvasClipboard'
import { resolveGroupInsertionDelta } from './resolveInsertionPosition'
import { createDefaultGenerationCanvasSnapshot } from './generationCanvasDefaults'
import { assignClonedShotIndexes } from '../model/shotNumbering'
import { placementOrigin } from '../model/canvasPlacement'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { withCanvasWriteBoundary } from '../events/canvasWriteBoundary'
import type { GenerationCanvasState } from './canvasStoreTypes'
import { createCanvasNodeActions, removeGroupsEmptiedByNodeDeletion } from './canvasNodeActions'
import { createCanvasGraphActions } from './canvasGraphActions'
import { createCanvasRunActions } from './canvasRunActions'
import { createCanvasDocumentActions } from './canvasDocumentCommit'
import { emitProductionCanvasSignal } from '../../production/productionCanvasSignals'

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
  projectId: null,
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
  heldNodeOutcomes: {},
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
    const removedNodes = currentState.nodes.filter((node) => removedIds.includes(node.id))
    const { groups: nextGroups, removedGroupIds } = removeGroupsEmptiedByNodeDeletion(currentState.groups, removedIds)
    setClipboard(nextClipboard)
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = nextGroups
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags(), { hasClipboard: true })
    })
    emitCanvasGesture([
      ...removedGroupIds.map((groupId) => ({ type: 'canvas.group.removed' as const, payload: { groupId, releasedNodeIds: [] } })),
      ...removedIds.map((nodeId) => ({ type: 'canvas.node.removed' as const, payload: { nodeId } })),
    ])
    emitProductionCanvasSignal({ kind: 'detach', projectId: currentState.projectId, nodes: removedNodes })
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
  ...createCanvasNodeActions(set, get, store),
  ...createCanvasGraphActions(set, get, store),
  ...createCanvasRunActions(set, get, store),
  ...createCanvasDocumentActions(set, get, store),
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
    projectId: 'project',
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
    heldNodeOutcomes: 'project',
  },
  releaseProject: () => {
    const empty = createDefaultGenerationCanvasSnapshot()
    useGenerationCanvasStore.setState({
      isReady: false,
      projectId: null,
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
      heldNodeOutcomes: {},
    })
  },
})

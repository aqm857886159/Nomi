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
import { createDefaultGenerationCanvasSnapshot } from './generationCanvasDefaults'
import { isShotNumberedNode, nextShotIndex } from '../model/shotNumbering'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { applyCanvasEvent } from '../events/canvasEventReducer'
import type { GenerationCanvasState } from './canvasStoreTypes'
import { createCanvasNodeActions } from './canvasNodeActions'
import { createCanvasGraphActions } from './canvasGraphActions'
import { createCanvasRunActions } from './canvasRunActions'

export { __resetCanvasUndoJournalForTests as __resetGenerationCanvasHistoryForTests } from '../events/canvasUndoJournal'

export const useGenerationCanvasStore = create<GenerationCanvasState>()(subscribeWithSelector(immer((set, get, store) => ({
  isReady: false,
  persistRevision: 0,
  // 初始画布走默认快照单一真相源（勿再内联一份节点/边，见审计 A4）。
  ...createDefaultGenerationCanvasSnapshot(),
  selectedNodeIds: [],
  pendingConnectionSourceId: '',
  pendingConnectionSourceSide: 'right',
  canvasZoom: 1,
  canvasOffset: { x: 0, y: 0 },
  generationAiDraft: '',
  generationAiMessages: [],
  generationAiCollapsed: true,
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  markReady: () => set({ isReady: true }),
  captureHistory: () => {
    pushUndoSnapshot(get())
    set((state) => {
      Object.assign(state, getHistoryFlags())
    })
  },
  setCanvasTransform: (zoom, offset) => set({ canvasZoom: zoom, canvasOffset: offset }),
  setCanvasZoom: (zoom) => set({ canvasZoom: zoom }),
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
  pasteNodes: (basePosition) => {
    const currentState = get()
    const clipboardPayload = getClipboard()
    if (!clipboardPayload) return
    const cloned = cloneClipboardPayload(clipboardPayload)
    if (!cloned.nodes.length) return
    // 粘贴产物是新身份：镜头节点逐个领新编号，不复制原号（编号唯一，审计 A2）。
    let nextIndex = nextShotIndex(currentState.nodes)
    const numberedNodes = cloned.nodes.map((node) =>
      isShotNumberedNode(node) ? { ...node, shotIndex: nextIndex++ } : node,
    )
    const positionedNodes = basePosition
      ? (() => {
          const minX = Math.min(...numberedNodes.map((node) => node.position.x))
          const minY = Math.min(...numberedNodes.map((node) => node.position.y))
          const dx = Math.round(basePosition.x - minX)
          const dy = Math.round(basePosition.y - minY)
          return numberedNodes.map((node) => ({
            ...node,
            position: {
              x: Math.max(40, Math.round(node.position.x + dx)),
              y: Math.max(40, Math.round(node.position.y + dy)),
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
      // S5-b-0:重开项目不再恢复幽灵选区(老 payload 里残存的 selectedNodeIds 忽略)
      selectedNodeIds: [],
      pendingConnectionSourceId: '',
      pendingConnectionSourceSide: 'right',
      canvasZoom: 1,
      canvasOffset: { x: 0, y: 0 },
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
    let projection = { nodes: state.nodes, edges: state.edges, groups: state.groups }
    for (const event of events) projection = applyCanvasEvent(projection, event)
    set({ nodes: projection.nodes, edges: projection.edges, groups: projection.groups })
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

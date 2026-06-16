import type { StateCreator } from 'zustand'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  GenerationNodeKind,
  GenerationNodeResult,
  GenerationNodeRunRecord,
  GenerationNodeStatus,
  NodeGroup,
} from '../model/generationCanvasTypes'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import type { EdgeCapabilityResult } from '../agent/referenceEdgeCapability'
import type { CanvasMutationOptions } from './canvasGuards'
import type { NodeProgressInput, NodeRunRecordInput, NodeRunRecordPatch } from './runRecordHelpers'

export type CreateNodeInput = {
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  position?: { x: number; y: number }
  categoryId?: string
  select?: boolean
  // 调用方已算好「成组紧凑布局」(如切图九宫格瓦片)时置 true：信任 position 原值、跳过逐卡碰撞避让。
  // 缺省 false = 走避让总闸。没有它，成组布局会被避让逐张推散（用户报「切完散落」的根因）。
  exactPosition?: boolean
}

export type CanvasNodeActions = {
  addNode: (input: CreateNodeInput) => GenerationCanvasNode
  commitPersistedChange: () => void
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
  updateNodePrompt: (nodeId: string, prompt: string) => void
  /** S6-4 节点锁(N11):用户一键锁/解锁;AI 改它由 gate deny,事件 source 恒 user。 */
  setNodeLocked: (nodeId: string, locked: boolean) => void
  moveNode: (nodeId: string, position: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  deleteSelectedNodes: () => void
  selectNode: (nodeId: string, additive?: boolean) => void
  clearSelection: () => void
  selectAllNodes: (categoryId?: string) => void
  /** 框选：选中与矩形（画布坐标）相交的当前分类节点；additive 时并入现有选区。 */
  selectNodesInRect: (rect: { x1: number; y1: number; x2: number; y2: number }, categoryId?: string, additive?: boolean) => void
  duplicateNodeForRegeneration: (nodeId: string) => GenerationCanvasNode | null
  /** Phase E: move a node into a different category (sidebar drop / right-click). */
  reassignNodeCategory: (nodeId: string, categoryId: string) => void
  copyNodeToCategory: (nodeId: string, categoryId: string) => GenerationCanvasNode | null
  deleteNode: (nodeId: string) => void
}

export type CanvasGraphActions = {
  startConnection: (nodeId: string) => void
  cancelConnection: () => void
  // 返回连边能力校验结果:ok=已连;否则带 reason(手动连线总闸,UI 据此提示)。
  connectToNode: (targetNodeId: string) => EdgeCapabilityResult
  connectNodes: (sourceNodeId: string, targetNodeId: string, mode?: GenerationCanvasEdge['mode']) => void
  updateEdgeMode: (edgeId: string, mode: GenerationCanvasEdge['mode']) => void
  disconnectEdge: (edgeId: string) => void
  moveGroupNodes: (groupId: string, delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  createGroup: (categoryId: string, name?: string) => NodeGroup | null
  groupSelectedNodes: (categoryId: string, name?: string) => NodeGroup | null
  renameGroup: (groupId: string, name: string) => void
  setGroupColor: (groupId: string, color: string) => void
  ungroup: (groupId: string) => void
  ungroupGroups: (groupIds: string[]) => void
  deleteGroup: (groupId: string, deleteNodes?: boolean) => void
  moveNodeToGroup: (nodeId: string, groupId: string) => void
  removeNodeFromGroup: (nodeId: string) => void
  reorderGroup: (categoryId: string, activeGroupId: string, overGroupId: string) => void
  /** S6-5 整笔撤销补偿:把删除步抹掉的节点/边按原 id 放回(upsert 幂等,已存在跳过)。 */
  restoreGraph: (nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[]) => void
}

export type CanvasRunActions = {
  setNodeStatus: (nodeId: string, status: GenerationNodeStatus, error?: string) => void
  setNodeProgress: (nodeId: string, progress?: NodeProgressInput) => void
  appendNodeRun: (nodeId: string, run: NodeRunRecordInput) => GenerationNodeRunRecord
  trackNodeRun: (nodeId: string, runId: string, patch: NodeRunRecordPatch) => void
  addNodeResult: (nodeId: string, result: GenerationNodeResult) => void
  rollbackHistory: (nodeId: string, resultId: string) => void
}

export type GenerationCanvasState = {
  isReady: boolean
  persistRevision: number
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
  canvasZoom: number
  canvasOffset: { x: number; y: number }
  generationAiDraft: string
  generationAiMessages: WorkbenchAiMessage[]
  generationAiCollapsed: boolean
  canUndo: boolean
  canRedo: boolean
  hasClipboard: boolean
  markReady: () => void
  captureHistory: () => void
  setCanvasTransform: (zoom: number, offset: { x: number; y: number }) => void
  setCanvasZoom: (zoom: number) => void
  setGenerationAiDraft: (draft: string) => void
  setGenerationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setGenerationAiCollapsed: (collapsed: boolean) => void
  resetGenerationAiConversation: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: () => void
  undo: () => void
  redo: () => void
  readSnapshot: () => GenerationCanvasSnapshot
  /** 持久化视图(S5-b-0):无 selectedNodeIds——选区是会话态不进项目文件。 */
  readDocumentSnapshot: () => Omit<GenerationCanvasSnapshot, 'selectedNodeIds'>
  restoreSnapshot: (snapshot: unknown) => void
  /** S5-b-1 崩溃恢复:把快照之后落盘的事件尾巴重放回投影(reducer 幂等)。 */
  applyEventTail: (events: readonly { type: string; payload: Record<string, unknown> }[]) => void
} & CanvasNodeActions & CanvasGraphActions & CanvasRunActions

/** Slice creator typed against the store's middleware stack (subscribeWithSelector + immer). */
export type CanvasSliceCreator<T> = StateCreator<
  GenerationCanvasState,
  [['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

import type { StateCreator } from 'zustand'
import type { CanvasFrameRect } from '../model/canvasFrameBounds'
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
import type { CanvasPluginNodeState } from '../plugins/canvasPluginTypes'
import type { CanvasWorkflowTemplate } from '../plugins/canvasWorkflowTemplates'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import type { EdgeCapabilityResult } from '../agent/referenceEdgeCapability'
import type { CanvasMutationOptions } from './canvasGuards'
import type { NodeProgressInput, NodeRunRecordInput, NodeRunRecordPatch } from './runRecordHelpers'
import type { DeconstructionEntry } from '../nodes/deconstructionTypes'

export type ConnectionAnchorSide = 'left' | 'right'
export type ConnectionEndpointKind = 'node' | 'group'

/** 「连到组」的结果：给 UI 出人话用（跳过多少个必须说清，不许静默丢）。 */
export type GroupConnectResult = {
  ok: boolean
  connected: number
  /** 过不了连边能力校验、被跳过的成员数。 */
  skipped: number
  alreadyConnected: number
  reason?: 'dangling' | 'group_missing' | 'group_empty' | 'all_skipped'
}

export type CreateNodeInput = {
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  meta?: Record<string, unknown>
  size?: { width: number; height: number }
  position?: { x: number; y: number }
  categoryId?: string
  select?: boolean
  // 调用方已算好「成组紧凑布局」(如切图九宫格瓦片)时置 true：信任 position 原值、跳过逐卡碰撞避让。
  // 缺省 false = 走避让总闸。没有它，成组布局会被避让逐张推散（用户报「切完散落」的根因）。
  exactPosition?: boolean
  /** Only host-registered plugin node types may be created through this path. */
  typeId?: string
  pluginState?: CanvasPluginNodeState
}

export type CanvasNodeActions = {
  addNode: (input: CreateNodeInput) => GenerationCanvasNode
  commitPersistedChange: () => void
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
  /** Apply many user edits with one undo barrier and one persist revision. */
  updateNodes: (updates: readonly { nodeId: string; patch: Partial<GenerationCanvasNode> }[]) => void
  updateNodePrompt: (nodeId: string, prompt: string) => void
  /** S6-4 节点锁(N11):用户一键锁/解锁;AI 改它由 gate deny,事件 source 恒 user。 */
  setNodeLocked: (nodeId: string, locked: boolean) => void
  moveNode: (nodeId: string, position: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  /** 一键整理：把某分类节点重排成 storyboard 网格（按屏幕宽高比铺成宽块）。可撤销。 */
  tidyCategory: (categoryId: string, targetAspect: number) => void
  deleteSelectedNodes: () => void
  selectNode: (nodeId: string, additive?: boolean) => void
  selectNodes: (nodeIds: readonly string[]) => void
  clearSelection: () => void
  selectAllNodes: (categoryId?: string) => void
  /** 框选：选中与矩形（画布坐标）相交的当前分类节点；additive 时并入现有选区。 */
  selectNodesInRect: (rect: { x1: number; y1: number; x2: number; y2: number }, categoryId?: string, additive?: boolean) => void
  duplicateNodeForRegeneration: (nodeId: string) => GenerationCanvasNode | null
  /** Phase E: move a node into a different category (sidebar drop / right-click). */
  reassignNodeCategory: (nodeId: string, categoryId: string) => void
  copyNodeToCategory: (nodeId: string, categoryId: string) => GenerationCanvasNode | null
  deleteNode: (nodeId: string) => void
  saveSelectedAsWorkflowTemplate: (name?: string) => CanvasWorkflowTemplate | null
  instantiateWorkflowTemplate: (templateId: string, position: { x: number; y: number }) => GenerationCanvasNode[]
  instantiateWorkflowTemplateSnapshot: (template: CanvasWorkflowTemplate, position: { x: number; y: number }) => GenerationCanvasNode[]
}

export type CanvasGraphActions = {
  startConnection: (nodeId: string, side?: ConnectionAnchorSide) => void
  startGroupConnection: (groupId: string, side?: ConnectionAnchorSide) => void
  cancelConnection: () => void
  // 返回连边能力校验结果:ok=已连;否则带 reason(手动连线总闸,UI 据此提示)。
  connectToNode: (targetNodeId: string) => EdgeCapabilityResult | GroupConnectResult
  connectNodes: (sourceNodeId: string, targetNodeId: string, mode?: GenerationCanvasEdge['mode'], targetParamKey?: string, order?: number) => void
  /**
   * 把待连的线落到**一个组**上：给组内每个成员各连一根真边，并记下组入参
   * （以后新进组的成员自动补一根）。图结构不变——组只是输入手势的语法糖，见 model/groupInputLinks.ts。
   */
  connectToGroup: (groupId: string) => GroupConnectResult
  updateEdgeMode: (edgeId: string, mode: GenerationCanvasEdge['mode']) => void
  /** 单槽编辑解除该编组输入关系、保留其它槽；缺省仍按线菜单语义整组断开。 */
  disconnectEdge: (edgeId: string, options?: { scope: 'parameter' }) => void
  moveGroupNodes: (groupId: string, delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  createGroup: (categoryId: string, name?: string, options?: { materializationOperationId?: string; nodeIds?: string[]; frameBounds?: CanvasFrameRect }) => NodeGroup | null
  /**
   * 画一个**空框**（框工具第一档）：边界就是用户拖出来的那个矩形，成员为空。
   * 与 `createGroup` 的差别只有「有没有成员」，走的是同一条建组路径——框只有一种。
   */
  createFrame: (categoryId: string, bounds: CanvasFrameRect, name?: string, nodeIds?: readonly string[]) => NodeGroup | null
  groupSelectedNodes: (categoryId: string, name?: string) => NodeGroup | null
  renameGroup: (groupId: string, name: string) => void
  /** 框头部那一句灰字说明。传空串 = 清空（与改名不同：说明本来就可以没有）。 */
  setGroupDescription: (groupId: string, description: string) => void
  setGroupColor: (groupId: string, color: string) => void
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
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
  /** 收起失败卡：有旧产物 → 回 success（露出下面那条片子），没有 → 回 idle。错误原文仍留在 runs 里。 */
  dismissNodeError: (nodeId: string) => void
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
  workflowTemplates: CanvasWorkflowTemplate[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
  pendingConnectionSourceSide: ConnectionAnchorSide
  pendingConnectionSourceKind: ConnectionEndpointKind
  canvasZoom: number
  canvasOffset: { x: number; y: number }
  generationAiDraft: string
  generationAiMessages: WorkbenchAiMessage[]
  generationAiCollapsed: boolean
  /**
   * 拆解态**按源视频节点身份建槽**（结果驱动，R-C-7）：同一条视频从任何入口拆都写回同一槽。
   * key = 源视频节点 id。收起面板不清这个 map（状态不丢，R-C-3）。
   */
  videoDeconstructions: Record<string, DeconstructionEntry>
  /** 当前占住右槽的拆解面板属于哪条源视频（null=没有拆解面板占槽）。与 generationAiCollapsed 互斥（过渡期 R-C-1）。 */
  videoDeconstructionOpenNodeId: string | null
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
  /**
   * 打开某条源视频的拆解面板并占住右槽。过渡期互斥（R-C-1）：同一事务里把 generationAiCollapsed 翻 true，
   * AI 栏让位收成顶栏角标。已有该视频的拆解态则保留（收起再开状态不丢，R-C-3），否则起一个 idle 槽。
   */
  openVideoDeconstruction: (nodeId: string, source: { title: string; videoUrl: string }) => void
  /** 关闭占槽的拆解面板（面板收起为节点浮条，槽让给 AI/Agent）。不清 map，状态保留。 */
  closeVideoDeconstruction: () => void
  /** patch 某条视频的拆解态（状态/结果/阶段/错误）。调用者无关——节点入口与未来 Agent 工具都走这一口。 */
  setVideoDeconstructionEntry: (nodeId: string, patch: Partial<DeconstructionEntry>) => void
  /** 勾选/取消某镜（会话态）。 */
  toggleVideoDeconstructionShot: (nodeId: string, shotIndex: number) => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: (basePosition?: { x: number; y: number }) => void
  undo: () => void
  redo: () => void
  readSnapshot: () => GenerationCanvasSnapshot
  /** 持久化视图(S5-b-0):无 selectedNodeIds——选区是会话态不进项目文件。 */
  readDocumentSnapshot: () => Omit<GenerationCanvasSnapshot, 'selectedNodeIds'>
  restoreSnapshot: (snapshot: unknown) => void
  /** S5-b-1 崩溃恢复:把快照之后落盘的事件尾巴重放回投影(reducer 幂等)。 */
  applyEventTail: (events: readonly { type: string; payload: Record<string, unknown> }[]) => void
  /**
   * A 模式实时桥:把外部 MCP 经主进程算好的整张画布快照应用进 store(所见即所得)。
   * 与 restoreSnapshot(硬重置:清视口/选区/重置 undo 基线)不同——这是会话中应用:
   * 保留视口缩放/偏移、入 undo 历史(用户可撤销外部改动)、触发防抖持久化。
   */
  applyExternalGraph: (snapshot: unknown) => void
} & CanvasNodeActions & CanvasGraphActions & CanvasRunActions

/** Slice creator typed against the store's middleware stack (subscribeWithSelector + immer). */
export type CanvasSliceCreator<T> = StateCreator<
  GenerationCanvasState,
  [['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

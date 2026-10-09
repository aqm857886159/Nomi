import type { CanvasPlacementAnchor } from '../model/canvasPlacement'
import type { StateCreator } from 'zustand'
import type { CanvasFrameRect } from '../model/canvasFrameBounds'
import type { GroupArrangeMode } from '../model/groupArrange'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSnapshot,
  GenerationNodeKind,
  GenerationNodeResult,
  GenerationNodeRunRecord,
  GenerationNodeStatus,
  NodeGroup,
  TiptapDocJson,
} from '../model/generationCanvasTypes'
import type { CanvasPluginNodeState } from '../plugins/canvasPluginTypes'
import type { CanvasWorkflowTemplate } from '../plugins/canvasWorkflowTemplates'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import type { EdgeCapabilityResult } from '../agent/referenceEdgeCapability'
import type { CanvasMutationOptions } from './canvasGuards'
import type { HeldNodeOutcome } from './nodeRunOutcome'
import type { MediaDimensions } from '../nodes/nodeSizing'
import type { CanvasDocLike } from '../../../../electron/shared/canvas/externalCanvasWrite'
import type { NodeProgressInput, NodeRunRecordInput, NodeRunRecordPatch } from './runRecordHelpers'

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
  updateNodePrompt: (nodeId: string, prompt: string, promptOverridden?: boolean) => void
  /** 版本卡片铺开 / 收起（按节点存进项目，可撤销，同编组折叠）。 */
  /** 铺开 / 收起版本卡片。铺开时带上往哪边铺（点开那一刻量的），收起时清掉。一步撤销。 */
  setNodeResultStackOpen: (nodeId: string, open: boolean, side?: 'left' | 'right') => void
  /** 用户把某一版设为主图：一个撤销步；meta 是这一版的媒体尺寸（调用方读素材侧车算好，可省）。 */
  setNodeMainResult: (nodeId: string, resultIdentity: string, meta?: Record<string, unknown>) => void
  /** S6-4 节点锁(N11):用户一键锁/解锁;AI 改它由 gate deny,事件 source 恒 user。 */
  setNodeLocked: (nodeId: string, locked: boolean) => void
  moveNode: (nodeId: string, position: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveNodes: (updates: readonly { nodeId: string; position: { x: number; y: number } }[], options?: CanvasMutationOptions) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  /** 一键整理：把某分类节点重排成 storyboard 网格（按屏幕宽高比铺成宽块）。可撤销。 */
  tidyCategory: (categoryId: string, targetAspect: number) => void
  deleteSelectedNodes: () => void
  selectNode: (nodeId: string, additive?: boolean) => void
  selectNodes: (nodeIds: readonly string[]) => void
  clearSelection: () => void
  selectAllNodes: (categoryId?: string) => void
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
  /** 完成一条待连线。`options.mode` = 调用方指定边语义（「试试」首尾帧配方：首帧 / 尾帧），仍过同一道连线总闸。 */
  connectToNode: (targetNodeId: string, options?: { mode?: GenerationCanvasEdge['mode'] }) => EdgeCapabilityResult | GroupConnectResult
  /**
   * 连一条边——**新边的唯一写边边界**：不管目标有没有参数槽，都先过 validateReferenceEdge（目标这一类收不收输入 connects.input、档案收不收这种素材）。
   * `provenance: true` = 系统产物的出处边（全景截图 → 素材卡、导演台 / 画板 / 剪辑导出 → 输出卡、事实表……）：目标本来就是只读的派生卡，
   * 不是「用户加输入」，显式跳过总闸；其余一律不许绕。
   */
  connectNodes: (sourceNodeId: string, targetNodeId: string, mode?: GenerationCanvasEdge['mode'], targetParamKey?: string, order?: number, options?: { provenance?: boolean }) => void
  /**
   * 把待连的线落到**一个组**上：给组内每个成员各连一根真边，并记下组入参
   * （以后新进组的成员自动补一根）。图结构不变——组只是输入手势的语法糖，见 model/groupInputLinks.ts。
   */
  connectToGroup: (groupId: string) => GroupConnectResult
  updateEdgeMode: (edgeId: string, mode: GenerationCanvasEdge['mode']) => void
  /** 单槽编辑解除该编组输入关系、保留其它槽；缺省仍按线菜单语义整组断开。 */
  disconnectEdge: (edgeId: string, options?: { scope: 'parameter' }) => void
  moveGroupNodes: (groupId: string, delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  /**
   * Alt/⌥ 拖框：在原地复制一个框（成员 + 成员之间的连线 + 框自己的矩形），返回新框 id。
   * 一次撤销点；随后的拖动只搬新框（useCanvasSelectionDrag）。空框也能复制。
   */
  duplicateGroupForDrag: (groupId: string) => string | null
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
  arrangeGroup: (groupId: string, mode: GroupArrangeMode) => void
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  ungroup: (groupId: string) => void
  ungroupGroups: (groupIds: string[]) => void
  deleteGroup: (groupId: string, deleteNodes?: boolean) => void
  moveNodeToGroup: (nodeId: string, groupId: string) => void
  removeNodeFromGroup: (nodeId: string) => void
  reorderGroup: (categoryId: string, activeGroupId: string, overGroupId: string) => void
}

export type CanvasRunActions = {
  setNodeStatus: (nodeId: string, status: GenerationNodeStatus, error?: string) => void
  /** 收起失败卡：有旧产物 → 回 success（露出下面那条片子），没有 → 回 idle。错误原文仍留在 runs 里。 */
  dismissNodeError: (nodeId: string) => void
  setNodeProgress: (nodeId: string, progress?: NodeProgressInput) => void
  appendNodeRun: (nodeId: string, run: NodeRunRecordInput) => GenerationNodeRunRecord
  trackNodeRun: (nodeId: string, runId: string, patch: NodeRunRecordPatch) => void
  addNodeResult: (nodeId: string, result: GenerationNodeResult, mediaDimensions?: MediaDimensions) => void
  /** 文本生成定稿落地（与 addNodeResult 同为落地：不进撤销，撤销 / 重做也不撤掉它）。 */
  landNodeContent: (nodeId: string, contentJson: TiptapDocJson, runId?: string) => void
  /** 结局到达时节点不在（生成中被删了）：按 nodeId 暂存，任何一扇门把节点带回来时由统一提交口落上去。 */
  holdRunOutcome: (nodeId: string, outcome: HeldNodeOutcome) => void
}

/** 节点不在时到达的结局，按 nodeId 暂存（会话态，不进项目文件；项目释放 / 装载时清空）。 */
export type HeldNodeOutcomes = Record<string, HeldNodeOutcome[]>

/**
 * 整图 / 整节点写回——只在统一提交口（store/canvasDocumentCommit.ts）实现：编辑层取传进来的，事实层取活的。
 * 这里的键必须恰好等于动作分层表里 layer 为 'document' 的那些（canvasWriteBoundary 的类型断言）。
 */
export type CanvasDocumentActions = {
  /** 打开项目：硬重置（清选区 / 剪贴板 / 暂存，撤销基线从这里起）。 */
  restoreSnapshot: (snapshot: unknown, projectId?: string) => void
  /** S5-b-1 崩溃恢复:把快照之后落盘的事件尾巴重放回投影(reducer 幂等)。 */
  applyEventTail: (events: readonly { type: string; payload: Record<string, unknown> }[]) => void
  undo: () => void
  redo: () => void
  /**
   * A 模式实时桥：外部 MCP 读到 `base`、算出整张 `next`，这里只把它自己改了的编辑合到此刻的画布
   * （与盘上同一个合并函数），事实层取此刻的。会话中应用：保留视口、入撤销历史、触发防抖落盘。
   */
  applyExternalGraph: (write: Readonly<{ base: CanvasDocLike; next: CanvasDocLike }>) => void
  /** 把被删的节点 / 边按原 id 放回（已在的跳过）；节点不在期间到达的结局随之落上。 */
  restoreGraph: (nodes: readonly GenerationCanvasNode[], edges: readonly GenerationCanvasEdge[]) => void
  /** 把一个仍在的节点的 meta / prompt 放回某一刻；结果、运行态、跟主图走的媒体尺寸取此刻的。 */
  restoreNodeFields: (nodeId: string, meta: Readonly<Record<string, unknown>>, prompt: string) => void
}

export type GenerationCanvasState = {
  projectId: string | null
  /**
   * 这个项目的画布内容已经载入。唯一置 true 的是 restoreSnapshot（打开项目时 restoreWorkbenchProjectPayload 调它），
   * releaseProject 复位。「打开时适应一次」判的就是它——画布组件挂载不是「载入完」，不许在挂载时写它
   * （挂载若先于内容，适应会看到「ready 了、画布是空的」而放弃；2026-09-26 删掉了挂载时那一处写入）。
   */
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
  generationAiDraft: string
  generationAiMessages: WorkbenchAiMessage[]
  generationAiCollapsed: boolean
  canUndo: boolean
  canRedo: boolean
  hasClipboard: boolean
  heldNodeOutcomes: HeldNodeOutcomes
  captureHistory: () => void
  setGenerationAiDraft: (draft: string) => void
  setGenerationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setGenerationAiCollapsed: (collapsed: boolean) => void
  resetGenerationAiConversation: () => void
  duplicateNodesForDrag: (nodeIds: string[]) => Map<string, string>
  /** Cmd/Ctrl+D：所选节点及其之间的边原地偏移复制，一个撤销点，不动用户剪贴板。 */
  duplicateSelectedNodes: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  /**
   * 粘贴剪贴板里的节点。`basePosition` = 画布坐标点；`anchor` = 这一点压在粘贴簇外接盒的哪一处（比例），
   * 不传 = 左上角（旧约定，右键菜单之外的调用方都应传 anchor，见 model/canvasPlacement.ts）。
   */
  pasteNodes: (basePosition?: { x: number; y: number }, anchor?: CanvasPlacementAnchor) => void
  readSnapshot: () => GenerationCanvasSnapshot
  /** 持久化视图(S5-b-0):无 selectedNodeIds——选区是会话态不进项目文件。 */
  readDocumentSnapshot: () => Omit<GenerationCanvasSnapshot, 'selectedNodeIds'>
} & CanvasNodeActions & CanvasGraphActions & CanvasRunActions & CanvasDocumentActions

/** Slice creator typed against the store's middleware stack (subscribeWithSelector + immer). */
export type CanvasSliceCreator<T> = StateCreator<
  GenerationCanvasState,
  [['zustand/subscribeWithSelector', never], ['zustand/immer', never]],
  [],
  T
>

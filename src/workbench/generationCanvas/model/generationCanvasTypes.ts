import type { GenerationNodeKind } from './generationNodeKinds'
import type { NodeRenderKind } from '../../project/projectCategories'
import type { GenerationNodeStatus as SharedGenerationNodeStatus } from '../../../../electron/shared/canvas/generationNodeStatus'
import type { CanvasPluginNodeState } from '../plugins/canvasPluginTypes'
import type { CanvasWorkflowTemplate } from '../plugins/canvasWorkflowTemplates'

export type { GenerationNodeKind } from './generationNodeKinds'

// recoverable：异步任务超时但上游可能仍在跑/已出片——可「重新拉取结果」找回，不是失败。
// 刻意独立于 error：① 不进红色错误桶误导用户 ② 批量/下游逻辑不把它当真失败传染。
export type GenerationNodeStatus = SharedGenerationNodeStatus

export type GenerationResultType = 'image' | 'video' | 'text' | 'audio' | 'model3d'

export type GenerationNodeTaskKind = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'workflow' | 'asset' | 'unknown'

export const CATEGORY_IDS = ['shots', 'cast', 'scene', 'prop', 'audio'] as const

/** 内置 5 分类 id（闭合）。自定义顶层分类用任意字符串 id，故 CategoryId 放宽为 string。 */
export type BuiltinCanvasCategoryId = (typeof CATEGORY_IDS)[number]

export type CategoryId = string

/**
 * 按 kind 推断节点默认所属分类——kind→分类的唯一真相源。
 * 创建（默认画布/手动添加/agent 工具）与迁移（projectCategoryMigration）共用本函数；
 * 此前两处各持一份映射且互相矛盾（text 在迁移侧被判 null 删除），是「新建空白项目
 * 走 legacy 迁移并删默认节点」的根因（2026-06-13 审计 A4）。
 * - character → 'cast'（角色）
 * - scene / panorama / scene3d → 'scene'（场景资产）
 * - 其余（image/video/keyframe/shot/output/text…）→ 'shots'（分镜）
 * prop/audio 无独占 kind，由各自创建流程显式指定，不在此推断。
 */
export function getDefaultCategoryForNodeKind(kind: GenerationNodeKind): BuiltinCanvasCategoryId {
  switch (kind) {
    case 'character':
      return 'cast'
    case 'scene':
    case 'panorama':
    case 'scene3d':
    case 'model3d':
      return 'scene'
    case 'audio':
      return 'audio'
    default:
      return 'shots'
  }
}

/**
 * Phase E Task E11 — Complete provenance record for a generated asset.
 *
 * Recorded at generation time so a user can: (a) see WHY a node looks
 * the way it does (full prompt + params), (b) re-run with the same exact
 * configuration months later to reproduce, (c) compare V1 vs V2 of the
 * same shot. All fields optional for backward compatibility with legacy
 * v0.4.0 results that don't have provenance.
 */
export type GenerationProvenance = {
  provider?: string
  modelKey?: string
  modelVersion?: string
  prompt?: string
  negativePrompt?: string
  seed?: number
  params?: Record<string, unknown>
  vendorRequestId?: string
  cost?: { amount: number; currency: string; unit: 'estimate' | 'actual' }
  timestamp: number
  agentRunId?: string
}

export type GenerationNodeResult = {
  id: string
  type: GenerationResultType
  url?: string
  thumbnailUrl?: string
  /** 原始 CDN URL（https://...）。url 是本地 nomi-local://，providerUrl 是 vendor 返回的公网地址。 */
  providerUrl?: string
  text?: string
  model?: string
  durationSeconds?: number
  taskId?: string
  taskKind?: GenerationNodeTaskKind
  assetId?: string
  assetRefId?: string
  raw?: unknown
  createdAt: number
  /** Phase E E11: Complete provenance for reproducibility. */
  provenance?: GenerationProvenance
}

export type GenerationNodeProgress = {
  runId?: string
  taskId?: string
  taskKind?: GenerationNodeTaskKind
  phase?: string
  message?: string
  percent?: number
  updatedAt: number
}

export type GenerationNodeRunStatus = Exclude<GenerationNodeStatus, 'idle'> | 'cancelled'

export type GenerationNodeRunRecord = {
  id: string
  status: GenerationNodeRunStatus
  taskId?: string
  taskKind?: GenerationNodeTaskKind
  assetId?: string
  assetRefId?: string
  progress?: GenerationNodeProgress
  resultId?: string
  error?: string
  raw?: unknown
  startedAt: number
  updatedAt: number
  completedAt?: number
  durationSeconds?: number
}

/**
 * Phase C5: Tiptap document JSON for inline-editable `text`-kind node bodies.
 * Kept structurally loose so the canvas model doesn't couple to @tiptap types;
 * consumers cast to JSONContent at the editor boundary.
 */
export type TiptapDocJson = { type: 'doc'; content?: unknown[] }

export type GenerationCanvasNode = {
  id: string
  kind: GenerationNodeKind
  /** Optional host-owned plugin renderer identity; `kind` remains the closed semantic kind. */
  typeId?: string
  pluginState?: CanvasPluginNodeState
  title: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  prompt?: string
  references?: string[]
  result?: GenerationNodeResult
  history?: GenerationNodeResult[]
  progress?: GenerationNodeProgress
  runs?: GenerationNodeRunRecord[]
  status?: GenerationNodeStatus
  error?: string
  meta?: Record<string, unknown>
  /**
   * Phase E: category this node belongs to within the project's directory tree.
   * Legacy v0.4 nodes have no value here; the project loader normalizes them
   * via projectCategoryMigration (E4). Optional for backward compat; after v0.6
   * normalization every node should have a categoryId.
   */
  categoryId?: CategoryId
  groupId?: string
  /**
   * S6-4 节点锁(N11)：用户锁定的节点，AI 不能改 prompt/删除/接入边（gate deny），
   * 出边引用照常（定妆用途）。对用户是软门：点锁标一次解锁。事件 source 恒 user。
   */
  locked?: boolean
  /**
   * E.2C-15 语义收窄：**仅用于跨分类独立副本**。
   * 当一个节点从 A 分类拖到 B 分类时，B 中的新副本 derivedFrom = A 节点 id。
   * 这是只读元数据，不做双向同步。
   * 同分类内"基于此重新生成"用 `regeneratedFrom` 字段，避免语义混淆。
   */
  derivedFrom?: string
  /**
   * E.2C-15 新增：同分类内"基于此节点重新生成变体"的关系。
   * 与 derivedFrom 不同，这是同分类血缘链（V1 → V2 → V3），UI 不显示"独立副本"角标。
   */
  regeneratedFrom?: string
  /**
   * E.2C-15 新增：分镜分类自动编号（仅 shots 分类用）。
   * 由 store selector 按 (categoryId='shots', position.y 升序) 计算并写入。
   * 拖动后重新计算。其它分类节点不写入此字段。
   */
  shotIndex?: number
  /**
   * E.2C-15 新增：节点渲染样式分发 key。
   * 决定 BaseGenerationNode 走哪个 render 组件（ShotFrameNode / CharacterCardNode 等）。
   * 新建节点时按 category.defaultNodeRenderKind 写入。可选，缺省时按 categoryId 推断。
   */
  renderKind?: NodeRenderKind
  /** Phase C5: rich-text document body for inline-editable `text` nodes (Tiptap JSON). */
  contentJson?: TiptapDocJson
}

export type NodeGroup = {
  id: string
  name: string
  categoryId: CategoryId
  nodeIds: string[]
  /** @deprecated Kept only for persisted-project compatibility; group chrome is design-system neutral. */
  color?: string
  /**
   * 框（Frame）的边界——**用户画出来的那个矩形**，2026-09-06 起是真相之一。
   * 画布渲染的框 = `union(frameBounds, 成员外接矩形 + padding)`：只长不缩，永不小于用户画的那个。
   * 几何算式的唯一 owner 是 `model/canvasFrameBounds.ts`；旧快照缺此字段的组在
   * `store/canvasSnapshotNormalizer.ts` 载入时按成员包围盒回填一次（幂等）。
   */
  frameBounds?: { x: number; y: number; w: number; h: number }
  /** 框头部那一句灰字说明（可空，画布上双击改）。旧快照无此字段 → optional。 */
  description?: string
  collapsed?: boolean
  /**
   * 组入参：连到这个组上的来源节点。**只是声明**——真边仍是普通 node→node 边（见 model/groupInputLinks.ts）。
   * 作用是让「以后新进组的成员自动补一根同款边」有据可依。旧快照无此字段 → optional。
   */
  inputLinks?: { sourceNodeId: string; mode?: GenerationCanvasEdgeMode }[]
  /**
   * 组出参：把这个组作为输入源的目标节点。每个当前/未来成员各物化一条 member→target 真边。
   * 旧快照无此字段 → optional。
   */
  outputLinks?: { targetNodeId: string }[]
  /**
   * P4 S5 分镜组幂等章：多镜产物落画布时打的操作 id（materializationOperationId）。作用同节点上的
   * 同名 meta——崩溃/重开项目补落时，先按此章找已建的分镜组复用，绝不重复建组（§3.4「组也打章」）。
   * 只有语义多镜物化通道会写；用户手动建组 / 旧快照无此字段 → optional。
   */
  materializationOperationId?: string
  createdAt: number
  updatedAt: number
}

export type GenerationCanvasEdge = {
  id: string
  source: string
  target: string
  mode?: GenerationCanvasEdgeMode
  /** Explicit destination parameter identity, independent of the reference semantic. */
  targetParamKey?: string
  /**
   * 落入同一 target 的放入顺序（0,1,2…）。数组参考槽（image_ref，characterIndexed）按它对应
   * prompt 的 character1..N；保住「谁是 character1」。建边时由 connectNodes 按「该 target 现有边数」
   * 赋递增值（全模式单调，全局插入序）。显示(resolveReferenceSlots)与生成(resolveGenerationReferences)
   * 都按 order 排序落槽——同一真相源、顺序稳定，杜绝「显示读 meta、生成读边」分裂（audit 2026-06-16 §1d）。
   * 旧快照无此字段：排序退化为保持原数组序（与历史行为一致），故 optional、向后兼容。
   */
  order?: number
  /**
   * 溯源：这条边是由哪个组的输入或输出声明物化出来的（见 model/groupInputLinks.ts）。
   * 只用于**撤边时不误伤手工边**——成员移出组时只撤 viaGroupId 命中的那些。
   * 手动连的边恒无此字段。不参与任何读边/落槽逻辑。
   */
  viaGroupId?: string
}

export type GenerationCanvasEdgeMode =
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'style_ref'
  | 'character_ref'
  | 'composition_ref'

export type GenerationCanvasSnapshot = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  /** S5-b-0:选区是会话态——工具视图(readSnapshot)带,持久化视图(readDocumentSnapshot)不带。 */
  selectedNodeIds?: string[]
  groups: NodeGroup[]
  /** User-authored local workflow templates; optional for pre-plugin projects. */
  workflowTemplates?: CanvasWorkflowTemplate[]
}

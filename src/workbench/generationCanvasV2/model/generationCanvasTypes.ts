import type { GenerationNodeKind } from './generationNodeKinds'
import type { NodeRenderKind } from '../../project/projectCategories'

export type { GenerationNodeKind } from './generationNodeKinds'

export type GenerationNodeStatus = 'idle' | 'queued' | 'running' | 'success' | 'error'

export type GenerationResultType = 'image' | 'video' | 'text'

export type GenerationNodeTaskKind = 'text' | 'image' | 'video' | 'workflow' | 'asset' | 'unknown'

export const CATEGORY_IDS = ['shots', 'cast', 'scene', 'prop', 'audio'] as const

export type CategoryId = (typeof CATEGORY_IDS)[number]

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
  cost?: { amount: number; currency: string; unit: 'estimate' }
  timestamp: number
  agentRunId?: string
}

export type GenerationNodeResult = {
  id: string
  type: GenerationResultType
  url?: string
  thumbnailUrl?: string
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

export type GenerationCanvasNode = {
  id: string
  kind: GenerationNodeKind
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
}

export type NodeGroup = {
  id: string
  name: string
  categoryId: CategoryId
  nodeIds: string[]
  color?: string
  frameBounds?: { x: number; y: number; w: number; h: number }
  collapsed?: boolean
  createdAt: number
  updatedAt: number
}

export type GenerationCanvasEdge = {
  id: string
  source: string
  target: string
  mode?: GenerationCanvasEdgeMode
}

export type GenerationCanvasEdgeMode =
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'style_ref'
  | 'character_ref'
  | 'composition_ref'

export type GenerationCanvasSelectionRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type GenerationCanvasSnapshot = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  selectedNodeIds: string[]
  groups: NodeGroup[]
}

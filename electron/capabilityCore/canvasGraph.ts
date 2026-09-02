// 能力核 · 纯图操作领域层（见 docs/plan/2026-06-20-capability-core-headless-exposure.md）。
//
// 这是「外部 agent / CLI / MCP 驱动 Nomi 画布」的最底层：把对画布工程的语义操作
// （建节点 / 连线 / 改提示词 / 删节点）实现成**纯函数**——输入一份
// GenerationCanvasSnapshot（即 project.json 的 payload.generationCanvas，纯 JSON），
// 输出新的 snapshot + 受影响的 id。零 electron、零 store、零副作用，故可在纯 Node 单测。
//
// 真相源铁律（P1）：节点/边的形状以 renderer 的 generationCanvasTypes 为准；这里**不复制
// 任何业务逻辑**——建节点经**共用工厂** `canvasNodeFactory`（与渲染层 store.addNode 同一份纯函数），
// 落点经**共用布局** `canvasNodeLayout`（与渲染层 resolveInsertionPosition / trajectoryLayout 同一份数学），
// per-kind 几何/语义注入自 `nodeKindDomain`（由等价测试钉死 === src registry）。故 MCP 建的节点与
// UI 建的节点**字段级等价**（meta/categoryId/shotIndex/size 全齐），不再是缺字段的「二等公民」。
import { randomUUID } from 'node:crypto'
import { ANCHOR_META_KEYS, isVisualAnchorKind } from './anchorBible'
import { buildCanvasNodes, type CanvasNodeFactorySpec, type NodeFactoryDeps } from './canvasNodeFactory'
import { layoutBatchWith, type NodeBox } from './canvasNodeLayout'
import {
  nodeKindDefaultCategory,
  nodeKindDefaultSize,
  nodeKindFootprint,
  nodeKindIsShotNumbered,
  nodeKindNextShotIndex,
  isNodeKind,
} from './nodeKindDomain'

/** 画布快照（project.json payload.generationCanvas 的纯 JSON 形状）。 */
export type CanvasSnapshot = {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  groups?: unknown[]
  selectedNodeIds?: string[]
}

export type CanvasNode = {
  id: string
  kind: string
  title: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  prompt?: string
  references?: string[]
  status?: string
  categoryId?: string
  meta?: Record<string, unknown>
  [key: string]: unknown
}

export type CanvasEdge = {
  id: string
  source: string
  target: string
  mode?: string
  order?: number
}

/** 建节点入参——语义字段 + 可选模型身份；几何/分类/镜号由共用工厂补齐（与 UI 同）。 */
export type NodeSpec = {
  kind?: string
  title?: string
  prompt?: string
  x?: number
  y?: number
  references?: string[]
  /** 外部调用方（MCP）给的模型身份——工厂绑进 meta 的解析器可见四件（同 UI 身份部分）。非法值原样存。 */
  vendor?: string
  modelKey?: string
}

export type ConnectionSpec = {
  source: string
  target: string
  mode?: string
}

export const VALID_EDGE_MODES = new Set([
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
])

export class CanvasGraphError extends Error {
  readonly code: 'unknown_node_kind' | 'invalid_edge_mode' | 'node_not_found'
  readonly recovery = 'Refresh the canvas and retry with a current node kind, edge mode, or node id.'

  constructor(code: CanvasGraphError['code'], message: string) {
    super(message)
    this.name = 'CanvasGraphError'
    this.code = code
  }
}

let idCounter = 0

/**
 * 生成稳定且不撞的 id。不可用 Date.now()/Math.random() 之外的来源——这里用
 * crypto.randomUUID 保证跨进程唯一（撞 id 是「文字 clip 撞 id」那类 P0 的根因，见
 * clip-timeline-walkthrough 记忆），prefix 标明类型便于排错。
 */
function genId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${randomUUID().slice(0, 8)}-${idCounter.toString(36)}`
}

function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    ...(snapshot.groups ? { groups: snapshot.groups } : {}),
    ...(snapshot.selectedNodeIds ? { selectedNodeIds: [...snapshot.selectedNodeIds] } : {}),
  }
}

/** 空快照（新工程 / payload 缺 generationCanvas 时的兜底）。 */
export function emptyCanvasSnapshot(): CanvasSnapshot {
  return { nodes: [], edges: [], groups: [], selectedNodeIds: [] }
}

/** 读取持久化快照的唯一边界：未知 kind/mode 必须失败，不能被读面静默丢弃。 */
export function normalizeSnapshot(value: unknown): CanvasSnapshot {
  if (!value || typeof value !== 'object') return emptyCanvasSnapshot()
  const raw = value as Record<string, unknown>
  const nodes = Array.isArray(raw.nodes) ? (raw.nodes as CanvasNode[]) : []
  const edges = Array.isArray(raw.edges) ? (raw.edges as CanvasEdge[]) : []
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !isNodeKind(node.kind)) {
      throw new CanvasGraphError('unknown_node_kind', 'Canvas snapshot contains an unknown node kind')
    }
  }
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object' || (edge.mode !== undefined && !VALID_EDGE_MODES.has(edge.mode))) {
      throw new CanvasGraphError('invalid_edge_mode', 'Canvas snapshot contains an unknown edge mode')
    }
  }
  return {
    nodes,
    edges: edges.filter((edge) => edge && typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string'),
    groups: Array.isArray(raw.groups) ? (raw.groups as unknown[]) : [],
    selectedNodeIds: Array.isArray(raw.selectedNodeIds) ? (raw.selectedNodeIds as string[]) : [],
  }
}

// 能力核侧的工厂依赖注入：几何/分类/镜号全走 nodeKindDomain 纯表，与渲染层注入 src 真函数同一份工厂逻辑。
// resolveDefaultTitle **故意回空串**（不注英文标题）：main 进程无 i18n，若这里烘死 'Text'/'Image' 英文标题
// 会原样落进 project.json → zh-CN 用户看到英文卡名（MCP 省略 title 时）。空标题的本地化归**渲染时兜底**所有：
// 卡片渲染点已一律 `node.title || t(...)`（BaseGenerationNode NodeInlineImageTitle / AudioStripNode getDisplayTitle /
// Character·Scene·PropCardNode 的 EditableNodeTitle placeholder），故省略 title 存空 → UI 用当前 locale 补默认名。
// 渲染层注入 src i18n 真函数不受影响（它有 locale，直接给本地化默认名）。故两路仍字段级等价——除 id/落点与
// 「默认标题」这一 headless-i18n 策略差（一个存空待渲染补、一个即时本地化，落到用户眼里同为本地化默认名）。
const ELECTRON_NODE_FACTORY_DEPS: NodeFactoryDeps = {
  createId: () => genId('node'),
  resolveSize: nodeKindDefaultSize,
  resolveDefaultTitle: () => '',
  resolveCategory: nodeKindDefaultCategory,
  isShotNumbered: nodeKindIsShotNumbered,
  nextShotIndex: nodeKindNextShotIndex,
}

/**
 * 批量建节点（经**共用工厂 + 共用布局**，与渲染层 store.addNode 同一份逻辑）。
 * - 落点：≥2 节点走分层布局（层由 kind 推：参考/关键帧/视频三列，凑不齐退网格）；单节点走碰撞避让。
 *   显式 x/y 永远优先（工厂在 spec 层尊重）。都从已有节点包围盒下方起、不压旧内容。
 * - 字段：meta/categoryId/shotIndex/size 全由工厂补齐 → MCP 节点不再是缺字段的「二等公民」。
 * 返回新快照 + 新建 id（按入参顺序，供后续连线引用）。
 */
export function addNodes(
  snapshot: CanvasSnapshot,
  specs: NodeSpec[],
): { snapshot: CanvasSnapshot; ids: string[] } {
  const next = cloneSnapshot(snapshot)
  if (!specs.length) return { snapshot: next, ids: [] }
  for (const spec of specs) {
    if (spec.kind !== undefined && !isNodeKind(spec.kind.trim())) {
      throw new CanvasGraphError('unknown_node_kind', `Unknown canvas node kind: ${spec.kind}`)
    }
  }

  const factorySpecs: CanvasNodeFactorySpec[] = specs.map((spec) => ({
    kind: (spec.kind && spec.kind.trim()) || 'text',
    title: spec.title,
    prompt: spec.prompt,
    references: spec.references,
    vendor: spec.vendor,
    modelKey: spec.modelKey,
    ...(typeof spec.x === 'number' ? { x: spec.x } : {}),
    ...(typeof spec.y === 'number' ? { y: spec.y } : {}),
  }))
  // 缺省落点：已有节点做避让锚（同 UI「新内容落在已有下方、不遮挡」）。显式坐标由工厂优先，布局只补缺省。
  const existingBoxes: NodeBox[] = next.nodes.map((node) => ({
    kind: node.kind,
    position: node.position || { x: 0, y: 0 },
    size: node.size,
  }))
  const positions = layoutBatchWith(nodeKindFootprint, factorySpecs.map((spec) => spec.kind), existingBoxes)

  // 镜号只需既有节点的 shotIndex（工厂纯函数，不吃整节点）；显式投影避开 CanvasNode 的 index signature。
  const existingShotIndexes = next.nodes.map((node) => ({
    shotIndex: typeof node.shotIndex === 'number' ? node.shotIndex : undefined,
  }))
  const built = buildCanvasNodes(factorySpecs, positions, existingShotIndexes, ELECTRON_NODE_FACTORY_DEPS)
  for (const node of built) {
    // 角色/场景/道具卡自动带上 referenceSheet 标记——它本来就是参考卡，这是 kind 的推论，不是调用方的选项。
    // 为什么必须在这儿打：冻结门（anchorBible.isVisualAnchorNode）同时要 kind 和这个标记，而渲染层落节点
    // 时会写、headless MCP 这条路以前不写 → **MCP 建的定妆卡冻结门根本看不见**，整条「先冻脸再铺镜头」
    // 的一致性护栏在 MCP 路上等于不存在（2026-08-20 L2 走查实测抓出）。derive 不 hardcode，别人加新锚 kind
    // 时改 anchorBible 一处即可。
    const withAnchorMark = isVisualAnchorKind(node.kind)
      ? { ...node, meta: { ...((node as { meta?: Record<string, unknown> }).meta || {}), [ANCHOR_META_KEYS.referenceSheet]: true } }
      : node
    next.nodes.push(withAnchorMark as unknown as CanvasNode)
  }
  return { snapshot: next, ids: built.map((node) => node.id) }
}

/**
 * 批量连线。order 按「该 target 现有入边数」递增赋值（全模式单调、全局插入序）——
 * 与 renderer connectNodes 同一口径（generationCanvasTypes 注释），保住「谁是 character1」。
 * 跳过：端点不存在 / 自环 / 重复（同 source→target 同 mode）。返回新快照 + 新建边 id。
 */
export function connectNodes(
  snapshot: CanvasSnapshot,
  connections: ConnectionSpec[],
): { snapshot: CanvasSnapshot; edgeIds: string[]; skipped: Array<{ connection: ConnectionSpec; reason: string }> } {
  const next = cloneSnapshot(snapshot)
  const nodeIds = new Set(next.nodes.map((node) => node.id))
  const edgeIds: string[] = []
  const skipped: Array<{ connection: ConnectionSpec; reason: string }> = []
  for (const connection of connections) {
    if (connection.mode !== undefined && !VALID_EDGE_MODES.has(connection.mode)) {
      throw new CanvasGraphError('invalid_edge_mode', `Unknown canvas edge mode: ${connection.mode}`)
    }
    const mode = connection.mode || 'reference'
    if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) {
      skipped.push({ connection, reason: '端点节点不存在' })
      continue
    }
    if (connection.source === connection.target) {
      skipped.push({ connection, reason: '不能自连' })
      continue
    }
    const duplicate = next.edges.some(
      (edge) => edge.source === connection.source && edge.target === connection.target && (edge.mode || 'reference') === mode,
    )
    if (duplicate) {
      skipped.push({ connection, reason: '重复连线' })
      continue
    }
    const order = next.edges.filter((edge) => edge.target === connection.target).length
    const id = genId('edge')
    edgeIds.push(id)
    next.edges.push({ id, source: connection.source, target: connection.target, mode, order })
  }
  return { snapshot: next, edgeIds, skipped }
}

/** 改节点提示词（可选改标题）。幽灵节点必须是可恢复的显式失败。 */
export function setNodePrompt(
  snapshot: CanvasSnapshot,
  nodeId: string,
  prompt: string,
  title?: string,
): { snapshot: CanvasSnapshot; changed: boolean } {
  const index = snapshot.nodes.findIndex((node) => node.id === nodeId)
  if (index < 0) throw new CanvasGraphError('node_not_found', `Canvas node not found: ${nodeId}`)
  const next = cloneSnapshot(snapshot)
  next.nodes[index] = {
    ...next.nodes[index],
    prompt,
    ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
  }
  return { snapshot: next, changed: true }
}

/** 删节点 + 其关联边（入边出边都删，避免悬挂边）。返回新快照 + 实删 id。 */
export function deleteNodes(
  snapshot: CanvasSnapshot,
  nodeIds: string[],
): { snapshot: CanvasSnapshot; deleted: string[] } {
  const targetSet = new Set(nodeIds)
  const deleted = snapshot.nodes.filter((node) => targetSet.has(node.id)).map((node) => node.id)
  if (!deleted.length || deleted.length !== targetSet.size) {
    throw new CanvasGraphError('node_not_found', 'One or more canvas nodes were not found')
  }
  const next = cloneSnapshot(snapshot)
  next.nodes = next.nodes.filter((node) => !targetSet.has(node.id))
  next.edges = next.edges.filter((edge) => !targetSet.has(edge.source) && !targetSet.has(edge.target))
  if (next.selectedNodeIds) next.selectedNodeIds = next.selectedNodeIds.filter((id) => !targetSet.has(id))
  return { snapshot: next, deleted }
}

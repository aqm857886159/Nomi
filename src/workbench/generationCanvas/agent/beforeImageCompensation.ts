// 提议的「准备中」收据只能存下提议之前的整张图（before-image）：那一刻还不知道这笔会碰哪些对象。
// 这张图从不整图放回（整图放回会把提议之后落在别的节点上的付费结果、运行态一起盖掉——V-1072）。
// 执行补偿时拿它和此刻的画布逐对象比，算出已有的按对象补偿，交给同一个执行体去做：
// - 此刻有、提议之前没有的节点 → delete-nodes；
// - 提议之前有、此刻没有的节点（连同它们的边）→ restore-graph（经统一提交口放回，不在期间到达的结局随之落上）；
// - 提议之前没有、此刻有的连线 → disconnect-edges；
// - 两边都在、提示词或编辑层 meta 变了的节点 → restore-node-fields（经统一提交口，事实层取此刻的）。
// 提议能改的既有节点字段只有 prompt / meta（set_node_prompt、导演台写入、分镜投影），位置 / 标题 / 分组不在其列。
import type { ProjectAgentProposalCompensation } from '../../../../electron/shared/projectAgentProposalReceipt'
import { NODE_LANDED_META_KEYS } from '../../../../electron/shared/canvas/landedNodeFields'

type NodeLike = Readonly<{ id: string; prompt?: unknown; meta?: unknown }>
type EdgeLike = Readonly<{ id: string; source: string; target: string }>
type Graph = Readonly<{ nodes: readonly unknown[]; edges: readonly unknown[] }>

const isNode = (value: unknown): value is NodeLike =>
  Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
const isEdge = (value: unknown): value is EdgeLike =>
  isNode(value) && typeof (value as { source?: unknown }).source === 'string' && typeof (value as { target?: unknown }).target === 'string'

const LANDED_META = new Set<string>(NODE_LANDED_META_KEYS)

/** 编辑层 meta：去掉跟主图走的媒体尺寸（那是事实，落地写的，不算提议改的）。 */
function editMeta(node: NodeLike): string {
  const meta = node.meta && typeof node.meta === 'object' ? node.meta as Record<string, unknown> : {}
  return JSON.stringify(Object.keys(meta).filter((key) => !LANDED_META.has(key)).sort().map((key) => [key, meta[key]]))
}

const pair = (edge: EdgeLike) => `${edge.source}→${edge.target}`

export function compensationFromBeforeImage(before: Graph, current: Graph): ProjectAgentProposalCompensation[] {
  const beforeNodes = new Map(before.nodes.filter(isNode).map((node) => [node.id, node]))
  const currentNodes = new Map(current.nodes.filter(isNode).map((node) => [node.id, node]))
  const created = [...currentNodes.keys()].filter((id) => !beforeNodes.has(id))
  const createdIds = new Set(created)
  const removed = [...beforeNodes.values()].filter((node) => !currentNodes.has(node.id))
  const beforeEdges = before.edges.filter(isEdge)
  const currentEdges = current.edges.filter(isEdge)
  const currentEdgeIds = new Set(currentEdges.map((edge) => edge.id))
  const beforePairs = new Set(beforeEdges.map(pair))
  const survivingAfterRestore = new Set([...beforeNodes.keys()])
  const restoredEdges = beforeEdges.filter((edge) => !currentEdgeIds.has(edge.id)
    && survivingAfterRestore.has(edge.source) && survivingAfterRestore.has(edge.target))
  const addedPairs = currentEdges
    .filter((edge) => !beforePairs.has(pair(edge)) && !createdIds.has(edge.source) && !createdIds.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }))
  const fieldOps: ProjectAgentProposalCompensation[] = [...beforeNodes.values()].flatMap((node) => {
    const now = currentNodes.get(node.id)
    if (!now || (String(now.prompt ?? '') === String(node.prompt ?? '') && editMeta(now) === editMeta(node))) return []
    const meta = node.meta && typeof node.meta === 'object' ? node.meta as Record<string, unknown> : {}
    return [{ kind: 'restore-node-fields' as const, nodeId: node.id, meta: JSON.parse(JSON.stringify(meta)) as Record<string, unknown>, prompt: String(node.prompt ?? '') }]
  })
  // 执行体倒序应用：先删提议建的、断提议连的，再放回提议删的，最后放回改过的字段。
  return [
    ...fieldOps,
    ...(removed.length || restoredEdges.length ? [{ kind: 'restore-graph' as const, nodes: removed, edges: restoredEdges }] : []),
    ...(addedPairs.length ? [{ kind: 'disconnect-edges' as const, pairs: addedPairs }] : []),
    ...(created.length ? [{ kind: 'delete-nodes' as const, nodeIds: created }] : []),
  ]
}

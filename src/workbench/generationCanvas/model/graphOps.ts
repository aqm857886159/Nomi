import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'
import {
  getGenerationNodeDefaultSize,
  getGenerationNodeDefaultTitle,
} from './generationNodeKinds'

export { DEFAULT_NODE_SIZE, NODE_KIND_LABEL } from './generationNodeKinds'

export const EDGE_MODE_LABEL: Record<GenerationCanvasEdgeMode, string> = {
  reference: '素材参考',
  first_frame: '首帧',
  last_frame: '尾帧',
  style_ref: '风格',
  character_ref: '角色',
  composition_ref: '构图',
}

export const EDGE_MODE_ORDER: GenerationCanvasEdgeMode[] = [
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
]

export function createGenerationNode(input: {
  id: string
  kind: GenerationNodeKind
  title?: string
  x?: number
  y?: number
  prompt?: string
}): GenerationCanvasNode {
  const size = getGenerationNodeDefaultSize(input.kind)
  return {
    id: input.id,
    kind: input.kind,
    title: input.title || getGenerationNodeDefaultTitle(input.kind),
    position: { x: input.x ?? 120, y: input.y ?? 120 },
    size,
    prompt: input.prompt || '',
    references: [],
    history: [],
    status: 'idle',
    meta: {},
  }
}

export function upsertNode(nodes: GenerationCanvasNode[], nextNode: GenerationCanvasNode): GenerationCanvasNode[] {
  const index = nodes.findIndex((node) => node.id === nextNode.id)
  if (index < 0) return [...nodes, nextNode]
  return nodes.map((node) => (node.id === nextNode.id ? { ...node, ...nextNode } : node))
}

export function patchNode(
  nodes: GenerationCanvasNode[],
  nodeId: string,
  patch: Partial<GenerationCanvasNode>,
): GenerationCanvasNode[] {
  return nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
}

export function removeNodes(
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
  nodeIds: string[],
): { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] } {
  const idSet = new Set(nodeIds)
  return {
    nodes: nodes.filter((node) => !idSet.has(node.id)),
    edges: edges.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target)),
  }
}

export function createEdgeId(source: string, target: string, order = 0): string {
  // mode 不适合进 id：用户改边标签时 mode 会变，边身份应该稳定。
  // 用 target 内单调 order 作序号，同两点的多语义边也能各自点中/删除。
  // 端点先 encode，再用 `::` 分隔，避免 a-b→c 与 a→b-c 这类字符串拼接冲突。
  return `edge-${encodeURIComponent(source)}::${encodeURIComponent(target)}::${order}`
}

export function connectNodes(
  edges: GenerationCanvasEdge[],
  source: string,
  target: string,
  mode: GenerationCanvasEdgeMode = 'reference',
): GenerationCanvasEdge[] {
  if (!source || !target || source === target) return edges
  // 去重按 (source,target,**mode**)：同两点连第二种语义的参考(如 Kling 首帧+尾帧、或一图既当
  // 角色参考又当风格参考)是合法的、应能连上。旧版只看 (source,target) → 静默吞掉第二条边
  // (「同两点连不了第二种参考」)，且 connectToNode 仍报 ok、用户无感(治「线连不上」R2)。
  if (edges.some((edge) => edge.source === source && edge.target === target && edge.mode === mode)) return edges
  // order = 该 target 现有入边数：保住「放入顺序」= 数组参考 character1..N 的真相源（audit 2026-06-16 §1d）。
  // 全模式单调（不按 mode 分桶）→ 数组槽落槽用单调序、首尾帧用 mode 位置偏好，互不打架。
  const order = nextEdgeOrderForTarget(edges, target)
  return [...edges, { id: createEdgeId(source, target, order), source, target, mode, order }]
}

/** 落入某 target 的下一个 order 序号。删过中间边后也只向前走，不复用存量序号。 */
export function nextEdgeOrderForTarget(edges: GenerationCanvasEdge[], target: string): number {
  const targetEdges = edges.filter((edge) => edge.target === target)
  if (!targetEdges.length) return 0
  const maxExplicitOrder = targetEdges.reduce(
    (max, edge) => typeof edge.order === 'number' && Number.isFinite(edge.order) ? Math.max(max, edge.order) : max,
    -1,
  )
  // 无 order 的旧边也占一个序号；两者取大确保升级后不撞身份。
  return Math.max(targetEdges.length, maxExplicitOrder + 1)
}

/**
 * 把指向某 target 的边按 order 升序排（无 order 的旧边视作 +∞，排在显式 order 之后但**保持彼此原数组序**，
 * = 旧快照行为不变）。显示(resolveReferenceSlots)与生成(resolveGenerationReferences)共用这一份，
 * 保证两侧落槽顺序一致、稳定（治「显示读 meta、生成读边」分裂 + #4 整类）。
 */
export function sortEdgesByOrder(edges: GenerationCanvasEdge[]): GenerationCanvasEdge[] {
  return edges
    .map((edge, index) => ({ edge, index }))
    .sort((a, b) => {
      const ao = a.edge.order ?? Number.POSITIVE_INFINITY
      const bo = b.edge.order ?? Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
      return a.index - b.index // 稳定：同 order / 都无 order → 保持原数组序
    })
    .map((item) => item.edge)
}

export function disconnectEdge(edges: GenerationCanvasEdge[], edgeId: string): GenerationCanvasEdge[] {
  return edges.filter((edge) => edge.id !== edgeId)
}

export function rollbackNodeHistory(nodes: GenerationCanvasNode[], nodeId: string, resultId: string): GenerationCanvasNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    const result = (node.history || []).find((entry) => entry.id === resultId)
    if (!result) return node
    return { ...node, result, status: 'success', error: undefined }
  })
}

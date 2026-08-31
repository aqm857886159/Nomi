// ComfyUI 工作流「只读节点图」的视图模型（纯函数，可单测，不碰像素）。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 为什么自己算而不引图库：仓库零图库依赖（package.json 实查），生成画布本身就是
// CSS transform + 绝对定位 div + SVG 连线层自研的；参考项目 Infinite-Canvas 那张图同样没用
// 任何图库（自写 JS + SVG + level/column 分层）。再引一个 = 并行实现（P1）。
//
// 分层沿用「最长路径深度」：一个节点的列号 = 它所有上游列号的最大值 + 1。用最长路径而不是
// 最短，是为了让消费者永远排在生产者右边——最短路径会把「既被 KSampler 用、又被 SaveVideo
// 直接引用」的加载器画到成品节点右侧，连线倒着走，人一眼就迷路。
//
// 节点显示名**不做中文对照表**：ComfyUI 的 class_type 有无穷多社区变体，白名单追不完
// （comfyuiWorkflowImport.ts 已经因为这个吃过亏）。改用作者自己在 ComfyUI 里改的节点标题
// （_meta.title）——那是真人起的名字，比我们编的翻译贴切；没有就退回 class_type。

/** 上游/下游都按 API 格式的连线值判定：[nodeId, slot]。 */
type LinkValue = [string, number]

export type GraphNodeInput = {
  class_type?: string
  inputs?: Record<string, unknown>
  _meta?: { title?: string }
}
export type GraphInput = Record<string, GraphNodeInput>

/** 角色占位（与 electron 侧 WorkflowBinding 的角色字段一一对应）。 */
export type GraphRole = 'prompt' | 'firstFrame' | 'lastFrame' | 'sourceVideo' | 'output'

export type GraphBinding = {
  promptNodeId?: string
  firstFrameNodeId?: string
  lastFrameNodeId?: string
  sourceVideoNodeId?: string
  outputNodeId?: string
  params?: ReadonlyArray<{ nodeId: string; inputKey: string }>
}

export type GraphViewNode = {
  nodeId: string
  /** 作者起的标题优先，没有就 class_type（不做中文对照表，见文件头）。 */
  title: string
  classType: string
  /** 这个节点担任的角色；一个节点最多一个。 */
  role: GraphRole | null
  /** 这个节点有几个输入被暴露成了画布上的可调参数（节点上的「N 已用」角标）。 */
  exposedCount: number
  column: number
  row: number
}

export type GraphViewEdge = { from: string; to: string }

export type GraphView = {
  nodes: GraphViewNode[]
  edges: GraphViewEdge[]
  /** 最宽的一列有几个节点——view 层据此定画布高度。 */
  columnCount: number
  rowCount: number
}

function isLink(value: unknown): value is LinkValue {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number'
}

/** 节点的上游节点 id（去重；连到不存在节点的悬空边直接丢，别让它影响分层）。 */
function upstreamOf(graph: GraphInput, nodeId: string): string[] {
  const inputs = graph[nodeId]?.inputs
  if (!inputs || typeof inputs !== 'object') return []
  const out = new Set<string>()
  for (const value of Object.values(inputs)) {
    if (isLink(value) && graph[value[0]] && value[0] !== nodeId) out.add(value[0])
  }
  return [...out]
}

/**
 * 每个节点的列号 = 上游列号最大值 + 1（最长路径深度）。
 * 记忆化 + visiting 环检测：ComfyUI 正常图是 DAG，但用户手改过的 json 出现过环，
 * 撞环就把这一支当深度 0 收住——**绝不允许无限递归把设置页整个卡死**。
 */
function computeColumns(graph: GraphInput): Map<string, number> {
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (nodeId: string): number => {
    const cached = depth.get(nodeId)
    if (cached !== undefined) return cached
    if (visiting.has(nodeId)) return 0 // 环：就地收住
    visiting.add(nodeId)
    let best = 0
    for (const parent of upstreamOf(graph, nodeId)) {
      best = Math.max(best, resolve(parent) + 1)
    }
    visiting.delete(nodeId)
    depth.set(nodeId, best)
    return best
  }
  for (const nodeId of Object.keys(graph)) resolve(nodeId)
  return depth
}

function roleOf(binding: GraphBinding, nodeId: string): GraphRole | null {
  if (binding.promptNodeId === nodeId) return 'prompt'
  if (binding.firstFrameNodeId === nodeId) return 'firstFrame'
  if (binding.lastFrameNodeId === nodeId) return 'lastFrame'
  if (binding.sourceVideoNodeId === nodeId) return 'sourceVideo'
  if (binding.outputNodeId === nodeId) return 'output'
  return null
}

/**
 * 只读节点图的视图模型。
 * 节点在列内按 **nodeId 数值序**排，不按 Object.keys 顺序——后者取决于 JSON 里键的书写顺序，
 * 同一张图重新导出一次布局就会跳（用户会以为图变了）。数值序是稳定的。
 */
export function buildWorkflowGraphView(graph: GraphInput, binding: GraphBinding): GraphView {
  const columns = computeColumns(graph)
  const exposed = new Map<string, number>()
  for (const param of binding.params ?? []) {
    exposed.set(param.nodeId, (exposed.get(param.nodeId) ?? 0) + 1)
  }

  const byColumn = new Map<number, string[]>()
  for (const nodeId of Object.keys(graph)) {
    const column = columns.get(nodeId) ?? 0
    const list = byColumn.get(column)
    if (list) list.push(nodeId)
    else byColumn.set(column, [nodeId])
  }

  const nodes: GraphViewNode[] = []
  let rowCount = 0
  for (const [column, ids] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = [...ids].sort((a, b) => {
      const na = Number(a)
      const nb = Number(b)
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
      return a.localeCompare(b)
    })
    rowCount = Math.max(rowCount, ordered.length)
    ordered.forEach((nodeId, row) => {
      const node = graph[nodeId]
      const classType = node?.class_type ?? ''
      const title = node?._meta?.title?.trim() || classType || nodeId
      nodes.push({
        nodeId,
        title,
        classType,
        role: roleOf(binding, nodeId),
        exposedCount: exposed.get(nodeId) ?? 0,
        column,
        row,
      })
    })
  }

  const seenEdge = new Set<string>()
  const edges: GraphViewEdge[] = []
  for (const nodeId of Object.keys(graph)) {
    for (const from of upstreamOf(graph, nodeId)) {
      const key = `${from}->${nodeId}`
      if (seenEdge.has(key)) continue
      seenEdge.add(key)
      edges.push({ from, to: nodeId })
    }
  }

  return { nodes, edges, columnCount: byColumn.size, rowCount }
}

// 画布「一键整理」布局（方案 A，2026-06-19）。纯函数：把当前分类节点重排成 storyboard 结构。
//
// 为什么需要它：落点系统每处都「局部合理」（螺旋避让/切片紧凑/批量分层），但**没有全局组织**，
// 节点只在诞生那刻摆一次，多批 agent + 手拖 + 切片累积成毛线球，且回不到整齐。整理是按需 action，
// 把整屏收纳成：材料行（顶）→ 镜头网格（按 shotIndex 阅读序，随宽折行）→ 切片贴父镜头成簇。
//
// 间距一律用 getGenerationNodeFootprintSize（足迹 = 名义 + NODE_RENDER_SAFETY，自带安全余量即是
// 间距）——与 resolveInsertionPosition / trajectoryLayout 同一真相源，不另搞一套（否则重叠 bug 重演）。
import { getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

export type TidyNode = {
  id: string
  kind: GenerationNodeKind
  position: { x: number; y: number }
  size?: { width: number; height: number }
  shotIndex?: number
  derivedFrom?: string
  meta?: { sourceNodeId?: unknown } & Record<string, unknown>
}
export type TidyEdge = { source: string; target: string }

type Point = { x: number; y: number }
type Size = { width: number; height: number }

const ORIGIN_X = 160
const ORIGIN_Y = 160
const LANE_GAP = 80 // 材料区与镜头区之间的分隔

function footprint(node: TidyNode): Size {
  return getGenerationNodeFootprintSize(node.kind, node.size)
}

/**
 * 当前分类节点 → 整理后坐标。返回 Map<id, position>（与入参等集）。
 * 结构：材料（纯输入）排顶部网格 → 镜头区（按 shotIndex，每镜紧跟其切片）排下方网格。统一流式折行。
 *
 * `targetAspect` = 屏幕宽高比（stage 宽/高）。整块按此比例铺开（layoutWidth = √(总足迹面积×比例)）——
 * 不按视口宽硬折行（那样大节点只塞 3 个/排 → 高瘦长条），而是反推出「该多宽才接近屏幕横向比例」，
 * 「适应视图」后正好铺满宽屏（用户要的「宽、适配电脑屏幕」）。
 */
export function tidyCanvasLayout(
  nodes: readonly TidyNode[],
  edges: readonly TidyEdge[],
  targetAspect: number,
): Map<string, Point> {
  const result = new Map<string, Point>()
  if (nodes.length === 0) return result

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const idSet = new Set(nodes.map((node) => node.id))
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  const incomingIds = new Map<string, string[]>()
  const outgoingIds = new Map<string, string[]>()
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    incomingIds.set(edge.target, [...(incomingIds.get(edge.target) ?? []), edge.source])
    outgoingIds.set(edge.source, [...(outgoingIds.get(edge.source) ?? []), edge.target])
  }
  const connectedNodeIds = new Set<string>()
  for (const [nodeId, count] of incoming) if (count > 0) connectedNodeIds.add(nodeId)
  for (const [nodeId, count] of outgoing) if (count > 0) connectedNodeIds.add(nodeId)

  const graphDepthMemo = new Map<string, number>()
  const graphDepth = (nodeId: string, visiting = new Set<string>()): number => {
    const cached = graphDepthMemo.get(nodeId)
    if (cached !== undefined) return cached
    if (visiting.has(nodeId)) return 0
    visiting.add(nodeId)
    const parents = incomingIds.get(nodeId) ?? []
    const depth = parents.length > 0
      ? Math.max(...parents.map((parentId) => graphDepth(parentId, visiting) + 1))
      : 0
    visiting.delete(nodeId)
    graphDepthMemo.set(nodeId, depth)
    return depth
  }

  const reachableShotIndexMemo = new Map<string, number>()
  const reachableShotIndex = (nodeId: string, visiting = new Set<string>()): number => {
    const cached = reachableShotIndexMemo.get(nodeId)
    if (cached !== undefined) return cached
    const node = nodeById.get(nodeId)
    let best = node?.shotIndex ?? Number.POSITIVE_INFINITY
    if (visiting.has(nodeId)) return best
    visiting.add(nodeId)
    for (const targetId of outgoingIds.get(nodeId) ?? []) {
      best = Math.min(best, reachableShotIndex(targetId, visiting))
    }
    visiting.delete(nodeId)
    reachableShotIndexMemo.set(nodeId, best)
    return best
  }

  // 子节点：切片/裁剪（meta.sourceNodeId 指向集内某节点）。沿 sourceNodeId 链上溯到**根镜头祖先**——
  // 处理嵌套切片（切片的切片）：把整条衍生链都归到那个根镜头的簇，孙切片不掉队（真机根因：旧版只认一层
  // → 父是切片的孙节点永不被摆放，留在老坐标飞出去）。父不在集内则该节点自身降级为镜头。
  const immediateParent = new Map<string, string>()
  for (const node of nodes) {
    const parentId = typeof node.meta?.sourceNodeId === 'string' ? node.meta.sourceNodeId : null
    if (parentId && parentId !== node.id && idSet.has(parentId)) immediateParent.set(node.id, parentId)
  }
  const rootAncestor = (id: string): string => {
    let cur = id
    const seen = new Set<string>()
    while (immediateParent.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = immediateParent.get(cur)!
    }
    return cur
  }
  const childrenByParent = new Map<string, TidyNode[]>()
  const isChild = new Set<string>()
  for (const node of nodes) {
    const root = rootAncestor(node.id)
    if (root === node.id) continue // 自身就是根（非衍生）→ 不是子节点
    const list = childrenByParent.get(root) ?? []
    list.push(node)
    childrenByParent.set(root, list)
    isChild.add(node.id)
  }

  // 材料：纯输入（入边 0 且出边 > 0）。其余非子节点 = 镜头/主节点。
  const materials: TidyNode[] = []
  const mains: TidyNode[] = []
  for (const node of nodes) {
    if (isChild.has(node.id)) continue
    if ((incoming.get(node.id) ?? 0) === 0 && (outgoing.get(node.id) ?? 0) > 0) materials.push(node)
    else mains.push(node)
  }

  // 按目标宽高比反推折行宽度：块面积≈Σ足迹面积，宽=√(面积×比例)，高=√(面积/比例) → 块≈屏幕比例。
  // 至少容下最宽的单个节点（否则它每行独占还溢出）。aspect 夹在合理区间防异常测量产出离谱布局。
  const aspect = Math.min(4, Math.max(0.8, targetAspect || 1.6))
  let totalArea = 0
  let widest = 0
  for (const node of nodes) {
    const fp = footprint(node)
    totalArea += fp.width * fp.height
    widest = Math.max(widest, fp.width)
  }
  const layoutWidth = Math.max(widest, Math.sqrt(totalArea * aspect))
  const rightEdge = ORIGIN_X + layoutWidth

  // 扁平网格流式折行：每项占自身足迹，超宽换行，行高 = 行内最高足迹。返回该段底缘 y。
  // 切片尺寸不可控（常是大图，非小缩略图），故不搞「贴父小簇」（会被大切片撑成超高单列）——
  // 统一当网格项、在流里**紧跟其源镜头**（衍生物相邻、不拉长线），对任意尺寸鲁棒紧凑（Figma tidy 式）。
  const flowGrid = (items: TidyNode[], startY: number): number => {
    let x = ORIGIN_X
    let y = startY
    let rowH = 0
    for (const node of items) {
      const fp = footprint(node)
      if (x > ORIGIN_X && x + fp.width > rightEdge) {
        x = ORIGIN_X
        y += rowH
        rowH = 0
      }
      result.set(node.id, { x: Math.round(x), y: Math.round(y) })
      x += fp.width
      rowH = Math.max(rowH, fp.height)
    }
    return y + rowH
  }

  const withChildren = (anchors: TidyNode[]): TidyNode[] => {
    const out: TidyNode[] = []
    for (const anchor of anchors) {
      out.push(anchor)
      for (const child of childrenByParent.get(anchor.id) ?? []) out.push(child)
    }
    return out
  }

  // 材料区（纯输入，按当前 x 保留左右手感）排顶部；镜头区按 shotIndex、每镜紧跟切片，排材料下方。
  materials.sort((a, b) => {
    const ai = reachableShotIndex(a.id)
    const bi = reachableShotIndex(b.id)
    if (ai !== bi) return ai - bi
    return a.position.x - b.position.x || a.position.y - b.position.y
  })
  mains.sort((a, b) => {
    const ac = connectedNodeIds.has(a.id)
    const bc = connectedNodeIds.has(b.id)
    if (ac !== bc) return ac ? -1 : 1
    if (ac && bc) {
      const ad = graphDepth(a.id)
      const bd = graphDepth(b.id)
      if (ad !== bd) return ad - bd
      const ai = reachableShotIndex(a.id)
      const bi = reachableShotIndex(b.id)
      if (ai !== bi) return ai - bi
    }
    const ai = a.shotIndex ?? Number.POSITIVE_INFINITY
    const bi = b.shotIndex ?? Number.POSITIVE_INFINITY
    return ai - bi || a.position.y - b.position.y || a.position.x - b.position.x
  })
  const materialsBottom = materials.length > 0 ? flowGrid(withChildren(materials), ORIGIN_Y) : ORIGIN_Y
  flowGrid(withChildren(mains), materials.length > 0 ? materialsBottom + LANE_GAP : ORIGIN_Y)

  return result
}

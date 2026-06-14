/**
 * 节点关联计数 hooks。
 *
 * Live 计算的关联度量（spec §5.3）：
 * - useNodeUsageCount: 该节点被多少**分镜**引用（结构化引用边，非文本子串）
 * - useNodeVariantCount: 该节点的变体数（derivedFrom + regeneratedFrom 反查）
 *
 * v0.7.2 perf: 之前每次 store 变化每张卡都跑 O(n) filter → n 张卡 × O(n) = O(n²)
 * 现在用 WeakMap 缓存 keyed on (nodes, edges) 引用：相同输入只 build 一次，
 * 每张卡 O(1) Map.get 查询。zustand immer 保证未改的数组引用稳定 → 缓存命中率高。
 */
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../model/generationCanvasTypes'

// 审计 P3 根治：usageCount 从「prompt.includes(title)」子串匹配改为**结构化引用边**统计。
// 旧版用文本子串：title 是另一 title 子串（人物⊂人物特写）或重名即误计（历史 26 显示 36/26）。
// 现按引用关系：一个节点「被 N 个分镜引用」= 以它为 source、指向 shots 分类节点的去重边数
// （连边语义见 connectToNode：source=提供参考方，target=消费方/分镜）。文本无关，零假阳性。

// nodeId → 引用它的 shots 节点 id 集合
type UsageMap = Map<string, Set<string>>
const usageCache = new WeakMap<readonly GenerationCanvasEdge[], UsageMap>()

function buildUsageMap(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): UsageMap {
  const cached = usageCache.get(edges)
  if (cached) return cached
  const shotIds = new Set<string>()
  for (const node of nodes) {
    if ((node.categoryId || 'shots') === 'shots') shotIds.add(node.id)
  }
  const map: UsageMap = new Map()
  for (const edge of edges) {
    if (!shotIds.has(edge.target)) continue
    let bucket = map.get(edge.source)
    if (!bucket) {
      bucket = new Set<string>()
      map.set(edge.source, bucket)
    }
    bucket.add(edge.target) // Set 去重：同一 source→shot 多条边只算一个分镜
  }
  usageCache.set(edges, map)
  return map
}

/**
 * 纯计数（可单测，不依赖 store）：节点 nodeId 被多少**不同分镜**引用。
 * = 以 nodeId 为 source、target 为 shots 分类节点的去重边数。
 */
export function countShotUsage(
  nodeId: string,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): number {
  return buildUsageMap(nodes, edges).get(nodeId)?.size ?? 0
}

/**
 * 当前节点的"使用次数"：被多少个分镜（shots 分类）节点引用（结构化引用边）。
 *
 * 注：第二个参数 `_nodeTitle` 为历史子串匹配遗留，现已不用（计数与文本无关）。
 * 保留为可选并忽略，避免改动 render 层调用方（`SceneCardNode` 等）的签名。
 */
export function useNodeUsageCount(nodeId: string, _nodeTitle?: string | undefined): number {
  return useGenerationCanvasStore((state) => countShotUsage(nodeId, state.nodes, state.edges))
}

// sourceId → 变体数（直接派生自该 id 的节点数）
type VariantMap = Map<string, number>
const variantCache = new WeakMap<readonly GenerationCanvasNode[], VariantMap>()

function buildVariantMap(nodes: readonly GenerationCanvasNode[]): VariantMap {
  const cached = variantCache.get(nodes)
  if (cached) return cached
  const map: VariantMap = new Map()
  for (const node of nodes) {
    const sourceId = node.derivedFrom || node.regeneratedFrom
    if (sourceId) {
      map.set(sourceId, (map.get(sourceId) || 0) + 1)
    }
  }
  variantCache.set(nodes, map)
  return map
}

/**
 * 当前节点的"变体数"：直接派生自本节点的副本/重生成数。
 * 不递归（V1 → V2 → V3 中，对 V1 来说 variants=1 仅算 V2 不包括 V3）。
 */
export function useNodeVariantCount(nodeId: string): number {
  return useGenerationCanvasStore((state) => buildVariantMap(state.nodes).get(nodeId) || 0)
}

/**
 * 审计 A15：video 节点是否已连上「能供画面」的入边（首帧/尾帧/素材参考）。
 * 占位文案据此区分「没连边 → 提示拖图」vs「已连、上游未生成 → 提示等待」。
 */
export function useHasFrameSourceEdge(nodeId: string, enabled: boolean): boolean {
  return useGenerationCanvasStore((state) =>
    enabled &&
    state.edges.some(
      (edge) =>
        edge.target === nodeId &&
        (!edge.mode || edge.mode === 'first_frame' || edge.mode === 'last_frame' || edge.mode === 'reference'),
    ),
  )
}

/**
 * 当前分镜节点的 1-based 镜头编号。
 *
 * 编号 = 节点上的存储身份 `shotIndex`（创建时一次性分配，hydrate 时为存量回填，
 * 见 model/shotNumbering.ts），不再按 position.y + 随机 id 实时重排——旧实现下
 * 同行编号实质随机、加一个无关节点会改写所有既有编号（审计 A2）。
 * 非 shots 分类或未编号 kind（text/panorama 等）返回 null（不显徽标）。
 */
export function useShotIndex(nodeId: string, categoryId: string | undefined): number | null {
  return useGenerationCanvasStore((state) => {
    if (categoryId !== 'shots') return null
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    return typeof node?.shotIndex === 'number' ? node.shotIndex : null
  })
}

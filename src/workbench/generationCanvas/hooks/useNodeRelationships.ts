/**
 * 节点关联计数 hooks。
 *
 * Live 计算的关联度量（spec §5.3）：
 * - useNodeUsageCount: 该节点在多少分镜里被引用（文本匹配 prompt）
 * - useNodeVariantCount: 该节点的变体数（derivedFrom + regeneratedFrom 反查）
 *
 * MVP 用文本匹配；Phase G 关系图谱接入后改为精确引用计数。
 *
 * v0.7.2 perf: 之前每次 store 变化每张卡都跑 O(n) filter → n 张卡 × O(n) = O(n²)
 * 现在用 WeakMap 缓存 keyed on state.nodes reference：相同 nodes 数组只 build 一次，
 * 每张卡 O(1) Map.get 查询。zustand immer 保证未改的 nodes 引用稳定 → 缓存命中率高。
 */
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// title (trimmed) → 包含该 title 的 shots 节点 id 列表
type UsageMap = Map<string, string[]>
const usageCache = new WeakMap<readonly GenerationCanvasNode[], UsageMap>()

function buildUsageMap(nodes: readonly GenerationCanvasNode[]): UsageMap {
  const cached = usageCache.get(nodes)
  if (cached) return cached

  // v0.7.3 fix: 用 Set 去重 title — 多张同名卡片（如默认"图片"）会让同一 shot 被重复推入桶
  // 导致 count 远超真实命中数（用户报告 26 shots 显示 36 即此问题）
  const titleSet = new Set<string>()
  for (const node of nodes) {
    if (node.title && node.title.trim()) {
      titleSet.add(node.title.trim())
    }
  }
  const titles = Array.from(titleSet)

  const map: UsageMap = new Map()
  for (const t of titles) map.set(t, [])

  // 扫描每个 shots 节点的 prompt，每个 (shot, title) 组合最多记一次
  for (const shot of nodes) {
    if (shot.categoryId !== 'shots') continue
    const prompt = typeof shot.prompt === 'string' ? shot.prompt : ''
    if (!prompt) continue
    for (const t of titles) {
      if (prompt.includes(t)) {
        const bucket = map.get(t)
        if (bucket) bucket.push(shot.id)
      }
    }
  }

  usageCache.set(nodes, map)
  return map
}

/**
 * 当前节点的"使用次数"：在所有 shots 分类节点的 prompt 中，
 * 包含本节点 title 字符串的数量。
 *
 * 排除自身（避免 shots 自身 prompt 含 title 时自计）。
 */
export function useNodeUsageCount(nodeId: string, nodeTitle: string | undefined): number {
  return useGenerationCanvasStore((state) => {
    const title = nodeTitle ? nodeTitle.trim() : ''
    if (!title) return 0
    const bucket = buildUsageMap(state.nodes).get(title)
    if (!bucket) return 0
    let count = 0
    for (const id of bucket) if (id !== nodeId) count++
    return count
  })
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

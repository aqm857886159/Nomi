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
import { resultUrl } from '../runner/referenceUrl'
import { isAspectInputEdgeMode } from '../nodes/aspectRatio'
import { resolveShotIdentities, type ShotIdentity } from '../../../../electron/shared/canvas/shotNumbering'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../model/generationCanvasTypes'

// 审计 P3 根治：usageCount 从「prompt.includes(title)」子串匹配改为**结构化引用边**统计。
// 旧版用文本子串：title 是另一 title 子串（人物⊂人物特写）或重名即误计（历史 26 显示 36/26）。
// 现按引用关系：一个节点「被 N 个分镜引用」= 以它为 source、指向 shots 分类节点的去重边数
// （连边语义见 connectToNode：source=提供参考方，target=消费方/分镜）。文本无关，零假阳性。

// nodeId → 引用它的 shots 节点 id 集合
type UsageMap = Map<string, Set<string>>
const usageCache = new WeakMap<readonly GenerationCanvasEdge[], UsageMap>()

function buildUsageMap(nodes: readonly GenerationCanvasNode[], edges: readonly GenerationCanvasEdge[]): UsageMap {
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

// ── 镜头「挂了哪些设定卡」（设定卡切片2）─────────────────────────────────────
// 一个镜头节点被哪些角色/场景卡引用（指向本镜头的参考边里，source 是 character/scene 卡）。
// 给镜头面常驻徽章用——不选中也能一眼看出「挂了林夏 / 咖啡馆」，免点开数连线（可审计）。
// 缓存 keyed on edges（与 buildUsageMap 同模式）：生成进度 tick 改的是 nodes 引用、edges 稳定，
// 故徽章不随每次 tick 重建；title 在 edges 不变期间可能短暂滞后（改名才变），对徽章可接受。

export type MountedCard = { id: string; title: string; kind: 'character' | 'scene' }

const mountedCache = new WeakMap<readonly GenerationCanvasEdge[], Map<string, MountedCard[]>>()

function buildMountedCardsMap(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): Map<string, MountedCard[]> {
  const cached = mountedCache.get(edges)
  if (cached) return cached
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const map = new Map<string, MountedCard[]>()
  const seenPerTarget = new Map<string, Set<string>>()
  for (const edge of edges) {
    const src = byId.get(edge.source)
    if (!src || (src.kind !== 'character' && src.kind !== 'scene')) continue
    let seen = seenPerTarget.get(edge.target)
    if (!seen) {
      seen = new Set<string>()
      seenPerTarget.set(edge.target, seen)
    }
    if (seen.has(src.id)) continue // 同一卡多条边只算一次
    seen.add(src.id)
    let bucket = map.get(edge.target)
    if (!bucket) {
      bucket = []
      map.set(edge.target, bucket)
    }
    bucket.push({ id: src.id, title: src.title || (src.kind === 'character' ? '角色' : '场景'), kind: src.kind })
  }
  mountedCache.set(edges, map)
  return map
}

const EMPTY_MOUNTED: MountedCard[] = []

const waitingCache = new WeakMap<readonly GenerationCanvasNode[], WeakMap<readonly GenerationCanvasEdge[], Set<string>>>()

export function waitingForFrameSource(nodeId: string, nodes: readonly GenerationCanvasNode[], edges: readonly GenerationCanvasEdge[]): boolean {
  let byEdges = waitingCache.get(nodes)
  if (!byEdges) {
    byEdges = new WeakMap()
    waitingCache.set(nodes, byEdges)
  }
  let waiting = byEdges.get(edges)
  if (!waiting) {
    waiting = new Set()
    const sources = new Map(nodes.map(node => [node.id, node]))
    for (const edge of edges) {
      if (edge.mode && !isAspectInputEdgeMode(edge.mode)) continue
      const source = sources.get(edge.source)
      if (source && source.kind !== 'text' && !resultUrl(source.result)) waiting.add(edge.target)
    }
    byEdges.set(edges, waiting)
  }
  return waiting.has(nodeId)
}

/** 纯查询（可单测）：节点 nodeId 挂了哪些角色/场景设定卡（按连边顺序、去重）。 */
export function listMountedCards(
  nodeId: string,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): MountedCard[] {
  return buildMountedCardsMap(nodes, edges).get(nodeId) ?? EMPTY_MOUNTED
}

/** 当前镜头挂载的设定卡列表（给节点面徽章）。edges 不变 → 引用稳定，不引发重渲染churn。 */
export function useMountedCards(nodeId: string): MountedCard[] {
  return useGenerationCanvasStore((state) => listMountedCards(nodeId, state.nodes, state.edges))
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
export function useWaitingForFrameSource(nodeId: string, enabled: boolean): boolean {
  return useGenerationCanvasStore((state) => enabled && waitingForFrameSource(nodeId, state.nodes, state.edges))
}

const shotIdentityCache = new WeakMap<readonly GenerationCanvasNode[], WeakMap<readonly GenerationCanvasEdge[], Map<string, ShotIdentity>>>()
const EMPTY_SHOT_IDENTITY: ShotIdentity = Object.freeze({})

let latestShotIdentities = new Map<string, ShotIdentity>()

/** Full and lightweight renderers use the same owner number and first-frame relation. */
export function selectShotIdentity(state: { nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }, nodeId: string): ShotIdentity {
  let byEdges = shotIdentityCache.get(state.nodes)
  if (!byEdges) {
    byEdges = new WeakMap()
    shotIdentityCache.set(state.nodes, byEdges)
  }
  let identities = byEdges.get(state.edges)
  if (!identities) {
    identities = resolveShotIdentities(state.nodes, state.edges)
    // Movement/progress changes the node array, but must not repaint every label.
    for (const [id, identity] of identities) {
      const previous = latestShotIdentities.get(id)
      if (previous && previous.shotIndex === identity.shotIndex && previous.shotRole === identity.shotRole &&
          (previous.shotOwnerNodeIds?.length ?? 0) === (identity.shotOwnerNodeIds?.length ?? 0) &&
          (previous.shotOwnerNodeIds ?? []).every((owner, index) => owner === identity.shotOwnerNodeIds?.[index])) identities.set(id, previous)
    }
    latestShotIdentities = identities
    byEdges.set(state.edges, identities)
  }
  return identities.get(nodeId) ?? EMPTY_SHOT_IDENTITY
}

export function useShotIdentity(nodeId: string): ShotIdentity {
  return useGenerationCanvasStore((state) => selectShotIdentity(state, nodeId))
}

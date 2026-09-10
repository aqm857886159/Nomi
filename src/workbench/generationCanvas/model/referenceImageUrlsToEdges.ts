// 迁移：旧项目把数组参考（image_ref，characterIndexed）存在 `meta.referenceImageUrls`（有序数组、
// 不画线）；地基收口后改用**有序的画布边**表达（audit 2026-06-16 §1d）。本纯函数把旧 meta 数组按序
// 还原成有序 character_ref 边：对每个 URL 反查产出它的源节点（按 result URL 匹配），查到 → 建边（order
// 递增）+ 从 meta 删该 URL；**查不到源节点的 URL 一律保留在 meta**（手动上传 / 源已删 → 不丢已存参考）。
//
// 设计要点：
// - 幂等：已建过对应边的 URL 不再重复建（按 source→target 去重）；无 referenceImageUrls 的节点 no-op。
// - 单源 order：用 graphOps.connectNodes 建边（它统一赋 order = target 现有入边数），不在这另算序号，
//   保证迁移建的边与运行时建的边同一套 order 规则。
// - 反查口径与显示/生成一致：providerUrl > url > thumbnailUrl（referenceUrl.resultUrl）。
import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'
import { connectNodes } from './graphOps'

/** 一条 result 的可用 URL（与 referenceUrl.resultUrl 同优先级）。本文件不依赖 runner 层，故内联。 */
function resultUrlsOf(node: GenerationCanvasNode): string[] {
  const urls: string[] = []
  const push = (r: { providerUrl?: string; url?: string; thumbnailUrl?: string } | undefined) => {
    if (!r) return
    for (const candidate of [r.providerUrl, r.url, r.thumbnailUrl]) {
      const v = typeof candidate === 'string' ? candidate.trim() : ''
      if (v) urls.push(v)
    }
  }
  push(node.result)
  for (const entry of node.history || []) push(entry)
  return urls
}

export type ReferenceImageUrlsMigration = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  /** 反查到源、建成边的 URL 数。 */
  edgesCreated: number
  /** 查不到源、保留在 meta 的 URL 数。 */
  metaKept: number
}

/**
 * 迁移闸用的预判：是否存在「能反查到画布内源节点」的 meta.referenceImageUrls。
 * 反查口径与 migrateReferenceImageUrlsToEdges 同一套（本文件是唯一 owner）——V51→V60
 * 迁移闸缺了它会把「其余字段干净、只剩数组参考」的记录误判 alreadyMigrated，永不收敛。
 */
export function hasMigratableReferenceImageUrls(nodes: readonly GenerationCanvasNode[]): boolean {
  const sourceByUrl = new Map<string, string>()
  for (const node of nodes) {
    for (const url of resultUrlsOf(node)) {
      if (!sourceByUrl.has(url)) sourceByUrl.set(url, node.id)
    }
  }
  if (sourceByUrl.size === 0) return false
  for (const node of nodes) {
    const raw = ((node.meta || {}) as Record<string, unknown>).referenceImageUrls
    if (!Array.isArray(raw) || raw.length === 0) continue
    for (const value of raw) {
      const url = typeof value === 'string' ? value.trim() : ''
      const sourceId = url ? sourceByUrl.get(url) : undefined
      if (sourceId && sourceId !== node.id) return true
    }
  }
  return false
}

/**
 * 把所有节点 meta.referenceImageUrls 里「能反查到源节点」的 URL 还原成有序 character_ref 边。
 * 返回新的 nodes（被迁移节点的 meta.referenceImageUrls 清掉已建边的 URL）+ 新 edges。
 * 无任何可迁移 URL → 原样返回（edgesCreated=0）。
 */
export function migrateReferenceImageUrlsToEdges(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): ReferenceImageUrlsMigration {
  // URL → 第一个产出它的源节点 id（按节点数组序，确定性）。
  const sourceByUrl = new Map<string, string>()
  for (const node of nodes) {
    for (const url of resultUrlsOf(node)) {
      if (!sourceByUrl.has(url)) sourceByUrl.set(url, node.id)
    }
  }

  let nextEdges: GenerationCanvasEdge[] = [...edges]
  let edgesCreated = 0
  let metaKept = 0
  let anyNodeChanged = false

  const mappedNodes = nodes.map((node): GenerationCanvasNode => {
    const meta = (node.meta || {}) as Record<string, unknown>
    const raw = meta.referenceImageUrls
    if (!Array.isArray(raw) || raw.length === 0) return node

    const keep: string[] = []
    for (const value of raw) {
      const url = typeof value === 'string' ? value.trim() : ''
      if (!url) continue
      const sourceId = sourceByUrl.get(url)
      // 反查不到源（手动上传 / 源已删）→ 保留在 meta，绝不丢已存参考。
      // 源就是自己（理论上不该发生）→ 也保留（connectNodes 会拒自连，避免静默丢）。
      if (!sourceId || sourceId === node.id) {
        keep.push(url)
        metaKept += 1
        continue
      }
      const before = nextEdges
      nextEdges = connectNodes(nextEdges, sourceId, node.id, 'character_ref')
      // connectNodes 去重：已有 (source,target,character_ref) 边 → 引用不变（幂等），URL 已表达为边，丢 meta。
      if (nextEdges !== before) edgesCreated += 1
    }

    if (keep.length === raw.length) return node // 没有任何 URL 被迁走（含全部反查不到）
    anyNodeChanged = true
    const nextMeta: Record<string, unknown> = { ...meta }
    if (keep.length > 0) nextMeta.referenceImageUrls = keep
    else delete nextMeta.referenceImageUrls
    return { ...node, meta: nextMeta }
  })

  // 无任何节点 meta 变更 → 返回原 nodes 引用（调用方据引用相等判幂等，不误写盘）。
  // 同理 edges：无新边 → 返回原 edges 引用。
  return {
    nodes: anyNodeChanged ? mappedNodes : (nodes as GenerationCanvasNode[]),
    edges: edgesCreated > 0 ? nextEdges : (edges as GenerationCanvasEdge[]),
    edgesCreated,
    metaKept,
  }
}

/**
 * Migration v0.5.1 → v0.6.0
 *
 * 触发时机：projectPersistenceService.hydrateProject 里、projectCategoryMigration 之后。
 * 幂等：对已是 v0.6 的数据再跑一次不应改变结果。
 *
 * 变更：
 * 1. 节点 renderKind 补齐 — 按 categoryId 推断默认值（spec §5.1 决策 4）
 * 2. derivedFrom 语义分流 — 同分类源 → regeneratedFrom；不同分类源 → 保留为 derivedFrom；
 *    源不存在 → 清空（孤立副本，日志记录）（spec §5.3 + 决策 3）
 * 3. 分镜节点 shotIndex 补齐 — 按 position.y 升序排列后赋值（spec §6.4）
 *
 * 注意：本 migration **不动** categoryId（projectCategoryMigration 已处理），不动 groups / edges。
 * 旧持久化数据中不存在的字段保持 undefined，让 zod schema 在解析时 fallback。
 */
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import {
  BUILTIN_CATEGORIES,
  type NodeRenderKind,
} from './projectCategories'

const DEFAULT_RENDER_KIND_BY_CATEGORY: Record<string, NodeRenderKind> = (() => {
  const map: Record<string, NodeRenderKind> = {}
  for (const cat of BUILTIN_CATEGORIES) {
    map[cat.id] = cat.defaultNodeRenderKind
  }
  return map
})()

export type V51ToV60Diagnostic = {
  alreadyMigrated: boolean
  renderKindBackfilled: number
  derivedFromKeptCrossCategory: number
  derivedFromMovedToRegeneratedFrom: number
  derivedFromClearedOrphan: number
  shotIndicesAssigned: number
}

const EMPTY_DIAGNOSTIC: V51ToV60Diagnostic = {
  alreadyMigrated: true,
  renderKindBackfilled: 0,
  derivedFromKeptCrossCategory: 0,
  derivedFromMovedToRegeneratedFrom: 0,
  derivedFromClearedOrphan: 0,
  shotIndicesAssigned: 0,
}

function inferRenderKind(categoryId: string | undefined): NodeRenderKind | undefined {
  if (!categoryId) return undefined
  return DEFAULT_RENDER_KIND_BY_CATEGORY[categoryId]
}

export function migrateProjectV51ToV60(record: WorkbenchProjectRecordV1): {
  record: WorkbenchProjectRecordV1
  diagnostic: V51ToV60Diagnostic
} {
  const canvas = record.payload?.generationCanvas
  if (!canvas || !Array.isArray(canvas.nodes) || canvas.nodes.length === 0) {
    return { record, diagnostic: EMPTY_DIAGNOSTIC }
  }

  const nodesById = new Map<string, GenerationCanvasNode>()
  for (const node of canvas.nodes) {
    if (node && typeof node === 'object' && 'id' in node) {
      nodesById.set(node.id, node as GenerationCanvasNode)
    }
  }

  let renderKindBackfilled = 0
  let derivedFromKeptCrossCategory = 0
  let derivedFromMovedToRegeneratedFrom = 0
  let derivedFromClearedOrphan = 0
  let shotIndicesAssigned = 0

  const upgradedNodes: GenerationCanvasNode[] = canvas.nodes.map((rawNode) => {
    const node = rawNode as GenerationCanvasNode
    let next: GenerationCanvasNode = node

    // 1. renderKind 补齐
    if (!next.renderKind) {
      const inferred = inferRenderKind(next.categoryId)
      if (inferred) {
        next = { ...next, renderKind: inferred }
        renderKindBackfilled += 1
      }
    }

    // 2. derivedFrom 语义分流
    if (next.derivedFrom && !next.regeneratedFrom) {
      const source = nodesById.get(next.derivedFrom)
      if (!source) {
        // 源已不存在 → 孤立副本，清空
        const { derivedFrom: _, ...rest } = next
        next = rest as GenerationCanvasNode
        derivedFromClearedOrphan += 1
      } else if (source.categoryId === next.categoryId) {
        // 同分类 → 移到 regeneratedFrom
        const { derivedFrom: prevSource, ...rest } = next
        next = { ...rest, regeneratedFrom: prevSource } as GenerationCanvasNode
        derivedFromMovedToRegeneratedFrom += 1
      } else {
        // 跨分类 → 保留 derivedFrom 语义（独立副本）
        derivedFromKeptCrossCategory += 1
      }
    }

    return next
  })

  // 3. shotIndex 补齐（仅 shots 分类节点）
  const shotNodes = upgradedNodes
    .map((node, idx) => ({ node, idx }))
    .filter(({ node }) => node.categoryId === 'shots')
    .sort((a, b) => {
      const ay = a.node.position?.y ?? 0
      const by = b.node.position?.y ?? 0
      if (ay !== by) return ay - by
      // tie-break by id for determinism
      return a.node.id.localeCompare(b.node.id)
    })

  shotNodes.forEach(({ node, idx }, sortedIndex) => {
    const newShotIndex = sortedIndex + 1
    if (node.shotIndex !== newShotIndex) {
      upgradedNodes[idx] = { ...node, shotIndex: newShotIndex }
      shotIndicesAssigned += 1
    }
  })

  const anyChange =
    renderKindBackfilled +
      derivedFromKeptCrossCategory +
      derivedFromMovedToRegeneratedFrom +
      derivedFromClearedOrphan +
      shotIndicesAssigned >
    0

  if (!anyChange) {
    return { record, diagnostic: EMPTY_DIAGNOSTIC }
  }

  const upgradedRecord: WorkbenchProjectRecordV1 = {
    ...record,
    payload: {
      ...record.payload,
      generationCanvas: {
        ...canvas,
        nodes: upgradedNodes,
      },
    },
  }

  return {
    record: upgradedRecord,
    diagnostic: {
      alreadyMigrated: false,
      renderKindBackfilled,
      derivedFromKeptCrossCategory,
      derivedFromMovedToRegeneratedFrom,
      derivedFromClearedOrphan,
      shotIndicesAssigned,
    },
  }
}

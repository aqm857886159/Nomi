import {
  CATEGORY_IDS,
  getDefaultCategoryForNodeKind,
  type CategoryId,
  type GenerationCanvasEdge,
  type GenerationCanvasNode,
  type GenerationCanvasSnapshot,
  type NodeGroup,
} from '../generationCanvas/model/generationCanvasTypes'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'
import { cloneBuiltinCategories } from './projectCategories'

/**
 * Phase E.2: normalize legacy project category ids into the v0.6 five-category
 * model. v0.5 categories `shots` and `audio` are retained, `characters` maps to
 * `cast`, `scenes` maps to `scene`, and removed buckets (`story`, `style`,
 * `inbox`, `exports`) are deleted instead of archived.
 */


const LEGACY_CATEGORY_MAP: Record<string, CategoryId | null> = {
  shots: 'shots',
  characters: 'cast',
  scenes: 'scene',
  audio: 'audio',
  story: null,
  style: null,
  inbox: null,
  exports: null,
}

export type CategoryMigrationDiagnostic = {
  projectId?: string
  totalNodes: number
  migratedNodes: number
  removedNodes: number
  removedCategoryIds: string[]
  categoriesSeeded: boolean
  alreadyMigrated: boolean
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value)
}

function readCategoryId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const categoryId = (value as { categoryId?: unknown }).categoryId
  return typeof categoryId === 'string' ? categoryId : undefined
}

function mapLegacyCategoryId(categoryId: string): CategoryId | null {
  if (Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_MAP, categoryId)) {
    return LEGACY_CATEGORY_MAP[categoryId]
  }
  // 自定义顶层分类 id（非内置、非 legacy 别名）原样保留——否则迁移会把用户新建的
  // 分类连同其下节点/子组一并丢弃。只有空 id 才判为非法。
  const trimmed = typeof categoryId === 'string' ? categoryId.trim() : ''
  return trimmed ? trimmed : null
}

export function migrateNodeToCategoryId(
  node: GenerationCanvasNode,
  _edges: readonly GenerationCanvasEdge[],
): CategoryId | null {
  const existingCategoryId = readCategoryId(node)
  if (existingCategoryId) return mapLegacyCategoryId(existingCategoryId)

  // 无 categoryId → 按 kind 推断，走与创建路径同一份映射（唯一真相源），且永不返回
  // null：迁移侧此前自持一份映射并把 text 等 kind 判 null 删除，导致「新建空白项目
  // 过迁移被静默删默认节点」（审计 A4）。删除只保留给 legacy 废弃分类（上面的分支）。
  return getDefaultCategoryForNodeKind(node.kind)
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function normalizeGroups(input: unknown, existingNodeIds: ReadonlySet<string>): { groups: NodeGroup[]; changed: boolean } {
  if (!Array.isArray(input)) return { groups: [], changed: true }
  const groups: NodeGroup[] = []
  let changed = false
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      changed = true
      continue
    }
    const originalCategoryId = readCategoryId(item)
    const categoryId = mapLegacyCategoryId(originalCategoryId || '')
    if (!categoryId) {
      changed = true
      continue
    }
    const originalNodeIds = Array.isArray((item as { nodeIds?: unknown }).nodeIds)
      ? (item as { nodeIds: unknown[] }).nodeIds
      : []
    const nodeIds = originalNodeIds.filter((nodeId): nodeId is string => (
      typeof nodeId === 'string' && existingNodeIds.has(nodeId)
    ))
    const nodeIdsChanged = nodeIds.length !== originalNodeIds.length || nodeIds.some((nodeId, index) => nodeId !== originalNodeIds[index])
    if (originalCategoryId !== categoryId || nodeIdsChanged) changed = true
    groups.push(originalCategoryId === categoryId && !nodeIdsChanged
      ? item as NodeGroup
      : {
          ...(item as NodeGroup),
          categoryId,
          nodeIds,
        })
  }
  return { groups, changed }
}

export function migrateGenerationCanvasSnapshot(
  snapshot: GenerationCanvasSnapshot,
): {
  snapshot: GenerationCanvasSnapshot
  migratedCount: number
  removedCount: number
  removedCategoryIds: string[]
} {
  let migratedCount = 0
  const removedCategoryIds: string[] = []
  const nextNodes: GenerationCanvasNode[] = []

  for (const node of snapshot.nodes) {
    const categoryId = migrateNodeToCategoryId(node, snapshot.edges)
    if (!categoryId) {
      removedCategoryIds.push(readCategoryId(node) || '(uncategorized)')
      continue
    }
    if (readCategoryId(node) !== categoryId) migratedCount += 1
    nextNodes.push({
      ...node,
      categoryId,
    })
  }

  const nextNodeIds = new Set(nextNodes.map((node) => node.id))
  const nextEdges = snapshot.edges.filter((edge) => nextNodeIds.has(edge.source) && nextNodeIds.has(edge.target))
  const nextSelectedNodeIds = (snapshot.selectedNodeIds ?? []).filter((nodeId) => nextNodeIds.has(nodeId))
  const groupsNormalization = normalizeGroups((snapshot as { groups?: unknown }).groups, nextNodeIds)
  const nextGroups = groupsNormalization.groups
  const removedCount = snapshot.nodes.length - nextNodes.length

  if (!migratedCount && !removedCount && nextEdges.length === snapshot.edges.length &&
    nextSelectedNodeIds.length === (snapshot.selectedNodeIds ?? []).length && !groupsNormalization.changed) {
    return { snapshot, migratedCount: 0, removedCount: 0, removedCategoryIds: [] }
  }

  return {
    snapshot: {
      ...snapshot,
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: nextSelectedNodeIds,
      groups: nextGroups,
    },
    migratedCount,
    removedCount,
    removedCategoryIds: unique(removedCategoryIds),
  }
}

function normalizePayloadCategories(payload: WorkbenchProjectPayload): { categories: WorkbenchProjectPayload['categories']; seeded: boolean } {
  if (!Array.isArray(payload.categories) || payload.categories.length === 0) {
    return { categories: cloneBuiltinCategories(), seeded: true }
  }
  const byId = new Map(cloneBuiltinCategories().map((category) => [category.id, category]))
  for (const category of payload.categories) {
    const categoryId = mapLegacyCategoryId(category.id)
    if (!categoryId) continue
    const builtin = byId.get(categoryId)
    byId.set(categoryId, { ...builtin, ...category, id: categoryId, order: builtin?.order ?? category.order })
  }
  return { categories: Array.from(byId.values()).sort((a, b) => a.order - b.order), seeded: false }
}

export function migrateProjectPayload(payload: WorkbenchProjectPayload): {
  payload: WorkbenchProjectPayload
  diagnostic: CategoryMigrationDiagnostic
} {
  const categoryNormalization = normalizePayloadCategories(payload)
  const nodeMigration = migrateGenerationCanvasSnapshot(payload.generationCanvas)
  const totalNodes = payload.generationCanvas.nodes.length
  const categoryIds = payload.categories?.map((category) => category.id) || []
  const nextCategoryIds = categoryNormalization.categories?.map((category) => category.id) || []
  const categoriesChanged = categoryIds.length !== nextCategoryIds.length || categoryIds.some((id, index) => id !== nextCategoryIds[index])
  const alreadyMigrated = !categoriesChanged && nodeMigration.snapshot === payload.generationCanvas &&
    nodeMigration.migratedCount === 0 && nodeMigration.removedCount === 0
  if (alreadyMigrated) {
    return {
      payload,
      diagnostic: {
        totalNodes,
        migratedNodes: 0,
        removedNodes: 0,
        removedCategoryIds: [],
        categoriesSeeded: false,
        alreadyMigrated: true,
      },
    }
  }
  return {
    payload: {
      ...payload,
      categories: categoryNormalization.categories,
      generationCanvas: nodeMigration.snapshot,
    },
    diagnostic: {
      totalNodes,
      migratedNodes: nodeMigration.migratedCount,
      removedNodes: nodeMigration.removedCount,
      removedCategoryIds: nodeMigration.removedCategoryIds,
      categoriesSeeded: categoryNormalization.seeded,
      alreadyMigrated: false,
    },
  }
}

export function migrateProjectRecord(record: WorkbenchProjectRecordV1): {
  record: WorkbenchProjectRecordV1
  diagnostic: CategoryMigrationDiagnostic
} {
  const { payload, diagnostic } = migrateProjectPayload(record.payload)
  if (diagnostic.alreadyMigrated) return { record, diagnostic }
  return {
    record: { ...record, payload },
    diagnostic: { ...diagnostic, projectId: record.id },
  }
}

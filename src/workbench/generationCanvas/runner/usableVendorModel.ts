import {
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
} from '../../api/modelCatalogApi'
import { modeTransportFor, type ModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { modelSuccessorDepth } from '../../../../electron/shared/vendorLineage'

function normalizeIdentifier(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.startsWith('models/') ? trimmed.slice(7) : trimmed
}

function modelMatchesModelKey(model: ModelCatalogModelDto, identifier: string): boolean {
  const target = normalizeIdentifier(identifier)
  if (!target) return false
  return [model.modelKey, model.modelAlias]
    .map((value) => normalizeIdentifier(value))
    .filter(Boolean)
    .includes(target)
}

export type UsableModelQuery = {
  /** 节点当前钉的 modelKey（可能是已断开供应商的命名，如 kie 的 `seedream`）。 */
  modelKey: string
  modelAlias?: string
  /** 节点当前钉的供应商（用于解析源 archetype；可空）。 */
  vendor?: string
  /** 节点 meta（resolveArchetypeForModel 会读 meta.archetypeId，并据此特化）。 */
  meta?: unknown
  /** 当前 kind 下、enabled 的全部 catalog 模型。 */
  models: ModelCatalogModelDto[]
  /** Vendor lineage metadata returned by the catalog DTO. */
  vendors?: ModelCatalogVendorDto[]
}

/**
 * Resolve an executable persisted model without crossing provider ownership.
 * Pinned nodes may use their exact vendor row or an explicit per-model lineage
 * successor. Truly legacy unpinned nodes retain only an unambiguous exact-key
 * fallback; archetype/family similarity is not authorization to reroute spend.
 */
export function resolveUsableModelForNode(query: UsableModelQuery): ModelCatalogModelDto | null {
  // 「能不能用」只认主进程给的那一个答案（供应商启用 + 模型启用 + 发布资格 + 钥匙解得开）。
  // 这里曾经自己拼一份（enabled && published && 可用供应商集合），那是全仓第四份同语义判据——
  // 2026-09-12 真实验收 P0-10 就是这些副本漂开的结果。
  const candidates = query.models.filter((model) => model.availability.usable)
  if (!candidates.length) return null

  const exactKey = candidates.filter((model) => modelMatchesModelKey(model, query.modelKey) || (query.modelAlias ? modelMatchesModelKey(model, query.modelAlias) : false))
  const sourceVendorKey = String(query.vendor || '').trim()
  if (!sourceVendorKey) return exactKey.length === 1 ? exactKey[0] : null

  const sameVendor = exactKey.find((model) => String(model.vendorKey || '').trim() === sourceVendorKey)
  if (sameVendor) return sameVendor

  const vendors = query.vendors || []
  const successors = exactKey.flatMap((model) => {
    const identifiers = [query.modelKey, query.modelAlias, model.modelKey, model.modelAlias]
      .map(normalizeIdentifier)
      .filter(Boolean)
    const depth = modelSuccessorDepth(vendors, model.vendorKey, sourceVendorKey, [...new Set(identifiers)])
    return depth != null && depth > 0 ? [{ model, depth }] : []
  })
  successors.sort((left, right) => right.depth - left.depth || right.model.updatedAt.localeCompare(left.model.updatedAt))
  return successors[0]?.model || null
}

import {
  type ModelCatalogModelDto,
  type ModelCatalogVendorDto,
  listWorkbenchModelCatalogVendors,
} from '../../api/modelCatalogApi'
import { modeTransportFor, type ModelArchetype } from '../../../config/modelArchetypes'
import { modelSuccessorDepth } from '../../../../electron/shared/vendorLineage'

/**
 * 「可用供应商」= 内置启用 **且** 现在真能用（有 API key，或免鉴权）。
 *
 * 根因修复（2026-06-08）：旧代码把「内置启用（enabled）」当成「能用」，于是用户断开某供应商
 * （只拔了 key，vendor.enabled 仍为 true）后，钉死该供应商的老节点运行时仍去要它的 key →
 * `API key missing: <vendor>`。可用性必须由 hasApiKey 派生，不看 enabled 单独一项。
 */
export function vendorIsUsable(vendor: ModelCatalogVendorDto | null | undefined): boolean {
  if (!vendor || !vendor.enabled) return false
  if (vendor.authType === 'none') return true
  return Boolean(vendor.hasApiKey)
}

export async function loadUsableVendorKeys(
  listVendors: () => Promise<ModelCatalogVendorDto[]> = listWorkbenchModelCatalogVendors,
): Promise<Set<string>> {
  const vendors = await listVendors()
  return usableVendorKeys(vendors)
}

export function usableVendorKeys(vendors: readonly ModelCatalogVendorDto[]): Set<string> {
  return new Set(
    (Array.isArray(vendors) ? vendors : [])
      .filter(vendorIsUsable)
      .map((vendor) => String(vendor.key || '').trim())
      .filter(Boolean),
  )
}

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
  /** 可用供应商 key 集合（loadUsableVendorKeys 的结果）。 */
  usable: Set<string>
}

/**
 * Resolve an executable persisted model without crossing provider ownership.
 * Pinned nodes may use their exact vendor row or an explicit per-model lineage
 * successor. Truly legacy unpinned nodes retain only an unambiguous exact-key
 * fallback; archetype/family similarity is not authorization to reroute spend.
 */
export function resolveUsableModelForNode(query: UsableModelQuery): ModelCatalogModelDto | null {
  const candidates = query.models.filter((model) =>
    model.enabled && model.published && query.usable.has(String(model.vendorKey || '').trim()),
  )
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

/**
 * 跨档案迁移时（family 兜底命中，源/目标 archetypeId 不同）重映射 node.meta.archetype：
 * 按 transportTaskKind 在目标档案里找意图等价的模式（保住 t2v/i2v / 文生·改图），落不到用目标 defaultModeId。
 * 同档案（id 相同）返回 null —— 调用方保持节点原 archetype meta 不动。
 *
 * 源/目标各自的 vendorKey **必须分别传**：传输桶是供应商特化的（modeTransportFor），迁移正是「换供应商」
 * 这件事本身。拿源供应商的桶去查目标档案会把 kie 的 text_to_video 拿去 Runway 侧比对，配错模式。
 */
export function remapArchetypeMode(
  sourceArchetype: ModelArchetype | null,
  sourceModeId: string | undefined,
  targetArchetype: ModelArchetype,
  sourceVendorKey: string | null | undefined,
  targetVendorKey: string | null | undefined,
): { id: string; modeId: string } | null {
  if (sourceArchetype && sourceArchetype.id === targetArchetype.id) return null

  const sourceMode = sourceArchetype?.modes.find((mode) => mode.id === sourceModeId)
  const sourceTransport = sourceMode ? modeTransportFor(sourceMode, sourceArchetype, sourceVendorKey) : undefined

  const matched = sourceTransport
    ? targetArchetype.modes.find((mode) => modeTransportFor(mode, targetArchetype, targetVendorKey) === sourceTransport)
    : undefined
  const target = matched
    || targetArchetype.modes.find((mode) => mode.id === targetArchetype.defaultModeId)
    || targetArchetype.modes[0]
  return target ? { id: targetArchetype.id, modeId: target.id } : null
}

import type { DesktopExistingConnectionSummary } from '../../desktop/onboardingBridgeTypes'
import { ANTIGRAVITY_VENDOR_KEY } from '../../../electron/shared/antigravity'
import { isComfyuiVendorKey } from '../../workbench/generationCanvas/model/comfyuiVendor'
import type { ChipModel } from './ModelChipGroups'
import { CODEX_LOCAL_VENDOR_KEY } from './codexLocalProvider'
import { KIND_CAPS } from './onboardingDrawerConstants'
import type { OnboardingVendorMeta } from './useOnboardingDrawerCatalog'

export type OtherVendorGroup = {
  vendorKey: string
  name: string
  models: ChipModel[]
}

export function groupOtherVendorModels(
  models: readonly ChipModel[],
  vendorMeta: ReadonlyMap<string, OnboardingVendorMeta>,
  includeEmptyVendorKeys: readonly string[] = [],
): OtherVendorGroup[] {
  const groups: OtherVendorGroup[] = []
  const indexByVendor = new Map<string, number>()
  for (const model of models) {
    let index = indexByVendor.get(model.vendorKey)
    if (index === undefined) {
      index = groups.length
      indexByVendor.set(model.vendorKey, index)
      groups.push({
        vendorKey: model.vendorKey,
        name: vendorMeta.get(model.vendorKey)?.name || model.vendorKey,
        models: [],
      })
    }
    groups[index].models.push(model)
  }
  for (const vendorKey of includeEmptyVendorKeys) {
    if (indexByVendor.has(vendorKey)) continue
    indexByVendor.set(vendorKey, groups.length)
    groups.push({
      vendorKey,
      name: vendorMeta.get(vendorKey)?.name || vendorKey,
      models: [],
    })
  }
  return groups
}

export function resolveKindGuessGap(
  models: readonly ChipModel[],
  vendorMeta: ReadonlyMap<string, OnboardingVendorMeta>,
): { dominantKind: string; count: number; missing: Array<(typeof KIND_CAPS)[number]['labelKey']> } | null {
  const coveredKindCounts = new Map<string, number>()
  for (const model of models) {
    if (!model.enabled) continue
    const meta = vendorMeta.get(model.vendorKey)
    if (!meta?.hasApiKey && !(meta?.authType === 'none' && meta.enabled)) continue
    const kind = String(model.kind)
    coveredKindCounts.set(kind, (coveredKindCounts.get(kind) ?? 0) + 1)
  }

  const retypeable = models.filter((model) => model.canRetype && model.enabled)
  if (retypeable.length < 3) return null
  const byKind = new Map<string, number>()
  for (const model of retypeable) {
    const kind = String(model.kind)
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  }
  const [dominantKind, dominantCount] = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0]
  if (dominantCount / retypeable.length < 0.8) return null
  const missing = KIND_CAPS
    .filter(({ kind }) => kind !== dominantKind && (coveredKindCounts.get(kind) ?? 0) === 0)
    .map(({ labelKey }) => labelKey)
  return missing.length > 0 ? { dominantKind, count: retypeable.length, missing } : null
}

export function buildExistingConnectionSummary(
  vendorKey: string | undefined,
  vendorName: string,
  models: readonly ChipModel[],
  vendorMeta: ReadonlyMap<string, OnboardingVendorMeta>,
): DesktopExistingConnectionSummary | undefined {
  if (!vendorKey) return undefined
  return {
    vendorKey,
    vendorName,
    baseUrl: vendorMeta.get(vendorKey)?.baseUrl ?? '',
    existingModels: models
      .filter((model) => (
        model.vendorKey === vendorKey
        && model.enabled
        && model.published === true
        && model.adapterState === 'verified'
      ))
      .map((model) => ({ modelKey: model.modelKey, labelZh: model.labelZh, kind: model.kind })),
  }
}

export function canAddModelsToConnection(
  vendorKey: string,
  vendorMeta: ReadonlyMap<string, OnboardingVendorMeta>,
): boolean {
  const meta = vendorMeta.get(vendorKey)
  return Boolean(
    (meta?.hasApiKey || meta?.authType === 'none') &&
    !isComfyuiVendorKey(vendorKey) &&
    vendorKey !== CODEX_LOCAL_VENDOR_KEY &&
    vendorKey !== ANTIGRAVITY_VENDOR_KEY,
  )
}

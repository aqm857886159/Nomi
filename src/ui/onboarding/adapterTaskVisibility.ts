import type { DesktopProviderAdapterRun } from '../../desktop/bridge'
import { isAdapterRunTerminal } from './adapterVerificationViewModel'

import type { ChipModel } from './ModelChipGroups'

export function mergeAdapterRuns<T extends DesktopProviderAdapterRun>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((run) => [run.id, run]))
  for (const run of incoming) byId.set(run.id, run)
  return [...byId.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export function adapterRunsRequiringCatalogRefresh<T extends DesktopProviderAdapterRun>(
  previous: T[],
  current: T[],
): T[] {
  const previousById = new Map(previous.map((run) => [run.id, run]))
  return current.filter((run) => {
    const before = previousById.get(run.id)
    return Boolean(before) && isAdapterRunTerminal(run.stage) && !isAdapterRunTerminal(before!.stage)
  })
}

export function adapterFailureIsObsolete(
  failure: { vendorKey: string; sourceVendorKey?: string; selectedModelKeys: readonly string[]; updatedAt: string },
  models: readonly ChipModel[],
  runs: readonly DesktopProviderAdapterRun[] = [],
): boolean {
  const source = failure.sourceVendorKey || failure.vendorKey
  const sameConnection = runs.filter((run) => (run.sourceVendorKey || run.vendorKey) === source)
  const vendorKeys = new Set([source, failure.vendorKey, ...sameConnection.map((run) => run.vendorKey)])
  return failure.selectedModelKeys.length > 0 && failure.selectedModelKeys.every((key) => {
    return models.some((model) => vendorKeys.has(model.vendorKey) && model.modelKey === key && model.availability?.usable === true)
      || sameConnection.some((run) => run.stage === 'completed'
        && run.selectedModelKeys.includes(key) && Date.parse(run.updatedAt) > Date.parse(failure.updatedAt))
  })
}

export function visibleAdapterRuns<T extends DesktopProviderAdapterRun>(runs: T[], models: readonly ChipModel[] = []): T[] {
  return runs.flatMap((run): T[] => {
    if (!isAdapterRunTerminal(run.stage)) return [run]
    if (run.stage === 'completed') return []
    if (!run.selectedModelKeys.length) return [run]
    const unresolved = run.selectedModelKeys.filter((key) => !adapterFailureIsObsolete({ ...run, selectedModelKeys: [key] }, models, runs))
    if (!unresolved.length) return []
    if (unresolved.length === run.selectedModelKeys.length) return [run]
    return [{ ...run, selectedModelKeys: unresolved, models: run.models.filter((model) => unresolved.includes(model.modelKey)) }]
  }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

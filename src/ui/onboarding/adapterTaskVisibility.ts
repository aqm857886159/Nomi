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

type FailureRef = { vendorKey: string; sourceVendorKey?: string; selectedModelKeys: readonly string[]; updatedAt: string }

/**
 * 这个模型在这一次任务里验证通过了吗：整批完成，或它自己的每个模式都是 verified（半批成功的那一档）。
 * 只看任务自己的记录——之后创作者手动停用它，不会把这次的成功改写成失败。
 */
function modelVerifiedIn(run: DesktopProviderAdapterRun, modelKey: string): boolean {
  if (!run.selectedModelKeys.includes(modelKey)) return false
  if (run.stage === 'completed') return true
  const modes = run.models.find((model) => model.modelKey === modelKey)?.modes ?? []
  return modes.length > 0 && modes.every((mode) => mode.state === 'verified')
}

const usableKey = (vendorKey: string, modelKey: string) => `${vendorKey}\u0000${modelKey}`

/** 当前可用的模型一次建好索引，同一屏的每条失败都查它，不再逐条扫全部模型。 */
function usableModelIndex(models: readonly ChipModel[]): ReadonlySet<string> {
  const index = new Set<string>()
  for (const model of models) if (model.availability?.usable === true) index.add(usableKey(model.vendorKey, model.modelKey))
  return index
}

function failureIsObsolete(failure: FailureRef, usable: ReadonlySet<string>, runs: readonly DesktopProviderAdapterRun[]): boolean {
  const source = failure.sourceVendorKey || failure.vendorKey
  const sameConnection = runs.filter((run) => (run.sourceVendorKey || run.vendorKey) === source)
  const vendorKeys = [...new Set([source, failure.vendorKey, ...sameConnection.map((run) => run.vendorKey)])]
  const failedAt = Date.parse(failure.updatedAt)
  return failure.selectedModelKeys.length > 0 && failure.selectedModelKeys.every((key) => {
    return vendorKeys.some((vendorKey) => usable.has(usableKey(vendorKey, key)))
      || sameConnection.some((run) => Date.parse(run.updatedAt) > failedAt && modelVerifiedIn(run, key))
  })
}

export function adapterFailureIsObsolete(
  failure: FailureRef,
  models: readonly ChipModel[],
  runs: readonly DesktopProviderAdapterRun[] = [],
): boolean {
  return failureIsObsolete(failure, usableModelIndex(models), runs)
}

export function visibleAdapterRuns<T extends DesktopProviderAdapterRun>(runs: T[], models: readonly ChipModel[] = []): T[] {
  const usable = usableModelIndex(models)
  return runs.flatMap((run): T[] => {
    if (!isAdapterRunTerminal(run.stage)) return [run]
    if (run.stage === 'completed') return []
    if (!run.selectedModelKeys.length) return [run]
    const unresolved = run.selectedModelKeys.filter((key) => !modelVerifiedIn(run, key)
      && !failureIsObsolete({ ...run, selectedModelKeys: [key] }, usable, runs))
    if (!unresolved.length) return []
    if (unresolved.length === run.selectedModelKeys.length) return [run]
    return [{ ...run, selectedModelKeys: unresolved, models: run.models.filter((model) => unresolved.includes(model.modelKey)) }]
  }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

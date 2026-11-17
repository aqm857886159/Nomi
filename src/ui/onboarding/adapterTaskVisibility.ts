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
 * 这个模型在这一次任务里格式跑通了吗：整批完成，或它自己的每个模式都是 verified（半批成功的那一档）。
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

/**
 * 设置首页的任务条只说**正在跑**的格式任务（D-1117-delete-verification）。
 *
 * 这里曾经把结束了却「没解决」的失败任务也挂着，当成要处理的事——可模型缺不缺请求格式，
 * 它自己那一行已经写着「待设置」；任务条再挂一张失败卡，就是同一件事两处说、两处的口径还要互相对账。
 * 结束了的任务仍能从模型详情的「查看任务」打开，不丢。
 */
export function visibleAdapterRuns<T extends DesktopProviderAdapterRun>(runs: T[]): T[] {
  return runs
    .filter((run) => !isAdapterRunTerminal(run.stage))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

import type { DesktopProviderAdapterRun } from '../../desktop/bridge'
import { isAdapterRunTerminal } from './adapterVerificationViewModel'

const RECENT_TASK_WINDOW_MS = 24 * 60 * 60 * 1000

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

export function visibleAdapterRuns<T extends DesktopProviderAdapterRun>(
  runs: T[],
  now = Date.now(),
  limit = 3,
): T[] {
  const newestFirst = [...runs].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
  const active = newestFirst.filter((run) => !isAdapterRunTerminal(run.stage))
  const recentTerminal = newestFirst
    .filter((run) => isAdapterRunTerminal(run.stage) && now - Date.parse(run.updatedAt) <= RECENT_TASK_WINDOW_MS)
    .slice(0, limit)
  return [...active, ...recentTerminal].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}

import type { ProductionRunStatus, ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import type { ProductionRunTaskCenterProjection } from './taskCenterProjection'

type Labels = {
  title: string
  statuses: Record<ProductionRunStatus, string>
}

const TERMINAL = new Set<ProductionRunStatus>(['completed', 'cancelled'])
const WAITING_FOR_USER = new Set<ProductionRunStatus>([
  'awaiting_direction',
  'awaiting_storyboard_review',
  'awaiting_contract',
  'paused',
  'needs_attention',
  'awaiting_rough_cut_review',
  'awaiting_export',
])

export function buildProductionRunTaskRows(
  runs: readonly ProductionRunSummary[],
  labels: Labels,
): ProductionRunTaskCenterProjection[] {
  return runs.map((run) => {
    const terminal = TERMINAL.has(run.status)
    return {
      id: `production-run:${run.runId}`,
      kind: 'production_run',
      projectId: run.projectId,
      runId: run.runId,
      title: `${labels.title} · ${run.playbook.name}`,
      group: terminal ? 'done' : WAITING_FOR_USER.has(run.status) ? 'queued' : 'running',
      ...(run.status === 'completed'
        ? { outcome: 'success' as const }
        : run.status === 'cancelled'
          ? { outcome: 'cancelled' as const }
          : {}),
      recoverable: false,
      phaseText: labels.statuses[run.status],
      cancel: 'none',
      target: { kind: 'production_run', projectId: run.projectId, runId: run.runId },
      action: null,
    }
  })
}

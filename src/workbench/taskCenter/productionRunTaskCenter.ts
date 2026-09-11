import type { ProductionRunStatus, ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import type { ProductionRunTaskCenterProjection } from './taskCenterProjection'

type Labels = {
  title: string
  statuses: Record<ProductionRunStatus, string>
  /** 草稿行的镜数后缀（走 i18n 插值），只在多镜草稿上追加。 */
  draftShots?: (count: number) => string
}

const TERMINAL = new Set<ProductionRunStatus>(['completed', 'cancelled'])

/** Keep the list projection and the opened full Run on the newest shared revision. */
export function mergeProductionRunSummaries(
  runs: readonly ProductionRunSummary[],
  detailed: ProductionRunSummary | null,
): ProductionRunSummary[] {
  if (!detailed) return [...runs]
  let found = false
  const merged = runs.map((run) => {
    if (run.projectId !== detailed.projectId || run.runId !== detailed.runId) return run
    found = true
    return detailed.revision >= run.revision ? detailed : run
  })
  return found ? merged : [detailed, ...merged]
}

/**
 * 草稿行说人话：「模型 · 比例 · 提示词摘要」。
 *
 * 为什么这一行值得单独存在：一份 agent 刚建的草稿此前只显示「等待开始」，用户既看不出 agent 选了
 * 哪个模型，也看不出它要画什么——而这正是「agent 说的和画布上的对不上」时唯一能当场对账的地方。
 * 摘要缺席（老快照 / 已封存的计划）就回落到状态文案，不编内容。
 */
function draftPhaseText(run: ProductionRunSummary, labels: Labels): string | undefined {
  if (run.status !== 'draft' || !run.draft) return undefined
  const parts = [run.draft.modelKey, run.draft.aspectRatio, run.draft.promptLine]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
  if (run.draft.shotCount > 1 && labels.draftShots) parts.push(labels.draftShots(run.draft.shotCount))
  return parts.length > 0 ? parts.join(' · ') : undefined
}

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
      group: terminal ? 'done' : 'running',
      ...(run.status === 'completed'
        ? { outcome: 'success' as const }
        : run.status === 'cancelled'
          ? { outcome: 'cancelled' as const }
          : {}),
      recoverable: false,
      phaseText: draftPhaseText(run, labels) ?? labels.statuses[run.status],
      cancel: 'none',
      target: { kind: 'production_run', projectId: run.projectId, runId: run.runId },
      action: null,
    }
  })
}

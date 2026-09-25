import type { ProductionRunStatus, ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import type { TranslationKey } from '../../i18n/translationKey'
import { productionPlaybookLabelKey } from '../production/productionRunLabels'
import { isProductionRunTask, productionRunStatusGroup } from '../production/productionRunView'
import type { ProductionRunTaskCenterProjection, TaskCenterGroup } from './taskCenterProjection'

type Translate = (key: TranslationKey, options?: Record<string, unknown>) => string

type Labels = {
  title: string
  statuses: Record<ProductionRunStatus, string>
  /** 流程身份（`playbook.name`）→ 人话名。身份串本身永远不上屏。 */
  playbook: (playbookName: string) => string
  /** 草稿行的镜数后缀（走 i18n 插值），只在多镜草稿上追加。 */
  draftShots?: (count: number) => string
}

/** 任务按钮（徽标）和任务面板共用的一份文案表——此前两边各手抄一份 15 个状态。 */
export function productionRunTaskLabels(t: Translate): Labels {
  return {
    title: t('taskCenter.productionRun.title'),
    statuses: {
      draft: t('taskCenter.productionRun.statuses.draft'),
      awaiting_direction: t('taskCenter.productionRun.statuses.awaitingDirection'),
      awaiting_script_review: t('taskCenter.productionRun.statuses.awaitingScriptReview'),
      awaiting_storyboard_review: t('taskCenter.productionRun.statuses.awaitingStoryboardReview'),
      awaiting_contract: t('taskCenter.productionRun.statuses.awaitingContract'),
      ready: t('taskCenter.productionRun.statuses.ready'),
      running: t('taskCenter.productionRun.statuses.running'),
      pausing: t('taskCenter.productionRun.statuses.pausing'),
      paused: t('taskCenter.productionRun.statuses.paused'),
      needs_attention: t('taskCenter.productionRun.statuses.needsAttention'),
      awaiting_rough_cut_review: t('taskCenter.productionRun.statuses.awaitingRoughCutReview'),
      awaiting_export: t('taskCenter.productionRun.statuses.awaitingExport'),
      exporting: t('taskCenter.productionRun.statuses.exporting'),
      completed: t('taskCenter.productionRun.statuses.completed'),
      cancelled: t('taskCenter.productionRun.statuses.cancelled'),
    },
    playbook: (playbookName) => t(productionPlaybookLabelKey(playbookName)),
    draftShots: (count) => t('taskCenter.productionRun.draftShots', { count }),
  }
}

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

/**
 * @param opened 任务面板里正打开成整卡的那份 Run：它的分组取自完整 Run 的判断（门在等、供应商慢…），
 *   这样卡落在哪一组、卡上的状态签写什么，是同一个判断的两面。
 */
export function buildProductionRunTaskRows(
  runs: readonly ProductionRunSummary[],
  labels: Labels,
  opened?: { runId: string; group: TaskCenterGroup },
): ProductionRunTaskCenterProjection[] {
  return runs.filter(isProductionRunTask).map((run) => {
    const name = run.authoring?.title?.trim() || labels.playbook(run.playbook.name)
    return {
      id: `production-run:${run.runId}`,
      kind: 'production_run',
      projectId: run.projectId,
      runId: run.runId,
      title: `${labels.title} · ${name}`,
      group: opened?.runId === run.runId ? opened.group : productionRunStatusGroup(run.status),
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

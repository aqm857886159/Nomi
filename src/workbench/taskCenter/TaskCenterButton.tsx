// 顶栏「任务」入口。住 NomiAppBar 右栏 —— 那是唯一跨创作/生成/预览三区常驻的 chrome，
// 正是「切到创作页就看不见生成跑到哪了」的解药。
// 方案：docs/plan/2026-08-02-task-center-queue.md，样张 2026-08-02 拍板。
//
// 按钮同时表达“任务列表入口”和当前状态：名称常显，有活时 accent + 数字徽标，失败时转提醒色。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconListDetails } from '@tabler/icons-react'
import type { ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { cn } from '../../utils/cn'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { useProductionRunStore } from '../production/productionRunStore'
import { useWorkbenchStore } from '../workbenchStore'
import { TaskCenterPanel } from './TaskCenterPanel'
import { buildTaskCenterView, resolveTaskButtonTone } from './taskCenterEntries'
import { buildProductionRunTaskRows } from './productionRunTaskCenter'
import { useBatchFinishNotifier } from './useBatchFinishNotifier'
import { buildVideoAnalysisTaskRows } from './videoAnalysisTaskCenter'
import {
  refreshVideoAnalysisTasks as refreshVideoAnalysisProjection,
  selectVideoAnalysisTasks,
  useVideoAnalysisProjectionStore,
} from '../videoAnalysis/videoAnalysisProjectionStore'

type Props = {
  projectId?: string | null
  /** 点任务行时把用户带到画布上那个节点。 */
  onRevealNode?: (nodeId: string) => void
}

export function TaskCenterButton({ projectId, onRevealNode }: Props): JSX.Element {
  const { t } = useTranslation()
  const [opened, setOpened] = React.useState(false)
  const entries = useGenerationQueueStore((state) => state.entries)
  const batches = useGenerationQueueStore((state) => state.batches)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const videoAnalysisTasks = useVideoAnalysisProjectionStore((state) => selectVideoAnalysisTasks(state, projectId))
  const [productionRuns, setProductionRuns] = React.useState<ProductionRunSummary[]>([])

  const refreshVideoAnalysisTasks = React.useCallback(async (): Promise<void> => {
    if (!projectId) return
    try {
      await refreshVideoAnalysisProjection(projectId)
    } catch {
      // Engine status and task errors are represented by durable rows; transient IPC errors do not erase the last snapshot.
    }
  }, [projectId])

  const refreshProductionRuns = React.useCallback(async (): Promise<void> => {
    if (!projectId) {
      setProductionRuns([])
      return
    }
    const bridge = getDesktopBridge()?.productionRuns
    if (!bridge) return
    try {
      setProductionRuns(await bridge.list(projectId))
    } catch {
      // Preserve the last durable snapshot while a transient IPC refresh fails.
    }
  }, [projectId])

  React.useEffect(() => {
    void refreshVideoAnalysisTasks()
    if (!projectId) return
    const id = window.setInterval(() => void refreshVideoAnalysisTasks(), 3_000)
    return () => window.clearInterval(id)
  }, [projectId, refreshVideoAnalysisTasks])

  React.useEffect(() => {
    void refreshProductionRuns()
    if (!projectId) return
    const id = window.setInterval(() => void refreshProductionRuns(), 1_500)
    return () => window.clearInterval(id)
  }, [projectId, refreshProductionRuns])

  // 失焦提醒的订阅住这里：本按钮全程挂载（跟着顶栏），是最稳的宿主。
  useBatchFinishNotifier()

  // E2E 专用桥（同 CameraMoveCaptureHost 的既有写法）：仅当 localStorage['__nomiE2E']==='1' 时把队列 store
  // 挂到 window，供 R13 走查在页面上下文里摆出各种队列状态截图取证。生产从不置该标志 → 永不暴露。
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        ;(window as unknown as { __nomiQueueStore?: unknown }).__nomiQueueStore = useGenerationQueueStore
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])

  const summary = React.useMemo(() => {
    const generation = buildTaskCenterView({ entries, batches, nodes, fallbackTitle: '', now: Date.now() }).summary
    const analysis = buildVideoAnalysisTaskRows(videoAnalysisTasks, Date.now(), {
      title: t('taskCenter.videoAnalysis.title'),
      stages: {
        queued: t('taskCenter.videoAnalysis.stages.queued'),
        reading_media: t('taskCenter.videoAnalysis.stages.readingMedia'),
        analyzing_evidence: t('taskCenter.videoAnalysis.stages.analyzingEvidence'),
        structuring: t('taskCenter.videoAnalysis.stages.structuring'),
        completed: t('taskCenter.videoAnalysis.stages.completed'),
      },
      submissionUnknown: t('taskCenter.videoAnalysis.submissionUnknown'),
      engineOffline: t('taskCenter.videoAnalysis.engineOffline'),
    })
    const production = buildProductionRunTaskRows(productionRuns, {
      title: t('taskCenter.productionRun.title'),
      statuses: {
        draft: t('taskCenter.productionRun.statuses.draft'),
        awaiting_direction: t('taskCenter.productionRun.statuses.awaitingDirection'),
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
    })
    return {
      ...generation,
      running: generation.running + analysis.filter((row) => row.group === 'running').length + production.filter((row) => row.group === 'running').length,
      queued: generation.queued + analysis.filter((row) => row.group === 'queued').length + production.filter((row) => row.group === 'queued').length,
      failed: generation.failed + analysis.filter((row) => row.outcome === 'error' && !row.recoverable).length,
    }
  }, [entries, batches, nodes, productionRuns, t, videoAnalysisTasks])
  const tone = resolveTaskButtonTone(summary)
  const pending = summary.running + summary.queued

  return (
    <>
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <Tooltip>
          <TooltipTrigger asChild>
            <WorkbenchButton
              className={cn(
                'nomi-appbar__ghost',
                'app-no-drag',
                'inline-flex items-center gap-1.5 h-[30px] px-2.5',
                'border border-transparent rounded-[var(--nomi-radius-sm)]',
                'font-inherit text-body-sm',
                'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                tone === 'busy'
                  ? 'bg-nomi-accent text-nomi-paper hover:bg-nomi-accent'
                  : tone === 'failed'
                    ? 'bg-transparent text-nomi-danger hover:bg-nomi-ink-05'
                    : 'bg-transparent text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              aria-label={t('taskCenter.title')}
              data-task-center-trigger="true"
              onClick={() => setOpened((value) => !value)}
            >
              <IconListDetails size={15} stroke={1.8} />
              <span className="max-[1400px]:hidden">{t('taskCenter.title')}</span>
              {pending > 0 ? (
                <span className="min-w-4 rounded-pill bg-nomi-paper px-1 text-center text-micro tabular-nums text-nomi-accent">
                  {pending}
                </span>
              ) : null}
            </WorkbenchButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('taskCenter.title')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TaskCenterPanel
        opened={opened}
        onClose={() => setOpened(false)}
        videoAnalysisTasks={videoAnalysisTasks}
        productionRuns={productionRuns}
        onRefreshVideoAnalysis={() => void refreshVideoAnalysisTasks()}
        onRevealProductionRun={(targetProjectId, runId) => {
          useWorkbenchStore.getState().setWorkspaceMode('generation')
          useGenerationCanvasStore.getState().setGenerationAiCollapsed(false)
          void useProductionRunStore.getState().navigateTo(targetProjectId, runId)
        }}
        {...(onRevealNode ? { onRevealNode } : {})}
      />
    </>
  )
}

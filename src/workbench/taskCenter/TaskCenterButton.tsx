// 顶栏「任务」入口。住 NomiAppBar 右栏 —— 那是唯一跨创作/生成/预览三区常驻的 chrome，
// 正是「切到创作页就看不见生成跑到哪了」的解药。
// 方案：docs/plan/2026-08-02-task-center-queue.md，样张 2026-08-02 拍板。
//
// 按钮同时表达“任务列表入口”和当前状态：名称常显，有活时 accent + 数字徽标，失败时转提醒色。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconListDetails } from '@tabler/icons-react'
import type { ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import type { ExportJobSnapshot } from '../../../electron/shared/contracts/exportJobManager'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WorkbenchButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { cn } from '../../utils/cn'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { selectStableCanvasNodes } from '../generationCanvas/store/canvasNodeProjection'
import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { useProductionRunStore } from '../production/productionRunStore'
import { useWorkbenchStore } from '../workbenchStore'
import { TaskCenterPanel } from './TaskCenterPanel'
import { buildTaskCenterView, pendingTaskCount, resolveTaskButtonTone, summarizeTaskCenterRows } from './taskCenterEntries'
import { buildProductionRunTaskRows, mergeProductionRunSummaries, productionRunTaskLabels } from './productionRunTaskCenter'
import { buildExportJobTaskRows, exportJobTaskLabels } from './exportJobTaskCenter'
import { useBatchFinishNotifier } from './useBatchFinishNotifier'

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
  // 任务中心只按 id 取标题/状态/进度合成任务行，不读 position → 位置稳定投影（suspect #1）。
  const nodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const [productionRuns, setProductionRuns] = React.useState<ProductionRunSummary[]>([])
  const [exportJobs, setExportJobs] = React.useState<ExportJobSnapshot[]>([])
  const detailedProductionRun = useProductionRunStore((state) => (
    state.projectId === projectId ? state.run : null
  ))
  const resolvedProductionRuns = React.useMemo(
    () => mergeProductionRunSummaries(productionRuns, detailedProductionRun),
    [detailedProductionRun, productionRuns],
  )
  const resolvedExportJobs = React.useMemo(
    () => exportJobs.filter((job) => job.projectId === projectId),
    [exportJobs, projectId],
  )

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

  const refreshExportJobs = React.useCallback(async (): Promise<void> => {
    if (!projectId) {
      setExportJobs([])
      return
    }
    const bridge = getDesktopBridge()?.exports
    if (!bridge?.list) return
    try {
      const jobs = await bridge.list()
      setExportJobs(jobs.filter((job) => job.projectId === projectId))
    } catch {
      // Preserve the last exact project snapshot while a transient IPC refresh fails.
    }
  }, [projectId])

  React.useEffect(() => {
    setExportJobs([])
    void Promise.all([refreshProductionRuns(), refreshExportJobs()])
    if (!projectId) return
    const id = window.setInterval(() => void Promise.all([refreshProductionRuns(), refreshExportJobs()]), 1_500)
    return () => window.clearInterval(id)
  }, [projectId, refreshExportJobs, refreshProductionRuns])

  // 失焦提醒的订阅住这里：本按钮全程挂载（跟着顶栏），是最稳的宿主。
  useBatchFinishNotifier()

  // 制作深链落点：外部 AI（MCP）深链进来 → 打开任务中心（制作任务的家），
  // 沿用仓内既有的 window CustomEvent 约定（同 'nomi-open-settings'）。
  React.useEffect(() => {
    const handler = () => setOpened(true)
    window.addEventListener('nomi-open-task-center', handler)
    return () => window.removeEventListener('nomi-open-task-center', handler)
  }, [])

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

  // 与任务面板同一套行与汇总（面板关着时没有打开的整卡，制作行按摘要状态分组；计数只看「没结束」，两种分法一致）。
  const summary = React.useMemo(() => {
    const generation = buildTaskCenterView({ entries, batches, nodes, fallbackTitle: '', now: Date.now() })
    const production = buildProductionRunTaskRows(resolvedProductionRuns, productionRunTaskLabels((key, options) => t(key, options)))
    const exports = buildExportJobTaskRows(resolvedExportJobs, exportJobTaskLabels((key) => t(key)))
    return summarizeTaskCenterRows([...generation.rows, ...production, ...exports], generation.summary.pausedBatchId)
  }, [entries, batches, nodes, resolvedExportJobs, resolvedProductionRuns, t])
  const tone = resolveTaskButtonTone(summary)
  const pending = pendingTaskCount(summary)

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
                'transition-[background,color] duration-nomi-fast ease-nomi-fast',
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
              <span className="max-[1600px]:hidden">{t('taskCenter.title')}</span>
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
        productionRuns={resolvedProductionRuns}
        exportJobs={resolvedExportJobs}
        onRevealProductionRun={(targetProjectId, runId) => {
          useWorkbenchStore.getState().setWorkspaceMode('generation')
          useWorkbenchStore.getState().setProjectAgentDockCollapsed(false)
          void useProductionRunStore.getState().navigateTo(targetProjectId, runId)
        }}
        {...(onRevealNode ? { onRevealNode } : {})}
      />
    </>
  )
}

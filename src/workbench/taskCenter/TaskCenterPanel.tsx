// 任务中心面板（右上浮卡：不遮画布、不 dim、ESC/点外关）。
// 方案：docs/plan/2026-08-02-task-center-queue.md，样张 2026-08-02 拍板。
//
// 只负责画；分组/排序/可取消性判定全在纯函数 taskCenterEntries.ts（可单测）。
import React from 'react'
import { useGenerationFeedbackClock } from '../observability/useGenerationFeedback'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconClock, IconProgress, IconLoader2, IconLock, IconX } from '@tabler/icons-react'
import type { ExportJobSnapshot } from '../../../electron/shared/contracts/exportJobManager'
import { runExportJobTaskAction } from './exportJobTaskAction'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { selectStableCanvasNodes } from '../generationCanvas/store/canvasNodeProjection'
import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { requestTaskCancel } from '../generationCanvas/runner/localTaskControl'
// 重试复用既有链路（单发 confirmAndRunNode / 批量 confirmAndRunPlan），不另起一套付费路径。
import { confirmAndRunNode } from '../generationCanvas/runner/generationRunController'
// 重新拉取与节点上那颗按钮同一条路（查询，不花钱），项目身份在点击这一刻签发。
import { recoverNodeResult } from '../generationCanvas/runner/recoverTaskActions'
import { withProjectAction } from '../project/projectCanvasReadSurface'
import { confirmAndRunPlan } from '../generationCanvas/components/batchPlanPreview'
import { buildDependencyWaves } from '../generationCanvas/runner/dependencyWaves'
import { buildTaskCenterView, formatElapsed, summarizeTaskCenterRows, type TaskCenterRow } from './taskCenterEntries'
import { notify } from '../../ui/notificationPolicy'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../design'
import { currentWorkbenchFloatingTopOffset } from '../../ui/app-shell/windowChrome'
import type { ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import { TASK_CENTER_GROUPS, type TaskCenterGroup, type TaskCenterProjection } from './taskCenterProjection'
import { buildProductionRunTaskRows, productionRunTaskLabels } from './productionRunTaskCenter'
import { buildExportJobTaskRows, exportJobTaskLabels } from './exportJobTaskCenter'
import { ProductionRunTaskCard } from '../production/ProductionRunTaskCard'
import { useProductionStatus } from '../production/useProductionStatus'
import { logRendererError } from '../../desktop/rendererLog'

const PANEL_WIDTH = 380
const RIGHT_OFFSET = 12

type Props = {
  opened: boolean
  onClose: () => void
  productionRuns: readonly ProductionRunSummary[]
  exportJobs: readonly ExportJobSnapshot[]
  onRevealProductionRun?: (projectId: string, runId: string) => void
  /** 点某一行 → 切到生成区并选中该节点。 */
  onRevealNode?: (nodeId: string) => void
}

export function TaskCenterPanel({ opened, onClose, productionRuns, exportJobs, onRevealProductionRun, onRevealNode }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [actionErrors, setActionErrors] = React.useState<Record<string, string>>({})
  // 渲染时现算，别提到模块作用域：模块常量在 import 那一刻定死，拿不到 platform 就悄悄
  // 回落成 mac 的 64px，Windows 上浮卡上移 32px 贴进自绘窗口栏（issue #58 同因）。
  const topOffset = currentWorkbenchFloatingTopOffset()
  const entries = useGenerationQueueStore((state) => state.entries)
  const batches = useGenerationQueueStore((state) => state.batches)
  // 面板全程挂载（关着也订阅，见 TaskCenterButton）；只按 id 取任务行数据、不读 position
  // → 位置稳定投影，拖动期这个常挂订阅者不再每帧重渲（suspect #1）。cancel/retry 处理器仍走
  // getState().nodes 拿真节点，不受投影影响。
  const nodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const now = useGenerationFeedbackClock(opened)
  // N1：制作任务的家搬到这里（原先在画布助手面板里，见 plan 2026-08-11-nomi-side-viewer-and-fallback）。
  // 只在面板打开时加载/轮询完整 run——关着时徽标由 TaskCenterButton 的 summary 轮询维持。
  const production = useProductionStatus({ enabled: opened })

  React.useEffect(() => {
    if (!opened) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose])

  React.useEffect(() => {
    if (!opened) return
    const cleanup = { current: () => {} }
    // rAF 延一帧再挂，否则「点开按钮」那次 mousedown 会立刻把自己关掉。
    const frame = window.requestAnimationFrame(() => {
      const handler = (event: MouseEvent) => {
        if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
      }
      window.addEventListener('mousedown', handler)
      cleanup.current = () => window.removeEventListener('mousedown', handler)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cleanup.current()
    }
  }, [opened, onClose])

  const view = React.useMemo(
    () => buildTaskCenterView({ entries, batches, nodes, fallbackTitle: t('taskCenter.untitledShot'), now }),
    [entries, batches, nodes, t, now],
  )
  // 打开成整卡的那份 Run：分组取自它完整的判断，卡放在哪一组和卡上的状态签是同一件事。
  const openedRunId = production.view ? production.production.run?.runId : undefined
  const openedGroup = production.view?.group
  const productionRows = React.useMemo(
    () => buildProductionRunTaskRows(
      productionRuns,
      productionRunTaskLabels((key, options) => t(key, options)),
      openedRunId && openedGroup ? { runId: openedRunId, group: openedGroup } : undefined,
    ),
    [productionRuns, t, openedRunId, openedGroup],
  )
  const exportRows = React.useMemo(() => buildExportJobTaskRows(exportJobs, exportJobTaskLabels((key) => t(key))), [exportJobs, t])

  if (!opened) return null

  // 不排序：下面按 TASK_CENTER_GROUPS 逐组筛出来渲染，组的先后由那一份顺序决定，组内保持各映射给的顺序。
  const rows: TaskCenterProjection[] = [...view.rows, ...productionRows, ...exportRows]
  const summary = summarizeTaskCenterRows(rows, view.summary.pausedBatchId)
  const rowsIn = (group: TaskCenterGroup) => rows.filter((row) => row.group === group)
  const queued = rowsIn('queued')
  const done = rowsIn('done')

  const cancelQueued = (row: TaskCenterRow) => useGenerationQueueStore.getState().cancelEntry(row.batchId, row.nodeId)
  const interruptRunning = (row: TaskCenterRow) => {
    const node = nodes.find((candidate) => candidate.id === row.nodeId)
    if (node) requestTaskCancel(node, (message) => setActionErrors((previous) => ({ ...previous, [row.id]: message })))
  }
  const cancelAllQueued = () => {
    const batchIds = new Set(queued.filter((row): row is TaskCenterRow => row.kind === 'generation').map((row) => row.batchId))
    batchIds.forEach((batchId) => useGenerationQueueStore.getState().cancelBatchRemaining(batchId))
  }
  // 失败重试：只对失败的重建依赖波次 → 走既有轻确认铸新令牌（不绕付费闸），成功的不重付。
  const failedRows = done.filter((row): row is TaskCenterRow => row.kind === 'generation' && row.outcome === 'error' && !row.recoverable)
  const retryAllFailed = () => {
    const state = useGenerationCanvasStore.getState()
    void confirmAndRunPlan(
      buildDependencyWaves(
        failedRows.map((row) => row.nodeId),
        { nodes: state.nodes, edges: state.edges },
      ),
      { initiator: 'user' },
    )
  }
  const reveal = (row: TaskCenterProjection) => {
    onClose()
    if (row.kind === 'generation') {
      onRevealNode?.(row.nodeId)
      return
    }
    if (row.kind === 'production_run') {
      onRevealProductionRun?.(row.projectId, row.runId)
    }
  }
  /**
   * 制作任务在这里长成完整卡（看片台 + 兜底）；其余任务仍是紧凑行。
   * 只有 store 已载入的那个 run 出卡——其它 run 拿不到完整数据（gates/artifacts），保持行不撒谎。
   */
  const renderRow = (row: TaskCenterProjection): JSX.Element => {
    if (row.kind === 'production_run' && production.view && production.production.run?.runId === row.runId) {
      const run = production.production.run
      return (
        <div key={row.id} className="px-2.5 pb-1.5">
          <ProductionRunTaskCard
            projectId={run.projectId}
            view={production.view}
            artifacts={run.artifacts}
            focusedArtifactId={production.focusedArtifactId}
            actionError={production.actionError}
            onPrimaryAction={production.onPrimaryAction}
            onControl={production.onControl}
            onOpenPreview={() => reveal(row)}
          />
        </div>
      )
    }
    return <TaskRow key={row.id} row={row} actionError={actionErrors[row.id]} onReveal={reveal} onAction={() => void runAction(row)} />
  }

  /**
   * 行上那颗操作钮（取消 / 中断 / 重试 / 取消导出）里有两条通到主进程，会失败。
   * 此前整个 Promise 被裸 `void` 丢掉：用户点「取消导出」，行还在跑、按钮还在那儿、
   * 一个字的解释也没有（设计系统 §4.1 C1）。失败就说一句，别让人对着不动的行猜。
   */
  const runAction = async (row: TaskCenterProjection): Promise<void> => {
    const action = row.action
    if (!action) return
    setActionErrors((current) => { const next = { ...current }; delete next[row.id]; return next })
    try {
      // 项目身份在点击这一刻签发（projectActionIssuance 契约：签发前不许有任何 await），所以这一支排最前。
      if (action.kind === 'recover_generation') await withProjectAction((project) => recoverNodeResult(action.nodeId, project))
      else if (action.kind === 'cancel_generation_queue') cancelQueued(row as TaskCenterRow)
      else if (action.kind === 'interrupt_generation') interruptRunning(row as TaskCenterRow)
      else if (action.kind === 'retry_generation') await confirmAndRunNode(action.nodeId, { initiator: 'user' })
      else if (row.kind === 'export_job') {
        if (!(await runExportJobTaskAction(row.action))) throw new Error('Export destination unavailable')
        if (row.action.kind === 'return_to_export') onClose()
      }
    } catch (error) {
      logRendererError('task-center-action-failed', error)
      notify({
        identity: row.id, reason: action.kind, level: 'inline', type: 'error',
        message: row.kind === 'export_job' ? t('taskCenter.actionFailed')
          : `${t('taskCenter.actionFailed')}: ${error instanceof Error ? error.message : String(error)}`,
        present: (message) => setActionErrors((current) => ({ ...current, [row.id]: message })),
      })
    }
  }

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('taskCenter.title')}
        data-nomi-right-panel="tasks"
        // app-no-drag：与模型设置浮卡同因同治（issue #58）——Portal 到 body 的浮层不是窗口栏后代，
        // 拿不到窗口栏内的拖拽豁免，压在 Windows 自绘拖拽带上的按钮点击会被系统当拖窗口吞掉。
        className="app-no-drag flex flex-col overflow-hidden bg-nomi-paper border border-nomi-line shadow-nomi-lg"
        style={{
          position: 'fixed',
          top: topOffset,
          right: RIGHT_OFFSET,
          width: `min(${PANEL_WIDTH}px, calc(100vw - 24px))`,
          maxHeight: `calc(100vh - ${topOffset + 16}px)`,
          borderRadius: 'var(--nomi-radius-lg)',
          zIndex: 4000,
          animation: 'nomi-panel-pop 140ms cubic-bezier(.2, .7, .3, 1)',
        }}
      >
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2.5 border-b border-nomi-line">
          <IconProgress size={16} stroke={1.8} className="text-nomi-ink-80" />
          <span className="text-title text-nomi-ink">{t('taskCenter.title')}</span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label={t('taskCenter.close')}
            onClick={onClose}
            className="inline-flex items-center justify-center size-6 rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink transition-[background,color] duration-nomi-fast ease-nomi-fast"
          >
            <IconX size={15} stroke={1.8} />
          </button>
        </div>

        <TaskCenterSummaryBar
          summary={summary}
          onRetryAllFailed={failedRows.length > 0 ? retryAllFailed : undefined}
          onCancelAll={cancelAllQueued}
          onResume={() => summary.pausedBatchId && useGenerationQueueStore.getState().resumeBatch(summary.pausedBatchId)}
          onCancelPaused={() =>
            summary.pausedBatchId && useGenerationQueueStore.getState().cancelBatchRemaining(summary.pausedBatchId)
          }
        />

        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {TASK_CENTER_GROUPS.map((group) => {
            const groupRows = rowsIn(group)
            if (groupRows.length === 0) return null
            return (
              <section key={group} data-task-group={group}>
                <SectionHeader
                  group={group}
                  icon={SECTION_ICONS[group]}
                  label={t(`taskCenter.groups.${group}`)}
                  count={groupRows.length}
                  {...(group === 'queued' ? { note: t('taskCenter.freeToCancel') } : {})}
                />
                {groupRows.map((row) => renderRow(row))}
              </section>
            )
          })}

          {rows.length === 0 ? (
            <div className="px-3.5 py-9 text-center text-caption text-nomi-ink-40 leading-relaxed">
              <IconProgress size={22} stroke={1.5} className="mx-auto mb-2 text-nomi-ink-30" />
              {t('taskCenter.empty.title')}
              <br />
              {t('taskCenter.empty.hint')}
            </div>
          ) : null}
        </div>

        <style>{`
          @keyframes nomi-panel-pop {
            from { opacity: 0; transform: translateY(-4px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </Portal>
  )
}

const SECTION_ICONS: Record<TaskCenterGroup, React.ReactNode> = {
  running: <IconLoader2 size={13} stroke={1.8} />,
  attention: <IconAlertTriangle size={13} stroke={1.8} />,
  queued: <IconClock size={13} stroke={1.8} />,
  done: <IconCheck size={13} stroke={1.8} />,
}

function SectionHeader({ group, icon, label, count, note }: { group: TaskCenterGroup; icon: React.ReactNode; label: string; count: number; note?: string }): JSX.Element {
  return (
    <div data-task-section={group} className="flex items-center gap-1.5 px-3.5 pt-2 pb-1 text-micro text-nomi-ink-60">
      <span className="inline-flex text-nomi-ink-40">{icon}</span>
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
      {note ? <span className="text-nomi-accent">· {note}</span> : null}
    </div>
  )
}

function TaskCenterSummaryBar({
  summary,
  onCancelAll,
  onRetryAllFailed,
  onResume,
  onCancelPaused,
}: {
  summary: ReturnType<typeof buildTaskCenterView>['summary']
  onCancelAll: () => void
  onRetryAllFailed?: () => void
  onResume: () => void
  onCancelPaused: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (summary.pausedBatchId) {
    // 连续失败刹车：这不是普通汇总，是要用户拿主意的一刻 —— 说清「为什么停」再给两条路。
    return (
      <div className="px-3.5 py-2.5 border-b border-nomi-line bg-nomi-ink-05 flex flex-col gap-1.5">
        <div className="flex items-start gap-1.5 text-caption text-nomi-ink">
          <IconAlertTriangle size={14} stroke={1.8} className="mt-0.5 shrink-0 text-nomi-danger" />
          <span>{t('taskCenter.brake.title')}</span>
        </div>
        <div className="text-micro text-nomi-ink-60 leading-relaxed">{t('taskCenter.brake.hint')}</div>
        <div className="flex gap-1.5">
          <SummaryAction label={t('taskCenter.brake.resume')} onClick={onResume} />
          <SummaryAction label={t('taskCenter.brake.cancelRest')} onClick={onCancelPaused} />
        </div>
      </div>
    )
  }
  // 与分组同序（TASK_CENTER_GROUPS）：要你动手的先说。
  const parts: string[] = []
  if (summary.attention > 0) parts.push(t('taskCenter.summary.attention', { count: summary.attention }))
  if (summary.running > 0) parts.push(t('taskCenter.summary.running', { count: summary.running }))
  if (summary.queued > 0) parts.push(t('taskCenter.summary.queued', { count: summary.queued }))
  if (summary.failed > 0) parts.push(t('taskCenter.summary.failed', { count: summary.failed }))
  if (parts.length === 0) return null
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 border-b border-nomi-line bg-nomi-ink-05 text-caption text-nomi-ink-80">
      <span className="flex-1">{parts.join(' · ')}</span>
      {/* 还有没提交的 → 先给「停」；都跑完了才轮到「重试失败的」（同一时刻只给一个主动作，不堆按钮）。 */}
      {summary.cancellable > 0 ? (
        <SummaryAction label={t('taskCenter.cancelQueued', { count: summary.cancellable })} onClick={onCancelAll} />
      ) : summary.running === 0 && summary.failed > 0 && onRetryAllFailed ? (
        <SummaryAction label={t('taskCenter.retryFailed', { count: summary.failed })} onClick={onRetryAllFailed} />
      ) : null}
    </div>
  )
}

function SummaryAction({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-micro text-nomi-ink-60 border border-nomi-line rounded-full px-2 py-0.5 hover:text-nomi-ink hover:border-nomi-ink-40 transition-[color,border-color] duration-nomi-fast ease-nomi-fast"
    >
      {label}
    </button>
  )
}

/**
 * 行动作的悬停说明（样张 D1-A）。「重新拉取」与付费的「重试」同一种小胶囊，悬停必须说清它只查不花钱；
 * 浮层走设计系统 Tooltip，层级取 popover 档——面板本身在 floatingPanel 档，不抬上去就被面板盖住。
 */
function RowActionHint({ hint, children }: { hint?: string; children: React.ReactElement }): JSX.Element {
  if (!hint) return children
  return (
    <TooltipProvider delayDuration={250} disableHoverableContent>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="left" className="z-popover" data-task-action-hint>{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function TaskRow({
  row,
  actionError,
  onReveal,
  onAction,
}: {
  row: TaskCenterProjection
  actionError?: string
  onReveal?: (row: TaskCenterProjection) => void
  onAction?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const failed = row.outcome === 'error' && !row.recoverable
  const revealable = row.kind !== 'export_job' && Boolean(onReveal)
  return (
    <div
      data-task-id={row.id}
      data-task-node-id={row.kind === 'generation' ? row.nodeId : undefined}
      data-task-group={row.group}
      role={revealable ? 'button' : undefined}
      tabIndex={revealable ? 0 : undefined}
      onClick={() => { if (revealable) onReveal?.(row) }}
      onKeyDown={(event) => {
        if (revealable && (event.key === 'Enter' || event.key === ' ')) onReveal?.(row)
      }}
      className={`flex gap-2.5 px-3.5 py-2 items-start transition-[background] duration-nomi-fast ease-nomi-fast ${revealable ? 'cursor-pointer hover:bg-nomi-ink-05' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className={['text-body-sm truncate', failed ? 'text-nomi-ink' : 'text-nomi-ink-80'].join(' ')}>{row.title}</div>
        <div className={['text-micro mt-0.5 truncate', failed ? 'text-nomi-danger' : 'text-nomi-ink-60'].join(' ')}>
          {row.kind === 'generation' ? <span data-generation-message>{row.phaseText}</span>
            : row.group === 'running'
              ? [row.phaseText, row.elapsedMs !== undefined ? t('taskCenter.row.elapsed', { time: formatElapsed(row.elapsedMs) }) : ''].filter(Boolean).join(' · ')
              : row.phaseText}
        </div>
        {row.kind === 'export_job' && row.error ? <div data-task-result-reason className="mt-1 text-micro text-nomi-danger">{row.error}</div> : null}
        {actionError ? <div role="status" data-task-action-error className="mt-1 text-micro text-workbench-danger">{actionError}</div> : null}
        {/* 只有真拿到百分比才画进度条。很多厂商不报进度，画一条永远空的槽会被读成分隔线（走查实锤），
            也是在假装知道进度。没数就不画，靠区段标题 + 已跑时长表达「在跑」。 */}
        {row.group === 'running' && typeof row.percent === 'number' ? (
          <div className="h-[3px] bg-nomi-ink-10 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-nomi-accent rounded-full transition-[width] duration-nomi-fast ease-nomi-fast" style={{ width: `${row.percent}%` }} />
          </div>
        ) : null}
        {row.kind === 'generation' && row.cancel === 'none' && row.group === 'running' ? (
          // 诚实交付：云端提交后停不下来，钱已经花了。给个假的取消按钮等于撒谎。
          <div className="flex items-center gap-1 text-micro text-nomi-ink-40 mt-1">
            <IconLock size={11} stroke={1.8} />
            {t('taskCenter.row.submittedNoStop')}
          </div>
        ) : null}
      </div>
      {row.action && onAction ? (
        <RowActionHint hint={row.action.kind === 'recover_generation' ? t('taskCenter.row.recoverHint') : undefined}>
          <button
            type="button"
            data-task-action={row.action.kind}
            onClick={(event) => {
              event.stopPropagation()
              onAction()
            }}
            className="shrink-0 text-micro text-nomi-ink-60 border border-nomi-line rounded-full px-2 py-0.5 hover:text-nomi-ink hover:border-nomi-ink-40 transition-[color,border-color] duration-nomi-fast ease-nomi-fast"
          >
            {row.action.kind === 'reveal_export_output'
              ? t('taskCenter.exportJob.revealOutput')
              : row.action.kind === 'return_to_export'
                ? t('taskCenter.exportJob.returnToExport')
                : row.action.kind === 'retry_generation'
              ? t('taskCenter.row.retry')
              : row.action.kind === 'recover_generation'
                ? t('generationCommon.recoverable.recover')
              : row.cancel === 'free'
                ? t('taskCenter.row.cancel')
                : t('taskCenter.row.interrupt')}
          </button>
        </RowActionHint>
      ) : null}
    </div>
  )
}

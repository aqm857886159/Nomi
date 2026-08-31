// 任务中心面板（右上浮卡，照 OnboardingFloatingPanel 模式：不遮画布、不 dim、ESC/点外关）。
// 方案：docs/plan/2026-08-02-task-center-queue.md，样张 2026-08-02 拍板。
//
// 只负责画；分组/排序/可取消性判定全在纯函数 taskCenterEntries.ts（可单测）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Portal } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconProgress,
  IconLoader2,
  IconLock,
  IconX,
} from '@tabler/icons-react'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { requestComfyuiCancel } from '../generationCanvas/runner/comfyuiTaskControl'
// 重试复用既有链路（单发 confirmAndRunNode / 批量 confirmAndRunPlan），不另起一套付费路径。
import { confirmAndRunNode } from '../generationCanvas/runner/generationRunController'
import { confirmAndRunPlan } from '../generationCanvas/components/batchPlanPreview'
import { buildDependencyWaves } from '../generationCanvas/runner/dependencyWaves'
import { buildTaskCenterView, formatElapsed, type TaskCenterRow } from './taskCenterEntries'
import type { ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import type { TaskCenterProjection } from './taskCenterProjection'
import { buildProductionRunTaskRows } from './productionRunTaskCenter'
import { resolveTaskCenterPanelPosition, type TaskCenterPanelPosition } from './taskCenterPanelPosition'
/** 进行中的已跑时长要走字，1s 一跳就够（别 rAF，白烧 CPU）。 */
const TICK_MS = 1000

type Props = {
  opened: boolean
  onClose: () => void
  productionRuns: readonly ProductionRunSummary[]
  onRevealProductionRun?: (projectId: string, runId: string) => void
  anchorRef: React.RefObject<HTMLElement>
  /** 点某一行 → 切到生成区并选中该节点。 */
  onRevealNode?: (nodeId: string) => void
}

export function TaskCenterPanel({
  opened,
  onClose,
  productionRuns,
  onRevealProductionRun,
  anchorRef,
  onRevealNode,
}: Props): JSX.Element | null {
  const { t } = useTranslation()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const entries = useGenerationQueueStore((state) => state.entries)
  const batches = useGenerationQueueStore((state) => state.batches)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const [now, setNow] = React.useState(() => Date.now())
  const [position, setPosition] = React.useState<TaskCenterPanelPosition | null>(null)

  React.useLayoutEffect(() => {
    if (!opened) return
    const updatePosition = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return
      const appBarBottom = document.querySelector('.nomi-appbar')?.getBoundingClientRect().bottom ?? 0
      setPosition(resolveTaskCenterPanelPosition(anchor, window.innerWidth, window.innerHeight, appBarBottom))
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, opened])

  React.useEffect(() => {
    if (!opened) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [opened])

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
        const target = event.target as Node
        if (panelRef.current && !panelRef.current.contains(target) && !anchorRef.current?.contains(target)) onClose()
      }
      window.addEventListener('mousedown', handler)
      cleanup.current = () => window.removeEventListener('mousedown', handler)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      cleanup.current()
    }
  }, [anchorRef, opened, onClose])

  const view = React.useMemo(
    () => buildTaskCenterView({ entries, batches, nodes, fallbackTitle: t('taskCenter.untitledShot'), now }),
    [entries, batches, nodes, t, now],
  )
  const productionRows = React.useMemo(() => buildProductionRunTaskRows(productionRuns, {
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
  }), [productionRuns, t])

  if (!opened || !position) return null

  const generationRows = view.rows
  const rows: TaskCenterProjection[] = [...generationRows, ...productionRows].sort((left, right) => {
    const order = { running: 0, queued: 1, done: 2 }
    return order[left.group] - order[right.group]
  })
  const summary = {
    ...view.summary,
    running: view.summary.running + productionRows.filter((row) => row.group === 'running').length,
    queued: view.summary.queued + productionRows.filter((row) => row.group === 'queued').length,
  }
  const running = rows.filter((row) => row.group === 'running')
  const queued = rows.filter((row) => row.group === 'queued')
  const done = rows.filter((row) => row.group === 'done')

  const cancelQueued = (row: TaskCenterRow) => useGenerationQueueStore.getState().cancelEntry(row.batchId, row.nodeId)
  const interruptRunning = (row: TaskCenterRow) => {
    const node = nodes.find((candidate) => candidate.id === row.nodeId)
    if (node) requestComfyuiCancel(node)
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
  const runAction = async (row: TaskCenterProjection): Promise<void> => {
    const action = row.action
    if (!action) return
    if (action.kind === 'cancel_generation_queue') cancelQueued(row as TaskCenterRow)
    else if (action.kind === 'interrupt_generation') interruptRunning(row as TaskCenterRow)
    else if (action.kind === 'retry_generation') await confirmAndRunNode(action.nodeId)
  }
  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('taskCenter.title')}
        data-nomi-right-panel="tasks"
        className="flex flex-col overflow-hidden bg-nomi-paper border border-nomi-line shadow-nomi-lg"
        style={{
          position: 'fixed',
          top: position.top,
          left: position.left,
          width: position.width,
          maxHeight: position.maxHeight,
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
            className="inline-flex items-center justify-center size-6 rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink transition-[background,color] duration-[var(--nomi-transition-fast)]"
          >
            <IconX size={15} stroke={1.8} />
          </button>
        </div>

        <TaskCenterSummaryBar
          summary={summary}
          onRetryAllFailed={failedRows.length > 0 ? retryAllFailed : undefined}
          onCancelAll={cancelAllQueued}
          onResume={() =>
            summary.pausedBatchId && useGenerationQueueStore.getState().resumeBatch(summary.pausedBatchId)
          }
          onCancelPaused={() =>
            summary.pausedBatchId && useGenerationQueueStore.getState().cancelBatchRemaining(summary.pausedBatchId)
          }
        />

        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {running.length > 0 ? (
            <SectionHeader
              icon={<IconLoader2 size={13} stroke={1.8} />}
              label={t('taskCenter.sections.running', { count: running.length })}
            />
          ) : null}
          {running.map((row) => (
            <TaskRow key={row.id} row={row} onReveal={reveal} onAction={() => void runAction(row)} />
          ))}

          {queued.length > 0 ? (
            <SectionHeader
              icon={<IconClock size={13} stroke={1.8} />}
              label={t('taskCenter.sections.queued', { count: queued.length })}
              note={t('taskCenter.freeToCancel')}
            />
          ) : null}
          {queued.map((row) => (
            <TaskRow key={row.id} row={row} onReveal={reveal} onAction={() => void runAction(row)} />
          ))}

          {done.length > 0 ? (
            <SectionHeader
              icon={<IconCheck size={13} stroke={1.8} />}
              label={t('taskCenter.sections.done', { count: done.length })}
            />
          ) : null}
          {done.map((row) => (
            <TaskRow
              key={row.id}
              row={row}
              onReveal={reveal}
              onAction={() => void runAction(row)}
            />
          ))}

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

function SectionHeader({ icon, label, note }: { icon: React.ReactNode; label: string; note?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 px-3.5 pt-2 pb-1 text-micro text-nomi-ink-60">
      <span className="inline-flex text-nomi-ink-40">{icon}</span>
      {label}
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
      <div
        className="px-3.5 py-2.5 border-b border-nomi-line bg-nomi-ink-05 flex flex-col gap-1.5"
        data-task-center-decision="brake"
      >
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
  const parts: string[] = []
  if (summary.running > 0) parts.push(t('taskCenter.summary.running', { count: summary.running }))
  if (summary.queued > 0) parts.push(t('taskCenter.summary.queued', { count: summary.queued }))
  if (summary.failed > 0) parts.push(t('taskCenter.summary.failed', { count: summary.failed }))
  if (parts.length === 0) return null
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 border-b border-nomi-line bg-nomi-ink-05 text-caption text-nomi-ink-80">
      <span className="flex-1">{parts.join(' · ')}</span>
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
      className="shrink-0 text-micro text-nomi-ink-60 border border-nomi-line rounded-full px-2 py-0.5 hover:text-nomi-ink hover:border-nomi-ink-40 transition-[color,border-color] duration-[var(--nomi-transition-fast)]"
    >
      {label}
    </button>
  )
}

function TaskRow({
  row,
  onReveal,
  onAction,
}: {
  row: TaskCenterProjection
  onReveal?: (row: TaskCenterProjection) => void
  onAction?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const failed = row.outcome === 'error' && !row.recoverable
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onReveal?.(row)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onReveal?.(row)
      }}
      className="flex gap-2.5 px-3.5 py-2 items-start cursor-pointer hover:bg-nomi-ink-05 transition-[background] duration-[var(--nomi-transition-fast)]"
    >
      <div className="flex-1 min-w-0">
        <div className={['text-body-sm truncate', failed ? 'text-nomi-ink' : 'text-nomi-ink-80'].join(' ')}>
          {row.title}
        </div>
        <div className={['text-micro mt-0.5 truncate', failed ? 'text-nomi-danger' : 'text-nomi-ink-60'].join(' ')}>
          {row.group === 'queued'
            ? row.kind === 'generation'
              ? row.waveIndex > 0
                ? t('taskCenter.row.waitingWave', { wave: row.waveIndex + 1 })
                : t('taskCenter.row.waitingSlot')
              : row.phaseText
            : row.group === 'running'
              ? [
                  row.phaseText,
                  row.elapsedMs !== undefined
                    ? t('taskCenter.row.elapsed', { time: formatElapsed(row.elapsedMs) })
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : row.kind === 'production_run'
                ? row.phaseText
              : row.outcome === 'cancelled'
                ? t('taskCenter.row.cancelled')
                : row.recoverable
                  ? t('taskCenter.row.recoverable')
                  : failed
                    ? row.error || t('taskCenter.row.failed')
                    : t('taskCenter.row.took', { time: formatElapsed(row.elapsedMs) })}
        </div>
        {/* 只有真拿到百分比才画进度条。很多厂商不报进度，画一条永远空的槽会被读成分隔线（走查实锤），
            也是在假装知道进度。没数就不画，靠区段标题 + 已跑时长表达「在跑」。 */}
        {row.group === 'running' && typeof row.percent === 'number' ? (
          <div className="h-[3px] bg-nomi-ink-10 rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full bg-nomi-accent rounded-full transition-[width] duration-[var(--nomi-transition-fast)]"
              style={{ width: `${row.percent}%` }}
            />
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
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onAction()
          }}
          className="shrink-0 text-micro text-nomi-ink-60 border border-nomi-line rounded-full px-2 py-0.5 hover:text-nomi-ink hover:border-nomi-ink-40 transition-[color,border-color] duration-[var(--nomi-transition-fast)]"
        >
          {row.action.kind === 'retry_generation'
            ? t('taskCenter.row.retry')
            : row.cancel === 'free'
              ? t('taskCenter.row.cancel')
              : t('taskCenter.row.interrupt')}
        </button>
      ) : null}
    </div>
  )
}

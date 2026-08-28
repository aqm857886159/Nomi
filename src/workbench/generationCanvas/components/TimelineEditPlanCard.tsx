import React from 'react'
import { IconAlertTriangle, IconCheck, IconClock, IconChevronDown, IconChevronRight, IconScissors } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { describeTimelineOperation, type TimelineOperation } from './timelineEditPlanModel'

export type TimelineToolCallLike = {
  toolCallId: string
  toolName: string
  args: unknown
  anchorMessageId?: string
}

export type TimelinePlanPreviewRecord = TimelineToolCallLike & {
  result: unknown
}

export type TimelineAppliedRecord = {
  planId: string
  summary: string
  operations?: TimelineOperation[]
  undoToken?: string
  expectedRevision: string
  status: 'applied' | 'undoing' | 'undone' | 'failed'
  message?: string
  anchorMessageId?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function operationList(args: unknown): TimelineOperation[] {
  const operations = asRecord(args).operations
  return Array.isArray(operations)
    ? operations.filter((operation): operation is TimelineOperation => Boolean(operation && typeof operation === 'object'))
    : []
}

function planSummary(args: unknown, result: unknown): string {
  const input = asRecord(args)
  const output = asRecord(result)
  const summary = typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim() : ''
  return summary || (typeof output.summary === 'string' ? output.summary : '')
}

function planId(args: unknown, result: unknown): string {
  const input = asRecord(args)
  const output = asRecord(result)
  return typeof input.planId === 'string' ? input.planId : typeof output.planId === 'string' ? output.planId : ''
}

function revision(args: unknown, result: unknown): string {
  const input = asRecord(args)
  const output = asRecord(result)
  return typeof input.baseRevision === 'string'
    ? input.baseRevision
    : typeof output.revision === 'string'
      ? output.revision
      : ''
}

function resultMessage(result: unknown): string {
  const output = asRecord(result)
  for (const key of ['message', 'code', 'reason']) {
    if (typeof output[key] === 'string' && output[key]) return output[key] as string
  }
  const diagnostics = output.diagnostics
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    const first = diagnostics[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).message === 'string') {
      return (first as Record<string, unknown>).message as string
    }
  }
  return ''
}

function operationRows(
  operations: TimelineOperation[],
  t: (key: string, options?: Record<string, unknown>) => string,
): JSX.Element {
  if (operations.length === 0) {
    return <span className="text-caption text-nomi-ink-60">{t('timelineEditor.agent.noOperations')}</span>
  }
  return (
    <ol className={cn('flex flex-col gap-1 list-none p-0 m-0')} aria-label={t('timelineEditor.agent.operationsAria')}>
      {operations.map((operation, index) => (
        <li key={`${String(operation.kind)}-${index}`} className={cn('flex items-start gap-2 text-caption text-nomi-ink-80')}>
          <span className={cn('shrink-0 inline-grid place-items-center size-4 rounded-full bg-nomi-ink-05 text-micro text-nomi-ink-60')}>
            {index + 1}
          </span>
          <span className={cn('min-w-0 leading-[1.45]')}>{describeTimelineOperation(operation, t)}</span>
        </li>
      ))}
    </ol>
  )
}

function StatusBadge({ tone, children }: { tone: 'active' | 'success' | 'warning' | 'neutral'; children: React.ReactNode }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 shrink-0 text-micro font-medium',
        tone === 'active' && 'text-nomi-accent',
        tone === 'success' && 'text-workbench-success-ink',
        tone === 'warning' && 'text-workbench-danger',
        tone === 'neutral' && 'text-nomi-ink-60',
      )}
    >
      {tone === 'active' ? <IconClock size={12} stroke={1.8} /> : null}
      {tone === 'success' ? <IconCheck size={12} stroke={1.8} /> : null}
      {tone === 'warning' ? <IconAlertTriangle size={12} stroke={1.8} /> : null}
      {children}
    </span>
  )
}

export function TimelineEditPlanCard({
  mode,
  call,
  result,
  applied,
  onApprove,
  onReject,
  onUndo,
}: {
  mode: 'preview' | 'pending' | 'applied'
  call?: TimelineToolCallLike
  result?: unknown
  applied?: TimelineAppliedRecord
  onApprove?: (toolCallId: string) => void
  onReject?: (toolCallId: string) => void
  onUndo?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = React.useState(mode !== 'preview')
  const sourceArgs = call?.args ?? applied
  const operations = applied?.operations ?? operationList(sourceArgs)
  const isUndoCall = call?.toolName === 'undo_timeline_edit'
  const summary = (isUndoCall ? t('timelineEditor.agent.undoRequest') : planSummary(sourceArgs, result)) || applied?.summary || t('timelineEditor.agent.untitledPlan')
  const plan = planId(sourceArgs, result) || applied?.planId || ''
  const currentRevision = revision(sourceArgs, result) || applied?.expectedRevision || ''
  const output = asRecord(result)
  const isPreviewValid = mode === 'preview' && output.ok !== false
  const isApplyFailure = mode === 'applied' && applied?.status === 'failed'
  const isUndoing = mode === 'applied' && applied?.status === 'undoing'
  const isUndone = mode === 'applied' && applied?.status === 'undone'

  return (
    <section
      className={cn(
        'flex flex-col gap-2 p-3 rounded-nomi border',
        mode === 'pending' && 'border-nomi-accent-soft bg-nomi-accent-soft/40',
        mode === 'preview' && 'border-nomi-line-soft bg-nomi-ink-05/50',
        mode === 'applied' && !isApplyFailure && 'border-nomi-line-soft bg-nomi-paper',
        isApplyFailure && 'border-workbench-danger/30 bg-workbench-danger-soft/35',
      )}
      data-timeline-edit-plan-card={mode}
      data-plan-id={plan || undefined}
      aria-label={t('timelineEditor.agent.cardAria')}
    >
      <header className={cn('flex items-start gap-2 min-w-0')}>
        <span className={cn('shrink-0 inline-grid place-items-center size-6 rounded-full bg-nomi-ink-05 text-nomi-accent')} aria-hidden="true">
          <IconScissors size={14} stroke={1.7} />
        </span>
        <div className={cn('min-w-0 flex-1')}>
          <div className={cn('flex items-center gap-2 min-w-0')}>
            <span className={cn('text-body-sm font-semibold text-nomi-ink truncate')}>{t('timelineEditor.agent.title')}</span>
            {mode === 'preview' ? <StatusBadge tone={isPreviewValid ? 'success' : 'warning'}>{isPreviewValid ? t('timelineEditor.agent.previewReady') : t('timelineEditor.agent.previewFailed')}</StatusBadge> : null}
            {mode === 'pending' ? <StatusBadge tone="active">{t('timelineEditor.agent.awaitingConfirmation')}</StatusBadge> : null}
            {mode === 'applied' && !isApplyFailure && !isUndoing && !isUndone ? <StatusBadge tone="success">{t('timelineEditor.agent.applied')}</StatusBadge> : null}
            {isUndoing ? <StatusBadge tone="active">{t('timelineEditor.agent.undoing')}</StatusBadge> : null}
            {isUndone ? <StatusBadge tone="neutral">{t('timelineEditor.agent.undone')}</StatusBadge> : null}
            {isApplyFailure ? <StatusBadge tone="warning">{t('timelineEditor.agent.failed')}</StatusBadge> : null}
          </div>
          <div className={cn('mt-0.5 text-caption text-nomi-ink-60 truncate')}>{summary}</div>
        </div>
      </header>

      {mode === 'preview' || mode === 'pending' ? (
        <div className={cn('flex items-center gap-2 text-micro text-nomi-ink-40')}>
          <span>{t('timelineEditor.agent.operationCount', { count: operations.length })}</span>
          {currentRevision ? <span className={cn('truncate')} title={currentRevision}>{t('timelineEditor.agent.revision', { revision: currentRevision.slice(0, 10) })}</span> : null}
        </div>
      ) : null}

      {mode === 'preview' && !isPreviewValid ? (
        <div className={cn('text-caption text-workbench-danger')} role="alert">{resultMessage(result) || t('timelineEditor.agent.previewFailedDetail')}</div>
      ) : null}
      {isApplyFailure ? (
        <div className={cn('text-caption text-workbench-danger')} role="alert">{applied?.message || t('timelineEditor.agent.applyFailedDetail')}</div>
      ) : null}

      {operations.length > 0 ? (
        <div className={cn('border-t border-nomi-line-soft pt-2')}>
          <button
            type="button"
            className={cn('inline-flex items-center gap-1 border-0 bg-transparent p-0 text-caption text-nomi-ink-60 hover:text-nomi-ink cursor-pointer')}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? <IconChevronDown size={13} stroke={1.8} /> : <IconChevronRight size={13} stroke={1.8} />}
            {t('timelineEditor.agent.viewOperations')}
          </button>
          {detailsOpen ? <div className={cn('mt-2')}>{operationRows(operations, t)}</div> : null}
        </div>
      ) : null}

      {mode === 'pending' && call ? (
        <div className={cn('flex flex-wrap items-center justify-end gap-2 pt-1')}>
          <WorkbenchButton variant="default" size="sm" onClick={() => onReject?.(call.toolCallId)}>
            {t('timelineEditor.agent.reject')}
          </WorkbenchButton>
          <WorkbenchButton variant="primary" size="sm" data-timeline-edit-plan-confirm="true" onClick={() => onApprove?.(call.toolCallId)}>
            {isUndoCall ? t('timelineEditor.agent.confirmUndo') : t('timelineEditor.agent.apply')}
          </WorkbenchButton>
        </div>
      ) : null}
      {mode === 'applied' && applied?.status === 'applied' && applied.undoToken ? (
        <div className={cn('flex items-center justify-end pt-1')}>
          <WorkbenchButton variant="default" size="sm" data-timeline-edit-plan-undo="true" onClick={onUndo}>
            {t('timelineEditor.agent.undo')}
          </WorkbenchButton>
        </div>
      ) : null}
    </section>
  )
}

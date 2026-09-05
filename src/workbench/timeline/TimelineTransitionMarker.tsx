import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCut, IconLayersSubtract, IconReplace, IconSun, IconWaveSine } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { frameToPixel } from './timelineEdit'
import type { TimelineTransitionFeedback, TimelineTransitionFeedbackReason } from './timelineVisualFeedback'
import { TimelineTransitionPicker } from './TimelineTransitionPicker'

type TimelineTransitionMarkerProps = {
  feedback: TimelineTransitionFeedback
  fps: number
  scale: number
  stackRow?: number
}

function transitionIcon(type: TimelineTransitionFeedback['transition']['type']): JSX.Element {
  const props = { size: 11, stroke: 1.5 }
  if (type === 'cut') return <IconCut {...props} />
  if (type === 'dissolve') return <IconLayersSubtract {...props} />
  if (type === 'fade') return <IconSun {...props} />
  if (type === 'match_cut') return <IconReplace {...props} />
  return <IconWaveSine {...props} />
}

function reasonKey(reason: TimelineTransitionFeedbackReason): string {
  return `timelineEditor.transition.reasons.${reason}`
}

function TimelineTransitionMarker({ feedback, fps, scale, stackRow = 0 }: TimelineTransitionMarkerProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const type = feedback.transition.type
  const typeLabel = t(`timelineEditor.transition.types.${type}`)
  const durationLabel =
    feedback.durationFrames === null
      ? t('timelineEditor.transition.durationUnknown')
      : t('timelineEditor.transition.durationFrames', { count: feedback.durationFrames })
  const durationSeconds =
    feedback.durationFrames === null ? null : (feedback.durationFrames / Math.max(1, fps)).toFixed(2)
  const statusLabel = feedback.reason
    ? t(reasonKey(feedback.reason))
    : t('timelineEditor.transition.previewAndExportReady')
  const accessibleLabel = t('timelineEditor.transition.details', {
    type: typeLabel,
    duration:
      durationSeconds === null
        ? durationLabel
        : t('timelineEditor.transition.durationWithSeconds', {
            frames: feedback.durationFrames,
            seconds: durationSeconds,
          }),
    status: statusLabel,
  })

  return (
    <span
      className={cn(
        'workbench-timeline-transition',
        'absolute z-[4] inline-flex h-5 -translate-x-1/2 items-center pointer-events-auto',
        feedback.exportSupported ? 'text-[var(--workbench-accent)]' : 'text-[var(--nomi-warning)]',
      )}
      style={{ left: frameToPixel(feedback.boundaryFrame, scale), top: stackRow * 20 }}
    >
      <span className={cn('h-px w-2', feedback.connected ? 'bg-current' : 'border-t border-dashed border-current')} aria-hidden="true" />
      <button
        type="button"
        className="inline-flex cursor-pointer items-center rounded-[var(--nomi-radius-sm)] border-0 bg-transparent p-0 text-inherit hover:outline hover:outline-1 hover:outline-current"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        data-timeline-transition="true"
        data-transition-from={feedback.transition.fromClipId}
        data-transition-to={feedback.transition.toClipId}
        data-transition-type={type}
        data-connected={feedback.connected ? 'true' : 'false'}
        data-supported={feedback.exportSupported ? 'true' : 'false'}
        data-preview-supported={feedback.previewSupported ? 'true' : 'false'}
        data-export-supported={feedback.exportSupported ? 'true' : 'false'}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
      >
        <span
          className={cn(
            'inline-flex h-5 min-w-8 items-center justify-center gap-0.5 px-1',
            'rounded-[var(--nomi-radius-sm)] border bg-[var(--nomi-paper)] shadow-[var(--nomi-shadow-sm)]',
            feedback.exportSupported
              ? 'border-[color-mix(in_oklch,var(--workbench-accent)_42%,transparent)]'
              : 'border-[color-mix(in_oklch,var(--nomi-warning)_58%,transparent)] bg-[color-mix(in_oklch,var(--nomi-warning)_10%,var(--nomi-paper))]',
          )}
        >
          <span className="flex-none" aria-hidden="true">{transitionIcon(type)}</span>
          <span className="font-mono text-micro font-semibold leading-none tabular-nums">{durationLabel}</span>
        </span>
      </button>
      <span
        className={cn('h-px w-2', feedback.connected ? 'bg-current' : 'border-t border-dashed border-current')}
        aria-hidden="true"
      />
      {open ? <TimelineTransitionPicker feedback={feedback} fps={fps} onClose={() => setOpen(false)} /> : null}
    </span>
  )
}

export default React.memo(TimelineTransitionMarker)

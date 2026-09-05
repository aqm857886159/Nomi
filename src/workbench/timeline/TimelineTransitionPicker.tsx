import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconTrash, IconX } from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import type { TimelineTransitionType } from './timelineTypes'
import type { TimelineTransitionFeedback } from './timelineVisualFeedback'

const TYPES: TimelineTransitionType[] = ['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan']

export function TimelineTransitionPicker({
  feedback,
  fps,
  onClose,
}: {
  feedback: TimelineTransitionFeedback
  fps: number
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const setTimelineTransition = useWorkbenchStore((state) => state.setTimelineTransition)
  const removeTimelineTransition = useWorkbenchStore((state) => state.removeTimelineTransition)
  const from = useWorkbenchStore((state) => state.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === feedback.transition.fromClipId))
  const to = useWorkbenchStore((state) => state.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === feedback.transition.toClipId))
  const maxFrames = Math.max(1, Math.floor(Math.min((from?.endFrame ?? 1) - (from?.startFrame ?? 0), (to?.endFrame ?? 1) - (to?.startFrame ?? 0)) - 1))
  const currentDuration = feedback.transition.type === 'cut' ? 0 : Math.min(maxFrames, Math.max(1, feedback.durationFrames ?? 15))
  const unsupported = feedback.transition.type === 'match_cut' || feedback.transition.type === 'whip_pan'

  return (
    <div
      className={cn('absolute left-1/2 top-7 z-20 w-64 -translate-x-1/2 p-3', 'rounded-[var(--nomi-radius-lg)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] shadow-[var(--nomi-shadow-lg)]')}
      role="dialog"
      aria-label={t('timelineEditor.transition.pickerTitle')}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-micro font-semibold">{t('timelineEditor.transition.pickerTitle')}</strong>
        <button type="button" className="text-[var(--workbench-muted)]" aria-label={t('timelineEditor.transition.close')} onClick={onClose}><IconX size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={cn('flex items-center justify-between rounded-[var(--nomi-radius-sm)] px-2 py-1.5 text-left text-micro hover:bg-[var(--workbench-hover)]', type === feedback.transition.type && 'bg-[var(--workbench-accent-soft)] text-[var(--workbench-accent)]')}
            onClick={() => setTimelineTransition({ ...feedback.transition, type, ...(type === 'cut' ? {} : { durationFrames: Math.min(maxFrames, Math.max(1, currentDuration)) }) })}
          >
            {t(`timelineEditor.transition.types.${type}`)}
            {type === feedback.transition.type ? <IconCheck size={13} /> : null}
          </button>
        ))}
      </div>
      {unsupported ? <p className="mt-2 text-micro text-[var(--nomi-warning)]">{t('timelineEditor.transition.unsupportedNotice')}</p> : null}
      {feedback.transition.type !== 'cut' ? (
        <label className="mt-3 flex items-center justify-between gap-2 text-micro">
          {t('timelineEditor.transition.durationLabel')}
          <span className="inline-flex items-center gap-1">
            <button type="button" className="h-6 w-6 rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)]" onClick={() => setTimelineTransition({ ...feedback.transition, durationFrames: Math.max(1, currentDuration - 1) })}>−</button>
            <output className="min-w-10 text-center font-mono tabular-nums">{t('timelineEditor.transition.durationFrames', { count: currentDuration })}</output>
            <button type="button" className="h-6 w-6 rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)]" onClick={() => setTimelineTransition({ ...feedback.transition, durationFrames: Math.min(maxFrames, currentDuration + 1) })}>+</button>
          </span>
        </label>
      ) : null}
      <button type="button" className="mt-3 inline-flex items-center gap-1 text-micro text-[var(--workbench-danger)]" onClick={() => { removeTimelineTransition(feedback.transition.fromClipId, feedback.transition.toClipId); onClose() }}>
        <IconTrash size={13} />{t('timelineEditor.transition.remove')}
      </button>
      <span className="sr-only">{t('timelineEditor.transition.fpsHint', { fps })}</span>
    </div>
  )
}

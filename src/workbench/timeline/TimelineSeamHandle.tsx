import React from 'react'
import { IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { frameToPixel } from './timelineEdit'
import { DEFAULT_TRANSITION_FRAMES } from './timelineTransition'
import { resolveTimelineTransitionFeedback } from './timelineVisualFeedback'
import type { TimelineClip, TimelineTrack } from './timelineTypes'

function reasonLabel(t: (key: string) => string, reason: NonNullable<ReturnType<typeof resolveTimelineTransitionFeedback>[number]['reason']>): string {
  switch (reason) {
    case 'missing_endpoint': return t('timelineEditor.transition.reasons.missing_endpoint')
    case 'non_visual': return t('timelineEditor.transition.reasons.non_visual')
    case 'different_track': return t('timelineEditor.transition.reasons.different_track')
    case 'wrong_order': return t('timelineEditor.transition.reasons.wrong_order')
    case 'not_adjacent': return t('timelineEditor.transition.reasons.not_adjacent')
    case 'not_contiguous': return t('timelineEditor.transition.reasons.not_contiguous')
    case 'invalid_duration': return t('timelineEditor.transition.reasons.invalid_duration')
    case 'duplicate_connection': return t('timelineEditor.transition.reasons.duplicate_connection')
    case 'unsupported_type': return t('timelineEditor.transition.reasons.unsupported_type')
  }
}

export default function TimelineSeamHandle({
  track,
  from,
  to,
  scale,
}: {
  track: TimelineTrack
  from: TimelineClip
  to: TimelineClip
  scale: number
}): JSX.Element {
  const { t } = useTranslation()
  const setTimelineTransition = useWorkbenchStore((state) => state.setTimelineTransition)
  const transitions = useWorkbenchStore((state) => state.timeline.transitions ?? [])
  const candidate = React.useMemo(() => ({ fromClipId: from.id, toClipId: to.id, type: 'dissolve' as const, durationFrames: DEFAULT_TRANSITION_FRAMES }), [from.id, to.id])
  const feedback = React.useMemo(() => resolveTimelineTransitionFeedback([track], [...transitions.filter((item) => item.fromClipId !== from.id || item.toClipId !== to.id), candidate])[0], [candidate, from.id, to.id, track, transitions])
  const reason = feedback?.reason ? reasonLabel(t, feedback.reason) : ''
  const disabled = Boolean(feedback?.reason)
  return (
    <button
      type="button"
      className={cn('absolute z-[5] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed p-0.5', 'top-1/2 h-5 w-5 bg-[var(--nomi-paper)] text-[var(--workbench-accent)] transition-opacity', disabled ? 'cursor-not-allowed opacity-35' : 'opacity-0 hover:opacity-100 focus-visible:opacity-100 hover:border-[var(--workbench-accent)]')}
      style={{ left: frameToPixel(from.endFrame, scale) }}
      aria-label={disabled ? reason : t('timelineEditor.transition.addDefault')}
      title={disabled ? reason : t('timelineEditor.transition.addDefault')}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); setTimelineTransition(candidate) }}
    >
      <IconPlus size={13} stroke={1.8} />
    </button>
  )
}

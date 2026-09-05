import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconTrash, IconX } from '@tabler/icons-react'
import { AnchoredPopover } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import type { TimelineTransitionType } from './timelineTypes'
import type { TimelineTransitionFeedback } from './timelineVisualFeedback'

const TYPES: TimelineTransitionType[] = ['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan']

/**
 * 转场选择器。**必须走 AnchoredPopover（Portal 到 body）**，不许改回原地 absolute：
 * 它挂在接缝标记上，而标记住在轨道格 `.workbench-timeline-track__clips` 里——那一格是
 * `overflow-hidden`，原地定位会把选择器裁成「时长 − 12f +」一条边，五个类型和「删除转场」
 * 全部露不出来也点不到（2026-09-06 真机撞上；49 个采样点只命中 7 个）。
 * 走查判据在 tests/ux/_assert.mjs 的 expectOverlayReachable，别只断言 toBeVisible。
 */
export function TimelineTransitionPicker({
  feedback,
  fps,
  anchorRef,
  onClose,
}: {
  feedback: TimelineTransitionFeedback
  fps: number
  /** 贴哪儿：接缝标记那颗按钮。 */
  anchorRef: React.RefObject<HTMLElement | null>
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
    <AnchoredPopover anchorRef={anchorRef} align="center" gap={6} onClose={onClose}>
    <div
      className={cn('w-64 p-3', 'rounded-[var(--nomi-radius-lg)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] shadow-[var(--nomi-shadow-lg)]')}
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
        /* 这一行是 <div> 不是 <label>：里面有两颗按钮、没有输入框，<label> 会把自己的
           文本挂到第一个可标注后代上——实测「−」这颗按钮的无障碍名变成了「时长 +」
           （标签文本减去它自己的字），读屏念出来就是错的。步进钮各自写明自己干什么。 */
        <div className="mt-3 flex items-center justify-between gap-2 text-micro">
          <span>{t('timelineEditor.transition.durationLabel')}</span>
          <span className="inline-flex items-center gap-1">
            <button type="button" aria-label={t('timelineEditor.transition.durationShorter')} title={t('timelineEditor.transition.durationShorter')} className="h-6 w-6 rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)]" onClick={() => setTimelineTransition({ ...feedback.transition, durationFrames: Math.max(1, currentDuration - 1) })}>−</button>
            <output aria-label={t('timelineEditor.transition.durationLabel')} className="min-w-10 text-center font-mono tabular-nums">{t('timelineEditor.transition.durationFrames', { count: currentDuration })}</output>
            <button type="button" aria-label={t('timelineEditor.transition.durationLonger')} title={t('timelineEditor.transition.durationLonger')} className="h-6 w-6 rounded-[var(--nomi-radius-sm)] border border-[var(--workbench-border)]" onClick={() => setTimelineTransition({ ...feedback.transition, durationFrames: Math.min(maxFrames, currentDuration + 1) })}>+</button>
          </span>
        </div>
      ) : null}
      <button type="button" className="mt-3 inline-flex items-center gap-1 text-micro text-[var(--workbench-danger)]" onClick={() => { removeTimelineTransition(feedback.transition.fromClipId, feedback.transition.toClipId); onClose() }}>
        <IconTrash size={13} />{t('timelineEditor.transition.remove')}
      </button>
      <span className="sr-only">{t('timelineEditor.transition.fpsHint', { fps })}</span>
    </div>
    </AnchoredPopover>
  )
}

import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconTransitionLeft, IconTransitionRight } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import { DEFAULT_TRANSITION_FRAMES } from '../../timeline/timelineTransition'
import { openTimelineTransitionPicker } from '../../timeline/openTransitionPicker'
import type { TimelineClip, TimelineState } from '../../timeline/timelineTypes'

/**
 * 属性面板的「转场 · 入 / 出」两行（合同 §2.3 + §2.4）。
 *
 * 上一版这两颗按钮写的是 `onClick={() => undefined}`——画得像能点，点下去什么都不发生，
 * 正是设计系统 C1「可点即有效，否则禁用并说明为什么」要治的那一类。
 *
 * 现在它们是真入口，语义与接缝上的「+」把手完全一致（同一个 setTimelineTransition，
 * 同一个 picker）：
 *  · 这一头没有相邻片段 → 按钮 disabled，title 写清「缺少接缝端点」；
 *  · 这条接缝还没有转场 → 点一下落默认叠化 15 帧，跟悬停接缝点「+」是同一件事；
 *  · 已经有转场 → 按钮上显示它现在是什么、多长，点开时间轴上那一个选择器改类型 / 时长 / 删除。
 * 属性面板不自带第二份 picker：接缝是转场的宿主，选择器只有那一份（P1）。
 */
function neighbours(timeline: TimelineState, clip: TimelineClip): { previous: TimelineClip | null; next: TimelineClip | null } {
  const track = timeline.tracks.find((candidate) => candidate.clips.some((item) => item.id === clip.id))
  const ordered = [...(track?.clips ?? [])].sort((a, b) => a.startFrame - b.startFrame)
  const index = ordered.findIndex((item) => item.id === clip.id)
  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  }
}

function TransitionRow({
  edge,
  clip,
  neighbour,
  timeline,
}: {
  edge: 'in' | 'out'
  clip: TimelineClip
  neighbour: TimelineClip | null
  timeline: TimelineState
}): JSX.Element {
  const { t } = useTranslation()
  const setTimelineTransition = useWorkbenchStore((state) => state.setTimelineTransition)
  const fromClipId = edge === 'in' ? neighbour?.id ?? '' : clip.id
  const toClipId = edge === 'in' ? clip.id : neighbour?.id ?? ''
  const existing = (timeline.transitions ?? []).find((item) => item.fromClipId === fromClipId && item.toClipId === toClipId)
  const label = edge === 'in' ? t('timelinePreview.previewInspector.transitionIn') : t('timelinePreview.previewInspector.transitionOut')
  const missing = !neighbour
  const frames = existing?.durationFrames ?? DEFAULT_TRANSITION_FRAMES
  const text = existing
    ? `${t(`timelineEditor.transition.types.${existing.type}`)} · ${t('timelineEditor.transition.durationFrames', { count: frames })}`
    : t('timelinePreview.previewInspector.addTransition')
  const title = missing
    ? t('timelineEditor.transition.reasons.missing_endpoint')
    : existing
      ? t('timelinePreview.previewInspector.changeTransition')
      : t('timelineEditor.transition.addDefault')
  return (
    <label className="flex items-center justify-between gap-2 text-caption text-[var(--workbench-muted)]">
      <span>{label}</span>
      <WorkbenchButton
        className="h-7 min-w-0 px-2 text-micro"
        title={title}
        aria-label={`${label} · ${title}`}
        disabled={missing}
        data-inspector-transition={edge}
        data-inspector-transition-state={missing ? 'unavailable' : existing ? 'connected' : 'empty'}
        onClick={() => {
          if (missing) return
          if (existing) openTimelineTransitionPicker(fromClipId, toClipId)
          else setTimelineTransition({ fromClipId, toClipId, type: 'dissolve', durationFrames: DEFAULT_TRANSITION_FRAMES })
        }}
      >
        {edge === 'in' ? <IconTransitionLeft size={14} /> : <IconTransitionRight size={14} />}
        <span className="truncate">{text}</span>
      </WorkbenchButton>
    </label>
  )
}

export function ClipTransitionFields({ clip, timeline }: { clip: TimelineClip; timeline: TimelineState }): JSX.Element {
  const { previous, next } = neighbours(timeline, clip)
  return <>
    <TransitionRow edge="in" clip={clip} neighbour={previous} timeline={timeline} />
    <TransitionRow edge="out" clip={clip} neighbour={next} timeline={timeline} />
  </>
}

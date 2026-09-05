import React from 'react'
import { TimelineSelectionChip } from './TimelineSelectionChip'
import type { TimelineSelectionProjection } from './timelineAgentSurface'
import { timelineTimecode } from '../../timeline/timelineTimecode'

/** 轨道 id → i18n key。文字轨不在 tracks[] 里，它自己一条。 */
const TRACK_LABEL_KEY: Readonly<Record<string, string>> = {
  imageTrack: 'timelineEditor.track.imageLabel',
  videoTrack: 'timelineEditor.track.videoLabel',
  audioTrack: 'timelineEditor.track.audioLabel',
  textTrack: 'timelineEditor.textTrack.title',
}

/** 片段名：媒体片段用它在轨道上显示的 label，字幕用它自己的文字。两者都可能为空。 */
function selectionName(clip: TimelineSelectionProjection['clip'], fallback: string): string {
  const named = 'label' in clip ? clip.label : ''
  const text = 'text' in clip && typeof clip.text === 'string' ? clip.text : ''
  return (named || text || '').trim() || fallback
}

export function TimelineSelectionChips({
  selections,
  revisionFor,
  staleFor,
  fps,
  label,
  staleLabel,
  removeLabel,
  unnamedLabel,
  t,
}: {
  selections: readonly TimelineSelectionProjection[]
  /** 这条 chip 被选中那一刻，它指的那一段是什么版本（工程串，进 tooltip / data-*）。 */
  revisionFor: (id: string) => string
  /** 那一段**自己**变了没有——不是整条时间轴变了没有。 */
  staleFor: (id: string) => boolean
  fps: number
  label: string
  staleLabel: string
  removeLabel: string
  /** 片段没名字时的兜底短语（「这一段」），不要退回打印 clipId。 */
  unnamedLabel: string
  t: (key: string) => string
}): JSX.Element {
  return <>{selections.map(({ clip, trackId }) => {
    const trackKey = TRACK_LABEL_KEY[trackId]
    return <TimelineSelectionChip
      key={`timeline-selection:${clip.id}`}
      clipId={clip.id}
      trackId={trackId}
      trackLabel={trackKey ? t(trackKey) : trackId}
      name={selectionName(clip, unnamedLabel)}
      timeRange={`${timelineTimecode(clip.startFrame, fps)}–${timelineTimecode(clip.endFrame, fps)}`}
      startFrame={clip.startFrame}
      endFrame={clip.endFrame}
      revision={revisionFor(clip.id)}
      stale={staleFor(clip.id)}
      staleLabel={staleLabel}
      label={label}
      removeLabel={removeLabel}
    />
  })}</>
}

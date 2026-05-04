import React from 'react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCopy,
  IconCut,
  IconMinus,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { WorkbenchIconButton } from '../../design'
import { computeTimelineDuration } from './timelineMath'
import TimelineTrack from './TimelineTrack'
import { frameToPixel, pixelToFrame } from './timelineEdit'

function formatRulerLabel(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function resolveTimelineRulerStep(fps: number, scale: number): number {
  const pixelsPerSecond = frameToPixel(fps, scale)
  if (pixelsPerSecond < 36) return fps * 10
  if (pixelsPerSecond < 72) return fps * 5
  if (pixelsPerSecond < 132) return fps * 2
  return fps
}

function resolveTimelineRulerEndFrame(params: {
  durationFrame: number
  playheadFrame: number
  fps: number
}): number {
  const fps = Math.max(1, params.fps)
  const minEditableFrame = fps * 120
  const trailingFrame = fps * 60
  return Math.max(
    minEditableFrame,
    params.durationFrame + trailingFrame,
    params.playheadFrame + trailingFrame,
  )
}

function buildTimelineRulerTicks(endFrame: number, fps: number, scale: number): Array<{ frame: number; label: string }> {
  const maxFrame = Math.max(0, endFrame)
  const step = resolveTimelineRulerStep(fps, scale)
  const ticks: Array<{ frame: number; label: string }> = []
  for (let frame = 0; frame <= maxFrame && ticks.length < 360; frame += step) {
    ticks.push({ frame, label: formatRulerLabel(frame, fps) })
  }
  return ticks
}

type TimelinePanelProps = {
  density?: 'compact' | 'full'
}

export default function TimelinePanel({ density = 'compact' }: TimelinePanelProps): JSX.Element {
  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectedClipId = useWorkbenchStore((state) => state.selectedTimelineClipId)
  const duplicateTimelineClip = useWorkbenchStore((state) => state.duplicateTimelineClip)
  const nudgeTimelineClip = useWorkbenchStore((state) => state.nudgeTimelineClip)
  const removeTimelineClip = useWorkbenchStore((state) => state.removeTimelineClip)
  const setTimelineZoom = useWorkbenchStore((state) => state.setTimelineZoom)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const splitTimelineClip = useWorkbenchStore((state) => state.splitTimelineClip)
  const durationFrame = computeTimelineDuration(timeline)
  const rulerEndFrame = React.useMemo(
    () => resolveTimelineRulerEndFrame({
      durationFrame,
      playheadFrame: timeline.playheadFrame,
      fps: timeline.fps,
    }),
    [durationFrame, timeline.fps, timeline.playheadFrame],
  )
  const rulerTicks = React.useMemo(
    () => buildTimelineRulerTicks(rulerEndFrame, timeline.fps, timeline.scale),
    [rulerEndFrame, timeline.fps, timeline.scale],
  )
  const minScrollableWidth = 2400
  const rulerWidth = Math.max(frameToPixel(rulerEndFrame, timeline.scale), minScrollableWidth)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        setTimelinePlayhead(timeline.playheadFrame + (event.key === 'ArrowLeft' ? -1 : 1))
        return
      }
      if (!selectedClipId) return
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        removeTimelineClip(selectedClipId)
        return
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        splitTimelineClip(selectedClipId, timeline.playheadFrame)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateTimelineClip(selectedClipId)
        return
      }
      if (event.shiftKey && (event.key === '<' || event.key === '>')) {
        event.preventDefault()
        nudgeTimelineClip(selectedClipId, event.key === '<' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    duplicateTimelineClip,
    nudgeTimelineClip,
    removeTimelineClip,
    selectedClipId,
    setTimelinePlayhead,
    splitTimelineClip,
    timeline.playheadFrame,
  ])

  const handleRulerClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const nextFrame = pixelToFrame(event.clientX - rect.left, timeline.scale)
    setTimelinePlayhead(nextFrame)
  }, [setTimelinePlayhead, timeline.scale])

  return (
    <section
      className="workbench-timeline"
      data-density={density}
      aria-label="时间轴"
      style={{ '--workbench-timeline-content-width': `${rulerWidth}px` } as React.CSSProperties}
    >
      <div className="workbench-timeline__controls">
        <div className="workbench-timeline__right">
          {selectedClipId ? (
            <div className="workbench-timeline__clip-tools" aria-label="选中片段操作">
              <WorkbenchIconButton className="workbench-timeline__tool" label="向前微调片段" icon={<IconArrowLeft size={14} />} onClick={() => nudgeTimelineClip(selectedClipId, -1)} />
              <WorkbenchIconButton className="workbench-timeline__tool" label="分割片段" icon={<IconCut size={14} />} onClick={() => splitTimelineClip(selectedClipId, timeline.playheadFrame)} />
              <WorkbenchIconButton className="workbench-timeline__tool" label="复制片段" icon={<IconCopy size={14} />} onClick={() => duplicateTimelineClip(selectedClipId)} />
              <WorkbenchIconButton className="workbench-timeline__tool" label="向后微调片段" icon={<IconArrowRight size={14} />} onClick={() => nudgeTimelineClip(selectedClipId, 1)} />
            </div>
          ) : null}
          <WorkbenchIconButton className="workbench-timeline__tool" label="缩小时间轴" icon={<IconMinus size={14} />} onClick={() => setTimelineZoom(timeline.scale / 1.25)} />
          <WorkbenchIconButton className="workbench-timeline__tool" label="放大时间轴" icon={<IconPlus size={14} />} onClick={() => setTimelineZoom(timeline.scale * 1.25)} />
          <WorkbenchIconButton className="workbench-timeline__tool" label="删除选中片段" icon={<IconTrash size={14} />} disabled={!selectedClipId} onClick={() => removeTimelineClip(selectedClipId)} />
        </div>
      </div>
      <div className="workbench-timeline__tracks">
        <div className="workbench-timeline__ruler">
          <div className="workbench-timeline__ruler-spacer" aria-hidden="true" />
          <div
            className="workbench-timeline__ruler-content"
            aria-label="时间刻度"
            onClick={handleRulerClick}
          >
            {rulerTicks.map((tick) => (
              <span
                key={tick.frame}
                className="workbench-timeline__ruler-tick"
                data-origin={tick.frame === 0 ? 'true' : 'false'}
                style={{ transform: `translateX(${frameToPixel(tick.frame, timeline.scale)}px)` }}
              >
                <span className="workbench-timeline__ruler-label">{tick.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div
          className="workbench-timeline__playhead"
          style={{ transform: `translateX(${frameToPixel(timeline.playheadFrame, timeline.scale)}px)` }}
          aria-hidden="true"
        />
        {timeline.tracks.map((track) => (
          <TimelineTrack key={track.id} track={track} />
        ))}
      </div>
    </section>
  )
}

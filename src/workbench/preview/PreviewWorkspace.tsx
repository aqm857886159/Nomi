import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import TimelinePanel from '../timeline/TimelinePanel'
import { computeTimelineDuration, resolveActiveClipsAtFrame } from '../timeline/timelineMath'
import TimelinePreview from './TimelinePreview'

function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.floor(frame / fps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const frames = frame % fps
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

export default function PreviewWorkspace(): JSX.Element {
  const { t } = useTranslation()
  const timeline = useWorkbenchStore((state) => state.timeline)
  const tracks = useWorkbenchStore((state) => state.timeline.tracks)
  // 文字 clip 也计入时长（片尾标题卡/字幕，见 computeTimelineDuration）：必须订阅它，
  // 否则只 deps [tracks] 的 memo 在改文字轨后不重算，时长/播放区间会停在旧值。
  const textClips = useWorkbenchStore((state) => state.timeline.textClips)
  const playheadFrame = useWorkbenchStore((state) => state.timeline.playheadFrame)
  const playing = useWorkbenchStore((state) => state.timelinePlaying)
  const previewAspectRatio = useWorkbenchStore((state) => state.previewAspectRatio)
  const setTimelinePlaying = useWorkbenchStore((state) => state.setTimelinePlaying)
  const durationFrame = React.useMemo(() => computeTimelineDuration(timeline), [tracks, textClips])
  // activeClips 只取媒体轨当前帧（文字层另由 TimelinePreview 单算），故仅依赖 tracks/playhead；
  // textClips 不影响这里的结果，无需进 deps。
  const activeClips = React.useMemo(() => resolveActiveClipsAtFrame(timeline, playheadFrame), [tracks, playheadFrame])

  // 播放推进：用 requestAnimationFrame 按真实墙钟时间推进 playhead，
  // 取代旧的 setInterval(1000/fps) 固定步长 —— 后者会因定时器节流/步长误差与
  // 实际经过时间漂移。这里用 fractional-frame 累加器，从「当前 playhead」实时续推
  // （支持播放中 scrub），不再固定 +1。
  React.useEffect(() => {
    if (!playing) return
    if (durationFrame <= 0) {
      setTimelinePlaying(false)
      return
    }
    const fpsNow = Math.max(1, useWorkbenchStore.getState().timeline.fps)
    let lastNow = performance.now()
    let fractionalFrames = 0
    let rafId = 0
    const tick = (now: number) => {
      fractionalFrames += ((now - lastNow) / 1000) * fpsNow
      lastNow = now
      const wholeFrames = Math.floor(fractionalFrames)
      if (wholeFrames > 0) {
        fractionalFrames -= wholeFrames
        const current = useWorkbenchStore.getState().timeline.playheadFrame
        const nextFrame = current + wholeFrames
        if (nextFrame >= durationFrame) {
          useWorkbenchStore.getState().setTimelinePlayhead(durationFrame)
          useWorkbenchStore.getState().setTimelinePlaying(false)
          return
        }
        useWorkbenchStore.getState().setTimelinePlayhead(nextFrame)
      }
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [durationFrame, playing, setTimelinePlaying])

  return (
    <section
      className={cn(
        'workbench-preview',
        'w-full h-full min-w-0 min-h-0 grid grid-rows-[minmax(0,1fr)_var(--workbench-preview-timeline-height)]',
        'overflow-hidden bg-[var(--workbench-bg)]',
      )}
      aria-label={t('workspace.preview')}
    >
      <TimelinePreview
        activeClips={activeClips}
        aspectRatio={previewAspectRatio}
        fps={timeline.fps}
        playheadFrame={timeline.playheadFrame}
        timeline={timeline}
      />
      <TimelinePanel
        density="full"
        regionLabel={t('timelinePreview.timelineRegion')}
        actionLabelPrefix={t('timelinePreview.timelineActionPrefix')}
        showTextTrack
      />
    </section>
  )
}

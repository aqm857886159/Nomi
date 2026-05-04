import React from 'react'
import { useWorkbenchStore } from '../workbenchStore'
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
  const timeline = useWorkbenchStore((state) => state.timeline)
  const playing = useWorkbenchStore((state) => state.timelinePlaying)
  const previewAspectRatio = useWorkbenchStore((state) => state.previewAspectRatio)
  const setTimelinePlaying = useWorkbenchStore((state) => state.setTimelinePlaying)
  const durationFrame = computeTimelineDuration(timeline)
  const activeClips = React.useMemo(
    () => resolveActiveClipsAtFrame(timeline, timeline.playheadFrame),
    [timeline],
  )

  React.useEffect(() => {
    if (!playing) return
    if (durationFrame <= 0) {
      setTimelinePlaying(false)
      return
    }
    const interval = window.setInterval(() => {
      const current = useWorkbenchStore.getState().timeline
      const nextFrame = current.playheadFrame + 1
      if (nextFrame >= durationFrame) {
        useWorkbenchStore.getState().setTimelinePlayhead(durationFrame)
        useWorkbenchStore.getState().setTimelinePlaying(false)
        return
      }
      useWorkbenchStore.getState().setTimelinePlayhead(nextFrame)
    }, 1000 / timeline.fps)
    return () => window.clearInterval(interval)
  }, [durationFrame, playing, setTimelinePlaying, timeline.fps])

  return (
    <section className="workbench-preview" aria-label="预览区">
      <TimelinePreview
        activeClips={activeClips}
        aspectRatio={previewAspectRatio}
        fps={timeline.fps}
        playheadFrame={timeline.playheadFrame}
        timeline={timeline}
      />
      <TimelinePanel density="full" />
    </section>
  )
}

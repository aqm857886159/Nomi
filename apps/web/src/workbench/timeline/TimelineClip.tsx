import React from 'react'
import { WorkbenchButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'
import { canPlaceClip, frameToPixel, withClipStartFrame } from './timelineEdit'
import type { TimelineClip as TimelineClipData } from './timelineTypes'
import { buildVideoPlaybackUrl } from '../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../media/videoPlaybackDiagnostics'

type TimelineClipProps = {
  clip: TimelineClipData
}

export default function TimelineClip({ clip }: TimelineClipProps): JSX.Element {
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  const selectedClipId = useWorkbenchStore((state) => state.selectedTimelineClipId)
  const selectTimelineClip = useWorkbenchStore((state) => state.selectTimelineClip)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const resizeTimelineClip = useWorkbenchStore((state) => state.resizeTimelineClip)
  const moveTimelineClip = useWorkbenchStore((state) => state.moveTimelineClip)
  const track = useWorkbenchStore((state) => state.timeline.tracks.find((t) => t.clips.some((c) => c.id === clip.id)))

  const [dragDeltaPixels, setDragDeltaPixels] = React.useState<number | null>(null)

  const title = clip.label || clip.text || clip.sourceNodeId
  const showVideoThumb = clip.type === 'video' && !clip.thumbnailUrl && Boolean(clip.url)
  const hasVisualThumb = Boolean(clip.thumbnailUrl) || showVideoThumb
  const clipVideoUrl = typeof clip.url === 'string' ? clip.url : ''

  const beginResize = React.useCallback((event: React.PointerEvent<HTMLButtonElement>, edge: 'left' | 'right') => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const pointerId = event.pointerId
    const target = event.currentTarget
    let appliedDeltaFrame = 0
    target.setPointerCapture(pointerId)
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaFrame = Math.round((moveEvent.clientX - startX) / scale)
      const incrementalDelta = deltaFrame - appliedDeltaFrame
      if (incrementalDelta === 0) return
      appliedDeltaFrame = deltaFrame
      resizeTimelineClip(clip.id, edge, incrementalDelta)
    }
    const handlePointerUp = () => {
      target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [clip.id, resizeTimelineClip, scale])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Don't start drag if clicking on a resize handle
    if ((event.target as HTMLElement).closest('.workbench-timeline-clip__handle')) return
    event.preventDefault()
    const startX = event.clientX
    const pointerId = event.pointerId
    const target = event.currentTarget
    target.setPointerCapture(pointerId)
    let currentDelta = 0

    const handlePointerMove = (moveEvent: PointerEvent) => {
      currentDelta = moveEvent.clientX - startX
      setDragDeltaPixels(currentDelta)
    }
    const handlePointerUp = () => {
      target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      const deltaFrame = Math.round(currentDelta / scale)
      const targetFrame = Math.max(0, clip.startFrame + deltaFrame)
      moveTimelineClip(clip.id, targetFrame)
      setDragDeltaPixels(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [clip.id, clip.startFrame, moveTimelineClip, scale])

  const isDragging = dragDeltaPixels !== null
  const ghostDeltaPixels = dragDeltaPixels ?? 0
  const ghostFrame = Math.max(0, clip.startFrame + Math.round(ghostDeltaPixels / scale))
  const hasCollision = isDragging && track != null && !canPlaceClip(track, withClipStartFrame(clip, ghostFrame))

  const clipWidth = Math.max(36, frameToPixel(clip.frameCount, scale))

  const thumbContent = clip.thumbnailUrl ? (
    <img className="workbench-timeline-clip__thumb" src={clip.thumbnailUrl} alt="" draggable={false} />
  ) : showVideoThumb && clipVideoUrl ? (
    <video
      className="workbench-timeline-clip__thumb"
      src={buildVideoPlaybackUrl(clipVideoUrl)}
      crossOrigin="use-credentials"
      muted
      playsInline
      preload="metadata"
      draggable={false}
      onError={(event) => {
        void diagnoseVideoPlaybackFailure(clipVideoUrl, event.currentTarget.error).then(logVideoPlaybackFailure)
      }}
    />
  ) : null

  return (
    <>
      <div
        className="workbench-timeline-clip"
        data-testid="timeline-clip"
        data-clip-type={clip.type}
        title={title}
        data-selected={selectedClipId === clip.id ? 'true' : 'false'}
        style={{
          left: frameToPixel(clip.startFrame, scale),
          width: clipWidth,
          opacity: isDragging ? 0.4 : undefined,
          cursor: isDragging ? 'grabbing' : undefined,
        }}
        onClick={(event) => {
          if (isDragging) return
          event.stopPropagation()
          selectTimelineClip(clip.id)
          setTimelinePlayhead(clip.startFrame)
        }}
        onPointerDown={beginDrag}
      >
        {selectedClipId === clip.id ? (
          <WorkbenchButton
            className="workbench-timeline-clip__handle workbench-timeline-clip__handle--left"
            aria-label="调整片段起点"
            onPointerDown={(event) => beginResize(event, 'left')}
          />
        ) : null}
        {thumbContent}
        {!hasVisualThumb ? <span className="workbench-timeline-clip__label">{title}</span> : null}
        {selectedClipId === clip.id ? (
          <WorkbenchButton
            className="workbench-timeline-clip__handle workbench-timeline-clip__handle--right"
            aria-label="调整片段终点"
            onPointerDown={(event) => beginResize(event, 'right')}
          />
        ) : null}
      </div>
      {isDragging ? (
        <div
          className="workbench-timeline-clip workbench-timeline-clip__ghost"
          data-clip-type={clip.type}
          data-collision={hasCollision ? 'true' : 'false'}
          aria-hidden="true"
          style={{
            left: frameToPixel(clip.startFrame, scale),
            width: clipWidth,
            transform: `translateX(${ghostDeltaPixels}px)`,
            pointerEvents: 'none',
          }}
        >
          {thumbContent}
          {!hasVisualThumb ? <span className="workbench-timeline-clip__label">{title}</span> : null}
        </div>
      ) : null}
    </>
  )
}

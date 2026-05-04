import React from 'react'
import { WorkbenchButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'
import { frameToPixel } from './timelineEdit'
import { encodeTimelineClipDragPayload, TIMELINE_CLIP_DRAG_MIME } from './timelineDragPayload'
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

  return (
    <div
      className="workbench-timeline-clip"
      data-testid="timeline-clip"
      data-clip-type={clip.type}
      title={title}
      draggable
      data-selected={selectedClipId === clip.id ? 'true' : 'false'}
      style={{
        left: frameToPixel(clip.startFrame, scale),
        width: Math.max(36, frameToPixel(clip.frameCount, scale)),
      }}
      onClick={(event) => {
        event.stopPropagation()
        selectTimelineClip(clip.id)
        setTimelinePlayhead(clip.startFrame)
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(TIMELINE_CLIP_DRAG_MIME, encodeTimelineClipDragPayload(clip.id))
      }}
    >
      {selectedClipId === clip.id ? (
        <WorkbenchButton
          className="workbench-timeline-clip__handle workbench-timeline-clip__handle--left"
          aria-label="调整片段起点"
          onPointerDown={(event) => beginResize(event, 'left')}
        />
      ) : null}
      {clip.thumbnailUrl ? (
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
      ) : null}
      {!hasVisualThumb ? <span className="workbench-timeline-clip__label">{title}</span> : null}
      {selectedClipId === clip.id ? (
        <WorkbenchButton
          className="workbench-timeline-clip__handle workbench-timeline-clip__handle--right"
          aria-label="调整片段终点"
          onPointerDown={(event) => beginResize(event, 'right')}
        />
      ) : null}
    </div>
  )
}

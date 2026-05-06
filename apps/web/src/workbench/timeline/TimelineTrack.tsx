import React from 'react'
import { useWorkbenchStore } from '../workbenchStore'
import { buildClipFromGenerationNode } from '../generationCanvasV2/model/buildClipFromGenerationNode'
import { clientXToFrame } from './timelineEdit'
import {
  decodeTimelineGenerationNodeDragPayload,
  TIMELINE_GENERATION_NODE_DRAG_MIME,
} from './timelineDragPayload'
import TimelineClip from './TimelineClip'
import type { TimelineTrack as TimelineTrackData } from './timelineTypes'

type TimelineTrackProps = {
  track: TimelineTrackData
}

export default function TimelineTrack({ track }: TimelineTrackProps): JSX.Element {
  const timeline = useWorkbenchStore((state) => state.timeline)
  const addTimelineClipAtFrame = useWorkbenchStore((state) => state.addTimelineClipAtFrame)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const clipsRef = React.useRef<HTMLDivElement | null>(null)
  const [dragOver, setDragOver] = React.useState(false)

  const resolveFrame = React.useCallback((clientX: number) => {
    const rect = clipsRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clientXToFrame(clientX, rect.left, timeline.scale)
  }, [timeline.scale])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const startFrame = resolveFrame(event.clientX)
    const generationNodePayload = decodeTimelineGenerationNodeDragPayload(event.dataTransfer.getData(TIMELINE_GENERATION_NODE_DRAG_MIME))
    if (generationNodePayload) {
      const clip = buildClipFromGenerationNode(generationNodePayload.node, {
        fps: timeline.fps,
        startFrame,
        resultId: generationNodePayload.resultId,
      })
      if (clip) addTimelineClipAtFrame(clip, clip.type, startFrame)
    }
  }, [addTimelineClipAtFrame, resolveFrame, timeline.fps])

  return (
    <div className="workbench-timeline-track" data-testid="timeline-track" data-track-type={track.type}>
      <div className="workbench-timeline-track__label">
        <span className="workbench-timeline-track__type-dot" aria-hidden="true" />
        <span className="workbench-timeline-track__name">{track.label}</span>
        <span className="workbench-timeline-track__count">{track.clips.length}</span>
      </div>
      <div
        ref={clipsRef}
        className="workbench-timeline-track__clips"
        data-drag-over={dragOver ? 'true' : 'false'}
        onClick={(event) => {
          setTimelinePlayhead(resolveFrame(event.clientX))
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
          setDragOver(false)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={handleDrop}
      >
        {track.clips.length === 0 ? (
          <div className="workbench-timeline-track__empty">+ 拖入或点击添加</div>
        ) : null}
        {track.clips.map((clip) => (
          <TimelineClip key={clip.id} clip={clip} />
        ))}
      </div>
    </div>
  )
}

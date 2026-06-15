import React from 'react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { buildClipFromGenerationNode } from '../generationCanvas/model/buildClipFromGenerationNode'
import { clientXToFrame } from './timelineEdit'
import { buildTimelineDropPreview, type TimelineDropPreview } from './timelineDropFeedback'
import {
  decodeTimelineGenerationNodeDragPayload,
  TIMELINE_GENERATION_NODE_DRAG_MIME,
} from './timelineDragPayload'
import TimelineClip from './TimelineClip'
import type { TimelineTrack as TimelineTrackData } from './timelineTypes'
import { getTrackTypeForClipType } from './timelineTypes'
import { toast } from '../../ui/toast'

type TimelineTrackProps = {
  track: TimelineTrackData
}

export default function TimelineTrack({ track }: TimelineTrackProps): JSX.Element {
  const timeline = useWorkbenchStore((state) => state.timeline)
  const addTimelineClipAtFrame = useWorkbenchStore((state) => state.addTimelineClipAtFrame)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const setTimelineSelection = useWorkbenchStore((state) => state.setTimelineSelection)
  const clipsRef = React.useRef<HTMLDivElement | null>(null)
  const [dragPreview, setDragPreview] = React.useState<TimelineDropPreview | null>(null)
  // v0.7.4: dragenter/over 期间无法 getData → 用单独的 hover state 提供视觉反馈
  const [isDragHovering, setIsDragHovering] = React.useState(false)

  const resolveFrame = React.useCallback((clientX: number) => {
    const rect = clipsRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return clientXToFrame(clientX, rect.left, timeline.scale)
  }, [timeline.scale])

  const resolveDropPreview = React.useCallback((event: React.DragEvent<HTMLDivElement>): TimelineDropPreview | null => {
    const generationNodePayload = decodeTimelineGenerationNodeDragPayload(event.dataTransfer.getData(TIMELINE_GENERATION_NODE_DRAG_MIME))
    if (!generationNodePayload) return null
    const startFrame = resolveFrame(event.clientX)
    const clip = buildClipFromGenerationNode(generationNodePayload.node, {
      fps: timeline.fps,
      startFrame,
      resultId: generationNodePayload.resultId,
    })
    if (!clip) return null
    return buildTimelineDropPreview({
      track,
      clip,
      startFrame,
      scale: timeline.scale,
      fps: timeline.fps,
    })
  }, [resolveFrame, timeline.fps, timeline.scale, track])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const preview = resolveDropPreview(event) || dragPreview
    if (!preview) return
    event.preventDefault()
    setDragPreview(null)
    if (!preview.canPlace) {
      toast(preview.reason || '这里暂时不能放置素材', 'warning')
      return
    }
    // v0.7.3 fix: clip.type 是 'image' | 'video' | 'audio'，trackType 是 'image' | 'video'
    // audio clip 落到 video 轨；image/video 直传
    addTimelineClipAtFrame(preview.clip, getTrackTypeForClipType(preview.clip.type), preview.startFrame)
  }, [addTimelineClipAtFrame, dragPreview, resolveDropPreview])

  return (
    <div className={cn(
      'workbench-timeline-track',
      'w-full min-h-[52px] grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
      'items-center mb-1.5 border-b-0',
    )} data-testid="timeline-track" data-track-type={track.type}>
      <div className={cn(
        'workbench-timeline-track__label',
        'sticky left-0 z-[3] flex items-center gap-[7px]',
        'min-w-0 min-h-[52px] pr-3 border-r-0 bg-transparent',
        'text-[var(--workbench-ink)] text-xs font-semibold',
      )}>
        <span className={cn(
          'workbench-timeline-track__type-dot',
          'flex-none w-2 h-2 rounded-full shadow-none',
          track.type === 'image' && 'bg-[var(--workbench-accent)]',
          track.type === 'video' && 'bg-[var(--workbench-video)]',
          track.type !== 'image' && track.type !== 'video' && 'bg-[var(--workbench-muted-soft)]',
        )} aria-hidden="true" />
        <span className={cn(
          'workbench-timeline-track__name',
          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
        )}>{track.label}</span>
        <span className={cn(
          'workbench-timeline-track__count',
          'flex-none min-w-0 h-auto ml-auto px-1.5 py-px',
          'inline-grid place-items-center border-0 rounded-full',
          'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-40)]',
          'text-micro font-bold tabular-nums',
        )}>{track.clips.length}</span>
      </div>
      <div
        ref={clipsRef}
        className={cn(
          'workbench-timeline-track__clips',
          'relative min-h-[46px] overflow-hidden cursor-crosshair',
          'border border-[var(--nomi-line-soft)] rounded-[var(--nomi-radius-sm)]',
          'bg-[var(--nomi-ink-05)] transition-[background,box-shadow] duration-[140ms] ease-in-out',
          dragPreview && dragPreview.canPlace && 'bg-[var(--workbench-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--workbench-accent)_20%,transparent)]',
          dragPreview && !dragPreview.canPlace && 'bg-[var(--workbench-danger-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--workbench-danger)_28%,transparent)]',
          // v0.7.4: drag 中没有 preview 时也给一个 hover 高亮（accent）
          !dragPreview && isDragHovering && 'bg-[var(--workbench-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--workbench-accent)_20%,transparent)]',
        )}
        style={{
          width: 'var(--workbench-timeline-content-width, 100%)',
          minWidth: 'var(--workbench-timeline-content-width, 100%)',
        }}
        data-drag-over={dragPreview ? 'true' : 'false'}
        data-drop-valid={dragPreview ? String(dragPreview.canPlace) : undefined}
        onClick={(event) => {
          // 点轨道空白：移动 playhead 并清空多选（点 clip 会 stopPropagation，不触发此处）
          setTimelinePlayhead(resolveFrame(event.clientX))
          if (!event.shiftKey) setTimelineSelection([])
        }}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes(TIMELINE_GENERATION_NODE_DRAG_MIME)) return
          event.preventDefault()
          setIsDragHovering(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
          setDragPreview(null)
          setIsDragHovering(false)
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(TIMELINE_GENERATION_NODE_DRAG_MIME)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          setIsDragHovering(false)
          handleDrop(event)
        }}
      >
        {track.clips.length === 0 ? (
          <div className={cn(
            'workbench-timeline-track__empty',
            'absolute inset-0 flex items-center justify-center',
            'border border-dashed border-[var(--nomi-line)] rounded-[var(--nomi-radius-sm)]',
            'text-[var(--nomi-ink-40)] leading-none text-micro font-medium pointer-events-none',
          )}>从生成区拖入素材</div>
        ) : null}
        {dragPreview ? (
          <div
            className={cn(
              'workbench-timeline-track__drop-preview',
              'absolute top-[5px] h-9 z-[2] pointer-events-none',
              'flex items-center justify-center overflow-visible rounded text-micro font-semibold',
              'border border-dashed backdrop-blur-[8px] shadow-[0_8px_20px_rgba(18,24,38,0.12)]',
              dragPreview.canPlace
                ? 'border-[color-mix(in_srgb,var(--workbench-accent)_58%,transparent)] bg-[color-mix(in_srgb,var(--workbench-accent)_20%,var(--nomi-paper))] text-[var(--workbench-ink)]'
                : 'border-[color-mix(in_srgb,var(--workbench-danger)_64%,transparent)] bg-[var(--workbench-danger-soft)] text-[var(--workbench-danger)]',
            )}
            data-valid={dragPreview.canPlace ? 'true' : 'false'}
            style={{ left: dragPreview.left, width: dragPreview.width }}
          >
            <span className={cn('px-2 whitespace-nowrap rounded-full bg-white/70 shadow-sm')}>
              {dragPreview.canPlace ? `放到 ${dragPreview.timecode}` : dragPreview.reason}
            </span>
          </div>
        ) : null}
        {track.clips.map((clip) => (
          <TimelineClip key={clip.id} clip={clip} />
        ))}
      </div>
    </div>
  )
}

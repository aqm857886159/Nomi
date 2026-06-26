import React from 'react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { buildClipFromGenerationNode } from '../generationCanvas/model/buildClipFromGenerationNode'
import { tryAddAudioAssetFromDragData } from './dropAudioAssetToTimeline'
import { ASSET_LIBRARY_DRAG_MIME } from '../assets/assetLibraryDrag'
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
  // 主次分层：primary=画面轨(图/视频,显眼)；secondary=叠加层(配乐/字幕,压矮变淡)。缺省 primary。
  variant?: 'primary' | 'secondary'
}

function TimelineTrack({ track, variant = 'primary' }: TimelineTrackProps): JSX.Element {
  const secondary = variant === 'secondary'
  // 只订阅渲染真正用到的 scale/fps，**不订阅整条 timeline**：播放推进每帧换 timeline 引用，
  // 订阅整条会让本轨道（连同所有 clip）每帧重渲；playhead 由独立 overlay 订阅 playheadFrame。
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  const fps = useWorkbenchStore((state) => state.timeline.fps)
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
    return clientXToFrame(clientX, rect.left, scale)
  }, [scale])

  // 接受拖入的类型：生成节点（任意轨）或素材库音频（仅音频轨）。dragover 时只能读 types 不能读 data。
  const acceptsDragTypes = React.useCallback((types: readonly string[]) => {
    if (types.includes(TIMELINE_GENERATION_NODE_DRAG_MIME)) return true
    if (track.type === 'audio' && types.includes(ASSET_LIBRARY_DRAG_MIME)) return true
    return false
  }, [track.type])

  const resolveDropPreview = React.useCallback((event: React.DragEvent<HTMLDivElement>): TimelineDropPreview | null => {
    const generationNodePayload = decodeTimelineGenerationNodeDragPayload(event.dataTransfer.getData(TIMELINE_GENERATION_NODE_DRAG_MIME))
    if (!generationNodePayload) return null
    const startFrame = resolveFrame(event.clientX)
    const clip = buildClipFromGenerationNode(generationNodePayload.node, {
      fps,
      startFrame,
      resultId: generationNodePayload.resultId,
    })
    if (!clip) return null
    return buildTimelineDropPreview({
      track,
      clip,
      startFrame,
      scale,
      fps,
    })
  }, [resolveFrame, fps, scale, track])

  // 素材库音频拖到音频轨：payload 同步可读，时长离屏探测后落 clip（核心逻辑共用 dropAudioAssetToTimeline）。
  const handleAssetAudioDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>): boolean => {
    if (track.type !== 'audio') return false
    const result = tryAddAudioAssetFromDragData(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME), { fps, startFrame: resolveFrame(event.clientX) })
    if (!result) return false
    event.preventDefault()
    setDragPreview(null)
    setIsDragHovering(false)
    if (result === 'reject') toast('只有音频素材能放到音频轨', 'warning')
    return true
  }, [track.type, resolveFrame, fps])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (handleAssetAudioDrop(event)) return
    const preview = resolveDropPreview(event) || dragPreview
    if (!preview) return
    event.preventDefault()
    setDragPreview(null)
    if (!preview.canPlace) {
      toast(preview.reason || '这里暂时不能放置素材', 'warning')
      return
    }
    addTimelineClipAtFrame(preview.clip, getTrackTypeForClipType(preview.clip.type), preview.startFrame)
  }, [handleAssetAudioDrop, addTimelineClipAtFrame, dragPreview, resolveDropPreview])

  return (
    <div className={cn(
      'workbench-timeline-track',
      'w-full grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
      secondary ? 'min-h-[40px] mb-1' : 'min-h-[52px] mb-1.5',
      'items-center border-b-0',
    )} data-testid="timeline-track" data-track-type={track.type}>
      <div className={cn(
        'workbench-timeline-track__label',
        'sticky left-0 z-[3] flex items-center gap-[7px]',
        secondary ? 'min-h-[40px]' : 'min-h-[52px]',
        'min-w-0 pr-3 border-r-0 bg-transparent',
        secondary ? 'text-[var(--workbench-muted)] text-micro font-medium' : 'text-[var(--workbench-ink)] text-xs font-semibold',
      )}>
        <span className={cn(
          'workbench-timeline-track__type-dot',
          'flex-none w-2 h-2 rounded-full shadow-none',
          track.type === 'image' && 'bg-[var(--workbench-accent)]',
          track.type === 'video' && 'bg-[var(--workbench-video)]',
          track.type === 'audio' && 'bg-[var(--workbench-audio)]',
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
          secondary ? 'min-h-[30px]' : 'min-h-[46px]',
          'relative overflow-hidden cursor-crosshair',
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
          // 剪刀模式：点轨道空白不移 playhead（只有点在 clip 上才分割，由 TimelineClip 处理）
          if (useWorkbenchStore.getState().timelineSplitMode) return
          // 点轨道空白：移动 playhead 并清空多选（点 clip 会 stopPropagation，不触发此处）
          setTimelinePlayhead(resolveFrame(event.clientX))
          if (!event.shiftKey) setTimelineSelection([])
        }}
        onDragEnter={(event) => {
          if (!acceptsDragTypes(event.dataTransfer.types)) return
          event.preventDefault()
          setIsDragHovering(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return
          setDragPreview(null)
          setIsDragHovering(false)
        }}
        onDragOver={(event) => {
          if (!acceptsDragTypes(event.dataTransfer.types)) return
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
          )}>{track.type === 'audio' ? '从素材库拖入音频当配乐' : '从生成区拖入素材'}</div>
        ) : null}
        {dragPreview ? (
          <div
            className={cn(
              'workbench-timeline-track__drop-preview',
              'absolute top-[5px] bottom-[5px] z-[2] pointer-events-none',
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

// TimelinePanel 为 playhead 线每帧重渲，但 track 引用在播放推进时稳定（immer）；memo 后
// 未变的轨道（连同其 clip 子树）跳过重渲，把每帧重渲范围收窄到「只有 playhead 那根竖线」。
export default React.memo(TimelineTrack)

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { cn } from '../../utils/cn'
import { buildClipFromGenerationNode } from '../generationCanvas/model/buildClipFromGenerationNode'
import { adoptGenerationNode } from '../adoption/adoptGenerationNode'
import { reportAdoptionOutcome } from '../adoption/adoptionReceipt'
import { tryAddAssetFromDragData } from './addAssetToTimeline'
import { ASSET_LIBRARY_DRAG_MIME } from '../assets/assetLibraryDrag'
import { clientXToFrame, frameToPixel } from './timelineEdit'
import { findAppendFrame } from './timelineMath'
import { buildTimelineDropPreview, type TimelineDropPreview } from './timelineDropFeedback'
import { decodeTimelineGenerationNodeDragPayload, TIMELINE_GENERATION_NODE_DRAG_MIME } from './timelineDragPayload'
import TimelineClip from './TimelineClip'
import type { TimelineTrack as TimelineTrackData } from './timelineTypes'
import { toast } from '../../ui/toast'
import TimelineTransitionMarker from './TimelineTransitionMarker'
import type { TimelineTransitionFeedback } from './timelineVisualFeedback'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'

type TimelineTrackProps = {
  track: TimelineTrackData
  transitionFeedback?: readonly TimelineTransitionFeedback[]
  // 主次分层：primary=画面轨(图/视频,显眼)；secondary=叠加层(配乐/字幕,压矮变淡)。缺省 primary。
  variant?: 'primary' | 'secondary'
}

function TimelineTrack({ track, transitionFeedback = [], variant = 'primary' }: TimelineTrackProps): JSX.Element {
  const { t } = useTranslation()
  // 轨道标签列宽度固定（--workbench-timeline-label-width=112px，标尺/播放头都按它对齐），用短的 rail*Label，
  // 别用描述名 *Label（英文 'Image track' 会被这列截成 'Image t…'）。句子里的轨道名仍用 *Label（见下 wrongType）。
  const displayTrackLabel =
    track.type === 'image'
      ? t('timelineEditor.track.railImageLabel')
      : track.type === 'video'
        ? t('timelineEditor.track.railVideoLabel')
        : t('timelineEditor.track.railAudioLabel')
  const secondary = variant === 'secondary'
  const transitionRowsAtBoundary = new Map<number, number>()
  const laidOutTransitionFeedback = transitionFeedback.map((feedback) => {
    const stackRow = transitionRowsAtBoundary.get(feedback.boundaryFrame) ?? 0
    transitionRowsAtBoundary.set(feedback.boundaryFrame, stackRow + 1)
    return { feedback, stackRow }
  })
  const transitionLaneRows = Math.max(0, ...transitionRowsAtBoundary.values())
  // 只订阅渲染真正用到的 scale/fps，**不订阅整条 timeline**：播放推进每帧换 timeline 引用，
  // 订阅整条会让本轨道（连同所有 clip）每帧重渲；playhead 由独立 overlay 订阅 playheadFrame。
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  const fps = useWorkbenchStore((state) => state.timeline.fps)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const setTimelineSelection = useWorkbenchStore((state) => state.setTimelineSelection)
  const clipsRef = React.useRef<HTMLDivElement | null>(null)
  const [dragPreview, setDragPreview] = React.useState<TimelineDropPreview | null>(null)
  // v0.7.4: dragenter/over 期间无法 getData → 用单独的 hover state 提供视觉反馈
  const [isDragHovering, setIsDragHovering] = React.useState(false)
  // 拖入将落位光标线：默认贴尾追加（不需要 payload 即可算），按 ⌥ 才用光标处自由落点
  const [dropCaretFrame, setDropCaretFrame] = React.useState<number | null>(null)

  const resolveFrame = React.useCallback(
    (clientX: number) => {
      const rect = clipsRef.current?.getBoundingClientRect()
      if (!rect) return 0
      return clientXToFrame(clientX, rect.left, scale)
    },
    [scale],
  )

  // 接受拖入的类型：生成节点或素材库三类媒体。dragover 时只能读 types 不能读 payload，
  // 具体 kind 与轨道匹配在 drop 时校验。
  const acceptsDragTypes = React.useCallback(
    (types: readonly string[]) => {
      if (types.includes(TIMELINE_GENERATION_NODE_DRAG_MIME)) return true
      return types.includes(ASSET_LIBRARY_DRAG_MIME)
    },
    [],
  )

  // L3 落点语义：默认贴尾追加（免思考串片）；按住 ⌥ 用光标处自由落点（精排）
  const resolveDesiredStart = React.useCallback(
    (event: { altKey: boolean; clientX: number }): number =>
      event.altKey ? resolveFrame(event.clientX) : findAppendFrame(track),
    [resolveFrame, track],
  )

  const resolveDropPreview = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): TimelineDropPreview | null => {
      const generationNodePayload = decodeTimelineGenerationNodeDragPayload(
        event.dataTransfer.getData(TIMELINE_GENERATION_NODE_DRAG_MIME),
      )
      if (!generationNodePayload) return null
      const liveNode = useGenerationCanvasStore
        .getState()
        .nodes.find((node) => node.id === generationNodePayload.nodeId)
      const generationNode = liveNode || generationNodePayload.node
      const startFrame = resolveDesiredStart(event)
      const clip = buildClipFromGenerationNode(generationNode, {
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
    },
    [resolveDesiredStart, fps, scale, track],
  )

  // 素材库三类素材：拖拽本身就是精排，直接使用光标落点；时长探测/clip 构建走统一 action。
  const handleAssetDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): boolean => {
      const result = tryAddAssetFromDragData(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME), {
        fps,
        startFrame: resolveFrame(event.clientX),
        targetTrackType: track.type,
        activeProjectId: getActiveWorkbenchProjectId(),
      })
      if (!result) return false
      event.preventDefault()
      setDragPreview(null)
      setIsDragHovering(false)
      setDropCaretFrame(null)
      if (result.status === 'reject-external') {
        toast(t('assetLibrary.externalAssetHint'), 'info')
      } else if (result.status === 'reject') {
        const expectedTrack = result.expectedTrack === 'image'
          ? t('timelineEditor.track.imageLabel')
          : result.expectedTrack === 'video'
            ? t('timelineEditor.track.videoLabel')
            : t('timelineEditor.track.audioLabel')
        toast(t('timelineEditor.track.wrongType', { track: expectedTrack }), 'warning')
      }
      return true
    },
    [track.type, resolveFrame, fps, t],
  )

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (handleAssetDrop(event)) return
      const preview = resolveDropPreview(event) || dragPreview
      if (!preview) return
      event.preventDefault()
      setDragPreview(null)
      setDropCaretFrame(null)
      if (!preview.canPlace) {
        toast(preview.reason || t('timelineEditor.track.unavailable'), 'warning')
        return
      }
      const generationNodePayload = decodeTimelineGenerationNodeDragPayload(
        event.dataTransfer.getData(TIMELINE_GENERATION_NODE_DRAG_MIME),
      )
      // 没有生成节点 payload 就不是采纳：素材库那条已在 handleAssetDrop 里返回，
      // 走到这里还没 payload 属于预览态与 dataTransfer 不咬合，宁可不落也不直写。
      if (!generationNodePayload) return
      const liveNode = useGenerationCanvasStore
        .getState()
        .nodes.find((node) => node.id === generationNodePayload.nodeId)
      const generationNode = liveNode || generationNodePayload.node
      // P5 E1：把生成产物拖进轨道也是一次**采纳**，必须走桥——这里曾是最后一条直写旁路，
      // 画布拖拽（BaseGenerationNode）和预览来源拖拽（PreviewSourcePanel）都汇到这儿。
      // 落点就是拖放预览给出的那一帧（⌥ 自由落点 / 默认贴尾都已在 preview 里算好）。
      void adoptGenerationNode(generationNode, {
        placement: { kind: 'frame', startFrame: preview.startFrame },
      }).then((outcome) => {
        // 拖放时用户已经在看着轴了，回执不再展开面板（与画布拖拽路径一致）。
        reportAdoptionOutcome(outcome, { revealTimeline: false })
      })
    },
    [handleAssetDrop, dragPreview, resolveDropPreview, t],
  )

  return (
    <div
      className={cn(
        'workbench-timeline-track',
        'w-full grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
        secondary ? 'min-h-[40px] mb-1' : 'min-h-[52px] mb-1.5',
        'items-center border-b-0',
      )}
      data-testid="timeline-track"
      data-track-type={track.type}
    >
      <div
        className={cn(
          'workbench-timeline-track__label',
          'sticky left-0 z-[3] flex items-center gap-[7px]',
          secondary ? 'min-h-[40px]' : 'min-h-[52px]',
          'min-w-0 pr-3 border-r-0 bg-transparent',
          secondary
            ? 'text-[var(--workbench-muted)] text-micro font-medium'
            : 'text-[var(--workbench-ink)] text-xs font-semibold',
        )}
      >
        <span
          className={cn(
            'workbench-timeline-track__type-dot',
            'flex-none w-2 h-2 rounded-full shadow-none',
            track.type === 'image' && 'bg-[var(--workbench-accent)]',
            track.type === 'video' && 'bg-[var(--workbench-video)]',
            track.type === 'audio' && 'bg-[var(--workbench-audio)]',
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            'workbench-timeline-track__name',
            'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
          )}
        >
          {displayTrackLabel}
        </span>
        <span
          className={cn(
            'workbench-timeline-track__count',
            'flex-none min-w-0 h-auto ml-auto px-1.5 py-px',
            'inline-grid place-items-center border-0 rounded-full',
            'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-40)]',
            'text-micro font-bold tabular-nums',
          )}
        >
          {track.clips.length}
        </span>
      </div>
      <div
        ref={clipsRef}
        className={cn(
          'workbench-timeline-track__clips',
          secondary ? 'min-h-[30px]' : 'min-h-[46px]',
          'relative overflow-hidden cursor-crosshair',
          'border border-[var(--nomi-line-soft)] rounded-[var(--nomi-radius-sm)]',
          'bg-[var(--nomi-ink-05)] transition-[background,box-shadow] duration-[140ms] ease-in-out',
          dragPreview &&
            dragPreview.canPlace &&
            'bg-[var(--workbench-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--workbench-accent)_20%,transparent)]',
          dragPreview &&
            !dragPreview.canPlace &&
            'bg-[var(--workbench-danger-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--workbench-danger)_28%,transparent)]',
          // v0.7.4: drag 中没有 preview 时也给一个 hover 高亮（accent）
          !dragPreview &&
            isDragHovering &&
            'bg-[var(--workbench-accent-soft)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--workbench-accent)_20%,transparent)]',
        )}
        style={{
          width: 'var(--workbench-timeline-content-width, 100%)',
          minWidth: 'var(--workbench-timeline-content-width, 100%)',
          minHeight: transitionLaneRows > 0 ? `${(secondary ? 26 : 42) + transitionLaneRows * 20}px` : undefined,
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
          setDropCaretFrame(null)
        }}
        onDragOver={(event) => {
          if (!acceptsDragTypes(event.dataTransfer.types)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropCaretFrame(
            event.dataTransfer.types.includes(ASSET_LIBRARY_DRAG_MIME)
              ? resolveFrame(event.clientX)
              : resolveDesiredStart(event),
          )
        }}
        onDrop={(event) => {
          setIsDragHovering(false)
          handleDrop(event)
        }}
      >
        {track.clips.length === 0 ? (
          <div
            className={cn(
              'workbench-timeline-track__empty',
              'absolute inset-0 flex items-center justify-center',
              'border border-dashed border-[var(--nomi-line)] rounded-[var(--nomi-radius-sm)]',
              'text-[var(--nomi-ink-40)] leading-none text-micro font-medium pointer-events-none',
            )}
          >
            {track.type === 'audio' ? t('timelineEditor.track.emptyAudio') : t('timelineEditor.track.emptyVisual')}
          </div>
        ) : null}
        {dropCaretFrame != null ? (
          <div
            className={cn(
              'workbench-timeline-track__drop-caret',
              'absolute top-0 bottom-0 z-[2] w-0.5 -translate-x-1/2 rounded-full',
              'bg-[var(--workbench-accent)] opacity-80 pointer-events-none',
            )}
            style={{ left: frameToPixel(dropCaretFrame, scale) }}
            aria-hidden="true"
          />
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
              {dragPreview.canPlace
                ? t('timelineEditor.track.placeAt', { timecode: dragPreview.timecode })
                : dragPreview.reason}
            </span>
          </div>
        ) : null}
        {track.clips.map((clip) => (
          <TimelineClip key={clip.id} clip={clip} transitionLaneRows={transitionLaneRows} />
        ))}
        {laidOutTransitionFeedback.map(({ feedback, stackRow }, index) => (
          <TimelineTransitionMarker
            key={`${feedback.transition.fromClipId}:${feedback.transition.toClipId}:${feedback.transition.type}:${index}`}
            feedback={feedback}
            fps={fps}
            scale={scale}
            stackRow={stackRow}
          />
        ))}
      </div>
    </div>
  )
}

// TimelinePanel 为 playhead 线每帧重渲，但 track 引用在播放推进时稳定（immer）；memo 后
// 未变的轨道（连同其 clip 子树）跳过重渲，把每帧重渲范围收窄到「只有 playhead 那根竖线」。
export default React.memo(TimelineTrack)

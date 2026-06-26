import React from 'react'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconArrowRight,
  IconCopy,
  IconCut,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconWand,
} from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { WorkbenchIconButton } from '../../design/workbenchActions'
import { cn } from '../../utils/cn'
import { computeTimelineDuration } from './timelineMath'
import TimelineTrack from './TimelineTrack'
import TimelineTextTrack from './TimelineTextTrack'
import { TimelineSecondaryAddRow } from './TimelineSecondaryAddRow'
import { frameToPixel, pixelToFrame, TIMELINE_MIN_SCALE, TIMELINE_MAX_SCALE } from './timelineEdit'
import { buildSnapPoints, resolveSnap, pixelThresholdToFrames } from './snapping'
import { regenerateNodeInPlace } from '../generationCanvas/runner/generationRunController'
import { arrangeStoryboardToTimeline } from '../generationCanvas/agent/sendStoryboardToTimeline'
import { toast } from '../../ui/toast'

const WHEEL_ZOOM_FACTOR = 1.24

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
  regionLabel: string
  actionLabelPrefix: string
  /** 是否显示文字轨（字幕/标题卡）。仅预览标签传 true；生成画布底部不传。 */
  showTextTrack?: boolean
}

export default function TimelinePanel({ density = 'compact', regionLabel, actionLabelPrefix, showTextTrack = false }: TimelinePanelProps): JSX.Element {
  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectedClipIds = useWorkbenchStore((state) => state.selectedTimelineClipIds)
  const selectedTextClipId = useWorkbenchStore((state) => state.selectedTextClipId)
  const removeTimelineTextClip = useWorkbenchStore((state) => state.removeTimelineTextClip)
  const snapGuide = useWorkbenchStore((state) => state.timelineSnapGuide)
  const duplicateTimelineClip = useWorkbenchStore((state) => state.duplicateTimelineClip)
  const nudgeTimelineClip = useWorkbenchStore((state) => state.nudgeTimelineClip)
  const removeSelectedTimelineClips = useWorkbenchStore((state) => state.removeSelectedTimelineClips)
  const setTimelineZoom = useWorkbenchStore((state) => state.setTimelineZoom)
  const splitMode = useWorkbenchStore((state) => state.timelineSplitMode)
  const setTimelineSplitMode = useWorkbenchStore((state) => state.setTimelineSplitMode)
  const canUndo = useWorkbenchStore((state) => state.timelineUndoStack.length > 0)
  const undoTimeline = useWorkbenchStore((state) => state.undoTimeline)
  const canRedo = useWorkbenchStore((state) => state.timelineRedoStack.length > 0)
  const redoTimeline = useWorkbenchStore((state) => state.redoTimeline)
  // 单片工具（分割/复制/微调）作用于"最后选中"的 primary
  const primaryClipId = selectedClipIds.length > 0 ? selectedClipIds[selectedClipIds.length - 1] : ''
  const hasSelection = selectedClipIds.length > 0
  // 选中单个媒体 clip（有源节点）→ 可「就地重生成」。文字 clip 在 textClips、不在 tracks，天然不命中。
  const primaryMediaClip = React.useMemo(() => {
    if (selectedClipIds.length !== 1 || !primaryClipId) return null
    for (const track of timeline.tracks) {
      const found = track.clips.find((clip) => clip.id === primaryClipId)
      if (found) return found.sourceNodeId ? found : null
    }
    return null
  }, [selectedClipIds, primaryClipId, timeline.tracks])

  // C2 一键拼片：把画布镜头按镜序追加排进时间轴（复用 arrangeStoryboardToTimeline，幂等去重）。
  // 用户测的主线诉求——点一下出初剪，手动重排/trim 是之后的微调。
  const handleAiArrange = React.useCallback(() => {
    const result = arrangeStoryboardToTimeline()
    if (result.sent.length > 0) toast(`已把 ${result.sent.length} 个镜头按镜序排进时间轴`, 'success')
    else if (result.total === 0) toast('生成区还没有镜头——先去生成区生成几个镜头再拼片', 'info')
    else toast('镜头都已在时间轴上了', 'info')
  }, [])
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
      // 预览(full)与生成(compact)两个 TimelinePanel 因 keep-alive 同时挂载，各注册一个 window keydown。
      // 不去重会双触发（⌘Z 撤销两步、方向键 playhead 走两帧、Delete 删两次）。本处理的每条分支都会
      // preventDefault，故第二个监听器见 defaultPrevented 即跳过 → 单一真相、零重复（不动 keep-alive 架构）。
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      // 撤销时间轴编辑（⌘Z / Ctrl+Z）
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        useWorkbenchStore.getState().undoTimeline()
        return
      }
      // 重做（⇧⌘Z / ⇧Ctrl+Z）
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && event.shiftKey) {
        event.preventDefault()
        useWorkbenchStore.getState().redoTimeline()
        return
      }
      // Esc 退出剪刀模式
      if (event.key === 'Escape' && useWorkbenchStore.getState().timelineSplitMode) {
        event.preventDefault()
        useWorkbenchStore.getState().setTimelineSplitMode(false)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        setTimelinePlayhead(timeline.playheadFrame + (event.key === 'ArrowLeft' ? -1 : 1))
        return
      }
      // 文字 clip 选中时的删除（与媒体 clip 选择互斥）
      if (selectedTextClipId && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault()
        removeTimelineTextClip(selectedTextClipId)
        return
      }
      if (!hasSelection) return
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        removeSelectedTimelineClips() // 批量删除所有选中
        return
      }
      if (!primaryClipId) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        splitTimelineClip(primaryClipId, timeline.playheadFrame)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateTimelineClip(primaryClipId)
        return
      }
      if (event.shiftKey && (event.key === '<' || event.key === '>')) {
        event.preventDefault()
        nudgeTimelineClip(primaryClipId, event.key === '<' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    duplicateTimelineClip,
    hasSelection,
    nudgeTimelineClip,
    primaryClipId,
    removeSelectedTimelineClips,
    removeTimelineTextClip,
    selectedTextClipId,
    setTimelinePlayhead,
    splitTimelineClip,
    timeline.playheadFrame,
  ])

  const rulerContentRef = React.useRef<HTMLDivElement | null>(null)

  const frameFromClientX = React.useCallback((clientX: number): number => {
    const rect = rulerContentRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, pixelToFrame(clientX - rect.left, useWorkbenchStore.getState().timeline.scale))
  }, [])

  // 可拖 playhead scrub：拖把手或在标尺上按下都能 scrub；吸附到片段边/起点；Shift 关吸附。
  const beginScrub = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const target = event.currentTarget
    target.setPointerCapture?.(pointerId)

    const applyAt = (clientX: number, shiftKey: boolean) => {
      const store = useWorkbenchStore.getState()
      let frame = frameFromClientX(clientX)
      if (!shiftKey) {
        const points = buildSnapPoints(store.timeline, { includePlayhead: false })
        const snap = resolveSnap(frame, points, pixelThresholdToFrames(store.timeline.scale))
        if (snap) {
          frame = snap.frame
          store.setTimelineSnapGuide({ frame: snap.frame, label: snap.point.label })
        } else {
          store.setTimelineSnapGuide(null)
        }
      } else {
        store.setTimelineSnapGuide(null)
      }
      store.setTimelinePlayhead(frame)
    }

    applyAt(event.clientX, event.shiftKey)
    const handlePointerMove = (moveEvent: PointerEvent) => applyAt(moveEvent.clientX, moveEvent.shiftKey)
    const handlePointerUp = () => {
      target.releasePointerCapture?.(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      useWorkbenchStore.getState().setTimelineSnapGuide(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [frameFromClientX])

  return (
    <section
      className={cn(
        'workbench-timeline',
        'relative min-w-0 min-h-0 grid grid-rows-[minmax(0,1fr)]',
        'bg-[var(--workbench-surface-solid)] border-t border-[var(--workbench-border)]',
        'shadow-[0_-1px_0_var(--workbench-bevel)]',
        density === 'full' ? 'px-[18px] pt-[10px] pb-5' : 'px-4 pt-3 pb-4',
      )}
      data-density={density}
      aria-label={regionLabel}
      style={{ '--workbench-timeline-content-width': `${rulerWidth}px` } as React.CSSProperties}
    >
      <div className={cn(
        'workbench-timeline__controls',
        'absolute top-[10px] right-4 z-[8] inline-flex items-center gap-0.5',
        'bg-[color-mix(in_oklch,var(--nomi-paper)_84%,transparent)]',
        'rounded-full backdrop-blur-[10px]',
      )}>
        <div className={cn(
          'workbench-timeline__right',
          'inline-flex items-center gap-0.5 min-w-0 p-0',
        )}>
          {hasSelection ? (
            <div className={cn(
              'workbench-timeline__clip-tools',
              'inline-flex items-center gap-0.5 pr-0 border-r-0',
            )} aria-label="选中片段操作">
              {primaryMediaClip ? (
                <WorkbenchIconButton
                  className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-accent)] shadow-none cursor-pointer hover:bg-[var(--workbench-accent-soft)]')}
                  label="重新生成这个镜头"
                  title="重新生成这个镜头（就地重出、贴回原位；改 prompt/参数请去画布节点）"
                  icon={<IconSparkles size={14} />}
                  onClick={() => { void regenerateNodeInPlace(primaryMediaClip.sourceNodeId) }}
                />
              ) : null}
              <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label="向前微调片段" icon={<IconArrowLeft size={14} />} onClick={() => nudgeTimelineClip(primaryClipId, -1)} />
              <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label="复制片段" icon={<IconCopy size={14} />} onClick={() => duplicateTimelineClip(primaryClipId)} />
              <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label="向后微调片段" icon={<IconArrowRight size={14} />} onClick={() => nudgeTimelineClip(primaryClipId, 1)} />
            </div>
          ) : null}
          {/* C2 一键拼片：把画布镜头按镜序排进时间轴（accent，主操作权重）。 */}
          <WorkbenchIconButton
            className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-accent)] shadow-none cursor-pointer hover:bg-[var(--workbench-accent-soft)]')}
            label="AI 拼片"
            title="AI 拼片：把生成区的镜头按镜序排进时间轴（已在轨的跳过）"
            icon={<IconWand size={14} />}
            onClick={handleAiArrange}
          />
          {/* 剪刀模式：常驻切换。进入后悬停片段出切点线、点击在光标处分割（TimelineClip 处理）；再点 / Esc 退出。 */}
          <WorkbenchIconButton
            className={cn(
              'workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] shadow-none cursor-pointer',
              splitMode
                ? 'bg-[var(--workbench-accent-soft)] text-[var(--workbench-accent)] hover:bg-[var(--workbench-accent-soft)]'
                : 'bg-transparent text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)]',
            )}
            label={splitMode ? '退出剪刀模式' : '剪刀模式（点片段处分割）'}
            title={splitMode ? '剪刀模式开启中：点片段即在光标处分割 · Esc 退出' : '剪刀：进入后点片段即可在该处分割'}
            icon={<IconCut size={14} />}
            onClick={() => setTimelineSplitMode(!splitMode)}
          />
          {canRedo ? (
            <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label="重做时间轴编辑" title="重做（⇧⌘Z）" icon={<IconArrowForwardUp size={14} />} onClick={() => redoTimeline()} />
          ) : null}
          {canUndo ? (
            <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label="撤销时间轴编辑" title="撤销（⌘Z）" icon={<IconArrowBackUp size={14} />} onClick={() => undoTimeline()} />
          ) : null}
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={`${actionLabelPrefix}缩小时间轴`} icon={<IconMinus size={14} />} onClick={() => setTimelineZoom(timeline.scale / 1.25)} />
          <span className="text-micro opacity-60 min-w-[32px] text-center">{Math.round(timeline.scale * 100)}%</span>
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label="重置缩放" icon={<IconRefresh size={14} />} onClick={() => setTimelineZoom(1)} />
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={`${actionLabelPrefix}放大时间轴`} icon={<IconPlus size={14} />} onClick={() => setTimelineZoom(timeline.scale * 1.25)} />
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={`${actionLabelPrefix}删除选中片段`} icon={<IconTrash size={14} />} disabled={!hasSelection} onClick={() => removeSelectedTimelineClips()} />
        </div>
      </div>
      <div
        className={cn(
          'workbench-timeline__tracks',
          'relative min-w-0 min-h-0 block bg-transparent',
          'overflow-x-auto overflow-y-hidden pb-2',
          'scrollbar-thin scrollbar-color-transparent',
          'hover:scrollbar-color-[color-mix(in_srgb,var(--nomi-ink)_22%,transparent)]',
        )}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR
          setTimelineZoom(Math.min(TIMELINE_MAX_SCALE, Math.max(TIMELINE_MIN_SCALE, timeline.scale * factor)))
        }}
      >
        <div className={cn(
          'workbench-timeline__ruler',
          'w-full grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
          'h-[22px] mb-1.5 border-b border-[var(--nomi-line-soft)] bg-transparent',
        )}>
          <div className={cn(
            'workbench-timeline__ruler-spacer',
            'sticky left-0 z-[4] border-r-0 bg-transparent',
          )} aria-hidden="true" />
          <div
            ref={rulerContentRef}
            className={cn(
              'workbench-timeline__ruler-content',
              'relative h-full cursor-pointer bg-transparent touch-none',
            )}
            style={{
              width: 'var(--workbench-timeline-content-width, 100%)',
              minWidth: 'var(--workbench-timeline-content-width, 100%)',
            }}
            aria-label="时间刻度"
            onPointerDown={beginScrub}
          >
            {rulerTicks.map((tick) => (
              <span
                key={tick.frame}
                className={cn(
                  'workbench-timeline__ruler-tick',
                  'absolute left-0 top-0 w-0 h-full bg-transparent text-[var(--workbench-muted)]',
                  'after:content-[""] after:absolute after:left-0 after:bottom-0 after:w-px after:h-[22px] after:bg-[var(--nomi-line)]',
                )}
                data-origin={tick.frame === 0 ? 'true' : 'false'}
                style={{ transform: `translateX(${frameToPixel(tick.frame, timeline.scale)}px)` }}
              >
                <span className={cn(
                  'workbench-timeline__ruler-label',
                  'absolute left-1.5 top-[3px] font-mono text-micro font-medium leading-none',
                  'text-[var(--nomi-ink-40)] whitespace-nowrap tabular-nums',
                )}>{tick.label}</span>
              </span>
            ))}
          </div>
        </div>
        {/* 吸附辅助线（暖橙虚线 + 标签），仅拖动中临时出现 */}
        {snapGuide ? (
          <div
            className={cn(
              'workbench-timeline__snap-guide',
              'absolute top-0 bottom-0 left-[var(--workbench-timeline-label-width)] z-[7] w-0 pointer-events-none',
            )}
            style={{ transform: `translateX(${frameToPixel(snapGuide.frame, timeline.scale)}px)` }}
            aria-hidden="true"
          >
            <div className="absolute top-0 bottom-0 left-0 w-px -translate-x-1/2 bg-[repeating-linear-gradient(var(--nomi-snap)_0_4px,transparent_4px_8px)]" />
            <span className={cn(
              'absolute top-0.5 left-1 px-1 rounded-nomi-sm whitespace-nowrap',
              'font-mono text-micro leading-[14px] text-[var(--nomi-paper)] bg-[var(--nomi-snap-tag)]',
            )}>{snapGuide.label}</span>
          </div>
        ) : null}
        {/* 播放头：竖线不拦事件；顶部把手可拖 scrub */}
        <div
          className={cn(
            'workbench-timeline__playhead',
            'absolute top-0 bottom-0 left-[var(--workbench-timeline-label-width)] z-[6]',
            'w-px bg-[var(--workbench-accent)] shadow-[0_0_0_1px_rgba(0,122,255,0.08)]',
            'pointer-events-none',
          )}
          style={{ transform: `translateX(${frameToPixel(timeline.playheadFrame, timeline.scale)}px)` }}
          aria-hidden="true"
        >
          <button
            type="button"
            className={cn(
              'workbench-timeline__playhead-handle',
              'absolute -top-px left-1/2 -translate-x-1/2 w-[11px] h-[11px] p-0',
              'rounded-nomi-sm border-[1.5px] border-[var(--nomi-paper)] bg-[var(--workbench-accent)]',
              'shadow-[0_1px_2px_oklch(0_0_0/0.2)] cursor-ew-resize pointer-events-auto touch-none',
            )}
            aria-label="拖动播放头"
            title="拖动播放头"
            onPointerDown={beginScrub}
          />
        </div>
        {/* 主次分层(方案 B)：画面(图/视频)主轨;配乐/字幕降副轨,空时收成「+配乐/+字幕」窄条。 */}
        {timeline.tracks.filter((t) => t.type !== 'audio').map((track) => (
          <TimelineTrack key={track.id} track={track} variant="primary" />
        ))}
        {(() => {
          const audioTrack = timeline.tracks.find((t) => t.type === 'audio')
          const audioHasClips = (audioTrack?.clips.length ?? 0) > 0
          const textHasClips = (timeline.textClips?.length ?? 0) > 0
          const showAudioChip = Boolean(audioTrack) && !audioHasClips
          const showTextChip = showTextTrack && !textHasClips
          return (
            <>
              {audioTrack && audioHasClips ? <TimelineTrack key={audioTrack.id} track={audioTrack} variant="secondary" /> : null}
              {showTextTrack && textHasClips ? <TimelineTextTrack /> : null}
              {showAudioChip || showTextChip ? <TimelineSecondaryAddRow showAudio={showAudioChip} showText={showTextChip} /> : null}
            </>
          )
        })()}
      </div>
    </section>
  )
}

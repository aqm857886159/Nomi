import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowRight,
  IconArrowForwardUp,
  IconChevronDown,
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
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { computeTimelineDuration, resolveTimelineFitScale } from './timelineMath'
import TimelineTrack from './TimelineTrack'
import TimelineTextTrack from './TimelineTextTrack'
import { TimelineSecondaryAddRow } from './TimelineSecondaryAddRow'
import { frameToPixel, pixelToFrame, TIMELINE_MIN_SCALE, TIMELINE_MAX_SCALE, resolveNudgeStartFrame } from './timelineEdit'
import { buildSnapPoints, resolveSnap, pixelThresholdToFrames } from './snapping'
import { toast } from '../../ui/toast'
import { reportAdoptionOutcome } from '../adoption/adoptionReceipt'
import { dispatchTimelineShortcut } from './timelineShortcuts'
import { groupTimelineTransitionFeedbackByTrack } from './timelineVisualFeedback'

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
  return Math.max(fps * 10, params.durationFrame, params.playheadFrame)
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
  onCollapse?: () => void
}

const CLIP_TOOL_CLASS =
  'workbench-timeline__tool w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer enabled:hover:bg-[var(--workbench-hover)] disabled:opacity-40'

export default function TimelinePanel({ density = 'compact', regionLabel, actionLabelPrefix, showTextTrack = false, onCollapse }: TimelinePanelProps): JSX.Element {
  const { t } = useTranslation()
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
  const activeStoryboardId = useWorkbenchStore((state) => state.activeStoryboardId)
  // 选中单个媒体 clip（有源节点）→ 可「就地重生成」。文字 clip 在 textClips、不在 tracks，天然不命中。
  const primaryMediaClip = React.useMemo(() => {
    if (selectedClipIds.length !== 1 || !primaryClipId) return null
    for (const track of timeline.tracks) {
      const found = track.clips.find((clip) => clip.id === primaryClipId)
      if (found) return found.sourceNodeId ? found : null
    }
    return null
  }, [selectedClipIds, primaryClipId, timeline.tracks])

  // AI 拼片仍保留在时间轴工具栏；移除空态里的大号「一键拼成初稿」促销条，
  // 避免在用户尚未准备好时抢占工作区。Agent 后续可在对话中按状态给出建议。
  const handleAiArrange = React.useCallback(() => {
    void import('../generationCanvas/agent/sendStoryboardToTimeline').then(({ arrangeStoryboardToTimeline }) => {
      void arrangeStoryboardToTimeline(activeStoryboardId ? { storyboardDesignId: activeStoryboardId } : {}).then((result) => {
        if (result.scopeError) {
          toast(t('timelineEditor.storyboardScopeRequired'), 'info')
          return
        }
        if (result.total === 0) {
          toast(t('timelineEditor.noShots'), 'info')
          return
        }
        reportAdoptionOutcome(result.outcome, {
          successMessage: result.sent.length > 0
            ? t('timelineEditor.arranged', { count: result.sent.length })
            : undefined,
        })
      })
    })
  }, [activeStoryboardId, t])

  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const splitTimelineClip = useWorkbenchStore((state) => state.splitTimelineClip)
  const durationFrame = computeTimelineDuration(timeline)
  const transitionFeedbackByTrack = React.useMemo(
    () => groupTimelineTransitionFeedbackByTrack(timeline.tracks, timeline.transitions),
    [timeline.tracks, timeline.transitions],
  )
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
  const tracksRef = React.useRef<HTMLDivElement | null>(null)
  const [tracksViewportWidth, setTracksViewportWidth] = React.useState(0)
  const contentViewportWidth = tracksViewportWidth
  const rulerWidth = Math.max(frameToPixel(rulerEndFrame, timeline.scale), contentViewportWidth)
  React.useEffect(() => {
    const element = tracksRef.current
    if (!element) return
    const update = () => {
      const labelWidth = Number.parseFloat(getComputedStyle(element).getPropertyValue('--workbench-timeline-label-width')) || 0
      setTracksViewportWidth(Math.max(0, element.clientWidth - labelWidth))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    if (durationFrame <= 0 || contentViewportWidth <= 0) return
    const fittedScale = resolveTimelineFitScale(durationFrame, contentViewportWidth)
    if (Math.abs(fittedScale - timeline.scale) > 0.001) setTimelineZoom(fittedScale)
  }, [contentViewportWidth, durationFrame, setTimelineZoom, timeline.scale])
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 预览(full)与生成(compact)两个 TimelinePanel 因 keep-alive 同时挂载，各注册一个 window keydown。
      // 不去重会双触发（⌘Z 撤销两步、方向键 playhead 走两帧、Delete 删两次）。本处理的每条分支都会
      // preventDefault，故第二个监听器见 defaultPrevented 即跳过 → 单一真相、零重复（不动 keep-alive 架构）。
      dispatchTimelineShortcut(event, {
        hasSelection,
        hasPrimaryClip: Boolean(primaryClipId),
        hasSelectedTextClip: Boolean(selectedTextClipId),
        splitMode,
      }, (action) => {
        switch (action.type) {
          case 'undo': useWorkbenchStore.getState().undoTimeline(); break
          case 'redo': useWorkbenchStore.getState().redoTimeline(); break
          case 'exit-split-mode': setTimelineSplitMode(false); break
          case 'nudge-playhead': setTimelinePlayhead(timeline.playheadFrame + action.delta); break
          case 'remove-text-selection': if (selectedTextClipId) removeTimelineTextClip(selectedTextClipId); break
          case 'remove-selection': removeSelectedTimelineClips(); break
          case 'split-primary': if (primaryClipId) splitTimelineClip(primaryClipId, timeline.playheadFrame); break
          case 'duplicate-primary': if (primaryClipId) duplicateTimelineClip(primaryClipId); break
          case 'nudge-primary': if (primaryClipId) nudgeTimelineClip(primaryClipId, action.delta); break
        }
      })
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
    setTimelineSplitMode,
    setTimelinePlayhead,
    splitMode,
    splitTimelineClip,
    timeline.playheadFrame,
  ])

  const rulerContentRef = React.useRef<HTMLDivElement | null>(null)
  // hover 幽灵播放头：预告点击落点的半透明竖线。拖动中（buttons>0）与剪刀模式下隐藏（后者有 clip 级切点线）。
  const [hoverFrame, setHoverFrame] = React.useState<number | null>(null)
  const primaryClipStartFrame = React.useMemo(() => {
    if (!primaryClipId) return null
    return timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === primaryClipId)?.startFrame ?? null
  }, [primaryClipId, timeline.tracks])
  const nudgeEarlierStart = resolveNudgeStartFrame(timeline, primaryClipId, -1)
  const nudgeLaterStart = resolveNudgeStartFrame(timeline, primaryClipId, 1)
  const canNudgeEarlier = nudgeEarlierStart !== null && nudgeEarlierStart !== primaryClipStartFrame
  const canNudgeLater = nudgeLaterStart !== null && nudgeLaterStart !== primaryClipStartFrame

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
        'relative min-w-0 min-h-0 h-full grid grid-rows-[minmax(0,1fr)]',
        'bg-[var(--workbench-surface-solid)] border-t border-[var(--workbench-border)]',
        'shadow-[0_-1px_0_var(--workbench-bevel)] overflow-hidden',
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
          {/* 单片工具（重新生成 / 前后微调 / 复制）：**恒常渲染**，没选中片段时禁用并说明原因。
              改之前是 `hasSelection ? … : null`——一选中整条 pill 就变长、右侧按钮全体位移，布局抖一下
              （设计系统 §1.5 硬规则③：情境控件不许挤常驻条）。
              想过搬到片段自己头上做浮条，实测走不通：轨道为了横向滚动用了 overflow-x:auto，
              按 CSS 规范这会把 overflow-y 也算成 auto，浮在片段上方的东西会被整条裁掉、点不到；
              而塞进片段内部又违反「动作不许压在内容上」。恒常渲染 + 禁用带原因同样消掉抖动，
              还顺带满足 §1.6 契约 C1/C4，且和旁边那颗「删除选中」的既有做法一致。 */}
          <span title={hasSelection ? undefined : t('timelineEditor.clipToolsHint')} style={{ display: 'contents' }}>
            <div className={cn('workbench-timeline__clip-tools', 'inline-flex items-center gap-0.5')} aria-label={t('timelineEditor.selectedClipActions')}>
              <WorkbenchIconButton
                className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-accent)] shadow-none cursor-pointer enabled:hover:bg-[var(--workbench-accent-soft)] disabled:opacity-40')}
                label={t('timelineEditor.regenerate')}
                icon={<IconSparkles size={14} />}
                disabled={!primaryMediaClip}
                onClick={() => {
                  if (!primaryMediaClip) return
                  void import('../generationCanvas/runner/generationRunController')
                    .then(({ regenerateNodeInPlace }) => regenerateNodeInPlace(primaryMediaClip.sourceNodeId))
                }}
              />
              <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.nudgeEarlier')} title={!primaryClipId ? t('timelineEditor.clipToolsHint') : canNudgeEarlier ? t('timelineEditor.nudgeEarlier') : t('timelineEditor.nudgeUnavailable')} icon={<IconArrowLeft size={14} />} disabled={!canNudgeEarlier} onClick={() => nudgeTimelineClip(primaryClipId, -1)} />
              <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.duplicateClip')} icon={<IconCopy size={14} />} disabled={!primaryClipId} onClick={() => duplicateTimelineClip(primaryClipId)} />
              <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.nudgeLater')} title={!primaryClipId ? t('timelineEditor.clipToolsHint') : canNudgeLater ? t('timelineEditor.nudgeLater') : t('timelineEditor.nudgeUnavailable')} icon={<IconArrowRight size={14} />} disabled={!canNudgeLater} onClick={() => nudgeTimelineClip(primaryClipId, 1)} />
            </div>
          </span>
          {/* C2 一键拼片：把画布镜头按镜序排进时间轴（accent，主操作权重）。 */}
          <WorkbenchIconButton
            className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-accent)] shadow-none cursor-pointer hover:bg-[var(--workbench-accent-soft)]')}
            label={t('timelineEditor.aiArrange')}
            title={t('timelineEditor.aiArrangeHint')}
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
            label={splitMode ? t('timelineEditor.exitSplitMode') : t('timelineEditor.splitMode')}
            title={splitMode ? t('timelineEditor.splitModeActiveHint') : t('timelineEditor.splitModeHint')}
            icon={<IconCut size={14} />}
            onClick={() => setTimelineSplitMode(!splitMode)}
          />
          {canRedo ? (
            <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={t('timelineEditor.redo')} title={t('timelineEditor.redoShortcut')} icon={<IconArrowForwardUp size={14} />} onClick={() => redoTimeline()} />
          ) : null}
          {canUndo ? (
            <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={t('timelineEditor.undo')} title={t('timelineEditor.undoShortcut')} icon={<IconArrowBackUp size={14} />} onClick={() => undoTimeline()} />
          ) : null}
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={t('timelineEditor.zoomOut', { prefix: actionLabelPrefix })} icon={<IconMinus size={14} />} onClick={() => setTimelineZoom(timeline.scale / 1.25)} />
          <span className="text-micro opacity-60 min-w-[32px] text-center">{Math.round(timeline.scale * 100)}%</span>
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={t('timelineEditor.resetZoom')} icon={<IconRefresh size={14} />} onClick={() => setTimelineZoom(1)} />
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={t('timelineEditor.zoomIn', { prefix: actionLabelPrefix })} icon={<IconPlus size={14} />} onClick={() => setTimelineZoom(timeline.scale * 1.25)} />
          <WorkbenchIconButton className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')} label={t('timelineEditor.deleteSelected', { prefix: actionLabelPrefix })} icon={<IconTrash size={14} />} disabled={!hasSelection} onClick={() => removeSelectedTimelineClips()} />
          {onCollapse ? (
            <WorkbenchIconButton
              className={cn('workbench-timeline__tool', 'w-auto min-w-[30px] h-[var(--workbench-control-size)] px-2 inline-grid place-items-center border-0 rounded-[var(--workbench-control-radius)] bg-transparent text-[var(--workbench-muted)] shadow-none cursor-pointer hover:bg-[var(--workbench-hover)]')}
              label={t('timelineEditor.collapse', { prefix: actionLabelPrefix })}
              icon={<IconChevronDown size={14} />}
              onClick={onCollapse}
            />
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          'workbench-timeline__tracks',
          'relative min-w-0 min-h-0 block bg-transparent',
          'overflow-x-auto overflow-y-auto pb-2',
          'scrollbar-thin scrollbar-color-transparent',
          'hover:scrollbar-color-[color-mix(in_srgb,var(--nomi-ink)_22%,transparent)]',
        )}
        ref={tracksRef}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR
          setTimelineZoom(Math.min(TIMELINE_MAX_SCALE, Math.max(TIMELINE_MIN_SCALE, timeline.scale * factor)))
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 0 || splitMode) {
            setHoverFrame(null)
            return
          }
          setHoverFrame(frameFromClientX(e.clientX))
        }}
        onPointerLeave={() => setHoverFrame(null)}
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
            aria-label={t('timelineEditor.ruler')}
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
        {/* hover 幽灵播放头：半透明预告线，点击即落此处（真播放头由下方实线表达） */}
        {hoverFrame != null && Math.abs(hoverFrame - timeline.playheadFrame) > 0 ? (
          <div
            className={cn(
              'workbench-timeline__ghost-playhead',
              'absolute top-0 bottom-0 left-[var(--workbench-timeline-label-width)] z-[5]',
              'w-px bg-[var(--workbench-accent)] opacity-35 pointer-events-none',
            )}
            style={{ transform: `translateX(${frameToPixel(hoverFrame, timeline.scale)}px)` }}
            aria-hidden="true"
          />
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
            aria-label={t('timelineEditor.dragPlayhead')}
            title={t('timelineEditor.dragPlayhead')}
            onPointerDown={beginScrub}
          />
        </div>
        {/* 主次分层(方案 B)：画面(图/视频)主轨;配乐/字幕降副轨,空时收成「+配乐/+字幕」窄条。 */}
        {timeline.tracks.filter((t) => t.type !== 'audio').map((track) => (
          <TimelineTrack key={track.id} track={track} transitionFeedback={transitionFeedbackByTrack.get(track.id)} variant="primary" />
        ))}
        {(() => {
          const audioTrack = timeline.tracks.find((t) => t.type === 'audio')
          const audioHasClips = (audioTrack?.clips.length ?? 0) > 0
          const showAudioChip = Boolean(audioTrack) && !audioHasClips
          const showTextChip = showTextTrack
          return (
            <>
              {audioTrack && audioHasClips ? <TimelineTrack key={audioTrack.id} track={audioTrack} transitionFeedback={transitionFeedbackByTrack.get(audioTrack.id)} variant="secondary" /> : null}
              {showTextTrack ? <TimelineTextTrack /> : null}
              {showAudioChip || showTextChip ? <TimelineSecondaryAddRow showAudio={showAudioChip} showText={showTextChip} /> : null}
            </>
          )
        })()}
      </div>
    </section>
  )
}

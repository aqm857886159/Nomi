import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCopy,
  IconTrash,
  IconWand,
  IconMagnet,
  IconZoomOut,
  IconViewportWide,
  IconZoomIn,
  IconScissors,
} from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { computeTimelineDuration, resolveTimelineFitScale } from './timelineMath'
import TimelineTrack from './TimelineTrack'
import TimelineTextTrack from './TimelineTextTrack'
import { TimelineSecondaryAddRow } from './TimelineSecondaryAddRow'
import { frameToPixel, pixelToFrame, TIMELINE_MIN_SCALE, TIMELINE_MAX_SCALE } from './timelineEdit'
import { buildSnapPoints, resolveSnap, pixelThresholdToFrames } from './snapping'
import { toast } from '../../ui/toast'
import { reportAdoptionOutcome } from '../adoption/adoptionReceipt'
import { dispatchTimelineShortcut } from './timelineShortcuts'
import { groupTimelineTransitionFeedbackByTrack } from './timelineVisualFeedback'
import { TimelineContextMenu, type TimelineContextTarget } from './TimelineContextMenu'
import { TimelineShortcutsDialog } from './TimelineShortcutsDialog'
import { openTimelineTransitionPicker } from './openTransitionPicker'
import { ControlGroup } from '../preview/PreviewControlBar'

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

export default function TimelinePanel({ density = 'compact', regionLabel, actionLabelPrefix, showTextTrack = false, onCollapse: _onCollapse }: TimelinePanelProps): JSX.Element {
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
  // 吸附归 store（见 editingPanelLayoutSlice 里的说明）：两个 TimelinePanel 同时挂载，
  // 局部 state 会让键盘和工具条各翻各的。
  const snapEnabled = useWorkbenchStore((state) => state.timelineSnapEnabled)
  const setSnapEnabled = useWorkbenchStore((state) => state.setTimelineSnapEnabled)
  const [contextMenu, setContextMenu] = React.useState<{ target: TimelineContextTarget; x: number; y: number } | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)

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
          case 'toggle-snap': setSnapEnabled((enabled) => !enabled); break
          case 'zoom':
            setTimelineZoom(action.direction === 'fit'
              ? resolveTimelineFitScale(durationFrame, contentViewportWidth)
              : action.direction === 'in' ? timeline.scale * 1.25 : timeline.scale / 1.25)
            break
          case 'ripple-remove': if (primaryClipId) useWorkbenchStore.getState().removeTimelineClips([primaryClipId], true); break
          case 'remove-left': {
            const track = timeline.tracks.find((item) => item.clips.some((clip) => clip.id === primaryClipId))
            useWorkbenchStore.getState().removeTimelineClips((track?.clips ?? []).filter((clip) => clip.endFrame <= timeline.playheadFrame).map((clip) => clip.id), true)
            break
          }
          case 'remove-right': {
            const track = timeline.tracks.find((item) => item.clips.some((clip) => clip.id === primaryClipId))
            useWorkbenchStore.getState().removeTimelineClips((track?.clips ?? []).filter((clip) => clip.startFrame >= timeline.playheadFrame).map((clip) => clip.id), true)
            break
          }
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
    setSnapEnabled,
    setTimelineZoom,
    contentViewportWidth,
    durationFrame,
    timeline.scale,
    timeline.tracks,
    timeline.playheadFrame,
  ])

  const rulerContentRef = React.useRef<HTMLDivElement | null>(null)
  // hover 幽灵播放头：预告点击落点的半透明竖线。拖动中（buttons>0）与剪刀模式下隐藏（后者有 clip 级切点线）。
  const [hoverFrame, setHoverFrame] = React.useState<number | null>(null)

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
      if (!shiftKey && snapEnabled) {
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
  }, [frameFromClientX, snapEnabled])

  React.useEffect(() => {
    const onHelp = (event: KeyboardEvent) => {
      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault()
        setShortcutsOpen((open) => !open)
      }
      if (event.key === 'Escape') { setContextMenu(null); setShortcutsOpen(false) }
    }
    window.addEventListener('keydown', onHelp)
    return () => window.removeEventListener('keydown', onHelp)
  }, [])

  const handleContextMenu = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    const element = event.target as HTMLElement
    const clip = element.closest<HTMLElement>('[data-clip-id]')
    const text = element.closest<HTMLElement>('[data-text-clip-id]')
    const transition = element.closest<HTMLElement>('[data-timeline-transition]')
    const track = element.closest<HTMLElement>('[data-track-id]')
    const target: TimelineContextTarget | null = clip && track
      ? { kind: 'clip', clipId: clip.dataset.clipId ?? '', trackId: track.dataset.trackId ?? '' }
      : text
        ? { kind: 'text', textClipId: text.dataset.textClipId ?? '' }
        : transition
          ? { kind: 'transition', fromClipId: transition.dataset.transitionFrom ?? '', toClipId: transition.dataset.transitionTo ?? '' }
          : track
            ? { kind: 'track', trackId: track.dataset.trackId ?? '' }
            : null
    if (target) setContextMenu({ target, x: event.clientX, y: event.clientY })
  }, [])
  const handleRegenerate = React.useCallback((clipId: string) => {
    const clip = useWorkbenchStore.getState().timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId)
    if (!clip?.sourceNodeId) return
    void import('../generationCanvas/runner/generationRunController').then(({ regenerateNodeInPlace }) => regenerateNodeInPlace(clip.sourceNodeId))
  }, [])
  const handleChangeTransition = React.useCallback((fromClipId: string, toClipId: string) => {
    openTimelineTransitionPicker(fromClipId, toClipId)
  }, [])

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
        'absolute top-[10px] right-4 z-[8] inline-flex items-center gap-2',
        'bg-[color-mix(in_oklch,var(--nomi-paper)_84%,transparent)] rounded-[var(--nomi-radius-lg)] p-1 backdrop-blur-[10px]',
      )} role="toolbar" aria-label={t('timelineEditor.toolbarLabel')}>
        <div className="workbench-timeline__clip-tools">
        <ControlGroup label={t('timelineEditor.toolbar.thisSegment')} tone="clip" disabled={!hasSelection} disabledReason={t('timelineEditor.clipToolsHint')}>
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.context.split')} title={t('timelineEditor.context.splitShortcut')} icon={<IconScissors size={14} />} disabled={!primaryClipId} onClick={() => primaryClipId && splitTimelineClip(primaryClipId, timeline.playheadFrame)} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.context.duplicate')} title={t('timelineEditor.context.duplicateShortcut')} icon={<IconCopy size={14} />} disabled={!primaryClipId} onClick={() => duplicateTimelineClip(primaryClipId)} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.context.delete')} title={t('timelineEditor.context.deleteShortcut')} icon={<IconTrash size={14} />} disabled={!hasSelection} onClick={() => removeSelectedTimelineClips()} />
        </ControlGroup>
        </div>
        <ControlGroup label={t('timelineEditor.toolbar.wholeFilm')}>
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.aiArrange')} title={t('timelineEditor.aiArrangeShortcut')} icon={<IconWand size={14} />} onClick={handleAiArrange} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.undo')} title={t('timelineEditor.undoShortcut')} icon={<IconArrowBackUp size={14} />} disabled={!canUndo} onClick={() => undoTimeline()} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.redo')} title={t('timelineEditor.redoShortcut')} icon={<IconArrowForwardUp size={14} />} disabled={!canRedo} onClick={() => redoTimeline()} />
        </ControlGroup>
        <ControlGroup label={t('timelineEditor.toolbar.view')}>
          <WorkbenchIconButton className={cn(CLIP_TOOL_CLASS, snapEnabled && 'bg-[var(--workbench-accent-soft)] text-[var(--workbench-accent)]')} label={t('timelineEditor.snapToggle')} title={t('timelineEditor.snapShortcut')} icon={<IconMagnet size={14} />} onClick={() => setSnapEnabled((value) => !value)} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.zoomOut', { prefix: actionLabelPrefix })} title={t('timelineEditor.zoomOutShortcut')} icon={<IconZoomOut size={14} />} onClick={() => setTimelineZoom(timeline.scale / 1.25)} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.resetZoom')} title={t('timelineEditor.fitShortcut')} icon={<IconViewportWide size={14} />} onClick={() => setTimelineZoom(resolveTimelineFitScale(durationFrame, contentViewportWidth))} />
          <WorkbenchIconButton className={CLIP_TOOL_CLASS} label={t('timelineEditor.zoomIn', { prefix: actionLabelPrefix })} title={t('timelineEditor.zoomInShortcut')} icon={<IconZoomIn size={14} />} onClick={() => setTimelineZoom(timeline.scale * 1.25)} />
          <span className="min-w-8 text-center text-micro tabular-nums opacity-60">{Math.round(timeline.scale * 100)}%</span>
        </ControlGroup>
        <button type="button" className="grid h-7 w-7 place-items-center rounded-[var(--nomi-radius-sm)] text-micro text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)]" aria-label={t('timelineEditor.shortcuts.open')} title={t('timelineEditor.shortcuts.open')} onClick={() => setShortcutsOpen(true)}>?</button>
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
        onContextMenu={handleContextMenu}
        /*
         * 点轨道区空白处取消选中 —— 全站唯一一条「回到整片属性」的路。
         * 在这之前，一旦选中过任何片段，属性面板就永远停在那一段上：画幅、导出分辨率、
         * 配乐音量（合同 §2.3 的整片态）再也回不去了，除非把片段删掉或重开项目。
         * 这是所有 NLE 的通用手势，不需要额外的「取消选中」按钮。
         */
        onPointerDown={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('[data-clip-id], [data-text-clip-id], [data-timeline-transition], button, [role="menuitem"], [role="dialog"], .workbench-timeline__ruler-content')) return
          useWorkbenchStore.getState().setTimelineSelection([])
          useWorkbenchStore.getState().selectTimelineTextClip('')
        }}
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
        {contextMenu ? <TimelineContextMenu target={contextMenu.target} x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} onRegenerate={handleRegenerate} onChangeTransition={handleChangeTransition} onArrange={handleAiArrange} /> : null}
        {shortcutsOpen ? <TimelineShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      </div>
    </section>
  )
}

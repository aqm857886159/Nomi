import { AssistantPane } from '../AssistantPane'
import { assistantPaneWidth } from '../assistantWidthBounds'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronUp, IconLayoutList } from '@tabler/icons-react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../utils/cn'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import { useWorkbenchStore } from '../workbenchStore'
import TimelineMiniPreview from '../timeline/TimelineMiniPreview'
import TimelineResizeHandle from '../timeline/TimelineResizeHandle'

const TimelinePanel = lazyWithChunkBoundary(
  'i18n:generationCommon.workspace.timelineChunk',
  () => import('../timeline/TimelinePanel'),
)
import { computeTimelineDuration } from '../timeline/timelineMath'
import { resolveTimelineHandleLeft, type Interval } from './timelineHandlePlacement'

/**
 * 收起态时间轴手柄的水平落位（2026-09-10 走查反馈 #13 修正）。
 *
 * 手柄原来是 `left-1/2` 盲居中——agent 面板拖宽、画布变窄时中心跟着左移，压到底部
 * 已停靠的东西。这里量出画布内**其他**底部停靠区（`data-canvas-bottom-dock` 标记纪律，
 * 不含手柄自己）的横向区间，交给纯计算层在自由间隙里选离中心最近的落位。
 * 测量时机与 useCanvasBottomDockRects 同款：画布 Resize + 停靠区挂摘（childList），
 * rAF 合帧；不订子树，避免 React Flow 平移时逐帧重量。
 */
function useTimelineHandleLeft(
  canvasRef: React.RefObject<HTMLElement | null>,
  handleRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): number | null {
  const [left, setLeft] = React.useState<number | null>(null)
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    const handle = handleRef.current
    if (!enabled || !canvas || !handle) return undefined
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return undefined
    let frame = 0
    const measure = (): void => {
      frame = 0
      const width = canvas.clientWidth
      const handleWidth = handle.offsetWidth
      if (!(width > 0) || !(handleWidth > 0)) return
      const canvasRect = canvas.getBoundingClientRect()
      const docks: Interval[] = []
      for (const element of Array.from(canvas.querySelectorAll('[data-canvas-bottom-dock="true"]'))) {
        if (element === handle || element.contains(handle) || handle.contains(element)) continue
        const rect = element.getBoundingClientRect()
        if (!(rect.width > 0 && rect.height > 0)) continue
        docks.push({ left: rect.left - canvasRect.left, right: rect.right - canvasRect.left })
      }
      setLeft(resolveTimelineHandleLeft(width, docks, handleWidth))
    }
    const request = (): void => {
      if (frame) return
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    const resize = new ResizeObserver(request)
    resize.observe(canvas)
    const mutation = new MutationObserver(request)
    mutation.observe(canvas, { childList: true })
    return () => {
      resize.disconnect()
      mutation.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [enabled, canvasRef, handleRef])
  return left
}

type GenerationWorkspaceProps = {
  canvas: React.ReactNode
  aiCollapsed?: boolean
  agentDockRef?: React.Ref<HTMLDivElement>
}

const ASSISTANT_LAYOUT_SPRING = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.9,
} as const

export default function GenerationWorkspace({
  canvas,
  aiCollapsed = false,
  agentDockRef,
}: GenerationWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const width = useWorkbenchStore((s) => s.editingPanelLayout.assistantWidth)
  const timeline = useWorkbenchStore((s) => s.timeline)
  const reduceMotion = useReducedMotion()
  const timelineCollapsed = useWorkbenchStore((state) => state.timelinePanelCollapsed)
  const timelineHeight = useWorkbenchStore((state) => state.timelinePanelHeight)
  const setTimelineCollapsed = useWorkbenchStore((state) => state.setTimelinePanelCollapsed)
  // 折叠态悬浮把手的真实摘要：段数（含字幕/标题卡）+ 总时长，绝不编造。
  const timelineSummary = React.useMemo(() => {
    const clipCount =
      (timeline.tracks ?? []).reduce((sum, track) => sum + (track.clips?.length ?? 0), 0) +
      (timeline.textClips?.length ?? 0)
    const totalSeconds = Math.round(computeTimelineDuration(timeline) / Math.max(1, timeline.fps))
    const mm = Math.floor(totalSeconds / 60)
    const ss = String(totalSeconds % 60).padStart(2, '0')
    return { clipCount, durationLabel: `${mm}:${ss}` }
  }, [timeline])
  const assistantTargetWidth = `${assistantPaneWidth(width)}px`
  const hasAssistant = Boolean(agentDockRef)
  const canvasRef = React.useRef<HTMLDivElement | null>(null)
  const timelineHandleRef = React.useRef<HTMLButtonElement | null>(null)
  const timelineHandleLeft = useTimelineHandleLeft(canvasRef, timelineHandleRef, timelineCollapsed)
  const assistantColumnWidth = hasAssistant ? (aiCollapsed ? '0px' : assistantTargetWidth) : '0px'
  const isDockedAssistant = hasAssistant
  const workspaceStyle = {
    '--generation-assistant-width': assistantColumnWidth,
    '--generation-assistant-target-width': assistantTargetWidth,
    gridTemplateColumns: isDockedAssistant ? 'minmax(0,1fr) var(--generation-assistant-width)' : 'minmax(0,1fr)',
    gridTemplateRows: `minmax(0,1fr) ${timelineCollapsed ? '0px' : `${timelineHeight}px`}`,
    '--workbench-timeline-height': `${timelineHeight}px`,
  } as React.CSSProperties & {
    '--generation-assistant-width': string
    '--generation-assistant-target-width': string
    '--workbench-timeline-height': string
  }

  return (
    <motion.section
      className={cn(
        'workbench-generation',
        'relative',
        'grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--workbench-timeline-height)]',
        'w-full h-full overflow-hidden bg-[var(--workbench-bg)]',
      )}
      style={workspaceStyle}
      initial={false}
      animate={{ '--generation-assistant-width': assistantColumnWidth } as Record<string, string>}
      transition={reduceMotion ? { duration: 0 } : ASSISTANT_LAYOUT_SPRING}
      data-has-ai={hasAssistant ? 'true' : 'false'}
      data-ai-layout={hasAssistant ? (aiCollapsed ? 'overlay' : 'sidebar') : 'none'}
      aria-label={t('generationCommon.workspace.aria')}
    >
      <div
        ref={canvasRef}
        className={cn(
          'workbench-generation__canvas',
          'min-w-0 min-h-0 overflow-hidden border-b border-[var(--workbench-border)]',
          'relative',
        )}
      >
        {canvas}
        {/* 折叠态：底部居中把手——2026-08-06 曾挪到右下「避开中央编辑通道」，但用户拍板
            （2026-08-08 飞书反馈）时间轴是主时间观入口，应在底部中间。 */}
        {timelineCollapsed ? (
          <button
            ref={timelineHandleRef}
            type="button"
            className={cn(
              'workbench-generation__timeline-handle',
              'absolute bottom-3 z-[8]',
              // 2026-09-10 修正：不再盲居中——left 由 useTimelineHandleLeft 算出
              //（避开所有底部停靠区的自由间隙里离中心最近的位置）；测量未就绪时回退居中。
              timelineHandleLeft != null ? 'transition-[left] duration-nomi-fast' : 'left-1/2 -translate-x-1/2',
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
              'border border-[var(--workbench-border)] bg-nomi-paper shadow-workbench-pop',
              'text-body-sm font-medium text-nomi-ink',
              'transition-colors hover:bg-nomi-ink-05',
            )}
            style={timelineHandleLeft != null ? { left: timelineHandleLeft } : undefined}
            // 常驻底部：画布上的选择浮条得让开这一块（量法见
            // generationCanvas/reactFlow/useCanvasBottomDockRects.ts）。
            data-canvas-bottom-dock="true"
            aria-label={t('generationCommon.workspace.expandTimeline')}
            onClick={() => setTimelineCollapsed(false)}
          >
            <IconLayoutList size={15} stroke={1.8} className="text-nomi-ink-60" />
            <span>{t('generationCommon.workspace.timeline')}</span>
            <span className="text-nomi-ink-60">
              {t('generationCommon.workspace.clipSummary', {
                count: timelineSummary.clipCount,
                duration: timelineSummary.durationLabel,
              })}
            </span>
            <IconChevronUp size={15} stroke={1.8} className="text-nomi-ink-60" />
          </button>
        ) : null}
        {/* 时间轴展开时的迷你画面窗：跟播放头，治画布上盲剪（收起态自持久化）。 */}
        {timelineCollapsed ? null : <TimelineMiniPreview />}
      </div>
      {hasAssistant ? <AssistantPane dockRef={agentDockRef} collapsed={aiCollapsed} /> : null}
      {/* 2026-09-10 走查反馈：时间轴原先 col-span-full 横跨 agent 列，agent 面板
          弹簧动画改宽时时间轴跟着左右伸缩、盖住画布内容。时间轴是画布的时间观，
          只占画布列（col-start-1），agent 列与它解耦。 */}
      <div className={cn('workbench-generation__timeline', 'relative col-start-1 min-w-0 min-h-0')}>
        {timelineCollapsed ? null : (
          <>
            <TimelineResizeHandle />
            <React.Suspense fallback={null}>
              <TimelinePanel
                density="compact"
                regionLabel={t('generationCommon.workspace.timelineChunk')}
                actionLabelPrefix={t('generationCommon.workspace.timelineActionPrefix')}
                onCollapse={() => setTimelineCollapsed(true)}
              />
            </React.Suspense>
          </>
        )}
      </div>
    </motion.section>
  )
}

import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronUp, IconLayoutList } from '@tabler/icons-react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../utils/cn'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import { useWorkbenchStore } from '../workbenchStore'

const TimelinePanel = lazyWithChunkBoundary(
  'i18n:generationCommon.workspace.timelineChunk',
  () => import('../timeline/TimelinePanel'),
)
import { computeTimelineDuration } from '../timeline/timelineMath'

type GenerationWorkspaceProps = {
  canvas: React.ReactNode
  aiSidebar?: React.ReactNode
  aiLayout?: 'sidebar' | 'overlay'
}

const ASSISTANT_LAYOUT_SPRING = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.9,
} as const

export default function GenerationWorkspace({
  canvas,
  aiSidebar,
  aiLayout = 'sidebar',
}: GenerationWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const width = useWorkbenchStore((s) => s.assistantWidth)
  const setWidth = useWorkbenchStore((s) => s.setAssistantWidth)
  const timeline = useWorkbenchStore((s) => s.timeline)
  const reduceMotion = useReducedMotion()
  const [timelineCollapsed, setTimelineCollapsed] = React.useState(true)
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
  const dragRef = React.useRef<{ startX: number; startW: number } | null>(null)
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = { startX: e.clientX, startW: width }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [width],
  )
  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const st = dragRef.current
      if (!st) return
      // 右侧停靠：往左拖（clientX 变小）= 加宽。
      setWidth(st.startW + (st.startX - e.clientX))
    },
    [setWidth],
  )
  const endDrag = React.useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }, [])
  const assistantTargetWidth = `${width}px`
  const assistantColumnWidth = aiSidebar && aiLayout === 'sidebar' ? assistantTargetWidth : '0px'
  const isDockedAssistant = Boolean(aiSidebar) && aiLayout === 'sidebar'
  const workspaceStyle = {
    '--generation-assistant-width': assistantColumnWidth,
    '--generation-assistant-target-width': assistantTargetWidth,
    gridTemplateColumns: isDockedAssistant ? 'minmax(0,1fr) var(--generation-assistant-width)' : 'minmax(0,1fr)',
    gridTemplateRows: `minmax(0,1fr) ${timelineCollapsed ? '0px' : 'var(--workbench-timeline-height)'}`,
  } as React.CSSProperties & {
    '--generation-assistant-width': string
    '--generation-assistant-target-width': string
  }

  return (
    <motion.section
      className={cn(
        'workbench-generation',
        'grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--workbench-timeline-height)]',
        'w-full h-full overflow-hidden bg-[var(--workbench-bg)]',
        aiSidebar && aiLayout === 'overlay' && 'relative',
      )}
      style={workspaceStyle}
      initial={false}
      animate={{ '--generation-assistant-width': assistantColumnWidth } as Record<string, string>}
      transition={reduceMotion ? { duration: 0 } : ASSISTANT_LAYOUT_SPRING}
      data-has-ai={aiSidebar ? 'true' : 'false'}
      data-ai-layout={aiSidebar ? aiLayout : 'none'}
      aria-label={t('generationCommon.workspace.aria')}
    >
      <div
        className={cn(
          'workbench-generation__canvas',
          'min-w-0 min-h-0 overflow-hidden border-b border-[var(--workbench-border)]',
          'relative',
        )}
      >
        {canvas}
        {/* 折叠态：底部悬浮把手——画布吃满高度，把手给一眼可见的成片摘要 + 拉起入口。 */}
        {timelineCollapsed ? (
          <button
            type="button"
            className={cn(
              'workbench-generation__timeline-handle',
              'absolute bottom-3 left-1/2 z-[8] -translate-x-1/2',
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
              'border border-[var(--workbench-border)] bg-nomi-paper shadow-workbench-pop',
              'text-body-sm font-medium text-nomi-ink',
              'transition-colors hover:bg-nomi-ink-05',
            )}
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
      </div>
      {aiSidebar ? (
        <aside
          className={cn(
            'workbench-generation__ai relative',
            'grid min-w-0 min-h-0 overflow-hidden border-b border-[var(--workbench-border)]',
            aiLayout === 'overlay'
              ? 'absolute top-4 right-4 z-[80] block w-auto h-auto border-0 bg-transparent pointer-events-auto'
              : 'justify-items-end border-l border-l-[var(--workbench-border)] bg-[var(--workbench-surface)]',
          )}
          aria-label={t('generationCommon.workspace.assistantSidebar')}
        >
          {/* 左缘拖手柄：仅停靠态显示。 */}
          {aiLayout === 'sidebar' ? (
            <div
              role="separator"
              aria-label={t('generationCommon.workspace.resizeAssistant')}
              aria-orientation="vertical"
              className={cn(
                'group absolute left-0 top-0 bottom-0 z-10 w-2 -translate-x-1/2',
                'flex cursor-col-resize items-center justify-center touch-none',
              )}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span className={cn('h-8 w-[3px] rounded-full bg-nomi-ink-30 group-hover:bg-nomi-accent')} />
            </div>
          ) : null}
          {aiSidebar}
        </aside>
      ) : null}
      <div className={cn('workbench-generation__timeline', 'relative col-span-full min-w-0 min-h-0')}>
        {timelineCollapsed ? null : (
          <React.Suspense fallback={null}>
            <TimelinePanel
              density="compact"
              regionLabel={t('generationCommon.workspace.timelineChunk')}
              actionLabelPrefix={t('generationCommon.workspace.timelineActionPrefix')}
              onCollapse={() => setTimelineCollapsed(true)}
            />
          </React.Suspense>
        )}
      </div>
    </motion.section>
  )
}

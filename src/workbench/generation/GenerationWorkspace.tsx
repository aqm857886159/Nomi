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
            type="button"
            className={cn(
              'workbench-generation__timeline-handle',
              'absolute bottom-3 left-1/2 -translate-x-1/2 z-[8]',
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
              'border border-[var(--workbench-border)] bg-nomi-paper shadow-workbench-pop',
              'text-body-sm font-medium text-nomi-ink',
              'transition-colors hover:bg-nomi-ink-05',
            )}
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

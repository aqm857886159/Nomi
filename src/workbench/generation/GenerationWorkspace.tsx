import { AssistantPane } from '../AssistantPane'
import { assistantPaneWidth } from '../assistantWidthBounds'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronUp, IconLayoutList } from '@tabler/icons-react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../utils/cn'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import { useWorkbenchStore } from '../workbenchStore'
import TimelineMiniPreview from '../timeline/TimelineMiniPreview'
import TimelineResizeHandle from '../timeline/TimelineResizeHandle'
import { TimelineStrip } from './TimelineStrip'

const TimelinePanel = lazyWithChunkBoundary(
  'i18n:generationCommon.workspace.timelineChunk',
  () => import('../timeline/TimelinePanel'),
)
import { useGenerationViewStore } from './list/generationViewStore'

const loadGenerationListView = () => import('./list/GenerationListView').then((module) => ({ default: module.GenerationListView }))
const GenerationListView = lazyWithChunkBoundary('i18n:generationList.aria', loadGenerationListView)

type GenerationWorkspaceProps = {
  canvas: React.ReactNode
  aiCollapsed?: boolean
  agentDockRef?: React.Ref<HTMLDivElement>
  /**
   * Agent 小球 / 浮窗的坐标系（10-08 外壳重设计）：画布那一格、不含底边时间轴窄条——
   * 小球、浮窗、加节点条、缩放条都在这一格里，天然给时间轴让位，不靠偏移量兜底。
   */
  agentLayerRef?: React.Ref<HTMLDivElement>
}

const ASSISTANT_LAYOUT_SPRING = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.9,
} as const

/**
 * 生成页（10-08 外壳拍板稿 Main / CanvasAgent）：被外壳底色包住的圆角工作面。
 *
 *   ┌ 画布工作面 ───────────────────────┐┌ Agent（停靠时）┐
 *   │ 画布（加节点条 / 缩放 / 小球 / 浮窗都在这一格）││               │
 *   │ 时间轴窄条（收起时：段数 · 时长 · 缩略图 · ^）  ││               │
 *   └──────────────────────────────┘└───────────────┘
 *   ┌ 时间轴面板（展开时横贯整个工作区，Agent 被它顶上去：09-14 用户拍板）┐
 */
export default function GenerationWorkspace({
  canvas,
  aiCollapsed = false,
  agentDockRef,
  agentLayerRef,
}: GenerationWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const width = useWorkbenchStore((s) => s.editingPanelLayout.assistantWidth)
  const reduceMotion = useReducedMotion()
  const timelineCollapsed = useWorkbenchStore((state) => state.timelinePanelCollapsed)
  const timelineHeight = useWorkbenchStore((state) => state.timelinePanelHeight)
  const setTimelineCollapsed = useWorkbenchStore((state) => state.setTimelinePanelCollapsed)
  const assistantTargetWidth = `${assistantPaneWidth(width)}px`
  const hasAssistant = Boolean(agentDockRef)
  // 「画布 | 列表」：画布始终挂着（落地宿主跟着它常驻、视口不重算），列表开着时画布只是不可见、不可交互。
  const generationView = useGenerationViewStore((state) => state.view)
  const listOpen = generationView === 'list'
  // 列表块在生成页挂好后趁空闲先拉一下：第一次点「列表」不再等块下载 + 解析（200 节点实测的一部分）。
  React.useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void })
    if (typeof idle.requestIdleCallback !== 'function') return undefined
    const handle = idle.requestIdleCallback(() => { void loadGenerationListView().catch(() => undefined) }, { timeout: 4000 })
    return () => idle.cancelIdleCallback?.(handle)
  }, [])
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
        'w-full h-full overflow-hidden bg-nomi-chrome',
      )}
      style={workspaceStyle}
      initial={false}
      animate={{ '--generation-assistant-width': assistantColumnWidth } as Record<string, string>}
      transition={reduceMotion ? { duration: 0 } : ASSISTANT_LAYOUT_SPRING}
      data-has-ai={hasAssistant ? 'true' : 'false'}
      data-ai-layout={hasAssistant ? (aiCollapsed ? 'overlay' : 'sidebar') : 'none'}
      aria-label={t('generationCommon.workspace.aria')}
    >
      {/* 画布工作面：圆角、外壳底色包住，层次靠底色不靠线。 */}
      <div
        className={cn(
          'workbench-generation__surface',
          'row-start-1 row-end-2 col-start-1 col-end-2',
          'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel bg-[var(--workbench-bg)] ring-1 ring-nomi-line-soft',
        )}
      >
        <div className={cn('workbench-generation__canvas', 'relative min-h-0 min-w-0 flex-1 overflow-hidden')}>
          {/* 「画布 | 列表」：画布始终挂着（落地宿主跟着它常驻、视口不重算），列表开着时画布只是不可见、不可交互。 */}
          <div className={cn('absolute inset-0', listOpen && 'invisible [content-visibility:hidden]')} inert={listOpen} data-generation-canvas-surface>
            {canvas}
          </div>
          {listOpen ? (
            <div className="absolute inset-0 z-[8]">
              <React.Suspense fallback={null}>
                <GenerationListView />
              </React.Suspense>
            </div>
          ) : null}
          {/* 时间轴展开时的迷你画面窗：跟播放头，治画布上盲剪（收起态自持久化）。 */}
          {timelineCollapsed ? null : <TimelineMiniPreview />}
          {/* Agent 小球 / 浮窗住这一层（外壳的 ShellAgentHost portal 进来）。 */}
          <div ref={agentLayerRef} className="pointer-events-none absolute inset-0 z-[60]" data-generation-agent-layer />
        </div>
        {/* 时间轴收起 = 贴工作面底边的窄条（段数 · 时长 · 每段小缩略图 · ^ 展开），不再是一颗浮在画布上的胶囊。 */}
        {timelineCollapsed ? (
          <TimelineStrip
            onExpand={() => setTimelineCollapsed(false)}
            label={t('generationCommon.workspace.timeline')}
            expandLabel={t('generationCommon.workspace.expandTimeline')}
            icon={<IconLayoutList size={16} stroke={1.5} />}
            expandIcon={<IconChevronUp size={16} stroke={1.5} />}
          />
        ) : null}
      </div>
      {/* 面板的落位由外壳给，两态都写明（停靠 = 内容行第 2 列；收起 = 内容行横跨两列的空壳，小球 / 浮窗不住这里）。 */}
      {hasAssistant ? (
        <AssistantPane
          dockRef={agentDockRef}
          collapsed={aiCollapsed}
          className={aiCollapsed ? 'row-start-1 row-end-2 col-span-full' : 'row-start-1 row-end-2 col-start-2'}
        />
      ) : null}
      {/* 时间轴展开时横贯整个工作区（`grid-column: 1 / -1`），面板被它顶上去（09-14 用户拍板）。
          容器关系由 generationWorkspaceLayout.structure.test.ts 锁住。 */}
      <div className={cn('workbench-generation__timeline', 'relative col-span-full min-w-0 min-h-0', !timelineCollapsed && 'pt-2')}>
        {timelineCollapsed ? null : (
          <div className="relative h-full min-h-0 overflow-hidden rounded-panel bg-nomi-paper ring-1 ring-nomi-line-soft">
            <TimelineResizeHandle />
            <React.Suspense fallback={null}>
              <TimelinePanel
                density="compact"
                regionLabel={t('generationCommon.workspace.timelineChunk')}
                actionLabelPrefix={t('generationCommon.workspace.timelineActionPrefix')}
                onCollapse={() => setTimelineCollapsed(true)}
              />
            </React.Suspense>
          </div>
        )}
      </div>
    </motion.section>
  )
}

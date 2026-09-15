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
import { collectBottomDockRects, resolveBottomDockScope } from './workspaceBottomDocks'

/**
 * 收起态时间轴手柄的水平落位（2026-09-10 走查反馈 #13 修正）。
 *
 * 手柄原来是 `left-1/2` 盲居中——agent 面板拖宽、画布变窄时中心跟着左移，压到底部
 * 已停靠的东西。这里量出**其他**底部停靠区（不含手柄自己）的横向区间，
 * 交给纯计算层在自由间隙里选离中心最近的落位。
 *
 * 2026-09-13 修：避让范围从「画布这棵子树」上移到**外壳**（owner 见
 * `workspaceBottomDocks.ts`）。原来查的是 `canvas.querySelectorAll(...)`，而 Nomi 面板
 * 收起后那条浮起的输入条是工作区的孩子、不是画布的孩子——它在避让名单里根本不存在，
 * 于是时间轴收起后胶囊按「底部居中」正好落在它下面，用户点不到、也就叫不回时间轴。
 *
 * 重量时机：工作区 Resize + 停靠区挂摘（childList），rAF 合帧；不订子树，避免
 * React Flow 平移时逐帧重量。另外把 `dockRevision` 当显式信号——收起坞的挂摘发生在
 * 外壳的**孙子**层，childList 看不见它，而它的挂摘完全由状态决定，状态比观察更准。
 */
function useTimelineHandleLeft(
  canvasRef: React.RefObject<HTMLElement | null>,
  handleRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  dockRevision: unknown,
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
      const docks: Interval[] = collectBottomDockRects(canvas, canvasRect, handle)
      setLeft(resolveTimelineHandleLeft(width, docks, handleWidth))
    }
    const request = (): void => {
      if (frame) return
      frame = window.requestAnimationFrame(measure)
    }
    measure()
    const scope = resolveBottomDockScope(canvas)
    const resize = new ResizeObserver(request)
    resize.observe(canvas)
    if (scope !== canvas) resize.observe(scope)
    const mutation = new MutationObserver(request)
    mutation.observe(canvas, { childList: true })
    if (scope !== canvas) mutation.observe(scope, { childList: true })
    return () => {
      resize.disconnect()
      mutation.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [enabled, canvasRef, handleRef, dockRevision])
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
  const timelineHandleLeft = useTimelineHandleLeft(canvasRef, timelineHandleRef, timelineCollapsed, aiCollapsed)
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
            // 它是**让位者**：自己的 left 就是从停靠区名单算出来的，所以 Nomi 收起坞
            // 算空当时要跳过它——否则两边互相把对方当障碍，位置不收敛（见
            // workspaceBottomDocks.ts 的 BOTTOM_DOCK_AVOIDER_ATTR）。
            data-bottom-dock-avoids="true"
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
      {/* 面板的落位由外壳给，两态都写明，不靠自动落位：
          · 停靠态 = 内容行第 2 列（被底部带顶上去，和画布同一行）；
          · 收起态 = **内容行**横跨两列。收起时 aside 变成 `absolute inset-0` 的浮层，
            而作为网格容器的直接子节点 + 确定的网格落位，它的包含块就是这一格网格区域
            （CSS Grid 绝对定位规则）——于是那条浮起的输入条锚的是「内容行的下沿」，
            不是「整个工作区的下沿」。这就是 09-13 那条「收起 Nomi 后输入条压住时间轴」
            的根因：它过去锚在整个工作区上，因为没有任何一层说过它属于内容行。
            不给输入条加 z-index / bottom 偏移兜底——那是把外壳的责任推给被摆的人。

            两条轴都必须写**起止两端**（`row-start-1 row-end-2`，不能只写 start）：
            规则是「某一轴的落位是 auto 时，该轴那两条边退回网格容器的 padding 边」。
            只写 `row-start-1` 时实测量到的仍是整个工作区（top=56 对、bottom=933 错，
            底部带顶边在 703）——差一个 `row-end` 就等于这条修法没生效，而界面上
            看不出区别，只有量才看得出来。 */}
      {hasAssistant ? (
        <AssistantPane
          dockRef={agentDockRef}
          collapsed={aiCollapsed}
          className={aiCollapsed ? 'row-start-1 row-end-2 col-span-full' : 'row-start-1 row-end-2 col-start-2'}
        />
      ) : null}
      {/* 时间轴横贯整个底部（`grid-column: 1 / -1`），面板被它顶上去。
          这是迁移前的规格（`git show 8f9365aeb:src/workbench/generation/GenerationWorkspace.tsx:177`），
          2026-09-14 用户再次拍板恢复。d2bb622c1 曾把它收进画布那一列，理由写的是
          「面板弹簧动画时时间轴跟着左右伸缩」——那条理由反了：横贯两列时宽度 = 两列之和
          = 工作区宽，与 `--generation-assistant-width` 无关、动画期间也是常量；会随面板
          伸缩的恰恰是只占一列的那一版。收进一列的真实后果是第 2 行第 2 格没有任何内容，
          用户看到的就是「右下角缺了一大块」（09-13 19:27 截图）。
          容器关系由 generationWorkspaceLayout.structure.test.ts 与
          tests/ux/layout-timeline-panel-span.walk.mjs 两头锁住，不再是一串改错不会红的类名。 */}
      <div className={cn('workbench-generation__timeline', 'relative col-span-full min-w-0 min-h-0')}>
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

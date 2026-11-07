import { workspaceInputSurfaceIsActive } from '../shortcutSurface'
import { AssistantPane } from '../AssistantPane'
import { assistantPaneWidth } from '../assistantWidthBounds'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, useGroupRef, usePanelRef, type GroupImperativeHandle, type Layout, type LayoutChangedMeta } from 'react-resizable-panels'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import TimelinePanel from '../timeline/TimelinePanel'
import { computeTimelineDuration, resolveActiveClipsAtFrame } from '../timeline/timelineMath'
import TimelinePreview from './TimelinePreview'
import PreviewSourcePanel from './PreviewSourcePanel'
import PreviewInspector from './inspector/PreviewInspector'
import {
  EDITING_PANEL_BOUNDS,
  EDITING_PANEL_RAIL_WIDTH,
  editingPanelDragIntent,
  editingSidePanelDrawnOpen,
  resolveEditingStageFrame,
  resolveEditingTimelineHeight,
  type EditingSidePanel,
} from './panelLayout'
import { useTimelinePlaybackClock } from '../timeline/useTimelinePlaybackClock'

// 剪辑面板系统（合同 §2.1 布局 C′）。
//
// 两份东西、各一个出处（2026-11-04 窄窗修复）：
//  · 用户想要的开合与宽度：workbenchStore.editingPanelLayout（Agent `layout.read/write` 的契约、随项目落盘）。
//  · 这一刻实际怎么摆：resolveEditingStageFrame(舞台行宽, 意图, 放不下时留哪边) 派生，不存储。
//    面板库只吃这份（整组 setLayout），栏里画展开还是收起条按面板的真实宽度（不到最小宽就画收起条）。
// 此前两份各说各的：栏里画什么读存档开关、多宽由面板库按空间算，1280 宽开着 Nomi 时三栏最小宽 920 > 舞台 814，
// 面板库把左栏吸成 32px，栏里仍画展开内容，空态一字一行竖排。
//
// 回写存档只有一个口：用户亲手拖完分隔条（Group.onLayoutChanged 的 isUserInteraction），规则见 editingPanelDragIntent。
// 窗口变窄、开关 Nomi、约束重算都不写存档——它们不是用户改主意（同 assistantWidthBounds「窄窗不偷改当前宽」）。
// 两侧栏 preserve-pixel-size：容器变宽变窄，差额全给预览。
//
// 顶栏「布局」菜单与「导出 MP4」不在这里：合同 §2.2 要求它们固定在**应用顶栏右上**，
// 见 40px 合一顶栏（ShellTopBar）预览页右簇的「布局」与「导出 MP4」。

type PreviewWorkspaceProps = { aiCollapsed?: boolean; agentDockRef?: React.Ref<HTMLDivElement> }

const STAGE_PANEL = { source: 'editing-surface-source', preview: 'editing-surface-preview', inspector: 'editing-surface-inspector' } as const
const COLUMN_PANEL = { stage: 'editing-surface-stage', timeline: 'editing-surface-timeline' } as const
/** 套上去的布局和要求的差多少像素算没套上；没套上就下一帧再套，最多这么多帧（面板库改约束要多渲染一轮才生效）。 */
const APPLY_TOLERANCE_PX = 1
const APPLY_ATTEMPTS = 3

function SplitHandle({ vertical = false, onGrab }: { vertical?: boolean; onGrab?: () => void }): JSX.Element {
  return (
    <Separator
      className={cn(
        'group relative z-10 flex flex-none items-center justify-center bg-[var(--workbench-border)]',
        vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      )}
      onPointerDown={onGrab}
      onKeyDown={onGrab}
    >
      <span
        className={cn(
          'rounded-pill bg-[var(--workbench-muted-soft)] opacity-0 transition-opacity group-hover:opacity-100',
          vertical ? 'h-8 w-1' : 'h-1 w-16',
        )}
      />
    </Separator>
  )
}

/** 一个面板组里各面板长度之和——面板库算百分比的基数（不含分隔条）。组没量到（页面藏着）是 0。 */
function useGroupExtent(groupElement: React.RefObject<HTMLDivElement | null>, axis: 'width' | 'height'): number {
  const [extent, setExtent] = React.useState(0)
  React.useLayoutEffect(() => {
    const element = groupElement.current
    if (!element) return undefined
    const measure = () => {
      let sum = 0
      for (const child of Array.from(element.children)) {
        if (child instanceof HTMLElement && child.hasAttribute('data-panel')) sum += axis === 'width' ? child.offsetWidth : child.offsetHeight
      }
      setExtent(sum)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [groupElement, axis])
  return extent
}

/** 把一组像素长度（按面板顺序）一次交给面板库。 */
function useApplyGroupLayout(group: React.RefObject<GroupImperativeHandle | null>, extent: number, sizes: ReadonlyArray<readonly [string, number]> | null): void {
  const latest = React.useRef({ extent, sizes })
  latest.current = { extent, sizes }
  const signature = sizes && extent > 0 ? `${extent}|${sizes.map(([id, pixels]) => `${id}:${pixels}`).join('|')}` : ''
  React.useLayoutEffect(() => {
    if (!signature) return undefined
    const { extent: total, sizes: wanted } = latest.current
    if (!wanted || total <= 0) return undefined
    const requested: Layout = Object.fromEntries(wanted.map(([id, pixels]) => [id, (pixels / total) * 100]))
    let frame = 0
    let attempts = APPLY_ATTEMPTS
    const apply = () => {
      const handle = group.current
      if (!handle) return
      const applied = handle.setLayout(requested)
      attempts -= 1
      const missed = wanted.some(([id]) => Math.abs((applied[id] ?? 0) - requested[id]) * total / 100 > APPLY_TOLERANCE_PX)
      if (missed && attempts > 0) frame = requestAnimationFrame(apply)
    }
    apply()
    return () => cancelAnimationFrame(frame)
  }, [group, signature])
}

export default function PreviewWorkspace({ aiCollapsed = false, agentDockRef }: PreviewWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const timeline = useWorkbenchStore((state) => state.timeline)
  const playheadFrame = useWorkbenchStore((state) => state.timeline.playheadFrame)
  const playing = useWorkbenchStore((state) => state.timelinePlaying)
  const previewAspectRatio = useWorkbenchStore((state) => state.previewAspectRatio)
  const setTimelinePlaying = useWorkbenchStore((state) => state.setTimelinePlaying)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const layout = useWorkbenchStore((state) => state.editingPanelLayout)
  const keep = useWorkbenchStore((state) => state.editingPanelKeep)
  const syncSize = useWorkbenchStore((state) => state.syncEditingPanelSize)
  const markCustom = useWorkbenchStore((state) => state.markEditingPanelLayoutCustom)
  const showEditingPanel = useWorkbenchStore((state) => state.showEditingPanel)
  const keepEditingPanel = useWorkbenchStore((state) => state.keepEditingPanel)
  const setEditingPanelLayout = useWorkbenchStore((state) => state.setEditingPanelLayout)
  const undoEditingPanelLayout = useWorkbenchStore((state) => state.undoEditingPanelLayout)
  const inputHostRef = React.useRef<HTMLElement | null>(null)
  const sourcePanelRef = usePanelRef()
  const inspectorPanelRef = usePanelRef()
  const timelinePanelRef = usePanelRef()
  const stageGroupRef = useGroupRef()
  const columnGroupRef = useGroupRef()
  const stageRowElementRef = React.useRef<HTMLDivElement | null>(null)
  const columnElementRef = React.useRef<HTMLDivElement | null>(null)
  // defaultSize 只是挂载那一帧的初值；之后每一刻的布局都由下面的求解结果整组套上去。
  const initialLayout = React.useRef(layout).current
  const durationFrame = React.useMemo(() => computeTimelineDuration(timeline), [timeline])
  const activeClips = React.useMemo(() => resolveActiveClipsAtFrame(timeline, playheadFrame), [timeline, playheadFrame])
  const assistantVisible = layout.visibility.assistant && !aiCollapsed

  useTimelinePlaybackClock({ playing, playheadFrame, durationFrame, fps: timeline.fps, onPlayheadChange: setTimelinePlayhead, onPlayingChange: setTimelinePlaying })

  const panelsWidth = useGroupExtent(stageRowElementRef, 'width')
  const columnHeight = useGroupExtent(columnElementRef, 'height')
  const frame = React.useMemo(
    () => (panelsWidth > 0 ? resolveEditingStageFrame({ panelsWidth, layout: { sourceWidth: layout.sourceWidth, inspectorWidth: layout.inspectorWidth, visibility: layout.visibility }, keep }) : null),
    [panelsWidth, layout.sourceWidth, layout.inspectorWidth, layout.visibility, keep],
  )
  const frameRef = React.useRef(frame)
  frameRef.current = frame
  useApplyGroupLayout(stageGroupRef, panelsWidth, frame ? [
    [STAGE_PANEL.source, frame.source.width],
    [STAGE_PANEL.preview, frame.preview],
    [STAGE_PANEL.inspector, frame.inspector.width],
  ] : null)
  const timelineHeight = columnHeight > 0 ? resolveEditingTimelineHeight(columnHeight, layout.timelineHeight) : 0
  useApplyGroupLayout(columnGroupRef, columnHeight, timelineHeight > 0 ? [
    [COLUMN_PANEL.stage, columnHeight - timelineHeight],
    [COLUMN_PANEL.timeline, timelineHeight],
  ] : null)

  // 栏里画展开还是收起条，按面板此刻的真实宽度：不到最小宽就画收起条，展开内容永远不挤进窄列。
  const [drawnOpen, setDrawnOpen] = React.useState<Record<EditingSidePanel, boolean>>(() => ({ source: layout.visibility.source, inspector: layout.visibility.inspector }))
  const onSideResize = React.useCallback((panel: EditingSidePanel, pixels: number) => {
    const open = editingSidePanelDrawnOpen(panel, pixels)
    setDrawnOpen((previous) => (previous[panel] === open ? previous : { ...previous, [panel]: open }))
  }, [])

  // 用户抓的是哪条分隔线：拖宽哪一栏，放不下时就留哪一栏（不从布局变化里猜）。
  const grabbedRef = React.useRef<EditingSidePanel | null>(null)
  const onStageLayoutChanged = React.useCallback((_layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return
    markCustom()
    const current = frameRef.current
    const source = sourcePanelRef.current?.getSize().inPixels
    const inspector = inspectorPanelRef.current?.getSize().inPixels
    if (!current || source === undefined || inspector === undefined) return
    const intent = editingPanelDragIntent(current, { source, inspector }, grabbedRef.current)
    if (Object.keys(intent.sizes).length > 0) syncSize(intent.sizes)
    if (Object.keys(intent.visibility).length > 0) setEditingPanelLayout({ visibility: intent.visibility })
    if (intent.keep) keepEditingPanel(intent.keep)
  }, [inspectorPanelRef, keepEditingPanel, markCustom, setEditingPanelLayout, sourcePanelRef, syncSize])
  const onColumnLayoutChanged = React.useCallback((_layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return
    markCustom()
    const height = timelinePanelRef.current?.getSize().inPixels
    if (height !== undefined) syncSize({ timelineHeight: Math.round(height) })
  }, [markCustom, syncSize, timelinePanelRef])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!workspaceInputSurfaceIsActive(inputHostRef.current)) return
      // ⌘\ 收 Agent 搬到外壳（ShellAgentHost）：四个面统一「停靠 ↔ 小球」，这里只留面板布局撤销。
      if (event.metaKey && event.key.toLowerCase() === 'z' && undoEditingPanelLayout()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoEditingPanelLayout])

  return (
    <section
      ref={inputHostRef}
      className="workbench-preview relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-nomi-chrome"
      aria-label={t('workspace.preview')}
    >
      {/* 行模板必须写：不写就是隐式 auto 行，行高按内容定。预览页开着时窗口从 900 缩到 720，内容还按上一次的高摆着，
          这一行就留在原来的 852 高，Nomi 栏里付费卡的「生成」和时间轴掉出窗外、又没有滚动（实测）
          （2026-11-07 窄窗拍板 F2 / preview.grid-rows；四个工作区根网格同一条，见 workspaceRootGrid.structure.test.ts）。 */}
      <div className="grid h-full w-full min-w-0" id="editing-surface-root"
        style={{ gridTemplateColumns: assistantVisible ? `minmax(0,1fr) ${assistantPaneWidth(layout.assistantWidth)}px` : 'minmax(0,1fr)', gridTemplateRows: 'minmax(0,1fr)' }}>
        <div className="min-h-0 min-w-0 overflow-hidden rounded-panel bg-[var(--workbench-bg)] ring-1 ring-nomi-line-soft" id="editing-surface-main">
          <Group orientation="vertical" className="h-full" id="editing-surface-left" groupRef={columnGroupRef} elementRef={columnElementRef} onLayoutChanged={onColumnLayoutChanged}>
            <Panel id={COLUMN_PANEL.stage} minSize={EDITING_PANEL_BOUNDS.stage.min}>
              <Group orientation="horizontal" className="h-full" id="editing-surface-stage-row" groupRef={stageGroupRef} elementRef={stageRowElementRef} onLayoutChanged={onStageLayoutChanged}>
                {/* 剪辑页左边那栏「镜头 / 素材」原样保留（协调裁决：外壳只搬容器、不拆内容；布局菜单与 Agent 的 layout 契约都还认它）。
                    同样的「拖进时间轴 / 点击追加」也在左栏「目录」抽屉里（第 32 项）。 */}
                <Panel
                  id={STAGE_PANEL.source}
                  panelRef={sourcePanelRef}
                  defaultSize={initialLayout.sourceWidth}
                  minSize={EDITING_PANEL_BOUNDS.source.min}
                  maxSize={EDITING_PANEL_BOUNDS.source.max}
                  collapsible
                  collapsedSize={EDITING_PANEL_RAIL_WIDTH}
                  groupResizeBehavior="preserve-pixel-size"
                  onResize={(size) => onSideResize('source', size.inPixels)}
                >
                  <div className="h-full min-w-0 overflow-hidden">
                    <PreviewSourcePanel
                      collapsed={!drawnOpen.source}
                      onExpand={() => showEditingPanel('source', true)}
                      onCollapse={() => showEditingPanel('source', false)}
                    />
                  </div>
                </Panel>
                <SplitHandle vertical onGrab={() => { grabbedRef.current = 'source' }} />
                <Panel id={STAGE_PANEL.preview} minSize={frame?.previewMin ?? EDITING_PANEL_BOUNDS.preview.min}>
                  <div className="relative h-full min-w-0 overflow-hidden">
                    <TimelinePreview
                      activeClips={activeClips}
                      aspectRatio={previewAspectRatio}
                      fps={timeline.fps}
                      playheadFrame={timeline.playheadFrame}
                      timeline={timeline}
                    />
                  </div>
                </Panel>
                <SplitHandle vertical onGrab={() => { grabbedRef.current = 'inspector' }} />
                <Panel
                  id={STAGE_PANEL.inspector}
                  panelRef={inspectorPanelRef}
                  defaultSize={initialLayout.inspectorWidth}
                  minSize={EDITING_PANEL_BOUNDS.inspector.min}
                  maxSize={EDITING_PANEL_BOUNDS.inspector.max}
                  collapsible
                  collapsedSize={EDITING_PANEL_RAIL_WIDTH}
                  groupResizeBehavior="preserve-pixel-size"
                  onResize={(size) => onSideResize('inspector', size.inPixels)}
                >
                  <PreviewInspector
                    timeline={timeline}
                    collapsed={!drawnOpen.inspector}
                    onExpand={() => showEditingPanel('inspector', true)}
                    onCollapse={() => showEditingPanel('inspector', false)}
                  />
                </Panel>
              </Group>
            </Panel>
            <SplitHandle />
            <Panel
              id={COLUMN_PANEL.timeline}
              panelRef={timelinePanelRef}
              defaultSize={initialLayout.timelineHeight}
              minSize={EDITING_PANEL_BOUNDS.timeline.min}
              maxSize={EDITING_PANEL_BOUNDS.timeline.max}
              groupResizeBehavior="preserve-pixel-size"
            >
              <div className="relative h-full min-h-0 min-w-0 overflow-hidden border-t border-[var(--workbench-border)]">
                <TimelinePanel
                  density="full"
                  regionLabel={t('timelinePreview.timelineRegion')}
                  actionLabelPrefix={t('timelinePreview.timelineActionPrefix')}
                  showTextTrack
                />
              </div>
            </Panel>
          </Group>
        </div>
          {assistantVisible ? (
            <aside
              id="editing-surface-assistant"
              data-testid="editing-surface-assistant"
              className="relative h-full min-w-0"
              aria-label={t('timelinePreview.previewLayout.panels.assistant')}
            >
              <AssistantPane dockRef={agentDockRef} />
            </aside>
          ) : null}
      </div>
    </section>
  )
}

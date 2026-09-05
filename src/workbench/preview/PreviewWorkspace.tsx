import React from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import { IconMessageCircle } from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import TimelinePanel from '../timeline/TimelinePanel'
import { computeTimelineDuration, resolveActiveClipsAtFrame } from '../timeline/timelineMath'
import TimelinePreview from './TimelinePreview'
import PreviewSourcePanel from './PreviewSourcePanel'
import PreviewInspector from './inspector/PreviewInspector'
import { PanelRail } from './PanelRail'
import { EDITING_PANEL_BOUNDS, EDITING_PANEL_MAIN_MIN, EDITING_PANEL_RAIL_WIDTH, type EditingPanelSizeKey } from './panelLayout'
import { useTimelinePlaybackClock } from '../timeline/useTimelinePlaybackClock'

// 剪辑面板系统（合同 §2.1 布局 C′）。
//
// 一条真相：面板像素尺寸住在 workbenchStore.editingPanelLayout（它同时是 Agent `layout.read/write`
// 的契约、也是随项目落盘的那份）。react-resizable-panels v4 的尺寸 prop 直接吃像素数字
// （`defaultSize={300}` = 300px，字符串才是百分比），所以合同里那张「300 / 240 / 390 / 260 · 最小
// 240 / 200 / 320 / 140」的表可以逐字落成 props，不再靠百分比换算——上一版把 300px 写成 18%，
// 在实际宽度下算出 232px < 240px 最小值，左栏于是被压到 tab 文字截断成「素」。
//
// 回写只有一个口：Panel.onResize → syncEditingPanelSize（纯镜像）。用户手拖才把 preset 标成
// 'custom'，判据是 Group.onLayoutChanged 的 isUserInteraction——程序化 resize（切预设、恢复
// 落盘布局）不会误标。
//
// 顶栏「布局」菜单与「导出 MP4」不在这里：合同 §2.2 要求它们固定在**应用顶栏右上**，
// 见 NomiAppBar 的 layout / primary 两组。

type PreviewWorkspaceProps = { aiCollapsed?: boolean; agentDockRef?: React.Ref<HTMLDivElement> }

function SplitHandle({ vertical = false }: { vertical?: boolean }): JSX.Element {
  return (
    <Separator
      className={cn(
        'group relative z-10 flex flex-none items-center justify-center bg-[var(--workbench-border)]',
        vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      )}
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

type PanelTarget = {
  ref: React.RefObject<PanelImperativeHandle | null>
  /** 面板根 div，用来量**渲染后的真实像素**——见 usePanelLayoutSync 里为什么不能只信 resize()。 */
  element: React.MutableRefObject<HTMLDivElement | null>
  orientation: 'width' | 'height'
  visible: boolean
  size: number
}

/**
 * 把 store 的「可见 + 像素宽」推回三块可收起的面板。
 *
 * 必须是**一个协调的 effect**，不能三块各一个：
 *  · 三块分属两个 Group（Nomi 在根组，镜头/属性在舞台行组），各自 expand/resize 会互相抢空间，
 *    彼此看到的都是对方改到一半的中间态；上一版三个独立 effect 于是把「恢复默认」的 300/240
 *    先落成两块的下限、后来又冲到 383/307，两次都不是合同值。
 *  · expand() 之后要**等一帧**再定尺寸：同帧里尺寸还没重新分配完，resize 会被当时的剩余空间夹住。
 *  · 外层先于内层：先把 Nomi 那一刀切好，舞台行的可用宽度才是最终值，再分镜头/属性。
 *  · 收敛判据量的是 DOM 的 getBoundingClientRect()，不是 getSize().inPixels：真正要成立的是
 *    「用户看到的那一列有多宽」，量渲染结果再按「当前百分比 × 目标/实测」比例修正，
 *    才不依赖库内部像素→flexGrow 的换算细节。
 * 最多试 CONVERGE_FRAMES 帧；某一帧不需要任何改动就提前停。
 */
const CONVERGE_FRAMES = 6

function usePanelLayoutSync(targets: PanelTarget[]): React.MutableRefObject<boolean> {
  const latest = React.useRef(targets)
  latest.current = targets
  // 同步期间**必须屏蔽回写**：不然中间态（比如 Nomi 刚展开、舞台行还没重新分配完）会被
  // onResize 当成用户的新选择写进 store，目标值当场被覆盖，收敛循环就再也追不回合同值了。
  // 上一版「恢复默认」落在 383/307 而不是 300/240，就是这条自我覆盖。
  const syncing = React.useRef(false)
  const signature = targets.map((target) => `${target.visible ? 1 : 0}:${target.size}`).join('|')

  React.useEffect(() => {
    let frame = 0
    let remaining = CONVERGE_FRAMES
    syncing.current = true

    const finish = () => { syncing.current = false }
    const step = () => {
      let changed = false
      for (const target of latest.current) {
        const panel = target.ref.current
        if (!panel) continue
        if (!target.visible) {
          if (!panel.isCollapsed()) { panel.collapse(); changed = true }
          continue
        }
        if (panel.isCollapsed()) { panel.expand(); changed = true; continue }
        const rect = target.element.current?.getBoundingClientRect()
        const rendered = rect ? (target.orientation === 'width' ? rect.width : rect.height) : panel.getSize().inPixels
        if (Math.abs(rendered - target.size) <= 1) continue
        const current = panel.getSize()
        // 按实测比例修正：目标百分比 = 当前百分比 × (目标像素 / 实测像素)。
        // 实测拿不到（首帧、隐藏中）就退回直接给像素。
        if (rendered > 0 && current.asPercentage > 0) panel.resize(`${current.asPercentage * (target.size / rendered)}%`)
        else panel.resize(target.size)
        changed = true
      }
      remaining -= 1
      if (changed && remaining > 0) frame = requestAnimationFrame(step)
      else frame = requestAnimationFrame(finish)
    }

    step()
    return () => { if (frame) cancelAnimationFrame(frame); syncing.current = false }
  }, [signature])

  return syncing
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
  const syncSize = useWorkbenchStore((state) => state.syncEditingPanelSize)
  const markCustom = useWorkbenchStore((state) => state.markEditingPanelLayoutCustom)
  const toggleEditingPanel = useWorkbenchStore((state) => state.toggleEditingPanel)
  const setAgentCollapsed = useWorkbenchStore((state) => state.setProjectAgentDockCollapsed)
  const undoEditingPanelLayout = useWorkbenchStore((state) => state.undoEditingPanelLayout)
  const sourcePanelRef = usePanelRef()
  const inspectorPanelRef = usePanelRef()
  const assistantPanelRef = usePanelRef()
  const sourceElementRef = React.useRef<HTMLDivElement | null>(null)
  const inspectorElementRef = React.useRef<HTMLDivElement | null>(null)
  const assistantElementRef = React.useRef<HTMLDivElement | null>(null)
  // defaultSize 是**挂载时**的初值，不是受控值。喂它实时 store 值的话，每次改布局都会在
  // 我们的同步循环之后再触发一次库内部的「默认尺寸变了 → 重排」，把刚定好的 300/240 顶成 383/307。
  // 之后的所有布局变更都只走 usePanelLayoutSync 的命令式通道。
  const initialLayout = React.useRef(layout).current
  const durationFrame = React.useMemo(() => computeTimelineDuration(timeline), [timeline])
  const activeClips = React.useMemo(() => resolveActiveClipsAtFrame(timeline, playheadFrame), [timeline, playheadFrame])
  const assistantVisible = layout.visibility.assistant && !aiCollapsed

  useTimelinePlaybackClock({ playing, playheadFrame, durationFrame, fps: timeline.fps, onPlayheadChange: setTimelinePlayhead, onPlayingChange: setTimelinePlaying })

  // 顺序即外层先于内层：Nomi 那一刀定了，舞台行的可用宽度才是最终值。
  const syncingRef = usePanelLayoutSync([
    { ref: assistantPanelRef, element: assistantElementRef, orientation: 'width', visible: assistantVisible, size: layout.assistantWidth },
    { ref: sourcePanelRef, element: sourceElementRef, orientation: 'width', visible: layout.visibility.source, size: layout.sourceWidth },
    { ref: inspectorPanelRef, element: inspectorElementRef, orientation: 'width', visible: layout.visibility.inspector, size: layout.inspectorWidth },
  ])
  const onPanelResized = React.useCallback((key: EditingPanelSizeKey, pixels: number, visible: boolean) => {
    // 收起态量到的是 rail 宽，不是用户挑的宽度；同步期间量到的是中间态。两种都不写回。
    if (syncingRef.current || !visible || pixels <= EDITING_PANEL_RAIL_WIDTH) return
    syncSize({ [key]: Math.round(pixels) })
  }, [syncSize, syncingRef])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === '\\') {
        event.preventDefault()
        setAgentCollapsed(!useWorkbenchStore.getState().projectAgentDockCollapsed)
      }
      if (event.metaKey && event.key.toLowerCase() === 'z' && undoEditingPanelLayout()) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setAgentCollapsed, undoEditingPanelLayout])

  const onUserLayout = React.useCallback(
    (_layout: unknown, meta: { isUserInteraction: boolean }) => { if (meta.isUserInteraction) markCustom() },
    [markCustom],
  )

  return (
    <section
      className="workbench-preview relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-[var(--workbench-bg)]"
      aria-label={t('workspace.preview')}
    >
      <Group orientation="horizontal" className="h-full w-full" id="editing-surface-root" onLayoutChanged={onUserLayout}>
        <Panel id="editing-surface-main" minSize={EDITING_PANEL_MAIN_MIN}>
          <Group orientation="vertical" className="h-full" id="editing-surface-left" onLayoutChanged={onUserLayout}>
            <Panel id="editing-surface-stage" minSize={EDITING_PANEL_BOUNDS.stage.min}>
              <Group orientation="horizontal" className="h-full" id="editing-surface-stage-row" onLayoutChanged={onUserLayout}>
                <Panel
                  id="editing-surface-source"
                  panelRef={sourcePanelRef}
                  elementRef={sourceElementRef}
                  defaultSize={initialLayout.sourceWidth}
                  minSize={EDITING_PANEL_BOUNDS.source.min}
                  maxSize={EDITING_PANEL_BOUNDS.source.max}
                  collapsible
                  collapsedSize={EDITING_PANEL_RAIL_WIDTH}
                  onResize={(size) => onPanelResized('sourceWidth', size.inPixels, layout.visibility.source)}
                >
                  <div className="h-full min-w-0 overflow-hidden"><PreviewSourcePanel /></div>
                </Panel>
                <SplitHandle vertical />
                <Panel id="editing-surface-preview" minSize={EDITING_PANEL_BOUNDS.preview.min}>
                  <div className="h-full min-w-0 overflow-hidden">
                    <TimelinePreview
                      activeClips={activeClips}
                      aspectRatio={previewAspectRatio}
                      fps={timeline.fps}
                      playheadFrame={timeline.playheadFrame}
                      timeline={timeline}
                    />
                  </div>
                </Panel>
                <SplitHandle vertical />
                <Panel
                  id="editing-surface-inspector"
                  panelRef={inspectorPanelRef}
                  elementRef={inspectorElementRef}
                  defaultSize={initialLayout.inspectorWidth}
                  minSize={EDITING_PANEL_BOUNDS.inspector.min}
                  maxSize={EDITING_PANEL_BOUNDS.inspector.max}
                  collapsible
                  collapsedSize={EDITING_PANEL_RAIL_WIDTH}
                  onResize={(size) => onPanelResized('inspectorWidth', size.inPixels, layout.visibility.inspector)}
                >
                  <PreviewInspector
                    timeline={timeline}
                    collapsed={!layout.visibility.inspector}
                    onToggleCollapsed={() => toggleEditingPanel('inspector')}
                  />
                </Panel>
              </Group>
            </Panel>
            <SplitHandle />
            <Panel
              id="editing-surface-timeline"
              defaultSize={initialLayout.timelineHeight}
              minSize={EDITING_PANEL_BOUNDS.timeline.min}
              maxSize={EDITING_PANEL_BOUNDS.timeline.max}
              groupResizeBehavior="preserve-pixel-size"
              onResize={(size) => onPanelResized('timelineHeight', size.inPixels, true)}
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
        </Panel>
        <SplitHandle vertical />
        <Panel
          id="editing-surface-assistant"
          panelRef={assistantPanelRef}
          elementRef={assistantElementRef}
          defaultSize={initialLayout.assistantWidth}
          minSize={EDITING_PANEL_BOUNDS.assistant.min}
          maxSize={EDITING_PANEL_BOUNDS.assistant.max}
          collapsible
          collapsedSize={EDITING_PANEL_RAIL_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(size) => onPanelResized('assistantWidth', size.inPixels, assistantVisible)}
        >
          <aside
            className="relative h-full min-w-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]"
            aria-label={t('timelinePreview.previewLayout.panels.assistant')}
          >
            {assistantVisible ? (
              <div ref={agentDockRef} className="h-full w-full min-w-0" />
            ) : (
              <PanelRail
                icon={<IconMessageCircle size={16} />}
                label={t('timelinePreview.previewLayout.panels.assistant')}
                title={t('timelinePreview.previewLayout.expandAssistant')}
                onClick={() => setAgentCollapsed(false)}
              />
            )}
          </aside>
        </Panel>
      </Group>
    </section>
  )
}

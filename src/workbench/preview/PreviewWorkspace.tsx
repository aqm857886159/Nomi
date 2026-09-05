import React from 'react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { IconDownload, IconLayoutSidebarRightExpand, IconMessageCircle } from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import TimelinePanel from '../timeline/TimelinePanel'
import { computeTimelineDuration, resolveActiveClipsAtFrame } from '../timeline/timelineMath'
import TimelinePreview from './TimelinePreview'
import PreviewSourcePanel from './PreviewSourcePanel'
import PreviewInspector from './inspector/PreviewInspector'
import EditingLayoutMenu from './EditingLayoutMenu'
import { useTimelinePlaybackClock } from '../timeline/useTimelinePlaybackClock'

type PreviewWorkspaceProps = { aiCollapsed?: boolean; agentDockRef?: React.Ref<HTMLDivElement> }

function SplitHandle({ vertical = false }: { vertical?: boolean }): JSX.Element {
  return <PanelResizeHandle className={cn('group relative z-10 flex flex-none items-center justify-center bg-[var(--workbench-border)]', vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize')}><span className={cn('rounded-pill bg-[var(--workbench-muted-soft)] opacity-0 transition-opacity group-hover:opacity-100', vertical ? 'h-8 w-1' : 'h-1 w-16')} /></PanelResizeHandle>
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
  const setLayout = useWorkbenchStore((state) => state.setEditingPanelLayout)
  const setAgentCollapsed = useWorkbenchStore((state) => state.setProjectAgentDockCollapsed)
  const undoEditingPanelLayout = useWorkbenchStore((state) => state.undoEditingPanelLayout)
  const inspectorPanelRef = React.useRef<ImperativePanelHandle | null>(null)
  const assistantPanelRef = React.useRef<ImperativePanelHandle | null>(null)
  const durationFrame = React.useMemo(() => computeTimelineDuration(timeline), [timeline])
  const activeClips = React.useMemo(() => resolveActiveClipsAtFrame(timeline, playheadFrame), [timeline, playheadFrame])

  useTimelinePlaybackClock({ playing, playheadFrame, durationFrame, fps: timeline.fps, onPlayheadChange: setTimelinePlayhead, onPlayingChange: setTimelinePlaying })

  React.useEffect(() => {
    const panel = inspectorPanelRef.current
    if (!panel) return
    if (layout.visibility.inspector) panel.expand()
    else panel.collapse()
  }, [layout.visibility.inspector])
  React.useEffect(() => {
    const panel = assistantPanelRef.current
    if (!panel) return
    if (layout.visibility.assistant && !aiCollapsed) panel.expand()
    else panel.collapse()
  }, [aiCollapsed, layout.visibility.assistant])
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

  return <section className="workbench-preview relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-[var(--workbench-bg)]" aria-label={t('workspace.preview')}>
    <PanelGroup direction="horizontal" className="h-full w-full" id="editing-surface-root">
      <Panel defaultSize={layout.visibility.assistant ? 77 : 100} minSize={55} order={1}>
        <PanelGroup direction="vertical" className="h-full" id="editing-surface-left">
          <Panel defaultSize={70} minSize={45} order={1}>
            <PanelGroup direction="horizontal" className="h-full" id="editing-surface-stage">
              <Panel defaultSize={18} minSize={12} maxSize={30} collapsible collapsedSize={3} order={1} onResize={(size) => setLayout({ sourceWidth: Math.round(size * 16.8) })}><div className="h-full min-w-0 overflow-hidden"><PreviewSourcePanel /></div></Panel>
              <SplitHandle vertical />
              <Panel minSize={35} order={2}><div className="h-full min-w-0 overflow-hidden"><TimelinePreview activeClips={activeClips} aspectRatio={previewAspectRatio} fps={timeline.fps} playheadFrame={timeline.playheadFrame} timeline={timeline} /></div></Panel>
              <SplitHandle vertical />
              <Panel ref={inspectorPanelRef} defaultSize={14} minSize={12} maxSize={28} collapsible collapsedSize={3} order={3} onResize={(size) => setLayout({ inspectorWidth: Math.round(size * 16.8) })}><PreviewInspector timeline={timeline} collapsed={!layout.visibility.inspector} onToggleCollapsed={() => useWorkbenchStore.getState().toggleEditingPanel('inspector')} /></Panel>
            </PanelGroup>
          </Panel>
          <SplitHandle />
          <Panel defaultSize={30} minSize={16} maxSize={45} order={2} onResize={(size) => setLayout({ timelineHeight: Math.round(size * 8.4) })}>
            <div className="relative h-full min-h-0 min-w-0 overflow-hidden border-t border-[var(--workbench-border)]"><TimelinePanel density="full" regionLabel={t('timelinePreview.timelineRegion')} actionLabelPrefix={t('timelinePreview.timelineActionPrefix')} showTextTrack /></div>
          </Panel>
        </PanelGroup>
      </Panel>
      <SplitHandle vertical />
      <Panel ref={assistantPanelRef} defaultSize={23} minSize={18} maxSize={38} collapsible collapsedSize={3} order={2} onResize={(size) => setLayout({ assistantWidth: Math.round(size * 16.8) })}>
        <aside className="relative h-full min-w-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]" aria-label={t('timelinePreview.previewLayout.panels.assistant')}>
          {!layout.visibility.assistant || aiCollapsed ? <button type="button" className="flex h-full w-full flex-col items-center gap-2 border-0 bg-transparent pt-3 text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)]" title={t('timelinePreview.previewLayout.expandAssistant')} onClick={() => { setAgentCollapsed(false); useWorkbenchStore.getState().setEditingPanelLayout({ visibility: { assistant: true } }) }}><IconMessageCircle size={16} /><span className="text-micro [writing-mode:vertical-rl]">{t('timelinePreview.previewLayout.panels.assistant')}</span><IconLayoutSidebarRightExpand size={14} /></button> : <div ref={agentDockRef} className="h-full w-full min-w-0" />}
        </aside>
      </Panel>
    </PanelGroup>
    <header className="pointer-events-none absolute right-2 top-2 z-30 flex items-center gap-1"><div className="pointer-events-auto"><EditingLayoutMenu /></div><button type="button" className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-nomi border border-[var(--workbench-border)] bg-[var(--workbench-surface)] px-2 text-micro text-[var(--workbench-ink)] hover:bg-[var(--workbench-hover)]" title={t('timelinePreview.exportMp4')} aria-label={t('timelinePreview.exportMp4')} onClick={() => window.dispatchEvent(new Event('nomi-preview-export'))}><IconDownload size={14} />{t('timelinePreview.exportMp4')}</button></header>
  </section>
}

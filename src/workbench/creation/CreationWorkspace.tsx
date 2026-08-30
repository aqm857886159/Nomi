import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import WorkbenchEditor from './WorkbenchEditor'
import DocumentListSidebar from './DocumentListSidebar'
import StoryboardPlanEditor from './storyboard/StoryboardPlanEditor'
import { useWorkbenchStore } from '../workbenchStore'

type CreationWorkspaceProps = {
  aiCollapsed?: boolean
  agentDockRef?: React.Ref<HTMLDivElement>
}

export default function CreationWorkspace({ aiCollapsed = false, agentDockRef }: CreationWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const activeStoryboardId = useWorkbenchStore((s) => s.activeStoryboardId)
  const activeDocumentId = useWorkbenchStore((s) => s.activeDocumentId)
  const activeStoryboard = useWorkbenchStore((s) => (
    activeDocumentId && activeStoryboardId
      ? s.storyboardDesignsByDocumentId[activeDocumentId]?.find((design) => design.id === activeStoryboardId)
      : undefined
  ))
  const workspaceMode = useWorkbenchStore((s) => s.workspaceMode)
  const designsForActiveDocument = useWorkbenchStore((s) => s.storyboardDesignsByDocumentId[s.activeDocumentId] ?? [])
  const setActiveStoryboardId = useWorkbenchStore((s) => s.setActiveStoryboardId)
  React.useEffect(() => {
    if (workspaceMode === 'storyboard' && !activeStoryboardId && designsForActiveDocument[0]) {
      setActiveStoryboardId(designsForActiveDocument[0].id, activeDocumentId)
    }
  }, [activeDocumentId, activeStoryboardId, designsForActiveDocument, setActiveStoryboardId, workspaceMode])
  return (
    <section
      className={cn(
        'workbench-creation relative',
        'w-full h-full min-w-0 min-h-0',
        'pt-[22px] px-6 pb-6',
        'bg-workbench-bg',
        'grid max-w-[1480px] mx-auto gap-5',
        agentDockRef && !aiCollapsed
          ? 'grid-cols-[240px_minmax(0,1fr)_340px] max-[1320px]:grid-cols-[200px_minmax(0,1fr)_340px] max-[980px]:grid-cols-[180px_minmax(0,1fr)] max-[980px]:grid-rows-[minmax(300px,1fr)_minmax(240px,40%)]'
          : 'grid-cols-[240px_minmax(0,1fr)] max-[1180px]:grid-cols-[200px_minmax(0,1fr)]',
      )}
      aria-label={t('creationAi.workspace.aria')}
    >
        <DocumentListSidebar />
      <div className="min-w-0 min-h-0 flex flex-col gap-2">
        <div className="min-h-0 flex-1" data-creation-surface={activeStoryboard ? 'storyboard' : 'source'}>
          {activeStoryboard ? <StoryboardPlanEditor /> : <WorkbenchEditor />}
        </div>
      </div>
      {agentDockRef ? <aside className={cn(
        aiCollapsed
          ? 'pointer-events-none absolute inset-0 z-40 overflow-visible'
          : 'min-w-0 min-h-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]',
      )}><div ref={agentDockRef} className="h-full w-full min-w-0 min-h-0" /></aside> : null}
    </section>
  )
}

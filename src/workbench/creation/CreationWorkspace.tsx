import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import WorkbenchEditor from './WorkbenchEditor'
import DocumentListSidebar from './DocumentListSidebar'
import StoryboardPlanCard from './storyboard/StoryboardPlanCard'

type CreationWorkspaceProps = {
  aiCollapsed?: boolean
  agentDockRef?: React.Ref<HTMLDivElement>
}

export default function CreationWorkspace({ aiCollapsed = false, agentDockRef }: CreationWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  // Creation is the source of truth for the script. A blank structural
  // storyboard starter must never redirect a fresh user away from the editor;
  // storyboard mode is entered only by an explicit "open storyboard" action.
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
        <div className="min-h-0 flex-1" data-creation-surface="source">
          {/* The script remains visible in Creation; opening a storyboard is an
              explicit navigation action so a starter row cannot hide the draft. */}
          <WorkbenchEditor />
        </div>
        {/* The planner result is a summary of the source document. Keep it in
            Creation so returning from the storyboard still exposes the same
            draft; the card itself stays hidden while only the structural
            empty starter exists. */}
        <StoryboardPlanCard />
      </div>
      {agentDockRef ? <aside className={cn(
        aiCollapsed
          ? 'pointer-events-none absolute inset-0 z-40 overflow-visible'
          : 'min-w-0 min-h-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]',
      )}><div ref={agentDockRef} className="h-full w-full min-w-0 min-h-0" /></aside> : null}
    </section>
  )
}

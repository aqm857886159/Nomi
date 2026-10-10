import { AssistantPane } from '../AssistantPane'
import { assistantPaneWidth } from '../assistantWidthBounds'
import { useWorkbenchStore } from '../workbenchStore'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import WorkbenchEditor from './WorkbenchEditor'

type CreationWorkspaceProps = {
  aiCollapsed?: boolean
  agentDockRef?: React.Ref<HTMLDivElement>
}

export default function CreationWorkspace({ aiCollapsed = false, agentDockRef }: CreationWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const width = useWorkbenchStore(state => state.editingPanelLayout.assistantWidth)
  // Creation is the source of truth for the script. A blank structural
  // storyboard starter must never redirect a fresh user away from the editor;
  // storyboard mode is entered only by an explicit "open storyboard" action.
  // 创作内容树不住这里：它在左栏「文稿」抽屉里（10-08 外壳重设计），切文稿也可以用编辑器工具条最左的「文稿名 ▾」。
  return (
    <section
      className={cn(
        'workbench-creation relative',
        'w-full h-full min-w-0 min-h-0',
        'bg-nomi-chrome',
        'grid',
      )}
      style={{ gridTemplateColumns: agentDockRef && !aiCollapsed ? `minmax(0,1fr) ${assistantPaneWidth(width)}px` : 'minmax(0,1fr)' }}
      aria-label={t('creationAi.workspace.aria')}
    >
      <div className="min-w-0 min-h-0 flex flex-col">
        <div className="min-h-0 flex-1" data-creation-surface="source">
          {/* The script remains visible in Creation; opening a storyboard is an
              explicit navigation action so a starter row cannot hide the draft. */}
          <WorkbenchEditor />
        </div>
      </div>
      {agentDockRef ? <AssistantPane dockRef={agentDockRef} collapsed={aiCollapsed} /> : null}
    </section>
  )
}

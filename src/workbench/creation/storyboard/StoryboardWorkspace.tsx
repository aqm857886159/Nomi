import { AssistantPane } from '../../AssistantPane'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { DesignEmptyState, WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import StoryboardPlanEditor from './StoryboardPlanEditor'
import { assistantPaneWidth } from '../../assistantWidthBounds'

/**
 * 分镜独立工作区（v5 C3）：storyboard 模式的唯一挂载点，分镜表全宽（§3.7 删 1264 上限）、
 * 无 AI 栏以外的自有装饰——完整编辑器只住这里（P1 一个实现一个家）。
 * 左侧创作资源树**不由本组件挂**：它跨 creation / storyboard 常驻，唯一挂载点是
 * WorkbenchShell（见 ../creationResourceTreeModes.ts）。本组件只负责剩下的那块宽度。
 * 留白（gutter）也不归本组件：A-1 刀 1 之后创作面与分镜面共用 shell 那一份 `p-4 gap-4`，
 * 本组件自己那套 `pt-[22px] px-6 pb-6` + `assistantPaneWidth` 已删——两份留白就是两份真相。
 * 有方案 → StoryboardPlanEditor；无方案 → 空态引导回创作页拆镜头。返回原稿 = 切回 creation。
 */
export default function StoryboardWorkspace({ projectId, aiCollapsed = false, agentDockRef }: { projectId?: string | null; aiCollapsed?: boolean; agentDockRef?: React.Ref<HTMLDivElement> }): JSX.Element {
  const { t } = useTranslation()
  const plan = useWorkbenchStore((state) => {
    const designs = state.activeDocumentId ? state.storyboardDesignsByDocumentId[state.activeDocumentId] ?? [] : []
    return (designs.find((design) => design.id === state.activeStoryboardId) ?? designs[0])?.plan ?? null
  })
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const workspaceMode = useWorkbenchStore((state) => state.workspaceMode)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((state) => state.activeStoryboardId)
  const assistantWidth = useWorkbenchStore((state) => state.editingPanelLayout.assistantWidth)
  const designsForActiveDocument = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId[state.activeDocumentId] ?? [])
  const setActiveStoryboardId = useWorkbenchStore((state) => state.setActiveStoryboardId)
  // 直接进分镜页（URL/前进后退）没有激活方案时自动选该稿第一个（原住 CreationWorkspace，随挂载点搬家）。
  // workspaceMode 闸必须保留：本组件在切走后仍隐藏挂载，去掉闸会把「返回原稿」刚置空的激活又抢回来。
  React.useEffect(() => {
    if (workspaceMode === 'storyboard' && !activeStoryboardId && designsForActiveDocument[0]) {
      setActiveStoryboardId(designsForActiveDocument[0].id, activeDocumentId)
    }
  }, [activeDocumentId, activeStoryboardId, designsForActiveDocument, setActiveStoryboardId, workspaceMode])

  if (plan) {
    return (
      <section
        className={cn('workbench-storyboard relative w-full h-full min-w-0 min-h-0', 'grid min-h-0 bg-nomi-chrome', agentDockRef && !aiCollapsed ? 'grid-cols-[minmax(0,1fr)_var(--storyboard-assistant-width)]' : 'grid-cols-[minmax(0,1fr)]')}
        style={{ '--storyboard-assistant-width': aiCollapsed ? '0px' : `${assistantPaneWidth(assistantWidth)}px` } as React.CSSProperties}
        aria-label={t('workspace.storyboard')}
      >
        <div className="min-w-0 min-h-0 overflow-hidden">
          <StoryboardPlanEditor key={activeStoryboardId} projectId={projectId} />
        </div>
        {agentDockRef ? <AssistantPane dockRef={agentDockRef} collapsed={aiCollapsed} /> : null}
      </section>
    )
  }

  return (
    <section
      className={cn('workbench-storyboard relative w-full h-full min-w-0 min-h-0', 'grid min-h-0 bg-nomi-chrome', agentDockRef && !aiCollapsed ? 'grid-cols-[minmax(0,1fr)_var(--storyboard-assistant-width)]' : 'grid-cols-[minmax(0,1fr)]')}
      style={{ '--storyboard-assistant-width': aiCollapsed ? '0px' : `${assistantPaneWidth(assistantWidth)}px` } as React.CSSProperties}
      aria-label={t('workspace.storyboard')}
    >
      <div className="relative grid min-h-0 min-w-0 place-items-center rounded-panel bg-nomi-paper ring-1 ring-nomi-line-soft">
        <DesignEmptyState
          icon={<IconMovie size={34} className="text-nomi-ink-30" />}
          title={t('storyboardEditor.empty.title')}
          description={t('storyboardEditor.empty.description')}
          action={
            <WorkbenchButton variant="primary" onClick={() => setWorkspaceMode('creation')}>
              {t('storyboardEditor.empty.backToCreation')}
            </WorkbenchButton>
          }
        />
      </div>
      {agentDockRef ? <AssistantPane dockRef={agentDockRef} collapsed={aiCollapsed} /> : null}
    </section>
  )
}

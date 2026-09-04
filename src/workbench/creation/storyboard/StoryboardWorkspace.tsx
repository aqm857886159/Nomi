import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { DesignEmptyState, WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import StoryboardPlanEditor from './StoryboardPlanEditor'

/**
 * 分镜独立工作区（v5 C3）：storyboard 模式的唯一挂载点，全宽（§3.7 删 1264 上限）、
 * 无文档侧栏无 AI 栏——完整编辑器只住这里（P1 一个实现一个家）。
 * 有方案 → StoryboardPlanEditor；无方案 → 空态引导回创作页拆镜头。返回原稿 = 切回 creation。
 */
export default function StoryboardWorkspace({ projectId, aiCollapsed = false, agentDockRef }: { projectId?: string | null; aiCollapsed?: boolean; agentDockRef?: React.Ref<HTMLDivElement> }): JSX.Element {
  const { t } = useTranslation()
  const entry = useWorkbenchStore((state) => (state.activeDocumentId ? state.storyboardPlans[state.activeDocumentId] : undefined))
  const plan = entry?.plan ?? null
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const workspaceMode = useWorkbenchStore((state) => state.workspaceMode)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((state) => state.activeStoryboardId)
  const assistantWidth = useWorkbenchStore((state) => state.assistantWidth)
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
        className={cn('workbench-storyboard relative w-full h-full min-w-0 min-h-0', 'grid min-h-0 bg-workbench-bg', agentDockRef && !aiCollapsed ? 'grid-cols-[minmax(0,1fr)_var(--storyboard-assistant-width)]' : 'grid-cols-[minmax(0,1fr)]')}
        style={{ '--storyboard-assistant-width': aiCollapsed ? '0px' : `${assistantWidth}px` } as React.CSSProperties}
        aria-label={t('workspace.storyboard')}
      >
        <div className="min-w-0 min-h-0 overflow-hidden pt-[22px] px-6 pb-6">
          <StoryboardPlanEditor projectId={projectId} />
        </div>
        {agentDockRef ? <aside className={cn(aiCollapsed ? 'pointer-events-none absolute inset-0 z-40 overflow-visible' : 'min-w-0 min-h-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]')}><div ref={agentDockRef} className="h-full w-full min-w-0 min-h-0" /></aside> : null}
      </section>
    )
  }

  return (
    <section
      className={cn('workbench-storyboard relative w-full h-full min-w-0 min-h-0', 'grid min-h-0 bg-workbench-bg', agentDockRef && !aiCollapsed ? 'grid-cols-[minmax(0,1fr)_var(--storyboard-assistant-width)]' : 'grid-cols-[minmax(0,1fr)]')}
      style={{ '--storyboard-assistant-width': aiCollapsed ? '0px' : `${assistantWidth}px` } as React.CSSProperties}
      aria-label={t('workspace.storyboard')}
    >
      <div className="min-w-0 min-h-0 grid place-items-center">
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
      {agentDockRef ? <aside className={cn(aiCollapsed ? 'pointer-events-none absolute inset-0 z-40 overflow-visible' : 'min-w-0 min-h-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]')}><div ref={agentDockRef} className="h-full w-full min-w-0 min-h-0" /></aside> : null}
    </section>
  )
}

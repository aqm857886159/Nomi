import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { DesignEmptyState, WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import StoryboardPlanEditor from './StoryboardPlanEditor'
import DocumentListSidebar from '../DocumentListSidebar'

type StoryboardWorkspaceProps = {
  projectId?: string | null
  aiCollapsed?: boolean
  agentDockRef?: React.Ref<HTMLDivElement>
}

/**
 * 分镜独立工作区（v5 C3）：storyboard 模式的唯一挂载点，完整分镜编辑器只住这里
 * （P1 一个实现一个家）。有方案 → StoryboardPlanEditor；无方案 → 空态引导回创作页拆镜头。
 *
 * 三栏骨架与创作页**同构**（目录 | 主列 | Agent），2026-09-03 用户提出后改：原本刻意做成
 * 全宽孤岛（理由是分镜表要宽），代价是用户进了分镜页就回不去目录、也叫不到 Agent——
 * 而分镜表恰恰是最需要 Agent 的那一屏（改某几镜、按 @ 引用参考卡）。
 * 表宽由 Agent 栏的收起态吸收：`projectAgentDockCollapsed` 与创作页共用同一个槽，
 * 开合状态跨页连续，不新增一份「分镜页自己的」记忆（单一语义 owner）。
 */
export default function StoryboardWorkspace({ projectId, aiCollapsed = false, agentDockRef }: StoryboardWorkspaceProps): JSX.Element {
  const { t } = useTranslation()
  const entry = useWorkbenchStore((state) => (state.activeDocumentId ? state.storyboardPlans[state.activeDocumentId] : undefined))
  const plan = entry?.plan ?? null
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const workspaceMode = useWorkbenchStore((state) => state.workspaceMode)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((state) => state.activeStoryboardId)
  const designsForActiveDocument = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId[state.activeDocumentId] ?? [])
  const setActiveStoryboardId = useWorkbenchStore((state) => state.setActiveStoryboardId)
  // 直接进分镜页（URL/前进后退）没有激活方案时自动选该稿第一个（原住 CreationWorkspace，随挂载点搬家）。
  // workspaceMode 闸必须保留：本组件在切走后仍隐藏挂载，去掉闸会把「返回原稿」刚置空的激活又抢回来。
  React.useEffect(() => {
    if (workspaceMode === 'storyboard' && !activeStoryboardId && designsForActiveDocument[0]) {
      setActiveStoryboardId(designsForActiveDocument[0].id, activeDocumentId)
    }
  }, [activeDocumentId, activeStoryboardId, designsForActiveDocument, setActiveStoryboardId, workspaceMode])

  return (
    <section
      className={cn(
        'workbench-storyboard relative w-full h-full min-w-0 min-h-0',
        'pt-[22px] px-6 pb-6 bg-workbench-bg',
        // 与 CreationWorkspace 同一套断点与列宽（同构 = 同一个骨架，不是长得像）。
        // 分镜表要宽，所以不设 max-w 上限（§3.7），窄屏下 Agent 栏先掉到下排。
        'grid gap-5',
        agentDockRef && !aiCollapsed
          ? 'grid-cols-[240px_minmax(0,1fr)_340px] max-[1320px]:grid-cols-[200px_minmax(0,1fr)_340px] max-[980px]:grid-cols-[180px_minmax(0,1fr)] max-[980px]:grid-rows-[minmax(300px,1fr)_minmax(240px,40%)]'
          : 'grid-cols-[240px_minmax(0,1fr)] max-[1180px]:grid-cols-[200px_minmax(0,1fr)]',
      )}
      aria-label={t('workspace.storyboard')}
    >
      <DocumentListSidebar />
      <div className="min-w-0 min-h-0" data-storyboard-main="true">
        {plan ? (
          <div className="h-full min-h-0">
            <StoryboardPlanEditor projectId={projectId} />
          </div>
        ) : (
          <div className="h-full min-h-0 grid place-items-center">
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
        )}
      </div>
      {agentDockRef ? <aside className={cn(
        aiCollapsed
          ? 'pointer-events-none absolute inset-0 z-40 overflow-visible'
          : 'min-w-0 min-h-0 overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface)]',
      )}><div ref={agentDockRef} className="h-full w-full min-w-0 min-h-0" /></aside> : null}
    </section>
  )
}

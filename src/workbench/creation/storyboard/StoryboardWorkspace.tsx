import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { DesignEmptyState, WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import StoryboardPlanEditor from './StoryboardPlanEditor'

/**
 * 分镜独立工作区（P3）：顶栏第 4 个一级页面，级别与创作/生成/预览等同。
 * 有方案 → 渲染 StoryboardPlanEditor（复用创作页原有的审/改/落画布流程）；
 * 无方案 → 空态引导回创作页拆镜头。返回原稿 = 切回 creation。
 */
export default function StoryboardWorkspace(): JSX.Element {
  const { t } = useTranslation()
  const entry = useWorkbenchStore((state) => (state.activeDocumentId ? state.storyboardPlans[state.activeDocumentId] : undefined))
  const plan = entry?.plan ?? null
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)

  if (plan) {
    return (
      <section
        className={cn('workbench-storyboard relative w-full h-full min-w-0 min-h-0', 'pt-[22px] px-6 pb-6 bg-workbench-bg')}
        aria-label={t('workspace.storyboard')}
      >
        <div className="h-full min-h-0 grid grid-cols-[minmax(0,1fr)] max-w-[1264px] mx-auto">
          <StoryboardPlanEditor />
        </div>
      </section>
    )
  }

  return (
    <section
      className={cn('workbench-storyboard relative w-full h-full min-w-0 min-h-0', 'bg-workbench-bg grid place-items-center')}
      aria-label={t('workspace.storyboard')}
    >
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
    </section>
  )
}

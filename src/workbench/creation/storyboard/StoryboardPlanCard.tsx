import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconCircleCheck, IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton, confirmDialog } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'

/**
 * 分镜方案卡片（回看链路）：拆镜头的产出在创作区对话流里的可收起/可重开卡片。
 * 纯视图——数据全读单一真相源 storyboardPlan，状态从 committed/editorOpen 派生：
 *   editorOpen → 编辑中｜!committed → 草稿｜committed → 已落画布。
 * 编辑仍走主列全宽 StoryboardPlanEditor（卡片只做摘要+状态+入口）。
 */
export default function StoryboardPlanCard(): JSX.Element | null {
  const { t } = useTranslation()
  const plan = useWorkbenchStore((s) => s.storyboardPlan)
  const committed = useWorkbenchStore((s) => s.storyboardPlanCommitted)
  const editorOpen = useWorkbenchStore((s) => s.storyboardEditorOpen)
  const setStoryboardEditorOpen = useWorkbenchStore((s) => s.setStoryboardEditorOpen)
  const discardStoryboardPlan = useWorkbenchStore((s) => s.discardStoryboardPlan)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)

  if (!plan) return null

  const title = plan.title.trim() || t('storyboardEditor.planCard.defaultTitle')
  const shotCount = plan.shots.length
  const anchorCount = plan.anchors.length
  // 图片分镜（全镜 durationSec=0）没有总时长——只报「图片分镜」，别显示误导的「约 0s」。
  const totalSec = Math.round(plan.shots.reduce((sum, shot) => sum + (shot.shotKind === 'image' ? 0 : shot.durationSec || 0), 0))
  const meta = t('storyboardEditor.planCard.meta', {
    shots: shotCount,
    anchors: anchorCount,
    duration: totalSec > 0 ? t('storyboardEditor.planCard.duration', { seconds: totalSec }) : t('storyboardEditor.planCard.imageStoryboard'),
  })

  const onDiscard = async () => {
    const ok = await confirmDialog({
      title: t('storyboardEditor.discardTitle'),
      message: t('storyboardEditor.planCard.discardMessage'),
      confirmLabel: t('storyboardEditor.discard'),
      danger: true,
    })
    if (ok) discardStoryboardPlan()
  }

  // 状态徽标用 Nomi 品牌色(草稿/编辑=暖 accent、已落=success)。StatusBadge 是 Mantine
  // gray/blue/green，非品牌色 → 这里保留手写品牌 chip(2026-06-22 回归核对:别让品牌色被压成通用灰蓝)。
  const badge = editorOpen
    ? { label: t('storyboardEditor.planCard.editing'), cls: 'bg-nomi-accent-soft text-nomi-accent' }
    : committed
      ? { label: t('storyboardEditor.planCard.committed'), cls: 'bg-workbench-success-soft text-workbench-success' }
      : { label: t('storyboardEditor.planCard.draft'), cls: 'bg-nomi-accent-soft text-nomi-accent' }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 p-3 rounded-nomi border bg-nomi-paper',
        editorOpen ? 'border-nomi-accent' : 'border-nomi-line',
      )}
      data-storyboard-card={committed ? 'committed' : editorOpen ? 'editing' : 'draft'}
    >
      <div className="flex items-center gap-2 min-w-0">
        {committed && !editorOpen
          ? <IconCircleCheck size={15} stroke={1.6} className="shrink-0 text-workbench-success" />
          : <IconMovie size={15} stroke={1.6} className="shrink-0 text-nomi-ink-60" />}
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-nomi-ink">{title}</span>
        <span className={cn('shrink-0 text-micro px-2 py-0.5 rounded-full leading-relaxed', badge.cls)}>{badge.label}</span>
      </div>

      {editorOpen ? (
        <>
          <span className="text-caption text-nomi-ink-60">{t('storyboardEditor.planCard.editingSummary', { count: shotCount })}</span>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="default" size="sm" onClick={() => setStoryboardEditorOpen(false)}>{t('storyboardEditor.planCard.backToDraft')}</WorkbenchButton>
            <span className="ml-auto text-caption text-nomi-ink-40">{t('storyboardEditor.planCard.confirmHint')}</span>
          </div>
        </>
      ) : committed ? (
        <>
          <span className="text-caption text-nomi-ink-60">{t('storyboardEditor.planCard.committedSummary', { count: shotCount })}</span>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="default" size="sm" onClick={() => setStoryboardEditorOpen(true)}>{t('storyboardEditor.planCard.editAgain')}</WorkbenchButton>
            <WorkbenchButton variant="default" size="sm" className="ml-auto" onClick={() => setWorkspaceMode('generation')}>
              {t('storyboardEditor.planCard.goGeneration')}<IconArrowRight size={13} stroke={1.6} />
            </WorkbenchButton>
          </div>
        </>
      ) : (
        <>
          <span className="text-caption text-nomi-ink-60">{meta}</span>
          <div className="flex flex-col">
            {plan.shots.slice(0, 2).map((shot) => (
              <div key={shot.index} className="flex gap-2 py-1 border-t border-nomi-line-soft text-caption text-nomi-ink-60">
                <span className="shrink-0 tabular-nums text-nomi-ink-40">{String(shot.index).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1 truncate">{shot.prompt.trim() || t('storyboardEditor.planCard.emptyPrompt')}</span>
              </div>
            ))}
            {shotCount > 2 ? (
              <div className="flex gap-2 py-1 border-t border-nomi-line-soft text-caption text-nomi-ink-40">
                <span className="shrink-0">···</span><span>{t('storyboardEditor.planCard.moreShots', { count: shotCount - 2 })}</span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="primary" size="sm" onClick={() => setStoryboardEditorOpen(true)}>{t('storyboardEditor.planCard.openEditor')}</WorkbenchButton>
            <button
              type="button"
              onClick={onDiscard}
              className="ml-auto text-caption text-nomi-ink-40 hover:text-workbench-danger"
            >
              {t('storyboardEditor.discard')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

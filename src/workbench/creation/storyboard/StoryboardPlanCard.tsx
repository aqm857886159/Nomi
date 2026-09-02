import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconCircleCheck, IconMovie } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton, confirmDialog } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { totalDurationSec } from '../../generationCanvas/agent/storyboardPlanEdits'
import { materializedShotIds } from './exec/storyboardNodeBinding'

/**
 * 分镜方案卡片：拆镜头产出的摘要+状态+入口。住两处（同一实现）：创作区对话流的回看卡，
 * 与激活方案时创作中列的摘要卡（v5 C3：中列不再 mount 编辑器）。
 * 纯视图——数据全读单一真相源 storyboardPlan；「打开分镜」跳 storyboard 工作区（编辑器唯一的家）。
 */
type StoryboardPlanCardProps = {
  documentId?: string
  storyboardId?: string
}

export default function StoryboardPlanCard({ documentId, storyboardId }: StoryboardPlanCardProps = {}): JSX.Element | null {
  const { t } = useTranslation()
  const activeDocumentId = useWorkbenchStore((s) => s.activeDocumentId)
  const targetDocumentId = documentId ?? activeDocumentId
  const entry = useWorkbenchStore((s) => (targetDocumentId ? s.storyboardPlans[targetDocumentId] : undefined))
  const exactDesign = useWorkbenchStore((s) => storyboardId
    ? s.storyboardDesignsByDocumentId[targetDocumentId]?.find((design) => design.id === storyboardId)
    : undefined)
  const plan = exactDesign?.plan ?? (storyboardId ? null : entry?.plan ?? null)
  const storedCommitted = exactDesign?.committed ?? (storyboardId ? false : entry?.committed ?? false)
  const deleteStoryboardDesign = useWorkbenchStore((s) => s.deleteStoryboardDesign)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setActiveStoryboardId = useWorkbenchStore((s) => s.setActiveStoryboardId)
  const projectedStoryboardId = useWorkbenchStore((s) => {
    const currentEntry = targetDocumentId ? s.storyboardPlans[targetDocumentId] : undefined
    const designs = s.storyboardDesignsByDocumentId[targetDocumentId] ?? []
    return designs.find((design) => design.plan === currentEntry?.plan)?.id ?? designs[0]?.id
  })
  const resolvedStoryboardId = exactDesign?.id ?? projectedStoryboardId
  // v5 committed 语义 derive：至少一镜已建节点（表是节点的投影；节点删光即回草稿）。
  // 旧项目（确认落画布时代，节点 meta 无 designId）回退存量 committed 标记。
  const builtCount = useGenerationCanvasStore((s) => (
    resolvedStoryboardId ? materializedShotIds(s.nodes, resolvedStoryboardId).size : 0
  ))
  const committed = builtCount > 0 || storedCommitted

  if (!plan) return null

  const title = plan.title.trim() || t('storyboardEditor.planCard.defaultTitle')
  const shotCount = plan.shots.length
  const anchorCount = plan.anchors.length
  // 合计时长：图片镜按停留时长计入（v5，effectiveShotDurationSec 单源）——与场组头小结同口径。
  const totalSec = totalDurationSec(plan.shots)
  const meta = t('storyboardEditor.planCard.meta', {
    shots: shotCount,
    anchors: anchorCount,
    duration: t('storyboardEditor.planCard.duration', { seconds: totalSec }),
  })

  const onDiscard = async () => {
    const ok = await confirmDialog({
      title: t('storyboardEditor.discardTitle'),
      message: t('storyboardEditor.planCard.discardMessage'),
      confirmLabel: t('storyboardEditor.discard'),
      danger: true,
    })
    if (ok && resolvedStoryboardId) deleteStoryboardDesign(resolvedStoryboardId, targetDocumentId)
  }

  // v5 C3：编辑器搬进分镜工作区后，「打开」= 激活该方案 + 跳分镜页（不再切回 creation 主列）。
  const openStoryboard = () => {
    if (resolvedStoryboardId) setActiveStoryboardId(resolvedStoryboardId, targetDocumentId)
    setWorkspaceMode('storyboard')
  }

  // 状态徽标用 Nomi 品牌色(草稿=暖 accent、已落=success)。StatusBadge 是 Mantine
  // gray/blue/green，非品牌色 → 这里保留手写品牌 chip(2026-06-22 回归核对:别让品牌色被压成通用灰蓝)。
  const badge = committed
    ? { label: t('storyboardEditor.planCard.committed'), cls: 'bg-workbench-success-soft text-workbench-success' }
    : { label: t('storyboardEditor.planCard.draft'), cls: 'bg-nomi-accent-soft text-nomi-accent' }

  return (
    <div
      className={cn('flex flex-col gap-2 p-3 rounded-nomi border border-nomi-line bg-nomi-paper')}
      data-storyboard-card={committed ? 'committed' : 'draft'}
    >
      <div className="flex items-center gap-2 min-w-0">
        {committed
          ? <IconCircleCheck size={15} stroke={1.6} className="shrink-0 text-workbench-success" />
          : <IconMovie size={15} stroke={1.6} className="shrink-0 text-nomi-ink-60" />}
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-nomi-ink">{title}</span>
        <span className={cn('shrink-0 text-micro px-2 py-0.5 rounded-full leading-relaxed', badge.cls)}>{badge.label}</span>
      </div>

      {committed ? (
        <>
          <span className="text-caption text-nomi-ink-60">{t('storyboardEditor.planCard.committedSummary', { count: builtCount > 0 ? builtCount : shotCount })}</span>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="default" size="sm" onClick={openStoryboard}>{t('storyboardEditor.planCard.editAgain')}</WorkbenchButton>
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
            <WorkbenchButton variant="primary" size="sm" onClick={openStoryboard}>{t('storyboardEditor.planCard.openStoryboard')}</WorkbenchButton>
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

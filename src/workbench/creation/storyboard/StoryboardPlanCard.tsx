import React from 'react'
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
  const plan = useWorkbenchStore((s) => s.storyboardPlan)
  const committed = useWorkbenchStore((s) => s.storyboardPlanCommitted)
  const editorOpen = useWorkbenchStore((s) => s.storyboardEditorOpen)
  const setStoryboardEditorOpen = useWorkbenchStore((s) => s.setStoryboardEditorOpen)
  const discardStoryboardPlan = useWorkbenchStore((s) => s.discardStoryboardPlan)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)

  if (!plan) return null

  const title = plan.title.trim() || '分镜方案'
  const shotCount = plan.shots.length
  const anchorCount = plan.anchors.length
  const totalSec = Math.round(plan.shots.reduce((sum, shot) => sum + (shot.durationSec || 0), 0))
  const meta = `${shotCount} 个镜头 · ${anchorCount} 个参考锚 · 约 ${totalSec}s`

  const onDiscard = async () => {
    const ok = await confirmDialog({
      title: '丢弃这份方案？',
      message: '方案和你的修改会清空，可以重新让 AI 拆镜头。',
      confirmLabel: '丢弃',
      danger: true,
    })
    if (ok) discardStoryboardPlan()
  }

  const badge = editorOpen
    ? { label: '编辑中', cls: 'bg-nomi-accent-soft text-nomi-accent' }
    : committed
      ? { label: '已落画布', cls: 'bg-[var(--workbench-success-soft)] text-[var(--workbench-success)]' }
      : { label: '草稿', cls: 'bg-nomi-accent-soft text-nomi-accent' }

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
          ? <IconCircleCheck size={15} stroke={1.6} className="shrink-0 text-[var(--workbench-success)]" />
          : <IconMovie size={15} stroke={1.6} className="shrink-0 text-nomi-ink-60" />}
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-nomi-ink">{title}</span>
        <span className={cn('shrink-0 text-micro px-2 py-0.5 rounded-full leading-relaxed', badge.cls)}>{badge.label}</span>
      </div>

      {editorOpen ? (
        <>
          <span className="text-caption text-nomi-ink-60">正在左侧编辑器中修改 · {shotCount} 个镜头</span>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="default" size="sm" onClick={() => setStoryboardEditorOpen(false)}>收起卡片</WorkbenchButton>
            <span className="ml-auto text-caption text-nomi-ink-40">在编辑器里确认即落画布</span>
          </div>
        </>
      ) : committed ? (
        <>
          <span className="text-caption text-nomi-ink-60">{shotCount} 个镜头已建成画布节点</span>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="default" size="sm" onClick={() => setStoryboardEditorOpen(true)}>再次编辑</WorkbenchButton>
            <button
              type="button"
              onClick={() => setWorkspaceMode('generation')}
              className="ml-auto inline-flex items-center gap-1 h-6 px-2.5 rounded-full border border-nomi-line bg-nomi-paper text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink-80"
            >
              去生成区<IconArrowRight size={13} stroke={1.6} />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-caption text-nomi-ink-60">{meta}</span>
          <div className="flex flex-col">
            {plan.shots.slice(0, 2).map((shot) => (
              <div key={shot.index} className="flex gap-2 py-1 border-t border-nomi-line-soft text-caption text-nomi-ink-60">
                <span className="shrink-0 tabular-nums text-nomi-ink-40">{String(shot.index).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1 truncate">{shot.prompt.trim() || '（未写提示词）'}</span>
              </div>
            ))}
            {shotCount > 2 ? (
              <div className="flex gap-2 py-1 border-t border-nomi-line-soft text-caption text-nomi-ink-40">
                <span className="shrink-0">···</span><span>还有 {shotCount - 2} 个镜头</span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <WorkbenchButton variant="primary" size="sm" onClick={() => setStoryboardEditorOpen(true)}>打开编辑</WorkbenchButton>
            <button
              type="button"
              onClick={onDiscard}
              className="ml-auto text-caption text-nomi-ink-40 hover:text-[var(--workbench-danger)]"
            >
              丢弃
            </button>
          </div>
        </>
      )}
    </div>
  )
}

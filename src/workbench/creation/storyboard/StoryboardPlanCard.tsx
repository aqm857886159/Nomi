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
  // 图片分镜（全镜 durationSec=0）没有总时长——只报「图片分镜」，别显示误导的「约 0s」。
  const totalSec = Math.round(plan.shots.reduce((sum, shot) => sum + (shot.shotKind === 'image' ? 0 : shot.durationSec || 0), 0))
  const meta = `${shotCount} 个镜头 · ${anchorCount} 个参考锚 · ${totalSec > 0 ? `约 ${totalSec}s` : '图片分镜'}`

  const onDiscard = async () => {
    const ok = await confirmDialog({
      title: '丢弃这份方案？',
      message: '方案和你的修改会清空，可以重新让 AI 拆镜头。',
      confirmLabel: '丢弃',
      danger: true,
    })
    if (ok) discardStoryboardPlan()
  }

  // 状态徽标用 Nomi 品牌色(草稿/编辑=暖 accent、已落=success)。StatusBadge 是 Mantine
  // gray/blue/green，非品牌色 → 这里保留手写品牌 chip(2026-06-22 回归核对:别让品牌色被压成通用灰蓝)。
  const badge = editorOpen
    ? { label: '编辑中', cls: 'bg-nomi-accent-soft text-nomi-accent' }
    : committed
      ? { label: '已落画布', cls: 'bg-workbench-success-soft text-workbench-success' }
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
          ? <IconCircleCheck size={15} stroke={1.6} className="shrink-0 text-workbench-success" />
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
            <WorkbenchButton variant="default" size="sm" className="ml-auto" onClick={() => setWorkspaceMode('generation')}>
              去生成区<IconArrowRight size={13} stroke={1.6} />
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
              className="ml-auto text-caption text-nomi-ink-40 hover:text-workbench-danger"
            >
              丢弃
            </button>
          </div>
        </>
      )}
    </div>
  )
}

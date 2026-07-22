// 3D 导演台顶部工具栏（任务优先重构 2026-07-22 拍板样张）：
// 标题 ｜ 三个任务入口（构图图 / 人物动作 / 运镜参考，同一套编辑器状态，绝非并行版）｜
// 精调（右栏开合）· 重看引导 · 任务 CTA（原「出片」面板已删，三产物由任务 CTA 直达）· 关闭。
import React from 'react'
import { IconCube, IconHelp, IconPhoto, IconRun, IconVideo, IconX } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import {
  SCENE3D_TASK_ORDER,
  SCENE3D_TASK_LABEL,
  SCENE3D_TASK_SHORT_LABEL,
  type Scene3DTaskMode,
} from './scene3dTaskMode'

const TASK_ICON: Record<Scene3DTaskMode, typeof IconPhoto> = {
  compose: IconPhoto,
  act: IconRun,
  move: IconVideo,
}

type Scene3DFullscreenHeaderProps = {
  nodeTitle: string
  task: Scene3DTaskMode
  ctaLabel: string
  ctaTitle: string
  refineOpen: boolean
  onTaskChange: (task: Scene3DTaskMode) => void
  onCta: () => void
  onToggleRefine: () => void
  onReplayCoach: () => void
  onClose: () => void
}

export function Scene3DFullscreenHeader({
  nodeTitle,
  task,
  ctaLabel,
  ctaTitle,
  refineOpen,
  onTaskChange,
  onCta,
  onToggleRefine,
  onReplayCoach,
  onClose,
}: Scene3DFullscreenHeaderProps): JSX.Element {
  return (
    <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconCube size={18} className="shrink-0 text-[var(--workbench-muted)]" />
        <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">{nodeTitle}</div>
      </div>
      {/* 任务入口：先选产物、不先学系统（审计 §6.1）。当前任务持续可见。 */}
      <div className="flex shrink-0 items-center gap-1 rounded-pill bg-[var(--nomi-ink-05)] p-0.5" role="tablist" aria-label="任务入口">
        {SCENE3D_TASK_ORDER.map((candidate) => {
          const Icon = TASK_ICON[candidate]
          const active = candidate === task
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={active}
              title={SCENE3D_TASK_LABEL[candidate]}
              onClick={() => onTaskChange(candidate)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-caption transition-colors',
                active
                  ? 'bg-[var(--nomi-paper)] font-medium text-[var(--nomi-ink)] shadow-nomi-sm'
                  : 'text-[var(--nomi-ink-60)] hover:text-[var(--nomi-ink)]',
              )}
            >
              <Icon size={14} />
              <span>{SCENE3D_TASK_SHORT_LABEL[candidate]}</span>
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <button
          type="button"
          title={refineOpen ? '收起精调（右栏属性 / 整运镜）' : '精调：完整属性 / 轨迹 / 录 take 都在右栏'}
          aria-pressed={refineOpen}
          onClick={onToggleRefine}
          className={cn(
            'inline-flex h-8 shrink-0 items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] px-2.5 text-caption transition-colors',
            refineOpen
              ? 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]'
              : 'bg-[var(--nomi-paper)] text-[var(--workbench-muted)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-ink)]',
          )}
        >
          精调
        </button>
        <button
          type="button"
          title="重看新手引导"
          onClick={onReplayCoach}
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--workbench-muted)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-ink)]"
        >
          <IconHelp size={15} />
        </button>
        {/* 任务 CTA：完成按钮就是产物动作（coach 第 5 步仍锚在这，data-coach 沿用） */}
        <button
          type="button"
          data-coach="export-button"
          onClick={onCta}
          title={ctaTitle}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-3 text-caption font-medium text-[var(--nomi-paper)] transition-opacity hover:opacity-90"
        >
          <span>{ctaLabel}</span>
        </button>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
          type="button"
          title="退出 3D 场景"
          onClick={onClose}
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  )
}

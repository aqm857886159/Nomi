/**
 * 「添加模型」虚线卡——排在列表末尾，与其它卡同列（不再浮在头部）。
 * 长尾逃生口：接入不在预置供应商里的自定义模型，点击打开 OnboardingWizard。
 * 规范：docs/plan/2026-06-07-onboarding-panel-redesign.md §5.3
 */
import React from 'react'
import { IconPlus } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

type AddModelCardProps = {
  onClick: () => void
}

export function AddModelCard({ onClick }: AddModelCardProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 p-3 w-full text-left',
        'border border-dashed border-nomi-ink-20 rounded-nomi bg-nomi-paper',
        'hover:border-nomi-accent hover:bg-nomi-ink-05',
      )}
    >
      <span className="w-7 h-7 rounded-nomi-sm bg-nomi-ink-05 grid place-items-center shrink-0 text-nomi-ink-60 group-hover:text-nomi-accent">
        <IconPlus size={16} stroke={1.8} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-body-sm font-semibold text-nomi-ink group-hover:text-nomi-accent">添加模型</span>
        <span className="block text-caption text-nomi-ink-40">接入不在上面的自定义模型</span>
      </span>
    </button>
  )
}

import React, { type JSX } from 'react'
import { cn } from '../../../../utils/cn'

export type NodeEmptyStateProps = {
  icon: React.ReactNode
  /** 不给标题和说明 = 只剩图标 + 下一步（空节点「试试」替换掉那一句说明，种类已由图标和框外标签行说了）。 */
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
  compact?: boolean
}

/**
 * 空节点的统一排法（2026-10-08 Claude Design 拍板稿 EmptyStates）：内容从同一高度往下排（不上下居中），
 * 类型图标深色放在 36px 浅灰圆底里 → 类型名加粗 → 状态小字 → 动作行；所有行在同一条水平轴上对齐。
 * compact（音频条）是一行的横向变体。
 */
export function NodeEmptyState({ icon, title, description, action, className, compact = false }: NodeEmptyStateProps): JSX.Element {
  return (
    <div
      data-node-empty-state="true"
      className={cn('flex h-full w-full px-3 text-center', compact ? 'items-center justify-center gap-2 py-2' : 'flex-col items-center justify-start pt-[26px] pb-3', className)}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full bg-nomi-ink-05 text-nomi-ink-80 ring-1 ring-inset ring-nomi-line [&>svg]:size-[18px]"
        aria-hidden="true"
      >
        {icon}
      </span>
      {title || description ? (
        <span className={cn('flex min-w-0 flex-col', compact ? 'flex-1 text-left' : 'mt-2 items-center')}>
          {title ? <span className="text-body-sm font-semibold leading-[18px] text-nomi-ink-80">{title}</span> : null}
          {description ? <span className="mt-px max-w-[22rem] text-caption leading-4 text-nomi-ink-40">{description}</span> : null}
        </span>
      ) : null}
      {action ? <div className="mt-3 flex max-w-full justify-center">{action}</div> : null}
    </div>
  )
}

export function NodeEmptyAction({ children, onClick }: { children: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-nomi-sm bg-nomi-ink px-3 py-1.5 text-caption font-medium text-nomi-paper transition-colors hover:bg-nomi-accent"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={children}
    >
      {children}
    </button>
  )
}

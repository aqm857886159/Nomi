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
 * All node kinds share one empty-state rhythm, aligned on ONE axis (centered): a small, quiet line icon (no solid disc),
 * then what this node does (if said), then the next actions. 2026-10-08 用户：「大 icon 设计有点丑…排版都不对齐」。
 */
export function NodeEmptyState({ icon, title, description, action, className, compact = false }: NodeEmptyStateProps): JSX.Element {
  return (
    <div data-node-empty-state="true" className={cn('flex h-full w-full items-center justify-center px-4 text-center', compact ? 'gap-2 py-2' : 'flex-col gap-3 py-5', className)}>
      <span className="grid shrink-0 place-items-center text-nomi-ink-40" aria-hidden="true">
        {icon}
      </span>
      {title || description ? (
        <span className={cn('flex min-w-0 flex-col gap-1', compact && 'flex-1 text-left')}>
          {title ? <span className="text-body-sm font-semibold text-nomi-ink-80">{title}</span> : null}
          {description ? <span className="max-w-[22rem] text-caption leading-relaxed text-nomi-ink-60">{description}</span> : null}
        </span>
      ) : null}
      {action ? <div className="flex max-w-full justify-center">{action}</div> : null}
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

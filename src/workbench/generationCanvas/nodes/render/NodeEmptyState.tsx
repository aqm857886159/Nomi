import React from 'react'
import { cn } from '../../../../utils/cn'

export type NodeEmptyStateProps = {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
  className?: string
  compact?: boolean
}

/** All node kinds share one empty-state rhythm: what this node does, then the next action. */
export function NodeEmptyState({ icon, title, description, action, className, compact = false }: NodeEmptyStateProps): JSX.Element {
  return (
    <div data-node-empty-state="true" className={cn('flex h-full w-full items-center justify-center gap-2 px-4 text-center', compact ? 'py-2' : 'flex-col py-5', className)}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-nomi-ink text-nomi-paper" aria-hidden="true">
        {icon}
      </span>
      <span className={cn('flex min-w-0 flex-col gap-1', compact && 'flex-1 text-left')}>
        <span className="text-body-sm font-semibold text-nomi-ink-80">{title}</span>
        <span className="max-w-[22rem] text-caption leading-relaxed text-nomi-ink-60">{description}</span>
      </span>
      {action ? <div className="pt-1">{action}</div> : null}
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

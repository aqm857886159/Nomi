import React from 'react'
import { IconChevronLeft, IconChevronRight, IconLayersSubtract } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'

/** Deterministic window used by the visual stack and its keyboard tests. */
export function residentBatchIndexes(total: number, activeIndex: number, maxVisible = 3): number[] {
  const count = Math.max(0, Math.floor(total))
  if (!count) return []
  const limit = Math.min(count, Math.max(1, Math.floor(maxVisible)))
  const current = Math.min(Math.max(0, Math.floor(activeIndex)), count - 1)
  return Array.from({ length: limit }, (_, offset) => (current + offset) % count)
}

/**
 * Presentation-only stack for a multi-item generation proposal. The Host
 * still owns one call/approval per item; this component only keeps the
 * resident card compact by showing one editor and at most two exposed tabs.
 */
export function ResidentBatchStack<T>({
  items,
  activeIndex,
  onSelect,
  getKey,
  getLabel,
  stackLabel,
  previousLabel,
  nextLabel,
  renderActive,
}: {
  items: readonly T[]
  activeIndex: number
  onSelect: (index: number) => void
  getKey: (item: T, index: number) => string
  getLabel: (item: T, index: number) => string
  stackLabel: string
  previousLabel: string
  nextLabel: string
  renderActive: (item: T, index: number) => React.ReactNode
}): JSX.Element | null {
  if (!items.length) return null
  const current = Math.min(Math.max(0, Math.floor(activeIndex)), items.length - 1)
  const indexes = residentBatchIndexes(items.length, current, 3)
  const activeWindow = indexes[0] ?? current
  const peekIndexes = indexes.slice(1)
  const select = (index: number): void => onSelect(Math.min(Math.max(0, index), items.length - 1))
  const move = (delta: number): void => select((current + delta + items.length) % items.length)
  return <section className="grid min-w-0 gap-1" data-agent-batch-stack="true" data-agent-batch-count={items.length} data-agent-batch-visible-count={Math.min(3, items.length)} aria-label={stackLabel}>
    <div className="relative min-w-0 pr-5">
      <div className="relative z-10 min-w-0 rounded-nomi-sm bg-nomi-paper" data-agent-batch-card="active" data-agent-batch-index={activeWindow} key={getKey(items[activeWindow]!, activeWindow)}>
        {renderActive(items[activeWindow]!, activeWindow)}
      </div>
      {peekIndexes.map((index, position) => <button
        key={getKey(items[index]!, index)}
        type="button"
        className={cn('absolute right-0 z-20 flex min-h-8 w-5 items-center justify-center rounded-r-nomi-sm border border-nomi-line bg-nomi-ink-05 text-micro font-medium text-nomi-ink-60 shadow-sm transition-[background,color,transform] duration-[var(--nomi-transition-fast)] hover:bg-nomi-accent-soft hover:text-nomi-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40 motion-reduce:transition-none', position === 0 ? 'top-2' : 'top-10')}
        style={{ transform: `translateX(${position === 0 ? 0 : 1}px)` }}
        data-agent-batch-stack-peek={index}
        aria-label={getLabel(items[index]!, index)}
        title={getLabel(items[index]!, index)}
        onClick={() => select(index)}
      >
        <span aria-hidden="true">{index + 1}</span>
      </button>)}
    </div>
    {items.length > 1 ? <div className="flex min-w-0 items-center gap-1 border-t border-nomi-line-soft pt-1" data-agent-batch-navigation="true">
      <IconLayersSubtract size={13} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-micro text-nomi-ink-60">{stackLabel} · {current + 1}/{items.length}</span>
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40" data-agent-batch-action="previous" aria-label={previousLabel} title={previousLabel} onClick={() => move(-1)}><IconChevronLeft size={14} aria-hidden="true" /></button>
      <button type="button" className="grid size-7 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nomi-accent/40" data-agent-batch-action="next" aria-label={nextLabel} title={nextLabel} onClick={() => move(1)}><IconChevronRight size={14} aria-hidden="true" /></button>
    </div> : null}
  </section>
}

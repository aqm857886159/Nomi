import React, { type JSX } from 'react'
import { IconChevronRight } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

export type PlanRow = Readonly<{
  id?: string
  label: string
  detail?: string
  technical?: string
  checked: boolean
  group?: string
  aside?: string
}>

/** The single checklist row used by paid plan cards and storyboard batch confirmation. */
export function PlanRows({
  rows,
  onToggle,
  renderLabel,
  className,
}: {
  rows: readonly PlanRow[]
  onToggle: (row: PlanRow, checked: boolean) => void
  renderLabel?: (row: PlanRow) => React.ReactNode
  className?: string
}): JSX.Element {
  const labelContent = (row: PlanRow): React.ReactNode =>
    renderLabel ? renderLabel(row) : (
      <>
        {row.label}
        {row.detail ? <span className="block text-micro text-nomi-ink-60">{row.detail}</span> : null}
      </>
    )
  return (
    <div className={cn('flex flex-col gap-1 overflow-y-auto', rows.some((row) => row.group) ? 'max-h-[17rem]' : 'max-h-[13.5rem]', className)} data-v4-block="plan-rows">
      {rows.map((row, index) => (
        <React.Fragment key={`${index}-${row.label}`}>
          {row.group && row.group !== rows[index - 1]?.group ? (
            <div className={cn('text-micro font-semibold text-nomi-ink-40', index > 0 && 'pt-1.5')} data-v4-block="plan-group">{row.group}</div>
          ) : null}
          <div className="flex items-start gap-2 py-[3px] text-caption text-nomi-ink-80">
            <input
              type="checkbox"
              aria-label={row.label}
              checked={row.checked}
              onChange={(event) => onToggle(row, event.target.checked)}
              className="mt-0.5 size-3.5 shrink-0 accent-nomi-accent"
            />
            {row.technical ? (
              <details className="group min-w-0 flex-1" data-v4-block="plan-detail">
                <summary className="flex cursor-pointer list-none items-start gap-1">
                  <div className="min-w-0 flex-1">{labelContent(row)}</div>
                  <IconChevronRight size={12} className="mt-0.5 shrink-0 group-open:rotate-90" aria-hidden="true" />
                </summary>
                <pre className="m-0 mt-1 whitespace-pre-wrap break-all font-nomi-mono text-micro text-nomi-ink-40">{row.technical}</pre>
              </details>
            ) : row.aside ? (
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <div className="min-w-0 flex-1 truncate">{labelContent(row)}</div>
                <span className="shrink-0 text-micro text-nomi-ink-40" data-v4-block="plan-aside">{row.aside}</span>
              </div>
            ) : (
              <div className="min-w-0 flex-1">{labelContent(row)}</div>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

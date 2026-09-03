import React from 'react'
import { cn } from '../../../utils/cn'

type SelectionToolbarFrameProps = React.PropsWithChildren<{
  ariaLabel: string
  className?: string
  dataStoryboardSelectionToolbar?: boolean
  transform?: string
  maxWidth?: number
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
}>

/** Shared selection-toolbar chrome. Actions remain owned by each surface. */
export function SelectionToolbarFrame({
  ariaLabel,
  className,
  dataStoryboardSelectionToolbar,
  transform,
  maxWidth,
  onPointerDown,
  children,
}: SelectionToolbarFrameProps): JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 overflow-x-auto rounded-full border border-nomi-line',
        'bg-nomi-paper/[0.96] px-2.5 py-1.5 shadow-nomi-md pointer-events-auto',
        className,
      )}
      style={{ transform, maxWidth }}
      aria-label={ariaLabel}
      data-storyboard-selection-toolbar={dataStoryboardSelectionToolbar ? 'true' : undefined}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  )
}

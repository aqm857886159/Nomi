import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import {
  TIMELINE_PANEL_DEFAULT,
  TIMELINE_PANEL_MAX,
  TIMELINE_PANEL_MIN,
  useWorkbenchStore,
} from '../workbenchStore'

export function timelineResizeKeyboardHeight(current: number, key: string): number | null {
  if (key === 'ArrowUp') return current + 16
  if (key === 'ArrowDown') return current - 16
  if (key === 'Home') return TIMELINE_PANEL_MIN
  if (key === 'End') return TIMELINE_PANEL_MAX
  return null
}

/** One shared splitter for the generation and preview timeline projection. */
export default function TimelineResizeHandle(): JSX.Element {
  const { t } = useTranslation()
  const height = useWorkbenchStore((state) => state.timelinePanelHeight)
  const setHeight = useWorkbenchStore((state) => state.setTimelinePanelHeight)
  const dragRef = React.useRef<{ startY: number; startHeight: number } | null>(null)
  const adjust = React.useCallback((next: number) => setHeight(next), [setHeight])
  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startY: event.clientY, startHeight: height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [height])
  const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    if (!start) return
    adjust(start.startHeight + start.startY - event.clientY)
  }, [adjust])
  const endDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* noop */ }
  }, [])
  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = timelineResizeKeyboardHeight(height, event.key)
    if (next === null) return
    event.preventDefault()
    adjust(next)
  }, [adjust, height])

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('agentResident.timelineResize')}
      aria-valuemin={TIMELINE_PANEL_MIN}
      aria-valuemax={TIMELINE_PANEL_MAX}
      aria-valuenow={height}
      tabIndex={0}
      className={cn(
        'absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none',
        'flex items-center justify-center outline-none',
        'focus-visible:ring-2 focus-visible:ring-nomi-accent',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => adjust(TIMELINE_PANEL_DEFAULT)}
      onKeyDown={onKeyDown}
      title={t('agentResident.timelineHeight', { height })}
    >
      <span className="h-0.5 w-16 rounded-pill bg-nomi-ink-20 transition-colors hover:bg-nomi-accent" />
    </div>
  )
}

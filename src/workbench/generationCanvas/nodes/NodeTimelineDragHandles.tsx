import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconGripVertical } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'

type AddToTimelineEvent = React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>

type TimelineDragHandleProps = {
  onAddAtPlayhead: (event: AddToTimelineEvent) => void
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
}

function handleKeyboardAdd(
  event: React.KeyboardEvent<HTMLElement>,
  onAddAtPlayhead: (event: AddToTimelineEvent) => void,
): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  onAddAtPlayhead(event)
}

export function TimelineNotchDragHandle({ onAddAtPlayhead, onDragStart }: TimelineDragHandleProps): JSX.Element {
  const { t } = useTranslation()
  const label = t('timelineEditor.dragToTimeline')
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'absolute left-1/2 top-0 z-[9] inline-flex h-[22px] w-[76px] items-center justify-center overflow-hidden px-2',
        '-translate-x-1/2 translate-y-[-8px] scale-[0.96] origin-top rounded-b-[18px]',
        'pointer-events-none border border-t-0 border-[var(--nomi-line-soft)] bg-nomi-paper text-nomi-ink-60 opacity-0 shadow-nomi-sm',
        'font-[inherit] text-micro font-medium cursor-grab active:cursor-grabbing',
        'will-change-[transform,opacity] transition-[opacity,transform,color,background,box-shadow] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        'group-hover/node:pointer-events-auto group-hover/node:translate-y-0 group-hover/node:scale-100 group-hover/node:opacity-100',
        'group-focus-within/node:pointer-events-auto group-focus-within/node:translate-y-0 group-focus-within/node:scale-100 group-focus-within/node:opacity-100',
        'hover:bg-nomi-paper hover:text-nomi-ink hover:shadow-nomi-md',
        'focus-visible:bg-nomi-paper focus-visible:text-nomi-ink focus-visible:shadow-nomi-md',
        'active:translate-y-0 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workbench-accent)] focus-visible:ring-offset-2',
      )}
      aria-label={label}
      title={t('timelineEditor.dragToTimelineHold', { label })}
      draggable
      onClick={(event) => event.stopPropagation()}
      onDragStart={onDragStart}
      onKeyDown={(event) => handleKeyboardAdd(event, onAddAtPlayhead)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconGripVertical size={13} stroke={1.8} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function SideTimelineDragHandle({ onAddAtPlayhead, onDragStart }: TimelineDragHandleProps): JSX.Element {
  const { t } = useTranslation()
  const label = t('timelineEditor.dragToTimeline')
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'generation-canvas-v2-node__timeline-drag group',
        'absolute top-1/2 right-[-42px] z-[7]',
        'inline-flex items-center justify-center',
        'w-8 h-12 m-0 p-0 border border-nomi-line rounded-full',
        'bg-nomi-paper/[0.94] text-nomi-ink-60 font-[inherit]',
        'cursor-grab backdrop-blur-[10px] shadow-nomi-md',
        '-translate-y-1/2 transition-[transform,color,background,box-shadow] duration-150 ease-out',
        'active:cursor-grabbing active:scale-[0.96]',
        'hover:bg-nomi-paper hover:text-nomi-ink hover:shadow-nomi-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workbench-accent)] focus-visible:ring-offset-2',
      )}
      aria-label={label}
      title={label}
      draggable
      onClick={onAddAtPlayhead}
      onDragStart={onDragStart}
      onKeyDown={(event) => handleKeyboardAdd(event, onAddAtPlayhead)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconGripVertical size={18} stroke={1.6} aria-hidden="true" />
      <span
        className={cn(
          'pointer-events-none absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2',
          'whitespace-nowrap rounded-full px-2.5 py-1.5',
          'bg-nomi-ink text-nomi-paper text-micro font-medium leading-none',
          'opacity-0 translate-x-[-4px] transition-[opacity,transform] duration-150',
          'group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0',
        )}
      >
        {label}
      </span>
    </div>
  )
}

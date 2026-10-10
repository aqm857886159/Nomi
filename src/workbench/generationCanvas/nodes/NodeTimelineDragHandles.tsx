import React, { type JSX } from 'react'
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
        'pointer-events-auto border border-t-0 border-[var(--nomi-line-soft)] bg-nomi-paper text-nomi-ink-60 opacity-0 shadow-nomi-sm',
        'font-[inherit] text-micro font-medium cursor-grab active:cursor-grabbing',
        'will-change-[transform,opacity] transition-[opacity,transform,color,background,box-shadow] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        // 命中不靠悬停：把手一直可命中，悬停节点只管让它显出来（原来 pointer-events-none 到悬停才开，拖放源点依赖视觉状态）。
        'group-hover/node:translate-y-0 group-hover/node:scale-100 group-hover/node:opacity-100',
        'group-focus-within/node:translate-y-0 group-focus-within/node:scale-100 group-focus-within/node:opacity-100',
        'hover:bg-nomi-paper hover:text-nomi-ink hover:opacity-100 hover:shadow-nomi-md',
        'focus-visible:bg-nomi-paper focus-visible:text-nomi-ink focus-visible:shadow-nomi-md',
        'active:translate-y-0 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workbench-accent)] focus-visible:ring-offset-2',
      )}
      aria-label={label}
      title={t('timelineEditor.dragToTimelineHold', { label })}
      draggable
      onClick={onAddAtPlayhead}
      onDragStart={onDragStart}
      onKeyDown={(event) => handleKeyboardAdd(event, onAddAtPlayhead)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconGripVertical size={13} stroke={1.8} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

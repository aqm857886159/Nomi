import React, { type JSX } from 'react'
import { cn } from '../../../utils/cn'
import { getCardStackRearLayerCount } from '../model/canvasCardStackModel'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'

export type CardStackPeeksProps = {
  count: number
  label: string
  expanded: boolean
  onToggle: () => void
  tone?: 'result' | 'group'
  disabled?: boolean
}

const RESTING_TRANSFORMS = [
  'translate(11px, 4px) rotate(1.5deg)',
  'translate(20px, 8px) rotate(3deg)',
] as const

const FANNED_TRANSFORMS = [
  'translate(18px, 3px) rotate(2.4deg)',
  'translate(34px, 8px) rotate(4.5deg)',
] as const

export function CardStackPeeks({
  count,
  label,
  expanded,
  onToggle,
  tone = 'result',
  disabled = false,
}: CardStackPeeksProps): JSX.Element | null {
  const [hovered, setHovered] = React.useState(false)
  const rearLayerCount = getCardStackRearLayerCount(count)
  if (rearLayerCount === 0) return null
  const fanned = expanded || hovered

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0"
      data-card-stack-side="right"
      data-card-stack-expanded={expanded ? 'true' : 'false'}
    >
      {Array.from({ length: rearLayerCount }, (_, index) => (
        <div
          key={index}
          data-card-stack-rear={index + 1}
          className={cn(
            'absolute inset-0 origin-left rounded-nomi-lg border',
            'transition-transform duration-200 ease-out motion-reduce:transition-none',
            GROUP_VISUAL_CLASS.stackRear,
          )}
          style={{ transform: fanned ? FANNED_TRANSFORMS[index] : RESTING_TRANSFORMS[index] }}
          aria-hidden="true"
        />
      ))}
      <button
        type="button"
        className={cn(
          // 左缘钉在节点右缘外 4px、向右长：原来钉右缘（right-[-42px]），英文「2 versions」比「2 版」长一倍，多出来的长度全长到左边、被节点自己盖住，只露出「rsions」。
          'pointer-events-auto absolute left-[calc(100%+4px)] z-[9] inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5',
          tone === 'group' ? 'top-0' : 'top-4',
          'border text-micro font-semibold tabular-nums',
          GROUP_VISUAL_CLASS.stackTrigger,
          'transition-[transform,background-color,border-color] duration-150 motion-reduce:transition-none',
          'hover:-translate-y-0.5 hover:border-nomi-ink-20 hover:bg-nomi-ink-05',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        aria-label={label}
        aria-expanded={expanded}
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      >
        <span>{label}</span>
      </button>
    </div>
  )
}

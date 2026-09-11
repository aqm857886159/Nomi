import React from 'react'
import { cn } from '../../../utils/cn'
import { getCardStackRearLayerCount } from '../model/canvasCardStackModel'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'

export type CardStackPeeksProps = {
  count: number
  label: string
  expanded: boolean
  onToggle: () => void
  forceTrigger?: boolean
  tone?: 'result' | 'group'
  disabled?: boolean
  /**
   * 这摞伪卡代表的是什么媒体（图 / 视频 / 音频 / 3D…）的示能图标。
   *
   * 为什么需要它：伪卡本来是一摞空白纸片，摆在视频节点后面看起来就是几个**图片占位**，
   * 用户读成「要生成几个」（2026-09-10 反馈 #11）。带上本节点的媒体图标，这摞东西
   * 才自报家门是「这一镜的历史版本」。图标由调用方给，唯一出口是
   * `nodes/renderRegistry.tsx` 的 `getGenerationNodeIcon`——这里不另起一张 kind→图标表。
   *
   * 不传 = 保持原外观（分组折叠卡就不传：那摞代表「几个节点」不是「几个版本」，
   * 给它媒体图标会造出第二种含义）。
   */
  mediaGlyph?: React.ReactNode
  /** 媒体类型名，只用于给走查/测试一个可断言的锚点。 */
  mediaKind?: string
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
  forceTrigger = false,
  tone = 'result',
  disabled = false,
  mediaGlyph,
  mediaKind,
}: CardStackPeeksProps): JSX.Element | null {
  const [hovered, setHovered] = React.useState(false)
  const rearLayerCount = getCardStackRearLayerCount(count)
  if (rearLayerCount === 0 && !forceTrigger) return null
  const fanned = expanded || hovered

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0"
      data-card-stack-side="right"
      data-card-stack-expanded={expanded ? 'true' : 'false'}
      data-card-stack-media={mediaKind}
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
        >
          {/* 只画在最外面那张：它露出的边最宽，是唯一放得下图标又不被前面卡片盖住的一张。 */}
          {mediaGlyph && index === rearLayerCount - 1 ? (
            <span
              data-card-stack-glyph
              className="absolute right-1 top-1/2 -translate-y-1/2 text-nomi-ink-40"
            >
              {mediaGlyph}
            </span>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className={cn(
          'pointer-events-auto absolute right-[-42px] z-[9] inline-flex min-h-7 items-center gap-1 rounded-full px-2.5',
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

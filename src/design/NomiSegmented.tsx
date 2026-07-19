import React from 'react'
import { cn } from '../utils/cn'

/**
 * NomiSegmented —— 分段选择器（segmented control，设计系统通用件）。
 *
 * 视觉语言复用面板 tablist（OnboardingDrawer 素材来源切换）：容器 ink-05 圆角槽 + 选中项 paper
 * 浮起带轻影。用于「参数面板」这类少量离散档位的即点即改场景（2026-07-17 用户拍板的
 * 节点参数交互，样张 docs/design/mockups/node-param-panel.html）。
 * 选项超宽自动换行（flex-wrap，用户已接受）；禁用档置灰不可点。
 */

export type NomiSegmentedOption = {
  value: string
  /** 文本或自定义内容（如比例小图形 + 文字的竖排组合）。 */
  label: React.ReactNode
  /** 悬停提示（如价签全文）。 */
  title?: string
  disabled?: boolean
}

export type NomiSegmentedProps = {
  value: string
  options: NomiSegmentedOption[]
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
  /** 每个分段项的附加类（如比例组统一双行高，保证图形/文字跨项对齐）。 */
  itemClassName?: string
}

export function NomiSegmented({ value, options, onChange, ariaLabel, className, itemClassName }: NomiSegmentedProps): JSX.Element {
  return (
    // grid 等宽列（2026-07-17 用户反馈：flex-1 下换行的孤项被拉伸，「多出来的选项要和其他一样大」）：
    // auto-fit+minmax——所有项严格等宽；选项少于一行时空轨道塌陷、项拉伸**填满父容器**（1K/2K 两项
    // 各占一半，不缩在左边）；选项多于一行时与 auto-fill 无差（换行项与上行同宽）。
    // 尺寸走 inline style 不用任意值类：dev 的 tailwind 生成缓存可能缺新类 → 布局静默塌（栽过两次）。
    <div
      className={cn('grid rounded-nomi bg-nomi-ink-05 p-1 gap-1', className)}
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(56px, 1fr))' }}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={option.title}
            disabled={option.disabled}
            onClick={() => { if (!on) onChange(option.value) }}
            style={{ minHeight: 32 }}
            className={cn(
              'px-2 py-1 rounded-nomi-sm border-0 text-caption cursor-pointer min-w-0',
              'inline-flex flex-col items-center justify-center gap-1 font-[inherit]',
              'transition-colors duration-[var(--nomi-transition-fast)]',
              on
                ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                : 'bg-transparent text-nomi-ink-60 hover:text-nomi-ink-80',
              option.disabled && 'text-nomi-ink-30 hover:text-nomi-ink-30 cursor-not-allowed',
              itemClassName,
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

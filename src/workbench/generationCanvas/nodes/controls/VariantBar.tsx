import React from 'react'
import { cn } from '../../../../utils/cn'
import type { ArchetypeVariantChoice } from './archetypeMeta'

// 「变体」变体分段切换 —— 与 ModeBar（生成方式）并排在常驻参考区头部（用户拍板方案 A：通用 4 选段）。
// 用途：一族「同能力、不同 model 字符串」的变体（Seedance 标准/快速/真人/真人快速）合成 1 个 picker
// 条目后，靠这条分段切换实际发请求的变体。仿 ModeBar 同款视觉/token（rounded-nomi-sm / bg-nomi-ink-05 /
// text-body-sm / shadow-nomi-sm），Tailwind 写在元素上（规则 10），不引 Mantine。
// 标签用变体自己的名字（标准/快速…）；切换只写 meta.archetype.variantId，不动参考值/模式（正交轴）。

type VariantBarProps = {
  choices: ArchetypeVariantChoice[]
  activeId: string
  onSelect: (variantId: string) => void
}

export default function VariantBar({ choices, activeId, onSelect }: VariantBarProps): JSX.Element | null {
  // 只有 >1 变体时才显示分段（单变体无需切换）。
  if (choices.length <= 1) return null
  const active = choices.find((c) => c.id === activeId) ?? choices[0]
  return (
    <div className={cn('flex flex-col gap-1')}>
      <span className={cn('text-nomi-ink-40 text-micro leading-none')}>变体</span>
      <div
        className={cn('inline-flex flex-wrap gap-0.5 p-0.5 rounded-nomi-sm bg-nomi-ink-05 self-start')}
        role="group"
        aria-label="变体"
      >
        {choices.map((choice) => {
          const isActive = choice.id === active.id
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={isActive}
              data-active={isActive ? 'true' : 'false'}
              className={cn(
                'rounded-nomi-sm px-3 py-1.5 text-body-sm leading-none',
                'text-nomi-ink-60 cursor-pointer transition-colors',
                'data-[active=true]:bg-nomi-paper data-[active=true]:text-nomi-ink',
                'data-[active=true]:font-semibold data-[active=true]:shadow-nomi-sm',
              )}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(choice.id)
              }}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

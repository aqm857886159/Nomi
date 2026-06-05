import React from 'react'
import { cn } from '../../../../utils/cn'
import type { ArchetypeModeChoice } from './archetypeMeta'

// 「生成方式」分段切换 —— 常驻参考区的头（样张 v3：切它能当场看到下方参考槽变化，不被弹层遮挡）。
// 主标签用**模型自己的真名**（vendor 原词：首帧/首尾帧/全能参考…）——用户已熟悉这些词，改成意图词反而
// 把能力说窄（如「全能参考」是多模态，写成「角色参考」会让人以为只能放角色）。决策 #2 拍板：保留 vendor 原词。
// 视觉对齐样张 .seg；用 Tailwind 写在元素上（规则 10），与本目录既有的手写文本模式切换器一致，不引 Mantine。

type ModeBarProps = {
  choices: ArchetypeModeChoice[]
  activeId: string
  onSelect: (modeId: string) => void
}

export default function ModeBar({ choices, activeId, onSelect }: ModeBarProps): JSX.Element | null {
  // 只有 >1 模式时才显示分段（单模式无需切换）。
  if (choices.length <= 1) return null
  const active = choices.find((c) => c.id === activeId) ?? choices[0]
  return (
    <div className={cn('flex flex-col gap-[4px]')}>
      <span className={cn('text-nomi-ink-40 text-micro leading-none')}>生成方式</span>
      <div
        className={cn('inline-flex flex-wrap gap-[2px] p-[2px] rounded-nomi-sm bg-nomi-ink-05 self-start')}
        role="group"
        aria-label="生成方式"
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
                'rounded-nomi-sm px-[10px] py-[4px] text-micro leading-none font-[inherit]',
                'text-nomi-ink-60 cursor-pointer transition-colors',
                'data-[active=true]:bg-nomi-paper data-[active=true]:text-nomi-ink',
                'data-[active=true]:font-semibold data-[active=true]:shadow-nomi-sm',
              )}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(choice.id)
              }}
            >
              {choice.vendorTerm}
            </button>
          )
        })}
      </div>
      <div className={cn('text-nomi-ink-40 text-micro leading-[1.35]')}>
        {active.hint}
      </div>
    </div>
  )
}

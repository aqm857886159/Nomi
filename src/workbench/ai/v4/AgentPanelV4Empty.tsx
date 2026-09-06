// Agent 面板 v4 · 对话流为空时的那一格。
//
// 只在**对话流为空**时出现（有一条消息就再也不出现），所以它不是常驻件、不占预算。
//
// 三条纪律，每一条都是拍板过的取舍：
//   · **不加插图、不加机器人 icon**。那是装饰，不是行动价值（R2）；面板宽 340–390，
//     一张插画会把三颗真能点的 chip 挤到下面去。
//   · **不自动发送**。chip 只把那句话填进 composer 并把光标交给用户——第一句话花不花钱、
//     要不要改，都该由他按下发送。自动发送等于替他做了一个不可逆决定。
//   · **一句话 + 三条起手**，不写使用说明。哪三条由 `agentPanelV4EmptyState.ts` 从
//     已注册能力表派生，这里只负责长相。
//
// 布局复用 `DesignEmptyState`（设计系统 §3.3 全仓统一空态），不另写一份居中结构。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DesignEmptyState } from '../../../design'
import { starterChipsForSurface, V4_EMPTY_TITLE_KEY } from './agentPanelV4EmptyState'
import type { ResidentSurface } from '../resident/residentShellDisplay'

export function V4EmptyState({
  surface,
  onStarter,
}: {
  surface: ResidentSurface
  onStarter?: (prompt: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const chips = starterChipsForSurface(surface)
  return (
    <div className="my-auto" data-v4-block="empty" data-v4-empty-surface={surface}>
      <DesignEmptyState
        density="inline"
        title={t(V4_EMPTY_TITLE_KEY[surface])}
        action={
          <div className="flex flex-wrap justify-center gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                data-v4-starter={chip.id}
                onClick={() => onStarter?.(t(chip.promptKey))}
                className="rounded-full border border-nomi-line px-2.5 py-1 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05"
              >
                {t(chip.labelKey)}
              </button>
            ))}
          </div>
        }
      />
    </div>
  )
}

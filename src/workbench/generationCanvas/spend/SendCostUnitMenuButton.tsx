import React, { type JSX } from 'react'
import { IconCoin } from '../../../vendor/tablerIcons'
import { ICON_TIERS, WorkbenchMenu, type WorkbenchMenuNode } from '../../../design'
import type { SendCostUnit } from './sendCostUnitStore'

export type SendCostUnitMenuOption = {
  unit: SendCostUnit
  label: string
  formatted: string
}

/**
 * 发送键左侧的约价单位切换按钮 + 下拉菜单（组标题统一写一次「预计」，三行纯净数值 + 右侧蓝勾，内容派生紧凑宽度）。
 * 走 `WorkbenchMenu trigger` 真触发器入口（Radix 原生管理锚点、开合、`data-state="open"` 与焦点归还），点击只切单位、绝不误触发送。
 */
export function SendCostUnitMenuButton({
  displayText,
  unit,
  options,
  menuHeading,
  menuAriaLabel,
  switchAriaLabel,
  onUnitChange,
  onOpenChange,
}: {
  displayText: string
  unit: SendCostUnit
  options: readonly SendCostUnitMenuOption[]
  menuHeading?: string
  menuAriaLabel?: string
  switchAriaLabel?: string
  onUnitChange: (unit: SendCostUnit) => void
  onOpenChange?: (open: boolean) => void
}): JSX.Element {
  const items = React.useMemo<WorkbenchMenuNode[]>(() => [
    {
      kind: 'radio',
      id: 'send-cost-unit',
      label: menuHeading,
      value: unit,
      onValueChange: (value) => {
        if (value === 'credits' || value === 'cny' || value === 'usd') onUnitChange(value)
      },
      options: options.map((option) => ({
        id: `send-cost-unit-${option.unit}`,
        value: option.unit,
        label: option.label,
        trailing: option.formatted,
      })),
    },
  ], [menuHeading, options, unit, onUnitChange])

  return (
    <WorkbenchMenu
      trigger={(
        <button
          type="button"
          data-send-cost="credits"
          data-send-cost-unit={unit}
          aria-label={switchAriaLabel ?? displayText}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex h-[28px] shrink-0 cursor-pointer items-center gap-1 rounded-pill border-0 bg-transparent px-1.5 whitespace-nowrap text-body-sm font-semibold tabular-nums text-nomi-ink-80 transition-colors hover:bg-nomi-ink-10 hover:text-nomi-ink data-[state=open]:bg-nomi-ink-20 data-[state=open]:text-nomi-ink"
        >
          {unit === 'credits' ? (
            <IconCoin size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden />
          ) : null}
          {displayText}
        </button>
      )}
      onOpenChange={onOpenChange}
      side="top"
      align="end"
      ariaLabel={menuAriaLabel}
      items={items}
    />
  )
}

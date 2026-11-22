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
 * 发送键左侧的约价单位切换按钮 + 下拉菜单（积分 / 人民币 / 美元，都标「约」，底部附内置汇率与日期）。
 * 行为内核全走 `WorkbenchMenu`（Radix Portal / 方向键 / Esc / 边缘避让），点击只切单位、绝不误触发送。
 */
export function SendCostUnitMenuButton({
  displayText,
  unit,
  options,
  rateNote,
  menuAriaLabel,
  switchAriaLabel,
  onUnitChange,
  onOpenChange,
}: {
  displayText: string
  unit: SendCostUnit
  options: readonly SendCostUnitMenuOption[]
  rateNote?: string
  menuAriaLabel?: string
  switchAriaLabel?: string
  onUnitChange: (unit: SendCostUnit) => void
  onOpenChange?: (open: boolean) => void
}): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [anchorRect, setAnchorRect] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)

  const updateOpen = React.useCallback((next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }, [onOpenChange])

  const handleClick = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (open) {
      updateOpen(false)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setAnchorRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    updateOpen(true)
  }, [open, updateOpen])

  const items = React.useMemo<WorkbenchMenuNode[]>(() => {
    const nodes: WorkbenchMenuNode[] = [
      {
        kind: 'radio',
        id: 'send-cost-unit',
        value: unit,
        onValueChange: (value) => {
          if (value === 'credits' || value === 'cny' || value === 'usd') onUnitChange(value)
        },
        options: options.map((option) => ({
          id: `send-cost-unit-${option.unit}`,
          value: option.unit,
          label: option.label,
          shortcut: option.formatted,
        })),
      },
    ]
    if (rateNote) {
      nodes.push({ kind: 'separator', id: 'send-cost-rate-sep' })
      nodes.push({ kind: 'group', id: 'send-cost-rate-note', label: rateNote, items: [] })
    }
    return nodes
  }, [options, rateNote, unit, onUnitChange])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-send-cost="credits"
        data-send-cost-unit={unit}
        aria-label={switchAriaLabel ?? displayText}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleClick}
        className="inline-flex h-[28px] shrink-0 cursor-pointer items-center gap-1 rounded-pill border-0 bg-transparent px-1.5 whitespace-nowrap text-body-sm font-semibold tabular-nums text-nomi-ink-80 transition-colors hover:bg-nomi-ink-10 hover:text-nomi-ink focus:outline-none focus-visible:outline-1 focus-visible:outline-nomi-ink"
      >
        {unit === 'credits' ? (
          <IconCoin size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden />
        ) : null}
        {displayText}
      </button>
      {open && anchorRect ? (
        <WorkbenchMenu
          open={open}
          onOpenChange={updateOpen}
          anchorRect={anchorRect}
          side="top"
          align="end"
          ariaLabel={menuAriaLabel}
          className="min-w-[216px]"
          items={items}
        />
      ) : null}
    </>
  )
}

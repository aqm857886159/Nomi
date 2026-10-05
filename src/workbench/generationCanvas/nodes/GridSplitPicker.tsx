import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLayoutGrid } from '@tabler/icons-react'
import { AnchoredPopover } from '../../../design'
import { cn } from '../../../utils/cn'
import { TOOLBAR_ICON as I, ToolbarMenuTrigger } from './NodeFloatingToolbar'

/**
 * 浮条「宫格 ▾」：等分 4 / 9 / 16 / 25 + 自定义行列点阵（2026-10-04 节点快捷动作批次 1）。
 *
 * 为什么是 `AnchoredPopover` 而不是菜单：点阵是「移上去看行列、点一下定」的富内容，不是一列动作
 * （`AnchoredPopover.tsx` 头注的判据表）。等分那四项是动作，但和点阵同在一块里读——拆成「菜单 + 子菜单」
 * 要多一层悬停，而全仓唯一的子菜单（3D 工具条）正是被点名要拆的那种。
 *
 * 选完交给调用方：它只说「切成几行几列」，切割框、可拖切割线、落成节点并编组都还是
 * `useNodeImageEditing` / `ImageCropGridOverlay` 的事（`CropGridSize` 就是这里的 {rows, cols}）。
 */

export type GridSplitSpec = Readonly<{ rows: number; cols: number }>

/** 点阵边长。5×5 封顶：再细一格就小到看不清细节（未实测，按两家竞品的同一上限取）。 */
export const GRID_PICKER_MAX = 5

const EVEN_PRESETS: readonly GridSplitSpec[] = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
  { rows: 5, cols: 5 },
]

export function GridSplitPicker({
  disabled,
  onSplit,
}: {
  disabled?: boolean
  onSplit: (spec: GridSplitSpec) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const pick = (spec: GridSplitSpec): void => {
    setOpen(false)
    onSplit(spec)
  }
  return (
    <>
      <ToolbarMenuTrigger
        ref={triggerRef}
        icon={<IconLayoutGrid size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.quickActions.grid')}
        open={open}
        disabled={disabled}
        haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        dataAttributes={{ 'data-toolbar-action-menu': 'grid' }}
      />
      {open ? (
        <AnchoredPopover anchorRef={triggerRef} side="top" gap={6} onClose={() => setOpen(false)}>
          <GridSplitPanel onPick={pick} />
        </AnchoredPopover>
      ) : null}
    </>
  )
}

function GridSplitPanel({ onPick }: { onPick: (spec: GridSplitSpec) => void }): JSX.Element {
  const { t } = useTranslation()
  const [hover, setHover] = React.useState<GridSplitSpec | null>(null)
  return (
    <div
      role="dialog"
      aria-label={t('generationCommon.quickActions.gridPicker.aria')}
      data-grid-split-picker
      className="flex gap-3 rounded-nomi border border-nomi-line bg-nomi-paper p-2 shadow-nomi-md"
    >
      <div className="flex flex-col gap-0.5">
        <span className="px-2 py-1 text-micro text-nomi-ink-60">{t('generationCommon.quickActions.gridPicker.even')}</span>
        {EVEN_PRESETS.map((spec) => (
          <button
            key={`${spec.rows}x${spec.cols}`}
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-nomi-sm px-2 text-caption text-nomi-ink-80 transition-colors duration-nomi-fast hover:bg-nomi-ink-05 hover:text-nomi-ink"
            onClick={() => onPick(spec)}
          >
            <span>{t('generationCommon.quickActions.gridPicker.preset', { count: spec.rows * spec.cols })}</span>
            <span className="tabular-nums text-nomi-ink-40">{spec.rows}×{spec.cols}</span>
          </button>
        ))}
      </div>
      <div className="w-px bg-nomi-line" aria-hidden />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 px-0.5 py-1">
          <span className="text-micro text-nomi-ink-60">{t('generationCommon.quickActions.gridPicker.custom')}</span>
          <span data-grid-split-size className="text-micro tabular-nums text-nomi-ink">
            {hover ? t('generationCommon.quickActions.gridPicker.size', { rows: hover.rows, cols: hover.cols }) : ''}
          </span>
        </div>
        <div
          className="grid grid-cols-5 gap-1"
          onMouseLeave={() => setHover(null)}
        >
          {Array.from({ length: GRID_PICKER_MAX * GRID_PICKER_MAX }, (_, index) => {
            const row = Math.floor(index / GRID_PICKER_MAX) + 1
            const col = (index % GRID_PICKER_MAX) + 1
            const lit = hover !== null && row <= hover.rows && col <= hover.cols
            const spec = { rows: row, cols: col }
            return (
              <button
                key={index}
                type="button"
                aria-label={t('generationCommon.quickActions.gridPicker.size', spec)}
                data-grid-cell={`${row}x${col}`}
                className={cn(
                  'size-5 rounded-nomi-sm border transition-colors duration-nomi-fast',
                  lit ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line bg-nomi-ink-05',
                )}
                onMouseEnter={() => setHover(spec)}
                onFocus={() => setHover(spec)}
                onClick={() => onPick(spec)}
              />
            )
          })}
        </div>
        <span className="block max-w-[116px] text-micro text-nomi-ink-40">{t('generationCommon.quickActions.gridPicker.customHint')}</span>
      </div>
    </div>
  )
}

import React from 'react'
import {
  IconBrush,
  IconChevronDown,
  IconEraser,
  IconPointer,
  IconSquare,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { ASPECT_RATIOS, type AspectRatioKey, type ToolKey } from './lib/canvas'

export const TOOL_ITEMS: Array<{ key: ToolKey; label: string; icon: React.ReactNode; disabled?: boolean }> = [
  { key: 'brush', label: '画笔', icon: <IconBrush size={17} stroke={1.7} /> },
  { key: 'select', label: '选择', icon: <IconPointer size={17} stroke={1.7} /> },
  { key: 'eraser', label: '橡皮', icon: <IconEraser size={17} stroke={1.7} /> },
  { key: 'shape', label: '形状', icon: <IconSquare size={17} stroke={1.7} />, disabled: true },
]

type AspectRatioPopoverProps = {
  value: AspectRatioKey
  onChange: (value: AspectRatioKey) => void
}

export function AspectRatioPopover({ value, onChange }: AspectRatioPopoverProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node | null)) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          'inline-flex h-9 min-w-[98px] items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 pl-3 pr-2',
          'text-caption font-medium text-nomi-ink transition-colors hover:border-nomi-ink-20 hover:bg-nomi-paper',
          open && 'border-nomi-accent bg-nomi-paper',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`画板比例 ${value}`}
        title="画板比例"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-nomi-ink-40">比例</span>
        <span className="tabular-nums">{value}</span>
        <IconChevronDown size={14} stroke={1.7} className="ml-auto text-nomi-ink-40" aria-hidden />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-1/2 z-[30] w-[138px] -translate-x-1/2 rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-md',
          )}
          role="listbox"
          aria-label="选择画板比例"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {ASPECT_RATIOS.map((ratio) => {
            const active = ratio.label === value
            return (
              <button
                key={ratio.label}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-caption transition-colors',
                  active ? 'bg-nomi-accent-soft font-semibold text-nomi-accent' : 'text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                )}
                onClick={() => {
                  onChange(ratio.label)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 tabular-nums">{ratio.label}</span>
                <span
                  className={cn('grid h-4 w-6 place-items-center rounded-sm border border-nomi-line bg-nomi-ink-05', active && 'border-nomi-accent')}
                  aria-hidden
                >
                  <span
                    className="block max-h-3 max-w-5 rounded-nomi-sm bg-current opacity-70"
                    style={{
                      aspectRatio: `${ratio.width} / ${ratio.height}`,
                      width: ratio.width >= ratio.height ? 18 : undefined,
                      height: ratio.width < ratio.height ? 12 : undefined,
                    }}
                  />
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

type ToolIconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
}

export function ToolIconButton({ active = false, className, type = 'button', ...props }: ToolIconButtonProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={active || undefined}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-nomi-sm border border-transparent bg-transparent text-nomi-ink-60',
        'transition-colors hover:bg-nomi-paper hover:text-nomi-ink',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active && 'border-nomi-line bg-nomi-paper text-nomi-accent shadow-nomi-sm',
        className,
      )}
    />
  )
}

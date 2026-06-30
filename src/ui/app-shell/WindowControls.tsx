import React from 'react'
import { IconMinus, IconSquare, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

const isWindows = window.nomiDesktop?.platform === 'win32'

export function WindowControls({ className }: { className?: string }): JSX.Element | null {
  const [maximized, setMaximized] = React.useState(false)

  React.useEffect(() => {
    const off = window.nomiDesktop?.window?.onMaximized?.((v) => setMaximized(v))
    return () => off?.()
  }, [])

  if (!isWindows) return null

  const btnBase = cn(
    'app-no-drag inline-flex items-center justify-center w-11 h-full',
    'border-none bg-transparent cursor-pointer text-[var(--nomi-ink-60)]',
    'transition-[background,color] duration-[var(--nomi-transition-fast)]',
    'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
  )

  return (
    <div className={cn('app-no-drag inline-flex items-center h-full shrink-0', className)} aria-label="窗口控制">
      <button
        type="button"
        className={btnBase}
        aria-label="最小化"
        onClick={() => window.nomiDesktop?.window?.minimize?.()}
      >
        <IconMinus size={12} stroke={1.8} />
      </button>
      <button
        type="button"
        className={btnBase}
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => window.nomiDesktop?.window?.maximize?.()}
      >
        <IconSquare size={12} stroke={1.8} />
      </button>
      <button
        type="button"
        className={cn(btnBase, 'hover:!bg-red-500 hover:!text-white')}
        aria-label="关闭"
        onClick={() => window.nomiDesktop?.window?.close?.()}
      >
        <IconX size={12} stroke={1.8} />
      </button>
    </div>
  )
}

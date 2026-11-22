// 外壳角上那颗小点：顶栏设置钮（上手没做完）、窄窗「新版本」图标、顶栏 Nomi 入口（有新消息 / 有一步没成）共用这一个。
// 只画点、不承载文字——意思由宿主按钮的悬停名字 / 无障碍名说（同一个点全外壳一个长相）。
// tone：accent = 有新东西（默认）；danger = 有一步没成（只有 Nomi 入口用，NomiEntryTopbar 板 nomi-entry.dot）。
import React, { type JSX } from 'react'
import { cn } from '../../../utils/cn'

export function DotMark({ className, tone = 'accent', ...data }: {
  className?: string
  tone?: 'accent' | 'danger'
} & { [key: `data-${string}`]: string | undefined }): JSX.Element {
  return (
    <span
      className={cn('pointer-events-none absolute right-[5px] top-[5px] size-1.5 rounded-full ring-2 ring-nomi-chrome', tone === 'danger' ? 'bg-nomi-danger' : 'bg-nomi-accent', className)}
      aria-hidden="true"
      data-dot-mark
      {...data}
    />
  )
}

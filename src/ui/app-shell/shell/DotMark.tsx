// 外壳里「有新东西」那颗强调色小点：顶栏设置钮（上手没做完）、窄窗「新版本」图标、Agent 小球（有未读）共用这一个。
// 只画点、不承载文字——意思由宿主按钮的悬停名字 / 无障碍名说（同一个点全外壳一个长相、一个含义）。
import React, { type JSX } from 'react'
import { cn } from '../../../utils/cn'

export function DotMark({ className }: { className?: string }): JSX.Element {
  return (
    <span
      className={cn('pointer-events-none absolute right-[5px] top-[5px] size-1.5 rounded-full bg-nomi-accent ring-2 ring-nomi-chrome', className)}
      aria-hidden="true"
      data-dot-mark
    />
  )
}

import React from 'react'
import { NomiImage } from '../../../design/media'

/** 参考区第二层预览：短暂悬停后出现，尺寸克制且从 tile 下方展开，不常驻遮挡表格。 */
export default function StoryboardHoverPreview({ url, alt, children }: {
  url: string
  alt: string
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)
  const clearTimer = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const onEnter = (): void => {
    clearTimer()
    timerRef.current = window.setTimeout(() => setOpen(true), 280)
  }
  const onLeave = (): void => {
    clearTimer()
    setOpen(false)
  }
  React.useEffect(() => clearTimer, [])
  return (
    <span className="relative inline-flex" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      {open ? (
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-40 overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 shadow-nomi-md">
          <NomiImage src={url} alt={alt} className="h-32 w-full rounded-nomi-sm object-cover" eager />
        </span>
      ) : null}
    </span>
  )
}


import { reducedMotionQuery } from '../../../design/motion'
import React, { type JSX } from 'react'
import { cn } from '../../../utils/cn'

/** Content, metadata and disclosure share one flow; only explicit primary/danger actions may grow a spacer. */
export function V4Row({ as: Tag = 'div', className, ...props }: React.ButtonHTMLAttributes<HTMLElement> & {
  as?: 'div' | 'summary' | 'span' | 'header' | 'footer' | 'button'
}): JSX.Element {
  return <Tag {...props} className={cn('flex min-w-0 items-center gap-1.5', className)} data-v4-row="true" />
}

/** Moving text highlight shared by live process and thinking rows. */
export function V4Shimmer({ children }: { children: React.ReactNode }): JSX.Element {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const motion = reducedMotionQuery()
    if (!motion) return
    let animation: Animation | undefined
    const update = () => {
      animation?.cancel()
      if (!motion.matches) animation = ref.current?.animate(
        [{ backgroundPosition: '200% 0' }, { backgroundPosition: '-200% 0' }],
        { duration: 2400, iterations: Infinity, easing: 'linear' },
      )
    }
    update()
    motion.addEventListener('change', update)
    return () => { animation?.cancel(); motion.removeEventListener('change', update) }
  }, [])
  return <span ref={ref} style={{ backgroundSize: '200% 100%' }} className="min-w-0 truncate bg-gradient-to-r from-nomi-ink-40 via-nomi-ink to-nomi-ink-40 bg-clip-text text-transparent">{children}</span>
}

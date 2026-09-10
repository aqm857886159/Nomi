import React from 'react'

/** Optional shortcuts may shrink; clipped shortcuts must also leave the focus order. */
export function NodeEffectRecommendations({ children }: { children: React.ReactNode }): JSX.Element {
  const rowRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const row = rowRef.current
    const strip = row?.firstElementChild
    if (!row || !(strip instanceof HTMLElement)) return
    const measure = () => {
      for (const child of Array.from(strip.children)) {
        if (!(child instanceof HTMLElement)) continue
        const fits = row.clientHeight >= child.offsetHeight && child.offsetLeft + child.offsetWidth <= row.clientWidth
        child.style.visibility = fits ? '' : 'hidden'
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(strip)
    for (const child of Array.from(strip.children)) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [children])
  return <div ref={rowRef} className="min-h-0 shrink overflow-hidden" data-node-effect-chips="empty">
    <div className="relative flex h-6 w-max items-start gap-1">{children}</div>
  </div>
}

import React from 'react'

export function useTransientScrollingClass<TElement extends HTMLElement>(className: string): React.RefObject<TElement> {
  const ref = React.useRef<TElement | null>(null)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    let timeoutId: number | null = null
    const handleScroll = () => {
      element.classList.add(className)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => {
        element.classList.remove(className)
        timeoutId = null
      }, 820)
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      element.removeEventListener('scroll', handleScroll)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [className])

  return ref
}

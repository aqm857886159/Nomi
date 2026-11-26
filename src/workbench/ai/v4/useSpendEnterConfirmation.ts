import React from 'react'

const REVIEW_MS = 500

/** Empty Enter targets the primary button only while the displayed offer can be reviewed. */
export function useSpendEnterConfirmation(quote: string | undefined, expanded: boolean) {
  const [button, buttonRef] = React.useState<HTMLButtonElement | null>(null)
  const confirmed = React.useRef(new Set<string>())
  const needsReview = React.useRef(false)
  const reviewUntil = React.useRef(Infinity)

  React.useLayoutEffect(() => {
    reviewUntil.current = Infinity
    if (!quote) return
    if (!expanded) { needsReview.current = true; return }
    if (!button) return

    const doc = button.ownerDocument
    let observer: IntersectionObserver | undefined
    const observe = () => {
      observer?.disconnect()
      observer = undefined
      reviewUntil.current = Infinity
      if (doc.visibilityState !== 'visible') { needsReview.current = true; return }
      const current = new IntersectionObserver(entries => {
        if (observer !== current || doc.visibilityState !== 'visible') return
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 1) {
            reviewUntil.current = Infinity
          } else if (reviewUntil.current === Infinity) {
            reviewUntil.current = performance.now() + (needsReview.current ? REVIEW_MS : 0)
          }
          needsReview.current = true
        }
      }, { threshold: 1 })
      observer = current
      observer.observe(button)
    }
    observe()
    doc.addEventListener('visibilitychange', observe)
    return () => {
      doc.removeEventListener('visibilitychange', observe)
      observer?.disconnect()
      observer = undefined
      reviewUntil.current = Infinity
    }
  }, [button, expanded, quote])

  const confirmDisplayedSpend = () => {
    if (!quote || !expanded || !button || button.disabled || button.ownerDocument.visibilityState !== 'visible'
      || confirmed.current.has(quote) || performance.now() < reviewUntil.current) return
    confirmed.current.add(quote)
    button.click()
  }
  return { buttonRef, confirmDisplayedSpend }
}

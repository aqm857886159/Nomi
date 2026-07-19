import React from 'react'
import {
  dispatchGlobalAssetPopoverOpen,
  subscribeGlobalAssetPopoverOpen,
  type GlobalAssetPopoverAnchorRect,
} from '../overlay/globalAssetPopoverEvents'
import { NomiBrowserAssetPopover } from '../popover/NomiBrowserAssetPopover'
import type { FloatingWindowBoundsRect } from './useResizableFloatingWindow'
import { useGlobalBrowserAssets } from '../assets/useGlobalBrowserAssets'

const GLOBAL_ASSET_POPOVER_BOUNDARY_SELECTORS = [
  '.workbench-shell__body',
  '.nomi-library-page__main',
  'main:not([aria-label="网页内容"])',
  '[role="main"]',
]

function boundsRectFromElement(element: HTMLElement): FloatingWindowBoundsRect | null {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return null
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function resolveGlobalAssetPopoverBoundary(): { element: HTMLElement; bounds: FloatingWindowBoundsRect } | null {
  if (typeof document === 'undefined') return null
  for (const selector of GLOBAL_ASSET_POPOVER_BOUNDARY_SELECTORS) {
    const elements = Array.from(document.querySelectorAll(selector))
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue
      const bounds = boundsRectFromElement(element)
      if (bounds) return { element, bounds }
    }
  }
  return null
}

export function GlobalAssetFloatingWindow(): JSX.Element {
  const [opened, setOpened] = React.useState(false)
  const [anchorRect, setAnchorRect] = React.useState<GlobalAssetPopoverAnchorRect | null>(null)
  const [boundsRect, setBoundsRect] = React.useState<FloatingWindowBoundsRect | null>(null)
  const { assets, refresh } = useGlobalBrowserAssets()

  React.useEffect(
    () => subscribeGlobalAssetPopoverOpen((nextOpened, detail) => {
      setOpened(nextOpened)
      if (nextOpened) refresh()
      if (detail.anchorRect !== undefined) setAnchorRect(detail.anchorRect ?? null)
    }),
    [refresh],
  )

  const handleOpenChange = React.useCallback((nextOpened: boolean): void => {
    setOpened(nextOpened)
    dispatchGlobalAssetPopoverOpen(nextOpened)
  }, [])

  React.useLayoutEffect(() => {
    if (!opened) {
      setBoundsRect(null)
      return undefined
    }

    let observedElement: HTMLElement | null = null
    let observer: ResizeObserver | null = null
    let frame = 0

    function scheduleUpdate(): void {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateBounds)
    }

    function updateBounds(): void {
      const resolved = resolveGlobalAssetPopoverBoundary()
      setBoundsRect(resolved?.bounds ?? null)
      if (observedElement === (resolved?.element ?? null)) return
      observer?.disconnect()
      observedElement = resolved?.element ?? null
      observer = observedElement ? new ResizeObserver(scheduleUpdate) : null
      if (observedElement) observer?.observe(observedElement)
    }

    updateBounds()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [opened])

  return (
    <NomiBrowserAssetPopover
      placement="fixed"
      className="z-[540]"
      opened={opened}
      anchorRect={anchorRect}
      boundsRect={boundsRect}
      dockable
      showTrigger={false}
      libraryProjectId=""
      assets={assets}
      onOpenChange={handleOpenChange}
    />
  )
}

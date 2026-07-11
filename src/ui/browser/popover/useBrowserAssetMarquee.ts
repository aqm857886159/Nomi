import React from 'react'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import type { MarqueePointerState, MarqueeState } from './browserAssetPopoverTypes'
import {
  MARQUEE_AUTO_SCROLL_EDGE_SIZE,
  MARQUEE_AUTO_SCROLL_MAX_SPEED,
} from './browserAssetPopoverConstants'
import { clampNumber, normalizeMarqueeRect, rectsIntersect } from './browserAssetPopoverUtils'

type UseBrowserAssetMarqueeOptions = {
  popoverOpen: boolean
  filteredAssets: readonly NomiBrowserAsset[]
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function useBrowserAssetMarquee({
  popoverOpen,
  filteredAssets,
  setSelectedIds,
}: UseBrowserAssetMarqueeOptions): {
  gridRef: React.RefObject<HTMLDivElement | null>
  marquee: MarqueeState | null
  setAssetNode: (id: string, node: HTMLDivElement | null) => void
  handleGridPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  handleGridPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handleGridPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const [marquee, setMarquee] = React.useState<MarqueeState | null>(null)
  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const marqueeRef = React.useRef<MarqueeState | null>(null)
  const marqueePointerRef = React.useRef<MarqueePointerState | null>(null)
  const marqueeAutoScrollFrameRef = React.useRef<number | null>(null)
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>())

  const setAssetNode = React.useCallback((id: string, node: HTMLDivElement | null): void => {
    if (node) itemRefs.current.set(id, node)
    else itemRefs.current.delete(id)
  }, [])

  const updateSelectionFromMarquee = React.useCallback(
    (selection: MarqueeState): void => {
      const grid = gridRef.current
      if (!grid) return
      const gridRect = grid.getBoundingClientRect()
      const local = normalizeMarqueeRect(selection)
      const selectionRect = new DOMRect(
        gridRect.left + Number(local.left) - grid.scrollLeft,
        gridRect.top + Number(local.top) - grid.scrollTop,
        Number(local.width),
        Number(local.height),
      )
      const next = new Set<string>()
      for (const asset of filteredAssets) {
        const node = itemRefs.current.get(asset.id)
        if (node && rectsIntersect(node.getBoundingClientRect(), selectionRect)) next.add(asset.id)
      }
      setSelectedIds(next)
    },
    [filteredAssets, setSelectedIds],
  )

  const pointFromClientPoint = React.useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current
    if (!grid) return null
    const rect = grid.getBoundingClientRect()
    const maxX = Math.max(rect.width, grid.scrollWidth)
    const maxY = Math.max(rect.height, grid.scrollHeight)
    return {
      x: Math.max(0, Math.min(clientX - rect.left + grid.scrollLeft, maxX)),
      y: Math.max(0, Math.min(clientY - rect.top + grid.scrollTop, maxY)),
    }
  }, [])

  const updateMarqueeFromClientPoint = React.useCallback(
    (clientX: number, clientY: number, baseMarquee = marqueeRef.current): void => {
      if (!baseMarquee) return
      const point = pointFromClientPoint(clientX, clientY)
      if (!point) return
      const next = { ...baseMarquee, currentX: point.x, currentY: point.y }
      marqueeRef.current = next
      setMarquee(next)
      updateSelectionFromMarquee(next)
    },
    [pointFromClientPoint, updateSelectionFromMarquee],
  )

  const stopMarqueeAutoScroll = React.useCallback((): void => {
    if (marqueeAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(marqueeAutoScrollFrameRef.current)
      marqueeAutoScrollFrameRef.current = null
    }
    marqueePointerRef.current = null
  }, [])

  const scheduleMarqueeAutoScroll = React.useCallback((): void => {
    if (marqueeAutoScrollFrameRef.current !== null) return
    const tick = (): void => {
      marqueeAutoScrollFrameRef.current = null
      const grid = gridRef.current
      const pointer = marqueePointerRef.current
      const activeMarquee = marqueeRef.current
      if (!grid || !pointer || !activeMarquee) return
      const rect = grid.getBoundingClientRect()
      const topDistance = pointer.clientY - rect.top
      const bottomDistance = rect.bottom - pointer.clientY
      let deltaY = 0
      if (topDistance < MARQUEE_AUTO_SCROLL_EDGE_SIZE) {
        const intensity = clampNumber((MARQUEE_AUTO_SCROLL_EDGE_SIZE - topDistance) / MARQUEE_AUTO_SCROLL_EDGE_SIZE, 0, 1)
        deltaY = -Math.ceil(intensity * MARQUEE_AUTO_SCROLL_MAX_SPEED)
      } else if (bottomDistance < MARQUEE_AUTO_SCROLL_EDGE_SIZE) {
        const intensity = clampNumber((MARQUEE_AUTO_SCROLL_EDGE_SIZE - bottomDistance) / MARQUEE_AUTO_SCROLL_EDGE_SIZE, 0, 1)
        deltaY = Math.ceil(intensity * MARQUEE_AUTO_SCROLL_MAX_SPEED)
      }
      if (deltaY === 0) return
      const before = grid.scrollTop
      const maxScrollTop = Math.max(0, grid.scrollHeight - grid.clientHeight)
      grid.scrollTop = clampNumber(before + deltaY, 0, maxScrollTop)
      updateMarqueeFromClientPoint(pointer.clientX, pointer.clientY, activeMarquee)
      if (grid.scrollTop !== before) marqueeAutoScrollFrameRef.current = window.requestAnimationFrame(tick)
    }
    marqueeAutoScrollFrameRef.current = window.requestAnimationFrame(tick)
  }, [updateMarqueeFromClientPoint])

  React.useEffect(() => {
    marqueeRef.current = marquee
  }, [marquee])

  React.useEffect(() => () => stopMarqueeAutoScroll(), [stopMarqueeAutoScroll])

  React.useEffect(() => {
    if (popoverOpen) return
    stopMarqueeAutoScroll()
    marqueeRef.current = null
    setMarquee(null)
  }, [popoverOpen, stopMarqueeAutoScroll])

  const handleGridPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('[data-browser-asset-tile="true"],button,input')) return
    const point = pointFromClientPoint(event.clientX, event.clientY)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y }
    marqueeRef.current = next
    marqueePointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    setMarquee(next)
    setSelectedIds(new Set())
  }, [pointFromClientPoint, setSelectedIds])

  const handleGridPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const activeMarquee = marqueeRef.current ?? marquee
    if (!activeMarquee) return
    marqueePointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    updateMarqueeFromClientPoint(event.clientX, event.clientY, activeMarquee)
    scheduleMarqueeAutoScroll()
  }, [marquee, scheduleMarqueeAutoScroll, updateMarqueeFromClientPoint])

  const handleGridPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!marqueeRef.current && !marquee) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    stopMarqueeAutoScroll()
    marqueeRef.current = null
    setMarquee(null)
  }, [marquee, stopMarqueeAutoScroll])

  return {
    gridRef,
    marquee,
    setAssetNode,
    handleGridPointerDown,
    handleGridPointerMove,
    handleGridPointerUp,
  }
}

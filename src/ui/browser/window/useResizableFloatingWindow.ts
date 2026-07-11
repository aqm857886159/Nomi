import React from 'react'

export type FloatingWindowRect = {
  left: number
  top: number
  width: number
  height: number
}

export type FloatingWindowAnchorRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export type FloatingWindowBoundsRect = FloatingWindowAnchorRect

export type FloatingWindowResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const FLOATING_WINDOW_RESIZE_EDGES: readonly FloatingWindowResizeEdge[] = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
]

export type FloatingWindowInteractionEndEvent = {
  type: 'move' | 'resize'
  rect: FloatingWindowRect
}

export type UseResizableFloatingWindowOptions = {
  onInteractionEnd?: (event: FloatingWindowInteractionEndEvent) => void
}

const WINDOW_MARGIN = 10
const SINGLE_IMAGE_TILE_WIDTH = 136
const COMPACT_WINDOW_HORIZONTAL_PADDING = 24
export const FLOATING_WINDOW_MIN_WIDTH = SINGLE_IMAGE_TILE_WIDTH + COMPACT_WINDOW_HORIZONTAL_PADDING
export const FLOATING_WINDOW_MIN_HEIGHT = 300
const DEFAULT_WINDOW_WIDTH = 520
const DEFAULT_WINDOW_HEIGHT = 620
const DEFAULT_BOTTOM_GAP = 72
const ANCHOR_GAP = 8

type WindowGesture =
  | {
      type: 'move'
      startX: number
      startY: number
      rect: FloatingWindowRect
    }
  | {
      type: 'resize'
      edge: FloatingWindowResizeEdge
      startX: number
      startY: number
      rect: FloatingWindowRect
    }

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1024, height: 768 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function capturePointer(event: React.PointerEvent<HTMLElement>): void {
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture can fail if the target is detached during the gesture.
  }
}

function anchorKey(anchorRect: FloatingWindowAnchorRect | null | undefined): string {
  if (!anchorRect) return 'default'
  return `${Math.round(anchorRect.left)}:${Math.round(anchorRect.top)}:${Math.round(anchorRect.right)}:${Math.round(anchorRect.bottom)}`
}

function boundsKey(boundsRect: FloatingWindowBoundsRect | null | undefined): string {
  if (!boundsRect) return 'viewport'
  return `${Math.round(boundsRect.left)}:${Math.round(boundsRect.top)}:${Math.round(boundsRect.right)}:${Math.round(boundsRect.bottom)}`
}

function viewportBounds(): FloatingWindowBoundsRect {
  const viewport = viewportSize()
  return {
    left: 0,
    top: 0,
    right: viewport.width,
    bottom: viewport.height,
    width: viewport.width,
    height: viewport.height,
  }
}

function normalizeBounds(boundsRect?: FloatingWindowBoundsRect | null): FloatingWindowBoundsRect {
  return boundsRect ?? viewportBounds()
}

export function createInitialFloatingWindowRect(
  anchorRect?: FloatingWindowAnchorRect | null,
  boundsRect?: FloatingWindowBoundsRect | null,
): FloatingWindowRect {
  const bounds = normalizeBounds(boundsRect)
  const width = Math.min(DEFAULT_WINDOW_WIDTH, Math.max(FLOATING_WINDOW_MIN_WIDTH, bounds.width - WINDOW_MARGIN * 2))
  const height = Math.min(
    DEFAULT_WINDOW_HEIGHT,
    Math.max(
      FLOATING_WINDOW_MIN_HEIGHT,
      bounds.height - (boundsRect ? WINDOW_MARGIN * 2 : DEFAULT_BOTTOM_GAP + WINDOW_MARGIN),
    ),
  )
  const rect = anchorRect
    ? {
        left: anchorRect.right - width,
        top: anchorRect.bottom + ANCHOR_GAP,
        width,
        height,
      }
    : {
        left: Math.max(bounds.left + WINDOW_MARGIN, bounds.right - width - 18),
        top: boundsRect
          ? Math.max(bounds.top + WINDOW_MARGIN, bounds.top + 18)
          : Math.max(WINDOW_MARGIN, bounds.bottom - height - DEFAULT_BOTTOM_GAP),
        width,
        height,
      }
  return clampFloatingWindowRect(rect, boundsRect)
}

export function clampFloatingWindowRect(
  rect: FloatingWindowRect,
  boundsRect?: FloatingWindowBoundsRect | null,
): FloatingWindowRect {
  const bounds = normalizeBounds(boundsRect)
  const maxWidth = Math.max(FLOATING_WINDOW_MIN_WIDTH, bounds.width - WINDOW_MARGIN * 2)
  const maxHeight = Math.max(FLOATING_WINDOW_MIN_HEIGHT, bounds.height - WINDOW_MARGIN * 2)
  const width = clamp(Math.round(rect.width), FLOATING_WINDOW_MIN_WIDTH, maxWidth)
  const height = clamp(Math.round(rect.height), FLOATING_WINDOW_MIN_HEIGHT, maxHeight)
  return {
    left: clamp(Math.round(rect.left), bounds.left + WINDOW_MARGIN, bounds.right - WINDOW_MARGIN - width),
    top: clamp(Math.round(rect.top), bounds.top + WINDOW_MARGIN, bounds.bottom - WINDOW_MARGIN - height),
    width,
    height,
  }
}

export function resizeFloatingWindowRect(
  rect: FloatingWindowRect,
  edge: FloatingWindowResizeEdge,
  dx: number,
  dy: number,
  boundsRect?: FloatingWindowBoundsRect | null,
): FloatingWindowRect {
  const bounds = normalizeBounds(boundsRect)
  const minLeft = bounds.left + WINDOW_MARGIN
  const minTop = bounds.top + WINDOW_MARGIN
  const maxRight = Math.max(minLeft + FLOATING_WINDOW_MIN_WIDTH, bounds.right - WINDOW_MARGIN)
  const maxBottom = Math.max(minTop + FLOATING_WINDOW_MIN_HEIGHT, bounds.bottom - WINDOW_MARGIN)
  let left = rect.left
  let top = rect.top
  let right = rect.left + rect.width
  let bottom = rect.top + rect.height

  if (edge.includes('e')) {
    right = clamp(rect.left + rect.width + dx, left + FLOATING_WINDOW_MIN_WIDTH, maxRight)
  }
  if (edge.includes('s')) {
    bottom = clamp(rect.top + rect.height + dy, top + FLOATING_WINDOW_MIN_HEIGHT, maxBottom)
  }
  if (edge.includes('w')) {
    left = clamp(rect.left + dx, minLeft, right - FLOATING_WINDOW_MIN_WIDTH)
  }
  if (edge.includes('n')) {
    top = clamp(rect.top + dy, minTop, bottom - FLOATING_WINDOW_MIN_HEIGHT)
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

export function useResizableFloatingWindow(
  opened: boolean,
  anchorRect?: FloatingWindowAnchorRect | null,
  boundsRect?: FloatingWindowBoundsRect | null,
  options: UseResizableFloatingWindowOptions = {},
) {
  const [rect, setRectState] = React.useState<FloatingWindowRect>(() =>
    createInitialFloatingWindowRect(anchorRect, boundsRect),
  )
  const [isInteracting, setIsInteracting] = React.useState(false)
  const gestureRef = React.useRef<WindowGesture | null>(null)
  const rectRef = React.useRef(rect)
  const openPlacementKeyRef = React.useRef<string | null>(null)
  const onInteractionEndRef = React.useRef(options.onInteractionEnd)

  React.useEffect(() => {
    onInteractionEndRef.current = options.onInteractionEnd
  }, [options.onInteractionEnd])

  const setRect = React.useCallback((nextRect: React.SetStateAction<FloatingWindowRect>): void => {
    setRectState((current) => {
      const resolved = typeof nextRect === 'function' ? nextRect(current) : nextRect
      rectRef.current = resolved
      return resolved
    })
  }, [])

  const setFloatingWindowRect = React.useCallback(
    (nextRect: React.SetStateAction<FloatingWindowRect>): void => {
      setRect((current) => {
        const resolved = typeof nextRect === 'function' ? nextRect(current) : nextRect
        return clampFloatingWindowRect(resolved, boundsRect)
      })
    },
    [boundsRect, setRect],
  )

  React.useEffect(() => {
    if (!opened) {
      openPlacementKeyRef.current = null
      return
    }
    const nextPlacementKey = `${anchorKey(anchorRect)}|${boundsKey(boundsRect)}`
    if (openPlacementKeyRef.current !== nextPlacementKey) {
      openPlacementKeyRef.current = nextPlacementKey
      setRect(createInitialFloatingWindowRect(anchorRect, boundsRect))
      return
    }
    setRect((current) => clampFloatingWindowRect(current, boundsRect))
  }, [anchorRect, boundsRect, opened, setRect])

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleResize = () => setRect((current) => clampFloatingWindowRect(current, boundsRect))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [boundsRect, setRect])

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!isInteracting) return undefined
    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (!gesture) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      setRect(
        gesture.type === 'move'
          ? {
              ...gesture.rect,
              left: gesture.rect.left + dx,
              top: gesture.rect.top + dy,
            }
          : resizeFloatingWindowRect(gesture.rect, gesture.edge, dx, dy, boundsRect),
      )
    }
    const handlePointerUp = () => {
      const gesture = gestureRef.current
      gestureRef.current = null
      setIsInteracting(false)
      const nextRect = clampFloatingWindowRect(rectRef.current, boundsRect)
      setRect(nextRect)
      if (gesture) {
        onInteractionEndRef.current?.({
          type: gesture.type,
          rect: nextRect,
        })
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [boundsRect, isInteracting, setRect])

  const startMove = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      capturePointer(event)
      gestureRef.current = {
        type: 'move',
        startX: event.clientX,
        startY: event.clientY,
        rect,
      }
      setIsInteracting(true)
    },
    [rect],
  )

  const startResize = React.useCallback(
    (edge: FloatingWindowResizeEdge, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      capturePointer(event)
      gestureRef.current = {
        type: 'resize',
        edge,
        startX: event.clientX,
        startY: event.clientY,
        rect,
      }
      setIsInteracting(true)
    },
    [rect],
  )

  return {
    rect,
    isInteracting,
    setRect: setFloatingWindowRect,
    startMove,
    startResize,
  }
}

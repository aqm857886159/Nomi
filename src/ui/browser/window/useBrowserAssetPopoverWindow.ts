import React from 'react'
import {
  createInitialFloatingWindowRect,
  FLOATING_WINDOW_RESIZE_EDGES,
  type FloatingWindowAnchorRect,
  type FloatingWindowBoundsRect,
  type FloatingWindowInteractionEndEvent,
  type FloatingWindowResizeEdge,
  type FloatingWindowRect,
  useResizableFloatingWindow,
} from './useResizableFloatingWindow'
import {
  DOCK_DEFAULT_WIDTH,
  DOCK_EDGE_THRESHOLD,
  DOCK_GAP,
} from '../popover/browserAssetPopoverConstants'
import { createDockedWindowRect } from '../popover/browserAssetPopoverUtils'
import type { AssetPopoverDockMode } from '../popover/browserAssetPopoverTypes'

type UseBrowserAssetPopoverWindowOptions = {
  surface: 'floating' | 'contained'
  opened: boolean
  anchorRect?: FloatingWindowAnchorRect | null
  boundsRect?: FloatingWindowBoundsRect | null
  dockable?: boolean
  dockPresentation: 'overlay' | 'edge' | 'split'
  rootRef: React.RefObject<HTMLDivElement | null>
  onWindowRectChange?: (rect: FloatingWindowBoundsRect | null) => void
  onDockModeChange?: (dockMode: AssetPopoverDockMode) => void
}

export function useBrowserAssetPopoverWindow({
  surface,
  opened,
  anchorRect,
  boundsRect,
  dockable,
  dockPresentation,
  rootRef,
  onWindowRectChange,
  onDockModeChange,
}: UseBrowserAssetPopoverWindowOptions): {
  contained: boolean
  canDock: boolean
  dockMode: AssetPopoverDockMode
  hostOrigin: FloatingWindowBoundsRect | null
  splitDocked: boolean
  edgeDocked: boolean
  activeBounds: FloatingWindowBoundsRect | null
  windowRect: FloatingWindowRect
  isWindowInteracting: boolean
  activeResizeEdges: readonly FloatingWindowResizeEdge[]
  startMove: (event: React.PointerEvent<HTMLElement>) => void
  startResize: (edge: FloatingWindowResizeEdge, event: React.PointerEvent<HTMLElement>) => void
  toggleDockMode: () => void
} {
  const contained = surface === 'contained'
  const canDock = dockable ?? contained
  const [dockMode, setDockMode] = React.useState<AssetPopoverDockMode>(null)
  const [hostBounds, setHostBounds] = React.useState<FloatingWindowBoundsRect | null>(null)
  const previousFloatingRectRef = React.useRef<FloatingWindowRect | null>(null)
  const windowInteractionEndRef = React.useRef<((event: FloatingWindowInteractionEndEvent) => void) | null>(null)
  const activeBounds = boundsRect ?? (contained ? hostBounds : null)
  const hostOrigin = contained ? (hostBounds ?? activeBounds) : null
  const splitDocked = contained && dockPresentation === 'split' && Boolean(dockMode)
  const edgeDocked = contained && dockPresentation === 'edge' && Boolean(dockMode)
  const dockGap = edgeDocked ? 0 : DOCK_GAP
  const handleHookInteractionEnd = React.useCallback((event: FloatingWindowInteractionEndEvent): void => {
    windowInteractionEndRef.current?.(event)
  }, [])
  const {
    rect: windowRect,
    isInteracting: isWindowInteracting,
    setRect: setWindowRect,
    startMove,
    startResize,
  } = useResizableFloatingWindow(opened, anchorRect, activeBounds, { onInteractionEnd: handleHookInteractionEnd })
  const resolvedWindowRect = React.useMemo<FloatingWindowRect>(
    () =>
      splitDocked && activeBounds
        ? {
            left: activeBounds.left,
            top: activeBounds.top,
            width: activeBounds.width,
            height: activeBounds.height,
          }
        : windowRect,
    [activeBounds, splitDocked, windowRect],
  )

  const dockAssetWindow = React.useCallback(
    (nextDockMode: Exclude<AssetPopoverDockMode, null>, sourceRect?: FloatingWindowRect): void => {
      if (!canDock || !activeBounds) return
      const floatingRect = sourceRect ?? previousFloatingRectRef.current ?? windowRect
      previousFloatingRectRef.current = floatingRect
      const dockedRect = createDockedWindowRect(
        activeBounds,
        nextDockMode,
        Math.min(floatingRect.width, DOCK_DEFAULT_WIDTH),
        dockGap,
      )
      setDockMode(nextDockMode)
      setWindowRect(dockedRect)
    },
    [activeBounds, canDock, dockGap, setWindowRect, windowRect],
  )

  const restoreFloatingWindow = React.useCallback((): void => {
    const nextRect = previousFloatingRectRef.current ?? createInitialFloatingWindowRect(anchorRect, activeBounds)
    previousFloatingRectRef.current = null
    setDockMode(null)
    setWindowRect(nextRect)
  }, [activeBounds, anchorRect, setWindowRect])

  const handleWindowInteractionEnd = React.useCallback(
    (event: FloatingWindowInteractionEndEvent): void => {
      if (!canDock || dockMode || !activeBounds || event.type !== 'move') return
      const leftGap = event.rect.left - activeBounds.left
      const rightGap = activeBounds.right - (event.rect.left + event.rect.width)
      if (leftGap <= DOCK_EDGE_THRESHOLD) {
        dockAssetWindow('left', event.rect)
        return
      }
      if (rightGap <= DOCK_EDGE_THRESHOLD) dockAssetWindow('right', event.rect)
    },
    [activeBounds, canDock, dockAssetWindow, dockMode],
  )

  React.useEffect(() => {
    windowInteractionEndRef.current = handleWindowInteractionEnd
  }, [handleWindowInteractionEnd])

  React.useEffect(() => {
    if (!onWindowRectChange) return
    if (!opened) {
      onWindowRectChange(null)
      return
    }
    onWindowRectChange({
      left: resolvedWindowRect.left,
      top: resolvedWindowRect.top,
      right: resolvedWindowRect.left + resolvedWindowRect.width,
      bottom: resolvedWindowRect.top + resolvedWindowRect.height,
      width: resolvedWindowRect.width,
      height: resolvedWindowRect.height,
    })
  }, [onWindowRectChange, opened, resolvedWindowRect])

  React.useEffect(() => {
    onDockModeChange?.(opened ? dockMode : null)
  }, [dockMode, onDockModeChange, opened])

  React.useEffect(() => {
    if (opened) return
    setDockMode(null)
    previousFloatingRectRef.current = null
  }, [opened])

  React.useEffect(() => {
    if (!opened || !dockMode || !activeBounds) return
    if (splitDocked) {
      setWindowRect({ left: activeBounds.left, top: activeBounds.top, width: activeBounds.width, height: activeBounds.height })
      return
    }
    setWindowRect((current) => createDockedWindowRect(activeBounds, dockMode, current.width, dockGap))
  }, [activeBounds, dockGap, dockMode, opened, setWindowRect, splitDocked])

  React.useLayoutEffect(() => {
    if (!contained) {
      setHostBounds(null)
      return undefined
    }
    const node = rootRef.current
    if (!node) return undefined
    const updateHostBounds = (): void => {
      const rect = node.getBoundingClientRect()
      setHostBounds({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height })
    }
    updateHostBounds()
    const observer = new ResizeObserver(updateHostBounds)
    observer.observe(node)
    window.addEventListener('resize', updateHostBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHostBounds)
    }
  }, [contained, rootRef])

  const toggleDockMode = React.useCallback((): void => {
    if (!canDock) return
    if (dockMode) {
      restoreFloatingWindow()
      return
    }
    dockAssetWindow('right', windowRect)
  }, [canDock, dockAssetWindow, dockMode, restoreFloatingWindow, windowRect])

  const activeResizeEdges = React.useMemo<readonly FloatingWindowResizeEdge[]>(() => {
    if (splitDocked) return []
    if (dockMode === 'left') return ['e']
    if (dockMode === 'right') return ['w']
    return FLOATING_WINDOW_RESIZE_EDGES
  }, [dockMode, splitDocked])

  return {
    contained,
    canDock,
    dockMode,
    hostOrigin,
    splitDocked,
    edgeDocked,
    activeBounds,
    windowRect: resolvedWindowRect,
    isWindowInteracting,
    activeResizeEdges,
    startMove,
    startResize,
    toggleDockMode,
  }
}

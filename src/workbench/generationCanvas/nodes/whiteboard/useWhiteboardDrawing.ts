/* eslint-disable react-hooks/exhaustive-deps -- Migrated Leafer canvas keeps imperative renderer state in refs (stable identities), intentionally omitted from dep arrays. */
import { useCallback, useEffect } from 'react'
import { getCanvasPointFromClient } from './lib/pointer'
import { createSmoothStrokePath, normalizePointerPoint, type PointerPoint } from './lib/stroke'
import type { CanvasAsset, CanvasDimensions, LayerItem, ToolKey } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasObjectOffset,
  CanvasStroke,
  LeaferGroup,
  LeaferRenderContext,
  MutableDraftEraserPath,
} from './whiteboardCanvasTypes'
import { setCircleGeometry, shouldAppendPoint } from './whiteboardCanvasNodeOps'
import { getTopmostEditableCanvasObjectAtPoint } from './whiteboardCanvasGeometry'

type RefLike<T> = { current: T }

export type WhiteboardDrawingRefs = {
  activePointerRef: RefLike<number | null>
  pointsRef: RefLike<PointerPoint[]>
  pointerBoundsRef: RefLike<DOMRect | null>
  draftFrameRef: RefLike<number | null>
  pendingDraftPointsRef: RefLike<PointerPoint[]>
  draftPathRef: RefLike<SVGPathElement | null>
  draftEraserPathRef: RefLike<MutableDraftEraserPath | null>
  cursorGroupRef: RefLike<SVGGElement | null>
  eraserHaloRef: RefLike<SVGCircleElement | null>
  eraserOutlineRef: RefLike<SVGCircleElement | null>
  pointerLayerRef: RefLike<HTMLDivElement | null>
  renderContextRef: RefLike<LeaferRenderContext | null>
  layerGroupsRef: RefLike<Map<string, LeaferGroup>>
  strokeLayerIdRef: RefLike<string>
  layersRef: RefLike<LayerItem[]>
  assetsRef: RefLike<CanvasAsset[]>
  strokesRef: RefLike<CanvasStroke[]>
  objectOffsetsRef: RefLike<Map<string, CanvasObjectOffset>>
  assetTransformsRef: RefLike<Map<string, CanvasAssetTransform>>
  onLayerSelectRef: RefLike<((layerId: string) => void) | undefined>
}

export type WhiteboardDrawingProps = {
  activeTool: ToolKey
  brushSize: number
  color: string
  dimensions: CanvasDimensions
  activeLayerId: string
  canDraw: boolean
  onStrokeCommit: (stroke: CanvasStroke) => void
}

export function useWhiteboardDrawing(refs: WhiteboardDrawingRefs, props: WhiteboardDrawingProps) {
  const {
    activePointerRef,
    pointsRef,
    pointerBoundsRef,
    draftFrameRef,
    pendingDraftPointsRef,
    draftPathRef,
    draftEraserPathRef,
    cursorGroupRef,
    eraserHaloRef,
    eraserOutlineRef,
    pointerLayerRef,
    renderContextRef,
    layerGroupsRef,
    strokeLayerIdRef,
    layersRef,
    assetsRef,
    strokesRef,
    objectOffsetsRef,
    assetTransformsRef,
    onLayerSelectRef,
  } = refs
  const { activeTool, brushSize, color, dimensions, activeLayerId, canDraw, onStrokeCommit } = props

  const hideToolCursor = useCallback(() => {
    if (activePointerRef.current !== null) {
      return
    }

    const cursorGroup = cursorGroupRef.current
    if (cursorGroup) {
      cursorGroup.style.display = 'none'
    }
    pointerBoundsRef.current = null
  }, [])

  const clearDraftPreview = useCallback(() => {
    if (draftFrameRef.current !== null) {
      window.cancelAnimationFrame(draftFrameRef.current)
      draftFrameRef.current = null
    }

    pendingDraftPointsRef.current = []

    const draftPath = draftPathRef.current
    if (draftPath) {
      draftPath.removeAttribute('d')
      draftPath.style.display = 'none'
    }

    const draftEraserPath = draftEraserPathRef.current
    if (draftEraserPath) {
      draftEraserPath.path = ''
      draftEraserPath.visible = false
      draftEraserPath.remove?.()
      draftEraserPathRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!canDraw) {
      activePointerRef.current = null
      pointsRef.current = []
      clearDraftPreview()
      hideToolCursor()
    }
  }, [canDraw, clearDraftPreview, hideToolCursor])

  useEffect(() => {
    return () => {
      clearDraftPreview()
    }
  }, [clearDraftPreview])

  const getPointFromPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, preferCachedBounds = false): PointerPoint => {
      const pointerLayer = pointerLayerRef.current
      if (!pointerLayer) {
        return normalizePointerPoint(0, 0, event.pressure)
      }

      const bounds =
        preferCachedBounds && pointerBoundsRef.current
          ? pointerBoundsRef.current
          : pointerLayer.getBoundingClientRect()
      pointerBoundsRef.current = bounds

      return getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        bounds,
        dimensions,
        event.pressure
      )
    },
    [dimensions.height, dimensions.width]
  )

  const paintToolCursor = useCallback(
    (point: PointerPoint) => {
      const cursorGroup = cursorGroupRef.current
      if (!cursorGroup) {
        return
      }

      if (activeTool === 'eraser') {
        const radius = brushSize / 2
        cursorGroup.style.display = 'block'
        setCircleGeometry(eraserHaloRef.current, point, radius)
        setCircleGeometry(eraserOutlineRef.current, point, radius)
        return
      }

      cursorGroup.style.display = 'none'
    },
    [activeTool, brushSize]
  )

  const updateToolCursor = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        hideToolCursor()
        return null
      }

      const point = getPointFromPointer(event, activePointerRef.current === event.pointerId)
      paintToolCursor(point)

      return point
    },
    [canDraw, getPointFromPointer, hideToolCursor, paintToolCursor]
  )

  const ensureDraftEraserPath = useCallback(() => {
    if (draftEraserPathRef.current) {
      return draftEraserPathRef.current
    }

    const context = renderContextRef.current
    const layerGroup = layerGroupsRef.current.get(strokeLayerIdRef.current)
    if (!context || !layerGroup) {
      return null
    }

    const draftEraserPath = new context.Path({
      path: '',
      fill: '#000000',
      eraser: 'path',
      editable: false,
      draggable: false,
      hittable: false,
      hitFill: 'none',
      visible: false
    }) as MutableDraftEraserPath

    layerGroup.add(draftEraserPath)
    draftEraserPathRef.current = draftEraserPath

    return draftEraserPath
  }, [])

  const updateDraftPreview = useCallback(
    (nextPoints: PointerPoint[]) => {
      pendingDraftPointsRef.current = nextPoints

      if (draftFrameRef.current !== null) {
        return
      }

      draftFrameRef.current = window.requestAnimationFrame(() => {
        draftFrameRef.current = null

        const path = createSmoothStrokePath(pendingDraftPointsRef.current, brushSize)

        if (activeTool === 'eraser') {
          const draftEraserPath = ensureDraftEraserPath()
          if (draftEraserPath) {
            draftEraserPath.path = path
            draftEraserPath.visible = Boolean(path)
          }
          return
        }

        const draftPath = draftPathRef.current
        if (!draftPath) {
          return
        }

        if (!path) {
          draftPath.removeAttribute('d')
          draftPath.style.display = 'none'
          return
        }

        draftPath.setAttribute('d', path)
        draftPath.setAttribute('fill', color)
        draftPath.style.display = 'block'
      })
    },
    [activeTool, brushSize, color, ensureDraftEraserPath]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        return
      }

      event.preventDefault()
      pointerBoundsRef.current = event.currentTarget.getBoundingClientRect()
      activePointerRef.current = event.pointerId
      const point = updateToolCursor(event)
      if (!point) {
        activePointerRef.current = null
        return
      }

      const canvasPoint = { x: point[0], y: point[1] }
      const eraserHit =
        activeTool === 'eraser'
          ? getTopmostEditableCanvasObjectAtPoint(
              canvasPoint,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null
      const nextStrokeLayerId = eraserHit?.layerId ?? activeLayerId
      strokeLayerIdRef.current = nextStrokeLayerId
      if (eraserHit && eraserHit.layerId !== activeLayerId) {
        onLayerSelectRef.current?.(eraserHit.layerId)
      }

      event.currentTarget.setPointerCapture?.(event.pointerId)
      pointsRef.current = [point]
      updateDraftPreview(pointsRef.current)
    },
    [activeLayerId, activeTool, canDraw, updateDraftPreview, updateToolCursor]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const point = updateToolCursor(event)
      if (activePointerRef.current !== event.pointerId) {
        return
      }

      if (!point) {
        return
      }

      if (shouldAppendPoint(pointsRef.current, point, brushSize)) {
        pointsRef.current.push(point)
        updateDraftPreview(pointsRef.current)
      }
    },
    [brushSize, updateDraftPreview, updateToolCursor]
  )

  const finishStroke = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) {
        return
      }

      updateToolCursor(event)
      const finalPath = createSmoothStrokePath(pointsRef.current, brushSize)
      const committedStroke: CanvasStroke = {
        id: crypto.randomUUID(),
        layerId: strokeLayerIdRef.current,
        color,
        size: brushSize,
        path: finalPath,
        tool: activeTool === 'eraser' ? 'eraser' : 'brush',
        points: [...pointsRef.current]
      }

      activePointerRef.current = null
      strokeLayerIdRef.current = activeLayerId
      pointsRef.current = []
      clearDraftPreview()

      if (finalPath) {
        onStrokeCommit(committedStroke)
      }
    },
    [activeLayerId, activeTool, brushSize, clearDraftPreview, color, onStrokeCommit, updateToolCursor]
  )

  return { hideToolCursor, clearDraftPreview, updateToolCursor, handlePointerDown, handlePointerMove, finishStroke }
}

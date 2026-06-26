/* eslint-disable react-hooks/exhaustive-deps -- Migrated Leafer canvas keeps imperative renderer state in refs (stable identities), intentionally omitted from dep arrays. */
import { useCallback, useEffect } from 'react'
import { getCanvasPointFromClient } from './lib/pointer'
import type { CanvasAsset, CanvasDimensions, LayerItem, ToolKey } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasPoint,
  CanvasStroke,
  LeaferBox,
  LeaferRenderContext,
} from './whiteboardCanvasTypes'
import {
  getCanvasNodeBounds,
  getFiniteNumber,
  getObjectKey,
  isPointInsideBounds,
} from './whiteboardCanvasNodeOps'
import {
  areCanvasTargetsEqual,
  getCanvasHitRadiusFromStageBounds,
  getCanvasTargetsUnionBounds,
  getLayerIdForCanvasObject,
  getSelectableCanvasObjectsInBounds,
  getTopmostEditableCanvasObjectAtPoint,
  isCanvasContextMenuEvent,
  isPointNearSingleAssetResizeHandle,
  normalizeCanvasBounds,
} from './whiteboardCanvasGeometry'

type RefLike<T> = { current: T }

export type WhiteboardBoxSelectionRefs = {
  stageRef: RefLike<HTMLDivElement | null>
  selectionPointRef: RefLike<CanvasPoint | null>
  multiSelectionOutlineRef: RefLike<SVGRectElement | null>
  multiSelectionDragRef: RefLike<{
    pointerId: number
    lastPoint: CanvasPoint
    totalDelta: CanvasPoint
    targets: CanvasObjectTarget[]
  } | null>
  boxSelectStartRef: RefLike<CanvasPoint | null>
  boxSelectCurrentRef: RefLike<CanvasPoint | null>
  boxSelectPointerRef: RefLike<number | null>
  isBoxSelectingRef: RefLike<boolean>
  selectedObjectTargetsRef: RefLike<CanvasObjectTarget[]>
  multiSelectedObjectTargetsRef: RefLike<CanvasObjectTarget[]>
  activeObjectTargetRef: RefLike<CanvasObjectTarget | null | undefined>
  objectOffsetsRef: RefLike<Map<string, CanvasObjectOffset>>
  assetTransformsRef: RefLike<Map<string, CanvasAssetTransform>>
  canvasObjectNodesRef: RefLike<Map<string, LeaferBox>>
  assetsRef: RefLike<CanvasAsset[]>
  strokesRef: RefLike<CanvasStroke[]>
  layersRef: RefLike<LayerItem[]>
  renderContextRef: RefLike<LeaferRenderContext | null>
  onLayerSelectRef: RefLike<((layerId: string) => void) | undefined>
  onObjectSelectRef: RefLike<((target: CanvasObjectTarget, layerId: string) => void) | undefined>
}

export type WhiteboardBoxSelectionProps = {
  activeTool: ToolKey
  dimensions: CanvasDimensions
  updateSelectedObjectTargets: (targets: CanvasObjectTarget[]) => void
  setSelectionBox: (box: { start: CanvasPoint; current: CanvasPoint } | null) => void
  setContextMenu: (value: null) => void
  setRenderReadyVersion: (updater: (version: number) => number) => void
}

export function useWhiteboardBoxSelection(refs: WhiteboardBoxSelectionRefs, props: WhiteboardBoxSelectionProps) {
  const {
    stageRef,
    selectionPointRef,
    multiSelectionOutlineRef,
    multiSelectionDragRef,
    boxSelectStartRef,
    boxSelectCurrentRef,
    boxSelectPointerRef,
    isBoxSelectingRef,
    selectedObjectTargetsRef,
    multiSelectedObjectTargetsRef,
    activeObjectTargetRef,
    objectOffsetsRef,
    assetTransformsRef,
    canvasObjectNodesRef,
    assetsRef,
    strokesRef,
    layersRef,
    renderContextRef,
    onLayerSelectRef,
    onObjectSelectRef,
  } = refs
  const { activeTool, dimensions, updateSelectedObjectTargets, setSelectionBox, setContextMenu, setRenderReadyVersion } =
    props

  const rememberSelectionPoint = useCallback(
    (clientX: number, clientY: number, pressure?: number) => {
      if (activeTool !== 'select') {
        return
      }

      const stage = stageRef.current
      if (!stage) {
        selectionPointRef.current = null
        return
      }

      const point = getCanvasPointFromClient(
        clientX,
        clientY,
        stage.getBoundingClientRect(),
        dimensions,
        pressure
      )
      selectionPointRef.current = { x: point[0], y: point[1] }
    },
    [activeTool, dimensions]
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const handlePointerEvent = (event: PointerEvent) => {
      rememberSelectionPoint(event.clientX, event.clientY, event.pressure)
    }

    stage.addEventListener('pointerdown', handlePointerEvent, true)
    stage.addEventListener('pointermove', handlePointerEvent, true)

    return () => {
      stage.removeEventListener('pointerdown', handlePointerEvent, true)
      stage.removeEventListener('pointermove', handlePointerEvent, true)
    }
  }, [rememberSelectionPoint])

  const handleStagePointerCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      rememberSelectionPoint(event.clientX, event.clientY, event.pressure)
    },
    [rememberSelectionPoint]
  )

  const setMultiSelectionOutlineOffset = useCallback((offset: CanvasPoint | null) => {
    const outline = multiSelectionOutlineRef.current
    if (!outline) {
      return
    }

    if (!offset || (offset.x === 0 && offset.y === 0)) {
      outline.removeAttribute('transform')
      return
    }

    outline.setAttribute('transform', `translate(${offset.x} ${offset.y})`)
  }, [])

  const moveCanvasTargetsByDelta = useCallback((targets: CanvasObjectTarget[], delta: CanvasPoint) => {
    if (delta.x === 0 && delta.y === 0) {
      return
    }

    const movedKeys = new Set<string>()

    for (const target of targets) {
      const key = getObjectKey(target.kind, target.id)
      if (movedKeys.has(key)) {
        continue
      }
      movedKeys.add(key)

      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + delta.x,
        y: offset.y + delta.y
      })

      if (target.kind === 'asset') {
        const asset = assetsRef.current.find((item) => item.id === target.id)
        const currentTransform = assetTransformsRef.current.get(target.id)

        if (asset && currentTransform) {
          assetTransformsRef.current.set(target.id, {
            ...currentTransform,
            x: currentTransform.x + delta.x,
            y: currentTransform.y + delta.y
          })
        }
      }

      const node = canvasObjectNodesRef.current.get(key)
      if (node) {
        const mutableNode = node as LeaferBox & { x?: number; y?: number }
        const nodeBounds = getCanvasNodeBounds(node)
        mutableNode.x = getFiniteNumber(mutableNode.x ?? Number.NaN, nodeBounds.x ?? 0) + delta.x
        mutableNode.y = getFiniteNumber(mutableNode.y ?? Number.NaN, nodeBounds.y ?? 0) + delta.y
      }
    }
  }, [])

  const finishMultiSelectionDrag = useCallback(
    (pointerId: number) => {
      const dragState = multiSelectionDragRef.current
      if (!dragState || dragState.pointerId !== pointerId) {
        return false
      }

      const stage = stageRef.current
      if (stage?.hasPointerCapture?.(pointerId)) {
        stage.releasePointerCapture?.(pointerId)
      }

      multiSelectionDragRef.current = null
      setMultiSelectionOutlineOffset(null)

      if (dragState.totalDelta.x !== 0 || dragState.totalDelta.y !== 0) {
        setRenderReadyVersion((version) => version + 1)
      }

      return true
    },
    [setMultiSelectionOutlineOffset]
  )

  const clearBoxSelectionInteraction = useCallback(() => {
    const pointerId = boxSelectPointerRef.current
    const stage = stageRef.current
    if (pointerId !== null && stage?.hasPointerCapture?.(pointerId)) {
      stage.releasePointerCapture?.(pointerId)
    }

    boxSelectPointerRef.current = null
    boxSelectStartRef.current = null
    boxSelectCurrentRef.current = null
    isBoxSelectingRef.current = false
    setSelectionBox(null)
  }, [])

  const getCanvasPointFromStagePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): CanvasPoint | null => {
      const stage = stageRef.current
      if (!stage) {
        return null
      }

      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        dimensions,
        event.pressure
      )

      return { x: point[0], y: point[1] }
    },
    [dimensions]
  )

  const finishBoxSelection = useCallback(
    (pointerId: number, clientX: number, clientY: number, pressure?: number) => {
      if (boxSelectPointerRef.current !== pointerId) {
        return false
      }

      const wasBoxSelecting = isBoxSelectingRef.current
      const startPoint = boxSelectStartRef.current
      const stage = stageRef.current
      const pointerPoint =
        stage && startPoint
          ? getCanvasPointFromClient(clientX, clientY, stage.getBoundingClientRect(), dimensions, pressure)
          : null
      const currentPoint = pointerPoint
        ? { x: pointerPoint[0], y: pointerPoint[1] }
        : boxSelectCurrentRef.current
      if (stage?.hasPointerCapture?.(pointerId)) {
        stage.releasePointerCapture?.(pointerId)
      }
      boxSelectPointerRef.current = null
      boxSelectStartRef.current = null
      boxSelectCurrentRef.current = null
      isBoxSelectingRef.current = false
      setSelectionBox(null)

      if (!wasBoxSelecting || !startPoint || !currentPoint) {
        return false
      }

      const selectedTargets = getSelectableCanvasObjectsInBounds(
        normalizeCanvasBounds(startPoint, currentPoint),
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      if (selectedTargets.length < 2) {
        multiSelectedObjectTargetsRef.current = []
      }
      updateSelectedObjectTargets(selectedTargets)
      renderContextRef.current?.app.editor.cancel?.()

      if (selectedTargets.length === 1) {
        const layerId = getLayerIdForCanvasObject(selectedTargets[0], assetsRef.current, strokesRef.current)
        if (layerId) {
          activeObjectTargetRef.current = selectedTargets[0]
          onLayerSelectRef.current?.(layerId)
          onObjectSelectRef.current?.(selectedTargets[0], layerId)
        }
      }

      return true
    },
    [dimensions, updateSelectedObjectTargets]
  )

  const updateBoxSelectionDrag = useCallback(
    (pointerId: number, currentPoint: CanvasPoint) => {
      const startPoint = boxSelectStartRef.current
      if (boxSelectPointerRef.current !== pointerId || !startPoint) {
        return false
      }

      boxSelectCurrentRef.current = currentPoint

      if (!isBoxSelectingRef.current) {
        isBoxSelectingRef.current = true
        stageRef.current?.setPointerCapture?.(pointerId)
        renderContextRef.current?.app.editor.cancel?.()
        setContextMenu(null)
        updateSelectedObjectTargets([])
      }

      setSelectionBox({
        start: startPoint,
        current: currentPoint
      })

      return true
    },
    [updateSelectedObjectTargets]
  )

  const handleStagePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      if (activeTool !== 'select') {
        return
      }

      if (event.button > 0) {
        event.stopPropagation()
        return
      }

      const startPoint = getCanvasPointFromStagePointer(event)
      if (!startPoint) {
        return
      }

      const selectedTargets = selectedObjectTargetsRef.current
      const stageBounds = event.currentTarget.getBoundingClientRect()
      if (
        isPointNearSingleAssetResizeHandle(
          startPoint,
          selectedTargets,
          layersRef.current,
          assetsRef.current,
          strokesRef.current,
          objectOffsetsRef.current,
          assetTransformsRef.current,
          getCanvasHitRadiusFromStageBounds(dimensions, stageBounds)
        )
      ) {
        clearBoxSelectionInteraction()
        return
      }

      const selectedGroupBounds =
        selectedTargets.length > 1
          ? getCanvasTargetsUnionBounds(
              selectedTargets,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null
      const hit = getTopmostEditableCanvasObjectAtPoint(
        startPoint,
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      const hitIsSelected = hit
        ? selectedTargets.some((target) => areCanvasTargetsEqual(target, hit.target))
        : false

      if (
        selectedTargets.length > 1 &&
        selectedGroupBounds &&
        isPointInsideBounds(startPoint, selectedGroupBounds) &&
        (!hit || hitIsSelected)
      ) {
        clearBoxSelectionInteraction()
        multiSelectionDragRef.current = {
          pointerId: event.pointerId,
          lastPoint: startPoint,
          totalDelta: { x: 0, y: 0 },
          targets: selectedTargets
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        renderContextRef.current?.app.editor.cancel?.()
        setContextMenu(null)
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (hit) {
        clearBoxSelectionInteraction()
        return
      }

      boxSelectStartRef.current = startPoint
      boxSelectCurrentRef.current = startPoint
      boxSelectPointerRef.current = event.pointerId
      isBoxSelectingRef.current = false
    },
    [
      activeTool,
      clearBoxSelectionInteraction,
      dimensions,
      getCanvasPointFromStagePointer,
      handleStagePointerCapture,
      updateSelectedObjectTargets
    ]
  )

  const handleStagePointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      const multiDragState = multiSelectionDragRef.current
      if (multiDragState && multiDragState.pointerId === event.pointerId) {
        if (event.buttons === 0) {
          finishMultiSelectionDrag(event.pointerId)
          return
        }

        const currentPoint = getCanvasPointFromStagePointer(event)
        if (!currentPoint) {
          return
        }

        const delta = {
          x: currentPoint.x - multiDragState.lastPoint.x,
          y: currentPoint.y - multiDragState.lastPoint.y
        }

        if (delta.x !== 0 || delta.y !== 0) {
          moveCanvasTargetsByDelta(multiDragState.targets, delta)
          multiDragState.lastPoint = currentPoint
          multiDragState.totalDelta = {
            x: multiDragState.totalDelta.x + delta.x,
            y: multiDragState.totalDelta.y + delta.y
          }
          setMultiSelectionOutlineOffset(multiDragState.totalDelta)
        }

        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (boxSelectPointerRef.current !== event.pointerId || !boxSelectStartRef.current) {
        return
      }

      if (event.buttons === 0) {
        clearBoxSelectionInteraction()
        return
      }

      const currentPoint = getCanvasPointFromStagePointer(event)
      if (!currentPoint) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      updateBoxSelectionDrag(event.pointerId, currentPoint)
    },
    [
      clearBoxSelectionInteraction,
      finishMultiSelectionDrag,
      getCanvasPointFromStagePointer,
      handleStagePointerCapture,
      moveCanvasTargetsByDelta,
      setMultiSelectionOutlineOffset,
      updateBoxSelectionDrag
    ]
  )

  const handleStagePointerUpCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCanvasContextMenuEvent(event.nativeEvent)) {
        return
      }

      handleStagePointerCapture(event)

      if (finishMultiSelectionDrag(event.pointerId)) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (finishBoxSelection(event.pointerId, event.clientX, event.clientY, event.pressure)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [finishBoxSelection, finishMultiSelectionDrag, handleStagePointerCapture]
  )

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (boxSelectPointerRef.current !== event.pointerId || !boxSelectStartRef.current) {
        return
      }

      if (event.buttons === 0) {
        clearBoxSelectionInteraction()
        return
      }

      const stage = stageRef.current
      if (!stage) {
        return
      }

      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stage.getBoundingClientRect(),
        dimensions,
        event.pressure
      )
      const currentPoint = { x: point[0], y: point[1] }
      updateBoxSelectionDrag(event.pointerId, currentPoint)
    }
    const handleWindowPointerDone = (event: PointerEvent) => {
      if (finishMultiSelectionDrag(event.pointerId)) {
        return
      }

      finishBoxSelection(event.pointerId, event.clientX, event.clientY, event.pressure)
    }
    const handleWindowBlur = () => {
      const dragState = multiSelectionDragRef.current
      if (dragState) {
        finishMultiSelectionDrag(dragState.pointerId)
      }

      clearBoxSelectionInteraction()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerDone)
    window.addEventListener('pointercancel', handleWindowPointerDone)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerDone)
      window.removeEventListener('pointercancel', handleWindowPointerDone)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [
    clearBoxSelectionInteraction,
    dimensions,
    finishBoxSelection,
    finishMultiSelectionDrag,
    updateBoxSelectionDrag
  ])

  return { handleStagePointerDownCapture, handleStagePointerMoveCapture, handleStagePointerUpCapture }
}

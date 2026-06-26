/* eslint-disable react-hooks/exhaustive-deps -- Migrated Leafer canvas keeps imperative renderer state in refs (stable identities), intentionally omitted from dep arrays. */
import { useEffect } from 'react'
import type { CanvasAsset, LayerItem } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasNodeInteractionState,
  CanvasObjectKind,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasPoint,
  CanvasStroke,
  LeaferBox,
  LeaferRenderContext,
  SnapGuide,
} from './whiteboardCanvasTypes'
import {
  getCanvasNodeBounds,
  getCanvasNodeInteractionState,
  getCanvasObjectTarget,
  getObjectKey,
  setCanvasNodeInteractionState,
} from './whiteboardCanvasNodeOps'
import {
  areCanvasTargetsEqual,
  getActiveMultiSelectionTargets,
  getAssetRenderBounds,
  getLayerIdForCanvasObject,
  normalizeAssetBounds,
  shouldBlockEditorTargetInteraction,
} from './whiteboardCanvasGeometry'

type RefLike<T> = { current: T }

export type WhiteboardSceneSyncRefs = {
  renderContextRef: RefLike<LeaferRenderContext | null>
  activeObjectTargetRef: RefLike<CanvasObjectTarget | null | undefined>
  layerObjectTargetsRef: RefLike<Map<string, CanvasObjectTarget>>
  canvasObjectNodesRef: RefLike<Map<string, LeaferBox>>
  isBoxSelectingRef: RefLike<boolean>
  selectedObjectTargetsRef: RefLike<CanvasObjectTarget[]>
  multiSelectedObjectTargetsRef: RefLike<CanvasObjectTarget[]>
  multiSelectionInteractionSnapshotsRef: RefLike<Map<string, CanvasNodeInteractionState>>
  multiSelectionDragRef: RefLike<{
    pointerId: number
    lastPoint: CanvasPoint
    totalDelta: CanvasPoint
    targets: CanvasObjectTarget[]
  } | null>
  objectOffsetsRef: RefLike<Map<string, CanvasObjectOffset>>
  assetsRef: RefLike<CanvasAsset[]>
  assetTransformsRef: RefLike<Map<string, CanvasAssetTransform>>
  strokesRef: RefLike<CanvasStroke[]>
  onLayerSelectRef: RefLike<((layerId: string) => void) | undefined>
  onObjectSelectRef: RefLike<((target: CanvasObjectTarget, layerId: string) => void) | undefined>
}

export type WhiteboardSceneSyncProps = {
  activeTool: string
  activeLayerId: string
  activeObjectTarget: CanvasObjectTarget | null | undefined
  selectedObjectTargets: CanvasObjectTarget[]
  renderReadyVersion: number
  assets: CanvasAsset[]
  layers: LayerItem[]
  strokes: CanvasStroke[]
  updateSelectedObjectTargets: (targets: CanvasObjectTarget[]) => void
  setContextMenu: (value: null) => void
  setSelectionBox: (value: null) => void
  paintSnapGuides: (guides: SnapGuide[]) => void
}

export function useWhiteboardSceneSync(refs: WhiteboardSceneSyncRefs, props: WhiteboardSceneSyncProps): void {
  const {
    renderContextRef,
    activeObjectTargetRef,
    layerObjectTargetsRef,
    canvasObjectNodesRef,
    isBoxSelectingRef,
    selectedObjectTargetsRef,
    multiSelectedObjectTargetsRef,
    multiSelectionInteractionSnapshotsRef,
    multiSelectionDragRef,
    objectOffsetsRef,
    assetsRef,
    assetTransformsRef,
    strokesRef,
    onLayerSelectRef,
    onObjectSelectRef,
  } = refs
  const {
    activeTool,
    activeLayerId,
    activeObjectTarget,
    selectedObjectTargets,
    renderReadyVersion,
    assets,
    layers,
    strokes,
    updateSelectedObjectTargets,
    setContextMenu,
    setSelectionBox,
    paintSnapGuides,
  } = props

  useEffect(() => {
    const editor = renderContextRef.current?.app.editor
    if (!editor) {
      return
    }

    if (activeTool !== 'select') {
      paintSnapGuides([])
      editor.cancel()
      return
    }

    if (isBoxSelectingRef.current || selectedObjectTargetsRef.current.length > 1) {
      paintSnapGuides([])
      editor.cancel?.()
      return
    }

    const objectTarget = activeObjectTargetRef.current ?? layerObjectTargetsRef.current.get(activeLayerId)
    const node = objectTarget ? canvasObjectNodesRef.current.get(getObjectKey(objectTarget.kind, objectTarget.id)) : null

    if (node) {
      editor.select?.(node)
    } else {
      editor.cancel?.()
    }
  }, [activeLayerId, activeObjectTarget, activeTool, assets, layers, renderReadyVersion, selectedObjectTargets, strokes])

  useEffect(() => {
    setContextMenu(null)
    setSelectionBox(null)

    if (activeTool !== 'select') {
      multiSelectedObjectTargetsRef.current = []
      updateSelectedObjectTargets([])
      return
    }

    const multiTargets = getActiveMultiSelectionTargets(
      selectedObjectTargetsRef.current,
      multiSelectedObjectTargetsRef.current
    )
    if (
      activeObjectTarget &&
      multiTargets.length > 1 &&
      multiTargets.some((target) => areCanvasTargetsEqual(target, activeObjectTarget))
    ) {
      updateSelectedObjectTargets(multiTargets)
      return
    }

    if (activeObjectTarget) {
      multiSelectedObjectTargetsRef.current = []
    }
    updateSelectedObjectTargets(activeObjectTarget ? [activeObjectTarget] : [])
  }, [activeObjectTarget, activeTool, updateSelectedObjectTargets])

  useEffect(() => {
    const snapshots = multiSelectionInteractionSnapshotsRef.current
    const disabledKeys =
      activeTool === 'select' && selectedObjectTargets.length > 1
        ? new Set(selectedObjectTargets.map((target) => getObjectKey(target.kind, target.id)))
        : new Set<string>()

    for (const [key, snapshot] of snapshots) {
      if (disabledKeys.has(key)) {
        continue
      }

      const node = canvasObjectNodesRef.current.get(key)
      if (node) {
        setCanvasNodeInteractionState(node, snapshot)
      }
      snapshots.delete(key)
    }

    for (const key of disabledKeys) {
      const node = canvasObjectNodesRef.current.get(key)
      if (!node) {
        continue
      }

      if (!snapshots.has(key)) {
        snapshots.set(key, getCanvasNodeInteractionState(node))
      }
      setCanvasNodeInteractionState(node, {
        editable: false,
        draggable: false,
        hittable: false,
        hitFill: 'none'
      })
    }
  }, [activeTool, assets, layers, renderReadyVersion, selectedObjectTargets, strokes])

  useEffect(() => {
    const editor = renderContextRef.current?.app.editor
    if (!editor) {
      return
    }

    const handleEditorMove = (event: unknown) => {
      const moveEvent = event as {
        moveX?: number
        moveY?: number
        target?: {
          canvasObjectKind?: CanvasObjectKind
          canvasObjectId?: string
        }
      }
      const kind = moveEvent.target?.canvasObjectKind
      const id = moveEvent.target?.canvasObjectId

      if (!kind || !id) {
        return
      }

      const key = getObjectKey(kind, id)
      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + (moveEvent.moveX ?? 0),
        y: offset.y + (moveEvent.moveY ?? 0)
      })

      if (kind === 'asset') {
        const asset = assetsRef.current.find((item) => item.id === id)
        const currentTransform = assetTransformsRef.current.get(id)

        if (asset && currentTransform) {
          assetTransformsRef.current.set(id, {
            ...currentTransform,
            x: currentTransform.x + (moveEvent.moveX ?? 0),
            y: currentTransform.y + (moveEvent.moveY ?? 0)
          })
        }
      }
    }

    const handleEditorScale = (event: unknown) => {
      const scaleEvent = event as {
        scaleX?: number
        scaleY?: number
        target?: unknown
      }
      const objectTarget = getCanvasObjectTarget(scaleEvent.target)

      if (objectTarget?.kind !== 'asset') {
        return
      }

      const asset = assetsRef.current.find((item) => item.id === objectTarget.id)
      if (!asset) {
        return
      }

      const currentBounds = getAssetRenderBounds(asset, objectOffsetsRef.current, assetTransformsRef.current)
      const targetBounds = getCanvasNodeBounds(scaleEvent.target)
      const nextBounds = normalizeAssetBounds({
        x: targetBounds.x ?? currentBounds.x,
        y: targetBounds.y ?? currentBounds.y,
        width: targetBounds.width ?? currentBounds.width * Math.abs(scaleEvent.scaleX ?? 1),
        height: targetBounds.height ?? currentBounds.height * Math.abs(scaleEvent.scaleY ?? 1)
      })

      assetTransformsRef.current.set(asset.id, nextBounds)
      objectOffsetsRef.current.set(getObjectKey('asset', asset.id), {
        x: nextBounds.x - asset.x,
        y: nextBounds.y - asset.y
      })
    }

    const handleEditorSelect = (event: unknown) => {
      const selectEvent = event as {
        value?: unknown
        target?: unknown
      }
      const selectedTarget = Array.isArray(selectEvent.value) ? selectEvent.value[0] : selectEvent.value
      const objectTarget = getCanvasObjectTarget(selectedTarget ?? selectEvent.target)
      const layerId = objectTarget
        ? getLayerIdForCanvasObject(objectTarget, assetsRef.current, strokesRef.current)
        : null

      if (
        objectTarget &&
        shouldBlockEditorTargetInteraction(
          objectTarget,
          getActiveMultiSelectionTargets(selectedObjectTargetsRef.current, multiSelectedObjectTargetsRef.current),
          isBoxSelectingRef.current,
          Boolean(multiSelectionDragRef.current),
          () => false
        )
      ) {
        return
      }

      if (objectTarget && layerId) {
        multiSelectedObjectTargetsRef.current = []
        activeObjectTargetRef.current = objectTarget
        updateSelectedObjectTargets([objectTarget])
        onLayerSelectRef.current?.(layerId)
        onObjectSelectRef.current?.(objectTarget, layerId)
      }
    }

    editor.on?.('editor.move', handleEditorMove)
    editor.on?.('editor.scale', handleEditorScale)
    editor.on?.('editor.select', handleEditorSelect)

    return () => {
      editor.off?.('editor.move', handleEditorMove)
      editor.off?.('editor.scale', handleEditorScale)
      editor.off?.('editor.select', handleEditorSelect)
    }
  }, [renderReadyVersion])
}

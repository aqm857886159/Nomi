/* eslint-disable react-hooks/exhaustive-deps -- Migrated Leafer canvas keeps imperative renderer state in refs (stable identities), intentionally omitted from dep arrays. */
import { useCallback, useEffect } from 'react'
import { getCanvasPointFromClient } from './lib/pointer'
import type { CanvasAsset, CanvasDimensions, LayerItem, ToolKey } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasObjectFlipState,
  CanvasObjectOffset,
  CanvasObjectTarget,
  LeaferBox,
  LeaferRenderContext,
} from './whiteboardCanvasTypes'
import { getObjectFlipState, getObjectKey, isPointInsideBounds } from './whiteboardCanvasNodeOps'
import {
  areCanvasTargetsEqual,
  getActiveMultiSelectionTargets,
  getCanvasTargetsUnionBounds,
  getKeyboardMoveDelta,
  getLayerIdForCanvasObject,
  getTopmostEditableCanvasObjectAtPoint,
  isCanvasContextMenuEvent,
  isEditableKeyboardTarget,
} from './whiteboardCanvasGeometry'

type RefLike<T> = { current: T }
type ContextMenuState = { x: number; y: number; targets: CanvasObjectTarget[] }

export type WhiteboardSelectionActionsRefs = {
  activeObjectTargetRef: RefLike<CanvasObjectTarget | null | undefined>
  assetsRef: RefLike<CanvasAsset[]>
  strokesRef: RefLike<import('./whiteboardCanvasTypes').CanvasStroke[]>
  layersRef: RefLike<LayerItem[]>
  objectFlipStatesRef: RefLike<Map<string, CanvasObjectFlipState>>
  canvasObjectNodesRef: RefLike<Map<string, LeaferBox>>
  objectOffsetsRef: RefLike<Map<string, CanvasObjectOffset>>
  assetTransformsRef: RefLike<Map<string, CanvasAssetTransform>>
  selectedObjectTargetsRef: RefLike<CanvasObjectTarget[]>
  multiSelectedObjectTargetsRef: RefLike<CanvasObjectTarget[]>
  contextMenuTargetsRef: RefLike<CanvasObjectTarget[]>
  groupMenuActionHandledRef: RefLike<boolean>
  renderContextRef: RefLike<LeaferRenderContext | null>
  stageRef: RefLike<HTMLDivElement | null>
  onObjectDeleteRef: RefLike<((target: CanvasObjectTarget) => void) | undefined>
  onObjectsGroupRef: RefLike<((targets: CanvasObjectTarget[]) => void) | undefined>
  onLayerSelectRef: RefLike<((layerId: string) => void) | undefined>
  onObjectSelectRef: RefLike<((target: CanvasObjectTarget, layerId: string) => void) | undefined>
}

export type WhiteboardSelectionActionsProps = {
  activeTool: ToolKey
  dimensions: CanvasDimensions
  contextMenu: ContextMenuState | null
  updateSelectedObjectTargets: (targets: CanvasObjectTarget[]) => void
  setContextMenu: (value: ContextMenuState | null) => void
  setRenderReadyVersion: (updater: (version: number) => number) => void
}

export function useWhiteboardSelectionActions(
  refs: WhiteboardSelectionActionsRefs,
  props: WhiteboardSelectionActionsProps,
) {
  const {
    activeObjectTargetRef,
    assetsRef,
    strokesRef,
    layersRef,
    objectFlipStatesRef,
    canvasObjectNodesRef,
    objectOffsetsRef,
    assetTransformsRef,
    selectedObjectTargetsRef,
    multiSelectedObjectTargetsRef,
    contextMenuTargetsRef,
    groupMenuActionHandledRef,
    renderContextRef,
    stageRef,
    onObjectDeleteRef,
    onObjectsGroupRef,
    onLayerSelectRef,
    onObjectSelectRef,
  } = refs
  const { activeTool, dimensions, contextMenu, updateSelectedObjectTargets, setContextMenu, setRenderReadyVersion } =
    props

  const getEditableSelectedTarget = useCallback(() => {
    const target = activeObjectTargetRef.current
    if (!target || activeTool !== 'select') {
      return null
    }

    const layerId = getLayerIdForCanvasObject(target, assetsRef.current, strokesRef.current)
    const layer = layerId ? layersRef.current.find((item) => item.id === layerId) : null

    if (!layer || layer.locked || !layer.visible || layer.kind === 'background') {
      return null
    }

    return target
  }, [activeTool])

  const moveSelectedTarget = useCallback(
    (deltaX: number, deltaY: number) => {
      const target = getEditableSelectedTarget()
      if (!target) {
        return false
      }

      const key = getObjectKey(target.kind, target.id)
      const offset = objectOffsetsRef.current.get(key) ?? { x: 0, y: 0 }
      objectOffsetsRef.current.set(key, {
        x: offset.x + deltaX,
        y: offset.y + deltaY
      })

      if (target.kind === 'asset') {
        const currentTransform = assetTransformsRef.current.get(target.id)
        if (currentTransform) {
          assetTransformsRef.current.set(target.id, {
            ...currentTransform,
            x: currentTransform.x + deltaX,
            y: currentTransform.y + deltaY
          })
        }
      }

      setRenderReadyVersion((version) => version + 1)
      return true
    },
    [getEditableSelectedTarget]
  )

  const deleteSelectedTarget = useCallback(() => {
    const target = getEditableSelectedTarget()
    if (!target) {
      return false
    }

    renderContextRef.current?.app.editor.cancel?.()
    activeObjectTargetRef.current = null
    onObjectDeleteRef.current?.(target)
    return true
  }, [getEditableSelectedTarget])

  const flipSelectedTarget = useCallback(
    (axis: 'x' | 'y') => {
      const target = contextMenu?.targets.length === 1 ? contextMenu.targets[0] : getEditableSelectedTarget()
      if (!target) {
        setContextMenu(null)
        return
      }

      const key = getObjectKey(target.kind, target.id)
      const currentFlip = getObjectFlipState(objectFlipStatesRef.current, target)
      objectFlipStatesRef.current.set(key, {
        ...currentFlip,
        [axis]: !currentFlip[axis]
      })

      const node = canvasObjectNodesRef.current.get(key) as
        | (LeaferBox & { flip?: (axis: 'x' | 'y', transition?: boolean | number) => void })
        | undefined
      node?.flip?.(axis)
      setContextMenu(null)
      setRenderReadyVersion((version) => version + 1)
    },
    [contextMenu?.targets, getEditableSelectedTarget]
  )

  const groupSelectedTargets = useCallback(() => {
    if (groupMenuActionHandledRef.current) {
      return
    }

    const menuTargets = contextMenu?.targets.length ? contextMenu.targets : contextMenuTargetsRef.current
    const selectedTargets = selectedObjectTargetsRef.current
    const multiTargets = getActiveMultiSelectionTargets(selectedTargets, multiSelectedObjectTargetsRef.current)
    const targets = menuTargets.length > 1 ? menuTargets : multiTargets
    const groupableTargets = targets.filter(
      (target) => target.kind === 'asset' || target.kind === 'stroke' || target.kind === 'group'
    )

    if (groupableTargets.length < 2) {
      setContextMenu(null)
      return
    }

    groupMenuActionHandledRef.current = true
    onObjectsGroupRef.current?.(groupableTargets)
    multiSelectedObjectTargetsRef.current = []
    contextMenuTargetsRef.current = []
    updateSelectedObjectTargets([])
    setContextMenu(null)
  }, [contextMenu?.targets, updateSelectedObjectTargets])

  const handleGroupMenuPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const handleGroupMenuClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      groupSelectedTargets()
    },
    [groupSelectedTargets]
  )

  const showContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool !== 'select') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const stage = stageRef.current
      if (!stage) {
        return
      }

      const stageBounds = stage.getBoundingClientRect()
      const point = getCanvasPointFromClient(
        event.clientX,
        event.clientY,
        stageBounds,
        dimensions,
        0.5
      )
      const canvasPoint = { x: point[0], y: point[1] }
      const selectedTargets = selectedObjectTargetsRef.current
      const multiTargets = getActiveMultiSelectionTargets(selectedTargets, multiSelectedObjectTargetsRef.current)
      const selectedGroupBounds =
        multiTargets.length > 1
          ? getCanvasTargetsUnionBounds(
              multiTargets,
              layersRef.current,
              assetsRef.current,
              strokesRef.current,
              objectOffsetsRef.current,
              assetTransformsRef.current
            )
          : null

      if (selectedGroupBounds && isPointInsideBounds(canvasPoint, selectedGroupBounds)) {
        event.stopPropagation()
        contextMenuTargetsRef.current = multiTargets
        groupMenuActionHandledRef.current = false
        updateSelectedObjectTargets(multiTargets)
        setContextMenu({
          x: Math.min(stageBounds.width - 132, Math.max(8, event.clientX - stageBounds.left + 8)),
          y: Math.min(stageBounds.height - 88, Math.max(8, event.clientY - stageBounds.top + 8)),
          targets: multiTargets
        })
        return
      }

      const hit = getTopmostEditableCanvasObjectAtPoint(
        canvasPoint,
        layersRef.current,
        assetsRef.current,
        strokesRef.current,
        objectOffsetsRef.current,
        assetTransformsRef.current
      )

      if (!hit) {
        contextMenuTargetsRef.current = []
        groupMenuActionHandledRef.current = false
        setContextMenu(null)
        return
      }

      event.stopPropagation()
      const shouldUseMultiSelection =
        multiTargets.length > 1 && multiTargets.some((target) => areCanvasTargetsEqual(target, hit.target))
      const menuTargets = shouldUseMultiSelection ? multiTargets : [hit.target]

      if (!shouldUseMultiSelection) {
        multiSelectedObjectTargetsRef.current = []
        activeObjectTargetRef.current = hit.target
        updateSelectedObjectTargets([hit.target])
        onLayerSelectRef.current?.(hit.layerId)
        onObjectSelectRef.current?.(hit.target, hit.layerId)
      }

      contextMenuTargetsRef.current = menuTargets
      groupMenuActionHandledRef.current = false
      setContextMenu({
        x: Math.min(stageBounds.width - 132, Math.max(8, event.clientX - stageBounds.left + 8)),
        y: Math.min(stageBounds.height - 88, Math.max(8, event.clientY - stageBounds.top + 8)),
        targets: menuTargets
      })
    },
    [activeTool, dimensions, updateSelectedObjectTargets]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (deleteSelectedTarget()) {
          event.preventDefault()
        }
        return
      }

      const step = event.shiftKey ? 10 : 1
      const moveDelta = getKeyboardMoveDelta(event.key, step)
      if (!moveDelta) {
        return
      }

      if (moveSelectedTarget(moveDelta.x, moveDelta.y)) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [deleteSelectedTarget, moveSelectedTarget])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeContextMenu = (event?: PointerEvent) => {
      if (isCanvasContextMenuEvent(event)) {
        return
      }
      setContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    // 延迟注册，跳过触发右键菜单的同一批 pointerdown 事件
    const timerId = setTimeout(() => {
      window.addEventListener('pointerdown', closeContextMenu)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      clearTimeout(timerId)
      window.removeEventListener('pointerdown', closeContextMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  return {
    flipSelectedTarget,
    groupSelectedTargets,
    handleGroupMenuPointerDown,
    handleGroupMenuPointerUp,
    handleGroupMenuMouseDown,
    handleGroupMenuClick,
    showContextMenu,
  }
}

// 从 Scene3DFullscreen.tsx 抽出的动作钩子（防巨壳 R9：原文件 >800 行）。
// 自包含逻辑——剪贴板/键盘导航、轨迹模式动作包装、全局快捷键监听、添加对象/相机/群众——
// 行为 100% 等价于原内联实现，仅做位置迁移（无并行版 P1）。
import React from 'react'
import { toast } from '../../../../ui/toast'
import {
  type Scene3DCamera,
  type Scene3DGeometry,
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DTransformMode,
  type Scene3DVector3,
} from './scene3dTypes'
import { OBJECT_LIMIT, type CrowdAddOptions } from './scene3dConstants'
import {
  isEditableKeyboardTarget,
  cloneObjectForClipboard,
  cloneCameraForClipboard,
  makePastedObject,
  makePastedCamera,
  crowdCount,
  makeObject,
  makeCrowdObject,
  makeCamera,
} from './scene3dMath'
import { nextAvailableObjectPosition } from './scene3dObjects'
import { useScene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'
import { trajectoryPointTimeRatio } from './trajectory'

export type Scene3DClipboardItem =
  | { type: 'object'; item: Scene3DObject; pasteCount: number }
  | { type: 'camera'; item: Scene3DCamera; pasteCount: number }

type ClipboardActionsOptions = {
  readOnly: boolean
  stateRef: React.MutableRefObject<Scene3DState>
  selectionRef: React.MutableRefObject<Scene3DSelection>
  clipboardRef: React.MutableRefObject<Scene3DClipboardItem | null>
  suspendedKeyboardSelectionRef: React.MutableRefObject<Exclude<Scene3DSelection, null> | null>
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  setSelection: React.Dispatch<React.SetStateAction<Scene3DSelection>>
  setViewLocked: React.Dispatch<React.SetStateAction<boolean>>
  setFocusId: React.Dispatch<React.SetStateAction<string>>
}

export function useScene3DClipboardActions({
  readOnly,
  stateRef,
  selectionRef,
  clipboardRef,
  suspendedKeyboardSelectionRef,
  setState,
  setSelection,
  setViewLocked,
  setFocusId,
}: ClipboardActionsOptions) {
  const startKeyboardNavigation = React.useCallback(() => {
    const currentSelection = selectionRef.current
    setViewLocked(false)
    setFocusId('')
    if (!currentSelection) return
    if (!suspendedKeyboardSelectionRef.current) {
      suspendedKeyboardSelectionRef.current = currentSelection
    }
    setSelection(null)
  }, [selectionRef, suspendedKeyboardSelectionRef, setViewLocked, setFocusId, setSelection])

  const stopKeyboardNavigation = React.useCallback(() => {
    const suspendedSelection = suspendedKeyboardSelectionRef.current
    if (!suspendedSelection) return
    suspendedKeyboardSelectionRef.current = null

    const currentState = stateRef.current
    const stillExists = suspendedSelection.type === 'object'
      ? currentState.objects.some((object) => object.id === suspendedSelection.id)
      : currentState.cameras.some((camera) => camera.id === suspendedSelection.id)
    setSelection(stillExists ? suspendedSelection : null)
  }, [stateRef, suspendedKeyboardSelectionRef, setSelection])

  const copySelection = React.useCallback(() => {
    const currentSelection = selectionRef.current
    if (!currentSelection) return false

    if (currentSelection.type === 'object') {
      const object = stateRef.current.objects.find((candidate) => candidate.id === currentSelection.id)
      if (!object) return false
      clipboardRef.current = {
        type: 'object',
        item: cloneObjectForClipboard(object),
        pasteCount: 0,
      }
      return true
    }

    const camera = stateRef.current.cameras.find((candidate) => candidate.id === currentSelection.id)
    if (!camera) return false
    clipboardRef.current = {
      type: 'camera',
      item: cloneCameraForClipboard(camera),
      pasteCount: 0,
    }
    return true
  }, [selectionRef, stateRef, clipboardRef])

  const pasteClipboard = React.useCallback(() => {
    if (readOnly) return false
    const clipboard = clipboardRef.current
    if (!clipboard) return false
    const pasteCount = clipboard.pasteCount + 1

    if (clipboard.type === 'object') {
      const current = stateRef.current
      if (current.objects.length >= OBJECT_LIMIT) {
        toast('单个 3D 场景最多支持 100 个对象', 'warning')
        return true
      }
      const object = makePastedObject(clipboard.item, pasteCount)
      const nextState = {
        ...current,
        objects: [...current.objects, object],
      }
      clipboardRef.current = { ...clipboard, pasteCount }
      stateRef.current = nextState
      setState(nextState)
      setSelection({ type: 'object', id: object.id })
      setViewLocked(false)
      return true
    }

    const current = stateRef.current
    const camera = makePastedCamera(clipboard.item, pasteCount)
    const nextState = {
      ...current,
      cameras: [...current.cameras, camera],
    }
    clipboardRef.current = { ...clipboard, pasteCount }
    stateRef.current = nextState
    setState(nextState)
    setSelection({ type: 'camera', id: camera.id })
    setViewLocked(false)
    return true
  }, [readOnly, clipboardRef, stateRef, setState, setSelection, setViewLocked])

  return { startKeyboardNavigation, stopKeyboardNavigation, copySelection, pasteClipboard }
}

type TrajectoryEditing = ReturnType<typeof useScene3DTrajectoryEditing>

type TrajectoryModeActionsOptions = {
  trajectory: TrajectoryEditing
  enterTrajectoryMode: (showTimeline?: boolean) => void
  trajectoryMode: boolean
  readOnly: boolean
  stateRef: React.MutableRefObject<Scene3DState>
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  setSelection: React.Dispatch<React.SetStateAction<Scene3DSelection>>
}

export function useScene3DTrajectoryModeActions({
  trajectory,
  enterTrajectoryMode,
  trajectoryMode,
  readOnly,
  stateRef,
  setState,
  setSelection,
}: TrajectoryModeActionsOptions) {
  const selectTrajectoryForMode = React.useCallback((trajectoryId: string) => {
    trajectory.selectTrajectory(trajectoryId)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, trajectory])

  const selectSceneTrajectory = React.useCallback((trajectoryId: string) => {
    if (trajectoryMode) {
      selectTrajectoryForMode(trajectoryId)
      return
    }
    trajectory.selectTrajectory(trajectoryId)
    setSelection(null)
  }, [selectTrajectoryForMode, trajectory, trajectoryMode, setSelection])

  const selectTrajectoryPointForMode = React.useCallback((trajectoryId: string, pointId: string) => {
    trajectory.selectPoint(trajectoryId, pointId)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, trajectory])

  const createTrajectoryAtForMode = React.useCallback((position: Scene3DVector3) => {
    trajectory.createTrajectoryAt(position)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, trajectory])

  const insertTrajectoryPointForMode = React.useCallback((
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => {
    trajectory.insertPoint(trajectoryId, position, targetPointId, placement)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, trajectory])

  const updateTrajectoryCurveControlForMode = React.useCallback((
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => {
    trajectory.updateCurveControl(trajectoryId, segmentStartPointId, position)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, trajectory])

  const assignTrajectoryToGroup = React.useCallback((trajectoryId: string, groupId: string) => {
    if (readOnly) return
    const groupExists = stateRef.current.trajectoryGroups.some((group) => group.id === groupId)
    const trajectoryExists = stateRef.current.trajectories.some((candidate) => candidate.id === trajectoryId)
    if (!groupExists || !trajectoryExists) return
    setState((current) => ({
      ...current,
      trajectoryGroups: current.trajectoryGroups.map((group) => {
        const withoutTrajectory = group.trajectoryIds.filter((id) => id !== trajectoryId)
        return group.id === groupId
          ? { ...group, trajectoryIds: [...withoutTrajectory, trajectoryId] }
          : { ...group, trajectoryIds: withoutTrajectory }
      }),
    }))
    trajectory.selectTrajectory(trajectoryId)
    trajectory.selectGroup(groupId)
    trajectory.setTimelineOpen(true)
    enterTrajectoryMode(false)
  }, [enterTrajectoryMode, readOnly, trajectory, stateRef, setState])

  const bindTargetToTrajectoryForMode = React.useCallback((
    trajectoryId: string,
    targetId: string,
    pointId?: string | null,
  ) => {
    if (readOnly) return
    const current = stateRef.current
    const targetTrajectory = current.trajectories.find((candidate) => candidate.id === trajectoryId)
    if (!targetTrajectory) return
    const objectExists = current.objects.some((object) => object.id === targetId)
    const cameraExists = current.cameras.some((camera) => camera.id === targetId)
    if (!objectExists && !cameraExists) return
    const alreadyBound = current.trajectoryBindings.some((binding) => (
      binding.objects.some((boundObject) => boundObject.objectId === targetId)
    ))
    if (alreadyBound) {
      toast('同一节点只能绑定一条轨迹', 'warning')
      return
    }
    const pointIndex = pointId ? targetTrajectory.points.findIndex((point) => point.id === pointId) : -1
    const offsetRatio = pointIndex >= 0 ? trajectoryPointTimeRatio(targetTrajectory, pointIndex) : 0
    trajectory.bindObject(trajectoryId, targetId, offsetRatio)
    trajectory.selectGroup(null)
    trajectory.selectTrajectory(trajectoryId)
    trajectory.setTimelineOpen(true)
    enterTrajectoryMode(false)
    setSelection(cameraExists ? { type: 'camera', id: targetId } : { type: 'object', id: targetId })
  }, [enterTrajectoryMode, readOnly, trajectory, stateRef, setSelection])

  const requestTrajectoryPlayChange = React.useCallback((playing: boolean) => {
    if (playing && !trajectory.hasPlayableBinding) {
      toast('请先为轨迹绑定对象或相机', 'warning')
      return
    }
    trajectory.setIsPlaying(playing)
    if (playing) trajectory.setTimelineOpen(true)
  }, [trajectory])

  return {
    selectTrajectoryForMode,
    selectSceneTrajectory,
    selectTrajectoryPointForMode,
    createTrajectoryAtForMode,
    insertTrajectoryPointForMode,
    updateTrajectoryCurveControlForMode,
    assignTrajectoryToGroup,
    bindTargetToTrajectoryForMode,
    requestTrajectoryPlayChange,
  }
}

type KeyboardShortcutsOptions = {
  cameraViewEditId: string | null
  selectionRef: React.MutableRefObject<Scene3DSelection>
  setTransformMode: React.Dispatch<React.SetStateAction<Scene3DTransformMode>>
  copySelection: () => boolean
  pasteClipboard: () => boolean
  deleteSceneItem: (target: Exclude<Scene3DSelection, null>) => void
  exitCameraViewEdit: () => void
  handleClose: () => void
}

export function useScene3DKeyboardShortcuts({
  cameraViewEditId,
  selectionRef,
  setTransformMode,
  copySelection,
  pasteClipboard,
  deleteSceneItem,
  exitCameraViewEdit,
  handleClose,
}: KeyboardShortcutsOptions) {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcutKey = event.key.toLowerCase()
      const isModifierShortcut = event.ctrlKey || event.metaKey
      if (
        shortcutKey === 'r' &&
        !event.repeat &&
        !isModifierShortcut &&
        !event.altKey &&
        !isEditableKeyboardTarget(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
        setTransformMode((mode) => (mode === 'rotate' ? 'translate' : 'rotate'))
        return
      }
      if (isModifierShortcut && !event.altKey && !isEditableKeyboardTarget(event.target)) {
        if (shortcutKey === 'c' && copySelection()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (shortcutKey === 'v' && pasteClipboard()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      if (event.key === 'Delete' && !isEditableKeyboardTarget(event.target)) {
        const currentSelection = selectionRef.current
        if (currentSelection) {
          event.preventDefault()
          event.stopPropagation()
          deleteSceneItem(currentSelection)
          return
        }
      }
      if (event.key === 'Escape' && !document.pointerLockElement) {
        if (cameraViewEditId) {
          event.preventDefault()
          event.stopPropagation()
          exitCameraViewEdit()
          return
        }
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [cameraViewEditId, copySelection, deleteSceneItem, exitCameraViewEdit, handleClose, pasteClipboard, selectionRef, setTransformMode])
}

// 「添加对象/相机/群众」三个动作（从 Scene3DFullscreen 抽出，防巨壳 R9）。行为与原内联实现等价：
// 容量门岗 + 选中新建项 + 退出轨迹模式 + 解锁视图。新建假人/群众落到避让后的可用空位。
export function useScene3DAddActions({
  readOnly,
  stateRef,
  setState,
  setSelection,
  setViewLocked,
  exitTrajectoryMode,
}: {
  readOnly: boolean
  stateRef: React.MutableRefObject<Scene3DState>
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  setSelection: React.Dispatch<React.SetStateAction<Scene3DSelection>>
  setViewLocked: React.Dispatch<React.SetStateAction<boolean>>
  exitTrajectoryMode: () => void
}): {
  addObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  addCamera: () => void
  addCrowd: (options: CrowdAddOptions) => void
} {
  const addObject = React.useCallback((kind: Scene3DGeometry | 'mannequin' | 'light') => {
    if (readOnly) return
    if (stateRef.current.objects.length >= OBJECT_LIMIT) {
      toast('单个 3D 场景最多支持 100 个对象', 'warning')
      return
    }
    const roleIndex = kind === 'mannequin'
      ? stateRef.current.objects.reduce((count, object) => {
        if (object.type === 'mannequin') return count + 1
        if (object.type === 'mannequinCrowd') return count + crowdCount(object)
        return count
      }, 0)
      : 0
    const object = makeObject(kind, roleIndex)
    if (object.type === 'mannequin') {
      object.position = nextAvailableObjectPosition(object, stateRef.current.objects)
    }
    setState((current) => ({ ...current, objects: [...current.objects, object] }))
    setSelection({ type: 'object', id: object.id })
    exitTrajectoryMode()
    setViewLocked(false)
  }, [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef])

  const addCamera = React.useCallback(() => {
    if (readOnly) return
    const camera = makeCamera(stateRef.current.cameras.length)
    setState((current) => ({ ...current, cameras: [...current.cameras, camera] }))
    setSelection({ type: 'camera', id: camera.id })
    exitTrajectoryMode()
    setViewLocked(false)
  }, [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef])

  const addCrowd = React.useCallback((options: CrowdAddOptions) => {
    if (readOnly) return
    if (stateRef.current.objects.length >= OBJECT_LIMIT) {
      toast('单个 3D 场景最多支持 100 个对象', 'warning')
      return
    }
    const crowd = makeCrowdObject(options)
    crowd.position = nextAvailableObjectPosition(crowd, stateRef.current.objects)
    setState((current) => ({ ...current, objects: [...current.objects, crowd] }))
    setSelection({ type: 'object', id: crowd.id })
    exitTrajectoryMode()
    setViewLocked(false)
  }, [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef])

  return { addObject, addCamera, addCrowd }
}

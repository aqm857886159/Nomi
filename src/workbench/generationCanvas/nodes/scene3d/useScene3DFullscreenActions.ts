// 从 Scene3DFullscreen.tsx 抽出的动作钩子（防巨壳 R9：原文件 >800 行）。
// 自包含逻辑——剪贴板/键盘导航、轨迹模式动作包装、全局快捷键监听、添加对象/相机/群众——
// 行为 100% 等价于原内联实现，仅做位置迁移（无并行版 P1）。
import React from 'react'
import { toast, useToastStore } from '../../../../ui/toast'
import i18n from '../../../../i18n'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import {
  type CaptureApi,
  type Scene3DCamera,
  type Scene3DCaptureResult,
  type Scene3DGeometry,
  type Scene3DObject,
  type Scene3DPropKind,
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
import { setScene3DPlayheadSeconds, trajectoryPointTimeRatio } from './trajectory'
import { applyCameraMovePreset, type CameraMovePresetSpec } from './cameraMovePreset'
import { cameraWithPlaybackPosition, isCameraMoveReady } from './scene3dPlayback'
import { makePropObject } from './scene3dPropSpecs'
import { buildSceneTemplateObjects, type Scene3DSceneTemplate } from './scene3dSceneTemplates'
/** 「相机截图但没选相机」的一键跳转报错（顶栏截图与出片面板共用单源，P3-15） */
export function toastPickCameraFirst(
  firstCamera: Scene3DCamera | undefined,
  onPickCamera: (cameraId: string) => void,
): void {
  if (firstCamera) {
    useToastStore.getState().push({
      message: i18n.t('scene3d.fullscreen.selectCameraForScreenshot'),
      type: 'warning',
      actionLabel: i18n.t('scene3d.fullscreen.selectNamedCamera', { camera: firstCamera.name }),
      onAction: () => onPickCamera(firstCamera.id),
    })
  } else {
    toast(i18n.t('scene3d.fullscreen.addCameraForScreenshot'), 'warning')
  }
}

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
    const stillExists =
      suspendedSelection.type === 'object'
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
        toast(i18n.t('scene3d.fullscreen.sceneFull', { count: OBJECT_LIMIT }), 'warning')
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
  const selectTrajectoryForMode = React.useCallback(
    (trajectoryId: string) => {
      trajectory.selectTrajectory(trajectoryId)
      enterTrajectoryMode()
    },
    [enterTrajectoryMode, trajectory],
  )

  const selectSceneTrajectory = React.useCallback(
    (trajectoryId: string) => {
      if (trajectoryMode) {
        selectTrajectoryForMode(trajectoryId)
        return
      }
      trajectory.selectTrajectory(trajectoryId)
      setSelection(null)
    },
    [selectTrajectoryForMode, trajectory, trajectoryMode, setSelection],
  )

  const selectTrajectoryPointForMode = React.useCallback(
    (trajectoryId: string, pointId: string) => {
      trajectory.selectPoint(trajectoryId, pointId)
      enterTrajectoryMode()
    },
    [enterTrajectoryMode, trajectory],
  )

  const createTrajectoryAtForMode = React.useCallback(
    (position: Scene3DVector3) => {
      trajectory.createTrajectoryAt(position)
      enterTrajectoryMode()
    },
    [enterTrajectoryMode, trajectory],
  )

  const insertTrajectoryPointForMode = React.useCallback(
    (trajectoryId: string, position: Scene3DVector3, targetPointId?: string | null, placement?: 'before' | 'after') => {
      trajectory.insertPoint(trajectoryId, position, targetPointId, placement)
      enterTrajectoryMode()
    },
    [enterTrajectoryMode, trajectory],
  )

  const updateTrajectoryCurveControlForMode = React.useCallback(
    (trajectoryId: string, segmentStartPointId: string, position: Scene3DVector3 | null) => {
      trajectory.updateCurveControl(trajectoryId, segmentStartPointId, position)
      enterTrajectoryMode()
    },
    [enterTrajectoryMode, trajectory],
  )

  const assignTrajectoryToGroup = React.useCallback(
    (trajectoryId: string, groupId: string) => {
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
    },
    [enterTrajectoryMode, readOnly, trajectory, stateRef, setState],
  )

  const bindTargetToTrajectoryForMode = React.useCallback(
    (trajectoryId: string, targetId: string, pointId?: string | null) => {
      if (readOnly) return
      const current = stateRef.current
      const targetTrajectory = current.trajectories.find((candidate) => candidate.id === trajectoryId)
      if (!targetTrajectory) return
      const objectExists = current.objects.some((object) => object.id === targetId)
      const cameraExists = current.cameras.some((camera) => camera.id === targetId)
      if (!objectExists && !cameraExists) return
      const alreadyBound = current.trajectoryBindings.some((binding) =>
        binding.objects.some((boundObject) => boundObject.objectId === targetId),
      )
      if (alreadyBound) {
        toast(i18n.t('scene3d.fullscreen.singleTrajectory'), 'warning')
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
    },
    [enterTrajectoryMode, readOnly, trajectory, stateRef, setSelection],
  )

  const requestTrajectoryPlayChange = React.useCallback((playing: boolean) => {
    if (playing && !trajectory.hasPlayableBinding) {
      // P3-15：错误提示带一键跳转——点 toast 直接进轨迹面板去绑定
      useToastStore.getState().push({
        message: i18n.t('scene3d.trajectory.bindTargetFirst'),
        type: 'warning',
        actionLabel: i18n.t('scene3d.trajectory.goBindTarget'),
        onAction: () => enterTrajectoryMode(true),
      })
      return
    }
    trajectory.setIsPlaying(playing)
    if (playing) trajectory.setTimelineOpen(true)
  }, [enterTrajectoryMode, trajectory])

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
  }, [
    cameraViewEditId,
    copySelection,
    deleteSceneItem,
    exitCameraViewEdit,
    handleClose,
    pasteClipboard,
    selectionRef,
    setTransformMode,
  ])
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
  addProp: (kind: Scene3DPropKind) => void
  addCamera: () => void
  addCrowd: (options: CrowdAddOptions) => void
  applySceneTemplate: (template: Scene3DSceneTemplate) => void
} {
  // 语义道具：与 addObject 同结构（限流 + 避让摆位 + 选中），kind 走 spec 表。
  const addProp = React.useCallback(
    (kind: Scene3DPropKind) => {
      if (readOnly) return
      if (stateRef.current.objects.length >= OBJECT_LIMIT) {
        toast(i18n.t('scene3d.fullscreen.sceneFull', { count: OBJECT_LIMIT }), 'warning')
        return
      }
      const object = makePropObject(kind)
      object.position = nextAvailableObjectPosition(object, stateRef.current.objects)
      setState((current) => ({ ...current, objects: [...current.objects, object] }))
      setSelection({ type: 'object', id: object.id })
      exitTrajectoryMode()
      setViewLocked(false)
    },
    [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef],
  )

  const addObject = React.useCallback(
    (kind: Scene3DGeometry | 'mannequin' | 'light') => {
      if (readOnly) return
      if (stateRef.current.objects.length >= OBJECT_LIMIT) {
        toast(i18n.t('scene3d.fullscreen.sceneFull', { count: OBJECT_LIMIT }), 'warning')
        return
      }
      const roleIndex =
        kind === 'mannequin'
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
    },
    [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef],
  )

  const addCamera = React.useCallback(() => {
    if (readOnly) return
    const camera = makeCamera(stateRef.current.cameras.length)
    setState((current) => ({ ...current, cameras: [...current.cameras, camera] }))
    setSelection({ type: 'camera', id: camera.id })
    exitTrajectoryMode()
    setViewLocked(false)
  }, [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef])

  const addCrowd = React.useCallback(
    (options: CrowdAddOptions) => {
      if (readOnly) return
      if (stateRef.current.objects.length >= OBJECT_LIMIT) {
        toast(i18n.t('scene3d.fullscreen.sceneFull', { count: OBJECT_LIMIT }), 'warning')
        return
      }
      const crowd = makeCrowdObject(options)
      crowd.position = nextAvailableObjectPosition(crowd, stateRef.current.objects)
      setState((current) => ({ ...current, objects: [...current.objects, crowd] }))
      setSelection({ type: 'object', id: crowd.id })
      exitTrajectoryMode()
      setViewLocked(false)
    },
    [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef],
  )

  // 场景模板：一键搭灰模布景。**追加**进当前场景（绝不清用户已摆的东西），超容量整组拒绝。
  const applySceneTemplate = React.useCallback(
    (template: Scene3DSceneTemplate) => {
      if (readOnly) return
      const additions = buildSceneTemplateObjects(template)
      if (stateRef.current.objects.length + additions.length > OBJECT_LIMIT) {
        toast(i18n.t('scene3d.fullscreen.templateLimit', { count: OBJECT_LIMIT }), 'warning')
        return
      }
      setState((current) => ({ ...current, objects: [...current.objects, ...additions] }))
      setSelection(null)
      exitTrajectoryMode()
      setViewLocked(false)
      toast(
        i18n.t('scene3d.fullscreen.templateApplied', {
          template: i18n.t(`scene3d.toolbar.template.${template}` as 'scene3d.toolbar.template.street'),
          count: additions.length,
        }),
        'success',
      )
    },
    [exitTrajectoryMode, readOnly, setSelection, setState, setViewLocked, stateRef],
  )

  return { addObject, addProp, addCamera, addCrowd, applySceneTemplate }
}

// 运镜首尾帧导出：把播放头钉到该相机全部运镜段的整体起点/终点，各截一张相机图（复用相机
// 截图管线 onScreenshot → 落画布图片节点，可连去镜头的 first_frame 槽）。每次截图前等两帧，
// 让 demand 渲染把视口对象/相机位姿追上播放头——截到的才是该时刻的真画面（含 fov 渐变/抖动）。
export function useScene3DMoveFrameExport({
  stateRef,
  captureApiRef,
  trajectory,
  onScreenshot,
}: {
  stateRef: React.MutableRefObject<Scene3DState>
  captureApiRef: React.MutableRefObject<CaptureApi | null>
  trajectory: ReturnType<typeof useScene3DTrajectoryEditing>
  onScreenshot: (capture: Scene3DCaptureResult) => void
}) {
  return React.useCallback(
    async (cameraId: string) => {
      const camera = stateRef.current.cameras.find((candidate) => candidate.id === cameraId)
      if (!camera) return
      const bindings = stateRef.current.trajectoryBindings.filter((binding) =>
        binding.objects.some((bound) => bound.objectId === cameraId),
      )
      if (bindings.length === 0) {
        toast(i18n.t('scene3d.fullscreen.cameraHasNoMove'), 'warning')
        return
      }
      const start = Math.min(...bindings.map((binding) => binding.startTime))
      const end = Math.max(...bindings.map((binding) => binding.endTime))
      const restore = trajectory.playheadRef.current
      const waitTwoFrames = () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
        })
      const captures: Scene3DCaptureResult[] = []
      for (const [time, label] of [
        [start, i18n.t('scene3d.fullscreen.firstFrame')],
        [end, i18n.t('scene3d.fullscreen.lastFrame')],
      ] as const) {
        trajectory.playheadRef.current = time
        setScene3DPlayheadSeconds(time)
        await waitTwoFrames()
        const playbackCamera = cameraWithPlaybackPosition(
          stateRef.current,
          camera,
          time,
          trajectory.activeTrajectoryIds,
        )
        const capture = captureApiRef.current?.captureCamera(playbackCamera)
        if (capture)
          captures.push({
            ...capture,
            title: i18n.t('scene3d.fullscreen.cameraMoveFrameTitle', { camera: camera.name, frame: label }),
          })
      }
      trajectory.playheadRef.current = restore
      setScene3DPlayheadSeconds(restore)
      if (captures.length < 2) {
        toast(i18n.t('scene3d.fullscreen.frameExportFailed'), 'error')
        return
      }
      captures.forEach(onScreenshot)
      toast(i18n.t('scene3d.fullscreen.frameExported'), 'success')
    },
    [captureApiRef, onScreenshot, stateRef, trajectory],
  )
}

// 运镜预设：按当前机位就地落一段轨迹并追加到时间轴末尾（连点串联）。在 stateRef 上算好再 setState
// （applyCameraMovePreset 内生成随机 id，不能塞进 updater——StrictMode 双调用会得到两套 id）。
export function useScene3DCameraMoveAction({
  readOnly,
  stateRef,
  setState,
  trajectory,
}: {
  readOnly: boolean
  stateRef: React.MutableRefObject<Scene3DState>
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  trajectory: ReturnType<typeof useScene3DTrajectoryEditing>
}) {
  return React.useCallback(
    (cameraId: string, spec: CameraMovePresetSpec) => {
      if (readOnly) return
      const result = applyCameraMovePreset(stateRef.current, cameraId, spec)
      if (!result) return
      setState(result.state)
      trajectory.setTimelineOpen(true)
      const duration = result.endTime - result.startTime
      toast(
        i18n.t('scene3d.fullscreen.presetAppended', {
          move: i18n.t(`generationCommon.cameraMove.move.${spec.move}` as 'generationCommon.cameraMove.move.push_in'),
          duration,
          start: result.startTime,
          end: result.endTime,
        }),
        'success',
      )
    },
    [readOnly, setState, stateRef, trajectory],
  )
}

/** 出片产物卡状态（P3-14）：盯 take 节点 meta.cameraMoveVideo 从「渲染中」推进到「已生成 + 去向」。
 * kind='screenshot'：截图即时完成——产物落在被编辑器盖住的画布上，没有这张卡用户会以为
 * 什么都没发生（2026-07-21 反馈「截了图没东西可拖」）。 */
export type Scene3DExportCard = {
  kind: 'video' | 'screenshot'
  phase: 'rendering' | 'slow' | 'done'
  /** video done 时：mp4 是否已自动喂给下游镜头（cameraMoveVideo.targetNodeId） */
  fedDownstream: boolean
}

// 出片动作（2026-07-20 出片旅程 P0）：出片面板开关、四个导出 handler、
// 运镜就绪接力 toast（P0-5）、产物卡片（P0-4 生成中 → P3-14 完成态+去向）。
export function useScene3DExportActions({
  state,
  stateRef,
  readOnly,
  selectedCamera,
  onRecordTake,
  onPickCamera,
  captureViewport,
  captureSelectedCamera,
  exportCameraMoveFrames,
}: {
  state: Scene3DState
  stateRef: React.MutableRefObject<Scene3DState>
  readOnly: boolean
  selectedCamera: Scene3DCamera | undefined
  onRecordTake?: (recordedState: Scene3DState) => string | void
  /** 报错「先选中相机」时的一键跳转（P3-15） */
  onPickCamera?: (cameraId: string) => void
  captureViewport: () => boolean
  captureSelectedCamera: () => boolean
  exportCameraMoveFrames: (cameraId: string) => Promise<void>
}) {
  const [exportPanelOpen, setExportPanelOpen] = React.useState(false)
  // P3-14：正在出片的 take 节点 id——产物卡盯它的 meta.cameraMoveVideo 等渲染完成
  const [exportingTakeId, setExportingTakeId] = React.useState<string | null>(null)
  // 渲染超过 60s 还没出结果 → 卡片降级为「渲染较慢」提示（捕获宿主自带 watchdog+重试，这里只管告知）
  const [slowHint, setSlowHint] = React.useState(false)
  const exportingTimerRef = React.useRef<number | null>(null)

  // 订阅 take 节点：渲染完成时 CameraMoveCaptureHost 会把结果写进 meta.cameraMoveVideo
  const exportingTakeNode = useGenerationCanvasStore((store) => (
    exportingTakeId ? store.nodes.find((node) => node.id === exportingTakeId) ?? null : null
  ))
  const takeVideo = exportingTakeNode?.meta?.cameraMoveVideo as { url?: string; targetNodeId?: string } | undefined
  // 截图完成卡：即时 done，10s 自动收（产物在编辑器后面的画布上，指条回家路）
  const [screenshotDone, setScreenshotDone] = React.useState(false)
  const screenshotTimerRef = React.useRef<number | null>(null)
  const markScreenshotDone = React.useCallback(() => {
    setScreenshotDone(true)
    if (screenshotTimerRef.current) window.clearTimeout(screenshotTimerRef.current)
    screenshotTimerRef.current = window.setTimeout(() => setScreenshotDone(false), 10_000)
  }, [])
  React.useEffect(() => () => {
    if (screenshotTimerRef.current) window.clearTimeout(screenshotTimerRef.current)
  }, [])

  const exportCard: Scene3DExportCard | null = exportingTakeId
    ? takeVideo?.url
      ? { kind: 'video', phase: 'done', fedDownstream: Boolean(takeVideo.targetNodeId) }
      : { kind: 'video', phase: slowHint ? 'slow' : 'rendering', fedDownstream: false }
    : screenshotDone
      ? { kind: 'screenshot', phase: 'done', fedDownstream: false }
      : null
  const dismissExportCard = React.useCallback(() => {
    setExportingTakeId(null)
    setSlowHint(false)
    setScreenshotDone(false)
    if (exportingTimerRef.current) {
      window.clearTimeout(exportingTimerRef.current)
      exportingTimerRef.current = null
    }
    if (screenshotTimerRef.current) {
      window.clearTimeout(screenshotTimerRef.current)
      screenshotTimerRef.current = null
    }
  }, [])

  // P0-5：运镜就绪接力 toast——轨迹+绑定就绪时提示用户去出片
  // 用独立 ref 存 timer，不随 state 变化清理（否则拖点/调参 500ms 内会吞掉 toast）
  const moveReadyRef = React.useRef(false)
  const journeyToastTimerRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    const ready = isCameraMoveReady(state)
    const wasReady = moveReadyRef.current
    moveReadyRef.current = ready
    if (ready && !wasReady && !readOnly) {
      if (journeyToastTimerRef.current) window.clearTimeout(journeyToastTimerRef.current)
      journeyToastTimerRef.current = window.setTimeout(() => {
        toast(i18n.t('scene3d.export.moveReady'), 'success')
        journeyToastTimerRef.current = null
      }, 500)
    }
  }, [state, readOnly])

  React.useEffect(() => () => {
    if (exportingTimerRef.current) window.clearTimeout(exportingTimerRef.current)
    if (journeyToastTimerRef.current) window.clearTimeout(journeyToastTimerRef.current)
  }, [])

  const handleExportReferenceVideo = React.useCallback(() => {
    if (!onRecordTake) {
      toast(i18n.t('scene3d.export.referenceVideoUnsupported'), 'warning')
      return
    }
    if (!isCameraMoveReady(stateRef.current)) {
      toast(i18n.t('scene3d.export.cameraMoveRequired'), 'warning')
      return
    }
    // 用当前 state（含已有轨迹）触发 take 录制流程 → 宿主建节点 + CameraMoveCaptureHost 渲染 mp4。
    // 时长裁到真实运动终点：编辑器时间轴默认 10s（UI 宽度用），预设只落 3s 轨迹时若按 10s 渲染，
    // mp4 会带 7s 定格尾巴——喂给下游的参考视频大半静止。录 take 路径不经此处（录多久写多久）。
    const current = stateRef.current
    const motionEnd = Math.max(
      current.trajectoryBindings.reduce((max, binding) => Math.max(max, binding.endTime), 0),
      current.objects.reduce((max, object) => (
        (object.poseTrack ?? []).reduce((inner, keyframe) => Math.max(inner, keyframe.time), max)
      ), 0),
    )
    const exportState = motionEnd > 0 && motionEnd < current.sceneTimeline.totalDuration
      ? { ...current, sceneTimeline: { ...current.sceneTimeline, totalDuration: motionEnd } }
      : current
    const takeId = onRecordTake(exportState)
    setExportPanelOpen(false)
    // P0-4/P3-14：产物卡片进「渲染中」态，盯 take 节点等完成；60s 未出降级「渲染较慢」
    setExportingTakeId(typeof takeId === 'string' ? takeId : null)
    setSlowHint(false)
    if (exportingTimerRef.current) window.clearTimeout(exportingTimerRef.current)
    exportingTimerRef.current = window.setTimeout(() => setSlowHint(true), 60_000)
  }, [onRecordTake, stateRef])

  const handleExportScreenshotViewport = React.useCallback(() => {
    const captured = captureViewport()
    setExportPanelOpen(false)
    if (captured) markScreenshotDone()
  }, [captureViewport, markScreenshotDone])

  const handleExportScreenshotCamera = React.useCallback(() => {
    if (!selectedCamera) {
      if (onPickCamera) toastPickCameraFirst(stateRef.current.cameras[0], onPickCamera)
      else toast(i18n.t('scene3d.fullscreen.selectCameraFirst'), 'warning')
      return
    }
    const captured = captureSelectedCamera()
    setExportPanelOpen(false)
    if (captured) markScreenshotDone()
  }, [captureSelectedCamera, markScreenshotDone, onPickCamera, selectedCamera, stateRef])

  const handleExportKeyFrames = React.useCallback(() => {
    // 首尾帧导出需要一个相机 ID：优先用选中的相机，否则用第一个相机
    const cameraId = selectedCamera?.id || stateRef.current.cameras[0]?.id
    if (!cameraId) {
      toast(i18n.t('scene3d.export.addCameraForKeyFrames'), 'warning')
      return
    }
    setExportPanelOpen(false)
    void exportCameraMoveFrames(cameraId)
  }, [exportCameraMoveFrames, selectedCamera, stateRef])

  return {
    exportPanelOpen,
    setExportPanelOpen,
    exportCard,
    dismissExportCard,
    handleExportReferenceVideo,
    handleExportScreenshotViewport,
    handleExportScreenshotCamera,
    handleExportKeyFrames,
  }
}

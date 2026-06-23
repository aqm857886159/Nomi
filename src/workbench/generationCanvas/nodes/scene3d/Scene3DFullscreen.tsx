import React from 'react'
import { createPortal } from 'react-dom'
import { Canvas } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import {
  IconArrowsMove,
  IconCamera,
  IconCube,
  IconListTree,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconRoute,
  IconRotate,
  IconSettings,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import { toast } from '../../../../ui/toast'
import { cloneScene3DState } from './scene3dSerializer'
import {
  type CaptureApi,
  type Scene3DCamera,
  type Scene3DCaptureResult,
  type Scene3DControlMode,
  type Scene3DGeometry,
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DTransformMode,
  type Scene3DVector3,
} from './scene3dTypes'
import {
  OBJECT_LIMIT,
  FULLSCREEN_Z_INDEX,
  type CrowdAddOptions,
} from './scene3dConstants'
import { PanelButton, CanvasPanelRestoreButton, SceneAddToolbar } from './scene3dToolbar'
import {
  isEditableKeyboardTarget,
  cameraLookAtRotation,
  levelEditorCameraRotation,
  applyEditorCameraPose,
  editorCameraFromSceneCamera,
  vectorAlmostEqual,
  crowdCount,
  makeObject,
  makeCrowdObject,
  makeCamera,
  cloneObjectForClipboard,
  cloneCameraForClipboard,
  makePastedObject,
  makePastedCamera,
} from './scene3dMath'
import { SceneObjectList, PropertyPanel } from './scene3dInspector'
import { TrajectoryListPanel } from './scene3dTrajectoryListPanel'
import { nextAvailableObjectPosition } from './scene3dObjects'
import { SceneContent } from './scene3dSceneContent'
import { CameraPreview, PlaybackCameraMonitor } from './scene3dCameraPreview'
import { TrajectoryPanel, TrajectoryTimeline, trajectoryPointTimeRatio } from './trajectory'
import { removeTrajectoryBindingsForNode } from './scene3dTrajectoryState'
import { useScene3DTrajectoryEditor } from './useScene3DTrajectoryEditor'
import { cameraWithPlaybackPosition } from './scene3dPlayback'

type Scene3DFullscreenProps = {
  initialState: Scene3DState
  nodeTitle: string
  readOnly?: boolean
  onClose: () => void
  onStateChange: (state: Scene3DState) => void
  onScreenshot: (capture: Scene3DCaptureResult) => void
}


type Scene3DClipboardItem =
  | { type: 'object'; item: Scene3DObject; pasteCount: number }
  | { type: 'camera'; item: Scene3DCamera; pasteCount: number }

export default function Scene3DFullscreen({
  initialState,
  nodeTitle,
  readOnly = false,
  onClose,
  onStateChange,
  onScreenshot,
}: Scene3DFullscreenProps): JSX.Element {
  const [state, setState] = React.useState(() => cloneScene3DState(initialState))
  const [selection, setSelection] = React.useState<Scene3DSelection>(null)
  const [transformMode, setTransformMode] = React.useState<Scene3DTransformMode>('translate')
  const [viewLocked, setViewLocked] = React.useState(false)
  const controlMode: Scene3DControlMode = viewLocked ? 'edit' : 'fly'
  const controlModeRef = React.useRef<Scene3DControlMode>(controlMode)
  const [flySpeed, setFlySpeed] = React.useState(5)
  const [leftPanelOpen, setLeftPanelOpen] = React.useState(true)
  const [rightPanelOpen, setRightPanelOpen] = React.useState(true)
  const [trajectoryMode, setTrajectoryMode] = React.useState(false)
  const trajectoryModeRef = React.useRef(trajectoryMode)
  const canvasFocusMode = !leftPanelOpen || !rightPanelOpen
  const [focusId, setFocusId] = React.useState('')
  const [cameraViewEditId, setCameraViewEditId] = React.useState<string | null>(null)
  const captureApiRef = React.useRef<CaptureApi | null>(null)
  const initialEditorCameraRef = React.useRef<Scene3DState['editorCamera']>({
    ...initialState.editorCamera,
    rotation: levelEditorCameraRotation(initialState.editorCamera.position, initialState.editorCamera.target),
  })
  const latestEditorCameraRef = React.useRef<Scene3DState['editorCamera']>(initialEditorCameraRef.current)
  const stateRef = React.useRef(state)
  const selectionRef = React.useRef<Scene3DSelection>(selection)
  const suspendedKeyboardSelectionRef = React.useRef<Exclude<Scene3DSelection, null> | null>(null)
  const clipboardRef = React.useRef<Scene3DClipboardItem | null>(null)
  const suppressCanvasMissedSelectionRef = React.useRef(false)
  const suppressCanvasMissedReleaseRef = React.useRef<number | null>(null)
  const onStateChangeRef = React.useRef(onStateChange)
  const canvasCamera = React.useMemo(() => ({
    fov: 55,
    near: 0.1,
    far: 500,
    position: initialEditorCameraRef.current.position,
  }), [])
  const selectedCamera = selection?.type === 'camera'
    ? state.cameras.find((camera) => camera.id === selection.id)
    : undefined
  const cameraViewEditCamera = cameraViewEditId
    ? state.cameras.find((camera) => camera.id === cameraViewEditId)
    : undefined
  const trajectoryEditor = useScene3DTrajectoryEditor({
    state,
    setState,
    readOnly,
    suspendPlayback: Boolean(cameraViewEditCamera),
  })
  const {
    activeGroupId,
    activePointId,
    activeTrajectoryId,
    activeTrajectoryIds,
    bindTargets,
    displayState,
    isPlaying,
    playheadRef,
    requestPlayChange,
    selectGroup,
    selectPoint,
    selectTrajectory,
    timelineVisible,
    setTimelineVisible,
    setTrajectoryPlaying,
    addTrajectory,
    addTrajectoryAt,
    addTrajectoryGroup,
    addTrajectoryPoint,
    bindObjectToTrajectory,
    deleteTrajectory,
    deleteTrajectoryBinding,
    deleteTrajectoryPoint,
    insertTrajectoryPointAt,
    patchTrajectory,
    patchTrajectoryBinding,
    patchTrajectoryBoundObject,
    patchTrajectoryCurveControl,
    patchTrajectoryPointPosition,
    patchTrajectoryPointTiming,
    renameTrajectoryGroup,
    translateTrajectoryBy,
    unbindObjectFromTrajectory,
  } = trajectoryEditor

  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  React.useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  React.useEffect(() => {
    controlModeRef.current = controlMode
    latestEditorCameraRef.current = {
      ...latestEditorCameraRef.current,
      mode: controlMode,
    }
  }, [controlMode])

  React.useEffect(() => {
    trajectoryModeRef.current = trajectoryMode
  }, [trajectoryMode])

  React.useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  React.useEffect(() => {
    onStateChangeRef.current(state)
  }, [state])

  React.useEffect(() => () => {
    if (suppressCanvasMissedReleaseRef.current !== null) {
      window.clearTimeout(suppressCanvasMissedReleaseRef.current)
      suppressCanvasMissedReleaseRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousOverflow
      body.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  const selectSceneItem = React.useCallback((nextSelection: Scene3DSelection) => {
    setSelection(nextSelection)
    setViewLocked(false)
    setFocusId('')
    trajectoryModeRef.current = false
    setTrajectoryMode(false)
  }, [])

  const clearSelection = React.useCallback(() => {
    if (suppressCanvasMissedSelectionRef.current) return
    setSelection(null)
    setViewLocked(false)
    setFocusId('')
  }, [])

  const focusSceneItem = React.useCallback((id: string) => {
    if (cameraViewEditId) return
    trajectoryModeRef.current = false
    setTrajectoryMode(false)
    setViewLocked(true)
    setFocusId(`${id}:${Date.now()}`)
  }, [cameraViewEditId])

  const patchObject = React.useCallback((id: string, patch: Partial<Scene3DObject>) => {
    setState((current) => ({
      ...current,
      objects: current.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    }))
  }, [])

  const patchCamera = React.useCallback((id: string, patch: Partial<Scene3DCamera>) => {
    setState((current) => ({
      ...current,
      cameras: current.cameras.map((camera) => (camera.id === id ? { ...camera, ...patch } : camera)),
    }))
  }, [])

  const deleteSceneItem = React.useCallback((target: Exclude<Scene3DSelection, null>) => {
    if (readOnly) return
    setState((current) => {
      const nextState = target.type === 'object'
        ? {
            ...current,
            objects: current.objects.filter((object) => object.id !== target.id),
            cameras: current.cameras.map((camera) => (
              camera.followTargetId === target.id ? { ...camera, followTargetId: undefined } : camera
            )),
          }
        : {
            ...current,
            cameras: current.cameras.filter((camera) => camera.id !== target.id),
          }
      return removeTrajectoryBindingsForNode(nextState, target.id)
    })
    if (selectionRef.current?.type === target.type && selectionRef.current.id === target.id) {
      setViewLocked(false)
    }
    if (target.type === 'camera') {
      setCameraViewEditId((current) => (current === target.id ? null : current))
    }
    setSelection((current) => (current?.type === target.type && current.id === target.id ? null : current))
  }, [readOnly])

  const addObject = React.useCallback((kind: Scene3DGeometry | 'mannequin' | 'light') => {
    if (readOnly) return
    if (state.objects.length >= OBJECT_LIMIT) {
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
    trajectoryModeRef.current = false
    setTrajectoryMode(false)
    setViewLocked(false)
  }, [readOnly, state.objects.length])

  const addCamera = React.useCallback(() => {
    if (readOnly) return
    const camera = makeCamera(state.cameras.length)
    setState((current) => ({ ...current, cameras: [...current.cameras, camera] }))
    setSelection({ type: 'camera', id: camera.id })
    trajectoryModeRef.current = false
    setTrajectoryMode(false)
    setViewLocked(false)
  }, [readOnly, state.cameras.length])

  const addCrowd = React.useCallback((options: CrowdAddOptions) => {
    if (readOnly) return
    if (state.objects.length >= OBJECT_LIMIT) {
      toast('单个 3D 场景最多支持 100 个对象', 'warning')
      return
    }
    const crowd = makeCrowdObject(options)
    crowd.position = nextAvailableObjectPosition(crowd, stateRef.current.objects)
    setState((current) => ({ ...current, objects: [...current.objects, crowd] }))
    setSelection({ type: 'object', id: crowd.id })
    trajectoryModeRef.current = false
    setTrajectoryMode(false)
    setViewLocked(false)
  }, [readOnly, state.objects.length])

  const startKeyboardNavigation = React.useCallback(() => {
    const currentSelection = selectionRef.current
    setViewLocked(false)
    setFocusId('')
    if (!currentSelection) return
    if (!suspendedKeyboardSelectionRef.current) {
      suspendedKeyboardSelectionRef.current = currentSelection
    }
    setSelection(null)
  }, [])

  const stopKeyboardNavigation = React.useCallback(() => {
    const suspendedSelection = suspendedKeyboardSelectionRef.current
    if (!suspendedSelection) return
    suspendedKeyboardSelectionRef.current = null

    const currentState = stateRef.current
    const stillExists = suspendedSelection.type === 'object'
      ? currentState.objects.some((object) => object.id === suspendedSelection.id)
      : currentState.cameras.some((camera) => camera.id === suspendedSelection.id)
    setSelection(stillExists ? suspendedSelection : null)
  }, [])

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
  }, [])

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
  }, [readOnly])

  const captureViewport = React.useCallback(() => {
    const capture = captureApiRef.current?.captureViewport()
    if (!capture) {
      toast('截图失败，请重试', 'error')
      return
    }
    onScreenshot(capture)
  }, [onScreenshot])

  const captureSelectedCamera = React.useCallback(() => {
    if (!selectedCamera) {
      toast('请先选中一个拍摄相机', 'warning')
      return
    }
    const captureCamera = cameraWithPlaybackPosition(
      stateRef.current,
      selectedCamera,
      playheadRef.current,
      activeTrajectoryIds,
    )
    const capture = captureApiRef.current?.captureCamera(captureCamera)
    if (!capture) {
      toast('相机截图失败，请重试', 'error')
      return
    }
    onScreenshot(capture)
  }, [activeTrajectoryIds, onScreenshot, playheadRef, selectedCamera])

  const updateEditorCamera = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    setState((current) => {
      const nextEditorCamera = {
        ...current.editorCamera,
        ...editorCamera,
      }
      if (
        current.editorCamera.mode === nextEditorCamera.mode &&
        vectorAlmostEqual(current.editorCamera.position, nextEditorCamera.position) &&
        vectorAlmostEqual(current.editorCamera.rotation, nextEditorCamera.rotation) &&
        vectorAlmostEqual(current.editorCamera.target, nextEditorCamera.target)
      ) {
        return current
      }
      return {
        ...current,
        editorCamera: nextEditorCamera,
      }
    })
  }, [])

  const updateEditorCameraTarget = React.useCallback((target: Scene3DVector3) => {
    latestEditorCameraRef.current = {
      ...latestEditorCameraRef.current,
      target,
    }
    setState((current) => vectorAlmostEqual(current.editorCamera.target, target)
      ? current
      : {
          ...current,
          editorCamera: {
            ...current.editorCamera,
            target,
          },
        })
  }, [])

  const handleWheelNavigation = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    latestEditorCameraRef.current = editorCamera
    setViewLocked(false)
    setFocusId('')
    updateEditorCamera(editorCamera)
  }, [updateEditorCamera])

  const unlockViewForSceneEdit = React.useCallback(() => {
    suppressCanvasMissedSelectionRef.current = true
    if (suppressCanvasMissedReleaseRef.current !== null) {
      window.clearTimeout(suppressCanvasMissedReleaseRef.current)
      suppressCanvasMissedReleaseRef.current = null
    }
    setViewLocked(false)
    setFocusId('')
  }, [])

  const finishSceneTransformInteraction = React.useCallback(() => {
    if (suppressCanvasMissedReleaseRef.current !== null) {
      window.clearTimeout(suppressCanvasMissedReleaseRef.current)
    }
    suppressCanvasMissedReleaseRef.current = window.setTimeout(() => {
      suppressCanvasMissedSelectionRef.current = false
      suppressCanvasMissedReleaseRef.current = null
    }, 160)
  }, [])

  const handleEditorCameraDraft = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    latestEditorCameraRef.current = editorCamera
  }, [])

  React.useEffect(() => {
    if (cameraViewEditId && !cameraViewEditCamera) {
      setCameraViewEditId(null)
    }
  }, [cameraViewEditCamera, cameraViewEditId])

  const enterCameraViewEdit = React.useCallback((cameraData: Scene3DCamera) => {
    if (readOnly) return
    const editorCamera = editorCameraFromSceneCamera(cameraData)
    latestEditorCameraRef.current = editorCamera
    setSelection({ type: 'camera', id: cameraData.id })
    setCameraViewEditId(cameraData.id)
    setViewLocked(false)
    setFocusId('')
    updateEditorCamera(editorCamera)
  }, [readOnly, updateEditorCamera])

  const exitCameraViewEdit = React.useCallback(() => {
    setCameraViewEditId(null)
    setViewLocked(false)
    setFocusId('')
  }, [])

  const toggleCameraViewEdit = React.useCallback(() => {
    if (!selectedCamera || readOnly) return
    if (cameraViewEditId === selectedCamera.id) {
      return
    }
    enterCameraViewEdit(cameraWithPlaybackPosition(
      stateRef.current,
      selectedCamera,
      playheadRef.current,
      activeTrajectoryIds,
    ))
  }, [activeTrajectoryIds, cameraViewEditId, enterCameraViewEdit, playheadRef, readOnly, selectedCamera])

  const levelSelectedCamera = React.useCallback(() => {
    if (!selectedCamera || readOnly) return
    const displayCamera = cameraWithPlaybackPosition(
      stateRef.current,
      selectedCamera,
      playheadRef.current,
      activeTrajectoryIds,
    )
    patchCamera(selectedCamera.id, {
      rotation: cameraLookAtRotation(displayCamera.position, displayCamera.target),
    })
  }, [activeTrajectoryIds, patchCamera, playheadRef, readOnly, selectedCamera])

  const enterTrajectoryMode = React.useCallback((showTimeline = true) => {
    trajectoryModeRef.current = true
    setTrajectoryMode(true)
    if (showTimeline) setTimelineVisible(true)
    setSelection(null)
    setViewLocked(false)
    setFocusId('')
  }, [setTimelineVisible])

  const toggleTrajectoryMode = React.useCallback(() => {
    const next = !trajectoryModeRef.current
    trajectoryModeRef.current = next
    setTrajectoryMode(next)
    if (next) {
      setTimelineVisible(true)
      setSelection(null)
      setViewLocked(false)
      setFocusId('')
    }
  }, [setTimelineVisible])

  const selectTrajectoryForMode = React.useCallback((trajectoryId: string) => {
    selectTrajectory(trajectoryId)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, selectTrajectory])

  const selectSceneTrajectory = React.useCallback((trajectoryId: string) => {
    if (trajectoryModeRef.current) {
      selectTrajectoryForMode(trajectoryId)
      return
    }
    selectTrajectory(trajectoryId)
    setSelection(null)
  }, [selectTrajectory, selectTrajectoryForMode])

  const selectTrajectoryPointForMode = React.useCallback((trajectoryId: string, pointId: string) => {
    selectPoint(trajectoryId, pointId)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, selectPoint])

  const addTrajectoryForMode = React.useCallback(() => {
    addTrajectory()
    enterTrajectoryMode()
  }, [addTrajectory, enterTrajectoryMode])

  const addTrajectoryAtForMode = React.useCallback((position: Scene3DVector3) => {
    addTrajectoryAt(position)
    enterTrajectoryMode()
  }, [addTrajectoryAt, enterTrajectoryMode])

  const addTrajectoryPointForMode = React.useCallback((trajectoryId: string) => {
    addTrajectoryPoint(trajectoryId)
    enterTrajectoryMode()
  }, [addTrajectoryPoint, enterTrajectoryMode])

  const insertTrajectoryPointForMode = React.useCallback((
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => {
    insertTrajectoryPointAt(trajectoryId, position, targetPointId, placement)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, insertTrajectoryPointAt])

  const patchTrajectoryCurveControlForMode = React.useCallback((
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => {
    patchTrajectoryCurveControl(trajectoryId, segmentStartPointId, position)
    enterTrajectoryMode()
  }, [enterTrajectoryMode, patchTrajectoryCurveControl])

  const assignTrajectoryToGroup = React.useCallback((trajectoryId: string, groupId: string) => {
    if (readOnly) return
    const groupExists = stateRef.current.trajectoryGroups.some((group) => group.id === groupId)
    const trajectoryExists = stateRef.current.trajectories.some((trajectory) => trajectory.id === trajectoryId)
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
    selectTrajectoryForMode(trajectoryId)
    selectGroup(groupId)
    setTimelineVisible(true)
  }, [readOnly, selectGroup, selectTrajectoryForMode, setTimelineVisible])

  const handleEditTrajectory = React.useCallback((trajectoryId: string) => {
    selectTrajectoryForMode(trajectoryId)
  }, [selectTrajectoryForMode])

  const bindTargetToTrajectoryForMode = React.useCallback((
    trajectoryId: string,
    targetId: string,
    pointId?: string | null,
  ) => {
    if (readOnly) return
    const current = stateRef.current
    const trajectory = current.trajectories.find((candidate) => candidate.id === trajectoryId)
    if (!trajectory) return
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
    const pointIndex = pointId ? trajectory.points.findIndex((point) => point.id === pointId) : -1
    const offsetRatio = pointIndex >= 0 ? trajectoryPointTimeRatio(trajectory, pointIndex) : 0
    bindObjectToTrajectory(trajectoryId, targetId, offsetRatio)
    selectGroup(null)
    selectTrajectory(trajectoryId)
    enterTrajectoryMode()
    setSelection(cameraExists ? { type: 'camera', id: targetId } : { type: 'object', id: targetId })
  }, [bindObjectToTrajectory, enterTrajectoryMode, readOnly, selectGroup, selectTrajectory])

  const patchTrajectoryBindingForMode = React.useCallback((bindingId: string, patch: Parameters<typeof patchTrajectoryBinding>[1]) => {
    patchTrajectoryBinding(bindingId, patch)
    setTimelineVisible(true)
  }, [patchTrajectoryBinding, setTimelineVisible])

  const patchTrajectoryBoundObjectForMode = React.useCallback((
    bindingId: string,
    objectId: string,
    patch: Parameters<typeof patchTrajectoryBoundObject>[2],
  ) => {
    patchTrajectoryBoundObject(bindingId, objectId, patch)
    setTimelineVisible(true)
  }, [patchTrajectoryBoundObject, setTimelineVisible])

  const unbindObjectFromTrajectoryForMode = React.useCallback((bindingId: string, objectId: string) => {
    unbindObjectFromTrajectory(bindingId, objectId)
    setTimelineVisible(true)
  }, [setTimelineVisible, unbindObjectFromTrajectory])

  const deleteTrajectoryBindingForMode = React.useCallback((bindingId: string) => {
    deleteTrajectoryBinding(bindingId)
    setTimelineVisible(true)
  }, [deleteTrajectoryBinding, setTimelineVisible])

  const flushLatestState = React.useCallback(() => {
    const latestState = {
      ...stateRef.current,
      editorCamera: {
        ...latestEditorCameraRef.current,
        mode: controlModeRef.current,
      },
    }
    stateRef.current = latestState
    onStateChangeRef.current(latestState)
    return latestState
  }, [])

  const handleClose = React.useCallback(() => {
    trajectoryModeRef.current = false
    setTrajectoryMode(false)
    setTimelineVisible(false)
    setTrajectoryPlaying(false)
    flushLatestState()
    onClose()
  }, [flushLatestState, onClose, setTimelineVisible, setTrajectoryPlaying])

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
  }, [cameraViewEditId, copySelection, deleteSceneItem, exitCameraViewEdit, handleClose, pasteClipboard])

  React.useEffect(() => () => {
    flushLatestState()
  }, [flushLatestState])

  const toggleCanvasFocusMode = React.useCallback(() => {
    if (leftPanelOpen && rightPanelOpen) {
      setLeftPanelOpen(false)
      setRightPanelOpen(false)
      return
    }
    setLeftPanelOpen(true)
    setRightPanelOpen(true)
  }, [leftPanelOpen, rightPanelOpen])

  const editorShell = (
    <div
      className="workbench-shell fixed inset-0 isolate flex h-[100dvh] w-screen flex-col overflow-hidden bg-[var(--workbench-bg)] text-[var(--workbench-ink)] font-[var(--nomi-font-sans)]"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        minWidth: '100vw',
        minHeight: '100dvh',
        zIndex: FULLSCREEN_Z_INDEX,
        background: 'var(--workbench-bg)',
        pointerEvents: 'auto',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="3D 场景编辑器"
      tabIndex={0}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-[0_1px_0_rgba(18,24,38,0.04)]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconCube size={18} className="shrink-0 text-[var(--workbench-muted)]" />
          <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">{nodeTitle}</div>
        </div>
        <div className="ml-auto flex min-w-0 max-w-[72vw] items-center gap-2 overflow-x-auto">
          <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
            <PanelButton title="移动" active={transformMode === 'translate'} onClick={() => setTransformMode('translate')}>
              <IconArrowsMove size={15} />
            </PanelButton>
            <PanelButton title="旋转" active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')}>
              <IconRotate size={15} />
            </PanelButton>
          </div>
          <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
            <PanelButton title="当前视口截图" onClick={captureViewport}>
              <IconPhoto size={15} />
              <span>截图</span>
            </PanelButton>
          </div>
          <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
            <PanelButton
              title={trajectoryMode ? '退出轨迹模式' : '进入轨迹模式'}
              active={trajectoryMode}
              onClick={() => {
                toggleTrajectoryMode()
              }}
            >
              <IconRoute size={15} />
              <span>轨迹</span>
            </PanelButton>
            <PanelButton
              title={isPlaying ? '暂停轨迹播放' : '播放轨迹'}
              active={isPlaying}
              onClick={() => {
                if (!requestPlayChange(!isPlaying) && !isPlaying) {
                  toast('请先为轨迹绑定对象或相机', 'warning')
                }
              }}
            >
              {isPlaying ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />}
            </PanelButton>
          </div>
          <label className="inline-flex h-8 shrink-0 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--workbench-muted)]">
            <IconWorld size={14} />
            <span>速度</span>
            <input
              className="h-1.5 w-24 accent-[var(--nomi-ink)]"
              max={16}
              min={1}
              step={0.5}
              type="range"
              value={flySpeed}
              onChange={(event) => setFlySpeed(Number(event.currentTarget.value))}
            />
          </label>
          <button
            className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
            type="button"
            title="关闭"
            onClick={handleClose}
          >
            <IconX size={16} />
          </button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--workbench-bg)]">
        <AnimatePresence initial={false}>
          {leftPanelOpen ? (
            <motion.aside
              key="scene-node-panel"
              animate={{ opacity: 1, scale: 1, width: 260, x: 0 }}
              className="relative z-[2] flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] shadow-[8px_0_28px_rgba(18,24,38,0.05)]"
              exit={{ opacity: 0, scale: 0.16, width: 0, x: -26 }}
              initial={{ opacity: 0, scale: 0.16, width: 0, x: -26 }}
              style={{ transformOrigin: 'top left' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {trajectoryMode ? (
                <TrajectoryListPanel
                  trajectories={state.trajectories}
                  groups={state.trajectoryGroups}
                  activeTrajectoryId={activeTrajectoryId}
                  readOnly={readOnly}
                  onSelectTrajectory={selectTrajectoryForMode}
                  onAssignTrajectoryToGroup={assignTrajectoryToGroup}
                  onDeleteTrajectory={deleteTrajectory}
                />
              ) : (
                <SceneObjectList
                  objects={state.objects}
                  cameras={state.cameras}
                  selection={selection}
                  readOnly={readOnly}
                  onSelect={selectSceneItem}
                  onFocus={focusSceneItem}
                  onObjectPatch={patchObject}
                  onCameraPatch={patchCamera}
                  onDelete={deleteSceneItem}
                />
              )}
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--nomi-ink-05)]">
          <Canvas
            camera={canvasCamera}
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            onCreated={({ camera }) => applyEditorCameraPose(camera, initialEditorCameraRef.current)}
            onPointerMissed={clearSelection}
          >
            <SceneContent
              state={displayState}
              selection={selection}
              readOnly={readOnly}
              transformMode={trajectoryMode ? 'translate' : transformMode}
              flySpeed={flySpeed}
              focusId={focusId}
              viewLocked={viewLocked}
              cameraViewEditCamera={cameraViewEditCamera}
              trajectoryMode={trajectoryMode}
              onSelect={selectSceneItem}
              onFocus={focusSceneItem}
              onObjectPatch={patchObject}
              onCameraPatch={patchCamera}
              onEditorCameraDraft={handleEditorCameraDraft}
              onEditorCameraCommit={updateEditorCamera}
              onEditorCameraTargetChange={updateEditorCameraTarget}
              onWheelNavigation={handleWheelNavigation}
              onTransformInteractionStart={unlockViewForSceneEdit}
              onTransformInteractionEnd={finishSceneTransformInteraction}
              onFocusConsumed={() => setFocusId('')}
              onKeyboardNavigationStart={startKeyboardNavigation}
              onKeyboardNavigationStop={stopKeyboardNavigation}
              setCaptureApi={(api) => {
                captureApiRef.current = api
              }}
              activeTrajectoryId={activeTrajectoryId}
              activePointId={activePointId}
              trajectoryBindTargets={bindTargets}
              onSelectTrajectory={selectSceneTrajectory}
              onSelectTrajectoryPoint={selectTrajectoryPointForMode}
              onCreateTrajectoryAt={addTrajectoryAtForMode}
              onInsertTrajectoryPoint={insertTrajectoryPointForMode}
              onUpdateTrajectoryCurveControl={patchTrajectoryCurveControlForMode}
              onUpdateTrajectoryPoint={patchTrajectoryPointPosition}
              onTranslateTrajectory={translateTrajectoryBy}
              onEditTrajectory={handleEditTrajectory}
              onDeleteTrajectory={deleteTrajectory}
              onBindTargetToTrajectory={bindTargetToTrajectoryForMode}
            />
          </Canvas>
          {!leftPanelOpen ? (
            <CanvasPanelRestoreButton side="left" title="显示场景节点" onClick={() => setLeftPanelOpen(true)}>
              <IconListTree size={18} />
            </CanvasPanelRestoreButton>
          ) : null}
          {!rightPanelOpen ? (
            <CanvasPanelRestoreButton side="right" title="显示属性" onClick={() => setRightPanelOpen(true)}>
              <IconSettings size={18} />
            </CanvasPanelRestoreButton>
          ) : null}
          {isPlaying ? (
            <PlaybackCameraMonitor
              state={state}
              activeTrajectoryIds={activeTrajectoryIds}
              rightPanelCollapsed={!rightPanelOpen}
            />
          ) : selectedCamera ? (
            <CameraPreview
              camera={selectedCamera}
              state={state}
              activeTrajectoryIds={activeTrajectoryIds}
              readOnly={readOnly}
              cameraViewEditing={cameraViewEditId === selectedCamera.id}
              rightPanelCollapsed={!rightPanelOpen}
              onAspectChange={(aspectRatio) => patchCamera(selectedCamera.id, { aspectRatio })}
              onLensDepthChange={(lensDepth) => patchCamera(selectedCamera.id, { lensDepth })}
              onToggleViewEdit={toggleCameraViewEdit}
              onLevelCamera={levelSelectedCamera}
              onScreenshot={captureSelectedCamera}
            />
          ) : null}
          {cameraViewEditCamera ? (
            <div className="pointer-events-auto absolute left-1/2 top-4 z-[3] flex -translate-x-1/2 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-3 py-2 text-caption text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]">
              <IconCamera size={15} className="text-[var(--nomi-ink-60)]" />
              <span className="max-w-[220px] truncate">取景调整 · {cameraViewEditCamera.name}</span>
              <button
                className="rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 py-1 text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
                type="button"
                onClick={exitCameraViewEdit}
              >
                退出
              </button>
            </div>
          ) : null}
          <div className="pointer-events-none absolute bottom-4 left-4 grid size-20 place-items-center rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-micro text-[var(--nomi-ink-60)] shadow-[var(--nomi-shadow-md)]">
            <div className="grid gap-1">
              <span className="text-red-300">X</span>
              <span className="text-green-300">Y</span>
              <span className="text-blue-300">Z</span>
            </div>
          </div>
          {!readOnly ? (
            <SceneAddToolbar
              onAddObject={addObject}
              onAddCrowd={addCrowd}
              onAddCamera={addCamera}
              trajectoryMode={trajectoryMode}
              onToggleTrajectoryMode={toggleTrajectoryMode}
              canvasFocusMode={canvasFocusMode}
              onToggleCanvasFocusMode={toggleCanvasFocusMode}
            />
          ) : null}
          {trajectoryMode ? (
            <TrajectoryTimeline
              state={state}
              visible={timelineVisible}
              isPlaying={isPlaying}
              readOnly={readOnly}
              activeGroupId={activeGroupId}
              playheadRef={playheadRef}
              onPlayChange={(playing) => {
                if (!requestPlayChange(playing) && playing) {
                  toast('请先为轨迹绑定对象或相机', 'warning')
                }
              }}
              onSelectGroup={selectGroup}
              onSelectTrajectory={selectTrajectoryForMode}
              onClose={() => setTimelineVisible(false)}
              onAddGroup={addTrajectoryGroup}
              onRenameGroup={renameTrajectoryGroup}
              onPatchBinding={patchTrajectoryBindingForMode}
              onPatchTrajectoryPoint={patchTrajectoryPointTiming}
            />
          ) : null}
        </div>

        <AnimatePresence initial={false}>
          {rightPanelOpen ? (
            <motion.aside
              key="scene-property-panel"
              animate={{ opacity: 1, scale: 1, width: 300, x: 0 }}
              className="relative z-[2] flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] shadow-[-8px_0_28px_rgba(18,24,38,0.06)]"
              exit={{ opacity: 0, scale: 0.16, width: 0, x: 26 }}
              initial={{ opacity: 0, scale: 0.16, width: 0, x: 26 }}
              style={{ transformOrigin: 'top right' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {trajectoryMode ? (
                <TrajectoryPanel
                  state={state}
                  activeTrajectoryId={activeTrajectoryId}
                  activePointId={activePointId}
                  readOnly={readOnly}
                  onAddTrajectory={addTrajectoryForMode}
                  onSelectTrajectory={selectTrajectoryForMode}
                  onDeleteTrajectory={deleteTrajectory}
                  onPatchTrajectory={patchTrajectory}
                  onAddPoint={addTrajectoryPointForMode}
                  onSelectPoint={selectTrajectoryPointForMode}
                  onUpdatePoint={patchTrajectoryPointPosition}
                  onDeletePoint={deleteTrajectoryPoint}
                  onBindObject={bindTargetToTrajectoryForMode}
                  onPatchBinding={patchTrajectoryBindingForMode}
                  onPatchBoundObject={patchTrajectoryBoundObjectForMode}
                  onUnbindObject={unbindObjectFromTrajectoryForMode}
                  onDeleteBinding={deleteTrajectoryBindingForMode}
                />
              ) : (
                <PropertyPanel
                  state={state}
                  selection={selection}
                  readOnly={readOnly}
                  onObjectPatch={patchObject}
                  onCameraPatch={patchCamera}
                  onEnvironmentPatch={(patch) => setState((current) => ({
                    ...current,
                    environment: { ...current.environment, ...patch },
                  }))}
                />
              )}
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </main>

    </div>
  )

  return typeof document === 'undefined' ? editorShell : createPortal(editorShell, document.body)
}

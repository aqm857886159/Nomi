import React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconListTree, IconSettings } from '@tabler/icons-react'
import { toast } from '../../../../ui/toast'
import { FencedCanvas } from '../fencedCanvas'
import { Scene3DWindowBar } from './Scene3DWindowBar'
import { Scene3DCoachMarks } from './Scene3DCoachMarks'
import { hasSeenScene3DCoach, resetScene3DCoachSeen } from '../../../onboarding/onboardingState'
import { cloneScene3DState } from './scene3dSerializer'
import {
  type CaptureApi,
  type Scene3DCamera,
  type Scene3DCaptureResult,
  type Scene3DControlMode,
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DTransformMode,
} from './scene3dTypes'
import { FULLSCREEN_Z_INDEX } from './scene3dConstants'
import { CanvasPanelRestoreButton, Scene3DViewportToolPill } from './scene3dToolbar'
import { SCENE_FIT_FOCUS_ID } from './scene3dFitView'
import {
  levelEditorCameraRotation,
  applyEditorCameraPose,
  vectorAlmostEqual,
} from './scene3dMath'
import { SceneObjectList } from './scene3dInspector'
import { TrajectoryListPanel } from './scene3dTrajectoryListPanel'
import { SceneContent } from './scene3dSceneContent'
import { attachWebGLContextRecovery } from './scene3dContextRecovery'
import { CharacterPossessButton, Scene3DBottomBar } from './scene3dCharacterActionBar'
import { useScene3DCharacterDrive } from './useScene3DCharacterDrive'
import { useScene3DCameraViewEdit } from './useScene3DCameraViewEdit'
import { useScene3DTakeRecorder } from './useScene3DTakeRecorder'
import { Scene3DTakeSampler } from './Scene3DTakeSampler'
import { CameraPreview, PlaybackCameraMonitor } from './scene3dCameraPreview'
import { useScene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'
import Scene3DExportPanel, { Scene3DExportingCard } from './scene3dExportPanel'
import { Scene3DFullscreenHeader } from './Scene3DFullscreenHeader'
import {
  Scene3DTrajectoryLayer,
  Scene3DTrajectoryEditBanner,
  Scene3DCameraViewBanner,
  Scene3DRightPanelBody,
  Scene3DTrajectoryTimelineBar,
} from './scene3dTrajectorySurfaces'
import type { Scene3DMoveHubTab } from './scene3dMoveHub'
import { removeTrajectoryBindingsForNode } from './scene3dTrajectoryState'
import { cameraWithPlaybackPosition } from './scene3dPlayback'
import type { Scene3DReferenceTargetSummary } from './scene3dReferenceDirector'
import {
  useScene3DClipboardActions,
  useScene3DTrajectoryModeActions,
  useScene3DKeyboardShortcuts,
  useScene3DAddActions,
  useScene3DCameraMoveAction,
  useScene3DMoveFrameExport,
  useScene3DExportActions,
  toastPickCameraFirst,
  type Scene3DClipboardItem,
} from './useScene3DFullscreenActions'
type Scene3DFullscreenProps = {
  initialState: Scene3DState
  nodeTitle: string
  readOnly?: boolean
  onClose: () => void
  onStateChange: (state: Scene3DState) => void
  onScreenshot: (capture: Scene3DCaptureResult) => void
  // 录 take（S2）：把录制好的（含角色/机位轨迹的）场景交回宿主建 scene3d 节点 + 打捕获标志。
  // 可选——未传则不出现「录 take」按钮（如样张/只读环境）。
  onRecordTake?: (recordedState: Scene3DState) => void
  referenceTarget?: Scene3DReferenceTargetSummary
}

export default function Scene3DFullscreen({
  initialState,
  nodeTitle,
  readOnly = false,
  onClose,
  onStateChange,
  onScreenshot,
  onRecordTake,
  referenceTarget,
}: Scene3DFullscreenProps): JSX.Element {
  const [state, setState] = React.useState(() => cloneScene3DState(initialState))
  const [selection, setSelection] = React.useState<Scene3DSelection>(null)
  // 首次进入的三步教练标注（方案 A，2026-07-11 拍板）；只出现一次，localStorage 记忆。
  const [showCoach, setShowCoach] = React.useState(() => !hasSeenScene3DCoach())
  const [transformMode, setTransformMode] = React.useState<Scene3DTransformMode>('translate')
  const [viewLocked, setViewLocked] = React.useState(false)
  const controlMode: Scene3DControlMode = viewLocked ? 'edit' : 'fly'
  const controlModeRef = React.useRef<Scene3DControlMode>(controlMode)
  const [flySpeed, setFlySpeed] = React.useState(5)
  const [leftPanelOpen, setLeftPanelOpen] = React.useState(true)
  const [rightPanelOpen, setRightPanelOpen] = React.useState(true)
  const canvasFocusMode = !leftPanelOpen || !rightPanelOpen
  const [focusId, setFocusId] = React.useState('')
  const fitNonceRef = React.useRef(0)
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
  const canvasCamera = React.useMemo(
    () => ({ fov: 55, near: 0.1, far: 500, position: initialEditorCameraRef.current.position }),
    [],
  )
  const selectedCamera = selection?.type === 'camera'
    ? state.cameras.find((camera) => camera.id === selection.id)
    : undefined
  const cameraViewEditCamera = cameraViewEditId
    ? state.cameras.find((camera) => camera.id === cameraViewEditId)
    : undefined
  // 整运镜分区（IA 重排一期）：预设/轨迹/录 take 三 tab，替代原右栏顶层「属性/轨迹」两 tab
  const [moveHubTab, setMoveHubTab] = React.useState<Scene3DMoveHubTab>('preset')
  const trajectory = useScene3DTrajectoryEditing({ state, setState, readOnly })
  const trajectoryMode = trajectory.trajectoryEditMode
  const enterTrajectoryPanel = React.useCallback(() => {
    setRightPanelOpen(true)
    setMoveHubTab('trajectory')
  }, [])
  const enterTrajectoryMode = React.useCallback((showTimeline = true) => {
    trajectory.setTrajectoryEditMode(true)
    if (showTimeline) trajectory.setTimelineOpen(true)
    setSelection(null)
    setViewLocked(false)
    setFocusId('')
    enterTrajectoryPanel()
  }, [enterTrajectoryPanel, trajectory])
  const exitTrajectoryMode = React.useCallback(() => {
    trajectory.setTrajectoryEditMode(false)
    trajectory.setIsPlaying(false)
  }, [trajectory])

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

  // 点对象=退出轨迹模式+选中（exitTrajectoryMode 一直在这，此前被 SceneContent 的
  // interactionDisabled 拦住点击进不来——模式陷阱的真根因，2026-07-20 用户反馈）
  const selectSceneItem = React.useCallback((nextSelection: Scene3DSelection) => {
    exitTrajectoryMode()
    setSelection(nextSelection)
    setViewLocked(false)
    setFocusId('')
  }, [exitTrajectoryMode])

  const clearSelection = React.useCallback(() => {
    if (suppressCanvasMissedSelectionRef.current) return
    setSelection(null)
    setViewLocked(false)
    setFocusId('')
  }, [])

  const focusSceneItem = React.useCallback((id: string) => {
    if (cameraViewEditId) return
    exitTrajectoryMode()
    setViewLocked(false)
    setFocusId(`${id}:${Date.now()}`)
  }, [cameraViewEditId, exitTrajectoryMode])

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

  const applyCameraMove = useScene3DCameraMoveAction({ readOnly, stateRef, setState, trajectory })
  const exportCameraMoveFrames = useScene3DMoveFrameExport({ stateRef, captureApiRef, trajectory, onScreenshot })

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

  const { addObject, addProp, addCamera, addCrowd, applySceneTemplate } = useScene3DAddActions({
    readOnly,
    stateRef,
    setState,
    setSelection,
    setViewLocked,
    exitTrajectoryMode,
  })

  const { startKeyboardNavigation, stopKeyboardNavigation, copySelection, pasteClipboard } =
    useScene3DClipboardActions({
      readOnly,
      stateRef,
      selectionRef,
      clipboardRef,
      suspendedKeyboardSelectionRef,
      setState,
      setSelection,
      setViewLocked,
      setFocusId,
    })

  // 返回是否截成：出片面板据此弹截图完成卡（产物落在被编辑器盖住的画布上，无卡=用户以为没发生）
  const captureViewport = React.useCallback((): boolean => {
    const capture = captureApiRef.current?.captureViewport()
    if (!capture) {
      toast('截图失败，请重试', 'error')
      return false
    }
    onScreenshot(capture)
    return true
  }, [onScreenshot])

  const captureSelectedCamera = React.useCallback((): boolean => {
    if (!selectedCamera) {
      toastPickCameraFirst(stateRef.current.cameras[0], (cameraId) => setSelection({ type: 'camera', id: cameraId }))
      return false
    }
    const captureCamera = cameraWithPlaybackPosition(
      stateRef.current,
      selectedCamera,
      trajectory.playheadRef.current,
      trajectory.activeTrajectoryIds,
    )
    const capture = captureApiRef.current?.captureCamera(captureCamera)
    if (!capture) {
      toast('相机截图失败，请重试', 'error')
      return false
    }
    onScreenshot(capture)
    return true
  }, [onScreenshot, selectedCamera, trajectory.activeTrajectoryIds, trajectory.playheadRef])

  // 出片动作（P0）：面板开关 + 四个导出 handler + 接力 toast + 产物卡片状态（R9 抽到 actions 文件）
  const {
    exportPanelOpen,
    setExportPanelOpen,
    exportCard,
    dismissExportCard,
    handleExportReferenceVideo,
    handleExportScreenshotViewport,
    handleExportScreenshotCamera,
    handleExportKeyFrames,
  } = useScene3DExportActions({
    state,
    stateRef,
    readOnly,
    selectedCamera,
    onRecordTake,
    onPickCamera: (cameraId) => setSelection({ type: 'camera', id: cameraId }),
    captureViewport,
    captureSelectedCamera,
    exportCameraMoveFrames,
  })

  const updateEditorCamera = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    latestEditorCameraRef.current = editorCamera
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

  const handleWheelNavigation = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
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

  const { enterCameraViewEdit, exitCameraViewEdit, toggleCameraViewEdit, levelSelectedCamera } =
    useScene3DCameraViewEdit({
      readOnly,
      selectedCamera,
      cameraViewEditId,
      cameraViewEditCamera,
      stateRef,
      latestEditorCameraRef,
      playheadRef: trajectory.playheadRef,
      activeTrajectoryIds: trajectory.activeTrajectoryIds,
      setSelection,
      setCameraViewEditId,
      setViewLocked,
      setFocusId,
      updateEditorCamera,
      patchCamera,
    })

  const recordPoseResumeRef = React.useRef<() => void>(() => {}) // #4 ref 转发破环 drive↔recorder 初始化先后
  // #A ref 转发（同上一行范本）：退出操控前先收尾录制。takeRecorder 在 characterDrive 之后才创建（它需要
  // characterDrive.possessTarget），只能用 ref 转发破环——drive 退出时调 ref，ref 内容等 takeRecorder 建好后填。
  const stopRecordingBeforeExitRef = React.useRef<() => void>(() => {})
  const characterDrive = useScene3DCharacterDrive({
    objects: state.objects,
    cameras: state.cameras,
    selection,
    readOnly,
    patchObject,
    setSelection,
    setViewLocked,
    setFocusId,
    exitTrajectoryMode,
    enterCameraViewEdit,
    exitCameraViewEdit,
    onLocomotionResume: React.useCallback(() => recordPoseResumeRef.current(), []),
    onBeforeExit: React.useCallback(() => stopRecordingBeforeExitRef.current(), []),
  })

  const handleRecordTake = React.useCallback((recordedState: Scene3DState) => {
    // 停止已即时 toast（useScene3DTakeRecorder）；出片态由画布「录制走位参考」节点徽标接力（#1/#11 同链）。
    onRecordTake?.(recordedState)
    characterDrive.exitPossess()
    characterDrive.exitCameraPossess()
  }, [characterDrive, onRecordTake])

  const takeRecorder = useScene3DTakeRecorder({
    possessTarget: characterDrive.possessTarget,
    readOnly,
    stateRef,
    onRecorded: handleRecordTake,
  })
  recordPoseResumeRef.current = takeRecorder.recordPoseResume
  // #A：stopRecording 内部幂等（ref 守卫，见 useScene3DTakeRecorder），无脑调用即可——非录制态是安全 no-op，
  // 不用在这里判断「现在是否在录」（判断会撞过期闭包，见 stopRecording 注释）。
  stopRecordingBeforeExitRef.current = takeRecorder.stopRecording

  // 点动作库：即时改假人姿势（S1，命中已激活预设会 toggle 成站立）+ 若正在录 take，记一条带时间戳的动作事件
  // （pose-over-time 生产者）。按「实际生效的 presetId」打点（可能是 toggle 后的 'standing'，见 #B），
  // 不是原始点击那个，否则录出来的动作事件和画面显示的姿势对不上。录制器内部 no-op 非录制态，零副作用。
  const handleApplyActionPreset = React.useCallback((presetId: string) => {
    const effectivePresetId = characterDrive.applyActionPreset(presetId)
    takeRecorder.recordPoseEvent(effectivePresetId)
  }, [characterDrive, takeRecorder])
  const {
    selectTrajectoryForMode,
    selectSceneTrajectory,
    selectTrajectoryPointForMode,
    createTrajectoryAtForMode,
    insertTrajectoryPointForMode,
    updateTrajectoryCurveControlForMode,
    assignTrajectoryToGroup,
    bindTargetToTrajectoryForMode,
    requestTrajectoryPlayChange,
  } = useScene3DTrajectoryModeActions({
    trajectory,
    enterTrajectoryMode,
    trajectoryMode,
    readOnly,
    stateRef,
    setState,
    setSelection,
  })

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
    characterDrive.exitPossess()
    characterDrive.exitCameraPossess()
    trajectory.setTrajectoryEditMode(false)
    trajectory.setTimelineOpen(false)
    trajectory.setIsPlaying(false)
    flushLatestState()
    onClose()
  }, [characterDrive, flushLatestState, onClose, trajectory])

  useScene3DKeyboardShortcuts({
    cameraViewEditId,
    selectionRef,
    setTransformMode,
    copySelection,
    pasteClipboard,
    deleteSceneItem,
    exitCameraViewEdit,
    handleClose,
  })

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
      <Scene3DWindowBar />
      <Scene3DFullscreenHeader
        nodeTitle={nodeTitle}
        onOpenExportPanel={() => setExportPanelOpen(true)}
        onReplayCoach={() => {
          resetScene3DCoachSeen()
          setShowCoach(true)
        }}
        onClose={handleClose}
      />

      <main className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--workbench-bg)]">
        <AnimatePresence initial={false}>
          {leftPanelOpen ? (
            <motion.aside
              key="scene-node-panel"
              animate={{ opacity: 1, scale: 1, width: 260, x: 0 }}
              className="relative z-[2] flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] shadow-workbench-pop"
              exit={{ opacity: 0, scale: 0.16, width: 0, x: -26 }}
              initial={{ opacity: 0, scale: 0.16, width: 0, x: -26 }}
              style={{ transformOrigin: 'top left' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {trajectoryMode ? (
                <TrajectoryListPanel
                  trajectories={state.trajectories}
                  groups={state.trajectoryGroups}
                  activeTrajectoryId={trajectory.activeTrajectoryId}
                  readOnly={readOnly}
                  onSelectTrajectory={selectTrajectoryForMode}
                  onAssignTrajectoryToGroup={assignTrajectoryToGroup}
                  onDeleteTrajectory={trajectory.deleteTrajectory}
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
          <FencedCanvas
            fence={<div className="absolute inset-0 grid place-items-center text-caption text-[var(--nomi-ink-60)]">正在初始化 3D 视口…</div>}
            camera={canvasCamera}
            dpr={[1, 2]}
            frameloop={trajectory.isPlaying || takeRecorder.isRecording ? 'always' : 'demand'}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            onCreated={({ camera, gl, invalidate }) => {
              applyEditorCameraPose(camera, initialEditorCameraRef.current)
              attachWebGLContextRecovery(gl.domElement, invalidate)
            }}
            onPointerMissed={clearSelection}
          >
            <SceneContent
              state={state}
              selection={selection}
              readOnly={readOnly}
              transformMode={transformMode}
              flySpeed={flySpeed}
              focusId={focusId}
              viewLocked={viewLocked}
              cameraViewEditCamera={cameraViewEditCamera}
              trajectoryMode={trajectoryMode}
              possessedObject={characterDrive.possessedObject}
              possessedLocomotionClip={characterDrive.locomotionClip}
              cameraPossessId={characterDrive.cameraPossessId}
              onLocomotionChange={characterDrive.setLocomotionClip}
              onPossess={readOnly ? undefined : characterDrive.enterPossess}
              onCameraPossess={readOnly ? undefined : characterDrive.enterCameraPossess}
              onSelect={selectSceneItem}
              onFocus={focusSceneItem}
              onObjectPatch={patchObject}
              onCameraPatch={patchCamera}
              onEditorCameraDraft={handleEditorCameraDraft}
              onEditorCameraCommit={updateEditorCamera}
              onWheelNavigation={handleWheelNavigation}
              onTransformInteractionStart={unlockViewForSceneEdit}
              onTransformInteractionEnd={finishSceneTransformInteraction}
              onFocusConsumed={() => setFocusId('')}
              onKeyboardNavigationStart={startKeyboardNavigation}
              onKeyboardNavigationStop={stopKeyboardNavigation}
              setCaptureApi={(api) => {
                captureApiRef.current = api
              }}
              activeTrajectoryId={trajectory.activeTrajectoryId}
              activePointId={trajectory.activePointId}
              trajectoryBindTargets={trajectory.bindTargets}
              onSelectTrajectory={selectSceneTrajectory}
              onSelectTrajectoryPoint={selectTrajectoryPointForMode}
              onCreateTrajectoryAt={createTrajectoryAtForMode}
              onInsertTrajectoryPoint={insertTrajectoryPointForMode}
              onUpdateTrajectoryCurveControl={updateTrajectoryCurveControlForMode}
              onUpdateTrajectoryPoint={trajectory.updatePoint}
              onTranslateTrajectory={trajectory.translateTrajectory}
              onEditTrajectory={(trajectoryId) => {
                trajectory.selectTrajectory(trajectoryId)
                enterTrajectoryMode()
              }}
              onDeleteTrajectory={trajectory.deleteTrajectory}
              onBindTargetToTrajectory={bindTargetToTrajectoryForMode}
            />
            <Scene3DTrajectoryLayer
              state={state}
              trajectory={trajectory}
              activeTrajectoryIds={trajectory.activeTrajectoryIds}
            />
            <Scene3DTakeSampler
              isRecording={takeRecorder.isRecording}
              possessedObjectId={characterDrive.possessId}
              possessingCamera={Boolean(characterDrive.cameraPossessId)}
              onSampleCharacter={takeRecorder.sampleCharacter}
              onSampleCamera={takeRecorder.sampleCamera}
              onSampleCameraAim={takeRecorder.sampleCameraAim}
            />
          </FencedCanvas>
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
          {trajectory.isPlaying ? (
            <PlaybackCameraMonitor
              state={state}
              activeTrajectoryIds={trajectory.activeTrajectoryIds}
              rightPanelCollapsed={!rightPanelOpen}
            />
          ) : selectedCamera ? (
            <CameraPreview
              camera={selectedCamera}
              state={state}
              activeTrajectoryIds={trajectory.activeTrajectoryIds}
              readOnly={readOnly}
              cameraViewEditing={cameraViewEditId === selectedCamera.id}
              rightPanelCollapsed={!rightPanelOpen}
              onAspectChange={(aspectRatio) => patchCamera(selectedCamera.id, { aspectRatio })}
              onFovChange={(fov) => patchCamera(selectedCamera.id, { fov })}
              onLensDepthChange={(lensDepth) => patchCamera(selectedCamera.id, { lensDepth })}
              onShakeAmplitudeChange={(shakeAmplitude) => patchCamera(selectedCamera.id, { shakeAmplitude })}
              onToggleViewEdit={toggleCameraViewEdit}
              onLevelCamera={levelSelectedCamera}
              onScreenshot={captureSelectedCamera}
            />
          ) : null}
          {!readOnly && state.trajectories.length > 0 && !cameraViewEditCamera ? (
            <Scene3DTrajectoryEditBanner trajectory={trajectory} onEnterEdit={() => enterTrajectoryMode(false)} />
          ) : null}
          {cameraViewEditCamera && !characterDrive.cameraPossessId ? (
            <Scene3DCameraViewBanner cameraName={cameraViewEditCamera.name} onExit={exitCameraViewEdit} />
          ) : null}
          <Scene3DViewportToolPill
            readOnly={readOnly}
            transformMode={transformMode}
            onTransformModeChange={setTransformMode}
            onFitView={() => {
              fitNonceRef.current += 1
              setFocusId(`${SCENE_FIT_FOCUS_ID}:${fitNonceRef.current}`)
            }}
          />
          <Scene3DBottomBar
            readOnly={readOnly}
            possessedObject={characterDrive.possessedObject}
            possessedCamera={characterDrive.possessedCamera}
            activePresetId={characterDrive.activePresetId}
            recorder={onRecordTake ? {
              isRecording: takeRecorder.isRecording,
              elapsedSeconds: takeRecorder.elapsedSeconds,
              onStart: takeRecorder.startRecording,
              onStop: takeRecorder.stopRecording,
            } : undefined}
            onApplyPreset={handleApplyActionPreset}
            onExitPossess={characterDrive.exitPossess}
            onExitCameraPossess={characterDrive.exitCameraPossess}
            speed={{ value: flySpeed, onChange: setFlySpeed }}
            onAddObject={addObject}
            onAddProp={addProp}
            onAddCrowd={addCrowd}
            onAddCamera={addCamera}
            onApplySceneTemplate={applySceneTemplate}
            canvasFocusMode={canvasFocusMode}
            onToggleCanvasFocusMode={toggleCanvasFocusMode}
          />
          <Scene3DTrajectoryTimelineBar trajectory={trajectory} readOnly={readOnly} onRequestPlayChange={requestTrajectoryPlayChange} />
        </div>

        <AnimatePresence initial={false}>
          {rightPanelOpen ? (
            <motion.aside
              key="scene-property-panel"
              animate={{ opacity: 1, scale: 1, width: 300, x: 0 }}
              className="relative z-[2] flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] shadow-workbench-pop"
              exit={{ opacity: 0, scale: 0.16, width: 0, x: 26 }}
              initial={{ opacity: 0, scale: 0.16, width: 0, x: 26 }}
              style={{ transformOrigin: 'top right' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {!readOnly && (characterDrive.possessedObject || characterDrive.possessedCamera || selection?.type === 'camera' || (selection?.type === 'object' && state.objects.find((object) => object.id === selection.id)?.type === 'mannequin')) ? (
                <div className="flex shrink-0 items-center border-b border-[var(--workbench-border)] px-3 py-2">
                  <CharacterPossessButton drive={characterDrive} />
                </div>
              ) : null}
              <Scene3DRightPanelBody
                state={state}
                trajectory={trajectory}
                selection={selection}
                readOnly={readOnly}
                hubTab={moveHubTab}
                onHubTabChange={setMoveHubTab}
                onObjectPatch={patchObject}
                onCameraPatch={patchCamera}
                onEnvironmentPatch={(patch) => setState((current) => ({
                  ...current,
                  environment: { ...current.environment, ...patch },
                }))}
                onApplyCameraMove={applyCameraMove}
                onExportCameraMoveFrames={(cameraId) => { void exportCameraMoveFrames(cameraId) }}
                referenceTarget={referenceTarget}
                onPickCamera={(cameraId) => setSelection({ type: 'camera', id: cameraId })}
                onEnterTrajectoryMode={enterTrajectoryMode}
                canRecordTake={Boolean(onRecordTake) && !readOnly}
                onPossessTarget={(target) => {
                  setSelection(target.kind === 'camera' ? { type: 'camera', id: target.id } : { type: 'object', id: target.id })
                  if (target.kind === 'camera') characterDrive.enterCameraPossess(target.id)
                  else characterDrive.enterPossess(target.id)
                }}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </main>
      {showCoach && !readOnly ? <Scene3DCoachMarks onDone={() => setShowCoach(false)} /> : null}
      {/* P0-4/P3-14：出片产物卡片（渲染中→完成+去向；回画布查看=关编辑器，fit+高亮已排队） */}
      <Scene3DExportingCard card={exportCard} onGoCanvas={handleClose} onDismiss={dismissExportCard} />
      {/* 出片面板（P0-2）：右侧滑出，三选项 */}
      <Scene3DExportPanel
        open={exportPanelOpen}
        onClose={() => setExportPanelOpen(false)}
        state={state}
        onExportReferenceVideo={handleExportReferenceVideo}
        onScreenshotViewport={handleExportScreenshotViewport}
        onScreenshotCamera={handleExportScreenshotCamera}
        onExportKeyFrames={handleExportKeyFrames}
        hasCamera={state.cameras.length > 0}
      />
    </div>
  )

  return typeof document === 'undefined' ? editorShell : createPortal(editorShell, document.body)
}

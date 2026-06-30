import React from 'react'
import { createPortal } from 'react-dom'
import { Canvas } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import {
  IconArrowsMove,
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
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DTransformMode,
} from './scene3dTypes'
import {
  FULLSCREEN_Z_INDEX,
} from './scene3dConstants'
import { PanelButton, CanvasPanelRestoreButton } from './scene3dToolbar'
import {
  cameraLookAtRotation,
  levelEditorCameraRotation,
  applyEditorCameraPose,
  editorCameraFromSceneCamera,
  vectorAlmostEqual,
} from './scene3dMath'
import { SceneObjectList } from './scene3dInspector'
import { TrajectoryListPanel } from './scene3dTrajectoryListPanel'
import { SceneContent } from './scene3dSceneContent'
import { CharacterPossessButton, Scene3DBottomBar } from './scene3dCharacterActionBar'
import { useScene3DCharacterDrive } from './useScene3DCharacterDrive'
import { useScene3DTakeRecorder } from './useScene3DTakeRecorder'
import { Scene3DTakeSampler } from './Scene3DTakeSampler'
import { CameraPreview, PlaybackCameraMonitor } from './scene3dCameraPreview'
import { useScene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'
import {
  Scene3DTrajectoryLayer,
  Scene3DTrajectoryEditBanner,
  Scene3DCameraViewBanner,
  Scene3DRightPanelBody,
  Scene3DTrajectoryTimelineBar,
  type Scene3DRightPanelTab,
} from './scene3dTrajectorySurfaces'
import { removeTrajectoryBindingsForNode } from './scene3dTrajectoryState'
import { cameraWithPlaybackPosition } from './scene3dPlayback'
import {
  useScene3DClipboardActions,
  useScene3DTrajectoryModeActions,
  useScene3DKeyboardShortcuts,
  useScene3DAddActions,
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
}

export default function Scene3DFullscreen({
  initialState,
  nodeTitle,
  readOnly = false,
  onClose,
  onStateChange,
  onScreenshot,
  onRecordTake,
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
  const [rightPanelTab, setRightPanelTab] = React.useState<Scene3DRightPanelTab>('properties')
  const trajectory = useScene3DTrajectoryEditing({ state, setState, readOnly })
  const trajectoryMode = trajectory.trajectoryEditMode
  const enterTrajectoryPanel = React.useCallback(() => {
    setRightPanelOpen(true)
    setRightPanelTab('trajectory')
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
  const toggleTrajectoryMode = React.useCallback(() => {
    if (trajectory.trajectoryEditMode) {
      exitTrajectoryMode()
      return
    }
    enterTrajectoryMode()
  }, [enterTrajectoryMode, exitTrajectoryMode, trajectory.trajectoryEditMode])

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

  const { addObject, addCamera, addCrowd } = useScene3DAddActions({
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
      trajectory.playheadRef.current,
      trajectory.activeTrajectoryIds,
    )
    const capture = captureApiRef.current?.captureCamera(captureCamera)
    if (!capture) {
      toast('相机截图失败，请重试', 'error')
      return
    }
    onScreenshot(capture)
  }, [onScreenshot, selectedCamera, trajectory.activeTrajectoryIds, trajectory.playheadRef])

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
      trajectory.playheadRef.current,
      trajectory.activeTrajectoryIds,
    ))
  }, [cameraViewEditId, enterCameraViewEdit, readOnly, selectedCamera, trajectory.activeTrajectoryIds, trajectory.playheadRef])

  const levelSelectedCamera = React.useCallback(() => {
    if (!selectedCamera || readOnly) return
    const displayCamera = cameraWithPlaybackPosition(
      stateRef.current,
      selectedCamera,
      trajectory.playheadRef.current,
      trajectory.activeTrajectoryIds,
    )
    patchCamera(selectedCamera.id, {
      rotation: cameraLookAtRotation(displayCamera.position, displayCamera.target),
    })
  }, [patchCamera, readOnly, selectedCamera, trajectory.activeTrajectoryIds, trajectory.playheadRef])

  const characterDrive = useScene3DCharacterDrive({
    objects: state.objects,
    selection,
    readOnly,
    patchObject,
    setSelection,
    setViewLocked,
    setFocusId,
    exitTrajectoryMode,
    exitCameraViewEdit,
  })

  const handleRecordTake = React.useCallback((recordedState: Scene3DState) => {
    onRecordTake?.(recordedState)
    characterDrive.exitPossess()
    toast('已录制走位，正在离屏渲染参考视频…', 'success')
  }, [characterDrive, onRecordTake])

  const takeRecorder = useScene3DTakeRecorder({
    possessId: characterDrive.possessId,
    readOnly,
    stateRef,
    onRecorded: handleRecordTake,
  })
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
      <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
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
            <PanelButton title={trajectoryMode ? '退出轨迹模式' : '进入轨迹模式'} active={trajectoryMode} onClick={toggleTrajectoryMode}>
              <IconRoute size={15} />
              <span>轨迹</span>
            </PanelButton>
            <PanelButton
              title={trajectory.isPlaying ? '暂停轨迹播放' : '播放轨迹'}
              active={trajectory.isPlaying}
              onClick={() => requestTrajectoryPlayChange(!trajectory.isPlaying)}
            >
              {trajectory.isPlaying ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />}
            </PanelButton>
          </div>
          {!readOnly ? <CharacterPossessButton drive={characterDrive} /> : null}
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
          <Canvas
            camera={canvasCamera}
            dpr={[1, 2]}
            frameloop={trajectory.isPlaying || trajectory.timelineOpen || takeRecorder.isRecording ? 'always' : 'demand'}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            onCreated={({ camera }) => applyEditorCameraPose(camera, initialEditorCameraRef.current)}
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
              onSampleCharacter={takeRecorder.sampleCharacter}
              onSampleCamera={takeRecorder.sampleCamera}
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
              onLensDepthChange={(lensDepth) => patchCamera(selectedCamera.id, { lensDepth })}
              onToggleViewEdit={toggleCameraViewEdit}
              onLevelCamera={levelSelectedCamera}
              onScreenshot={captureSelectedCamera}
            />
          ) : null}
          {!readOnly && state.trajectories.length > 0 && !cameraViewEditCamera ? (
            <Scene3DTrajectoryEditBanner trajectory={trajectory} onEnterEdit={() => enterTrajectoryMode(false)} />
          ) : null}
          {cameraViewEditCamera ? (
            <Scene3DCameraViewBanner cameraName={cameraViewEditCamera.name} onExit={exitCameraViewEdit} />
          ) : null}
          <div className="pointer-events-none absolute bottom-4 left-4 grid size-20 place-items-center rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-micro text-[var(--nomi-ink-60)] shadow-[var(--nomi-shadow-md)]">
            <div className="grid gap-1">
              <span className="text-[var(--nomi-axis-x)]">X</span>
              <span className="text-[var(--nomi-axis-y)]">Y</span>
              <span className="text-[var(--nomi-axis-z)]">Z</span>
            </div>
          </div>
          <Scene3DBottomBar
            readOnly={readOnly}
            possessedObject={characterDrive.possessedObject}
            activePresetId={characterDrive.activePresetId}
            recorder={onRecordTake ? {
              isRecording: takeRecorder.isRecording,
              elapsedSeconds: takeRecorder.elapsedSeconds,
              onStart: takeRecorder.startRecording,
              onStop: takeRecorder.stopRecording,
            } : undefined}
            onApplyPreset={characterDrive.applyActionPreset}
            onExitPossess={characterDrive.exitPossess}
            onAddObject={addObject}
            onAddCrowd={addCrowd}
            onAddCamera={addCamera}
            trajectoryMode={trajectoryMode}
            onToggleTrajectoryMode={toggleTrajectoryMode}
            canvasFocusMode={canvasFocusMode}
            onToggleCanvasFocusMode={toggleCanvasFocusMode}
          />
          <Scene3DTrajectoryTimelineBar trajectory={trajectory} readOnly={readOnly} />
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
              <Scene3DRightPanelBody
                state={state}
                trajectory={trajectory}
                selection={selection}
                readOnly={readOnly}
                tab={rightPanelTab}
                onTabChange={setRightPanelTab}
                onObjectPatch={patchObject}
                onCameraPatch={patchCamera}
                onEnvironmentPatch={(patch) => setState((current) => ({
                  ...current,
                  environment: { ...current.environment, ...patch },
                }))}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  )

  return typeof document === 'undefined' ? editorShell : createPortal(editorShell, document.body)
}

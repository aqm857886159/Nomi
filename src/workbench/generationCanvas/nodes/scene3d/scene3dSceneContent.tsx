import React from 'react'
import { Grid } from '@react-three/drei'
import { crowdCount, mannequinRoleLabel } from './scene3dMath'
import {
  SCENE3D_GRID_FLAG,
  GRID_CELL_COLOR,
  GRID_SECTION_COLOR,
  DARK_GRID_CELL_COLOR,
  DARK_GRID_SECTION_COLOR,
} from './scene3dConstants'
import { Scene3DEnvironmentLayer } from './scene3dEnvironment'
import type {
  Scene3DState,
  Scene3DCamera,
  Scene3DObject,
  Scene3DVector3,
  Scene3DSelection,
  CaptureApi,
  Scene3DControlMode,
  Scene3DTransformMode,
} from './scene3dTypes'
import type { TrajectoryBindTarget } from './trajectory'
import { SceneObjectView, CameraHelperView } from './scene3dSceneView'
import {
  Scene3DControls,
  InitialCameraPose,
  FocusController,
  CaptureBinder,
  CameraViewEditController,
} from './scene3dViewControllers'
import { CameraStateRecorder } from './CameraStateRecorder'
import { CharacterDriveController } from './scene3dCharacterDriveController'
import { TrajectoryRenderer } from './trajectory'

export function SceneContent({
  state,
  selection,
  readOnly,
  transformMode,
  flySpeed,
  focusId,
  viewLocked,
  cameraViewEditCamera,
  trajectoryMode,
  possessedObject,
  onSelect,
  onFocus,
  onObjectPatch,
  onCameraPatch,
  onEditorCameraDraft,
  onEditorCameraCommit,
  onWheelNavigation,
  onTransformInteractionStart,
  onTransformInteractionEnd,
  onFocusConsumed,
  onKeyboardNavigationStart,
  onKeyboardNavigationStop,
  setCaptureApi,
  activeTrajectoryId,
  activePointId,
  trajectoryBindTargets,
  onSelectTrajectory,
  onSelectTrajectoryPoint,
  onCreateTrajectoryAt,
  onInsertTrajectoryPoint,
  onUpdateTrajectoryCurveControl,
  onUpdateTrajectoryPoint,
  onTranslateTrajectory,
  onEditTrajectory,
  onDeleteTrajectory,
  onBindTargetToTrajectory,
}: {
  state: Scene3DState
  selection: Scene3DSelection
  readOnly: boolean
  transformMode: Scene3DTransformMode
  flySpeed: number
  focusId: string
  viewLocked: boolean
  cameraViewEditCamera?: Scene3DCamera
  trajectoryMode: boolean
  possessedObject?: Scene3DObject
  onSelect: (selection: Scene3DSelection) => void
  onFocus: (id: string) => void
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEditorCameraDraft: (cameraState: Scene3DState['editorCamera']) => void
  onEditorCameraCommit: (cameraState: Scene3DState['editorCamera']) => void
  onWheelNavigation: (cameraState: Scene3DState['editorCamera']) => void
  onTransformInteractionStart: () => void
  onTransformInteractionEnd: () => void
  onFocusConsumed: () => void
  onKeyboardNavigationStart: () => void
  onKeyboardNavigationStop: () => void
  setCaptureApi: (api: CaptureApi | null) => void
  activeTrajectoryId?: string | null
  activePointId?: string | null
  trajectoryBindTargets?: TrajectoryBindTarget[]
  onSelectTrajectory?: (trajectoryId: string) => void
  onSelectTrajectoryPoint?: (trajectoryId: string, pointId: string) => void
  onCreateTrajectoryAt?: (position: Scene3DVector3) => void
  onInsertTrajectoryPoint?: (
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => void
  onUpdateTrajectoryCurveControl?: (
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => void
  onUpdateTrajectoryPoint?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  onTranslateTrajectory?: (trajectoryId: string, delta: Scene3DVector3) => void
  onEditTrajectory?: (trajectoryId: string) => void
  onDeleteTrajectory?: (trajectoryId: string) => void
  onBindTargetToTrajectory?: (trajectoryId: string, targetId: string, pointId?: string | null) => void
}): JSX.Element {
  const freeLook = !viewLocked
  const controlMode: Scene3DControlMode = freeLook ? 'fly' : 'edit'
  const cameraViewEditing = Boolean(cameraViewEditCamera)
  const navigationLockedRef = React.useRef(false)
  const mannequinRoleData = React.useMemo(() => {
    const labels = new Map<string, string>()
    const starts = new Map<string, number>()
    let index = 0
    state.objects.forEach((object) => {
      if (object.type === 'mannequin') {
        labels.set(object.id, mannequinRoleLabel(index))
        starts.set(object.id, index)
        index += 1
        return
      }
      if (object.type === 'mannequinCrowd') {
        starts.set(object.id, index)
        index += crowdCount(object)
      }
    })
    return { labels, starts }
  }, [state.objects])
  const gridCellColor = state.environment.darkMode ? DARK_GRID_CELL_COLOR : GRID_CELL_COLOR
  const gridSectionColor = state.environment.darkMode ? DARK_GRID_SECTION_COLOR : GRID_SECTION_COLOR

  return (
    <>
      <Scene3DEnvironmentLayer environment={state.environment} />
      {state.environment.showGrid && !cameraViewEditing ? (
        <group userData={{ [SCENE3D_GRID_FLAG]: true }}>
          <Grid
            infiniteGrid
            cellSize={0.5}
            sectionSize={5}
            fadeDistance={42}
            fadeStrength={1.25}
            cellColor={gridCellColor}
            sectionColor={gridSectionColor}
          />
        </group>
      ) : null}
      {state.environment.showAxes && !cameraViewEditing ? <axesHelper args={[2]} /> : null}
      {(trajectoryMode || state.trajectories.length > 0) && !cameraViewEditing ? (
        <TrajectoryRenderer
          trajectories={state.trajectories}
          activeTrajectoryId={activeTrajectoryId}
          activePointId={trajectoryMode ? activePointId : null}
          editable={trajectoryMode && !readOnly}
          wholeDraggable={!trajectoryMode && !readOnly}
          bindTargets={trajectoryBindTargets}
          onSelectTrajectory={onSelectTrajectory}
          onSelectPoint={onSelectTrajectoryPoint}
          onCreateTrajectoryAt={onCreateTrajectoryAt}
          onInsertPoint={onInsertTrajectoryPoint}
          onUpdateCurveControl={onUpdateTrajectoryCurveControl}
          onUpdatePoint={onUpdateTrajectoryPoint}
          onTranslateTrajectory={onTranslateTrajectory}
          onEditTrajectory={onEditTrajectory}
          onDeleteTrajectory={onDeleteTrajectory}
          onBindTargetToTrajectory={onBindTargetToTrajectory}
        />
      ) : null}
      {state.objects.map((object) => (
        <SceneObjectView
          key={object.id}
          object={object}
          selected={selection?.type === 'object' && selection.id === object.id}
          readOnly={readOnly || trajectoryMode || possessedObject?.id === object.id}
          interactionDisabled={trajectoryMode}
          transformMode={transformMode}
          orbitControlsActive={!freeLook}
          navigationLockedRef={navigationLockedRef}
          roleLabel={object.type === 'mannequin' ? mannequinRoleData.labels.get(object.id) : undefined}
          roleStartIndex={mannequinRoleData.starts.get(object.id)}
          onSelect={() => onSelect({ type: 'object', id: object.id })}
          onFocus={() => onFocus(object.id)}
          onTransformStart={onTransformInteractionStart}
          onTransformEnd={onTransformInteractionEnd}
          onTransform={(patch) => onObjectPatch(object.id, patch)}
        />
      ))}
      {!cameraViewEditing ? state.cameras.map((camera) => (
        <CameraHelperView
          key={camera.id}
          cameraData={camera}
          selected={selection?.type === 'camera' && selection.id === camera.id}
          readOnly={readOnly}
          positionLocked={trajectoryMode}
          orbitControlsActive={!freeLook}
          navigationLockedRef={navigationLockedRef}
          onSelect={() => onSelect({ type: 'camera', id: camera.id })}
          onFocus={() => onFocus(camera.id)}
          onTransformStart={onTransformInteractionStart}
          onTransformEnd={onTransformInteractionEnd}
          onTransform={(patch) => onCameraPatch(camera.id, patch)}
        />
      )) : null}
      <InitialCameraPose editorCamera={state.editorCamera} />
      <CameraViewEditController
        cameraData={cameraViewEditCamera}
        onCameraPatch={onCameraPatch}
        onEditorCameraDraft={onEditorCameraDraft}
      />
      <FocusController
        focusId={focusId}
        objects={state.objects}
        cameras={state.cameras}
        onCameraChange={onEditorCameraCommit}
        onFocusConsumed={onFocusConsumed}
      />
      <Scene3DControls
        freeLook={freeLook}
        selectionActive={selection !== null}
        speed={flySpeed}
        target={state.editorCamera.target}
        keyboardDisabled={Boolean(possessedObject)}
        navigationLockedRef={navigationLockedRef}
        onClearSelection={() => onSelect(null)}
        onWheelNavigation={onWheelNavigation}
        onKeyboardNavigationStart={onKeyboardNavigationStart}
        onKeyboardNavigationStop={onKeyboardNavigationStop}
      />
      <CameraStateRecorder
        mode={controlMode}
        target={state.editorCamera.target}
        onDraftChange={onEditorCameraDraft}
        onCommit={onEditorCameraCommit}
      />
      {possessedObject ? (
        <CharacterDriveController
          possessedObject={possessedObject}
          onObjectPatch={onObjectPatch}
        />
      ) : null}
      <CaptureBinder cameras={state.cameras} setApi={setCaptureApi} />
    </>
  )
}

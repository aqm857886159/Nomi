import {
  makeTrajectory,
  makeTrajectoryBinding,
  makeTrajectoryGroup,
  makeTrajectoryPoint,
  trajectoryInsertTimeRatio,
} from './scene3dFactories'
import type {
  Scene3DState,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DTrajectoryBoundObject,
  Scene3DTrajectoryPoint,
  Scene3DVector3,
} from './scene3dTypes'
import { setScene3DObjectRuntimeRefsVisible } from './trajectory/trajectoryRuntimeStore'
import type { TrajectoryBindTarget } from './trajectory/trajectoryRendererShared'

const DEFAULT_TRAJECTORY_STEP = 1.6
const DEFAULT_TRAJECTORY_SWAY = 0.6
const TRAJECTORY_EPSILON = 0.0001

function roundSceneValue(value: number): number {
  return Number(value.toFixed(4))
}

function clampOffsetRatio(value: number): number {
  return Math.min(0.999, Math.max(-0.999, value))
}

function restoreBindingObjectsVisible(binding: Scene3DTrajectoryBinding): void {
  binding.objects.forEach((object) => {
    setScene3DObjectRuntimeRefsVisible(object.objectId, true)
  })
}

function nextTrajectoryPointPosition(trajectory: Scene3DTrajectory): Scene3DVector3 {
  const pointCount = trajectory.points.length
  if (pointCount <= 0) return [0, 0, 0]

  const lastPoint = trajectory.points[pointCount - 1]?.position ?? [0, 0, 0]
  if (pointCount === 1) {
    return [
      roundSceneValue(lastPoint[0] + DEFAULT_TRAJECTORY_STEP),
      lastPoint[1],
      roundSceneValue(lastPoint[2] + DEFAULT_TRAJECTORY_SWAY),
    ]
  }

  const previousPoint = trajectory.points[pointCount - 2]?.position ?? lastPoint
  const deltaX = lastPoint[0] - previousPoint[0]
  const deltaZ = lastPoint[2] - previousPoint[2]
  if (Math.abs(deltaX) <= TRAJECTORY_EPSILON && Math.abs(deltaZ) <= TRAJECTORY_EPSILON) {
    return [
      roundSceneValue(lastPoint[0] + DEFAULT_TRAJECTORY_STEP),
      lastPoint[1],
      roundSceneValue(lastPoint[2] + DEFAULT_TRAJECTORY_SWAY),
    ]
  }

  return [
    roundSceneValue(lastPoint[0] + deltaX),
    lastPoint[1],
    roundSceneValue(lastPoint[2] + deltaZ),
  ]
}

export function createTrajectoryAt(position: Scene3DVector3, index: number): Scene3DTrajectory {
  const trajectory = makeTrajectory(index)
  const nextPoint: Scene3DVector3 = [
    roundSceneValue(position[0] + DEFAULT_TRAJECTORY_STEP),
    position[1],
    roundSceneValue(position[2] + DEFAULT_TRAJECTORY_SWAY),
  ]
  trajectory.points = [
    makeTrajectoryPoint(position, 0),
    makeTrajectoryPoint(nextPoint, 1),
  ]
  return trajectory
}

export function appendTrajectoryPoint(trajectory: Scene3DTrajectory, afterPointId?: string | null): {
  trajectory: Scene3DTrajectory
  pointId: string
} {
  const sourceIndex = afterPointId
    ? trajectory.points.findIndex((point) => point.id === afterPointId)
    : -1
  const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : trajectory.points.length
  const nextPosition = sourceIndex >= 0
    ? (() => {
        const source = trajectory.points[sourceIndex]?.position ?? [0, 0, 0]
        const previous = trajectory.points[sourceIndex - 1]?.position ?? [
          source[0] - DEFAULT_TRAJECTORY_STEP,
          source[1],
          source[2] - DEFAULT_TRAJECTORY_SWAY,
        ]
        const deltaX = source[0] - previous[0]
        const deltaZ = source[2] - previous[2]
        return [
          roundSceneValue(source[0] + (Math.abs(deltaX) <= TRAJECTORY_EPSILON ? DEFAULT_TRAJECTORY_STEP : deltaX)),
          source[1],
          roundSceneValue(source[2] + (Math.abs(deltaZ) <= TRAJECTORY_EPSILON ? DEFAULT_TRAJECTORY_SWAY : deltaZ)),
        ] satisfies Scene3DVector3
      })()
    : nextTrajectoryPointPosition(trajectory)
  const nextPoint = makeTrajectoryPoint(nextPosition, trajectoryInsertTimeRatio(trajectory, insertIndex))
  const nextPoints = [...trajectory.points]
  nextPoints.splice(insertIndex, 0, nextPoint)
  return {
    pointId: nextPoint.id,
    trajectory: {
      ...trajectory,
      points: nextPoints,
    },
  }
}

export function insertTrajectoryPoint(
  trajectory: Scene3DTrajectory,
  position: Scene3DVector3,
  insertIndex: number,
): {
  trajectory: Scene3DTrajectory
  pointId: string
} {
  const nextIndex = Math.max(0, Math.min(insertIndex, trajectory.points.length))
  const point = makeTrajectoryPoint(position, trajectoryInsertTimeRatio(trajectory, nextIndex))
  const points = [...trajectory.points]
  points.splice(nextIndex, 0, point)
  return {
    pointId: point.id,
    trajectory: {
      ...trajectory,
      points,
    },
  }
}

export function patchTrajectoryPoint(
  trajectory: Scene3DTrajectory,
  pointId: string,
  patch: Partial<Scene3DTrajectoryPoint>,
): Scene3DTrajectory {
  return {
    ...trajectory,
    points: trajectory.points.map((point) => (point.id === pointId ? { ...point, ...patch } : point)),
  }
}

export function removeTrajectoryPoint(trajectory: Scene3DTrajectory, pointId: string): Scene3DTrajectory {
  if (trajectory.points.length <= 2) return trajectory
  return {
    ...trajectory,
    points: trajectory.points.filter((point) => point.id !== pointId),
    curveControls: trajectory.curveControls?.filter((control) => control.segmentStartPointId !== pointId) ?? [],
  }
}

export function patchTrajectoryCurveControl(
  trajectory: Scene3DTrajectory,
  segmentStartPointId: string,
  position: Scene3DVector3 | null,
): Scene3DTrajectory {
  const controls = trajectory.curveControls ? [...trajectory.curveControls] : []
  const currentIndex = controls.findIndex((control) => control.segmentStartPointId === segmentStartPointId)

  if (!position) {
    if (currentIndex < 0) return trajectory
    controls.splice(currentIndex, 1)
    return {
      ...trajectory,
      curveControls: controls,
    }
  }

  if (currentIndex >= 0) {
    controls[currentIndex] = { segmentStartPointId, position }
  } else {
    controls.push({ segmentStartPointId, position })
  }

  return {
    ...trajectory,
    curveControls: controls,
  }
}

export function translateTrajectory(
  trajectory: Scene3DTrajectory,
  delta: Scene3DVector3,
): Scene3DTrajectory {
  if (Math.abs(delta[0]) <= TRAJECTORY_EPSILON && Math.abs(delta[2]) <= TRAJECTORY_EPSILON) return trajectory

  return {
    ...trajectory,
    points: trajectory.points.map((point) => ({
      ...point,
      position: [
        roundSceneValue(point.position[0] + delta[0]),
        point.position[1],
        roundSceneValue(point.position[2] + delta[2]),
      ],
    })),
    curveControls: trajectory.curveControls?.map((control) => ({
      ...control,
      position: [
        roundSceneValue(control.position[0] + delta[0]),
        control.position[1],
        roundSceneValue(control.position[2] + delta[2]),
      ],
    })) ?? [],
  }
}

export function bindNodeToTrajectoryState(
  state: Scene3DState,
  trajectoryId: string,
  objectId: string,
  offsetRatio = 0,
): Scene3DState {
  if (state.trajectoryBindings.some((binding) => binding.objects.some((object) => object.objectId === objectId))) {
    return state
  }

  const bindingIndex = state.trajectoryBindings.findIndex((binding) => binding.trajectoryId === trajectoryId)
  if (bindingIndex < 0) {
    const binding = makeTrajectoryBinding(trajectoryId, objectId)
    binding.objects = binding.objects.map((object) => ({
      ...object,
      offsetRatio: clampOffsetRatio(offsetRatio),
    }))
    return {
      ...state,
      trajectoryBindings: [...state.trajectoryBindings, binding],
      sceneTimeline: binding.endTime > state.sceneTimeline.totalDuration
        ? { ...state.sceneTimeline, totalDuration: binding.endTime }
        : state.sceneTimeline,
    }
  }

  const nextBindings = [...state.trajectoryBindings]
  const currentBinding = nextBindings[bindingIndex]
  nextBindings[bindingIndex] = {
    ...currentBinding,
    objects: [...currentBinding.objects, { objectId, offsetRatio: clampOffsetRatio(offsetRatio) }],
  }
  return {
    ...state,
    trajectoryBindings: nextBindings,
  }
}

export function patchTrajectoryBindingState(
  state: Scene3DState,
  bindingId: string,
  patch: Partial<Scene3DTrajectoryBinding>,
): Scene3DState {
  let nextMaxEndTime = state.sceneTimeline.totalDuration
  return {
    ...state,
    trajectoryBindings: state.trajectoryBindings.map((binding) => {
      if (binding.id !== bindingId) return binding
      const nextBinding = { ...binding, ...patch }
      const startTime = Math.max(0, Number.isFinite(nextBinding.startTime) ? nextBinding.startTime : binding.startTime)
      const endTime = Math.max(
        startTime + 0.001,
        Number.isFinite(nextBinding.endTime) ? nextBinding.endTime : binding.endTime,
      )
      nextMaxEndTime = Math.max(nextMaxEndTime, endTime)
      return {
        ...nextBinding,
        startTime,
        endTime,
      }
    }),
    sceneTimeline: nextMaxEndTime === state.sceneTimeline.totalDuration
      ? state.sceneTimeline
      : { ...state.sceneTimeline, totalDuration: nextMaxEndTime },
  }
}

export function patchTrajectoryBoundObjectState(
  state: Scene3DState,
  bindingId: string,
  objectId: string,
  patch: Partial<Scene3DTrajectoryBoundObject>,
): Scene3DState {
  return {
    ...state,
    trajectoryBindings: state.trajectoryBindings.map((binding) => {
      if (binding.id !== bindingId) return binding
      return {
        ...binding,
        objects: binding.objects.map((object) => (
          object.objectId === objectId
            ? { ...object, ...patch, offsetRatio: clampOffsetRatio(patch.offsetRatio ?? object.offsetRatio) }
            : object
        )),
      }
    }),
  }
}

export function removeTrajectoryBoundObjectState(
  state: Scene3DState,
  bindingId: string,
  objectId: string,
): Scene3DState {
  let changed = false
  const trajectoryBindings = state.trajectoryBindings.flatMap((binding) => {
    if (binding.id !== bindingId) return [binding]
    const hadObject = binding.objects.some((object) => object.objectId === objectId)
    if (!hadObject) return [binding]
    changed = true
    setScene3DObjectRuntimeRefsVisible(objectId, true)
    const objects = binding.objects.filter((object) => object.objectId !== objectId)
    return objects.length > 0 ? [{ ...binding, objects }] : []
  })

  if (!changed) return state
  return {
    ...state,
    trajectoryBindings,
  }
}

export function removeTrajectoryBindingState(state: Scene3DState, bindingId: string): Scene3DState {
  const binding = state.trajectoryBindings.find((candidate) => candidate.id === bindingId)
  if (!binding) return state
  restoreBindingObjectsVisible(binding)
  return {
    ...state,
    trajectoryBindings: state.trajectoryBindings.filter((binding) => binding.id !== bindingId),
  }
}

export function removeTrajectoryState(state: Scene3DState, trajectoryId: string): Scene3DState {
  state.trajectoryBindings
    .filter((binding) => binding.trajectoryId === trajectoryId)
    .forEach(restoreBindingObjectsVisible)
  return {
    ...state,
    trajectories: state.trajectories.filter((trajectory) => trajectory.id !== trajectoryId),
    trajectoryBindings: state.trajectoryBindings.filter((binding) => binding.trajectoryId !== trajectoryId),
    trajectoryGroups: state.trajectoryGroups.map((group) => ({
      ...group,
      trajectoryIds: group.trajectoryIds.filter((candidateId) => candidateId !== trajectoryId),
    })),
  }
}

export function removeTrajectoryBindingsForNode(state: Scene3DState, objectId: string): Scene3DState {
  let changed = false
  const trajectoryBindings = state.trajectoryBindings.flatMap((binding) => {
    const hadObject = binding.objects.some((object) => object.objectId === objectId)
    if (!hadObject) return [binding]
    changed = true
    setScene3DObjectRuntimeRefsVisible(objectId, true)
    const objects = binding.objects.filter((object) => object.objectId !== objectId)
    return objects.length > 0 ? [{ ...binding, objects }] : []
  })

  if (!changed) return state
  return {
    ...state,
    trajectoryBindings,
  }
}

export function addTrajectoryGroupState(state: Scene3DState): {
  state: Scene3DState
  groupId: string
} {
  const group = makeTrajectoryGroup(state.trajectoryGroups.length)
  return {
    groupId: group.id,
    state: {
      ...state,
      trajectoryGroups: [...state.trajectoryGroups, group],
    },
  }
}

export function renameTrajectoryGroupState(
  state: Scene3DState,
  groupId: string,
  name: string,
): Scene3DState {
  const nextName = name.trim()
  if (!nextName) return state
  return {
    ...state,
    trajectoryGroups: state.trajectoryGroups.map((group) => (
      group.id === groupId ? { ...group, name: nextName } : group
    )),
  }
}

export function trajectoryBindTargetsFromState(state: Scene3DState): TrajectoryBindTarget[] {
  const boundObjectIds = new Set(
    state.trajectoryBindings.flatMap((binding) => binding.objects.map((object) => object.objectId)),
  )
  return [
    ...state.objects
      .filter((object) => (
        (object.type === 'mannequin' || object.type === 'mannequinCrowd') &&
        !boundObjectIds.has(object.id)
      ))
      .map((object) => ({
        id: object.id,
        name: object.name,
        type: 'mannequin' as const,
      })),
    ...state.cameras
      .filter((camera) => !boundObjectIds.has(camera.id))
      .map((camera) => ({
        id: camera.id,
        name: camera.name,
        type: 'camera' as const,
      })),
  ]
}

import * as THREE from 'three'
import {
  type Scene3DCamera,
  type Scene3DObject,
  type Scene3DState,
  type Scene3DTrajectory,
  type Scene3DTrajectoryBinding,
  type Scene3DVector3,
} from './scene3dTypes'
import { CAMERA_DEFAULT_TARGET, UNGROUPED_TRAJECTORY_GROUP_ID } from './scene3dConstants'
import { buildTrajectoryCurve, clampRatio, remapTrajectoryTimeRatio, wrapRatio } from './trajectory/trajectoryUtils'
import { cameraLookAtRotation, eulerToArray, vectorToArray } from './scene3dMath'
import { objectVisualHalfHeight } from './scene3dCrowd'

export function trajectoryIdsForPlaybackGroup(state: Scene3DState, groupId: string | null): Set<string> | null {
  if (!groupId) return null
  const group = state.trajectoryGroups.find((candidate) => candidate.id === groupId)
  if (group) return new Set(group.trajectoryIds)
  if (groupId !== UNGROUPED_TRAJECTORY_GROUP_ID) return null

  const groupedIds = new Set<string>()
  state.trajectoryGroups.forEach((candidate) => {
    candidate.trajectoryIds.forEach((trajectoryId) => groupedIds.add(trajectoryId))
  })
  return new Set(
    state.trajectories
      .filter((trajectory) => !groupedIds.has(trajectory.id))
      .map((trajectory) => trajectory.id),
  )
}

export function hasPlayableTrajectoryBinding(state: Scene3DState, activeTrajectoryIds: ReadonlySet<string> | null): boolean {
  return state.trajectoryBindings.some((binding) => (
    binding.objects.length > 0 &&
    (!activeTrajectoryIds || activeTrajectoryIds.has(binding.trajectoryId))
  ))
}

export type Scene3DPlaybackSample = {
  position: THREE.Vector3
  tangent: THREE.Vector3 | null
  visible: boolean
}

export function sceneObjectTrajectorySample(
  state: Pick<Scene3DState, 'trajectories' | 'trajectoryBindings'>,
  objectId: string,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DPlaybackSample | null {
  const binding = state.trajectoryBindings.find((candidate) => (
    (!activeTrajectoryIds || activeTrajectoryIds.has(candidate.trajectoryId)) &&
    candidate.objects.some((boundObject) => boundObject.objectId === objectId)
  ))
  if (!binding) return null
  const boundObject = binding.objects.find((candidate) => candidate.objectId === objectId)
  const trajectory = state.trajectories.find((candidate) => candidate.id === binding.trajectoryId)
  if (!boundObject || !trajectory) return null
  const curve = buildTrajectoryCurve(trajectory)
  if (!curve) return null
  const duration = binding.endTime - binding.startTime
  if (duration <= 0) return null

  const visible = !(trajectory.closed && playheadSeconds < binding.startTime)
  const raw = (playheadSeconds - binding.startTime) / duration
  let tBase = trajectory.closed ? wrapRatio(raw) : clampRatio(raw)
  if (binding.direction === 'reverse') tBase = 1 - tBase
  const effectiveOffset = binding.direction === 'reverse'
    ? -boundObject.offsetRatio
    : boundObject.offsetRatio
  const t = trajectory.closed
    ? remapTrajectoryTimeRatio(trajectory, wrapRatio(tBase + effectiveOffset))
    : remapTrajectoryTimeRatio(trajectory, clampRatio(tBase + effectiveOffset))
  const tangent = curve.getTangentAt(t)
  return {
    position: curve.getPointAt(t),
    tangent: tangent.lengthSq() >= 1e-10 ? tangent.normalize() : null,
    visible,
  }
}

export function sceneObjectCameraTargetPosition(
  state: Pick<Scene3DState, 'objects' | 'trajectories' | 'trajectoryBindings'>,
  objectId: string | undefined,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DVector3 | null {
  if (!objectId) return null
  const object = state.objects.find((candidate) => candidate.id === objectId)
  if (!object) return null
  const sample = sceneObjectTrajectorySample(state, object.id, playheadSeconds, activeTrajectoryIds)
  if (sample) {
    return vectorToArray(sample.position.clone().add(new THREE.Vector3(0, objectVisualHalfHeight(object), 0)))
  }
  return [...object.position]
}

export function cameraWithPlaybackPosition(
  state: Pick<Scene3DState, 'objects' | 'trajectories' | 'trajectoryBindings'>,
  camera: Scene3DCamera,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DCamera {
  const sample = sceneObjectTrajectorySample(state, camera.id, playheadSeconds, activeTrajectoryIds)
  const position = sample ? vectorToArray(sample.position) : camera.position
  const target = sceneObjectCameraTargetPosition(state, camera.followTargetId, playheadSeconds, activeTrajectoryIds)
    ?? camera.target
    ?? CAMERA_DEFAULT_TARGET
  return {
    ...camera,
    position,
    target,
    rotation: cameraLookAtRotation(position, target),
  }
}

export type Scene3DPlaybackCamera = {
  camera: Scene3DCamera
  binding: Scene3DTrajectoryBinding
  trajectory: Scene3DTrajectory
}

export function playbackCameraAtPlayhead(
  state: Scene3DState,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DPlaybackCamera | null {
  const cameraById = new Map(state.cameras.map((camera) => [camera.id, camera]))
  const trajectoryById = new Map(state.trajectories.map((trajectory) => [trajectory.id, trajectory]))
  let activeCamera: Scene3DPlaybackCamera | null = null

  state.trajectoryBindings.forEach((binding) => {
    if (activeTrajectoryIds && !activeTrajectoryIds.has(binding.trajectoryId)) return
    if (playheadSeconds < binding.startTime || playheadSeconds > binding.endTime) return
    const trajectory = trajectoryById.get(binding.trajectoryId)
    if (!trajectory) return
    const camera = binding.objects.flatMap((boundObject) => {
      const candidate = cameraById.get(boundObject.objectId)
      return candidate ? [candidate] : []
    })[0]
    if (!camera) return
    if (
      !activeCamera ||
      binding.startTime > activeCamera.binding.startTime ||
      (binding.startTime === activeCamera.binding.startTime && binding.endTime < activeCamera.binding.endTime)
    ) {
      activeCamera = { camera, binding, trajectory }
    }
  })

  return activeCamera
}

export function objectWithPlaybackPose(
  state: Pick<Scene3DState, 'trajectories' | 'trajectoryBindings'>,
  object: Scene3DObject,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DObject {
  const sample = sceneObjectTrajectorySample(state, object.id, playheadSeconds, activeTrajectoryIds)
  if (!sample) return object
  const position = sample.position.clone().add(new THREE.Vector3(0, objectVisualHalfHeight(object), 0))
  const nextObject = {
    ...object,
    visible: object.visible && sample.visible,
    position: vectorToArray(position),
  }
  if (!sample.tangent) return nextObject
  const rotationHelper = new THREE.Object3D()
  rotationHelper.position.copy(position)
  rotationHelper.lookAt(position.clone().add(sample.tangent))
  return {
    ...nextObject,
    rotation: eulerToArray(rotationHelper.rotation),
  }
}

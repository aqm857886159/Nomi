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
import { samplePoseKeyframe } from './scene3dPoseTrack'

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

export function findObjectTrajectoryBinding(
  state: Pick<Scene3DState, 'trajectoryBindings'>,
  objectId: string,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DTrajectoryBinding | null {
  return state.trajectoryBindings.find((candidate) => (
    (!activeTrajectoryIds || activeTrajectoryIds.has(candidate.trajectoryId)) &&
    candidate.objects.some((boundObject) => boundObject.objectId === objectId)
  )) ?? null
}

export function sceneObjectTrajectorySample(
  state: Pick<Scene3DState, 'trajectories' | 'trajectoryBindings'>,
  objectId: string,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DPlaybackSample | null {
  const binding = findObjectTrajectoryBinding(state, objectId, activeTrajectoryIds)
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

// 相机运镜 take 的「瞄准轨迹」绑定 id 约定：相机 id + 此后缀。aim 轨迹用与相机轨迹同一套
// sceneObjectTrajectorySample 采样（按这个合成 id 在 trajectoryBindings 里找），不引第二套采样机制。
export const CAMERA_AIM_BINDING_SUFFIX = ':aim'

export function cameraAimBindingId(cameraId: string): string {
  return `${cameraId}${CAMERA_AIM_BINDING_SUFFIX}`
}

// ── 手持抖动：确定性多频正弦噪声。纯播放头 t 的函数、无随机源——预览逐帧与离屏采帧
// （Scene3DTrajectoryCapture 同走本文件）必须严格一致，mp4 才可重现。──
const SHAKE_MAX_AIM_RAD = 0.028 // 满幅 ±1.6° 注视点摆动（手持感主要来自转动微晃）
const SHAKE_MAX_OFFSET = 0.035 // 满幅 ±3.5cm 机位平移

function shakeNoise(t: number, phase: number): number {
  return (
    0.5 * Math.sin(t * 2 * Math.PI * 0.9 + phase) +
    0.3 * Math.sin(t * 2 * Math.PI * 2.3 + phase * 1.7) +
    0.2 * Math.sin(t * 2 * Math.PI * 4.7 + phase * 2.9)
  )
}

function withCameraShake(
  position: Scene3DVector3,
  target: Scene3DVector3,
  amplitude: number,
  playheadSeconds: number,
): { position: Scene3DVector3; target: Scene3DVector3 } {
  const ratio = Math.min(100, Math.max(0, amplitude)) / 100
  if (ratio <= 0) return { position, target }
  const positionVector = new THREE.Vector3(...position)
  const targetVector = new THREE.Vector3(...target)
  const forward = targetVector.clone().sub(positionVector)
  const distance = forward.length()
  if (distance < 0.001) return { position, target }
  forward.normalize()
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0))
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
  right.normalize()
  const up = right.clone().cross(forward).normalize()

  const t = playheadSeconds
  const positionJitter = right.clone().multiplyScalar(shakeNoise(t, 0.7) * SHAKE_MAX_OFFSET * ratio)
    .addScaledVector(up, shakeNoise(t, 2.1) * SHAKE_MAX_OFFSET * ratio)
  const aimJitter = right.clone().multiplyScalar(shakeNoise(t, 4.2) * SHAKE_MAX_AIM_RAD * distance * ratio)
    .addScaledVector(up, shakeNoise(t, 5.6) * SHAKE_MAX_AIM_RAD * distance * ratio)
  return {
    position: vectorToArray(positionVector.add(positionJitter)),
    target: vectorToArray(targetVector.add(aimJitter)),
  }
}

// binding 上的 FOV 渐变：按段时间进度线性插值（fovFrom 始终对应 startTime，与 direction/offset 无关）。
// 两端点任一缺省 → 用相机静态 fov 补位；都缺省 → 返回 null（老行为，完全不碰 fov）。
export function bindingFovAtPlayhead(
  binding: Scene3DTrajectoryBinding,
  cameraFov: number,
  playheadSeconds: number,
): number | null {
  if (binding.fovFrom === undefined && binding.fovTo === undefined) return null
  const from = binding.fovFrom ?? cameraFov
  const to = binding.fovTo ?? cameraFov
  const duration = binding.endTime - binding.startTime
  const t = duration > 0 ? clampRatio((playheadSeconds - binding.startTime) / duration) : 1
  return from + (to - from) * t
}

export function cameraWithPlaybackPosition(
  state: Pick<Scene3DState, 'objects' | 'trajectories' | 'trajectoryBindings'>,
  camera: Scene3DCamera,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DCamera {
  const binding = findObjectTrajectoryBinding(state, camera.id, activeTrajectoryIds)
  const sample = sceneObjectTrajectorySample(state, camera.id, playheadSeconds, activeTrajectoryIds)
  const position = sample ? vectorToArray(sample.position) : camera.position
  const playbackFov = binding ? bindingFovAtPlayhead(binding, camera.fov, playheadSeconds) : null
  // 注视点优先级：① aim 轨迹（相机运镜 take 录下的逐帧朝向，free-look 转头忠实还原）
  //  → ② follow 某物体（角色走位 take，相机跟拍主体）→ ③ 静态 target（老行为）。三者互斥单源。
  const aimSample = camera.aimTrajectoryId
    ? sceneObjectTrajectorySample(state, cameraAimBindingId(camera.id), playheadSeconds, activeTrajectoryIds)
    : null
  const target = aimSample
    ? vectorToArray(aimSample.position)
    : sceneObjectCameraTargetPosition(state, camera.followTargetId, playheadSeconds, activeTrajectoryIds)
      ?? camera.target
      ?? CAMERA_DEFAULT_TARGET
  const shaken = withCameraShake(position, target, camera.shakeAmplitude ?? 0, playheadSeconds)
  return {
    ...camera,
    position: shaken.position,
    target: shaken.target,
    rotation: cameraLookAtRotation(shaken.position, shaken.target),
    fov: playbackFov ?? camera.fov,
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

// 时刻 t 该对象生效的 pose-over-time 姿势。无 poseTrack / t 早于首帧 → 落回静态 object.pose（老行为）。
// 与轨迹采样独立：站着原地切动作（无轨迹绑定）也要随时间变 pose。
function objectPoseAtPlayhead(object: Scene3DObject, playheadSeconds: number): Scene3DObject {
  if (!object.poseTrack || object.poseTrack.length === 0) return object
  const keyframe = samplePoseKeyframe(object.poseTrack, playheadSeconds)
  if (!keyframe) return object
  return { ...object, pose: keyframe.pose }
}

export function objectWithPlaybackPose(
  state: Pick<Scene3DState, 'trajectories' | 'trajectoryBindings'>,
  object: Scene3DObject,
  playheadSeconds: number,
  activeTrajectoryIds: ReadonlySet<string> | null = null,
): Scene3DObject {
  const posed = objectPoseAtPlayhead(object, playheadSeconds)
  const sample = sceneObjectTrajectorySample(state, object.id, playheadSeconds, activeTrajectoryIds)
  if (!sample) return posed
  const position = sample.position.clone().add(new THREE.Vector3(0, objectVisualHalfHeight(object), 0))
  const nextObject = {
    ...posed,
    visible: posed.visible && sample.visible,
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

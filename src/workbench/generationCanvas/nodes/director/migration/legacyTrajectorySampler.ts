/**
 * [INPUT]: 依赖 three（CatmullRomCurve3 / QuadraticBezierCurve3 / CurvePath）、./legacyScene3dTypes
 * [OUTPUT]: 对外提供 LegacyTrajectorySampler（按 V1 语义在时刻 t 采样物体位置 / 切线、相机位置 / 注视点 / fov）
 * [POS]: director/migration 的 V1 轨迹求值化石：V1 用 Catmull-Rom（张力、闭合、二次贝塞尔控制点）+ 路标 timeRatio 重映射 +
 *        绑定 [start,end] / 方向 / 相位偏移；相机注视点 = aim 轨迹 > 跟随目标 > 静态 target，fov 沿绑定线性渐变。
 *        迁移器把它按 30fps 烘成 V2 路标，之后 V1 的求值代码就不再需要。手持抖动不采（V2 无对应，迁移报告里明说）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import type { LegacyBinding, LegacyCamera, LegacyObject, LegacyScene3DState, LegacyTrajectory, LegacyVec3 } from './legacyScene3dTypes'

const CAMERA_DEFAULT_TARGET: LegacyVec3 = [0, 0.75, 0]
const CAMERA_AIM_BINDING_SUFFIX = ':aim'

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function wrapRatio(value: number): number {
  const wrapped = ((value % 1) + 1) % 1
  return wrapped >= 1 ? 0 : wrapped
}

function toVector(value: LegacyVec3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2])
}

function segmentCount(trajectory: LegacyTrajectory): number {
  if (trajectory.points.length < 2) return 0
  return trajectory.closed ? trajectory.points.length : trajectory.points.length - 1
}

function controlMap(trajectory: LegacyTrajectory): Map<string, THREE.Vector3> {
  const starts = new Set<string>()
  for (let index = 0; index < segmentCount(trajectory); index += 1) starts.add(trajectory.points[index]?.id ?? '')
  const controls = new Map<string, THREE.Vector3>()
  trajectory.curveControls?.forEach((control) => {
    if (starts.has(control.segmentStartPointId)) controls.set(control.segmentStartPointId, toVector(control.position))
  })
  return controls
}

function catmullSegment(base: THREE.CatmullRomCurve3, segmentIndex: number, segments: number): THREE.Curve<THREE.Vector3> {
  const samples: THREE.Vector3[] = []
  for (let sample = 0; sample <= 8; sample += 1) samples.push(base.getPoint((segmentIndex + sample / 8) / segments))
  return new THREE.CatmullRomCurve3(samples, false, 'catmullrom', 0.5)
}

export function buildLegacyCurve(trajectory: LegacyTrajectory): THREE.Curve<THREE.Vector3> | null {
  if (trajectory.points.length < 2) return null
  const points = trajectory.points.map((point) => toVector(point.position))
  const controls = controlMap(trajectory)
  const curve = new THREE.CatmullRomCurve3(points, trajectory.closed, 'catmullrom', trajectory.tension)
  curve.updateArcLengths()
  if (controls.size === 0) return curve
  const path = new THREE.CurvePath<THREE.Vector3>()
  const segments = segmentCount(trajectory)
  for (let index = 0; index < segments; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    const control = controls.get(trajectory.points[index]?.id ?? '')
    path.add(control ? new THREE.QuadraticBezierCurve3(start, control, end) : catmullSegment(curve, index, segments))
  }
  path.updateArcLengths()
  return path
}

function defaultTimeRatio(pointIndex: number, pointCount: number, closed: boolean): number {
  if (pointCount <= 1) return 0
  if (closed) return clampRatio(pointIndex / pointCount)
  return pointIndex / (pointCount - 1)
}

function pointTimeRatio(trajectory: LegacyTrajectory, pointIndex: number): number {
  const point = trajectory.points[pointIndex]
  if (!point || pointIndex <= 0) return 0
  if (!trajectory.closed && pointIndex >= trajectory.points.length - 1) return 1
  const fallback = defaultTimeRatio(pointIndex, trajectory.points.length, trajectory.closed)
  return typeof point.timeRatio === 'number' && Number.isFinite(point.timeRatio) ? clampRatio(point.timeRatio) : fallback
}

// 路标自带的 timeRatio（节奏）→ 曲线参数（V1 remapTrajectoryTimeRatio）
export function remapLegacyTimeRatio(trajectory: LegacyTrajectory, ratio: number): number {
  const pointCount = trajectory.points.length
  if (pointCount < 2) return clampRatio(ratio)
  const normalized = trajectory.closed ? wrapRatio(ratio) : clampRatio(ratio)
  const finalStop = trajectory.closed ? pointCount : pointCount - 1
  let previousTime = 0
  let previousCurve = 0
  for (let index = 1; index <= finalStop; index += 1) {
    const implicitEnd = trajectory.closed && index === pointCount
    const rawTime = implicitEnd || (!trajectory.closed && index === finalStop) ? 1 : pointTimeRatio(trajectory, index)
    const pointTime = Math.max(previousTime, clampRatio(rawTime))
    const pointCurve = trajectory.closed ? index / pointCount : defaultTimeRatio(index, pointCount, false)
    if (normalized <= pointTime || index === finalStop) {
      const span = pointTime - previousTime
      if (span <= 0.0001) return pointCurve
      return previousCurve + (pointCurve - previousCurve) * clampRatio((normalized - previousTime) / span)
    }
    previousTime = pointTime
    previousCurve = pointCurve
  }
  return trajectory.closed ? wrapRatio(normalized) : clampRatio(normalized)
}

export type LegacySample = { position: THREE.Vector3; tangent: THREE.Vector3 | null; visible: boolean }

function objectVisualHalfHeight(object: LegacyObject): number {
  const scaleY = Math.max(0.08, Math.abs(object.scale[1] || 1))
  if (object.type === 'light') return 0.12 * scaleY
  if (object.type === 'prop') return 0
  if (object.type === 'mannequin' || object.type === 'mannequinCrowd') return 0.5 * scaleY
  if (object.geometry === 'sphere' || object.geometry === 'cylinder') return 0.55 * scaleY
  if (object.geometry === 'plane') return 0
  return 0.5 * scaleY
}

export class LegacyTrajectorySampler {
  private readonly curves = new Map<string, THREE.Curve<THREE.Vector3> | null>()

  constructor(private readonly state: LegacyScene3DState) {}

  private curveOf(trajectory: LegacyTrajectory): THREE.Curve<THREE.Vector3> | null {
    if (!this.curves.has(trajectory.id)) this.curves.set(trajectory.id, buildLegacyCurve(trajectory))
    return this.curves.get(trajectory.id) ?? null
  }

  bindingOf(objectId: string): LegacyBinding | null {
    return this.state.trajectoryBindings.find((binding) => binding.objects.some((bound) => bound.objectId === objectId)) ?? null
  }

  sample(objectId: string, seconds: number): LegacySample | null {
    const binding = this.bindingOf(objectId)
    if (!binding) return null
    const bound = binding.objects.find((item) => item.objectId === objectId)
    const trajectory = this.state.trajectories.find((item) => item.id === binding.trajectoryId)
    if (!bound || !trajectory) return null
    const curve = this.curveOf(trajectory)
    if (!curve) return null
    const duration = binding.endTime - binding.startTime
    if (duration <= 0) return null
    const visible = !(trajectory.closed && seconds < binding.startTime)
    const raw = (seconds - binding.startTime) / duration
    let base = trajectory.closed ? wrapRatio(raw) : clampRatio(raw)
    if (binding.direction === 'reverse') base = 1 - base
    const offset = binding.direction === 'reverse' ? -bound.offsetRatio : bound.offsetRatio
    const t = trajectory.closed ? remapLegacyTimeRatio(trajectory, wrapRatio(base + offset)) : remapLegacyTimeRatio(trajectory, clampRatio(base + offset))
    const tangent = curve.getTangentAt(t)
    return { position: curve.getPointAt(t), tangent: tangent.lengthSq() >= 1e-10 ? tangent.normalize() : null, visible }
  }

  /** 物体在 t 的世界位置（V1 语义：轨迹点在脚下 / 底面，物体中心抬 objectVisualHalfHeight） */
  objectPosition(object: LegacyObject, seconds: number): { position: LegacyVec3; tangent: THREE.Vector3 | null } | null {
    const sample = this.sample(object.id, seconds)
    if (!sample) return null
    const lifted = sample.position.clone().add(new THREE.Vector3(0, objectVisualHalfHeight(object), 0))
    return { position: [lifted.x, lifted.y, lifted.z], tangent: sample.tangent }
  }

  private followTargetPosition(objectId: string | undefined, seconds: number): LegacyVec3 | null {
    if (!objectId) return null
    const object = this.state.objects.find((item) => item.id === objectId)
    if (!object) return null
    const moving = this.objectPosition(object, seconds)
    return moving ? moving.position : [...object.position]
  }

  /** 相机在 t 的位置 / 注视点 / fov（aim 轨迹 > 跟随目标 > 静态 target；fov 沿绑定线性渐变，否则静态） */
  cameraPose(camera: LegacyCamera, seconds: number): { position: LegacyVec3; target: LegacyVec3; fov: number } {
    const binding = this.bindingOf(camera.id)
    const sample = this.sample(camera.id, seconds)
    const position: LegacyVec3 = sample ? [sample.position.x, sample.position.y, sample.position.z] : [...camera.position]
    const aim = camera.aimTrajectoryId ? this.sample(`${camera.id}${CAMERA_AIM_BINDING_SUFFIX}`, seconds) : null
    const target: LegacyVec3 = aim
      ? [aim.position.x, aim.position.y, aim.position.z]
      : this.followTargetPosition(camera.followTargetId, seconds) ?? camera.target ?? CAMERA_DEFAULT_TARGET
    let fov = camera.fov
    if (binding && (binding.fovFrom !== undefined || binding.fovTo !== undefined)) {
      const from = binding.fovFrom ?? camera.fov
      const to = binding.fovTo ?? camera.fov
      const duration = binding.endTime - binding.startTime
      const t = duration > 0 ? clampRatio((seconds - binding.startTime) / duration) : 1
      fov = from + (to - from) * t
    }
    return { position, target, fov }
  }
}

import * as THREE from 'three'
import type { Scene3DTrajectory, Scene3DVector3 } from '../scene3dTypes'

export const TRAJECTORY_TUBE_RADIUS = 0.12
export const TRAJECTORY_CONTROL_POINT_RADIUS = 0.15
export const TRAJECTORY_LINE_SEGMENTS = 64
export const TRAJECTORY_INSERT_SAMPLE_COUNT = 200

export function sceneVectorToThree(value: Scene3DVector3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2])
}

export function threeVectorToScene(value: THREE.Vector3): Scene3DVector3 {
  return [
    Number(value.x.toFixed(4)),
    Number(value.y.toFixed(4)),
    Number(value.z.toFixed(4)),
  ]
}

export function trajectorySegmentCount(trajectory: Pick<Scene3DTrajectory, 'points' | 'closed'>): number {
  if (trajectory.points.length < 2) return 0
  return trajectory.closed ? trajectory.points.length : trajectory.points.length - 1
}

function trajectoryCurveControlMap(trajectory: Pick<Scene3DTrajectory, 'points' | 'closed' | 'curveControls'>): Map<string, THREE.Vector3> {
  const segmentStartIds = new Set<string>()
  const segmentCount = trajectorySegmentCount(trajectory)
  for (let index = 0; index < segmentCount; index += 1) {
    segmentStartIds.add(trajectory.points[index]?.id ?? '')
  }
  const controls = new Map<string, THREE.Vector3>()
  trajectory.curveControls?.forEach((control) => {
    if (!segmentStartIds.has(control.segmentStartPointId)) return
    controls.set(control.segmentStartPointId, sceneVectorToThree(control.position))
  })
  return controls
}

export function trajectoryHasCurveControls(trajectory: Pick<Scene3DTrajectory, 'points' | 'closed' | 'curveControls'>): boolean {
  return trajectoryCurveControlMap(trajectory).size > 0
}

export function trajectorySegmentControlPosition(trajectory: Pick<Scene3DTrajectory, 'points' | 'closed' | 'curveControls'>, segmentIndex: number): THREE.Vector3 | null {
  const segmentCount = trajectorySegmentCount(trajectory)
  if (segmentIndex < 0 || segmentIndex >= segmentCount) return null
  const start = trajectory.points[segmentIndex]
  const end = trajectory.points[(segmentIndex + 1) % trajectory.points.length]
  if (!start || !end) return null
  const stored = trajectoryCurveControlMap(trajectory).get(start.id)
  if (stored) return stored
  return sceneVectorToThree(start.position).lerp(sceneVectorToThree(end.position), 0.5)
}

function catmullSegmentCurve(baseCurve: THREE.CatmullRomCurve3, segmentIndex: number, segmentCount: number): THREE.Curve<THREE.Vector3> {
  const sampleCount = 8
  const samples: THREE.Vector3[] = []
  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    samples.push(baseCurve.getPoint((segmentIndex + sampleIndex / sampleCount) / segmentCount))
  }
  return new THREE.CatmullRomCurve3(samples, false, 'catmullrom', 0.5)
}

export function buildTrajectoryCurve(trajectory: Pick<Scene3DTrajectory, 'points' | 'closed' | 'tension' | 'curveControls'>): THREE.Curve<THREE.Vector3> | null {
  if (trajectory.points.length < 2) return null
  const points = trajectory.points.map((point) => sceneVectorToThree(point.position))
  const controls = trajectoryCurveControlMap(trajectory)
  const curve = new THREE.CatmullRomCurve3(points, trajectory.closed, 'catmullrom', trajectory.tension)
  curve.updateArcLengths()
  if (controls.size > 0) {
    const path = new THREE.CurvePath<THREE.Vector3>()
    const segmentCount = trajectorySegmentCount(trajectory)
    for (let index = 0; index < segmentCount; index += 1) {
      const startPoint = trajectory.points[index]
      const start = points[index]
      const end = points[(index + 1) % points.length]
      const control = startPoint ? controls.get(startPoint.id) : undefined
      path.add(control ? new THREE.QuadraticBezierCurve3(start, control, end) : catmullSegmentCurve(curve, index, segmentCount))
    }
    path.updateArcLengths()
    return path
  }
  return curve
}

export function trajectoryLinePoints(trajectory: Scene3DTrajectory): THREE.Vector3[] {
  const curve = buildTrajectoryCurve(trajectory)
  if (!curve) return []
  const points = curve.getPoints(TRAJECTORY_LINE_SEGMENTS)
  if (!trajectoryHasCurveControls(trajectory) && trajectory.closed && points.length > 1) {
    const withoutDuplicate = points.slice(0, -1)
    return [...withoutDuplicate, withoutDuplicate[0].clone()]
  }
  return points
}

export function trajectoryTubeSegments(pointCount: number): number {
  return Math.min(Math.max(64, pointCount * 8), 512)
}

export function createTrajectoryTubeGeometry(curve: THREE.Curve<THREE.Vector3>, pointCount: number): THREE.TubeGeometry {
  const closed = (curve as { closed?: boolean }).closed === true
  return new THREE.TubeGeometry(
    curve,
    trajectoryTubeSegments(pointCount),
    TRAJECTORY_TUBE_RADIUS,
    8,
    closed,
  )
}

export function clampRatio(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1)
}

export function wrapRatio(value: number): number {
  const wrapped = ((value % 1) + 1) % 1
  return wrapped >= 1 ? 0 : wrapped
}

export function trajectoryPointDefaultTimeRatio(pointIndex: number, pointCount: number, closed = false): number {
  if (pointCount <= 1) return 0
  if (closed) return clampRatio(pointIndex / pointCount)
  return pointIndex / (pointCount - 1)
}

export function trajectoryPointTimeRatio(
  trajectory: Pick<Scene3DTrajectory, 'points' | 'closed'>,
  pointIndex: number,
): number {
  const point = trajectory.points[pointIndex]
  if (!point) return 0
  if (pointIndex <= 0) return 0
  if (!trajectory.closed && pointIndex >= trajectory.points.length - 1) return 1
  const fallback = trajectoryPointDefaultTimeRatio(pointIndex, trajectory.points.length, trajectory.closed)
  return typeof point.timeRatio === 'number' && Number.isFinite(point.timeRatio)
    ? clampRatio(point.timeRatio)
    : fallback
}

export function remapTrajectoryTimeRatio(
  trajectory: Pick<Scene3DTrajectory, 'points' | 'closed'>,
  ratio: number,
): number {
  const pointCount = trajectory.points.length
  if (pointCount < 2) return clampRatio(ratio)
  const normalizedRatio = trajectory.closed ? wrapRatio(ratio) : clampRatio(ratio)
  const finalStopIndex = trajectory.closed ? pointCount : pointCount - 1
  let previousTime = 0
  let previousCurveRatio = 0

  for (let index = 1; index <= finalStopIndex; index += 1) {
    const implicitClosedEnd = trajectory.closed && index === pointCount
    const fallback = implicitClosedEnd ? 1 : trajectoryPointDefaultTimeRatio(index, pointCount, trajectory.closed)
    const rawPointTime = implicitClosedEnd || (!trajectory.closed && index === finalStopIndex)
      ? 1
      : trajectoryPointTimeRatio(trajectory, index)
    const pointTime = Math.max(previousTime, clampRatio(Number.isFinite(rawPointTime) ? rawPointTime : fallback))
    const pointCurveRatio = trajectory.closed
      ? index / pointCount
      : trajectoryPointDefaultTimeRatio(index, pointCount)

    if (normalizedRatio <= pointTime || index === finalStopIndex) {
      const span = pointTime - previousTime
      if (span <= 0.0001) return pointCurveRatio
      const segmentRatio = (normalizedRatio - previousTime) / span
      return THREE.MathUtils.lerp(previousCurveRatio, pointCurveRatio, clampRatio(segmentRatio))
    }

    previousTime = pointTime
    previousCurveRatio = pointCurveRatio
  }

  return trajectory.closed ? wrapRatio(normalizedRatio) : clampRatio(normalizedRatio)
}

export function trajectoryInsertIndex(trajectory: Scene3DTrajectory, curve: THREE.Curve<THREE.Vector3>, point: THREE.Vector3): number {
  curve.updateArcLengths()
  const samples = curve.getSpacedPoints(TRAJECTORY_INSERT_SAMPLE_COUNT)
  let nearestIndex = 0
  let nearestDistanceSq = Number.POSITIVE_INFINITY
  samples.forEach((sample, index) => {
    const distanceSq = sample.distanceToSquared(point)
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq
      nearestIndex = index
    }
  })
  const safeIndex = Math.min(nearestIndex, TRAJECTORY_INSERT_SAMPLE_COUNT - 1)
  const t = curve.getUtoTmapping(safeIndex / TRAJECTORY_INSERT_SAMPLE_COUNT, 0)
  const segmentCount = trajectory.closed ? trajectory.points.length : trajectory.points.length - 1
  const segmentIndex = Math.min(Math.floor(t * segmentCount), segmentCount - 1)
  return segmentIndex + 1
}

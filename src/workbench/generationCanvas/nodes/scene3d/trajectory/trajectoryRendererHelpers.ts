import * as THREE from 'three'
import type { Scene3DTrajectory, Scene3DVector3 } from '../scene3dTypes'
import { TRAJECTORY_CONTROL_POINT_RADIUS } from './trajectoryUtils'

export type PointerCaptureHost = EventTarget & {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
}

export type TrajectoryBindTarget = {
  id: string
  name: string
  type: 'mannequin' | 'camera'
}

export type TrajectoryContextMenuState = {
  trajectoryId: string
  position: Scene3DVector3
}

export type TrajectoryCreateMenuState = {
  position: Scene3DVector3
}

export type TrajectoryPointBindMenuState = {
  trajectoryId: string
  pointId: string
  position: Scene3DVector3
}

export function pointerCaptureHost(target: unknown): PointerCaptureHost | null {
  return target && typeof target === 'object' ? target as PointerCaptureHost : null
}

export const MIN_DRAG_DISTANCE = 0.04
export const ENDPOINT_ADD_HIDE_DELAY_MS = 520
export const TRAJECTORY_POINT_HIT_RADIUS = TRAJECTORY_CONTROL_POINT_RADIUS * 2.35
export const SELECTED_TRAJECTORY_POINT_HIT_RADIUS = TRAJECTORY_CONTROL_POINT_RADIUS * 1.25
export const TRAJECTORY_CURVE_HANDLE_RADIUS = 0.11
export const TRAJECTORY_CURVE_HANDLE_HIT_RADIUS = 0.28

export function vectorFromScene(value: Scene3DVector3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2])
}

export function vectorToScene(value: THREE.Vector3, y = value.y): Scene3DVector3 {
  return [
    Number(value.x.toFixed(4)),
    Number(y.toFixed(4)),
    Number(value.z.toFixed(4)),
  ]
}

export function vectorDeltaToScene(value: THREE.Vector3): Scene3DVector3 {
  return [
    Number(value.x.toFixed(4)),
    0,
    Number(value.z.toFixed(4)),
  ]
}

export function sceneDeltaMoved(delta: Scene3DVector3): boolean {
  return Math.abs(delta[0]) > 0.0001 || Math.abs(delta[2]) > 0.0001
}

export function sceneVectorAlmostEqual(a: Scene3DVector3, b: Scene3DVector3, epsilon = 0.0001): boolean {
  return (
    Math.abs(a[0] - b[0]) <= epsilon &&
    Math.abs(a[1] - b[1]) <= epsilon &&
    Math.abs(a[2] - b[2]) <= epsilon
  )
}

export function isTrajectoryEndpoint(trajectory: Scene3DTrajectory, pointIndex: number): boolean {
  if (trajectory.closed) return false
  return trajectory.points.length <= 1 || pointIndex === 0 || pointIndex === trajectory.points.length - 1
}

export function endpointPlacement(trajectory: Scene3DTrajectory, pointIndex: number): 'before' | 'after' {
  return pointIndex === 0 && trajectory.points.length > 1 ? 'before' : 'after'
}

export function endpointExtensionPosition(trajectory: Scene3DTrajectory, pointIndex: number): Scene3DVector3 {
  const point = trajectory.points[pointIndex]
  if (!point) return [0, 0, 0]

  const current = vectorFromScene(point.position)
  const neighborIndex = pointIndex === 0 ? 1 : pointIndex - 1
  const neighbor = trajectory.points[neighborIndex]
  if (!neighbor) {
    return [
      Number((point.position[0] + 1).toFixed(4)),
      point.position[1],
      point.position[2],
    ]
  }

  const direction = current.clone().sub(vectorFromScene(neighbor.position))
  const directionLength = direction.length()
  if (directionLength < 0.0001) {
    direction.set(pointIndex === 0 ? -1 : 1, 0, 0)
  } else {
    direction.multiplyScalar(1 / directionLength)
  }
  const distance = THREE.MathUtils.clamp(directionLength, 0.75, 2)
  return vectorToScene(current.add(direction.multiplyScalar(distance)), point.position[1])
}

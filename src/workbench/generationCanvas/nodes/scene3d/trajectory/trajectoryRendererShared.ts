import React from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Scene3DTrajectory, Scene3DVector3 } from '../scene3dTypes'
import { TRAJECTORY_CONTROL_POINT_RADIUS } from './trajectoryUtils'

export type TrajectoryBindTarget = {
  id: string
  name: string
  type: 'mannequin' | 'camera'
}

export type TrajectoryRendererProps = {
  trajectories: Scene3DTrajectory[]
  activeTrajectoryId?: string | null
  activePointId?: string | null
  editable: boolean
  wholeDraggable?: boolean
  onSelectTrajectory?: (trajectoryId: string) => void
  onSelectPoint?: (trajectoryId: string, pointId: string) => void
  onCreateTrajectoryAt?: (position: Scene3DVector3) => void
  onInsertPoint?: (
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => void
  onUpdateCurveControl?: (
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => void
  onUpdatePoint?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  onTranslateTrajectory?: (trajectoryId: string, delta: Scene3DVector3) => void
  onEditTrajectory?: (trajectoryId: string) => void
  onDeleteTrajectory?: (trajectoryId: string) => void
  bindTargets?: TrajectoryBindTarget[]
  onBindTargetToTrajectory?: (trajectoryId: string, targetId: string, pointId?: string | null) => void
}

export type PointerCaptureHost = EventTarget & {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
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

export const MIN_DRAG_DISTANCE = 0.04
export const ENDPOINT_ADD_HIDE_DELAY_MS = 520
export const TRAJECTORY_POINT_HIT_RADIUS = TRAJECTORY_CONTROL_POINT_RADIUS * 2.35
export const SELECTED_TRAJECTORY_POINT_HIT_RADIUS = TRAJECTORY_CONTROL_POINT_RADIUS * 1.25
export const TRAJECTORY_CURVE_HANDLE_RADIUS = 0.11
export const TRAJECTORY_CURVE_HANDLE_HIT_RADIUS = 0.28

export function pointerCaptureHost(target: unknown): PointerCaptureHost | null {
  return target && typeof target === 'object' ? (target as PointerCaptureHost) : null
}

export function vectorFromScene(value: Scene3DVector3): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2])
}

export function vectorToScene(value: THREE.Vector3, y = value.y): Scene3DVector3 {
  return [Number(value.x.toFixed(4)), Number(y.toFixed(4)), Number(value.z.toFixed(4))]
}

export function vectorDeltaToScene(value: THREE.Vector3): Scene3DVector3 {
  return [Number(value.x.toFixed(4)), 0, Number(value.z.toFixed(4))]
}

export function sceneDeltaMoved(delta: Scene3DVector3): boolean {
  return Math.abs(delta[0]) > 0.0001 || Math.abs(delta[2]) > 0.0001
}

export function sceneVectorAlmostEqual(
  a: Scene3DVector3,
  b: Scene3DVector3,
  epsilon = 0.0001,
): boolean {
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

export function endpointPlacement(
  trajectory: Scene3DTrajectory,
  pointIndex: number,
): 'before' | 'after' {
  return pointIndex === 0 && trajectory.points.length > 1 ? 'before' : 'after'
}

export function endpointExtensionPosition(
  trajectory: Scene3DTrajectory,
  pointIndex: number,
): Scene3DVector3 {
  const point = trajectory.points[pointIndex]
  if (!point) return [0, 0, 0]

  const current = vectorFromScene(point.position)
  const neighborIndex = pointIndex === 0 ? 1 : pointIndex - 1
  const neighbor = trajectory.points[neighborIndex]
  if (!neighbor) {
    return [Number((point.position[0] + 1).toFixed(4)), point.position[1], point.position[2]]
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

export function useTrajectoryWholeDrag({
  enabled,
  trajectoryId,
  onSelectTrajectory,
  onTranslateTrajectory,
}: {
  enabled: boolean
  trajectoryId: string
  onSelectTrajectory?: (trajectoryId: string) => void
  onTranslateTrajectory?: (trajectoryId: string, delta: Scene3DVector3) => void
}): (event: ThreeEvent<PointerEvent>) => void {
  const draggingRef = React.useRef(false)
  const pointerIdRef = React.useRef<number | null>(null)
  const lastUpdateTimeRef = React.useRef(0)
  const cameraRef = React.useRef<THREE.Camera | null>(null)
  const xzPlaneRef = React.useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const hitRef = React.useRef(new THREE.Vector3())
  const lastPointRef = React.useRef(new THREE.Vector3())
  const pointerTargetRef = React.useRef<PointerCaptureHost | null>(null)
  const controlsEnabledBeforeDragRef = React.useRef<boolean | null>(null)
  const { controls, gl } = useThree()

  const projectPointer = React.useCallback((event: Pick<ThreeEvent<PointerEvent>, 'ray'>) => {
    const hit = event.ray.intersectPlane(xzPlaneRef.current, hitRef.current)
    return hit ? hit.clone() : null
  }, [])

  const projectClientPointer = React.useCallback(
    (event: PointerEvent) => {
      const camera = cameraRef.current
      if (!camera) return null
      const canvas = gl.domElement
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.ray.intersectPlane(xzPlaneRef.current, hitRef.current)
      return hit ? hit.clone() : null
    },
    [gl],
  )

  const stopDrag = React.useCallback(
    (pointerId: number) => {
      draggingRef.current = false
      pointerIdRef.current = null
      const target = pointerTargetRef.current
      pointerTargetRef.current = null
      target?.releasePointerCapture?.(pointerId)
      if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current !== null) {
        ;(controls as { enabled: boolean }).enabled = controlsEnabledBeforeDragRef.current
        controlsEnabledBeforeDragRef.current = null
      }
    },
    [controls],
  )

  React.useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current || pointerIdRef.current !== event.pointerId) return
      if (event.timeStamp - lastUpdateTimeRef.current < 16) return
      lastUpdateTimeRef.current = event.timeStamp
      const nextPoint = projectClientPointer(event)
      if (!nextPoint) return
      const delta = vectorDeltaToScene(nextPoint.clone().sub(lastPointRef.current))
      lastPointRef.current.copy(nextPoint)
      if (sceneDeltaMoved(delta)) onTranslateTrajectory?.(trajectoryId, delta)
    }

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (!draggingRef.current || pointerIdRef.current !== event.pointerId) return
      stopDrag(event.pointerId)
    }

    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true })
    window.addEventListener('pointerup', handleWindowPointerUp, { capture: true })
    window.addEventListener('pointercancel', handleWindowPointerUp, { capture: true })
    return () => {
      if (pointerIdRef.current !== null) stopDrag(pointerIdRef.current)
      window.removeEventListener('pointermove', handleWindowPointerMove, { capture: true })
      window.removeEventListener('pointerup', handleWindowPointerUp, { capture: true })
      window.removeEventListener('pointercancel', handleWindowPointerUp, { capture: true })
    }
  }, [onTranslateTrajectory, projectClientPointer, stopDrag, trajectoryId])

  return React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!enabled || event.nativeEvent.button !== 0) return
      event.stopPropagation()
      const start = projectPointer(event)
      if (!start) return
      onSelectTrajectory?.(trajectoryId)
      cameraRef.current = event.camera
      pointerIdRef.current = event.pointerId
      lastUpdateTimeRef.current = event.nativeEvent.timeStamp
      lastPointRef.current.copy(start)
      draggingRef.current = true
      if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current === null) {
        controlsEnabledBeforeDragRef.current = (controls as { enabled: boolean }).enabled
        ;(controls as { enabled: boolean }).enabled = false
      }
      const target = pointerCaptureHost(event.nativeEvent.target) ?? pointerCaptureHost(event.target)
      pointerTargetRef.current = target
      target?.setPointerCapture?.(event.pointerId)
    },
    [controls, enabled, onSelectTrajectory, projectPointer, trajectoryId],
  )
}

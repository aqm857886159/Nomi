import React from 'react'
import { Html, Line, TransformControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { IconPlus } from '@tabler/icons-react'
import * as THREE from 'three'
import type { Scene3DTrajectory, Scene3DTrajectoryPoint, Scene3DVector3 } from '../scene3dTypes'
import {
  MIN_DRAG_DISTANCE,
  SELECTED_TRAJECTORY_POINT_HIT_RADIUS,
  TRAJECTORY_CURVE_HANDLE_HIT_RADIUS,
  TRAJECTORY_CURVE_HANDLE_RADIUS,
  TRAJECTORY_POINT_HIT_RADIUS,
  endpointExtensionPosition,
  endpointPlacement,
  pointerCaptureHost,
  sceneVectorAlmostEqual,
  type PointerCaptureHost,
  vectorFromScene,
  vectorToScene,
} from './trajectoryRendererShared'
import {
  TRAJECTORY_CONTROL_POINT_RADIUS,
  trajectorySegmentControlPosition,
} from './trajectoryUtils'

function TrajectoryPointTransformControls({
  trajectoryId,
  point,
  enabled,
  onTransformPointerDown,
  onTransformPointerUp,
  onSelectPoint,
  onUpdatePoint,
}: {
  trajectoryId: string
  point: Scene3DTrajectoryPoint
  enabled: boolean
  onTransformPointerDown?: (pointerId: number) => void
  onTransformPointerUp?: (pointerId: number) => void
  onSelectPoint?: (trajectoryId: string, pointId: string) => void
  onUpdatePoint?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
}): JSX.Element | null {
  const anchorRef = React.useRef<THREE.Group>(null!) as React.MutableRefObject<THREE.Group>
  const transformRef = React.useRef<any>(null)
  const draggingRef = React.useRef(false)
  const controlsEnabledBeforeDragRef = React.useRef<boolean | null>(null)
  const { controls } = useThree()

  const restoreControls = React.useCallback(() => {
    if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current !== null) {
      ;(controls as { enabled: boolean }).enabled = controlsEnabledBeforeDragRef.current
    }
    controlsEnabledBeforeDragRef.current = null
  }, [controls])

  const updatePointFromAnchor = React.useCallback(
    (options?: { force?: boolean }) => {
      if (!draggingRef.current && !options?.force) return
      const anchor = anchorRef.current
      if (!anchor) return
      const position = vectorToScene(anchor.position)
      if (sceneVectorAlmostEqual(point.position, position)) return
      onUpdatePoint?.(trajectoryId, point.id, position)
    },
    [onUpdatePoint, point.id, point.position, trajectoryId],
  )

  const startTransform = React.useCallback(() => {
    onSelectPoint?.(trajectoryId, point.id)
    draggingRef.current = true
    if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current === null) {
      controlsEnabledBeforeDragRef.current = (controls as { enabled: boolean }).enabled
      ;(controls as { enabled: boolean }).enabled = false
    }
  }, [controls, onSelectPoint, point.id, trajectoryId])

  const stopTransform = React.useCallback(() => {
    updatePointFromAnchor({ force: true })
    draggingRef.current = false
    restoreControls()
  }, [restoreControls, updatePointFromAnchor])

  React.useLayoutEffect(() => {
    if (!anchorRef.current || draggingRef.current) return
    anchorRef.current.position.fromArray(point.position)
  }, [point.position])

  React.useEffect(() => {
    const transform = transformRef.current
    if (!transform) return
    const handleDraggingChanged = (event: { value: boolean }) => {
      if (event.value) {
        startTransform()
        return
      }
      stopTransform()
    }
    transform.addEventListener('dragging-changed', handleDraggingChanged)
    return () => {
      if (draggingRef.current) stopTransform()
      transform.removeEventListener('dragging-changed', handleDraggingChanged)
    }
  }, [startTransform, stopTransform])

  if (!enabled) return null

  return (
    <>
      <group ref={anchorRef} position={point.position} />
      <TransformControls
        ref={transformRef}
        object={anchorRef}
        mode="translate"
        showX
        showY
        showZ
        size={0.72}
        space="world"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onMouseDown={startTransform}
        onMouseUp={stopTransform}
        onObjectChange={() => updatePointFromAnchor()}
        onPointerDown={(event) => onTransformPointerDown?.(event.pointerId)}
        onPointerUp={(event) => onTransformPointerUp?.(event.pointerId)}
      />
    </>
  )
}

export function TrajectoryControlPoint({
  trajectory,
  activePointId,
  point,
  active,
  editable,
  onPointerHover,
  onPointerUnhover,
  onSelectTrajectory,
  onSelectPoint,
  onWholePointerDown,
  onContextMenu,
  onPointContextMenu,
  onUpdatePoint,
}: {
  trajectory: Scene3DTrajectory
  activePointId?: string | null
  point: Scene3DTrajectoryPoint
  active: boolean
  editable: boolean
  onPointerHover?: () => void
  onPointerUnhover?: () => void
  onSelectTrajectory?: (trajectoryId: string) => void
  onSelectPoint?: (trajectoryId: string, pointId: string) => void
  onWholePointerDown?: (event: ThreeEvent<PointerEvent>) => void
  onContextMenu?: (trajectoryId: string, position: Scene3DVector3) => void
  onPointContextMenu?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  onUpdatePoint?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
}): JSX.Element {
  const draggingRef = React.useRef(false)
  const movedRef = React.useRef(false)
  const lastUpdateTimeRef = React.useRef(0)
  const pointerIdRef = React.useRef<number | null>(null)
  const cameraRef = React.useRef<THREE.Camera | null>(null)
  const xzPlaneRef = React.useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const hitRef = React.useRef(new THREE.Vector3())
  const pointerTargetRef = React.useRef<PointerCaptureHost | null>(null)
  const dragStartRef = React.useRef(vectorFromScene(point.position))
  const pointStartRef = React.useRef(vectorFromScene(point.position))
  const lastEndRef = React.useRef(vectorFromScene(point.position))
  const controlsEnabledBeforeDraftRef = React.useRef<boolean | null>(null)
  const transformPointerIdRef = React.useRef<number | null>(null)
  const { controls, gl } = useThree()
  const selected = active && point.id === activePointId
  const color = selected ? '#facc15' : active ? '#c084fc' : trajectory.color

  const projectPointer = React.useCallback((event: Pick<ThreeEvent<PointerEvent>, 'ray'>) => {
    const hit = event.ray.intersectPlane(xzPlaneRef.current, hitRef.current)
    return hit ? hit.clone() : null
  }, [])

  const projectClientPointer = React.useCallback(
    (event: PointerEvent) => {
      const camera = cameraRef.current
      if (!camera) return null
      const canvas = gl.domElement
      if (!canvas) return null
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

  const commitDraft = React.useCallback(
    (end: THREE.Vector3, pointerId: number) => {
      draggingRef.current = false
      pointerIdRef.current = null
      const target = pointerTargetRef.current
      pointerTargetRef.current = null
      target?.releasePointerCapture?.(pointerId)
      if (controls && 'enabled' in controls && controlsEnabledBeforeDraftRef.current !== null) {
        ;(controls as { enabled: boolean }).enabled = controlsEnabledBeforeDraftRef.current
        controlsEnabledBeforeDraftRef.current = null
      }
      const moved = movedRef.current || end.distanceTo(pointStartRef.current) >= MIN_DRAG_DISTANCE
      if (moved) onUpdatePoint?.(trajectory.id, point.id, vectorToScene(end, point.position[1]))
    },
    [controls, onUpdatePoint, point.id, point.position, trajectory.id],
  )

  React.useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current || pointerIdRef.current !== event.pointerId) return
      if (event.timeStamp - lastUpdateTimeRef.current < 16) return
      lastUpdateTimeRef.current = event.timeStamp
      const pointerEnd = projectClientPointer(event)
      if (!pointerEnd) return
      if (pointerEnd.distanceTo(dragStartRef.current) >= MIN_DRAG_DISTANCE) {
        movedRef.current = true
      }
      const end = pointStartRef.current.clone().add(pointerEnd.clone().sub(dragStartRef.current))
      lastEndRef.current = end
      onUpdatePoint?.(trajectory.id, point.id, vectorToScene(end, point.position[1]))
    }

    const handleWindowPointerUp = (event: PointerEvent) => {
      if (transformPointerIdRef.current === event.pointerId) {
        transformPointerIdRef.current = null
      }
      if (!draggingRef.current || pointerIdRef.current !== event.pointerId) return
      const pointerEnd = projectClientPointer(event)
      const end = pointerEnd
        ? pointStartRef.current.clone().add(pointerEnd.clone().sub(dragStartRef.current))
        : lastEndRef.current
      if (pointerEnd && pointerEnd.distanceTo(dragStartRef.current) >= MIN_DRAG_DISTANCE) {
        movedRef.current = true
      }
      commitDraft(end, event.pointerId)
    }

    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true })
    window.addEventListener('pointerup', handleWindowPointerUp, { capture: true })
    window.addEventListener('pointercancel', handleWindowPointerUp, { capture: true })
    return () => {
      if (controls && 'enabled' in controls && controlsEnabledBeforeDraftRef.current !== null) {
        ;(controls as { enabled: boolean }).enabled = controlsEnabledBeforeDraftRef.current
        controlsEnabledBeforeDraftRef.current = null
      }
      window.removeEventListener('pointermove', handleWindowPointerMove, { capture: true })
      window.removeEventListener('pointerup', handleWindowPointerUp, { capture: true })
      window.removeEventListener('pointercancel', handleWindowPointerUp, { capture: true })
    }
  }, [commitDraft, onUpdatePoint, point.id, point.position, projectClientPointer, trajectory.id])

  const handlePointPointerOver = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      onPointerHover?.()
    },
    [onPointerHover],
  )

  const handlePointPointerOut = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      onPointerUnhover?.()
    },
    [onPointerUnhover],
  )

  const handlePointPointerDown = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.nativeEvent.button !== 0) return
      if (transformPointerIdRef.current === event.pointerId) return
      event.stopPropagation()
      onSelectTrajectory?.(trajectory.id)
      if (!editable) {
        onWholePointerDown?.(event)
        return
      }
      cameraRef.current = event.camera
      pointerIdRef.current = event.pointerId
      if (controls && 'enabled' in controls && controlsEnabledBeforeDraftRef.current === null) {
        controlsEnabledBeforeDraftRef.current = (controls as { enabled: boolean }).enabled
        ;(controls as { enabled: boolean }).enabled = false
      }
      onSelectPoint?.(trajectory.id, point.id)
      draggingRef.current = true
      movedRef.current = false
      lastUpdateTimeRef.current = event.nativeEvent.timeStamp
      const target = pointerCaptureHost(event.nativeEvent.target) ?? pointerCaptureHost(event.target)
      pointerTargetRef.current = target
      target?.setPointerCapture?.(event.pointerId)
      const pointStart = vectorFromScene(point.position)
      const pointerStart = projectPointer(event) ?? pointStart.clone()
      dragStartRef.current = pointerStart
      pointStartRef.current = pointStart
      lastEndRef.current = pointStart
    },
    [
      controls,
      editable,
      onSelectPoint,
      onSelectTrajectory,
      onWholePointerDown,
      point.id,
      point.position,
      projectPointer,
      trajectory.id,
    ],
  )

  const handlePointPointerUp = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (transformPointerIdRef.current === event.pointerId) return
      if (!draggingRef.current) return
      event.stopPropagation()
      const pointerEnd = projectPointer(event)
      const end = pointerEnd
        ? pointStartRef.current.clone().add(pointerEnd.clone().sub(dragStartRef.current))
        : lastEndRef.current
      if (pointerEnd && pointerEnd.distanceTo(dragStartRef.current) >= MIN_DRAG_DISTANCE) {
        movedRef.current = true
      }
      commitDraft(end, event.pointerId)
    },
    [commitDraft, projectPointer],
  )

  const markTransformPointer = React.useCallback((pointerId: number) => {
    transformPointerIdRef.current = pointerId
  }, [])

  const clearTransformPointer = React.useCallback((pointerId: number) => {
    if (transformPointerIdRef.current === pointerId) transformPointerIdRef.current = null
  }, [])

  return (
    <>
      <mesh
        position={point.position}
        renderOrder={6}
        onPointerOver={handlePointPointerOver}
        onPointerOut={handlePointPointerOut}
        onPointerDown={handlePointPointerDown}
        onPointerUp={handlePointPointerUp}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.stopPropagation()
          event.nativeEvent.preventDefault()
          if (editable && onPointContextMenu) {
            onPointContextMenu(trajectory.id, point.id, vectorToScene(event.point, point.position[1]))
            return
          }
          onContextMenu?.(trajectory.id, vectorToScene(event.point, point.position[1]))
        }}
      >
        <sphereGeometry
          args={[
            selected ? SELECTED_TRAJECTORY_POINT_HIT_RADIUS : TRAJECTORY_POINT_HIT_RADIUS,
            18,
            12,
          ]}
        />
        <meshBasicMaterial
          color="#ffffff"
          depthWrite={false}
          opacity={0}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh position={point.position} renderOrder={5}>
        <sphereGeometry args={[TRAJECTORY_CONTROL_POINT_RADIUS, 18, 12]} />
        <meshBasicMaterial
          color={color}
          depthTest={false}
          opacity={editable ? 1 : 0.68}
          transparent
          toneMapped={false}
        />
      </mesh>
      <TrajectoryPointTransformControls
        trajectoryId={trajectory.id}
        point={point}
        enabled={selected && editable}
        onTransformPointerDown={markTransformPointer}
        onTransformPointerUp={clearTransformPointer}
        onSelectPoint={onSelectPoint}
        onUpdatePoint={onUpdatePoint}
      />
    </>
  )
}

export function TrajectoryEndpointAddButton({
  trajectory,
  pointIndex,
  visible,
  onKeepVisible,
  onRequestHide,
  onSelectTrajectory,
  onSelectPoint,
  onInsertPoint,
}: {
  trajectory: Scene3DTrajectory
  pointIndex: number
  visible: boolean
  onKeepVisible: () => void
  onRequestHide: () => void
  onSelectTrajectory?: (trajectoryId: string) => void
  onSelectPoint?: (trajectoryId: string, pointId: string) => void
  onInsertPoint?: (
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => void
}): JSX.Element | null {
  const point = trajectory.points[pointIndex]
  const addPosition = React.useMemo(
    () => endpointExtensionPosition(trajectory, pointIndex),
    [trajectory, pointIndex],
  )
  const placement = endpointPlacement(trajectory, pointIndex)

  if (!point || !visible) return null

  return (
    <>
      <Line
        points={[vectorFromScene(point.position), vectorFromScene(addPosition)]}
        color={trajectory.color}
        lineWidth={2}
        transparent
        opacity={0.48}
        depthTest={false}
        renderOrder={1}
      />
      <Html
        center
        distanceFactor={8}
        position={addPosition}
        style={{ pointerEvents: 'auto' }}
        zIndexRange={[20, 0]}
      >
        <button
          type="button"
          aria-label="连接新轨迹点"
          title="连接新轨迹点"
          className="grid size-8 place-items-center rounded-full border border-white/85 bg-[var(--nomi-ink)] text-[var(--nomi-paper)] shadow-[0_8px_20px_rgba(18,24,38,0.24)] transition hover:scale-105"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onSelectTrajectory?.(trajectory.id)
            onSelectPoint?.(trajectory.id, point.id)
            onInsertPoint?.(trajectory.id, addPosition, point.id, placement)
          }}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onKeepVisible()
          }}
          onPointerEnter={onKeepVisible}
          onPointerLeave={onRequestHide}
          onPointerUp={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <IconPlus size={16} stroke={2.4} />
        </button>
      </Html>
    </>
  )
}

export function TrajectoryCurveControlHandle({
  trajectory,
  segmentIndex,
  visible,
  onSelectTrajectory,
  onUpdateCurveControl,
}: {
  trajectory: Scene3DTrajectory
  segmentIndex: number
  visible: boolean
  onSelectTrajectory?: (trajectoryId: string) => void
  onUpdateCurveControl?: (
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => void
}): JSX.Element | null {
  const startPoint = trajectory.points[segmentIndex]
  const endPoint = trajectory.points[(segmentIndex + 1) % trajectory.points.length]
  const controlPosition = React.useMemo(
    () => trajectorySegmentControlPosition(trajectory, segmentIndex),
    [trajectory, segmentIndex],
  )
  const stored = Boolean(
    startPoint &&
      trajectory.curveControls?.some((control) => control.segmentStartPointId === startPoint.id),
  )
  const [hovered, setHovered] = React.useState(false)
  const draggingRef = React.useRef(false)
  const pointerIdRef = React.useRef<number | null>(null)
  const cameraRef = React.useRef<THREE.Camera | null>(null)
  const xzPlaneRef = React.useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const hitRef = React.useRef(new THREE.Vector3())
  const dragStartRef = React.useRef(new THREE.Vector3())
  const handleStartRef = React.useRef(new THREE.Vector3())
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
      const rect = gl.domElement.getBoundingClientRect()
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
      if (!draggingRef.current || pointerIdRef.current !== event.pointerId || !startPoint) return
      const pointerEnd = projectClientPointer(event)
      if (!pointerEnd) return
      const next = handleStartRef.current.clone().add(pointerEnd.clone().sub(dragStartRef.current))
      onUpdateCurveControl?.(trajectory.id, startPoint.id, vectorToScene(next))
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
  }, [onUpdateCurveControl, projectClientPointer, startPoint, stopDrag, trajectory.id])

  if (!startPoint || !endPoint || !controlPosition || !visible) return null

  const start = vectorFromScene(startPoint.position)
  const end = vectorFromScene(endPoint.position)
  const guideVisible = stored || hovered || draggingRef.current

  return (
    <>
      {guideVisible ? (
        <Line
          points={[start, controlPosition, end]}
          color="#06b6d4"
          lineWidth={1.4}
          transparent
          opacity={0.48}
          depthTest={false}
          renderOrder={3}
        />
      ) : null}
      <mesh
        position={controlPosition}
        renderOrder={7}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={(event) => {
          event.stopPropagation()
          setHovered(false)
        }}
        onPointerDown={(event) => {
          if (event.nativeEvent.button !== 0) return
          event.stopPropagation()
          onSelectTrajectory?.(trajectory.id)
          cameraRef.current = event.camera
          xzPlaneRef.current.constant = -controlPosition.y
          const pointerStart = projectPointer(event) ?? controlPosition.clone()
          dragStartRef.current.copy(pointerStart)
          handleStartRef.current.copy(controlPosition)
          draggingRef.current = true
          pointerIdRef.current = event.pointerId
          if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current === null) {
            controlsEnabledBeforeDragRef.current = (controls as { enabled: boolean }).enabled
            ;(controls as { enabled: boolean }).enabled = false
          }
          const target = pointerCaptureHost(event.nativeEvent.target) ?? pointerCaptureHost(event.target)
          pointerTargetRef.current = target
          target?.setPointerCapture?.(event.pointerId)
        }}
        onPointerUp={(event) => {
          if (!draggingRef.current) return
          event.stopPropagation()
          stopDrag(event.pointerId)
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onUpdateCurveControl?.(trajectory.id, startPoint.id, null)
        }}
      >
        <sphereGeometry args={[TRAJECTORY_CURVE_HANDLE_HIT_RADIUS, 16, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={controlPosition} renderOrder={6}>
        <sphereGeometry args={[TRAJECTORY_CURVE_HANDLE_RADIUS, 16, 10]} />
        <meshBasicMaterial
          color={stored ? '#06b6d4' : '#67e8f9'}
          depthTest={false}
          opacity={stored || hovered ? 1 : 0.72}
          transparent
          toneMapped={false}
        />
      </mesh>
    </>
  )
}

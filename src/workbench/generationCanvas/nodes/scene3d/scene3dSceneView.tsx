import React from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import {
  vectorFromArray,
  vectorToArray,
  eulerToArray,
  cameraLookAtRotation,
  cameraAimSpherical,
  mannequinRoleLabel,
  pointerCaptureTarget,
  type PointerCaptureTarget,
} from './scene3dMath'
import {
  CAMERA_HELPER_FLAG,
  CAMERA_MARKER_COLOR,
  CAMERA_MARKER_ACCENT_COLOR,
  CAMERA_HELPER_VISUAL_FAR,
  CAMERA_AIM_FEEDBACK_LENGTH,
  CAMERA_AIM_HANDLE_DISTANCE,
  CAMERA_DEFAULT_TARGET,
  SCENE3D_RUNTIME_ID_KEY,
} from './scene3dConstants'
import { SCENE3D_ASPECT_RATIOS } from './scene3dTypes'
import type { Scene3DCamera, Scene3DObject, Scene3DVector3, Scene3DTransformMode } from './scene3dTypes'
import {
  Scene3DMeshGeometry,
  ProceduralMannequin,
  Mannequin,
  MannequinCrowd,
  ProceduralMannequinCrowd,
  LightObject,
  MannequinRoleLabel,
  MannequinFootRings,
  MannequinAssetBoundary,
  objectGroundFootprint,
  objectVisualHalfHeight,
  objectTransformAnchorPosition,
  singleMannequinLabelPosition,
  crowdLabelPositions,
} from './scene3dObjects'

export function CameraFrustumLines({
  cameraData,
  selected,
}: {
  cameraData: Scene3DCamera
  selected: boolean
}): JSX.Element {
  const positions = React.useMemo(() => {
    const distance = Math.min(cameraData.far, Math.max(cameraData.near + 0.1, CAMERA_HELPER_VISUAL_FAR))
    const aspect = SCENE3D_ASPECT_RATIOS[cameraData.aspectRatio]
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(cameraData.fov) / 2) * distance
    const halfWidth = halfHeight * aspect
    const origin: Scene3DVector3 = [0, 0, 0]
    const topLeft: Scene3DVector3 = [-halfWidth, halfHeight, distance]
    const topRight: Scene3DVector3 = [halfWidth, halfHeight, distance]
    const bottomRight: Scene3DVector3 = [halfWidth, -halfHeight, distance]
    const bottomLeft: Scene3DVector3 = [-halfWidth, -halfHeight, distance]
    const segments = [
      origin, topLeft,
      origin, topRight,
      origin, bottomRight,
      origin, bottomLeft,
      topLeft, topRight,
      topRight, bottomRight,
      bottomRight, bottomLeft,
      bottomLeft, topLeft,
    ]
    return new Float32Array(segments.flat())
  }, [cameraData.aspectRatio, cameraData.far, cameraData.fov, cameraData.near])

  return (
    <lineSegments frustumCulled={false} raycast={() => null} userData={{ [CAMERA_HELPER_FLAG]: true }}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={selected ? '#facc15' : '#64748b'}
        opacity={selected ? 0.9 : 0.56}
        transparent
        toneMapped={false}
      />
    </lineSegments>
  )
}

export function CameraTargetFeedback({ cameraData }: { cameraData: Scene3DCamera }): JSX.Element {
  const target = cameraData.target || CAMERA_DEFAULT_TARGET
  const endpoint = React.useMemo(() => {
    const position = vectorFromArray(cameraData.position)
    const direction = vectorFromArray(target).sub(position)
    if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1)
    direction.normalize().multiplyScalar(CAMERA_AIM_FEEDBACK_LENGTH)
    return vectorToArray(position.add(direction))
  }, [cameraData.position, target])
  const positions = React.useMemo(() => new Float32Array([
    cameraData.position[0],
    cameraData.position[1],
    cameraData.position[2],
    endpoint[0],
    endpoint[1],
    endpoint[2],
  ]), [cameraData.position, endpoint])

  return (
    <>
      <lineSegments frustumCulled={false} raycast={() => null} userData={{ [CAMERA_HELPER_FLAG]: true }}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#facc15" opacity={0.62} transparent toneMapped={false} />
      </lineSegments>
      <mesh position={endpoint} raycast={() => null} userData={{ [CAMERA_HELPER_FLAG]: true }}>
        <sphereGeometry args={[0.055, 18, 12]} />
        <meshBasicMaterial color="#facc15" toneMapped={false} />
      </mesh>
    </>
  )
}

export function SceneObjectView({
  object,
  selected,
  readOnly,
  interactionDisabled,
  transformMode,
  orbitControlsActive,
  navigationLockedRef,
  roleLabel,
  roleStartIndex,
  onSelect,
  onFocus,
  onTransformStart,
  onTransformEnd,
  onTransform,
}: {
  object: Scene3DObject
  selected: boolean
  readOnly: boolean
  interactionDisabled?: boolean
  transformMode: Scene3DTransformMode
  orbitControlsActive: boolean
  navigationLockedRef: React.MutableRefObject<boolean>
  roleLabel?: string
  roleStartIndex?: number
  onSelect: () => void
  onFocus: () => void
  onTransformStart: () => void
  onTransformEnd: () => void
  onTransform: (patch: Partial<Scene3DObject>) => void
}): JSX.Element {
  const visualRef = React.useRef<THREE.Group>(null!) as React.MutableRefObject<THREE.Group>
  const anchorRef = React.useRef<THREE.Group>(null!) as React.MutableRefObject<THREE.Group>
  const transformRef = React.useRef<any>(null)
  const transformDraggingRef = React.useRef(false)
  const orbitControlsActiveRef = React.useRef(orbitControlsActive)
  const { controls } = useThree()
  const anchorPosition = React.useMemo(() => objectTransformAnchorPosition(object), [object])

  const handleObjectChange = React.useCallback(() => {
    if (!anchorRef.current) return
    const nextScale = vectorToArray(anchorRef.current.scale)
    const nextPosition: Scene3DVector3 = [
      Number(anchorRef.current.position.x.toFixed(4)),
      Number((anchorRef.current.position.y + objectVisualHalfHeight(object, nextScale)).toFixed(4)),
      Number(anchorRef.current.position.z.toFixed(4)),
    ]
    const nextRotation = eulerToArray(anchorRef.current.rotation)
    if (visualRef.current) {
      visualRef.current.position.fromArray(nextPosition)
      visualRef.current.rotation.copy(anchorRef.current.rotation)
      visualRef.current.scale.copy(anchorRef.current.scale)
    }
    onTransform({
      position: nextPosition,
      rotation: nextRotation,
      scale: nextScale,
    })
  }, [object, onTransform])

  React.useLayoutEffect(() => {
    orbitControlsActiveRef.current = orbitControlsActive
    if (!orbitControlsActive && controls && 'enabled' in controls && !transformDraggingRef.current) {
      ;(controls as { enabled: boolean }).enabled = false
    }
  }, [controls, orbitControlsActive])

  React.useLayoutEffect(() => {
    if (!anchorRef.current || transformDraggingRef.current) return
    anchorRef.current.position.fromArray(anchorPosition)
    anchorRef.current.rotation.fromArray(object.rotation)
    anchorRef.current.scale.fromArray(object.scale)
  }, [anchorPosition, object.rotation, object.scale])

  React.useEffect(() => {
    const tc = transformRef.current
    if (!tc) return
    const handler = (event: any) => {
      const dragging = Boolean(event.value)
      const wasDragging = transformDraggingRef.current
      transformDraggingRef.current = dragging
      navigationLockedRef.current = dragging
      if (dragging && !wasDragging) {
        orbitControlsActiveRef.current = false
        onTransformStart()
      }
      if (controls && 'enabled' in controls) {
        ;(controls as { enabled: boolean }).enabled = dragging ? false : orbitControlsActiveRef.current
      }
    }
    tc.addEventListener('dragging-changed', handler)
    return () => {
      if (transformDraggingRef.current) {
        navigationLockedRef.current = false
        transformDraggingRef.current = false
        onTransformEnd()
      }
      tc.removeEventListener('dragging-changed', handler)
    }
  }, [controls, navigationLockedRef, onTransformEnd, onTransformStart, selected])

  const handleTransformMouseDown = React.useCallback(() => {
    orbitControlsActiveRef.current = false
    navigationLockedRef.current = true
    onTransformStart()
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = false
    }
  }, [controls, navigationLockedRef, onTransformStart])

  const handleTransformMouseUp = React.useCallback(() => {
    navigationLockedRef.current = false
    onTransformEnd()
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = orbitControlsActiveRef.current
    }
  }, [controls, navigationLockedRef, onTransformEnd])

  const group = (
    <group
      ref={visualRef}
      userData={{ [SCENE3D_RUNTIME_ID_KEY]: object.id }}
      visible={object.visible}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      onPointerDown={interactionDisabled ? undefined : (event) => {
        event.stopPropagation()
        onSelect()
      }}
      onDoubleClick={interactionDisabled ? undefined : (event) => {
        event.stopPropagation()
        onSelect()
        onFocus()
      }}
    >
      {object.type === 'mannequin' ? (
        <MannequinAssetBoundary fallback={<ProceduralMannequin color={object.color || '#808080'} />}>
          <React.Suspense fallback={<ProceduralMannequin color={object.color || '#808080'} />}>
            <Mannequin color={object.color || '#808080'} pose={object.pose} />
          </React.Suspense>
        </MannequinAssetBoundary>
      ) : object.type === 'mannequinCrowd' ? (
        <MannequinAssetBoundary fallback={<ProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex || 0} />}>
          <React.Suspense fallback={<ProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex || 0} />}>
            <MannequinCrowd object={object} roleStartIndex={roleStartIndex || 0} />
          </React.Suspense>
        </MannequinAssetBoundary>
      ) : object.type === 'light' ? (
        <>
          <LightObject object={object} />
          <mesh>
            <sphereGeometry args={[0.12, 18, 12]} />
            <meshBasicMaterial color={object.lightColor || '#ffffff'} toneMapped={false} />
          </mesh>
        </>
      ) : (
        <mesh>
          <Scene3DMeshGeometry geometry={object.geometry} />
          <meshStandardMaterial
            color={object.color || '#808080'}
            roughness={0.55}
            metalness={0.04}
            side={object.geometry === 'plane' ? THREE.DoubleSide : THREE.FrontSide}
          />
        </mesh>
      )}
      {object.type === 'mannequinCrowd' ? (
        <mesh>
          <boxGeometry args={[
            Math.max(0.2, objectGroundFootprint(object).width / Math.max(0.001, Math.abs(object.scale[0] || 1))),
            1,
            Math.max(0.2, objectGroundFootprint(object).depth / Math.max(0.001, Math.abs(object.scale[2] || 1))),
          ]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )

  return (
    <>
      {selected ? <MannequinFootRings object={object} /> : null}
      {object.type === 'mannequin' && roleLabel ? <MannequinRoleLabel position={singleMannequinLabelPosition(object)} label={roleLabel} /> : null}
      {object.type === 'mannequinCrowd' && roleStartIndex !== undefined
        ? crowdLabelPositions(object).map((position, index) => (
          <MannequinRoleLabel
            key={`${object.id}-role-${index}`}
            position={position}
            label={mannequinRoleLabel(roleStartIndex + index)}
          />
        ))
        : null}
      <group ref={anchorRef} position={anchorPosition} rotation={object.rotation} scale={object.scale} />
      {group}
      {selected && !readOnly ? (
        <TransformControls
          ref={transformRef}
          object={anchorRef}
          mode={transformMode}
          onMouseDown={handleTransformMouseDown}
          onMouseUp={handleTransformMouseUp}
          onObjectChange={handleObjectChange}
        />
      ) : null}
    </>
  )
}

export function CameraHelperView({
  cameraData,
  selected,
  readOnly,
  positionLocked,
  orbitControlsActive,
  navigationLockedRef,
  onSelect,
  onFocus,
  onTransformStart,
  onTransformEnd,
  onTransform,
}: {
  cameraData: Scene3DCamera
  selected: boolean
  readOnly: boolean
  positionLocked?: boolean
  orbitControlsActive: boolean
  navigationLockedRef: React.MutableRefObject<boolean>
  onSelect: () => void
  onFocus: () => void
  onTransformStart: () => void
  onTransformEnd: () => void
  onTransform: (patch: Partial<Scene3DCamera>) => void
}): JSX.Element {
  const markerRef = React.useRef<THREE.Group>(null)
  const positionDraggingRef = React.useRef(false)
  const aimDraggingRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    theta: number
    phi: number
    radius: number
    target: PointerCaptureTarget | null
  } | null>(null)
  const controlsEnabledBeforeDragRef = React.useRef<boolean | null>(null)
  const orbitControlsActiveRef = React.useRef(orbitControlsActive)
  const dragPlaneRef = React.useRef(new THREE.Plane())
  const dragHitRef = React.useRef(new THREE.Vector3())
  const dragOffsetRef = React.useRef(new THREE.Vector3())
  const { controls } = useThree()
  const target = cameraData.target || CAMERA_DEFAULT_TARGET
  const cameraPosition = React.useMemo(() => vectorFromArray(cameraData.position), [cameraData.position])
  const cameraRotation = React.useMemo(
    () => cameraLookAtRotation(cameraData.position, target),
    [cameraData.position, target],
  )

  React.useEffect(() => () => {
    navigationLockedRef.current = false
    if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current !== null) {
      ;(controls as { enabled: boolean }).enabled = orbitControlsActiveRef.current
        ? controlsEnabledBeforeDragRef.current
        : false
    }
  }, [controls, navigationLockedRef])

  React.useLayoutEffect(() => {
    orbitControlsActiveRef.current = orbitControlsActive
    if (!orbitControlsActive && controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current === null) {
      ;(controls as { enabled: boolean }).enabled = false
    }
  }, [controls, orbitControlsActive])

  const setSceneControlsDragging = React.useCallback((dragging: boolean) => {
    navigationLockedRef.current = dragging
    if (!controls || !('enabled' in controls)) return
    const orbitControls = controls as { enabled: boolean }
    if (dragging) {
      if (controlsEnabledBeforeDragRef.current === null) {
        controlsEnabledBeforeDragRef.current = orbitControls.enabled
      }
      orbitControls.enabled = false
      return
    }
    if (controlsEnabledBeforeDragRef.current !== null) {
      orbitControls.enabled = orbitControlsActiveRef.current ? controlsEnabledBeforeDragRef.current : false
      controlsEnabledBeforeDragRef.current = null
    }
  }, [controls, navigationLockedRef])

  const stopScenePointerEvent = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    event.nativeEvent.preventDefault()
    event.nativeEvent.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    event.stopPropagation()
  }, [])

  const updatePositionFromEvent = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    const hit = event.ray.intersectPlane(dragPlaneRef.current, dragHitRef.current)
    if (!hit) return
    const nextPosition = vectorToArray(hit.clone().add(dragOffsetRef.current))
    onTransform({
      position: nextPosition,
      rotation: cameraLookAtRotation(nextPosition, target),
    })
  }, [onTransform, target])

  const handlePositionPointerDown = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    stopScenePointerEvent(event)
    onSelect()
    orbitControlsActiveRef.current = false
    if (readOnly || positionLocked) return
    onTransformStart()
    setSceneControlsDragging(true)
    const planeNormal = new THREE.Vector3()
    event.camera.getWorldDirection(planeNormal)
    planeNormal.normalize()
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNormal, cameraPosition)
    const hit = event.ray.intersectPlane(dragPlaneRef.current, dragHitRef.current)
    dragOffsetRef.current.copy(hit ? cameraPosition.clone().sub(hit) : new THREE.Vector3())
    positionDraggingRef.current = true
    pointerCaptureTarget(event.target)?.setPointerCapture?.(event.pointerId)
  }, [cameraPosition, onSelect, onTransformStart, positionLocked, readOnly, setSceneControlsDragging, stopScenePointerEvent])

  const handlePositionPointerMove = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!positionDraggingRef.current || readOnly) return
    stopScenePointerEvent(event)
    updatePositionFromEvent(event)
  }, [readOnly, stopScenePointerEvent, updatePositionFromEvent])

  const stopCameraDrag = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!positionDraggingRef.current) return
    stopScenePointerEvent(event)
    positionDraggingRef.current = false
    setSceneControlsDragging(false)
    onTransformEnd()
    pointerCaptureTarget(event.target)?.releasePointerCapture?.(event.pointerId)
  }, [onTransformEnd, setSceneControlsDragging, stopScenePointerEvent])

  const updateAimFromDrag = React.useCallback((drag: NonNullable<typeof aimDraggingRef.current>, dx: number, dy: number, fine = false) => {
    const sensitivity = fine ? 0.003 : 0.008
    const phi = THREE.MathUtils.clamp(drag.phi - dy * sensitivity, 0.08, Math.PI - 0.08)
    const theta = drag.theta + dx * sensitivity
    const position = vectorFromArray(cameraData.position)
    const direction = new THREE.Vector3().setFromSpherical(new THREE.Spherical(drag.radius, phi, theta))
    const nextTarget = vectorToArray(position.clone().add(direction))
    onTransform({
      target: nextTarget,
      rotation: cameraLookAtRotation(cameraData.position, nextTarget),
    })
  }, [cameraData.position, onTransform])

  const handleAimPointerDown = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    stopScenePointerEvent(event)
    onSelect()
    orbitControlsActiveRef.current = false
    if (readOnly) return
    onTransformStart()
    const spherical = cameraAimSpherical(cameraData)
    aimDraggingRef.current = {
      pointerId: event.pointerId,
      startX: event.nativeEvent.clientX,
      startY: event.nativeEvent.clientY,
      theta: spherical.theta,
      phi: spherical.phi,
      radius: Math.max(0.75, spherical.radius),
      target: pointerCaptureTarget(event.target),
    }
    setSceneControlsDragging(true)
    pointerCaptureTarget(event.target)?.setPointerCapture?.(event.pointerId)
  }, [cameraData, onSelect, onTransformStart, readOnly, setSceneControlsDragging, stopScenePointerEvent])

  const handleAimPointerMove = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    const drag = aimDraggingRef.current
    if (!drag || drag.pointerId !== event.pointerId || readOnly) return
    stopScenePointerEvent(event)
    updateAimFromDrag(
      drag,
      event.nativeEvent.clientX - drag.startX,
      event.nativeEvent.clientY - drag.startY,
      event.nativeEvent.shiftKey,
    )
  }, [readOnly, stopScenePointerEvent, updateAimFromDrag])

  const stopAimDrag = React.useCallback((event: ThreeEvent<PointerEvent>) => {
    const drag = aimDraggingRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    stopScenePointerEvent(event)
    aimDraggingRef.current = null
    setSceneControlsDragging(false)
    onTransformEnd()
    pointerCaptureTarget(event.target)?.releasePointerCapture?.(event.pointerId)
  }, [onTransformEnd, setSceneControlsDragging, stopScenePointerEvent])

  React.useEffect(() => {
    const stopNativePointerEvent = (event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      const drag = aimDraggingRef.current
      if (!drag || drag.pointerId !== event.pointerId || readOnly) return
      stopNativePointerEvent(event)
      updateAimFromDrag(
        drag,
        event.clientX - drag.startX,
        event.clientY - drag.startY,
        event.shiftKey,
      )
    }

    const stopWindowAimDrag = (event: PointerEvent) => {
      const drag = aimDraggingRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      stopNativePointerEvent(event)
      aimDraggingRef.current = null
      setSceneControlsDragging(false)
      onTransformEnd()
      drag.target?.releasePointerCapture?.(drag.pointerId)
    }

    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true })
    window.addEventListener('pointerup', stopWindowAimDrag, { capture: true })
    window.addEventListener('pointercancel', stopWindowAimDrag, { capture: true })
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove, { capture: true })
      window.removeEventListener('pointerup', stopWindowAimDrag, { capture: true })
      window.removeEventListener('pointercancel', stopWindowAimDrag, { capture: true })
    }
  }, [onTransformEnd, readOnly, setSceneControlsDragging, updateAimFromDrag])

  const positionInteractionDisabled = Boolean(positionLocked)
  const lockedPositionRaycast = React.useCallback(() => null, [])
  const lockedRaycastProps = positionInteractionDisabled ? { raycast: lockedPositionRaycast } : undefined

  const marker = (
    <group
      ref={markerRef}
      userData={{ [CAMERA_HELPER_FLAG]: true, [SCENE3D_RUNTIME_ID_KEY]: cameraData.id }}
      visible={cameraData.visible}
      position={cameraData.position}
      rotation={cameraRotation}
      onPointerDown={positionInteractionDisabled ? undefined : handlePositionPointerDown}
      onPointerMove={positionInteractionDisabled ? undefined : handlePositionPointerMove}
      onPointerUp={positionInteractionDisabled ? undefined : stopCameraDrag}
      onPointerCancel={positionInteractionDisabled ? undefined : stopCameraDrag}
      onDoubleClick={positionInteractionDisabled ? undefined : (event) => {
        event.stopPropagation()
        onSelect()
        onFocus()
      }}
    >
      <CameraFrustumLines cameraData={cameraData} selected={selected} />
      {selected && !readOnly ? (
        <group
          position={[0, 0, -CAMERA_AIM_HANDLE_DISTANCE]}
          onPointerDown={handleAimPointerDown}
          onPointerMove={handleAimPointerMove}
          onPointerUp={stopAimDrag}
          onPointerCancel={stopAimDrag}
        >
          <lineSegments frustumCulled={false} raycast={() => null}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([
                  -0.14, 0, 0,
                  0.14, 0, 0,
                  0, -0.14, 0,
                  0, 0.14, 0,
                ]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#facc15" opacity={0.8} transparent toneMapped={false} />
          </lineSegments>
          <mesh>
            <sphereGeometry args={[0.075, 18, 12]} />
            <meshBasicMaterial color="#facc15" toneMapped={false} />
          </mesh>
        </group>
      ) : null}
      <mesh {...lockedRaycastProps}>
        <sphereGeometry args={[0.38, 16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh {...lockedRaycastProps}>
        <boxGeometry args={[0.14, 0.09, 0.08]} />
        <meshBasicMaterial
          color={selected ? '#facc15' : CAMERA_MARKER_COLOR}
          depthWrite={false}
          opacity={selected ? 0.92 : 0.58}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, -0.12]} rotation={[-Math.PI / 2, 0, 0]} {...lockedRaycastProps}>
        <coneGeometry args={[0.045, 0.09, 18]} />
        <meshBasicMaterial
          color={selected ? '#facc15' : CAMERA_MARKER_ACCENT_COLOR}
          depthWrite={false}
          opacity={selected ? 0.92 : 0.58}
          transparent
          toneMapped={false}
        />
      </mesh>
    </group>
  )

  return (
    <>
      {marker}
      {selected ? <CameraTargetFeedback cameraData={cameraData} /> : null}
    </>
  )
}

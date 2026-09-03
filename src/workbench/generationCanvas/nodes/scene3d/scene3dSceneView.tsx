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
  tagEditorOnlySubtree,
} from './scene3dMath'
import { pointerCaptureTarget } from './scene3dInput'
import type { PointerCaptureTarget } from './scene3dSharedTypes'
import {
  SCENE3D_EDITOR_ONLY_FLAG,
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
import { useScene3DObjectRefRegistration } from './trajectory/useScene3DObjectRefRegistration'
import {
  holdScene3DObjectRuntime,
  releaseScene3DObjectRuntime,
} from './trajectory/trajectoryRuntimeStore'
import {
  ProceduralMannequin,
  Mannequin,
  MannequinCrowd,
  ProceduralMannequinCrowd,
  LightObject,
  MannequinRoleLabel,
  MannequinFootRings,
  MannequinAssetBoundary,
  StaticObjectVisual,
  singleMannequinLabelPosition,
  crowdLabelPositions,
} from './scene3dObjects'
import { objectGroundFootprint, objectTransformAnchorPosition, objectVisualHalfHeight } from './scene3dCrowd'
import { mannequinRoleLabel } from './scene3dObjectNames'

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
    <lineSegments frustumCulled={false} raycast={() => null} userData={{ [SCENE3D_EDITOR_ONLY_FLAG]: true }}>
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
      <lineSegments frustumCulled={false} raycast={() => null} userData={{ [SCENE3D_EDITOR_ONLY_FLAG]: true }}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#facc15" opacity={0.62} transparent toneMapped={false} />
      </lineSegments>
      <mesh position={endpoint} raycast={() => null} userData={{ [SCENE3D_EDITOR_ONLY_FLAG]: true }}>
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
  activeClip,
  possessed,
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
  // possess 态被操控假人的 locomotion 动画 clip（idle/walk/run）。仅被操控的单个假人有值；
  // 其余对象/群众一律 undefined → Mannequin 走静态 pose 路径，零回归。
  activeClip?: string
  // 该假人正被 possess 直驱 → 脚环每帧跟住实时 group（不滞后）。其余 undefined → 静态脚环（零回归）。
  possessed?: boolean
  onSelect: () => void
  onFocus: () => void
  onTransformStart: () => void
  onTransformEnd: () => void
  onTransform: (patch: Partial<Scene3DObject>) => void
}): JSX.Element {
  const visualRef = React.useRef<THREE.Group>(null!) as React.MutableRefObject<THREE.Group>
  const anchorRef = React.useRef<THREE.Group>(null!) as React.MutableRefObject<THREE.Group>
  // 轨迹存脚底坐标，直驱 marker 需要抬到视觉中心；隐藏对象不应被播放层重新显示。
  useScene3DObjectRefRegistration(object.id, visualRef, {
    enabled: object.visible,
    positionOffsetY: objectVisualHalfHeight(object),
  })
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
    // gizmo 整树打 editor-only 标（2026-07-22 审计 P0：首尾帧/相机截图把操控球烧进导出）。
    // three-stdlib 的 TransformControls 自身是 Object3D；新版 three 则经 getHelper() 拿可视根。
    const gizmoRoot = typeof tc.getHelper === 'function' ? tc.getHelper() : tc
    if (gizmoRoot && typeof gizmoRoot.traverse === 'function') tagEditorOnlySubtree(gizmoRoot)
    const handler = (event: any) => {
      const dragging = Boolean(event.value)
      const wasDragging = transformDraggingRef.current
      transformDraggingRef.current = dragging
      navigationLockedRef.current = dragging
      if (dragging && !wasDragging) {
        orbitControlsActiveRef.current = false
        // 用户拖拽优先：手势期间挂 hold，直驱层（useTrajectoryAnimation 盖章）跳过该对象。
        holdScene3DObjectRuntime(object.id)
        onTransformStart()
      }
      if (!dragging && wasDragging) releaseScene3DObjectRuntime(object.id)
      if (controls && 'enabled' in controls) {
        ;(controls as { enabled: boolean }).enabled = dragging ? false : orbitControlsActiveRef.current
      }
    }
    tc.addEventListener('dragging-changed', handler)
    return () => {
      releaseScene3DObjectRuntime(object.id)
      if (transformDraggingRef.current) {
        navigationLockedRef.current = false
        transformDraggingRef.current = false
        onTransformEnd()
      }
      tc.removeEventListener('dragging-changed', handler)
    }
  }, [controls, navigationLockedRef, object.id, onTransformEnd, onTransformStart, selected])

  const handleTransformMouseDown = React.useCallback(() => {
    orbitControlsActiveRef.current = false
    navigationLockedRef.current = true
    holdScene3DObjectRuntime(object.id)
    onTransformStart()
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = false
    }
  }, [controls, navigationLockedRef, object.id, onTransformStart])

  const handleTransformMouseUp = React.useCallback(() => {
    navigationLockedRef.current = false
    releaseScene3DObjectRuntime(object.id)
    onTransformEnd()
    if (controls && 'enabled' in controls) {
      ;(controls as { enabled: boolean }).enabled = orbitControlsActiveRef.current
    }
  }, [controls, navigationLockedRef, object.id, onTransformEnd])

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
            <Mannequin color={object.color || '#808080'} pose={object.pose} activeClip={activeClip} />
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
        <StaticObjectVisual object={object} />
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
      {selected || possessed ? <MannequinFootRings object={object} possessed={possessed} /> : null}
      {/* #10 possess 时胸口「黑窗」真凶（截图查证）：MannequinRoleLabel 的名牌背景 = 深色
          #111827 plane（depthTest=false 永远画在身体之上）。它本应浮在头顶，但 mannequinLabelHeight
          对放大过的假人（scale 2.5）算出的高度落在躯干 → 名牌深底糊在胸/腰，看着就是「黑窗」。
          possess 直驱单个角色时本就不需要它的名牌（不用区分谁是谁），隐藏被操控角色自己的名牌即可，
          退出 possess 自动恢复（零回归：编排态、其它角色名牌不变）。 */}
      {object.type === 'mannequin' && roleLabel && !possessed
        ? <MannequinRoleLabel position={singleMannequinLabelPosition(object)} label={roleLabel} />
        : null}
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
  // 注册生命周期跟随 marker，取景往返重挂后不会继续写已经离场的 Object3D。
  useScene3DObjectRefRegistration(cameraData.id, markerRef, { enabled: cameraData.visible })
  // 位置拖拽会话（pointerId + capture 目标）。move/up 走 window 级监听（与 aim 拖拽同模式）：
  // r3f 的 pointer capture 一旦被环境打断（lostpointercapture 清 capturedMap），group 级
  // move 就只剩 raycast 命中才送——marker 若被直驱层钉住、指针滑出命中球即拖拽中途冻死
  // （2026-08-03 群反馈「拖到一半不跟手」的事件层根因）。window 监听不依赖 capture。
  const positionDragRef = React.useRef<{
    pointerId: number
    target: PointerCaptureTarget | null
  } | null>(null)
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
  const dragRaycasterRef = React.useRef(new THREE.Raycaster())
  const { controls, camera: viewCamera, gl } = useThree()
  const target = cameraData.target || CAMERA_DEFAULT_TARGET
  const cameraPosition = React.useMemo(() => vectorFromArray(cameraData.position), [cameraData.position])
  const cameraRotation = React.useMemo(
    () => cameraLookAtRotation(cameraData.position, target),
    [cameraData.position, target],
  )

  React.useEffect(() => () => {
    navigationLockedRef.current = false
    positionDragRef.current = null
    aimDraggingRef.current = null
    // 拖拽中途组件被卸载（如切取景态）→ 必须撤 hold，否则该对象永久不被直驱层盖章。
    releaseScene3DObjectRuntime(cameraData.id)
    if (controls && 'enabled' in controls && controlsEnabledBeforeDragRef.current !== null) {
      ;(controls as { enabled: boolean }).enabled = orbitControlsActiveRef.current
        ? controlsEnabledBeforeDragRef.current
        : false
    }
  }, [cameraData.id, controls, navigationLockedRef])

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

  const updatePositionFromRay = React.useCallback((ray: THREE.Ray) => {
    const hit = ray.intersectPlane(dragPlaneRef.current, dragHitRef.current)
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
    // 拖拽平面与偏移锚到 marker 的**视觉**位置——直驱层可能已把它盖章到与 state 不同的
    // 位置（如播放头停在轨迹中段），锚 state 会让球在第一步瞬移；抓哪儿就从哪儿跟手。
    const anchor = markerRef.current
      ? markerRef.current.getWorldPosition(new THREE.Vector3())
      : cameraPosition.clone()
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNormal, anchor)
    const hit = event.ray.intersectPlane(dragPlaneRef.current, dragHitRef.current)
    dragOffsetRef.current.copy(hit ? anchor.clone().sub(hit) : new THREE.Vector3())
    positionDragRef.current = {
      pointerId: event.pointerId,
      target: pointerCaptureTarget(event.target),
    }
    // 用户拖拽优先：拖拽期间直驱层（useTrajectoryAnimation 盖章）跳过这台相机。
    holdScene3DObjectRuntime(cameraData.id)
    pointerCaptureTarget(event.target)?.setPointerCapture?.(event.pointerId)
  }, [cameraData.id, cameraPosition, onSelect, onTransformStart, positionLocked, readOnly, setSceneControlsDragging, stopScenePointerEvent])

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
      const positionDrag = positionDragRef.current
      if (positionDrag && positionDrag.pointerId === event.pointerId && !readOnly) {
        stopNativePointerEvent(event)
        const rect = gl.domElement.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        dragRaycasterRef.current.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -(((event.clientY - rect.top) / rect.height) * 2 - 1),
          ),
          viewCamera,
        )
        updatePositionFromRay(dragRaycasterRef.current.ray)
        return
      }
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

    const stopWindowDrag = (event: PointerEvent) => {
      const positionDrag = positionDragRef.current
      if (positionDrag && positionDrag.pointerId === event.pointerId) {
        stopNativePointerEvent(event)
        positionDragRef.current = null
        setSceneControlsDragging(false)
        releaseScene3DObjectRuntime(cameraData.id)
        onTransformEnd()
        positionDrag.target?.releasePointerCapture?.(positionDrag.pointerId)
        return
      }
      const drag = aimDraggingRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      stopNativePointerEvent(event)
      aimDraggingRef.current = null
      setSceneControlsDragging(false)
      onTransformEnd()
      drag.target?.releasePointerCapture?.(drag.pointerId)
    }

    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true })
    window.addEventListener('pointerup', stopWindowDrag, { capture: true })
    window.addEventListener('pointercancel', stopWindowDrag, { capture: true })
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove, { capture: true })
      window.removeEventListener('pointerup', stopWindowDrag, { capture: true })
      window.removeEventListener('pointercancel', stopWindowDrag, { capture: true })
    }
  }, [cameraData.id, gl, onTransformEnd, readOnly, setSceneControlsDragging, updateAimFromDrag, updatePositionFromRay, viewCamera])

  const positionInteractionDisabled = Boolean(positionLocked)
  const lockedPositionRaycast = React.useCallback(() => null, [])
  const lockedRaycastProps = positionInteractionDisabled ? { raycast: lockedPositionRaycast } : undefined

  const marker = (
    <group
      ref={markerRef}
      userData={{ [SCENE3D_EDITOR_ONLY_FLAG]: true, [SCENE3D_RUNTIME_ID_KEY]: cameraData.id }}
      visible={cameraData.visible}
      position={cameraData.position}
      rotation={cameraRotation}
      onPointerDown={positionInteractionDisabled ? undefined : handlePositionPointerDown}
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

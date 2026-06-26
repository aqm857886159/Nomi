import React from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  CAMERA_DEFAULT_TARGET,
  FREE_LOOK_ROTATION_SPEED,
  WHEEL_TRAVEL_SPEED,
  type Scene3DMovementCode,
} from './scene3dConstants'
import {
  applyEditorCameraPose,
  applySceneCameraPose,
  aspectDimensions,
  cameraPoseSampleChanged,
  captureScene,
  clearMovementKeyState,
  eulerToArray,
  hasActiveMovementKey,
  isEditableKeyboardTarget,
  isMovementCode,
  pointerCaptureTarget,
  vectorFromArray,
  vectorToArray,
  type CameraPoseSample,
} from './scene3dMath'
import { objectGroundFootprint, objectVisualHalfHeight } from './scene3dCrowd'
import {
  type CaptureApi,
  type Scene3DCamera,
  type Scene3DObject,
  type Scene3DState,
  type Scene3DVector3,
} from './scene3dTypes'

const FOCUS_VIEW_DIRECTION = new THREE.Vector3(1, 0.62, 1).normalize()

function objectFocusTarget(object: Scene3DObject): THREE.Vector3 {
  const target = vectorFromArray(object.position)
  if (object.type === 'light') return target
  target.y += objectVisualHalfHeight(object) * 0.32
  return target
}

function objectFocusDistance(object: Scene3DObject): number {
  const footprint = objectGroundFootprint(object)
  const halfHeight = objectVisualHalfHeight(object)
  const radius = Math.max(footprint.width, footprint.depth, halfHeight * 2)
  return THREE.MathUtils.clamp(radius * 2.25 + 1.2, 3.2, 18)
}

function cameraFocusTarget(cameraData: Scene3DCamera): THREE.Vector3 {
  const position = vectorFromArray(cameraData.position)
  const target = vectorFromArray(cameraData.target || CAMERA_DEFAULT_TARGET)
  if (position.distanceToSquared(target) < 0.0001) return position
  return position.lerp(target, 0.45)
}

function cameraFocusDistance(cameraData: Scene3DCamera): number {
  const aimDistance = vectorFromArray(cameraData.position)
    .distanceTo(vectorFromArray(cameraData.target || CAMERA_DEFAULT_TARGET))
  return THREE.MathUtils.clamp(aimDistance * 0.9 + 1.6, 3.2, 16)
}

export function Scene3DControls({
  freeLook,
  selectionActive,
  speed,
  target,
  navigationLockedRef,
  onClearSelection,
  onWheelNavigation,
  onKeyboardNavigationStart,
  onKeyboardNavigationStop,
}: {
  freeLook: boolean
  selectionActive: boolean
  speed: number
  target: Scene3DVector3
  navigationLockedRef: React.MutableRefObject<boolean>
  onClearSelection: () => void
  onWheelNavigation: (cameraState: Scene3DState['editorCamera']) => void
  onKeyboardNavigationStart: () => void
  onKeyboardNavigationStop: () => void
}): JSX.Element {
  const { camera, gl, invalidate } = useThree()
  const direction = React.useRef(new THREE.Vector3())
  const desiredVelocity = React.useRef(new THREE.Vector3())
  const velocity = React.useRef(new THREE.Vector3())
  const orbitRef = React.useRef<any>(null)
  const dragSurfaceRef = React.useRef<THREE.Mesh>(null)
  const freeLookRef = React.useRef(freeLook)
  const selectionActiveRef = React.useRef(selectionActive)
  const targetRef = React.useRef<Scene3DVector3>(target)
  const keyboardNavigationRef = React.useRef(false)
  const keyStateRef = React.useRef<Record<Scene3DMovementCode, boolean>>({
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    Space: false,
    ShiftLeft: false,
    ShiftRight: false,
  })
  const draggingRef = React.useRef(false)
  const yawRef = React.useRef(0)
  const pitchRef = React.useRef(0)
  const cameraEulerRef = React.useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const dragPointerIdRef = React.useRef<number | null>(null)
  const clearSelectionTimeoutRef = React.useRef<number | null>(null)

  React.useLayoutEffect(() => {
    targetRef.current = target
    if (freeLook || !orbitRef.current) return
    orbitRef.current.target.set(target[0], target[1], target[2])
    orbitRef.current.update()
  }, [freeLook, target])

  React.useLayoutEffect(() => {
    freeLookRef.current = freeLook
    if (!freeLook) {
      draggingRef.current = false
      dragPointerIdRef.current = null
      if (!keyboardNavigationRef.current) clearMovementKeyState(keyStateRef.current)
      velocity.current.set(0, 0, 0)
      gl.domElement.style.cursor = ''
      return
    }
    gl.domElement.style.cursor = draggingRef.current ? 'grabbing' : 'grab'
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    pitchRef.current = euler.x
    yawRef.current = euler.y
  }, [camera, freeLook, gl])

  React.useLayoutEffect(() => {
    selectionActiveRef.current = selectionActive
  }, [selectionActive])

  React.useEffect(() => {
    const element = gl.domElement
    const updateCursor = () => {
      element.style.cursor = freeLookRef.current
        ? draggingRef.current ? 'grabbing' : 'grab'
        : ''
    }

    const stopDrag = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      dragPointerIdRef.current = null
      updateCursor()
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (navigationLockedRef.current) return
      if (!freeLookRef.current || !draggingRef.current) return
      if (dragPointerIdRef.current !== null && event.pointerId !== dragPointerIdRef.current) return
      yawRef.current -= event.movementX * FREE_LOOK_ROTATION_SPEED
      pitchRef.current -= event.movementY * FREE_LOOK_ROTATION_SPEED
      pitchRef.current = THREE.MathUtils.clamp(pitchRef.current, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02)
      camera.rotation.set(pitchRef.current, yawRef.current, 0, 'YXZ')
      camera.updateMatrixWorld()
      // frameloop=demand 下，free-look 鼠标转视直接改 camera.rotation（不走 React），需手动请求重绘。
      invalidate()
    }

    const handleWheel = (event: WheelEvent) => {
      if (isEditableKeyboardTarget(event.target)) return
      if (navigationLockedRef.current) return
      if (Math.abs(event.deltaY) < 0.01) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const direction = new THREE.Vector3()
      camera.getWorldDirection(direction)
      const distance = THREE.MathUtils.clamp(Math.abs(event.deltaY) * WHEEL_TRAVEL_SPEED, 0.12, 2.4)
      const signedDistance = event.deltaY > 0 ? -distance : distance
      const offset = direction.clone().multiplyScalar(signedDistance)
      camera.position.add(offset)

      const controls = orbitRef.current
      const nextTarget = !freeLookRef.current && controls?.target instanceof THREE.Vector3
        ? controls.target.clone()
        : vectorFromArray(targetRef.current)
      nextTarget.add(offset)
      if (!freeLookRef.current && controls?.target instanceof THREE.Vector3) {
        controls.target.copy(nextTarget)
        controls.update()
      }
      camera.updateMatrixWorld()
      invalidate()
      targetRef.current = vectorToArray(nextTarget)
      onWheelNavigation({
        position: vectorToArray(camera.position),
        target: targetRef.current,
        rotation: eulerToArray(camera.rotation),
        mode: 'fly',
      })
    }

    element.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    updateCursor()
    return () => {
      if (clearSelectionTimeoutRef.current !== null) {
        window.clearTimeout(clearSelectionTimeoutRef.current)
        clearSelectionTimeoutRef.current = null
      }
      element.removeEventListener('wheel', handleWheel, { capture: true })
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
      element.style.cursor = ''
    }
  }, [camera, gl, invalidate, navigationLockedRef, onWheelNavigation])

  React.useEffect(() => {
    const clearKeys = () => {
      clearMovementKeyState(keyStateRef.current)
      if (keyboardNavigationRef.current) {
        keyboardNavigationRef.current = false
        onKeyboardNavigationStop()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target) || !isMovementCode(event.code)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if ((selectionActiveRef.current || !freeLookRef.current) && !keyboardNavigationRef.current) {
        keyboardNavigationRef.current = true
        onKeyboardNavigationStart()
      }
      event.preventDefault()
      event.stopPropagation()
      keyStateRef.current[event.code] = true
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target) || !isMovementCode(event.code)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (!freeLookRef.current && !keyboardNavigationRef.current) return
      event.preventDefault()
      event.stopPropagation()
      keyStateRef.current[event.code] = false
      if (keyboardNavigationRef.current && !hasActiveMovementKey(keyStateRef.current)) {
        keyboardNavigationRef.current = false
        onKeyboardNavigationStop()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('blur', clearKeys)
    }
  }, [camera, gl, onKeyboardNavigationStart, onKeyboardNavigationStop])

  useFrame((_, delta) => {
    if (!freeLookRef.current && !keyboardNavigationRef.current) {
      velocity.current.set(0, 0, 0)
      return
    }
    dragSurfaceRef.current?.position.copy(camera.position)
    if (!draggingRef.current) {
      const euler = cameraEulerRef.current.setFromQuaternion(camera.quaternion, 'YXZ')
      pitchRef.current = euler.x
      yawRef.current = euler.y
    }
    const keys = keyStateRef.current
    const dir = direction.current.set(0, 0, 0)
    if (keys.KeyW || keys.ArrowUp) dir.z -= 1
    if (keys.KeyS || keys.ArrowDown) dir.z += 1
    if (keys.KeyA || keys.ArrowLeft) dir.x -= 1
    if (keys.KeyD || keys.ArrowRight) dir.x += 1
    if (keys.Space) dir.y += 1
    if (keys.ShiftLeft || keys.ShiftRight) dir.y -= 1
    if (dir.lengthSq() > 0) {
      dir.normalize().applyQuaternion(camera.quaternion).multiplyScalar(speed)
      desiredVelocity.current.copy(dir)
    } else {
      desiredVelocity.current.set(0, 0, 0)
    }

    const blend = 1 - Math.exp(-(dir.lengthSq() > 0 ? 12 : 9) * delta)
    velocity.current.lerp(desiredVelocity.current, blend)
    if (velocity.current.lengthSq() < 0.000001) velocity.current.set(0, 0, 0)
    camera.position.addScaledVector(velocity.current, delta)
    // frameloop=demand：键盘飞行靠自请求帧维持（按键中或减速滑行中）；完全停下不再 invalidate → 回到静止零渲染。
    if (dir.lengthSq() > 0 || velocity.current.lengthSq() > 0) invalidate()
  })

  return (
    <>
      <OrbitControls
        ref={orbitRef}
        enabled={!freeLook}
        makeDefault={!freeLook}
        enableDamping
        dampingFactor={0.15}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null as unknown as THREE.MOUSE }}
      />
      {freeLook ? (
        <mesh
          ref={dragSurfaceRef}
          frustumCulled={false}
          scale={500}
          onPointerDown={(event) => {
            if (navigationLockedRef.current) return
            if (!freeLookRef.current || event.button !== 0 || isEditableKeyboardTarget(event.nativeEvent.target)) return
            event.stopPropagation()
            if (selectionActiveRef.current) {
              if (clearSelectionTimeoutRef.current !== null) window.clearTimeout(clearSelectionTimeoutRef.current)
              clearSelectionTimeoutRef.current = window.setTimeout(() => {
                clearSelectionTimeoutRef.current = null
                if (!navigationLockedRef.current) onClearSelection()
              }, 0)
            }
            draggingRef.current = true
            dragPointerIdRef.current = event.pointerId
            pointerCaptureTarget(event.target)?.setPointerCapture?.(event.pointerId)
            gl.domElement.style.cursor = 'grabbing'
          }}
        >
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </>
  )
}

export function InitialCameraPose({ editorCamera }: { editorCamera: Scene3DState['editorCamera'] }): null {
  const { camera } = useThree()
  const initialized = React.useRef(false)

  React.useLayoutEffect(() => {
    if (initialized.current) return
    initialized.current = true
    applyEditorCameraPose(camera, editorCamera)
  }, [camera, editorCamera])

  return null
}

export function FocusController({
  focusId,
  objects,
  cameras,
  onCameraChange,
  onFocusConsumed,
}: {
  focusId: string
  objects: Scene3DObject[]
  cameras: Scene3DCamera[]
  onCameraChange: (cameraState: Scene3DState['editorCamera']) => void
  onFocusConsumed: () => void
}): null {
  const { camera, controls, invalidate } = useThree()
  const lastFocusRef = React.useRef('')

  React.useEffect(() => {
    if (!focusId || lastFocusRef.current === focusId) return
    const targetId = focusId.split(':')[0] || focusId
    const object = objects.find((candidate) => candidate.id === targetId)
    const sceneCamera = cameras.find((candidate) => candidate.id === targetId)
    if (!object && !sceneCamera) return
    lastFocusRef.current = focusId
    const target = object ? objectFocusTarget(object) : cameraFocusTarget(sceneCamera!)
    const distance = object ? objectFocusDistance(object) : cameraFocusDistance(sceneCamera!)
    const nextPosition = vectorToArray(target.clone().addScaledVector(FOCUS_VIEW_DIRECTION, distance))
    const nextTarget = vectorToArray(target)
    applyEditorCameraPose(camera, {
      position: nextPosition,
      target: nextTarget,
    })
    syncOrbitControlsTarget(controls, target)
    onCameraChange({
      position: nextPosition,
      target: nextTarget,
      rotation: eulerToArray(camera.rotation),
      mode: 'fly',
    })
    onFocusConsumed()
    // demand 下聚焦移动相机走 effect（不走 useFrame），需请求重绘。
    invalidate()
  }, [camera, cameras, controls, focusId, invalidate, objects, onCameraChange, onFocusConsumed])

  return null
}

function orbitControlsTarget(controls: unknown): THREE.Vector3 | null {
  return controls && typeof controls === 'object' && 'target' in controls && (controls as { target?: unknown }).target instanceof THREE.Vector3
    ? (controls as { target: THREE.Vector3 }).target
    : null
}

function syncOrbitControlsTarget(controls: unknown, target: THREE.Vector3): void {
  const controlsTarget = orbitControlsTarget(controls)
  if (!controlsTarget) return
  controlsTarget.copy(target)
  if ('update' in (controls as object) && typeof (controls as { update?: unknown }).update === 'function') {
    ;(controls as { update: () => void }).update()
  }
}

export function CaptureBinder({
  cameras,
  setApi,
}: {
  cameras: Scene3DCamera[]
  setApi: (api: CaptureApi | null) => void
}): null {
  const { gl, scene, camera, size } = useThree()

  React.useLayoutEffect(() => {
    setApi({
      captureViewport: () => {
        const width = Math.max(1, Math.round(gl.domElement.width || size.width))
        const height = Math.max(1, Math.round(gl.domElement.height || size.height))
        return captureScene(gl, scene, camera, width, height, '3D截图 - 当前视口', 'scene3d-viewport')
      },
      captureCamera: (sceneCamera) => {
        const dimensions = aspectDimensions(sceneCamera.aspectRatio)
        const captureCamera = new THREE.PerspectiveCamera(
          sceneCamera.fov,
          dimensions.width / dimensions.height,
          sceneCamera.near,
          sceneCamera.far,
        )
        applySceneCameraPose(captureCamera, sceneCamera)
        return captureScene(
          gl,
          scene,
          captureCamera,
          dimensions.width,
          dimensions.height,
          `3D截图 - ${sceneCamera.name}`,
          'scene3d-camera',
          true,
        )
      },
    })
    return () => setApi(null)
  }, [camera, cameras, gl, scene, setApi, size.height, size.width])

  return null
}

export function CameraViewEditController({
  cameraData,
  onCameraPatch,
  onEditorCameraDraft,
}: {
  cameraData?: Scene3DCamera
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEditorCameraDraft: (cameraState: Scene3DState['editorCamera']) => void
}): null {
  const { camera } = useThree()
  const activeCameraIdRef = React.useRef('')
  const targetDistanceRef = React.useRef(3)
  const lastPatchTimeRef = React.useRef(0)
  // 上一帧位姿采样（dirty 基准，复用 CameraStateRecorder 同一套扁平判断）+ 每帧复用的 Vector3。
  const lastSampleRef = React.useRef<CameraPoseSample | null>(null)
  const worldDirRef = React.useRef(new THREE.Vector3())

  React.useLayoutEffect(() => {
    if (!cameraData) {
      activeCameraIdRef.current = ''
      return
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = cameraData.fov
      camera.near = cameraData.near
      camera.far = cameraData.far
      camera.updateProjectionMatrix()
    }
    if (activeCameraIdRef.current === cameraData.id) return
    activeCameraIdRef.current = cameraData.id
    lastSampleRef.current = null // 换相机：清 dirty 基准，新相机首帧必提交
    targetDistanceRef.current = Math.max(
      0.75,
      vectorFromArray(cameraData.target || CAMERA_DEFAULT_TARGET).distanceTo(vectorFromArray(cameraData.position)),
    )
    applyEditorCameraPose(camera, {
      position: cameraData.position,
      target: cameraData.target || CAMERA_DEFAULT_TARGET,
    })
  }, [camera, cameraData])

  useFrame((state) => {
    if (!cameraData) return
    if (state.clock.elapsedTime - lastPatchTimeRef.current < 0.08) return
    lastPatchTimeRef.current = state.clock.elapsedTime

    const position = vectorToArray(camera.position)
    const direction = worldDirRef.current
    camera.getWorldDirection(direction)
    const target = vectorToArray(camera.position.clone().addScaledVector(direction, targetDistanceRef.current))
    const rotation = eulerToArray(camera.rotation)
    const editorCamera = { position, target, rotation, mode: 'fly' } satisfies Scene3DState['editorCamera']
    onEditorCameraDraft(editorCamera)
    // dirty 检测（复用 CameraStateRecorder 同一套扁平判断，P1 单一实现）：姿态无可见变化（含
    // 相机静止）→ 跳过 setState，不再每 80ms 重建 state.cameras 触发全场景 reconcile。运动时照常提交。
    const sample: CameraPoseSample = {
      px: position[0], py: position[1], pz: position[2],
      rx: rotation[0], ry: rotation[1], rz: rotation[2],
      tx: target[0], ty: target[1], tz: target[2],
    }
    if (!cameraPoseSampleChanged(lastSampleRef.current, sample)) return
    lastSampleRef.current = sample
    onCameraPatch(cameraData.id, { position, target, rotation })
  })

  return null
}

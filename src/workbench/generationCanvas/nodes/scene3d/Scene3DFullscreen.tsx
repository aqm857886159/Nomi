import React from 'react'
import { createPortal } from 'react-dom'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Environment,
  Grid,
  OrbitControls,
  Sky,
  TransformControls,
} from '@react-three/drei'
import {
  IconArrowsMove,
  IconBox,
  IconBulb,
  IconCamera,
  IconCube,
  IconCylinder,
  IconEye,
  IconListTree,
  IconMaximize,
  IconMinimize,
  IconPhoto,
  IconPlane,
  IconPlus,
  IconRotate,
  IconSettings,
  IconSphere,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import * as THREE from 'three'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../ui/toast'
import { cloneScene3DState } from './scene3dSerializer'
import { CameraStateRecorder } from './CameraStateRecorder'
import {
  SCENE3D_ASPECT_OPTIONS,
  SCENE3D_ASPECT_RATIOS,
  type Scene3DAspectRatio,
  type Scene3DCamera,
  type Scene3DCaptureResult,
  type Scene3DControlMode,
  type Scene3DGeometry,
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DTransformMode,
  type Scene3DVector3,
} from './scene3dTypes'

import {
  OBJECT_LIMIT,
  CAMERA_HELPER_FLAG,
  SCENE3D_GRID_FLAG,
  FULLSCREEN_Z_INDEX,
  CAMERA_MARKER_COLOR,
  CAMERA_MARKER_ACCENT_COLOR,
  CAMERA_HELPER_VISUAL_FAR,
  CAMERA_AIM_FEEDBACK_LENGTH,
  CAMERA_AIM_HANDLE_DISTANCE,
  CAMERA_DEFAULT_TARGET,
  FREE_LOOK_ROTATION_SPEED,
  WHEEL_TRAVEL_SPEED,
  GRID_CELL_COLOR,
  GRID_SECTION_COLOR,
  DARK_GRID_CELL_COLOR,
  DARK_GRID_SECTION_COLOR,
  type CrowdAddOptions,
  type Scene3DMovementCode,
} from './scene3dConstants'
import { PanelButton, CanvasPanelRestoreButton, SceneAddToolbar } from './scene3dToolbar'
import {
  isEditableKeyboardTarget,
  pointerCaptureTarget,
  vectorFromArray,
  vectorToArray,
  cameraLookAtRotation,
  levelEditorCameraRotation,
  applyEditorCameraPose,
  applySceneCameraPose,
  editorCameraFromSceneCamera,
  eulerToArray,
  vectorAlmostEqual,
  cameraPoseSampleChanged,
  type CameraPoseSample,
  crowdCount,
  aspectDimensions,
  captureScene,
  mannequinRoleLabel,
  makeObject,
  makeCrowdObject,
  makeCamera,
  cloneObjectForClipboard,
  cloneCameraForClipboard,
  makePastedObject,
  makePastedCamera,
  isMovementCode,
  clearMovementKeyState,
  hasActiveMovementKey,
  type PointerCaptureTarget,
} from './scene3dMath'
import { SceneObjectList, PropertyPanel } from './scene3dInspector'
import {
  Scene3DMeshGeometry,
  ProceduralMannequin,
  MannequinAssetBoundary,
  Mannequin,
  MannequinCrowd,
  ProceduralMannequinCrowd,
  LightObject,
  MannequinRoleLabel,
  singleMannequinLabelPosition,
  crowdLabelPositions,
  objectGroundFootprint,
  objectVisualHalfHeight,
  objectTransformAnchorPosition,
  nextAvailableObjectPosition,
  MannequinFootRings,
} from './scene3dObjects'

type Scene3DFullscreenProps = {
  initialState: Scene3DState
  nodeTitle: string
  readOnly?: boolean
  onClose: () => void
  onStateChange: (state: Scene3DState) => void
  onScreenshot: (capture: Scene3DCaptureResult) => void
}

type CaptureApi = {
  captureViewport: () => Scene3DCaptureResult | null
  captureCamera: (camera: Scene3DCamera) => Scene3DCaptureResult | null
}

type Scene3DClipboardItem =
  | { type: 'object'; item: Scene3DObject; pasteCount: number }
  | { type: 'camera'; item: Scene3DCamera; pasteCount: number }
function Scene3DControls({
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
  const { camera, gl } = useThree()
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
  }, [camera, gl, navigationLockedRef, onWheelNavigation])

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

function InitialCameraPose({ editorCamera }: { editorCamera: Scene3DState['editorCamera'] }): null {
  const { camera } = useThree()
  const initialized = React.useRef(false)

  React.useLayoutEffect(() => {
    if (initialized.current) return
    initialized.current = true
    applyEditorCameraPose(camera, editorCamera)
  }, [camera, editorCamera])

  return null
}

function FocusController({
  focusId,
  objects,
  cameras,
  onTargetChange,
  onFocusConsumed,
}: {
  focusId: string
  objects: Scene3DObject[]
  cameras: Scene3DCamera[]
  onTargetChange: (target: Scene3DVector3) => void
  onFocusConsumed: () => void
}): null {
  const { camera } = useThree()
  const lastFocusRef = React.useRef('')

  React.useEffect(() => {
    if (!focusId || lastFocusRef.current === focusId) return
    const targetId = focusId.split(':')[0] || focusId
    const object = objects.find((candidate) => candidate.id === targetId)
    const sceneCamera = cameras.find((candidate) => candidate.id === targetId)
    const position = object?.position || sceneCamera?.position
    if (!position) return
    lastFocusRef.current = focusId
    const target = vectorFromArray(position)
    applyEditorCameraPose(camera, {
      position: vectorToArray(target.clone().add(new THREE.Vector3(3.5, 2.2, 3.5))),
      target: vectorToArray(target),
    })
    onTargetChange(vectorToArray(target))
    onFocusConsumed()
  }, [camera, cameras, focusId, objects, onFocusConsumed, onTargetChange])

  return null
}

function CaptureBinder({
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

function CameraFrustumLines({
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

function CameraTargetFeedback({ cameraData }: { cameraData: Scene3DCamera }): JSX.Element {
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

function SceneObjectView({
  object,
  selected,
  readOnly,
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
      visible={object.visible}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onDoubleClick={(event) => {
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

function CameraHelperView({
  cameraData,
  selected,
  readOnly,
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
    if (readOnly) return
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
  }, [cameraPosition, onSelect, onTransformStart, readOnly, setSceneControlsDragging, stopScenePointerEvent])

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
  }, [readOnly, setSceneControlsDragging, updateAimFromDrag])

  const marker = (
    <group
      ref={markerRef}
      userData={{ [CAMERA_HELPER_FLAG]: true }}
      visible={cameraData.visible}
      position={cameraData.position}
      rotation={cameraRotation}
      onPointerDown={handlePositionPointerDown}
      onPointerMove={handlePositionPointerMove}
      onPointerUp={stopCameraDrag}
      onPointerCancel={stopCameraDrag}
      onDoubleClick={(event) => {
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
      <mesh>
        <sphereGeometry args={[0.38, 16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.14, 0.09, 0.08]} />
        <meshBasicMaterial
          color={selected ? '#facc15' : CAMERA_MARKER_COLOR}
          depthWrite={false}
          opacity={selected ? 0.92 : 0.58}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, -0.12]} rotation={[-Math.PI / 2, 0, 0]}>
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

function SceneContent({
  state,
  selection,
  readOnly,
  transformMode,
  flySpeed,
  focusId,
  viewLocked,
  cameraViewEditCamera,
  onSelect,
  onFocus,
  onObjectPatch,
  onCameraPatch,
  onEditorCameraDraft,
  onEditorCameraCommit,
  onEditorCameraTargetChange,
  onWheelNavigation,
  onTransformInteractionStart,
  onTransformInteractionEnd,
  onFocusConsumed,
  onKeyboardNavigationStart,
  onKeyboardNavigationStop,
  setCaptureApi,
}: {
  state: Scene3DState
  selection: Scene3DSelection
  readOnly: boolean
  transformMode: Scene3DTransformMode
  flySpeed: number
  focusId: string
  viewLocked: boolean
  cameraViewEditCamera?: Scene3DCamera
  onSelect: (selection: Scene3DSelection) => void
  onFocus: (id: string) => void
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEditorCameraDraft: (cameraState: Scene3DState['editorCamera']) => void
  onEditorCameraCommit: (cameraState: Scene3DState['editorCamera']) => void
  onEditorCameraTargetChange: (target: Scene3DVector3) => void
  onWheelNavigation: (cameraState: Scene3DState['editorCamera']) => void
  onTransformInteractionStart: () => void
  onTransformInteractionEnd: () => void
  onFocusConsumed: () => void
  onKeyboardNavigationStart: () => void
  onKeyboardNavigationStop: () => void
  setCaptureApi: (api: CaptureApi | null) => void
}): JSX.Element {
  const freeLook = !viewLocked
  const controlMode: Scene3DControlMode = freeLook ? 'fly' : 'edit'
  const cameraViewEditing = Boolean(cameraViewEditCamera)
  const navigationLockedRef = React.useRef(false)
  const mannequinRoleData = React.useMemo(() => {
    const labels = new Map<string, string>()
    const starts = new Map<string, number>()
    let index = 0
    state.objects.forEach((object) => {
      if (object.type === 'mannequin') {
        labels.set(object.id, mannequinRoleLabel(index))
        starts.set(object.id, index)
        index += 1
        return
      }
      if (object.type === 'mannequinCrowd') {
        starts.set(object.id, index)
        index += crowdCount(object)
      }
    })
    return { labels, starts }
  }, [state.objects])
  const gridCellColor = state.environment.darkMode ? DARK_GRID_CELL_COLOR : GRID_CELL_COLOR
  const gridSectionColor = state.environment.darkMode ? DARK_GRID_SECTION_COLOR : GRID_SECTION_COLOR

  return (
    <>
      <color attach="background" args={[state.environment.backgroundColor]} />
      <ambientLight intensity={0.65} />
      {state.environment.showSky ? <Sky sunPosition={[2, 1, 4]} /> : null}
      {state.environment.preset ? (
        <React.Suspense fallback={null}>
          <Environment preset="city" />
        </React.Suspense>
      ) : null}
      {state.environment.showGrid && !cameraViewEditing ? (
        <group userData={{ [SCENE3D_GRID_FLAG]: true }}>
          <Grid
            infiniteGrid
            cellSize={0.5}
            sectionSize={5}
            fadeDistance={42}
            fadeStrength={1.25}
            cellColor={gridCellColor}
            sectionColor={gridSectionColor}
          />
        </group>
      ) : null}
      {state.environment.showAxes && !cameraViewEditing ? <axesHelper args={[2]} /> : null}
      {state.objects.map((object) => (
        <SceneObjectView
          key={object.id}
          object={object}
          selected={selection?.type === 'object' && selection.id === object.id}
          readOnly={readOnly}
          transformMode={transformMode}
          orbitControlsActive={!freeLook}
          navigationLockedRef={navigationLockedRef}
          roleLabel={object.type === 'mannequin' ? mannequinRoleData.labels.get(object.id) : undefined}
          roleStartIndex={mannequinRoleData.starts.get(object.id)}
          onSelect={() => onSelect({ type: 'object', id: object.id })}
          onFocus={() => onFocus(object.id)}
          onTransformStart={onTransformInteractionStart}
          onTransformEnd={onTransformInteractionEnd}
          onTransform={(patch) => onObjectPatch(object.id, patch)}
        />
      ))}
      {!cameraViewEditing ? state.cameras.map((camera) => (
        <CameraHelperView
          key={camera.id}
          cameraData={camera}
          selected={selection?.type === 'camera' && selection.id === camera.id}
          readOnly={readOnly}
          orbitControlsActive={!freeLook}
          navigationLockedRef={navigationLockedRef}
          onSelect={() => onSelect({ type: 'camera', id: camera.id })}
          onFocus={() => onFocus(camera.id)}
          onTransformStart={onTransformInteractionStart}
          onTransformEnd={onTransformInteractionEnd}
          onTransform={(patch) => onCameraPatch(camera.id, patch)}
        />
      )) : null}
      <InitialCameraPose editorCamera={state.editorCamera} />
      <CameraViewEditController
        cameraData={cameraViewEditCamera}
        onCameraPatch={onCameraPatch}
        onEditorCameraDraft={onEditorCameraDraft}
      />
      <FocusController
        focusId={focusId}
        objects={state.objects}
        cameras={state.cameras}
        onTargetChange={onEditorCameraTargetChange}
        onFocusConsumed={onFocusConsumed}
      />
      <Scene3DControls
        freeLook={freeLook}
        selectionActive={selection !== null}
        speed={flySpeed}
        target={state.editorCamera.target}
        navigationLockedRef={navigationLockedRef}
        onClearSelection={() => onSelect(null)}
        onWheelNavigation={onWheelNavigation}
        onKeyboardNavigationStart={onKeyboardNavigationStart}
        onKeyboardNavigationStop={onKeyboardNavigationStop}
      />
      <CameraStateRecorder
        mode={controlMode}
        target={state.editorCamera.target}
        onDraftChange={onEditorCameraDraft}
        onCommit={onEditorCameraCommit}
      />
      <CaptureBinder cameras={state.cameras} setApi={setCaptureApi} />
    </>
  )
}

function cameraPreviewViewportStyle(aspectRatio: Scene3DAspectRatio): React.CSSProperties {
  const ratio = SCENE3D_ASPECT_RATIOS[aspectRatio]
  const maxWidth = 224
  const maxHeight = 240
  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return {
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`,
  }
}

function CameraPreviewPose({ cameraData }: { cameraData: Scene3DCamera }): null {
  const { camera } = useThree()

  React.useLayoutEffect(() => {
    applySceneCameraPose(camera, cameraData)
  }, [camera, cameraData])

  return null
}

function CameraViewEditController({
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

function PreviewObjectView({
  object,
  roleStartIndex = 0,
}: {
  object: Scene3DObject
  roleStartIndex?: number
}): JSX.Element {
  return (
    <group
      visible={object.visible}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
    >
      {object.type === 'mannequin' ? (
        <MannequinAssetBoundary fallback={<ProceduralMannequin color={object.color || '#808080'} />}>
          <React.Suspense fallback={<ProceduralMannequin color={object.color || '#808080'} />}>
            <Mannequin color={object.color || '#808080'} pose={object.pose} />
          </React.Suspense>
        </MannequinAssetBoundary>
      ) : object.type === 'mannequinCrowd' ? (
        <ProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex} />
      ) : object.type === 'light' ? (
        <LightObject object={object} />
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
    </group>
  )
}

function CameraPreviewScene({
  state,
  cameraData,
}: {
  state: Scene3DState
  cameraData: Scene3DCamera
}): JSX.Element {
  let roleIndex = 0
  return (
    <>
      <color attach="background" args={[state.environment.backgroundColor]} />
      <ambientLight intensity={0.65} />
      {state.environment.showSky ? <Sky sunPosition={[2, 1, 4]} /> : null}
      {state.environment.preset ? (
        <React.Suspense fallback={null}>
          <Environment preset="city" />
        </React.Suspense>
      ) : null}
      {state.environment.showAxes ? <axesHelper args={[2]} /> : null}
      {state.objects.map((object) => {
        const roleStartIndex = roleIndex
        if (object.type === 'mannequin') roleIndex += 1
        if (object.type === 'mannequinCrowd') roleIndex += crowdCount(object)
        return <PreviewObjectView key={object.id} object={object} roleStartIndex={roleStartIndex} />
      })}
      <CameraPreviewPose cameraData={cameraData} />
    </>
  )
}

function CameraPreview({
  camera,
  state,
  readOnly,
  cameraViewEditing,
  rightPanelCollapsed,
  onAspectChange,
  onLensDepthChange,
  onToggleViewEdit,
  onLevelCamera,
  onScreenshot,
}: {
  camera: Scene3DCamera
  state: Scene3DState
  readOnly: boolean
  cameraViewEditing: boolean
  rightPanelCollapsed: boolean
  onAspectChange: (aspectRatio: Scene3DAspectRatio) => void
  onLensDepthChange: (lensDepth: number) => void
  onToggleViewEdit: () => void
  onLevelCamera: () => void
  onScreenshot: () => void
}): JSX.Element {
  const previewStyle = React.useMemo(() => cameraPreviewViewportStyle(camera.aspectRatio), [camera.aspectRatio])
  const lensDepth = camera.lensDepth ?? 0

  return (
    <div
      className={cn(
        'absolute right-4 z-[3] w-[260px] rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2 text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        rightPanelCollapsed ? 'top-16' : 'top-4',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-caption font-medium">{camera.name} · {camera.aspectRatio}</div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-nomi-sm px-2 text-micro hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:opacity-40',
              cameraViewEditing ? 'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]' : 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)]',
            )}
            disabled={readOnly}
            type="button"
            title={cameraViewEditing ? '正在取景调整，按 Esc 或点击顶部退出' : '从相机视角调整'}
            onClick={onToggleViewEdit}
          >
            <IconEye size={14} />
            <span>取景</span>
          </button>
          <button
            className="grid size-7 place-items-center rounded-nomi-sm bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:opacity-40"
            disabled={readOnly}
            type="button"
            title="水平摆正"
            onClick={onLevelCamera}
          >
            <IconRotate size={14} />
          </button>
          <button className="grid size-7 place-items-center rounded-nomi-sm bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]" type="button" title="相机截图" onClick={onScreenshot}>
            <IconCamera size={15} />
          </button>
        </div>
      </div>
      <div className="flex min-h-[126px] items-center justify-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] p-1">
        <div className="overflow-hidden rounded-nomi-sm bg-[var(--nomi-ink)]" style={previewStyle}>
          <Canvas
            camera={{
              fov: camera.fov,
              near: camera.near,
              far: camera.far,
              position: camera.position,
              rotation: camera.rotation,
            }}
            dpr={[1, 1.5]}
            frameloop="demand"
            gl={{ antialias: true, preserveDrawingBuffer: false }}
          >
            <CameraPreviewScene state={state} cameraData={camera} />
          </Canvas>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1">
        {SCENE3D_ASPECT_OPTIONS.map((option) => (
          <button
            key={option}
            className={cn(
              'h-6 rounded-nomi-sm border border-[var(--nomi-line-soft)] text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              option === camera.aspectRatio && 'bg-[var(--nomi-ink)] text-[var(--nomi-paper)]',
            )}
            disabled={readOnly}
            type="button"
            onClick={() => onAspectChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-micro text-[var(--nomi-ink-60)]">
          <span>镜头深度</span>
          <span className="font-medium text-[var(--nomi-ink)]">{Math.round(lensDepth)}%</span>
        </div>
        <input
          className="block h-1.5 w-full accent-[var(--nomi-ink)]"
          disabled={readOnly}
          max={100}
          min={-100}
          step={1}
          type="range"
          value={lensDepth}
          onChange={(event) => onLensDepthChange(Number(event.currentTarget.value))}
        />
        <div className="mt-1 grid grid-cols-3 text-micro text-[var(--nomi-ink-45)]">
          <span>-100%</span>
          <span className="text-center">0</span>
          <span className="text-right">100%</span>
        </div>
      </div>
    </div>
  )
}

function cameraAimSpherical(camera: Scene3DCamera): THREE.Spherical {
  const direction = vectorFromArray(camera.target).sub(vectorFromArray(camera.position))
  if (direction.lengthSq() < 0.0001) direction.set(0, -0.2, 1)
  return new THREE.Spherical().setFromVector3(direction)
}

export default function Scene3DFullscreen({
  initialState,
  nodeTitle,
  readOnly = false,
  onClose,
  onStateChange,
  onScreenshot,
}: Scene3DFullscreenProps): JSX.Element {
  const [state, setState] = React.useState(() => cloneScene3DState(initialState))
  const [selection, setSelection] = React.useState<Scene3DSelection>(null)
  const [transformMode, setTransformMode] = React.useState<Scene3DTransformMode>('translate')
  const [viewLocked, setViewLocked] = React.useState(false)
  const controlMode: Scene3DControlMode = viewLocked ? 'edit' : 'fly'
  const controlModeRef = React.useRef<Scene3DControlMode>(controlMode)
  const [flySpeed, setFlySpeed] = React.useState(5)
  const [leftPanelOpen, setLeftPanelOpen] = React.useState(true)
  const [rightPanelOpen, setRightPanelOpen] = React.useState(true)
  const canvasFocusMode = !leftPanelOpen || !rightPanelOpen
  const [focusId, setFocusId] = React.useState('')
  const [cameraViewEditId, setCameraViewEditId] = React.useState<string | null>(null)
  const captureApiRef = React.useRef<CaptureApi | null>(null)
  const initialEditorCameraRef = React.useRef<Scene3DState['editorCamera']>({
    ...initialState.editorCamera,
    rotation: levelEditorCameraRotation(initialState.editorCamera.position, initialState.editorCamera.target),
  })
  const latestEditorCameraRef = React.useRef<Scene3DState['editorCamera']>(initialEditorCameraRef.current)
  const stateRef = React.useRef(state)
  const selectionRef = React.useRef<Scene3DSelection>(selection)
  const suspendedKeyboardSelectionRef = React.useRef<Exclude<Scene3DSelection, null> | null>(null)
  const clipboardRef = React.useRef<Scene3DClipboardItem | null>(null)
  const suppressCanvasMissedSelectionRef = React.useRef(false)
  const suppressCanvasMissedReleaseRef = React.useRef<number | null>(null)
  const onStateChangeRef = React.useRef(onStateChange)
  const canvasCamera = React.useMemo(() => ({
    fov: 55,
    near: 0.1,
    far: 500,
    position: initialEditorCameraRef.current.position,
  }), [])
  const selectedCamera = selection?.type === 'camera'
    ? state.cameras.find((camera) => camera.id === selection.id)
    : undefined
  const cameraViewEditCamera = cameraViewEditId
    ? state.cameras.find((camera) => camera.id === cameraViewEditId)
    : undefined

  React.useEffect(() => {
    stateRef.current = state
  }, [state])

  React.useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  React.useEffect(() => {
    controlModeRef.current = controlMode
    latestEditorCameraRef.current = {
      ...latestEditorCameraRef.current,
      mode: controlMode,
    }
  }, [controlMode])

  React.useEffect(() => {
    onStateChangeRef.current = onStateChange
  }, [onStateChange])

  React.useEffect(() => {
    onStateChangeRef.current(state)
  }, [state])

  React.useEffect(() => () => {
    if (suppressCanvasMissedReleaseRef.current !== null) {
      window.clearTimeout(suppressCanvasMissedReleaseRef.current)
      suppressCanvasMissedReleaseRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const { body } = document
    const previousOverflow = body.style.overflow
    const previousOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = previousOverflow
      body.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  const selectSceneItem = React.useCallback((nextSelection: Scene3DSelection) => {
    setSelection(nextSelection)
    setViewLocked(false)
    setFocusId('')
  }, [])

  const clearSelection = React.useCallback(() => {
    if (suppressCanvasMissedSelectionRef.current) return
    setSelection(null)
    setViewLocked(false)
    setFocusId('')
  }, [])

  const focusSceneItem = React.useCallback((id: string) => {
    if (cameraViewEditId) return
    setViewLocked(true)
    setFocusId(`${id}:${Date.now()}`)
  }, [cameraViewEditId])

  const patchObject = React.useCallback((id: string, patch: Partial<Scene3DObject>) => {
    setState((current) => ({
      ...current,
      objects: current.objects.map((object) => (object.id === id ? { ...object, ...patch } : object)),
    }))
  }, [])

  const patchCamera = React.useCallback((id: string, patch: Partial<Scene3DCamera>) => {
    setState((current) => ({
      ...current,
      cameras: current.cameras.map((camera) => (camera.id === id ? { ...camera, ...patch } : camera)),
    }))
  }, [])

  const deleteSceneItem = React.useCallback((target: Exclude<Scene3DSelection, null>) => {
    if (readOnly) return
    setState((current) => target.type === 'object'
      ? {
          ...current,
          objects: current.objects.filter((object) => object.id !== target.id),
        }
      : {
          ...current,
          cameras: current.cameras.filter((camera) => camera.id !== target.id),
        })
    if (selectionRef.current?.type === target.type && selectionRef.current.id === target.id) {
      setViewLocked(false)
    }
    if (target.type === 'camera') {
      setCameraViewEditId((current) => (current === target.id ? null : current))
    }
    setSelection((current) => (current?.type === target.type && current.id === target.id ? null : current))
  }, [readOnly])

  const addObject = React.useCallback((kind: Scene3DGeometry | 'mannequin' | 'light') => {
    if (readOnly) return
    if (state.objects.length >= OBJECT_LIMIT) {
      toast('单个 3D 场景最多支持 100 个对象', 'warning')
      return
    }
    const roleIndex = kind === 'mannequin'
      ? stateRef.current.objects.reduce((count, object) => {
        if (object.type === 'mannequin') return count + 1
        if (object.type === 'mannequinCrowd') return count + crowdCount(object)
        return count
      }, 0)
      : 0
    const object = makeObject(kind, roleIndex)
    if (object.type === 'mannequin') {
      object.position = nextAvailableObjectPosition(object, stateRef.current.objects)
    }
    setState((current) => ({ ...current, objects: [...current.objects, object] }))
    setSelection({ type: 'object', id: object.id })
    setViewLocked(false)
  }, [readOnly, state.objects.length])

  const addCamera = React.useCallback(() => {
    if (readOnly) return
    const camera = makeCamera(state.cameras.length)
    setState((current) => ({ ...current, cameras: [...current.cameras, camera] }))
    setSelection({ type: 'camera', id: camera.id })
    setViewLocked(false)
  }, [readOnly, state.cameras.length])

  const addCrowd = React.useCallback((options: CrowdAddOptions) => {
    if (readOnly) return
    if (state.objects.length >= OBJECT_LIMIT) {
      toast('单个 3D 场景最多支持 100 个对象', 'warning')
      return
    }
    const crowd = makeCrowdObject(options)
    crowd.position = nextAvailableObjectPosition(crowd, stateRef.current.objects)
    setState((current) => ({ ...current, objects: [...current.objects, crowd] }))
    setSelection({ type: 'object', id: crowd.id })
    setViewLocked(false)
  }, [readOnly, state.objects.length])

  const startKeyboardNavigation = React.useCallback(() => {
    const currentSelection = selectionRef.current
    setViewLocked(false)
    setFocusId('')
    if (!currentSelection) return
    if (!suspendedKeyboardSelectionRef.current) {
      suspendedKeyboardSelectionRef.current = currentSelection
    }
    setSelection(null)
  }, [])

  const stopKeyboardNavigation = React.useCallback(() => {
    const suspendedSelection = suspendedKeyboardSelectionRef.current
    if (!suspendedSelection) return
    suspendedKeyboardSelectionRef.current = null

    const currentState = stateRef.current
    const stillExists = suspendedSelection.type === 'object'
      ? currentState.objects.some((object) => object.id === suspendedSelection.id)
      : currentState.cameras.some((camera) => camera.id === suspendedSelection.id)
    setSelection(stillExists ? suspendedSelection : null)
  }, [])

  const copySelection = React.useCallback(() => {
    const currentSelection = selectionRef.current
    if (!currentSelection) return false

    if (currentSelection.type === 'object') {
      const object = stateRef.current.objects.find((candidate) => candidate.id === currentSelection.id)
      if (!object) return false
      clipboardRef.current = {
        type: 'object',
        item: cloneObjectForClipboard(object),
        pasteCount: 0,
      }
      return true
    }

    const camera = stateRef.current.cameras.find((candidate) => candidate.id === currentSelection.id)
    if (!camera) return false
    clipboardRef.current = {
      type: 'camera',
      item: cloneCameraForClipboard(camera),
      pasteCount: 0,
    }
    return true
  }, [])

  const pasteClipboard = React.useCallback(() => {
    if (readOnly) return false
    const clipboard = clipboardRef.current
    if (!clipboard) return false
    const pasteCount = clipboard.pasteCount + 1

    if (clipboard.type === 'object') {
      const current = stateRef.current
      if (current.objects.length >= OBJECT_LIMIT) {
        toast('单个 3D 场景最多支持 100 个对象', 'warning')
        return true
      }
      const object = makePastedObject(clipboard.item, pasteCount)
      const nextState = {
        ...current,
        objects: [...current.objects, object],
      }
      clipboardRef.current = { ...clipboard, pasteCount }
      stateRef.current = nextState
      setState(nextState)
      setSelection({ type: 'object', id: object.id })
      setViewLocked(false)
      return true
    }

    const current = stateRef.current
    const camera = makePastedCamera(clipboard.item, pasteCount)
    const nextState = {
      ...current,
      cameras: [...current.cameras, camera],
    }
    clipboardRef.current = { ...clipboard, pasteCount }
    stateRef.current = nextState
    setState(nextState)
    setSelection({ type: 'camera', id: camera.id })
    setViewLocked(false)
    return true
  }, [readOnly])

  const captureViewport = React.useCallback(() => {
    const capture = captureApiRef.current?.captureViewport()
    if (!capture) {
      toast('截图失败，请重试', 'error')
      return
    }
    onScreenshot(capture)
  }, [onScreenshot])

  const captureSelectedCamera = React.useCallback(() => {
    if (!selectedCamera) {
      toast('请先选中一个拍摄相机', 'warning')
      return
    }
    const capture = captureApiRef.current?.captureCamera(selectedCamera)
    if (!capture) {
      toast('相机截图失败，请重试', 'error')
      return
    }
    onScreenshot(capture)
  }, [onScreenshot, selectedCamera])

  const updateEditorCamera = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    setState((current) => {
      const nextEditorCamera = {
        ...current.editorCamera,
        ...editorCamera,
      }
      if (
        current.editorCamera.mode === nextEditorCamera.mode &&
        vectorAlmostEqual(current.editorCamera.position, nextEditorCamera.position) &&
        vectorAlmostEqual(current.editorCamera.rotation, nextEditorCamera.rotation) &&
        vectorAlmostEqual(current.editorCamera.target, nextEditorCamera.target)
      ) {
        return current
      }
      return {
        ...current,
        editorCamera: nextEditorCamera,
      }
    })
  }, [])

  const updateEditorCameraTarget = React.useCallback((target: Scene3DVector3) => {
    latestEditorCameraRef.current = {
      ...latestEditorCameraRef.current,
      target,
    }
    setState((current) => vectorAlmostEqual(current.editorCamera.target, target)
      ? current
      : {
          ...current,
          editorCamera: {
            ...current.editorCamera,
            target,
          },
        })
  }, [])

  const handleWheelNavigation = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    latestEditorCameraRef.current = editorCamera
    setViewLocked(false)
    setFocusId('')
    updateEditorCamera(editorCamera)
  }, [updateEditorCamera])

  const unlockViewForSceneEdit = React.useCallback(() => {
    suppressCanvasMissedSelectionRef.current = true
    if (suppressCanvasMissedReleaseRef.current !== null) {
      window.clearTimeout(suppressCanvasMissedReleaseRef.current)
      suppressCanvasMissedReleaseRef.current = null
    }
    setViewLocked(false)
    setFocusId('')
  }, [])

  const finishSceneTransformInteraction = React.useCallback(() => {
    if (suppressCanvasMissedReleaseRef.current !== null) {
      window.clearTimeout(suppressCanvasMissedReleaseRef.current)
    }
    suppressCanvasMissedReleaseRef.current = window.setTimeout(() => {
      suppressCanvasMissedSelectionRef.current = false
      suppressCanvasMissedReleaseRef.current = null
    }, 160)
  }, [])

  const handleEditorCameraDraft = React.useCallback((editorCamera: Scene3DState['editorCamera']) => {
    latestEditorCameraRef.current = editorCamera
  }, [])

  React.useEffect(() => {
    if (cameraViewEditId && !cameraViewEditCamera) {
      setCameraViewEditId(null)
    }
  }, [cameraViewEditCamera, cameraViewEditId])

  const enterCameraViewEdit = React.useCallback((cameraData: Scene3DCamera) => {
    if (readOnly) return
    const editorCamera = editorCameraFromSceneCamera(cameraData)
    latestEditorCameraRef.current = editorCamera
    setSelection({ type: 'camera', id: cameraData.id })
    setCameraViewEditId(cameraData.id)
    setViewLocked(false)
    setFocusId('')
    updateEditorCamera(editorCamera)
  }, [readOnly, updateEditorCamera])

  const exitCameraViewEdit = React.useCallback(() => {
    setCameraViewEditId(null)
    setViewLocked(false)
    setFocusId('')
  }, [])

  const toggleCameraViewEdit = React.useCallback(() => {
    if (!selectedCamera || readOnly) return
    if (cameraViewEditId === selectedCamera.id) {
      return
    }
    enterCameraViewEdit(selectedCamera)
  }, [cameraViewEditId, enterCameraViewEdit, readOnly, selectedCamera])

  const levelSelectedCamera = React.useCallback(() => {
    if (!selectedCamera || readOnly) return
    patchCamera(selectedCamera.id, {
      rotation: cameraLookAtRotation(selectedCamera.position, selectedCamera.target),
    })
  }, [patchCamera, readOnly, selectedCamera])

  const flushLatestState = React.useCallback(() => {
    const latestState = {
      ...stateRef.current,
      editorCamera: {
        ...latestEditorCameraRef.current,
        mode: controlModeRef.current,
      },
    }
    stateRef.current = latestState
    onStateChangeRef.current(latestState)
    return latestState
  }, [])

  const handleClose = React.useCallback(() => {
    flushLatestState()
    onClose()
  }, [flushLatestState, onClose])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcutKey = event.key.toLowerCase()
      const isModifierShortcut = event.ctrlKey || event.metaKey
      if (
        shortcutKey === 'r' &&
        !event.repeat &&
        !isModifierShortcut &&
        !event.altKey &&
        !isEditableKeyboardTarget(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
        setTransformMode((mode) => (mode === 'rotate' ? 'translate' : 'rotate'))
        return
      }
      if (isModifierShortcut && !event.altKey && !isEditableKeyboardTarget(event.target)) {
        if (shortcutKey === 'c' && copySelection()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (shortcutKey === 'v' && pasteClipboard()) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
      }
      if (event.key === 'Delete' && !isEditableKeyboardTarget(event.target)) {
        const currentSelection = selectionRef.current
        if (currentSelection) {
          event.preventDefault()
          event.stopPropagation()
          deleteSceneItem(currentSelection)
          return
        }
      }
      if (event.key === 'Escape' && !document.pointerLockElement) {
        if (cameraViewEditId) {
          event.preventDefault()
          event.stopPropagation()
          exitCameraViewEdit()
          return
        }
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [cameraViewEditId, copySelection, deleteSceneItem, exitCameraViewEdit, handleClose, pasteClipboard])

  React.useEffect(() => () => {
    flushLatestState()
  }, [flushLatestState])

  const toggleCanvasFocusMode = React.useCallback(() => {
    if (leftPanelOpen && rightPanelOpen) {
      setLeftPanelOpen(false)
      setRightPanelOpen(false)
      return
    }
    setLeftPanelOpen(true)
    setRightPanelOpen(true)
  }, [leftPanelOpen, rightPanelOpen])

  const editorShell = (
    <div
      className="workbench-shell fixed inset-0 isolate flex h-[100dvh] w-screen flex-col overflow-hidden bg-[var(--workbench-bg)] text-[var(--workbench-ink)] font-[var(--nomi-font-sans)]"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        minWidth: '100vw',
        minHeight: '100dvh',
        zIndex: FULLSCREEN_Z_INDEX,
        background: 'var(--workbench-bg)',
        pointerEvents: 'auto',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="3D 场景编辑器"
      tabIndex={0}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-[0_1px_0_rgba(18,24,38,0.04)]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconCube size={18} className="shrink-0 text-[var(--workbench-muted)]" />
          <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">{nodeTitle}</div>
        </div>
        <div className="ml-auto flex min-w-0 max-w-[72vw] items-center gap-2 overflow-x-auto">
          <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
            <PanelButton title="移动" active={transformMode === 'translate'} onClick={() => setTransformMode('translate')}>
              <IconArrowsMove size={15} />
            </PanelButton>
            <PanelButton title="旋转" active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')}>
              <IconRotate size={15} />
            </PanelButton>
          </div>
          <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
            <PanelButton title="当前视口截图" onClick={captureViewport}>
              <IconPhoto size={15} />
              <span>截图</span>
            </PanelButton>
          </div>
          <label className="inline-flex h-8 shrink-0 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--workbench-muted)]">
            <IconWorld size={14} />
            <span>速度</span>
            <input
              className="h-1.5 w-24 accent-[var(--nomi-ink)]"
              max={16}
              min={1}
              step={0.5}
              type="range"
              value={flySpeed}
              onChange={(event) => setFlySpeed(Number(event.currentTarget.value))}
            />
          </label>
          <button
            className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
            type="button"
            title="关闭"
            onClick={handleClose}
          >
            <IconX size={16} />
          </button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--workbench-bg)]">
        <AnimatePresence initial={false}>
          {leftPanelOpen ? (
            <motion.aside
              key="scene-node-panel"
              animate={{ opacity: 1, scale: 1, width: 260, x: 0 }}
              className="relative z-[2] flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] shadow-[8px_0_28px_rgba(18,24,38,0.05)]"
              exit={{ opacity: 0, scale: 0.16, width: 0, x: -26 }}
              initial={{ opacity: 0, scale: 0.16, width: 0, x: -26 }}
              style={{ transformOrigin: 'top left' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <SceneObjectList
                objects={state.objects}
                cameras={state.cameras}
                selection={selection}
                readOnly={readOnly}
                onSelect={selectSceneItem}
                onFocus={focusSceneItem}
                onObjectPatch={patchObject}
                onCameraPatch={patchCamera}
                onDelete={deleteSceneItem}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--nomi-ink-05)]">
          <Canvas
            camera={canvasCamera}
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: false }}
            onCreated={({ camera }) => applyEditorCameraPose(camera, initialEditorCameraRef.current)}
            onPointerMissed={clearSelection}
          >
            <SceneContent
              state={state}
              selection={selection}
              readOnly={readOnly}
              transformMode={transformMode}
              flySpeed={flySpeed}
              focusId={focusId}
              viewLocked={viewLocked}
              cameraViewEditCamera={cameraViewEditCamera}
              onSelect={selectSceneItem}
              onFocus={focusSceneItem}
              onObjectPatch={patchObject}
              onCameraPatch={patchCamera}
              onEditorCameraDraft={handleEditorCameraDraft}
              onEditorCameraCommit={updateEditorCamera}
              onEditorCameraTargetChange={updateEditorCameraTarget}
              onWheelNavigation={handleWheelNavigation}
              onTransformInteractionStart={unlockViewForSceneEdit}
              onTransformInteractionEnd={finishSceneTransformInteraction}
              onFocusConsumed={() => setFocusId('')}
              onKeyboardNavigationStart={startKeyboardNavigation}
              onKeyboardNavigationStop={stopKeyboardNavigation}
              setCaptureApi={(api) => {
                captureApiRef.current = api
              }}
            />
          </Canvas>
          {!leftPanelOpen ? (
            <CanvasPanelRestoreButton side="left" title="显示场景节点" onClick={() => setLeftPanelOpen(true)}>
              <IconListTree size={18} />
            </CanvasPanelRestoreButton>
          ) : null}
          {!rightPanelOpen ? (
            <CanvasPanelRestoreButton side="right" title="显示属性" onClick={() => setRightPanelOpen(true)}>
              <IconSettings size={18} />
            </CanvasPanelRestoreButton>
          ) : null}
          {selectedCamera ? (
            <CameraPreview
              camera={selectedCamera}
              state={state}
              readOnly={readOnly}
              cameraViewEditing={cameraViewEditId === selectedCamera.id}
              rightPanelCollapsed={!rightPanelOpen}
              onAspectChange={(aspectRatio) => patchCamera(selectedCamera.id, { aspectRatio })}
              onLensDepthChange={(lensDepth) => patchCamera(selectedCamera.id, { lensDepth })}
              onToggleViewEdit={toggleCameraViewEdit}
              onLevelCamera={levelSelectedCamera}
              onScreenshot={captureSelectedCamera}
            />
          ) : null}
          {cameraViewEditCamera ? (
            <div className="pointer-events-auto absolute left-1/2 top-4 z-[3] flex -translate-x-1/2 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-3 py-2 text-caption text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]">
              <IconCamera size={15} className="text-[var(--nomi-ink-60)]" />
              <span className="max-w-[220px] truncate">取景调整 · {cameraViewEditCamera.name}</span>
              <button
                className="rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 py-1 text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
                type="button"
                onClick={exitCameraViewEdit}
              >
                退出
              </button>
            </div>
          ) : null}
          <div className="pointer-events-none absolute bottom-4 left-4 grid size-20 place-items-center rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-micro text-[var(--nomi-ink-60)] shadow-[var(--nomi-shadow-md)]">
            <div className="grid gap-1">
              <span className="text-red-300">X</span>
              <span className="text-green-300">Y</span>
              <span className="text-blue-300">Z</span>
            </div>
          </div>
          {!readOnly ? (
            <SceneAddToolbar
              onAddObject={addObject}
              onAddCrowd={addCrowd}
              onAddCamera={addCamera}
              canvasFocusMode={canvasFocusMode}
              onToggleCanvasFocusMode={toggleCanvasFocusMode}
            />
          ) : null}
        </div>

        <AnimatePresence initial={false}>
          {rightPanelOpen ? (
            <motion.aside
              key="scene-property-panel"
              animate={{ opacity: 1, scale: 1, width: 300, x: 0 }}
              className="relative z-[2] flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] shadow-[-8px_0_28px_rgba(18,24,38,0.06)]"
              exit={{ opacity: 0, scale: 0.16, width: 0, x: 26 }}
              initial={{ opacity: 0, scale: 0.16, width: 0, x: 26 }}
              style={{ transformOrigin: 'top right' }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <PropertyPanel
                state={state}
                selection={selection}
                readOnly={readOnly}
                onObjectPatch={patchObject}
                onCameraPatch={patchCamera}
                onEnvironmentPatch={(patch) => setState((current) => ({
                  ...current,
                  environment: { ...current.environment, ...patch },
                }))}
              />
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </main>

    </div>
  )

  return typeof document === 'undefined' ? editorShell : createPortal(editorShell, document.body)
}

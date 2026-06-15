import React from 'react'
import { createPortal } from 'react-dom'
import { NomiSelect } from '../../../../design'
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Environment,
  Grid,
  OrbitControls,
  Sky,
  Text,
  TransformControls,
  useGLTF,
} from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  IconArrowsMove,
  IconBox,
  IconBulb,
  IconCamera,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconCylinder,
  IconEye,
  IconEyeOff,
  IconFocusCentered,
  IconListTree,
  IconMaximize,
  IconMinimize,
  IconPhoto,
  IconPlane,
  IconPlus,
  IconRotate,
  IconSettings,
  IconSphere,
  IconTrash,
  IconUser,
  IconWorld,
  IconX,
} from '@tabler/icons-react'
import * as THREE from 'three'
import { cn } from '../../../../utils/cn'
import { Switch } from '../../../../ui/switch'
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
  type Scene3DLightType,
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DTransformMode,
  type Scene3DVector3,
} from './scene3dTypes'

import {
  radiansToDegrees,
  degreesToRadians,
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
  OBJECT_GROUND_GUIDE_ELEVATION,
  MANNEQUIN_FOOT_RING_COLOR,
  MANNEQUIN_LABEL_BASE_HEIGHT,
  CROWD_MAX_AXIS,
  CROWD_DETAILED_MODEL_LIMIT,
  CROWD_INSTANCED_GEOMETRY_SEGMENTS,
  CROWD_FOOT_RING_SEGMENTS,
  FREE_LOOK_ROTATION_SPEED,
  WHEEL_TRAVEL_SPEED,
  MANNEQUIN_MODEL_URL,
  SCENE3D_LIGHT_BACKGROUND,
  SCENE3D_DARK_BACKGROUND,
  GRID_CELL_COLOR,
  GRID_SECTION_COLOR,
  DARK_GRID_CELL_COLOR,
  DARK_GRID_SECTION_COLOR,
  MANNEQUIN_POSE_SECTIONS,
  MANNEQUIN_POSE_MIN_DEG,
  MANNEQUIN_POSE_MAX_DEG,
  MANNEQUIN_POSE_PRESETS,
  type CrowdAddOptions,
  type MannequinPoseControl,
  type MannequinPosePreset,
  type Scene3DMovementCode,
} from './scene3dConstants'
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
  clonePoseValue,
  poseMatchesPreset,
  rememberMannequinRestPose,
  applyMannequinSkeletonPose,
  normalizeMannequinModel,
  aspectDimensions,
  captureScene,
  roleColorForIndex,
  makeObject,
  makeCrowdObject,
  makeCamera,
  cloneObjectForClipboard,
  cloneCameraForClipboard,
  makePastedObject,
  makePastedCamera,
  updateVectorValue,
  numberInputValue,
  isMovementCode,
  clearMovementKeyState,
  hasActiveMovementKey,
  type PointerCaptureTarget,
} from './scene3dMath'

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

function Scene3DMeshGeometry({ geometry }: { geometry: Scene3DGeometry | undefined }): JSX.Element {
  if (geometry === 'sphere') return <sphereGeometry args={[0.55, 40, 24]} />
  if (geometry === 'cylinder') return <cylinderGeometry args={[0.46, 0.46, 1.1, 40]} />
  if (geometry === 'plane') return <planeGeometry args={[1, 1]} />
  return <boxGeometry args={[1, 1, 1]} />
}

function ProceduralMannequin({ color }: { color: string }): JSX.Element {
  return (
    <group>
      <mesh position={[0, 0.41, 0]}>
        <sphereGeometry args={[0.09, 24, 16]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.11, 0.14, 0.4, 24]} />
        <meshStandardMaterial color={color} roughness={0.62} />
      </mesh>
      <mesh position={[-0.24, 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.032, 0.038, 0.36, 16]} />
        <meshStandardMaterial color={color} roughness={0.62} />
      </mesh>
      <mesh position={[0.24, 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.032, 0.038, 0.36, 16]} />
        <meshStandardMaterial color={color} roughness={0.62} />
      </mesh>
      <mesh position={[-0.075, -0.28, 0]}>
        <cylinderGeometry args={[0.038, 0.044, 0.46, 16]} />
        <meshStandardMaterial color={color} roughness={0.62} />
      </mesh>
      <mesh position={[0.075, -0.28, 0]}>
        <cylinderGeometry args={[0.038, 0.044, 0.46, 16]} />
        <meshStandardMaterial color={color} roughness={0.62} />
      </mesh>
    </group>
  )
}

type MannequinAssetBoundaryProps = {
  fallback: React.ReactNode
  children: React.ReactNode
}

class MannequinAssetBoundary extends React.Component<MannequinAssetBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('Failed to load mannequin GLB asset.', error)
  }

  render(): React.ReactNode {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}

function Mannequin({ color, pose }: { color: string; pose?: Record<string, Scene3DVector3> }): JSX.Element {
  const { scene } = useGLTF(MANNEQUIN_MODEL_URL)
  const model = React.useMemo(() => {
    const skeletonClone = cloneSkeleton(scene)
    rememberMannequinRestPose(skeletonClone)
    const cloned = normalizeMannequinModel(skeletonClone)
    const materials: THREE.Material[] = []
    cloned.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      object.frustumCulled = false
      const cloneMaterial = (material: THREE.Material) => {
        const nextMaterial = material.clone()
        materials.push(nextMaterial)
        return nextMaterial
      }
      object.material = Array.isArray(object.material)
        ? object.material.map(cloneMaterial)
        : cloneMaterial(object.material)
      if (object instanceof THREE.SkinnedMesh) {
        object.computeBoundingSphere()
      }
    })
    return { object: cloned, materials }
  }, [scene])

  React.useEffect(() => {
    const materials = model.materials
    return () => materials.forEach((material) => material.dispose())
  }, [model])

  React.useLayoutEffect(() => {
    model.materials.forEach((material) => {
      if ('color' in material && material.color instanceof THREE.Color) {
        material.color.set(color)
        material.needsUpdate = true
      }
    })
  }, [color, model.materials])

  React.useLayoutEffect(() => {
    applyMannequinSkeletonPose(model.object, pose)
  }, [model, pose])

  return <primitive object={model.object} />
}

useGLTF.preload(MANNEQUIN_MODEL_URL)

function crowdRows(object: Scene3DObject): number {
  return Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(object.crowdRows || 1)))
}

function crowdColumns(object: Scene3DObject): number {
  return Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(object.crowdColumns || 1)))
}

function crowdSpacing(object: Scene3DObject): number {
  return Math.min(10, Math.max(0.2, object.crowdSpacing || 1.2))
}

function crowdCount(object: Scene3DObject): number {
  return object.type === 'mannequinCrowd' ? crowdRows(object) * crowdColumns(object) : 1
}

function mannequinFootRingRadius(object: Scene3DObject): number {
  const scaleX = Math.max(0.08, Math.abs(object.scale[0] || 1))
  const scaleZ = Math.max(0.08, Math.abs(object.scale[2] || 1))
  return Math.max(0.28, Math.max(0.78 * scaleX, 0.54 * scaleZ) * 0.36)
}

function crowdCenterSpacing(object: Scene3DObject): number {
  return crowdSpacing(object) + mannequinFootRingRadius(object) * 2
}

function crowdLocalOffset(object: Scene3DObject, index: number): THREE.Vector3 {
  const rows = crowdRows(object)
  const columns = crowdColumns(object)
  const spacing = crowdCenterSpacing(object)
  const row = Math.floor(index / columns)
  const column = index % columns
  const scaleX = Math.max(0.001, Math.abs(object.scale[0] || 1))
  const scaleZ = Math.max(0.001, Math.abs(object.scale[2] || 1))
  return new THREE.Vector3(
    ((column - (columns - 1) / 2) * spacing) / scaleX,
    0,
    ((row - (rows - 1) / 2) * spacing) / scaleZ,
  )
}

function crowdLocalOffsets(object: Scene3DObject): THREE.Vector3[] {
  return Array.from({ length: crowdCount(object) }, (_, index) => crowdLocalOffset(object, index))
}

type CrowdInstancePart = {
  key: string
  geometry: 'sphere' | 'cylinder'
  position: Scene3DVector3
  rotation?: Scene3DVector3
  scale: Scene3DVector3
}

const CROWD_INSTANCE_PARTS: CrowdInstancePart[] = [
  { key: 'head', geometry: 'sphere', position: [0, 0.41, 0], scale: [0.09, 0.09, 0.09] },
  { key: 'torso', geometry: 'cylinder', position: [0, 0.12, 0], scale: [0.13, 0.4, 0.13] },
  { key: 'left-arm', geometry: 'cylinder', position: [-0.24, 0.2, 0], rotation: [0, 0, Math.PI / 2], scale: [0.036, 0.36, 0.036] },
  { key: 'right-arm', geometry: 'cylinder', position: [0.24, 0.2, 0], rotation: [0, 0, Math.PI / 2], scale: [0.036, 0.36, 0.036] },
  { key: 'left-leg', geometry: 'cylinder', position: [-0.075, -0.28, 0], scale: [0.041, 0.46, 0.041] },
  { key: 'right-leg', geometry: 'cylinder', position: [0.075, -0.28, 0], scale: [0.041, 0.46, 0.041] },
]

function InstancedMeshBatch({
  part,
  offsets,
  roleStartIndex,
}: {
  part: CrowdInstancePart
  offsets: THREE.Vector3[]
  roleStartIndex: number
}): JSX.Element {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const count = offsets.length
  const matrix = React.useMemo(() => new THREE.Matrix4(), [])
  const position = React.useMemo(() => new THREE.Vector3(), [])
  const rotation = React.useMemo(() => new THREE.Quaternion(), [])
  const scale = React.useMemo(() => new THREE.Vector3(), [])
  const color = React.useMemo(() => new THREE.Color(), [])

  React.useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.count = count
    offsets.forEach((offset, index) => {
      position.set(
        offset.x + part.position[0],
        offset.y + part.position[1],
        offset.z + part.position[2],
      )
      rotation.setFromEuler(new THREE.Euler(
        part.rotation?.[0] || 0,
        part.rotation?.[1] || 0,
        part.rotation?.[2] || 0,
      ))
      scale.fromArray(part.scale)
      matrix.compose(position, rotation, scale)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color.set(roleColorForIndex(roleStartIndex + index)))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [color, count, matrix, offsets, part, position, roleStartIndex, rotation, scale])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, count)]} frustumCulled={false}>
      {part.geometry === 'sphere'
        ? <sphereGeometry args={[1, CROWD_INSTANCED_GEOMETRY_SEGMENTS, CROWD_INSTANCED_GEOMETRY_SEGMENTS]} />
        : <cylinderGeometry args={[1, 1, 1, CROWD_INSTANCED_GEOMETRY_SEGMENTS]} />}
      <meshStandardMaterial roughness={0.62} />
    </instancedMesh>
  )
}

function InstancedProceduralMannequinCrowd({
  object,
  roleStartIndex,
}: {
  object: Scene3DObject
  roleStartIndex: number
}): JSX.Element {
  const offsets = React.useMemo(() => crowdLocalOffsets(object), [
    object.crowdRows,
    object.crowdColumns,
    object.crowdSpacing,
    object.scale,
  ])

  return (
    <>
      {CROWD_INSTANCE_PARTS.map((part) => (
        <InstancedMeshBatch
          key={part.key}
          part={part}
          offsets={offsets}
          roleStartIndex={roleStartIndex}
        />
      ))}
    </>
  )
}

function MannequinCrowd({
  object,
  roleStartIndex,
}: {
  object: Scene3DObject
  roleStartIndex: number
}): JSX.Element {
  const offsets = React.useMemo(() => crowdLocalOffsets(object), [
    object.crowdRows,
    object.crowdColumns,
    object.crowdSpacing,
    object.scale,
  ])

  if (offsets.length > CROWD_DETAILED_MODEL_LIMIT) {
    return <InstancedProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex} />
  }

  return (
    <>
      {offsets.map((offset, index) => (
        <group key={`${object.id}-member-${index}`} position={vectorToArray(offset)}>
          <Mannequin color={roleColorForIndex(roleStartIndex + index)} pose={object.pose} />
        </group>
      ))}
    </>
  )
}

function ProceduralMannequinCrowd({
  object,
  roleStartIndex,
}: {
  object: Scene3DObject
  roleStartIndex: number
}): JSX.Element {
  return <InstancedProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex} />
}

function LightObject({ object }: { object: Scene3DObject }): JSX.Element {
  const intensity = object.lightIntensity ?? 2
  const color = object.lightColor || '#ffffff'
  if (object.lightType === 'directional') {
    return <directionalLight color={color} intensity={intensity} position={[0, 0, 0]} />
  }
  if (object.lightType === 'spot') {
    return <spotLight color={color} intensity={intensity} angle={0.45} penumbra={0.4} />
  }
  return <pointLight color={color} intensity={intensity} distance={12} />
}

function mannequinRoleLabel(index: number): string {
  if (index < 26) return `角色${String.fromCharCode(65 + index)}`
  return `角色A${index - 25}`
}

function mannequinLabelHeight(object: Scene3DObject): number {
  return Math.max(0.8, Math.abs(object.scale[1] || 1) * MANNEQUIN_LABEL_BASE_HEIGHT)
}

function MannequinRoleLabel({ position, label }: { position: Scene3DVector3; label: string }): JSX.Element {
  const ref = React.useRef<THREE.Group>(null)
  const { camera } = useThree()
  const backgroundWidth = React.useMemo(() => Math.max(0.72, label.length * 0.24 + 0.18), [label])

  useFrame(() => {
    ref.current?.quaternion.copy(camera.quaternion)
  })

  return (
    <group
      ref={ref}
      position={position}
      raycast={() => null}
      userData={{ [CAMERA_HELPER_FLAG]: true }}
    >
      <mesh position={[0, 0, -0.012]} raycast={() => null} renderOrder={7}>
        <planeGeometry args={[backgroundWidth, 0.38]} />
        <meshBasicMaterial
          color="#111827"
          depthTest={false}
          depthWrite={false}
          opacity={0.72}
          transparent
          toneMapped={false}
        />
      </mesh>
      <Text
        anchorX="center"
        anchorY="middle"
        color="#ffffff"
        fontSize={0.28}
        fontWeight={700}
        frustumCulled={false}
        outlineColor="#111827"
        outlineOpacity={0.55}
        outlineWidth={0.012}
        raycast={() => null}
        renderOrder={8}
      >
        {label}
      </Text>
    </group>
  )
}

function singleMannequinLabelPosition(object: Scene3DObject): Scene3DVector3 {
  return [
    object.position[0],
    object.position[1] + mannequinLabelHeight(object),
    object.position[2],
  ]
}

function crowdLabelPositions(object: Scene3DObject): Scene3DVector3[] {
  const count = crowdCount(object)
  const matrix = new THREE.Matrix4()
  const rotation = new THREE.Euler(object.rotation[0], object.rotation[1], object.rotation[2])
  matrix.compose(
    vectorFromArray(object.position),
    new THREE.Quaternion().setFromEuler(rotation),
    vectorFromArray(object.scale),
  )
  const scaleY = Math.max(0.001, Math.abs(object.scale[1] || 1))
  const localLabelY = mannequinLabelHeight(object) / scaleY
  return Array.from({ length: count }, (_, index) => {
    const position = crowdLocalOffset(object, index)
    position.y = localLabelY
    return vectorToArray(position.applyMatrix4(matrix))
  })
}

function objectGroundFootprint(object: Scene3DObject): { width: number; depth: number } {
  const scaleX = Math.max(0.08, Math.abs(object.scale[0] || 1))
  const scaleY = Math.max(0.08, Math.abs(object.scale[1] || 1))
  const scaleZ = Math.max(0.08, Math.abs(object.scale[2] || 1))

  if (object.type === 'light') return { width: 0.42 * scaleX, depth: 0.42 * scaleZ }
  if (object.type === 'mannequinCrowd') {
    const ringDiameter = mannequinFootRingRadius(object) * 2
    const centerSpacing = crowdCenterSpacing(object)
    return {
      width: (crowdColumns(object) - 1) * centerSpacing + ringDiameter,
      depth: (crowdRows(object) - 1) * centerSpacing + ringDiameter,
    }
  }
  if (object.type === 'mannequin') return { width: 0.78 * scaleX, depth: 0.54 * scaleZ }
  if (object.type === 'model' || object.type === 'group') return { width: 1 * scaleX, depth: 1 * scaleZ }
  if (object.geometry === 'sphere') return { width: 1.1 * scaleX, depth: 1.1 * scaleZ }
  if (object.geometry === 'cylinder') return { width: 0.92 * scaleX, depth: 0.92 * scaleZ }
  if (object.geometry === 'plane') return { width: scaleX, depth: scaleY }
  return { width: scaleX, depth: scaleZ }
}

function objectVisualHalfHeight(object: Scene3DObject, scale: Scene3DVector3 = object.scale): number {
  const scaleY = Math.max(0.08, Math.abs(scale[1] || 1))
  if (object.type === 'light') return 0.12 * scaleY
  if (object.type === 'mannequin' || object.type === 'mannequinCrowd') return 0.5 * scaleY
  if (object.geometry === 'sphere') return 0.55 * scaleY
  if (object.geometry === 'cylinder') return 0.55 * scaleY
  if (object.geometry === 'plane') return 0
  return 0.5 * scaleY
}

function objectTransformAnchorPosition(object: Scene3DObject): Scene3DVector3 {
  return [
    object.position[0],
    object.position[1] - objectVisualHalfHeight(object),
    object.position[2],
  ]
}

function nextAvailableObjectPosition(object: Scene3DObject, objects: Scene3DObject[]): Scene3DVector3 {
  const targetFootprint = objectGroundFootprint(object)
  const targetRadius = Math.max(targetFootprint.width, targetFootprint.depth) / 2
  const gap = 0.45
  const occupied = objects.map((existing) => {
    const footprint = objectGroundFootprint(existing)
    return {
      x: existing.position[0],
      z: existing.position[2],
      radius: Math.max(footprint.width, footprint.depth) / 2,
    }
  })
  const fits = (x: number, z: number) => occupied.every((existing) => {
    const dx = x - existing.x
    const dz = z - existing.z
    return Math.sqrt(dx * dx + dz * dz) >= targetRadius + existing.radius + gap
  })
  const makePosition = (x: number, z: number): Scene3DVector3 => [
    Number(x.toFixed(4)),
    object.position[1],
    Number(z.toFixed(4)),
  ]

  if (fits(object.position[0], object.position[2])) return object.position

  const step = Math.max(1.5, targetRadius * 2 + gap)
  for (let ring = 1; ring <= 10; ring += 1) {
    const offsets: Array<[number, number]> = [
      [ring, 0],
      [-ring, 0],
      [0, ring],
      [0, -ring],
      [ring, ring],
      [ring, -ring],
      [-ring, ring],
      [-ring, -ring],
    ]
    for (let axis = 1; axis < ring; axis += 1) {
      offsets.push(
        [ring, axis],
        [ring, -axis],
        [-ring, axis],
        [-ring, -axis],
        [axis, ring],
        [-axis, ring],
        [axis, -ring],
        [-axis, -ring],
      )
    }
    for (const [x, z] of offsets) {
      const nextX = x * step
      const nextZ = z * step
      if (fits(nextX, nextZ)) return makePosition(nextX, nextZ)
    }
  }

  return makePosition((occupied.length + 1) * step, 0)
}

function FootRing({
  position,
  radius,
}: {
  position: Scene3DVector3
  radius: number
}): JSX.Element {
  return (
    <mesh
      position={[position[0], OBJECT_GROUND_GUIDE_ELEVATION, position[2]]}
      raycast={() => null}
      renderOrder={3}
      rotation={[-Math.PI / 2, 0, 0]}
      userData={{ [CAMERA_HELPER_FLAG]: true }}
    >
      <ringGeometry args={[radius * 0.92, radius, 72]} />
      <meshBasicMaterial
        color={MANNEQUIN_FOOT_RING_COLOR}
        depthWrite={false}
        opacity={0.8}
        side={THREE.DoubleSide}
        transparent
        toneMapped={false}
      />
    </mesh>
  )
}

function InstancedFootRings({
  positions,
  radius,
}: {
  positions: Scene3DVector3[]
  radius: number
}): JSX.Element {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const count = positions.length
  const matrix = React.useMemo(() => new THREE.Matrix4(), [])
  const position = React.useMemo(() => new THREE.Vector3(), [])
  const rotation = React.useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), [])
  const scale = React.useMemo(() => new THREE.Vector3(1, 1, 1), [])

  React.useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.count = count
    positions.forEach((entry, index) => {
      position.set(entry[0], OBJECT_GROUND_GUIDE_ELEVATION, entry[2])
      matrix.compose(position, rotation, scale)
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [count, matrix, position, positions, rotation, scale])

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, count)]}
      raycast={() => null}
      renderOrder={3}
      userData={{ [CAMERA_HELPER_FLAG]: true }}
    >
      <ringGeometry args={[radius * 0.92, radius, CROWD_FOOT_RING_SEGMENTS]} />
      <meshBasicMaterial
        color={MANNEQUIN_FOOT_RING_COLOR}
        depthWrite={false}
        opacity={0.8}
        side={THREE.DoubleSide}
        transparent
        toneMapped={false}
      />
    </instancedMesh>
  )
}

function MannequinFootRings({ object }: { object: Scene3DObject }): JSX.Element | null {
  const baseRadius = mannequinFootRingRadius(object)
  const positions = React.useMemo(() => {
    if (object.type !== 'mannequinCrowd') return []
    const matrix = new THREE.Matrix4()
    matrix.compose(
      vectorFromArray(object.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation[0], object.rotation[1], object.rotation[2])),
      vectorFromArray(object.scale),
    )
    return Array.from({ length: crowdCount(object) }, (_, index) => (
      vectorToArray(crowdLocalOffset(object, index).applyMatrix4(matrix))
    ))
  }, [
    object.crowdRows,
    object.crowdColumns,
    object.crowdSpacing,
    object.position,
    object.rotation,
    object.scale,
  ])

  if (object.type !== 'mannequin' && object.type !== 'mannequinCrowd') return null

  if (object.type === 'mannequin') {
    return <FootRing position={[object.position[0], 0, object.position[2]]} radius={baseRadius} />
  }

  return <InstancedFootRings positions={positions} radius={baseRadius} />
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

function PanelButton({
  children,
  active,
  title,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi-sm border px-2 whitespace-nowrap',
        'border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-caption text-[var(--nomi-ink-60)] transition',
        'hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]',
        active && 'border-[var(--nomi-ink)] bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-ink)] hover:text-[var(--nomi-paper)]',
      )}
      type="button"
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SceneAddButton({
  children,
  active,
  title,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2',
        'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)] disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
      )}
      type="button"
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function CanvasPanelRestoreButton({
  side,
  title,
  onClick,
  children,
}: {
  side: 'left' | 'right'
  title: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      className={cn(
        'pointer-events-auto absolute top-4 z-[4] grid size-9 place-items-center rounded-nomi',
        'border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--nomi-ink-60)] shadow-[var(--nomi-shadow-md)]',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
        side === 'left' ? 'left-4' : 'right-4',
      )}
      type="button"
      title={title}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  )
}

function SceneAddToolbar({
  onAddObject,
  onAddCrowd,
  onAddCamera,
  canvasFocusMode,
  onToggleCanvasFocusMode,
}: {
  onAddObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  onAddCrowd: (options: CrowdAddOptions) => void
  onAddCamera: () => void
  canvasFocusMode: boolean
  onToggleCanvasFocusMode: () => void
}): JSX.Element {
  const [geometryOpen, setGeometryOpen] = React.useState(false)
  const [characterOpen, setCharacterOpen] = React.useState(false)
  const [crowdPopoverOpen, setCrowdPopoverOpen] = React.useState(false)
  const [crowdRowsValue, setCrowdRowsValue] = React.useState(3)
  const [crowdColumnsValue, setCrowdColumnsValue] = React.useState(3)
  const [crowdSpacingValue, setCrowdSpacingValue] = React.useState(1.2)
  const geometryItems = [
    { kind: 'box' as const, label: '立方体', icon: IconBox },
    { kind: 'sphere' as const, label: '球体', icon: IconSphere },
    { kind: 'cylinder' as const, label: '圆柱体', icon: IconCylinder },
    { kind: 'plane' as const, label: '平面', icon: IconPlane },
  ]

  const addGeometry = React.useCallback((kind: Scene3DGeometry) => {
    onAddObject(kind)
    setGeometryOpen(false)
    setCharacterOpen(false)
    setCrowdPopoverOpen(false)
  }, [onAddObject])
  const addSingleMannequin = React.useCallback(() => {
    onAddObject('mannequin')
    setGeometryOpen(false)
    setCharacterOpen(false)
    setCrowdPopoverOpen(false)
  }, [onAddObject])
  const addCrowd = React.useCallback(() => {
    onAddCrowd({
      rows: crowdRowsValue,
      columns: crowdColumnsValue,
      spacing: crowdSpacingValue,
    })
    setCrowdPopoverOpen(false)
    setCharacterOpen(false)
    setGeometryOpen(false)
  }, [crowdColumnsValue, crowdRowsValue, crowdSpacingValue, onAddCrowd])

  return (
    <div
      className={cn(
        'absolute bottom-5 left-1/2 z-[4] max-w-[calc(100%-32px)] -translate-x-1/2',
      )}
      aria-label="添加 3D 节点"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {geometryOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-10 z-[5] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label="添加几何模型"
        >
          {geometryItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.kind}
                className={cn(
                  'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
                  'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-70)] transition',
                  'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                )}
                type="button"
                role="menuitem"
                onClick={() => addGeometry(item.kind)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {characterOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[118px] z-[5] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label="添加假人"
        >
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-70)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={addSingleMannequin}
          >
            <IconUser size={15} />
            <span>单个假人</span>
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-70)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              crowdPopoverOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => setCrowdPopoverOpen((open) => !open)}
          >
            <IconUser size={15} />
            <span className="min-w-0 flex-1">群众</span>
            <IconChevronRight size={14} />
          </button>
        </div>
      ) : null}
      {characterOpen && crowdPopoverOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[294px] z-[6] w-[240px] p-3',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="dialog"
          aria-label="添加群众"
        >
          <div className="mb-3 flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <span className="font-medium text-[var(--nomi-ink)]">群众</span>
            <span>最多10x10</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-micro text-[var(--nomi-ink-60)]">
              行数
              <input
                className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)]"
                max={CROWD_MAX_AXIS}
                min={1}
                type="number"
                value={crowdRowsValue}
                onChange={(event) => setCrowdRowsValue(Number(event.currentTarget.value))}
              />
            </label>
            <label className="grid gap-1 text-micro text-[var(--nomi-ink-60)]">
              列数
              <input
                className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)]"
                max={CROWD_MAX_AXIS}
                min={1}
                type="number"
                value={crowdColumnsValue}
                onChange={(event) => setCrowdColumnsValue(Number(event.currentTarget.value))}
              />
            </label>
          </div>
          <label className="mt-2 grid gap-1 text-micro text-[var(--nomi-ink-60)]">
            圆间距
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)]"
              max={10}
              min={0.2}
              step={0.1}
              type="number"
              value={crowdSpacingValue}
              onChange={(event) => setCrowdSpacingValue(Number(event.currentTarget.value))}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="h-8 rounded-nomi-sm bg-[var(--nomi-ink-10)] text-caption text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-20)]"
              type="button"
              onClick={() => setCrowdPopoverOpen(false)}
            >
              取消
            </button>
            <button
              className="h-8 rounded-nomi-sm bg-[var(--nomi-ink)] text-caption text-[var(--nomi-paper)] hover:opacity-90"
              type="button"
              onClick={addCrowd}
            >
              生成
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-1 overflow-x-auto p-[6px]',
          'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        )}
        role="toolbar"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-nomi bg-[var(--nomi-ink)] text-[var(--nomi-paper)]" title="添加">
          <IconPlus size={17} />
        </span>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <SceneAddButton
          active={geometryOpen}
          title="添加几何模型"
          onClick={() => {
            setCharacterOpen(false)
            setCrowdPopoverOpen(false)
            setGeometryOpen((open) => !open)
          }}
        >
          <IconBox size={15} />
          <span>几何模型</span>
        </SceneAddButton>
        <SceneAddButton
          active={characterOpen}
          title="添加假人"
          onClick={() => {
            setGeometryOpen(false)
            if (characterOpen) setCrowdPopoverOpen(false)
            setCharacterOpen((open) => !open)
          }}
        >
          <IconUser size={15} />
          <span>假人</span>
        </SceneAddButton>
        <SceneAddButton title="添加灯光" onClick={() => {
          setGeometryOpen(false)
          setCharacterOpen(false)
          setCrowdPopoverOpen(false)
          onAddObject('light')
        }}><IconBulb size={15} /><span>灯光</span></SceneAddButton>
        <SceneAddButton title="添加拍摄相机" onClick={() => {
          setGeometryOpen(false)
          setCharacterOpen(false)
          setCrowdPopoverOpen(false)
          onAddCamera()
        }}><IconCamera size={15} /><span>相机</span></SceneAddButton>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <SceneAddButton
          active={canvasFocusMode}
          title={canvasFocusMode ? '退出全屏画布' : '全屏画布'}
          onClick={() => {
            setGeometryOpen(false)
            setCharacterOpen(false)
            setCrowdPopoverOpen(false)
            onToggleCanvasFocusMode()
          }}
        >
          {canvasFocusMode ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          <span>{canvasFocusMode ? '还原' : '全屏'}</span>
        </SceneAddButton>
      </div>
    </div>
  )
}

function VectorInputs({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: Scene3DVector3
  disabled?: boolean
  onChange: (value: Scene3DVector3) => void
}): JSX.Element {
  return (
    <label className="grid gap-1">
      <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
      <span className="grid grid-cols-3 gap-1">
        {value.map((part, index) => (
          <input
            key={index}
            className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
            disabled={disabled}
            type="number"
            step="0.1"
            value={numberInputValue(part)}
            onChange={(event) => onChange(updateVectorValue(value, index, Number(event.currentTarget.value)))}
          />
        ))}
      </span>
    </label>
  )
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080'
  const displayValue = color.toUpperCase()

  return (
    <div className="grid gap-1">
      <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
      <div className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2">
        <label
          className={cn(
            'relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-[var(--nomi-line)]',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[var(--nomi-accent)]',
          )}
          title={disabled ? undefined : '选择颜色'}
        >
          <span className="absolute inset-0" style={{ backgroundColor: color }} />
          <input
            className="absolute inset-0 size-full cursor-inherit opacity-0"
            disabled={disabled}
            type="color"
            value={color}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </label>
        <input
          aria-label={`${label}值`}
          className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-ink-05)] px-2 font-mono text-caption font-medium uppercase text-[var(--nomi-ink)] outline-none disabled:opacity-50"
          disabled={disabled}
          readOnly
          value={displayValue}
        />
      </div>
    </div>
  )
}

function SceneObjectList({
  objects,
  cameras,
  selection,
  readOnly,
  onSelect,
  onFocus,
  onObjectPatch,
  onCameraPatch,
  onDelete,
}: {
  objects: Scene3DObject[]
  cameras: Scene3DCamera[]
  selection: Scene3DSelection
  readOnly: boolean
  onSelect: (selection: Scene3DSelection) => void
  onFocus: (id: string) => void
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onDelete: (selection: Exclude<Scene3DSelection, null>) => void
}): JSX.Element {
  const [renaming, setRenaming] = React.useState<string>('')
  const [expandedCrowds, setExpandedCrowds] = React.useState<Record<string, boolean>>({})
  const rows = React.useMemo(() => {
    let roleIndex = 0
    const objectRows = objects.map((object) => {
      const roleStartIndex = object.type === 'mannequin' || object.type === 'mannequinCrowd'
        ? roleIndex
        : undefined
      if (object.type === 'mannequin') roleIndex += 1
      if (object.type === 'mannequinCrowd') roleIndex += crowdCount(object)
      return {
        id: object.id,
        type: 'object' as const,
        name: object.name,
        visible: object.visible,
        object,
        roleStartIndex,
      }
    })
    return [
      ...objectRows,
      ...cameras.map((camera) => ({
        id: camera.id,
        type: 'camera' as const,
        name: camera.name,
        visible: camera.visible,
        camera,
        roleStartIndex: undefined,
      })),
    ]
  }, [cameras, objects])

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--nomi-paper)]">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <h3 className="m-0 text-caption font-medium text-[var(--nomi-ink)]">场景节点</h3>
        <span className="text-micro text-[var(--nomi-ink-60)]">{rows.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {rows.map((row) => {
          const selected = selection?.type === row.type && selection.id === row.id
          const rowObject = row.type === 'object' ? row.object : undefined
          const isCrowd = rowObject?.type === 'mannequinCrowd'
          const crowdExpanded = isCrowd ? expandedCrowds[row.id] ?? true : false
          return (
            <React.Fragment key={row.id}>
              <div
                className={cn(
                  'group grid grid-cols-[22px_24px_minmax(0,1fr)_28px_28px] items-center gap-1 rounded-nomi-sm px-1 py-1',
                  'text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)]',
                  selected && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
                )}
                onDoubleClick={() => {
                  if (!readOnly) setRenaming(row.id)
                  onFocus(row.id)
                }}
              >
                {isCrowd ? (
                  <button
                    className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-45)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]"
                    type="button"
                    title={crowdExpanded ? '收起群众' : '展开群众'}
                    onClick={() => setExpandedCrowds((current) => ({ ...current, [row.id]: !crowdExpanded }))}
                  >
                    {crowdExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </button>
                ) : (
                  <span aria-hidden="true" className="size-6" />
                )}
                <button
                  className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]"
                  type="button"
                  title="聚焦"
                  onClick={() => onFocus(row.id)}
                >
                  <IconFocusCentered size={14} />
                </button>
                {renaming === row.id ? (
                  <input
                    autoFocus
                    className="h-7 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                    defaultValue={row.name}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim()
                      if (name) {
                        if (row.type === 'object') onObjectPatch(row.id, { name })
                        else onCameraPatch(row.id, { name })
                      }
                      setRenaming('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setRenaming('')
                    }}
                  />
                ) : (
                  <button
                    className="min-w-0 truncate bg-transparent p-0 text-left text-caption text-inherit"
                    type="button"
                    onClick={() => onSelect({ type: row.type, id: row.id })}
                  >
                    {row.name}
                  </button>
                )}
                <button
                  className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)] disabled:opacity-40"
                  disabled={readOnly}
                  type="button"
                  title={row.visible ? '隐藏' : '显示'}
                  onClick={() => {
                    if (row.type === 'object') onObjectPatch(row.id, { visible: !row.visible })
                    else onCameraPatch(row.id, { visible: !row.visible })
                  }}
                >
                  {row.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                </button>
                <button
                  className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-45)] hover:bg-[var(--workbench-danger-soft)] hover:text-[var(--workbench-danger)] disabled:opacity-40"
                  disabled={readOnly}
                  type="button"
                  title="删除"
                  onClick={() => onDelete({ type: row.type, id: row.id })}
                >
                  <IconTrash size={14} />
                </button>
              </div>
              {isCrowd && crowdExpanded ? (
                <div className="mb-1 grid gap-0.5 pl-[22px]">
                  {Array.from({ length: rowObject ? crowdCount(rowObject) : 0 }, (_, index) => {
                    const roleIndex = (row.roleStartIndex ?? 0) + index
                    const roleColor = roleColorForIndex(roleIndex)
                    return (
                      <button
                        key={`${row.id}-member-${index}`}
                        className={cn(
                          'grid grid-cols-[24px_minmax(0,1fr)_56px] items-center gap-1 rounded-nomi-sm px-1 py-1',
                          'text-left text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                          selected && 'text-[var(--nomi-ink)]',
                        )}
                        type="button"
                        title="群众成员不可单独调整"
                        onClick={() => onSelect({ type: 'object', id: row.id })}
                      >
                        <span className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-45)]">
                          <IconUser size={13} />
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: roleColor }}
                          />
                          <span className="min-w-0 truncate text-caption">{mannequinRoleLabel(roleIndex)}</span>
                        </span>
                        <span className="justify-self-end rounded-nomi-sm bg-[var(--nomi-ink-05)] px-1.5 py-0.5 text-micro text-[var(--nomi-ink-45)]">
                          只读
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </React.Fragment>
          )
        })}
      </div>
    </section>
  )
}

type SceneObjectInspectorTab = 'properties' | 'pose'

function mannequinPoseControlValue(control: MannequinPoseControl, pose?: Record<string, Scene3DVector3>): number {
  const rotation = pose?.[control.bone] || [0, 0, 0]
  const scale = control.valueScale || 1
  return Number((control.standingValue + radiansToDegrees(rotation[control.axisIndex]) / scale).toFixed(1))
}

function MannequinPosePanel({
  object,
  readOnly,
  onObjectPatch,
}: {
  object: Scene3DObject
  readOnly: boolean
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
}): JSX.Element {
  const updatePoseControl = React.useCallback((control: MannequinPoseControl, degrees: number) => {
    const currentRotation = object.pose?.[control.bone] || [0, 0, 0]
    const scale = control.valueScale || 1
    const offsetDegrees = (degrees - control.standingValue) * scale
    const nextRotation = updateVectorValue(currentRotation, control.axisIndex, degreesToRadians(offsetDegrees))
    onObjectPatch(object.id, {
      pose: {
        ...(object.pose || {}),
        [control.bone]: nextRotation,
      },
    })
  }, [object.id, object.pose, onObjectPatch])

  const applyPosePreset = React.useCallback((preset: MannequinPosePreset) => {
    onObjectPatch(object.id, { pose: clonePoseValue(preset.pose) })
  }, [object.id, onObjectPatch])

  const activePosePresetId = MANNEQUIN_POSE_PRESETS.find((preset) => poseMatchesPreset(object.pose, preset))?.id

  const renderControl = (control: MannequinPoseControl): JSX.Element => {
    const value = mannequinPoseControlValue(control, object.pose)
    const min = control.min ?? MANNEQUIN_POSE_MIN_DEG
    const max = control.max ?? MANNEQUIN_POSE_MAX_DEG
    return (
      <label key={`${control.bone}-${control.axisIndex}-${control.label}`} className="grid grid-cols-[42px_1fr_58px] items-center gap-2 text-caption text-[var(--nomi-ink-60)]">
        <span>{control.label}</span>
        <input
          className="h-1.5 w-full accent-[var(--nomi-ink)] disabled:opacity-50"
          disabled={readOnly}
          max={max}
          min={min}
          step={1}
          type="range"
          value={value}
          onChange={(event) => updatePoseControl(control, Number(event.currentTarget.value))}
        />
        <input
          className="h-7 w-full rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-center font-mono text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-ink-35)] disabled:opacity-50"
          disabled={readOnly}
          max={max}
          min={min}
          step={1}
          type="number"
          value={value}
          onChange={(event) => updatePoseControl(control, Number(event.currentTarget.value))}
        />
      </label>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 py-2 text-micro leading-5 text-[var(--nomi-ink-60)]">
        <div className="font-medium text-[var(--nomi-ink)]">姿势调节</div>
        <div>默认值为站立参数，调整会实时映射到模型骨骼。</div>
      </div>
      <div className="grid gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
        <div className="text-caption font-medium text-[var(--nomi-ink)]">姿势预设</div>
        <div className="grid grid-cols-4 gap-1.5">
          {MANNEQUIN_POSE_PRESETS.map((preset) => {
            const active = activePosePresetId === preset.id
            return (
              <button
                key={preset.id}
                className={cn(
                  'h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-1 text-caption text-[var(--nomi-ink-70)] transition',
                  'hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:cursor-not-allowed disabled:opacity-40',
                  active && 'border-[var(--nomi-ink)] bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-ink)] hover:text-[var(--nomi-paper)]',
                )}
                disabled={readOnly}
                type="button"
                onClick={() => applyPosePreset(preset)}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid gap-3">
        {MANNEQUIN_POSE_SECTIONS.map((section) => (
          <div key={section.title} className="grid gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
            <div className="text-caption font-medium text-[var(--nomi-ink)]">{section.title}</div>
            {section.controls ? (
              <div className="grid gap-2">{section.controls.map(renderControl)}</div>
            ) : (
              <div className="grid gap-3">
                {section.groups.map((group) => (
                  <div key={group.title} className="grid gap-2">
                    <div className="w-fit rounded-nomi-sm bg-[var(--nomi-ink-08)] px-1.5 py-0.5 text-micro font-medium text-[var(--nomi-ink-70)]">
                      {group.title}
                    </div>
                    <div className="grid gap-2">{group.controls.map(renderControl)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PropertyPanel({
  state,
  selection,
  readOnly,
  onObjectPatch,
  onCameraPatch,
  onEnvironmentPatch,
}: {
  state: Scene3DState
  selection: Scene3DSelection
  readOnly: boolean
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEnvironmentPatch: (patch: Partial<Scene3DState['environment']>) => void
}): JSX.Element {
  const selectedObject = selection?.type === 'object'
    ? state.objects.find((object) => object.id === selection.id)
    : undefined
  const selectedCamera = selection?.type === 'camera'
    ? state.cameras.find((camera) => camera.id === selection.id)
    : undefined
  const [objectInspectorTab, setObjectInspectorTab] = React.useState<SceneObjectInspectorTab>('properties')
  const selectedObjectHasPose = selectedObject?.type === 'mannequin' || selectedObject?.type === 'mannequinCrowd'

  React.useEffect(() => {
    setObjectInspectorTab('properties')
  }, [selectedObject?.id])

  React.useEffect(() => {
    if (!selectedObjectHasPose) setObjectInspectorTab('properties')
  }, [selectedObjectHasPose])

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-[var(--nomi-paper)] px-3 py-3">
      <div className="mb-3 flex items-center gap-2 text-caption font-medium text-[var(--nomi-ink)]">
        <IconSettings size={15} />
        属性
      </div>
      {selectedObject ? (
        <div className="grid gap-3">
          {selectedObjectHasPose ? (
            <div className="grid grid-cols-2 gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] p-1">
              {([
                ['properties', '属性'],
                ['pose', '姿势'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  className={cn(
                    'h-7 rounded-nomi-sm text-caption text-[var(--nomi-ink-60)] transition hover:bg-[var(--nomi-paper)] hover:text-[var(--nomi-ink)]',
                    objectInspectorTab === tab && 'bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-sm',
                  )}
                  type="button"
                  onClick={() => setObjectInspectorTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {selectedObjectHasPose && objectInspectorTab === 'pose' ? (
            <MannequinPosePanel object={selectedObject} readOnly={readOnly} onObjectPatch={onObjectPatch} />
          ) : (
            <>
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">名称</span>
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
              disabled={readOnly}
              value={selectedObject.name}
              onChange={(event) => onObjectPatch(selectedObject.id, { name: event.currentTarget.value })}
            />
          </label>
          <VectorInputs label="位置 XYZ" value={selectedObject.position} disabled={readOnly} onChange={(position) => onObjectPatch(selectedObject.id, { position })} />
          <VectorInputs label="旋转 XYZ" value={selectedObject.rotation} disabled={readOnly} onChange={(rotation) => onObjectPatch(selectedObject.id, { rotation })} />
          <VectorInputs label="缩放 XYZ" value={selectedObject.scale} disabled={readOnly} onChange={(scale) => onObjectPatch(selectedObject.id, { scale })} />
          {selectedObject.type === 'mannequinCrowd' ? (
            <div className="grid grid-cols-3 gap-2">
              {([
                ['crowdRows', '行数', 1, CROWD_MAX_AXIS, 1],
                ['crowdColumns', '列数', 1, CROWD_MAX_AXIS, 1],
                ['crowdSpacing', '圆间距', 0.2, 10, 0.1],
              ] as const).map(([field, label, min, max, step]) => (
                <label key={field} className="grid gap-1">
                  <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
                  <input
                    className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                    disabled={readOnly}
                    max={max}
                    min={min}
                    step={step}
                    type="number"
                    value={selectedObject[field] ?? (field === 'crowdSpacing' ? 1.2 : 1)}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value)
                      if (field === 'crowdSpacing') onObjectPatch(selectedObject.id, { crowdSpacing: Math.min(10, Math.max(0.2, value)) })
                      else onObjectPatch(selectedObject.id, { [field]: Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(value))) })
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {(selectedObject.type === 'mesh' || selectedObject.type === 'mannequin') ? (
            <ColorField
              label="颜色"
              value={selectedObject.color || '#808080'}
              disabled={readOnly}
              onChange={(color) => onObjectPatch(selectedObject.id, { color })}
            />
          ) : null}
          {selectedObject.type === 'light' ? (
            <>
              <label className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-60)]">灯光类型</span>
                <NomiSelect ariaLabel="灯光类型" className="w-full justify-between" disabled={readOnly}
                  value={selectedObject.lightType || 'point'}
                  options={[{ value: 'point', label: 'Point' }, { value: 'directional', label: 'Directional' }, { value: 'spot', label: 'Spot' }]}
                  onChange={(value) => onObjectPatch(selectedObject.id, { lightType: value as Scene3DLightType })} />
              </label>
              <label className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-60)]">强度</span>
                <input
                  className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                  disabled={readOnly}
                  min={0}
                  step={0.1}
                  type="number"
                  value={selectedObject.lightIntensity ?? 2}
                  onChange={(event) => onObjectPatch(selectedObject.id, { lightIntensity: Number(event.currentTarget.value) })}
                />
              </label>
              <ColorField
                label="灯光颜色"
                value={selectedObject.lightColor || '#ffffff'}
                disabled={readOnly}
                onChange={(lightColor) => onObjectPatch(selectedObject.id, { lightColor })}
              />
            </>
          ) : null}
            </>
          )}
        </div>
      ) : selectedCamera ? (
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">名称</span>
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
              disabled={readOnly}
              value={selectedCamera.name}
              onChange={(event) => onCameraPatch(selectedCamera.id, { name: event.currentTarget.value })}
            />
          </label>
          <VectorInputs
            label="相机位置 XYZ"
            value={selectedCamera.position}
            disabled={readOnly}
            onChange={(position) => onCameraPatch(selectedCamera.id, {
              position,
              rotation: cameraLookAtRotation(position, selectedCamera.target),
            })}
          />
          <VectorInputs
            label="拍摄目标 XYZ"
            value={selectedCamera.target}
            disabled={readOnly}
            onChange={(target) => onCameraPatch(selectedCamera.id, {
              target,
              rotation: cameraLookAtRotation(selectedCamera.position, target),
            })}
          />
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">画幅比例</span>
            <NomiSelect ariaLabel="画幅比例" className="w-full justify-between" disabled={readOnly}
              value={selectedCamera.aspectRatio} options={SCENE3D_ASPECT_OPTIONS.map((option) => ({ value: option, label: option }))}
              onChange={(value) => onCameraPatch(selectedCamera.id, { aspectRatio: value as Scene3DAspectRatio })} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['fov', 'near', 'far'] as const).map((field) => (
              <label key={field} className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-60)]">{field.toUpperCase()}</span>
                <input
                  className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                  disabled={readOnly}
                  min={field === 'fov' ? 12 : 0.01}
                  step={field === 'fov' ? 1 : 0.1}
                  type="number"
                  value={selectedCamera[field]}
                  onChange={(event) => onCameraPatch(selectedCamera.id, { [field]: Number(event.currentTarget.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-dark-mode">场景暗色</label>
            <Switch
              id="scene3d-dark-mode"
              checked={state.environment.darkMode}
              disabled={readOnly}
              onCheckedChange={(darkMode) => onEnvironmentPatch({
                darkMode,
                backgroundColor: darkMode ? SCENE3D_DARK_BACKGROUND : SCENE3D_LIGHT_BACKGROUND,
              })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-show-grid">网格地面</label>
            <Switch
              id="scene3d-show-grid"
              checked={state.environment.showGrid}
              disabled={readOnly}
              onCheckedChange={(checked) => onEnvironmentPatch({ showGrid: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-show-axes">坐标轴</label>
            <Switch
              id="scene3d-show-axes"
              checked={state.environment.showAxes}
              disabled={readOnly}
              onCheckedChange={(checked) => onEnvironmentPatch({ showAxes: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-show-sky">天空背景</label>
            <Switch
              id="scene3d-show-sky"
              checked={state.environment.showSky}
              disabled={readOnly}
              onCheckedChange={(checked) => onEnvironmentPatch({ showSky: checked })}
            />
          </div>
          <ColorField
            label="背景颜色"
            value={state.environment.backgroundColor}
            disabled={readOnly}
            onChange={(backgroundColor) => onEnvironmentPatch({ backgroundColor })}
          />
        </div>
      )}
    </section>
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
    const direction = new THREE.Vector3()
    camera.getWorldDirection(direction)
    const target = vectorToArray(camera.position.clone().addScaledVector(direction, targetDistanceRef.current))
    const rotation = eulerToArray(camera.rotation)
    const editorCamera = { position, target, rotation, mode: 'fly' } satisfies Scene3DState['editorCamera']
    onEditorCameraDraft(editorCamera)
    onCameraPatch(cameraData.id, {
      position,
      target,
      rotation,
    })
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
      toast('已复制 3D 节点', 'success')
      return true
    }

    const camera = stateRef.current.cameras.find((candidate) => candidate.id === currentSelection.id)
    if (!camera) return false
    clipboardRef.current = {
      type: 'camera',
      item: cloneCameraForClipboard(camera),
      pasteCount: 0,
    }
    toast('已复制相机节点', 'success')
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
      toast('已粘贴 3D 节点', 'success')
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
    toast('已粘贴相机节点', 'success')
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

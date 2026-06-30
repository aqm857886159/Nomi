import React from 'react'
import { Text, useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { clone as cloneSkeleton, retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import type {
  Scene3DGeometry,
  Scene3DObject,
  Scene3DVector3,
} from './scene3dTypes'
import {
  CAMERA_HELPER_FLAG,
  OBJECT_GROUND_GUIDE_ELEVATION,
  MANNEQUIN_FOOT_RING_COLOR,
  MANNEQUIN_LABEL_BASE_HEIGHT,
  CROWD_DETAILED_MODEL_LIMIT,
  CROWD_INSTANCED_GEOMETRY_SEGMENTS,
  CROWD_FOOT_RING_SEGMENTS,
  MANNEQUIN_MODEL_URL,
  MANNEQUIN_ANIMATION_URL,
  LOCOMOTION_CROSSFADE_SECONDS,
} from './scene3dConstants'
import {
  vectorFromArray,
  vectorToArray,
  crowdRows,
  crowdColumns,
  crowdSpacing,
  crowdCount,
  rememberMannequinRestPose,
  applyMannequinSkeletonPose,
  captureMannequinGroundReference,
  groundMannequinModel,
  normalizeMannequinModel,
  roleColorForIndex,
  findSceneObjectByRuntimeId,
} from './scene3dMath'

export function Scene3DMeshGeometry({ geometry }: { geometry: Scene3DGeometry | undefined }): JSX.Element {
  if (geometry === 'sphere') return <sphereGeometry args={[0.55, 40, 24]} />
  if (geometry === 'cylinder') return <cylinderGeometry args={[0.46, 0.46, 1.1, 40]} />
  if (geometry === 'plane') return <planeGeometry args={[1, 1]} />
  return <boxGeometry args={[1, 1, 1]} />
}

export function ProceduralMannequin({ color }: { color: string }): JSX.Element {
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

export class MannequinAssetBoundary extends React.Component<MannequinAssetBoundaryProps, { failed: boolean }> {
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

// possess 态被操控假人的「实时迈腿」：用 three 内建 AnimationMixer 播 mannequin-animations.glb 里的
// idle/walk/run clip 驱动骨骼（in-place 原地踏步，前进位移仍由 CharacterDriveController 直驱 group.position）。
// 仅当 activeClip 有值时启用；为空时此 hook 不建 mixer、不每帧更新（静态 pose 路径完全不受影响 → 离屏/群众/不 possess 零回归）。
// 切 clip 用 crossFadeTo 平滑过渡。每帧 mixer.update 后 groundMannequinModel 保证脚踩地不飘。
function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse((object) => {
    if (!found && object instanceof THREE.SkinnedMesh) found = object
  })
  return found
}

// 离屏确定性驱动句柄：stepper 在自己的 useFrame 里（render/capture 之前）imperatively 调用，
// 保证 setTime 后的骨架在同一帧被 captureScene 采到（无一帧滞后；与 applyPoseOverTime 同序）。
// setTime(t)=按该时刻定相位（walk 循环自动取模）；suspend()=该帧被静态动作打断，locomotion 让位静态 pose。
export type MannequinLocomotionDriver = {
  setTime: (clipTime: number) => void
}

function useMannequinLocomotion(
  model: THREE.Object3D,
  activeClip: string | undefined,
  // 给了此 ref（离屏）→ 组件不在自己的 useFrame 自动推进，改由 stepper 通过 ref.current.setTime
  //   在 capture 前 imperatively 驱动（确定性，无一帧滞后）。某帧被静态动作打断时 stepper 不调 setTime，
  //   该帧由 stepper 的 applyPoseOverTime 接管骨架（静态优先）。
  // 缺省（LIVE possess）→ 组件自己的 useFrame 走 mixer.update(delta) 实时路径，行为不变。
  driverRef?: React.MutableRefObject<MannequinLocomotionDriver | null>,
): void {
  // 只在真正要动画时才订阅动画 GLB（useGLTF 内部缓存，重复调用零额外加载）。
  const animationGltf = useGLTF(MANNEQUIN_ANIMATION_URL)
  // 假人的 SkinnedMesh：retarget 的目标 + 播放 mixer 的宿主都用它（绑到 SkinnedMesh 而非外层 group，
  // 否则 PropertyBinding 报「node does not have a skeleton」刷控制台）。
  const targetSkinned = React.useMemo(() => findSkinnedMesh(model), [model])
  // 动画源(three Xbot)与我们假人「零点姿势」差~90°，clip 不能直接套（会躺平爆散，headless+R13 实证）。
  // 用 retargetClip 按两套骨架的绑定差异把每条 clip 校正到我们假人骨架的局部空间，再播；只 retarget 一次后缓存。
  // 源骨架用克隆（retarget 会临时驱动它采样，克隆免污染 useGLTF 共享场景）。失败的 clip 跳过（不假装在动）。
  const clips = React.useMemo(() => {
    const map = new Map<string, THREE.AnimationClip>()
    const sourceSkinned = findSkinnedMesh(cloneSkeleton(animationGltf.scene))
    if (!targetSkinned || !sourceSkinned) return map
    for (const clip of animationGltf.animations as THREE.AnimationClip[]) {
      try {
        map.set(clip.name, retargetClip(targetSkinned, sourceSkinned, clip, { hip: 'mixamorigHips' }))
      } catch (error) {
        console.warn(`Mannequin clip retarget failed: ${clip.name}`, error)
      }
    }
    return map
  }, [animationGltf, targetSkinned])
  const mixerRef = React.useRef<THREE.AnimationMixer | null>(null)
  const currentActionRef = React.useRef<THREE.AnimationAction | null>(null)
  const actionsRef = React.useRef<Map<string, THREE.AnimationAction>>(new Map())

  // activeClip 切换时：建/取 mixer，crossFade 到目标 clip。clip 名变化频率低（仅 idle↔walk↔run 桶切），
  // 非每帧——不会引发渲染风暴。activeClip 变 undefined（退出 possess/换对象）→ 停 mixer 回静态路径。
  React.useEffect(() => {
    if (!activeClip) {
      // 不主动 reset 骨骼：Mannequin 的静态 pose useLayoutEffect 会在 activeClip 缺省时重新应用并落地。
      currentActionRef.current = null
      return
    }
    let mixer = mixerRef.current
    if (!mixer) {
      mixer = new THREE.AnimationMixer(targetSkinned ?? model)
      mixerRef.current = mixer
    }
    const actions = actionsRef.current
    let nextAction = actions.get(activeClip)
    if (!nextAction) {
      const clip = clips.get(activeClip)
      if (!clip) {
        // clip 名对不上 / retarget 失败：诚实退出，回静态路径，别假装在动。
        console.warn(`Mannequin locomotion clip unavailable: ${activeClip}`)
        return
      }
      nextAction = mixer.clipAction(clip)
      nextAction.setLoop(THREE.LoopRepeat, Infinity)
      actions.set(activeClip, nextAction)
    }
    const prevAction = currentActionRef.current
    if (prevAction === nextAction) return
    nextAction.enabled = true
    nextAction.setEffectiveWeight(1)
    nextAction.play()
    if (prevAction) {
      nextAction.reset().play()
      prevAction.crossFadeTo(nextAction, LOCOMOTION_CROSSFADE_SECONDS, false)
    }
    currentActionRef.current = nextAction
    // 离屏：mixer+action 就绪后发布驱动句柄，供 stepper 在 capture 前 imperatively 定相位。
    if (driverRef) {
      driverRef.current = {
        setTime: (clipTime: number) => {
          const m = mixerRef.current
          if (m) m.setTime(clipTime)
        },
      }
    }
  }, [activeClip, clips, targetSkinned, driverRef])

  // 卸载（换对象/退出 possess 销毁组件）时停掉所有 action，释放 mixer。
  React.useEffect(() => () => {
    const mixer = mixerRef.current
    if (mixer) mixer.stopAllAction()
    mixerRef.current = null
    actionsRef.current.clear()
    currentActionRef.current = null
    if (driverRef) driverRef.current = null
  }, [driverRef])

  useFrame((_, delta) => {
    // 离屏（driverRef 在场）：不在此自动推进——由 stepper 在 capture 前调 driver.setTime + 自己落地，
    // 保证「定相位 → 落地 → 采帧」同序无滞后。此处只负责 LIVE 实时路径。
    if (driverRef) return
    const mixer = mixerRef.current
    if (!activeClip || !mixer || !currentActionRef.current) return
    // LIVE 实时：用帧间 delta 推进动画（possess 走路，行为完全不变）。
    mixer.update(delta)
    // clip 让脚上下起伏，每帧按蒙皮最低点重新落地，保证脚踩地不飘（基准沿用现有 groundMannequinModel 逻辑）。
    groundMannequinModel(model as THREE.Group)
  })
}

export function Mannequin({
  color,
  pose,
  activeClip,
  driverRef,
}: {
  color: string
  pose?: Record<string, Scene3DVector3>
  activeClip?: string
  // 给了 driverRef（离屏）→ 发布 locomotion 驱动句柄，由 stepper 在 capture 前 imperatively 定相位（确定性，腿迈）；
  // 缺省 → LIVE 实时推进（possess 走路不变）。
  driverRef?: React.MutableRefObject<MannequinLocomotionDriver | null>
}): JSX.Element {
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
    captureMannequinGroundReference(cloned)
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

  // 静态 pose 路径：仅当未启用 locomotion 动画时应用逐骨姿势 + 落地。
  // activeClip 有值时由 useMannequinLocomotion 的 mixer 接管骨骼，这里不再写骨骼（否则两条路径打架）。
  React.useLayoutEffect(() => {
    if (activeClip) return
    applyMannequinSkeletonPose(model.object, pose)
    groundMannequinModel(model.object)
  }, [model, pose, activeClip])

  useMannequinLocomotion(model.object, activeClip, driverRef)

  return <primitive object={model.object} />
}

useGLTF.preload(MANNEQUIN_MODEL_URL)
useGLTF.preload(MANNEQUIN_ANIMATION_URL)

export function mannequinFootRingRadius(object: Scene3DObject): number {
  const scaleX = Math.max(0.08, Math.abs(object.scale[0] || 1))
  const scaleZ = Math.max(0.08, Math.abs(object.scale[2] || 1))
  return Math.max(0.28, Math.max(0.78 * scaleX, 0.54 * scaleZ) * 0.36)
}

export function crowdCenterSpacing(object: Scene3DObject): number {
  return crowdSpacing(object) + mannequinFootRingRadius(object) * 2
}

export function crowdLocalOffset(object: Scene3DObject, index: number): THREE.Vector3 {
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

export function crowdLocalOffsets(object: Scene3DObject): THREE.Vector3[] {
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

export function InstancedMeshBatch({
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

export function InstancedProceduralMannequinCrowd({
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

export function MannequinCrowd({
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

export function ProceduralMannequinCrowd({
  object,
  roleStartIndex,
}: {
  object: Scene3DObject
  roleStartIndex: number
}): JSX.Element {
  return <InstancedProceduralMannequinCrowd object={object} roleStartIndex={roleStartIndex} />
}

export function LightObject({ object }: { object: Scene3DObject }): JSX.Element {
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

export function mannequinLabelHeight(object: Scene3DObject): number {
  return Math.max(0.8, Math.abs(object.scale[1] || 1) * MANNEQUIN_LABEL_BASE_HEIGHT)
}

export function MannequinRoleLabel({ position, label }: { position: Scene3DVector3; label: string }): JSX.Element {
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

export function singleMannequinLabelPosition(object: Scene3DObject): Scene3DVector3 {
  return [
    object.position[0],
    object.position[1] + mannequinLabelHeight(object),
    object.position[2],
  ]
}

export function crowdLabelPositions(object: Scene3DObject): Scene3DVector3[] {
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

export function objectGroundFootprint(object: Scene3DObject): { width: number; depth: number } {
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

export function objectVisualHalfHeight(object: Scene3DObject, scale: Scene3DVector3 = object.scale): number {
  const scaleY = Math.max(0.08, Math.abs(scale[1] || 1))
  if (object.type === 'light') return 0.12 * scaleY
  if (object.type === 'mannequin' || object.type === 'mannequinCrowd') return 0.5 * scaleY
  if (object.geometry === 'sphere') return 0.55 * scaleY
  if (object.geometry === 'cylinder') return 0.55 * scaleY
  if (object.geometry === 'plane') return 0
  return 0.5 * scaleY
}

export function objectTransformAnchorPosition(object: Scene3DObject): Scene3DVector3 {
  return [
    object.position[0],
    object.position[1] - objectVisualHalfHeight(object),
    object.position[2],
  ]
}

export function nextAvailableObjectPosition(object: Scene3DObject, objects: Scene3DObject[]): Scene3DVector3 {
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

// 脚环的共享环面（几何 + 材质），所有脚环组件同用，单一真相源（位置由各自的 mesh 决定）。
function FootRingSurface({ radius, segments = 72 }: { radius: number; segments?: number }): JSX.Element {
  return (
    <>
      <ringGeometry args={[radius * 0.92, radius, segments]} />
      <meshBasicMaterial
        color={MANNEQUIN_FOOT_RING_COLOR}
        depthWrite={false}
        opacity={0.8}
        side={THREE.DoubleSide}
        transparent
        toneMapped={false}
      />
    </>
  )
}

export function FootRing({
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
      <FootRingSurface radius={radius} />
    </mesh>
  )
}

// possess 直驱期间的脚环：每帧跟住被操控假人 group 的实时世界 x/z（同一个 group、按 runtime id 取，
// 不读节流滞后的 state position → 零滞后不掉队）。仅用于被操控的那一个假人，其它走静态脚环（零回归）。
export function LiveFootRing({ runtimeId, radius }: { runtimeId: string; radius: number }): JSX.Element {
  const meshRef = React.useRef<THREE.Mesh>(null)
  const { scene } = useThree()
  const groupRef = React.useRef<THREE.Object3D | null>(null)
  const worldPos = React.useMemo(() => new THREE.Vector3(), [])

  // 换被操控对象（runtimeId 变）→ 丢缓存 group，下帧按新 id 重解析。
  React.useLayoutEffect(() => { groupRef.current = null }, [runtimeId])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    let group = groupRef.current
    if (!group || !group.parent) {
      group = findSceneObjectByRuntimeId(scene, runtimeId)
      groupRef.current = group
    }
    if (!group) return
    group.getWorldPosition(worldPos)
    mesh.position.set(worldPos.x, OBJECT_GROUND_GUIDE_ELEVATION, worldPos.z) // 贴地：x/z 跟角色，y 锁地面高度
  })

  return (
    <mesh
      ref={meshRef}
      raycast={() => null}
      renderOrder={3}
      rotation={[-Math.PI / 2, 0, 0]}
      userData={{ [CAMERA_HELPER_FLAG]: true }}
    >
      <FootRingSurface radius={radius} />
    </mesh>
  )
}

export function InstancedFootRings({
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
      <FootRingSurface radius={radius} segments={CROWD_FOOT_RING_SEGMENTS} />
    </instancedMesh>
  )
}

// possessed = 该假人正被 possess 直驱 → 脚环每帧跟住实时 group（不滞后）。其它一律静态脚环（零回归）。
export function MannequinFootRings({
  object,
  possessed,
}: {
  object: Scene3DObject
  possessed?: boolean
}): JSX.Element | null {
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
    if (possessed) return <LiveFootRing runtimeId={object.id} radius={baseRadius} />
    return <FootRing position={[object.position[0], 0, object.position[2]]} radius={baseRadius} />
  }

  return <InstancedFootRings positions={positions} radius={baseRadius} />
}

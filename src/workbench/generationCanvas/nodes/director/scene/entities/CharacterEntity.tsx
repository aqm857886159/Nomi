/**
 * [INPUT]: 依赖 react、three、@react-three/drei 的 useGLTF / useFBX、../character/characterAsset 的 isFbxUrl / resolveCharacterModelUrl、three/examples/jsm/utils/SkeletonUtils 的 clone、
 *          ../character/mannequinAssets 的 MANNEQUIN_MODEL_URL、../character/mannequinSkeleton 的
 *          rememberMannequinRestPose / normalizeMannequinModel / applyMannequinSkeletonPose（贴地不在这里——首帧前按失效 boneMatrices 算最低点会把角色抬高 0.39m，贴地住 useCharacterRig 首帧）、
 *          ../character/characterRig 的 measureSkeletonExtent（骨骼量身高）、../../model/directorTypes 的 DirectorObject、../sceneRefs 的 DIRECTOR_PICK_LAYER、../SceneRegistryContext 的 useSceneRegistry（登记双脚吸附处理器）、../sceneTheme
 * [OUTPUT]: 对外提供 CharacterEntity（内置 X Bot 或用户上传的 Mixamo 角色，GLB/GLTF/FBX；按骨骼范围量身高缩放到 CHARACTER_HEIGHT 米、首帧贴地）；
 *           + 拾取图层上的不渲染胶囊碰撞体、颜色着色、白模（clay）时屏蔽贴图统一石膏色、
 *           每帧骨骼管线（../character/useCharacterRig：动作 / 姿态关键帧 / 手调偏移 / IK / 视线 / 骨盆偏移）+ 骨骼编辑态的 IK 把手；加载失败退化为胶囊体
 * [POS]: director/scene/entities 的角色渲染。资产与骨骼工具住 ../character/（mannequinAssets / mannequinSkeleton），不各自复制。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFBX, useGLTF } from '@react-three/drei'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MANNEQUIN_MODEL_URL } from '../character/mannequinAssets'
import { applyMannequinSkeletonPose, normalizeMannequinModel, rememberMannequinRestPose } from '../character/mannequinSkeleton'
import type { DirectorObject, DirectorRig } from '../../model/directorTypes'
import { useDirectorStore } from '../../DirectorEditorContext'
import { measureSkeletonExtent } from '../character/characterRig'
import { SkeletonHandles } from '../character/SkeletonHandles'
import { SkeletonVisual } from '../character/SkeletonVisual'
import { useCharacterRig } from '../character/useCharacterRig'
import { DIRECTOR_PICK_LAYER } from '../sceneRefs'
import { CHARACTER_COLOR_PRESETS, CLAY_COLOR } from '../sceneTheme'
import { useSceneRegistry } from '../SceneRegistryContext'
import { isFbxUrl, resolveCharacterModelUrl } from '../character/characterAsset'

// 假人真实身高（米）：X Bot 归一化后按此缩放；脚底落在对象原点
export const CHARACTER_HEIGHT = 1.75

type Boundary = { failed: boolean }

class CharacterAssetBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, Boundary> {
  state: Boundary = { failed: false }
  static getDerivedStateFromError(): Boundary {
    return { failed: true }
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function CapsuleFallback({ color }: { color: string }): JSX.Element {
  return (
    <group position={[0, CHARACTER_HEIGHT / 2, 0]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.25, CHARACTER_HEIGHT - 0.5, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  )
}

type MaterialOriginal = { map: THREE.Texture | null; roughness: number; metalness: number }

// 点选碰撞体：X Bot 的蒙皮网格（量化几何 + 骨骼矩阵）对 three 射线测试不可靠（2026-09-02 栽过：包围球命中、三角面 0 命中），
// 而且 5 万三角面逐个测也没必要。角色用一根不渲染的胶囊做拾取代理，放在拾取专用图层，主相机 / 描边 / 截图都看不见它。
function PickProxy(): JSX.Element {
  const ref = React.useRef<THREE.Mesh>(null)
  React.useLayoutEffect(() => {
    ref.current?.layers.set(DIRECTOR_PICK_LAYER)
  }, [])
  return (
    // 比假人略胖略高（半径 0.36、总高 1.9m），点到头顶 / 手边也能选中
    <mesh ref={ref} position={[0, 0.95, 0]}>
      <capsuleGeometry args={[0.36, 1.9 - 0.72, 4, 8]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

type MannequinModelProps = { objectId: string; rig: DirectorRig; color: string; selected: boolean; clay: boolean }

function MannequinModel({ objectId, rig, color, selected, clay, scene }: MannequinModelProps & { scene: THREE.Object3D }): JSX.Element {
  const mountRef = React.useRef<THREE.Group>(null)
  const model = React.useMemo(() => {
    const skeleton = cloneSkeleton(scene)
    rememberMannequinRestPose(skeleton)
    const normalized = normalizeMannequinModel(skeleton)
    const materials: THREE.MeshStandardMaterial[] = []
    const originals = new Map<THREE.MeshStandardMaterial, MaterialOriginal>()
    let skinned: THREE.SkinnedMesh | null = null
    normalized.traverse((object) => {
      if (!skinned && object instanceof THREE.SkinnedMesh) skinned = object
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      object.frustumCulled = false
      const cloneMaterial = (material: THREE.Material) => {
        const next = material.clone()
        if (next instanceof THREE.MeshStandardMaterial) {
          materials.push(next)
          originals.set(next, { map: next.map, roughness: next.roughness, metalness: next.metalness })
        }
        return next
      }
      object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material)
    })
    // 真实身高按静止姿态下骨骼的竖向范围量，不信任 normalize 的单位高（X Bot hips 骨自带 1.809 倍 scale，
    // 几何盒少算这层，2026-09-02 量到假人 3.2m）；脚趾骨先落在 y=0，首帧再按蒙皮最低点精确贴地（useCharacterRig）
    applyMannequinSkeletonPose(normalized)
    // measureSkeletonExtent 量的是 normalized 局部（原始模型单位），挂载组在 normalized 外层再缩一次，
    // 所以要先乘回 normalized.scale 才是挂载组眼里的高度（2026-09-04：少乘这层，假人只有 0.97m，把手看着大一倍）
    const extent = measureSkeletonExtent(normalized) ?? { minY: -0.5, maxY: 0.5 }
    const unitsHeight = Math.max(0.001, (extent.maxY - extent.minY) * normalized.scale.y)
    const fit = { scale: CHARACTER_HEIGHT / unitsHeight, baseY: (-extent.minY * normalized.scale.y * CHARACTER_HEIGHT) / unitsHeight }
    return { object: normalized, materials, originals, skinned: skinned as THREE.SkinnedMesh | null, fit }
  }, [scene])
  const rigApi = useCharacterRig({ objectId, rig, root: model.object, skinned: model.skinned, mountRef, mountBaseY: model.fit.baseY })
  const registry = useSceneRegistry()
  React.useEffect(() => {
    registry.registerFeetSnapper(objectId, rigApi.snapFeetToGround)
    return () => registry.registerFeetSnapper(objectId, null)
  }, [registry, objectId, rigApi.snapFeetToGround])

  React.useEffect(() => {
    const { materials } = model
    return () => materials.forEach((material) => material.dispose())
  }, [model])

  // 白模：屏蔽贴图、统一石膏色；实体/半透模式恢复原贴图与粗糙度（半透不影响角色）
  React.useLayoutEffect(() => {
    model.materials.forEach((material) => {
      const original = model.originals.get(material)
      const baseColor = clay ? CLAY_COLOR : color
      material.color.set(baseColor)
      material.map = clay ? null : original?.map ?? null
      material.roughness = clay ? 0.95 : original?.roughness ?? material.roughness
      material.metalness = clay ? 0 : original?.metalness ?? material.metalness
      material.emissive.set(selected ? baseColor : '#000000')
      material.emissiveIntensity = selected ? 0.12 : 0
      material.needsUpdate = true
    })
  }, [clay, color, model, selected])

  return (
    <>
      <group ref={mountRef} name="characterMount" scale={model.fit.scale} position={[0, model.fit.baseY, 0]}>
        <primitive object={model.object} />
      </group>
      <SkeletonVisual objectId={objectId} rig={rig} root={model.object} boneIndex={rigApi.boneIndex} />
      <SkeletonHandles objectId={objectId} rig={rig} api={rigApi} selected={selected} />
    </>
  )
}

const CLAY_HEX = `#${CLAY_COLOR.toString(16).padStart(6, '0')}`

function GltfCharacter({ url, ...props }: MannequinModelProps & { url: string }): JSX.Element {
  const { scene } = useGLTF(url)
  return <MannequinModel {...props} scene={scene} />
}

function FbxCharacter({ url, ...props }: MannequinModelProps & { url: string }): JSX.Element {
  const scene = useFBX(url)
  return <MannequinModel {...props} scene={scene} />
}

export function CharacterEntity({ object, selected }: { object: DirectorObject; selected: boolean }): JSX.Element {
  const clay = useDirectorStore((state) => state.activeScene().sceneConfig.modelDisplayMode === 'clay')
  const color = clay ? CLAY_HEX : object.color || CHARACTER_COLOR_PRESETS[0].value
  const url = resolveCharacterModelUrl(object.modelPath)
  const props: MannequinModelProps = { objectId: object.id, rig: object.rig ?? 'mixamo', color, selected, clay }
  return (
    <>
      <PickProxy />
      <CharacterAssetBoundary fallback={<CapsuleFallback color={color} />}>
        <React.Suspense fallback={<CapsuleFallback color={color} />}>
          {isFbxUrl(url) ? <FbxCharacter {...props} url={url} /> : <GltfCharacter {...props} url={url} />}
        </React.Suspense>
      </CharacterAssetBoundary>
    </>
  )
}

useGLTF.preload(MANNEQUIN_MODEL_URL)

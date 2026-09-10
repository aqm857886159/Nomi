/**
 * [INPUT]: 依赖 react、three、@react-three/fiber（useFrame）、../../../fencedCanvas 的 FencedCanvas（workbench 内禁裸 Canvas）、@react-three/drei（OrbitControls / useGLTF）、three/examples/jsm/utils/SkeletonUtils 的 clone、../../scene/character/mannequinAssets 的 MANNEQUIN_MODEL_URL、
 *          ../../scene/character/mannequinSkeleton（normalizeMannequinModel / applyMannequinSkeletonPose）、../../scene/character/poseClipLibrary（samplePoseClip / poseClipSourceBind / preloadPoseClips）、
 *          ../../scene/character/poseSnapshot（indexBonesByBaseName / bindWorldQuaternionsByBaseName / applyPoseSnapshot / HIPS_BASE_NAME）、../../scene/character/characterRig 的 measureSkeletonExtent、../../scene/sceneTheme 的 PREVIEW_COLORS
 * [OUTPUT]: 对外提供 ActionPreview：动作库弹窗右侧的实时 3D 预览（X Bot + 网格地面 + 三灯 + OrbitControls，
 *           按秒表采样当前动作循环播放；resetSignal 变化即把视角归位到 (0,1.2,2.6) 看 (0,0.9,0)）
 * [POS]: director/panels/dialogs 的预览小场景：与主视口互不相干（自己的 Canvas / 相机 / 灯），采样与套骨走和角色实体同一套 poseClipLibrary / poseSnapshot，所见即成片。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { FencedCanvas } from '../../../fencedCanvas'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { measureSkeletonExtent } from '../../scene/character/characterRig'
import { PREVIEW_COLORS } from '../../scene/sceneTheme'
import { MANNEQUIN_MODEL_URL } from '../../scene/character/mannequinAssets'
import { applyMannequinSkeletonPose, normalizeMannequinModel, rememberMannequinRestPose } from '../../scene/character/mannequinSkeleton'
import { poseClipSourceBind, preloadPoseClips, samplePoseClip } from '../../scene/character/poseClipLibrary'
import { applyPoseSnapshot, bindWorldQuaternionsByBaseName, HIPS_BASE_NAME, indexBonesByBaseName } from '../../scene/character/poseSnapshot'

const CAMERA_POSITION = new THREE.Vector3(0, 1.2, 2.6)
const CAMERA_TARGET = new THREE.Vector3(0, 0.9, 0)
const CHARACTER_HEIGHT = 1.8

function PreviewCharacter({ actionId, onReady }: { actionId: string; onReady: () => void }): JSX.Element {
  const { scene } = useGLTF(MANNEQUIN_MODEL_URL)
  const model = React.useMemo(() => {
    // 蒙皮模型必须用 SkeletonUtils.clone：Object3D.clone 不复制骨架，克隆出来的骨动了网格不跟
    const skeleton = cloneSkinned(scene)
    // 先记 rest（applyMannequinSkeletonPose 的复位靠它；不记就每帧累加基线偏移，预览的人越转越歪——2026-09-04 「动作库的手看起来很奇怪」根因之一）
    rememberMannequinRestPose(skeleton)
    const root = normalizeMannequinModel(skeleton)
    applyMannequinSkeletonPose(root)
    // 与 CharacterEntity 同法：骨骼范围量的是 root 局部（原始单位），乘回 root.scale 才是外层看到的高度
    const extent = measureSkeletonExtent(root) ?? { minY: -0.5, maxY: 0.5 }
    const scale = CHARACTER_HEIGHT / Math.max(0.001, (extent.maxY - extent.minY) * root.scale.y)
    return { root, scale, baseY: -extent.minY * root.scale.y * scale }
  }, [scene])
  const bones = React.useMemo(() => indexBonesByBaseName(model.root), [model.root])
  const bindWorld = React.useMemo(() => bindWorldQuaternionsByBaseName(model.root), [model.root])
  const restHips = React.useMemo(() => bones.get(HIPS_BASE_NAME)?.position.clone() ?? null, [bones])
  const clock = React.useMemo(() => new THREE.Clock(), [])
  React.useEffect(() => {
    void preloadPoseClips().then(onReady)
  }, [onReady])
  useFrame(() => {
    applyMannequinSkeletonPose(model.root)
    const hips = bones.get(HIPS_BASE_NAME)
    if (hips && restHips) hips.position.copy(restHips)
    const snapshot = samplePoseClip(actionId, clock.getElapsedTime())
    const sourceBind = poseClipSourceBind(actionId)
    if (snapshot && sourceBind) applyPoseSnapshot(bones, snapshot, { weight: 1, sourceBind, targetBindWorld: bindWorld, root: model.root, restHips })
  })
  return (
    <group scale={model.scale} position={[0, model.baseY, 0]}>
      <primitive object={model.root} />
    </group>
  )
}

function PreviewRig({ resetSignal }: { resetSignal: number }): JSX.Element {
  const controls = React.useRef<React.ComponentRef<typeof OrbitControls>>(null)
  React.useEffect(() => {
    const item = controls.current
    if (!item) return
    item.object.position.copy(CAMERA_POSITION)
    item.target.copy(CAMERA_TARGET)
    item.update()
  }, [resetSignal])
  return <OrbitControls ref={controls} enableDamping dampingFactor={0.05} minDistance={1} maxDistance={5} maxPolarAngle={Math.PI / 2 + 0.1} target={CAMERA_TARGET} />
}

export function ActionPreview({ actionId, resetSignal, onReady }: { actionId: string; resetSignal: number; onReady: () => void }): JSX.Element {
  return (
    <FencedCanvas camera={{ position: CAMERA_POSITION.toArray(), fov: 42, near: 0.1, far: 50 }} dpr={[1, 2]} shadows gl={{ antialias: true }} style={{ width: '100%', height: '100%' }}>
      <color attach="background" args={[PREVIEW_COLORS.background]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} castShadow />
      <directionalLight position={[-3, 3, -3]} intensity={0.35} />
      <gridHelper args={[10, 20, PREVIEW_COLORS.gridMajor, PREVIEW_COLORS.gridMinor]} />
      <React.Suspense fallback={null}>
        <PreviewCharacter actionId={actionId} onReady={onReady} />
      </React.Suspense>
      <PreviewRig resetSignal={resetSignal} />
    </FencedCanvas>
  )
}

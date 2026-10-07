/**
 * [INPUT]: 依赖 three、three/examples/jsm/utils/SkeletonUtils 的 clone、./mannequinAssets 的 MANNEQUIN_MODEL_URL、./mannequinSkeleton（rememberMannequinRestPose / normalizeMannequinModel / applyMannequinSkeletonPose）、
 *          ./characterRig 的 measureSkeletonExtent、./canonicalBoneFrame 的 attachCanonicalBoneFrames、../../model/rigs 的 isBuiltinCharacterModel、
 *          ../../model/directorSpace 的 CHARACTER_HEIGHT、../../model/assetCatalog/ualActions 的 UAL_MANNEQUIN_HEIGHT_M、../../model/directorTypes 的 DirectorRig
 * [OUTPUT]: 对外提供 resolveCharacterModelUrl、isFbxUrl、hasMixamoRig、PreparedCharacterModel、prepareCharacterModel
 * [POS]: director/scene/character 的角色资产小工具（零 React）：内置人偶 builtin:* → 默认 UAL 人偶；用户上传按 modelPath；FBX / GLB 分 loader；
 *        Mixamo 骨骼检测决定「升格为角色还是普通模型」；prepareCharacterModel = 克隆骨架 → 记 rest → 定高（内置 UAL 用 manifest 实高、原点即脚底；
 *        上传模型归一后按骨骼竖向范围量）→ rig=ual 挂规范骨轴换算。CharacterEntity 与 ModelEntity 共用，不放组件文件里（react-refresh 只认组件导出）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { UAL_MANNEQUIN_HEIGHT_M } from '../../model/assetCatalog/ualActions'
import { CHARACTER_HEIGHT } from '../../model/directorSpace'
import type { DirectorRig } from '../../model/directorTypes'
import { isBuiltinCharacterModel } from '../../model/rigs'
import { attachCanonicalBoneFrames } from './canonicalBoneFrame'
import { measureSkeletonExtent } from './characterRig'
import { MANNEQUIN_MODEL_URL } from './mannequinAssets'
import { applyMannequinSkeletonPose, normalizeMannequinModel, rememberMannequinRestPose } from './mannequinSkeleton'

export function resolveCharacterModelUrl(modelPath: string | undefined): string {
  return isBuiltinCharacterModel(modelPath) ? MANNEQUIN_MODEL_URL : modelPath!
}

export function isFbxUrl(url: string): boolean {
  return /\.fbx(?:[?#].*)?$/i.test(url)
}

export function hasMixamoRig(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((object) => {
    if (!found && (object as THREE.Bone).isBone && /mixamorig/i.test(object.name)) found = true
  })
  return found
}

export type PreparedCharacterModel = {
  /** 挂进挂载组的根（骨架根，useCharacterRig 的 root） */
  object: THREE.Object3D
  skinned: THREE.SkinnedMesh | null
  /** 挂载组的缩放与基准高度：缩到 CHARACTER_HEIGHT 米、静止姿态下脚底落在对象原点（首帧再按蒙皮最低点精确贴地，useCharacterRig） */
  fit: { scale: number; baseY: number }
}

/**
 * 每个角色实例一份：蒙皮模型必须用 SkeletonUtils.clone（Object3D.clone 不复制骨架，骨动了网格不跟），克隆后立刻记 rest（复位幂等靠它）。
 * 内置 UAL：原点就在脚底（ground-min-z），网格实高 = manifest heightM——不按骨骼范围量（UAL 没有头顶末端骨，骨范围只到 1.568m，人会被放大到 2.06m）。
 * 上传模型：归一成 1 单位高后按静止姿态骨骼竖向范围量（不信任几何盒：X Bot 类模型 hips 骨自带缩放），乘回归一缩放才是挂载组眼里的高度。
 */
export function prepareCharacterModel(scene: THREE.Object3D, { builtin, rig }: { builtin: boolean; rig: DirectorRig }): PreparedCharacterModel {
  const skeleton = cloneSkeleton(scene)
  rememberMannequinRestPose(skeleton)
  attachCanonicalBoneFrames(skeleton, rig)
  let object: THREE.Object3D
  let fit: PreparedCharacterModel['fit']
  if (builtin) {
    object = new THREE.Group().add(skeleton)
    applyMannequinSkeletonPose(object)
    fit = { scale: CHARACTER_HEIGHT / UAL_MANNEQUIN_HEIGHT_M, baseY: 0 }
  } else {
    object = normalizeMannequinModel(skeleton)
    applyMannequinSkeletonPose(object)
    const extent = measureSkeletonExtent(object) ?? { minY: -0.5, maxY: 0.5 }
    const unitsHeight = Math.max(0.001, (extent.maxY - extent.minY) * object.scale.y)
    fit = { scale: CHARACTER_HEIGHT / unitsHeight, baseY: (-extent.minY * object.scale.y * CHARACTER_HEIGHT) / unitsHeight }
  }
  let skinned: THREE.SkinnedMesh | null = null
  object.traverse((child) => {
    if (!skinned && child instanceof THREE.SkinnedMesh) skinned = child
  })
  return { object, skinned, fit }
}

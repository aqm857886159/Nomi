/**
 * [INPUT]: 依赖 three、../../model/posePresets 的 PoseVec3
 * [OUTPUT]: 对外提供 MANNEQUIN_REST_ROTATION_KEY、normalizeMannequinBoneName / mannequinBoneNameVariants、
 *           rememberMannequinRestPose / applyMannequinSkeletonPose / normalizeMannequinModel
 * [POS]: director/scene/character 的假人骨架数学（原 V1 scene3dMath / scene3dCharacterDrive 的纯函数，切换门入籍）：
 *        骨名两种写法（mixamorig: / mixamorig）互认；bind rest 记在 userData，复位 = 纯 rest（= Mixamo bind = T-Pose）；
 *        normalizeMannequinModel 把任意 GLB 归一成 1 单位高、居中的组（CharacterEntity 再按骨骼身高缩放）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import type { PoseVec3 } from '../../model/posePresets'

export const MANNEQUIN_REST_ROTATION_KEY = 'directorRestRotation'

export function normalizeMannequinBoneName(boneName: string): string {
  return boneName.replace(/^mixamorig:/, 'mixamorig')
}

export function mannequinBoneNameVariants(boneName: string): string[] {
  const normalizedName = normalizeMannequinBoneName(boneName)
  const colonName = normalizedName.replace(/^mixamorig/, 'mixamorig:')
  return Array.from(new Set([boneName, normalizedName, colonName]))
}


export function rememberMannequinRestPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    object.userData[MANNEQUIN_REST_ROTATION_KEY] = [object.rotation.x, object.rotation.y, object.rotation.z] satisfies PoseVec3
  })
}

// 把每根骨复位到 bind rest（重复调用幂等）。x-bot.glb 的 rest 与 Mixamo FBX 的 bind 逐骨一致（2026-09-04 实测含手指 0.0°），
// 这就是 「T-Pose (绑定姿态)」；V1 那层「自然站姿基线」（手臂下压 67.5°、头颈抬 18°）已删——它让复位态偏离 bind，
// 动作库套骨时手 / 手臂整体拧掉 83°，用户「动作库的手看起来很奇怪」。
export function applyMannequinSkeletonPose(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    const restRotation = object.userData[MANNEQUIN_REST_ROTATION_KEY] as PoseVec3 | undefined
    if (!restRotation) return
    object.rotation.set(restRotation[0], restRotation[1], restRotation[2])
  })
  root.updateMatrixWorld(true)
}

// 任意模型 → 1 单位高、包围盒居中的组（外层再按骨骼身高缩到真实米数）
export function normalizeMannequinModel(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const normalized = new THREE.Group()
  const height = Math.max(0.001, size.y)
  root.position.sub(center)
  normalized.scale.setScalar(1 / height)
  normalized.add(root)
  normalized.updateMatrixWorld(true)
  return normalized
}


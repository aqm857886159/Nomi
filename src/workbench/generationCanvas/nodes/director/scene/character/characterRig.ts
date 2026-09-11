/**
 * [INPUT]: 依赖 three、./mannequinSkeleton 的 mannequinBoneNameVariants、
 *          ../../model/rigs（boneName / SemanticBone）、
 *          ../../model/ikChains（IK_TARGETS / IkTargetKey / IkHandleKey）、../../model/directorTypes（DirectorRig / Vec3）、../../model/vec3（DEG_TO_RAD / RAD_TO_DEG）、
 *          ../../model/lookAtSolve 的 DistributedAim
 * [OUTPUT]: 对外提供 BoneIndex / indexBones / findBoneByName / findSemanticBone / findSkinnedMesh / applyBoneRotationOffsets / applyLookAtOffsets / offsetFromBase /
 *           GROUND_FOOT_Y / solveTwoBoneIk / solveChestToward /
 *           IkChain / chainForHandle / solveCcd / poleRestPosition / rotateLimbPlaneToward / lowestSkinnedY / boneEulerDegrees / normalizeBoneKey
 * [POS]: director/scene/character 的 three 侧骨骼工具（零 React）：骨名解析（rig 语义 → 真实骨、mixamorig 冒号变体）、旋转偏移叠加、
 *        CCD IK、极向量（肘 / 膝朝向：把手静止位 = 中节向肢体平面外侧 distance 米，拖它 = 整条肢体绕 根→末端 轴转；动作快照的套用住 poseSnapshot.ts）。IK 自写而不用 three 的 CCDIKSolver：它要求靶点是骨架里的一根骨，
 *        X Bot 没有多余靶骨，运行时往 skeleton 加骨比 30 行 CCD 贵得多（R20：不在护城河上但标准算法极小，自写等价）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { mannequinBoneNameVariants } from './mannequinSkeleton'
import type { DirectorRig, Vec3 } from '../../model/directorTypes'
import { IK_TARGETS, type IkHandleKey, type IkTargetKey } from '../../model/ikChains'
import type { DistributedAim } from '../../model/lookAtSolve'
import { boneName, type SemanticBone } from '../../model/rigs'
import { DEG_TO_RAD, RAD_TO_DEG } from '../../model/vec3'

export type BoneIndex = Map<string, THREE.Bone>

// 骨名统一成无冒号形式（mixamorig:Hips → mixamorigHips），boneRotations 的键和预设一致
export function normalizeBoneKey(name: string): string {
  return name.replace(':', '')
}

export function indexBones(root: THREE.Object3D): BoneIndex {
  const index: BoneIndex = new Map()
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    for (const variant of mannequinBoneNameVariants(object.name)) index.set(variant, object)
    index.set(object.name.toLowerCase().replace(/^.*:/, ''), object)
  })
  return index
}

export function findBoneByName(index: BoneIndex, name: string): THREE.Bone | undefined {
  return index.get(name) ?? index.get(normalizeBoneKey(name)) ?? index.get(name.toLowerCase().replace(/^.*:/, ''))
}

export function findSemanticBone(index: BoneIndex, rig: DirectorRig, bone: SemanticBone): THREE.Bone | undefined {
  return findBoneByName(index, boneName(rig, bone))
}

// 骨骼在 root 局部空间的竖向范围（头顶端点 → 脚趾），用来定真实身高：不走蒙皮包围盒——它在首帧渲染前拿不到有效 boneMatrices，
// 而 X Bot 的 hips 骨自带 1.809 倍 scale，几何盒会少算这一层（2026-09-02 量到假人 3.2m 栽过）
export function measureSkeletonExtent(root: THREE.Object3D): { minY: number; maxY: number } | null {
  root.updateMatrixWorld(true)
  let minY: number | null = null
  let maxY: number | null = null
  const point = new THREE.Vector3()
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return
    object.getWorldPosition(point)
    root.worldToLocal(point)
    minY = minY === null ? point.y : Math.min(minY, point.y)
    maxY = maxY === null ? point.y : Math.max(maxY, point.y)
  })
  return minY === null || maxY === null ? null : { minY, maxY }
}

export function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null
  root.traverse((object) => {
    if (!found && object instanceof THREE.SkinnedMesh) found = object
  })
  return found
}

// 在当前骨骼旋转上叠加度偏移（weight 缩放角度，用于淡入淡出）
export function applyBoneRotationOffsets(index: BoneIndex, rotations: Record<string, Vec3>, weight: number = 1): void {
  if (weight <= 0) return
  for (const [name, value] of Object.entries(rotations)) {
    const bone = findBoneByName(index, name)
    if (!bone || (value.x === 0 && value.y === 0 && value.z === 0)) continue
    // 偏移是骨局部坐标系里的一次旋转，右乘到当前四元数上（不是欧拉角相加）
    _offsetQuat.setFromEuler(_offsetEuler.set(value.x * DEG_TO_RAD * weight, value.y * DEG_TO_RAD * weight, value.z * DEG_TO_RAD * weight))
    bone.quaternion.multiply(_offsetQuat)
  }
}
const _offsetQuat = new THREE.Quaternion()
const _offsetEuler = new THREE.Euler()

// 视线分配：yaw 绕骨的 Y、pitch 绕骨的 X（Mixamo 头/颈/脊的局部轴与身体轴基本对齐；+x = 低头）
export function applyLookAtOffsets(index: BoneIndex, rig: DirectorRig, aim: DistributedAim): void {
  const pairs: Array<[SemanticBone, { yaw: number; pitch: number }]> = [
    ['head', aim.head],
    ['neck', aim.neck],
    ['spine1', aim.spine],
  ]
  for (const [semantic, value] of pairs) {
    const bone = findSemanticBone(index, rig, semantic)
    if (!bone) continue
    bone.rotation.y += value.yaw * DEG_TO_RAD
    bone.rotation.x += value.pitch * DEG_TO_RAD
  }
}

export type IkChain = { key: IkHandleKey; effector: THREE.Bone; links: THREE.Bone[]; iteration: number; maxAngle: number }

// 把手 → 链：五条靶点链按 ikChains 配置；胸腔把手 = 脊柱两节；骨盆不是链（拖它改骨盆偏移）
export function chainForHandle(index: BoneIndex, rig: DirectorRig, key: IkHandleKey): IkChain | null {
  if (key === 'chest') {
    const effector = findSemanticBone(index, rig, 'spine2')
    const links = [findSemanticBone(index, rig, 'spine1'), findSemanticBone(index, rig, 'spine')]
    if (!effector || links.some((bone) => !bone)) return null
    return { key, effector, links: links as THREE.Bone[], iteration: 10, maxAngle: 0.4 }
  }
  if (!(key in IK_TARGETS)) return null
  const config = IK_TARGETS[key as IkTargetKey]
  const effector = findSemanticBone(index, rig, config.effector)
  const links = config.links.map((link) => findSemanticBone(index, rig, link))
  if (!effector || links.some((bone) => !bone)) return null
  return { key, effector, links: links as THREE.Bone[], iteration: config.iteration, maxAngle: config.maxAngle }
}

const _effectorPos = new THREE.Vector3()
const _linkPos = new THREE.Vector3()
const _linkQuat = new THREE.Quaternion()
const _invQuat = new THREE.Quaternion()
const _toEffector = new THREE.Vector3()
const _toTarget = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _step = new THREE.Quaternion()

// CCD：从靠近末端的链节起，每节把「到末端」转向「到靶点」，单步转角封顶 maxAngle；末端够近就停
export function solveCcd(chain: IkChain, targetWorld: THREE.Vector3, tolerance: number = 0.003): void {
  for (let iteration = 0; iteration < chain.iteration; iteration += 1) {
    for (const link of chain.links) {
      link.getWorldPosition(_linkPos)
      chain.effector.getWorldPosition(_effectorPos)
      link.getWorldQuaternion(_linkQuat)
      _invQuat.copy(_linkQuat).invert()
      _toEffector.copy(_effectorPos).sub(_linkPos).applyQuaternion(_invQuat).normalize()
      _toTarget.copy(targetWorld).sub(_linkPos).applyQuaternion(_invQuat).normalize()
      let angle = Math.acos(THREE.MathUtils.clamp(_toEffector.dot(_toTarget), -1, 1))
      if (angle < 1e-5) continue
      angle = Math.min(angle, chain.maxAngle)
      _axis.crossVectors(_toEffector, _toTarget)
      if (_axis.lengthSq() < 1e-8) continue
      _axis.normalize()
      link.quaternion.multiply(_step.setFromAxisAngle(_axis, angle))
      link.updateMatrixWorld(true)
    }
    if (chain.effector.getWorldPosition(_effectorPos).distanceTo(targetWorld) < tolerance) break
  }
}

// 蒙皮后网格的世界最低点（双脚吸附地面用）
export function lowestSkinnedY(root: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(root, true)
  return box.isEmpty() ? 0 : box.min.y
}

export function boneEulerDegrees(bone: THREE.Bone): Vec3 {
  return { x: bone.rotation.x * RAD_TO_DEG, y: bone.rotation.y * RAD_TO_DEG, z: bone.rotation.z * RAD_TO_DEG }
}

const _poleRoot = new THREE.Vector3()
const _poleMid = new THREE.Vector3()
const _poleEnd = new THREE.Vector3()
const _poleAxis = new THREE.Vector3()
const _poleSide = new THREE.Vector3()
const _poleWant = new THREE.Vector3()
const _poleCross = new THREE.Vector3()
const _poleQuat = new THREE.Quaternion()
const _poleWorld = new THREE.Quaternion()
const _poleLocal = new THREE.Quaternion()

/**
 * 极向量把手的静止位：中节偏离 根→末端 轴的分量方向 × distance；肢体伸直（偏离 < 2cm）时退回角色朝向下的默认方向。
 */
export function poleRestPosition(root: THREE.Bone, mid: THREE.Bone, effector: THREE.Bone, defaultDirectionWorld: THREE.Vector3, distance: number, out: THREE.Vector3): THREE.Vector3 {
  root.getWorldPosition(_poleRoot)
  mid.getWorldPosition(_poleMid)
  effector.getWorldPosition(_poleEnd)
  _poleAxis.subVectors(_poleEnd, _poleRoot)
  _poleSide.set(0, 0, 0)
  if (_poleAxis.lengthSq() > 1e-6) {
    _poleAxis.normalize()
    _poleWant.subVectors(_poleMid, _poleRoot)
    _poleSide.copy(_poleWant).addScaledVector(_poleAxis, -_poleWant.dot(_poleAxis))
    if (_poleSide.length() > 0.02) _poleSide.normalize()
    else _poleSide.set(0, 0, 0)
  }
  if (_poleSide.lengthSq() < 0.1) _poleSide.copy(defaultDirectionWorld).normalize()
  return out.copy(_poleMid).addScaledVector(_poleSide, distance)
}

/** 拖极向量：整条肢体绕 根→末端 轴旋转，让中节转到靶点所在的一侧（写在根骨的局部四元数上，末端位置不变） */
export function rotateLimbPlaneToward(root: THREE.Bone, mid: THREE.Bone, effector: THREE.Bone, poleWorld: THREE.Vector3): void {
  root.getWorldPosition(_poleRoot)
  mid.getWorldPosition(_poleMid)
  effector.getWorldPosition(_poleEnd)
  _poleAxis.subVectors(_poleEnd, _poleRoot)
  if (_poleAxis.lengthSq() < 1e-6) return
  _poleAxis.normalize()
  _poleSide.subVectors(_poleMid, _poleRoot)
  _poleSide.addScaledVector(_poleAxis, -_poleSide.dot(_poleAxis))
  _poleWant.subVectors(poleWorld, _poleRoot)
  _poleWant.addScaledVector(_poleAxis, -_poleWant.dot(_poleAxis))
  if (_poleSide.lengthSq() < 1e-6 || _poleWant.lengthSq() < 1e-6) return
  _poleSide.normalize()
  _poleWant.normalize()
  let angle = Math.acos(THREE.MathUtils.clamp(_poleSide.dot(_poleWant), -1, 1))
  if (angle < 1e-4) return
  if (_poleCross.crossVectors(_poleSide, _poleWant).dot(_poleAxis) < 0) angle = -angle
  // 世界轴旋转 → 根骨父坐标系：q_local = parentWorld^-1 * R * parentWorld * q_local
  _poleQuat.setFromAxisAngle(_poleAxis, angle)
  if (root.parent) root.parent.getWorldQuaternion(_poleWorld)
  else _poleWorld.identity()
  _poleLocal.copy(_poleWorld).invert().multiply(_poleQuat).multiply(_poleWorld)
  root.quaternion.premultiply(_poleLocal)
  root.updateMatrixWorld(true)
}

/** 双脚吸附地面时脚腕的目标高度（米） */
export const GROUND_FOOT_Y = 0.04

const _offInv = new THREE.Quaternion()
const _offRel = new THREE.Quaternion()
const _offEuler = new THREE.Euler()

/** 偏移 = base⁻¹ · 当前，以欧拉角（度，一位小数）写回 */
export function offsetFromBase(bone: THREE.Bone, base: THREE.Quaternion): Vec3 {
  _offInv.copy(base).invert()
  _offRel.copy(_offInv).multiply(bone.quaternion)
  _offEuler.setFromQuaternion(_offRel)
  return { x: Number((_offEuler.x * RAD_TO_DEG).toFixed(1)), y: Number((_offEuler.y * RAD_TO_DEG).toFixed(1)), z: Number((_offEuler.z * RAD_TO_DEG).toFixed(1)) }
}

const _tbRoot = new THREE.Vector3()
const _tbMid = new THREE.Vector3()
const _tbEnd = new THREE.Vector3()
const _tbDir = new THREE.Vector3()
const _tbToPole = new THREE.Vector3()
const _tbNormal = new THREE.Vector3()
const _tbInPlane = new THREE.Vector3()
const _tbNewMid = new THREE.Vector3()
const _tbNewEnd = new THREE.Vector3()
const _tbFrom = new THREE.Vector3()
const _tbTo = new THREE.Vector3()
const _tbRot = new THREE.Quaternion()
const _tbParent = new THREE.Quaternion()
const _tbWorld = new THREE.Quaternion()

function rotateBoneWorld(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  _tbRot.setFromUnitVectors(from, to)
  if (bone.parent) bone.parent.getWorldQuaternion(_tbParent)
  else _tbParent.identity()
  bone.getWorldQuaternion(_tbWorld)
  // 世界旋转 R 作用在骨上：q_local = parent⁻¹ · R · q_world
  bone.quaternion.copy(_tbParent.invert().multiply(_tbRot.multiply(_tbWorld)))
  bone.updateMatrixWorld(true)
}

/**
 * 两骨解析 IK：靶点距离夹在 [|d−k|·1.001, (d+k)·0.9995]，余弦定理定肘 / 膝角，
 * 肢体平面法线 = 根→靶 × 根→极向量（退化时用默认方向、再退化用角色朝上）；先转根骨让中节落到新位，再转中节让末端指向靶点。
 */
export function solveTwoBoneIk(root: THREE.Bone, mid: THREE.Bone, effector: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, defaultDirWorld: THREE.Vector3, upWorld: THREE.Vector3): void {
  root.getWorldPosition(_tbRoot)
  mid.getWorldPosition(_tbMid)
  effector.getWorldPosition(_tbEnd)
  const d = _tbRoot.distanceTo(_tbMid)
  const k = _tbMid.distanceTo(_tbEnd)
  if (d < 0.001 || k < 0.001) return
  const maxReach = (d + k) * 0.9995
  const minReach = Math.max(0.01, Math.abs(d - k) * 1.001)
  _tbDir.subVectors(target, _tbRoot)
  const reach = THREE.MathUtils.clamp(_tbDir.length(), minReach, maxReach)
  _tbDir.normalize()
  const cos = THREE.MathUtils.clamp((d * d + reach * reach - k * k) / (2 * d * reach), -1, 1)
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
  _tbToPole.subVectors(pole, _tbRoot)
  _tbNormal.crossVectors(_tbDir, _tbToPole)
  if (_tbNormal.lengthSq() < 1e-4) {
    _tbNormal.crossVectors(_tbDir, defaultDirWorld)
    if (_tbNormal.lengthSq() < 1e-4) _tbNormal.copy(upWorld)
  }
  _tbNormal.normalize()
  _tbInPlane.crossVectors(_tbNormal, _tbDir).normalize()
  _tbNewMid.copy(_tbRoot).addScaledVector(_tbDir, d * cos).addScaledVector(_tbInPlane, d * sin)
  _tbNewEnd.copy(_tbRoot).addScaledVector(_tbDir, reach)
  _tbFrom.subVectors(_tbMid, _tbRoot).normalize()
  _tbTo.subVectors(_tbNewMid, _tbRoot).normalize()
  rotateBoneWorld(root, _tbFrom, _tbTo)
  mid.getWorldPosition(_tbMid)
  effector.getWorldPosition(_tbEnd)
  _tbFrom.subVectors(_tbEnd, _tbMid).normalize()
  _tbTo.subVectors(_tbNewEnd, _tbMid).normalize()
  rotateBoneWorld(mid, _tbFrom, _tbTo)
}

const _chHips = new THREE.Vector3()
const _chDir = new THREE.Vector3()
const _chParent = new THREE.Quaternion()
const _chRot = new THREE.Quaternion()

/** 让脊柱把「角色朝上」转到 骨盆→靶点 方向；写在 mixamorigSpine 的基准姿态之上（绝对，不累加） */
export function solveChestToward(spine: THREE.Bone, hips: THREE.Bone, target: THREE.Vector3, upWorld: THREE.Vector3, spineBase: THREE.Quaternion): void {
  hips.getWorldPosition(_chHips)
  _chDir.subVectors(target, _chHips)
  if (_chDir.length() < 0.05) return
  _chDir.normalize()
  _chRot.setFromUnitVectors(upWorld, _chDir)
  if (spine.parent) spine.parent.getWorldQuaternion(_chParent)
  else _chParent.identity()
  // q_local = parent⁻¹ · R · parent · base
  const parentInv = _chParent.clone().invert()
  spine.quaternion.copy(parentInv.multiply(_chRot.clone().multiply(_chParent)).multiply(spineBase))
  spine.updateMatrixWorld(true)
}

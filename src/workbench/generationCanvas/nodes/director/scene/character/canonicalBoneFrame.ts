/**
 * [INPUT]: 依赖 three、src/assets/director/ual/ual-frame-correction.json（scripts/director-assets/generate-ual-frame-correction.mjs 生成）、
 *          ../../model/directorTypes 的 DirectorRig
 * [OUTPUT]: 对外提供 UAL_FRAME_CORRECTION、attachCanonicalBoneFrames、canonicalFrameOf、toBoneOffset、toCanonicalOffset、canonicalLocalOf、boneLocalFromCanonical
 * [POS]: director/scene/character 的「规范骨轴」换算（零 React）：存档 boneRotations、FK 滑条、左右镜像、视线分配、静态姿势预设都按
 *        Mixamo 骨局部轴写（规范轴）；UAL 人偶的骨局部轴与之差 5°–180°。人偶加载时把每根语义骨的两枚常量四元数挂到骨上（WeakMap，不进 userData，
 *        克隆不带走），写偏移 O_骨 = rel⁻¹·O_规范·rel，读回反过来；局部朝向 q_规范 = parentRel·q_骨·rel⁻¹。没挂表的骨（Mixamo / UE4 / 用户上传）恒等。
 *        IK 两骨解析 / CCD / 胸腔朝向都在世界坐标里算，不经过这里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import correction from '../../../../../../assets/director/ual/ual-frame-correction.json'
import type { DirectorRig } from '../../model/directorTypes'

type Quat4 = [number, number, number, number]
export type FrameCorrectionEntry = {
  canonicalBone: string
  ualBone: string
  canonicalBindWorld: Quat4
  ualBindWorld: Quat4
  rel: Quat4
  parentRel: Quat4
}
export const UAL_FRAME_CORRECTION = correction as unknown as { bones: Record<string, FrameCorrectionEntry> }

type CanonicalFrame = { rel: THREE.Quaternion; relInv: THREE.Quaternion; parentRel: THREE.Quaternion; parentRelInv: THREE.Quaternion }

const UAL_FRAMES: ReadonlyMap<string, CanonicalFrame> = new Map(
  Object.values(UAL_FRAME_CORRECTION.bones).map((entry) => {
    const rel = new THREE.Quaternion().fromArray(entry.rel).normalize()
    const parentRel = new THREE.Quaternion().fromArray(entry.parentRel).normalize()
    return [entry.ualBone, { rel, relInv: rel.clone().invert(), parentRel, parentRelInv: parentRel.clone().invert() }]
  }),
)

const frames = new WeakMap<THREE.Bone, CanonicalFrame>()

/** 人偶骨架就绪后调一次（克隆之后）：rig = 'ual' 时给 22 根语义骨挂换算；其它 rig 不挂（= 恒等） */
export function attachCanonicalBoneFrames(root: THREE.Object3D, rig: DirectorRig): void {
  if (rig !== 'ual') return
  root.traverse((object) => {
    if (!(object as THREE.Bone).isBone) return
    const frame = UAL_FRAMES.get(object.name)
    if (frame) frames.set(object as THREE.Bone, frame)
  })
}

export function canonicalFrameOf(bone: THREE.Bone): CanonicalFrame | undefined {
  return frames.get(bone)
}

/** 规范轴里的偏移四元数 → 这根骨自己局部轴里的偏移（原地改 out 并返回） */
export function toBoneOffset(bone: THREE.Bone, canonical: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  const frame = frames.get(bone)
  out.copy(canonical)
  if (frame) out.premultiply(frame.relInv).multiply(frame.rel)
  return out
}

/** 骨局部轴里的偏移 → 规范轴（offsetFromBase 写回用） */
export function toCanonicalOffset(bone: THREE.Bone, local: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  const frame = frames.get(bone)
  out.copy(local)
  if (frame) out.premultiply(frame.rel).multiply(frame.relInv)
  return out
}

/** 骨的父局部朝向 → 规范骨在同一姿态下的父局部朝向 */
export function canonicalLocalOf(bone: THREE.Bone, out: THREE.Quaternion): THREE.Quaternion {
  const frame = frames.get(bone)
  out.copy(bone.quaternion)
  if (frame) out.premultiply(frame.parentRel).multiply(frame.relInv)
  return out
}

/** 规范父局部朝向 → 写回骨自己的父局部朝向 */
export function boneLocalFromCanonical(bone: THREE.Bone, canonical: THREE.Quaternion): void {
  const frame = frames.get(bone)
  bone.quaternion.copy(canonical)
  if (frame) bone.quaternion.premultiply(frame.parentRelInv).multiply(frame.rel)
}

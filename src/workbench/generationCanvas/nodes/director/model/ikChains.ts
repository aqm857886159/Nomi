/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorRig / Vec3、./rigs 的 boneName / SemanticBone
 * [OUTPUT]: 对外提供 IK_TARGETS（5 条链）、IK_POLES（4 个极向量）、IK_HANDLES（骨盆/胸腔）、resolveIkChain（按 rig 取真实骨名）
 * [POS]: director/model 的 IK 配置单一真相（清单 §4.1 骨骼页 IK 靶点）：three CCDIKSolver 只认骨索引，scene 层用
 *        resolveIkChain 把语义链翻成当前角色 rig 的骨名再查索引；
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorRig, Vec3 } from './directorTypes'
import { boneName, type SemanticBone } from './rigs'

export type IkTargetKey = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot' | 'head'
export type IkPoleKey = 'leftElbowPole' | 'rightElbowPole' | 'leftKneePole' | 'rightKneePole'
export type IkHandleKey = IkTargetKey | IkPoleKey | 'pelvis' | 'chest'

export type IkTargetConfig = {
  key: IkTargetKey
  effector: SemanticBone
  links: SemanticBone[] // 从末端往根：前臂、上臂
  iteration: number
  minAngle: number
  maxAngle: number
}

export const IK_TARGETS: Record<IkTargetKey, IkTargetConfig> = {
  leftHand: { key: 'leftHand', effector: 'leftHand', links: ['leftForeArm', 'leftArm'], iteration: 25, minAngle: 0, maxAngle: 0.8 },
  rightHand: { key: 'rightHand', effector: 'rightHand', links: ['rightForeArm', 'rightArm'], iteration: 25, minAngle: 0, maxAngle: 0.8 },
  leftFoot: { key: 'leftFoot', effector: 'leftFoot', links: ['leftLeg', 'leftUpLeg'], iteration: 30, minAngle: 0, maxAngle: 0.7 },
  rightFoot: { key: 'rightFoot', effector: 'rightFoot', links: ['rightLeg', 'rightUpLeg'], iteration: 30, minAngle: 0, maxAngle: 0.7 },
  head: { key: 'head', effector: 'head', links: ['neck', 'spine2'], iteration: 15, minAngle: 0, maxAngle: 0.5 },
}

export type IkPoleConfig = {
  key: IkPoleKey
  target: IkTargetKey
  root: SemanticBone
  mid: SemanticBone
  effector: SemanticBone
  defaultDirection: Vec3
  distance: number
}

export const IK_POLES: Record<IkPoleKey, IkPoleConfig> = {
  leftElbowPole: { key: 'leftElbowPole', target: 'leftHand', root: 'leftArm', mid: 'leftForeArm', effector: 'leftHand', defaultDirection: { x: 0, y: 0, z: -1 }, distance: 0.35 },
  rightElbowPole: { key: 'rightElbowPole', target: 'rightHand', root: 'rightArm', mid: 'rightForeArm', effector: 'rightHand', defaultDirection: { x: 0, y: 0, z: -1 }, distance: 0.35 },
  leftKneePole: { key: 'leftKneePole', target: 'leftFoot', root: 'leftUpLeg', mid: 'leftLeg', effector: 'leftFoot', defaultDirection: { x: 0, y: 0, z: 1 }, distance: 0.35 },
  rightKneePole: { key: 'rightKneePole', target: 'rightFoot', root: 'rightUpLeg', mid: 'rightLeg', effector: 'rightFoot', defaultDirection: { x: 0, y: 0, z: 1 }, distance: 0.35 },
}

export const IK_HANDLES: Record<'pelvis' | 'chest', SemanticBone> = { pelvis: 'hips', chest: 'spine2' }

export type ResolvedIkChain = { effectorBoneName: string; linkBoneNames: string[]; iteration: number; minAngle: number; maxAngle: number }

export function resolveIkChain(rig: DirectorRig, key: IkTargetKey): ResolvedIkChain {
  const config = IK_TARGETS[key]
  return {
    effectorBoneName: boneName(rig, config.effector),
    linkBoneNames: config.links.map((link) => boneName(rig, link)),
    iteration: config.iteration,
    minAngle: config.minAngle,
    maxAngle: config.maxAngle,
  }
}

/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorRig / Vec3
 * [OUTPUT]: 对外提供 SemanticBone 词表、RIG_BONE_MAPS（mixamo / ue4 / ual 的语义骨 → 真实骨名）、DEFAULT_CHARACTER_MODEL_PATH / DEFAULT_CHARACTER_RIG / isBuiltinCharacterModel、boneName、BODY_TYPE_PRESETS（8 快捷体形缩放）、
 *           JOINT_AXIS_LABEL_KEYS（30 组关节轴语义 i18n key）
 * [POS]: director/model 的「rig 无关」层：角色系统只用语义骨名说话（head / spine / leftHand …），Mixamo（用户上传 / 规范轴）、UE 人偶
 *        （2026-08-03 拍板移植）与默认 UAL 人偶各自映射；骨局部轴的差异由 scene/character/canonicalBoneFrame 换算，这里只管名字；IK 链、FK 滑条、姿态偏移都经 boneName() 取真实骨名，不在业务里写死 mixamorig*。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorRig, Vec3 } from './directorTypes'

export const SEMANTIC_BONES = [
  'hips', 'spine', 'spine1', 'spine2', 'neck', 'head',
  'leftShoulder', 'leftArm', 'leftForeArm', 'leftHand',
  'rightShoulder', 'rightArm', 'rightForeArm', 'rightHand',
  'leftUpLeg', 'leftLeg', 'leftFoot', 'leftToeBase',
  'rightUpLeg', 'rightLeg', 'rightFoot', 'rightToeBase',
] as const
export type SemanticBone = (typeof SEMANTIC_BONES)[number]

const MIXAMO: Record<SemanticBone, string> = {
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  spine1: 'mixamorigSpine1',
  spine2: 'mixamorigSpine2',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  leftShoulder: 'mixamorigLeftShoulder',
  leftArm: 'mixamorigLeftArm',
  leftForeArm: 'mixamorigLeftForeArm',
  leftHand: 'mixamorigLeftHand',
  rightShoulder: 'mixamorigRightShoulder',
  rightArm: 'mixamorigRightArm',
  rightForeArm: 'mixamorigRightForeArm',
  rightHand: 'mixamorigRightHand',
  leftUpLeg: 'mixamorigLeftUpLeg',
  leftLeg: 'mixamorigLeftLeg',
  leftFoot: 'mixamorigLeftFoot',
  leftToeBase: 'mixamorigLeftToeBase',
  rightUpLeg: 'mixamorigRightUpLeg',
  rightLeg: 'mixamorigRightLeg',
  rightFoot: 'mixamorigRightFoot',
  rightToeBase: 'mixamorigRightToeBase',
}

// UE4 人偶骨名（Epic 官方 Mannequin 骨架命名；接入 UE 资产时以其骨架实名核对）
const UE4: Record<SemanticBone, string> = {
  hips: 'pelvis',
  spine: 'spine_01',
  spine1: 'spine_02',
  spine2: 'spine_03',
  neck: 'neck_01',
  head: 'head',
  leftShoulder: 'clavicle_l',
  leftArm: 'upperarm_l',
  leftForeArm: 'lowerarm_l',
  leftHand: 'hand_l',
  rightShoulder: 'clavicle_r',
  rightArm: 'upperarm_r',
  rightForeArm: 'lowerarm_r',
  rightHand: 'hand_r',
  leftUpLeg: 'thigh_l',
  leftLeg: 'calf_l',
  leftFoot: 'foot_l',
  leftToeBase: 'ball_l',
  rightUpLeg: 'thigh_r',
  rightLeg: 'calf_r',
  rightFoot: 'foot_r',
  rightToeBase: 'ball_r',
}

// Quaternius UAL 人偶（默认人偶，2026-10-07 换掉 x-bot）：glb 里是 `DEF-upper_arm.L`，three 加载时去掉 `. : / [ ]`，
// 运行时骨名是 `DEF-upper_armL`——这里写去点后的名字（ual-rig.json 的原名直接拿去找骨一根都找不到）
const UAL: Record<SemanticBone, string> = {
  hips: 'DEF-hips',
  spine: 'DEF-spine001',
  spine1: 'DEF-spine002',
  spine2: 'DEF-spine003',
  neck: 'DEF-neck',
  head: 'DEF-head',
  leftShoulder: 'DEF-shoulderL',
  leftArm: 'DEF-upper_armL',
  leftForeArm: 'DEF-forearmL',
  leftHand: 'DEF-handL',
  rightShoulder: 'DEF-shoulderR',
  rightArm: 'DEF-upper_armR',
  rightForeArm: 'DEF-forearmR',
  rightHand: 'DEF-handR',
  leftUpLeg: 'DEF-thighL',
  leftLeg: 'DEF-shinL',
  leftFoot: 'DEF-footL',
  leftToeBase: 'DEF-toeL',
  rightUpLeg: 'DEF-thighR',
  rightLeg: 'DEF-shinR',
  rightFoot: 'DEF-footR',
  rightToeBase: 'DEF-toeR',
}

export const RIG_BONE_MAPS: Record<DirectorRig, Record<SemanticBone, string>> = { mixamo: MIXAMO, ue4: UE4, ual: UAL }

/** 默认人偶（加人 / 编译器造人 / 缺省 rig 都指它）：存档里的 modelPath 只写 builtin:*，不写具体文件；旧工程的 builtin:x-bot 也指向它 */
export const DEFAULT_CHARACTER_MODEL_PATH = 'builtin:ual'
export const DEFAULT_CHARACTER_RIG: DirectorRig = 'ual'

/** modelPath 缺省或 builtin:* = 内置默认人偶；否则是用户上传的模型 */
export function isBuiltinCharacterModel(modelPath: string | undefined): boolean {
  return !modelPath || modelPath.startsWith('builtin:')
}

export function boneName(rig: DirectorRig, bone: SemanticBone): string {
  return RIG_BONE_MAPS[rig][bone]
}

// 任意骨名 → 语义骨（大小写/前缀/命名空间不敏感；找不到返回 null）
export function semanticBoneOf(rig: DirectorRig, rawName: string): SemanticBone | null {
  const normalized = rawName.toLowerCase().replace(/^.*:/, '')
  for (const bone of SEMANTIC_BONES) {
    if (RIG_BONE_MAPS[rig][bone].toLowerCase() === normalized) return bone
  }
  return null
}

// 快捷体形（清单 §4.1 姿态页）：XYZ 缩放模拟不同体形
export const BODY_TYPE_PRESETS: ReadonlyArray<{ id: string; scale: Vec3 }> = [
  { id: 'standard', scale: { x: 1, y: 1, z: 1 } },
  { id: 'child', scale: { x: 0.72, y: 0.7, z: 0.72 } },
  { id: 'teen', scale: { x: 0.82, y: 0.85, z: 0.82 } },
  { id: 'fat', scale: { x: 1.3, y: 0.95, z: 1.35 } },
  { id: 'thin', scale: { x: 0.85, y: 1.08, z: 0.85 } },
  { id: 'stocky', scale: { x: 1.15, y: 0.92, z: 1.15 } },
  { id: 'tall', scale: { x: 1.05, y: 1.12, z: 1.05 } },
  { id: 'giant', scale: { x: 1.35, y: 1.35, z: 1.35 } },
]

// FK 关节表 = 17 根（head / neck / spine=Spine2 / 两侧 肩 大臂 前臂 手 大腿 小腿 脚）；三轴语义标签 key = director.joint.<去侧骨>.<axis>（左右同文案）
export const FK_JOINTS: ReadonlyArray<{ bone: SemanticBone; mirror?: SemanticBone }> = [
  { bone: 'head' },
  { bone: 'neck' },
  { bone: 'spine2' },
  { bone: 'leftShoulder', mirror: 'rightShoulder' },
  { bone: 'leftArm', mirror: 'rightArm' },
  { bone: 'leftForeArm', mirror: 'rightForeArm' },
  { bone: 'leftHand', mirror: 'rightHand' },
  { bone: 'leftUpLeg', mirror: 'rightUpLeg' },
  { bone: 'leftLeg', mirror: 'rightLeg' },
  { bone: 'leftFoot', mirror: 'rightFoot' },
]

export function jointAxisLabelKey(bone: SemanticBone, axis: 'x' | 'y' | 'z'): string {
  const base = bone.replace(/^(left|right)/, (side) => side.toLowerCase())
  const semantic = base.startsWith('left') || base.startsWith('right') ? base.replace(/^(left|right)/, '') : base
  const key = semantic.charAt(0).toLowerCase() + semantic.slice(1)
  return `director.joint.${key}.${axis}`
}

// 左右镜像：源侧有值 → 目标侧 = {x, −y, −z}；源侧没值 → 目标侧一并清掉
export function mirrorBoneRotations(rotations: Record<string, Vec3>, rig: DirectorRig, fromSide: 'left' | 'right'): Record<string, Vec3> {
  const result = { ...rotations }
  for (const joint of FK_JOINTS) {
    if (!joint.mirror) continue
    const source = fromSide === 'left' ? joint.bone : joint.mirror
    const target = fromSide === 'left' ? joint.mirror : joint.bone
    const value = rotations[boneName(rig, source)]
    if (value) result[boneName(rig, target)] = { x: value.x, y: -value.y, z: -value.z }
    else delete result[boneName(rig, target)]
  }
  return result
}

/**
 * [INPUT]: 依赖 three 的 Quaternion / Vector3 / Bone、./mannequinSkeleton 的 applyMannequinSkeletonPose（角色复位态 = rest + 自然站姿基线）
 * [OUTPUT]: 对外提供 PoseSnapshot / BoneSnapshot、baseBoneName、indexBonesByBaseName、snapshotBones、bindWorldQuaternionsByBaseName、blendPoseSnapshots、applyPoseSnapshot、HIPS_BASE_NAME
 * [POS]: director/scene/character 的姿态快照纯数学（零 React、零加载）：一份快照 = 源骨架每根骨的四元数 + 位置（按去前缀基名索引，
 *        `mixamorig:Hips` / `mixamorigHips` / `Hips_1` 都归到 `hips`）。
 *        套到角色不是照抄（照抄要求角色也是同一份 Bot.fbx；我们的 x-bot.glb 骨盆父坐标系与 FBX 差 −90°，照抄整个人会躺倒；用户上传的模型 bind 还可能不同）：
 *        逐骨在「相对各自骨架根」的坐标系里取源骨的世界增量 Δ = 帧·bind⁻¹，套到角色 = Δ·角色 bind 世界朝向，再换回父局部——
 *        世界增量保留角色自己的 bind 偏置、又跟着源的动作走，bind 一致时与照抄等价。骨盆位移经两边 rest 骨盆方向算坐标系旋转换算，再按 rest 骨盆长度换算单位。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { applyMannequinSkeletonPose } from './mannequinSkeleton'

/** quaternion / position 是父局部；world 是相对骨架根（传入的 root）的累积朝向——两边骨架各自以根为原点，角色在场景里的摆放不掺进来 */
export type BoneSnapshot = { quaternion: THREE.Quaternion; position: THREE.Vector3; world: THREE.Quaternion }
export type PoseSnapshot = Map<string, BoneSnapshot>

export const HIPS_BASE_NAME = 'hips'

/** `mixamorig:LeftArm` / `mixamorig1LeftArm` / `LeftArm_2` → `leftarm` */
export function baseBoneName(name: string): string {
  let base = name.toLowerCase().trim()
  const colon = base.lastIndexOf(':')
  if (colon !== -1) base = base.slice(colon + 1)
  base = base.replace(/^mixamorig\d*/, '')
  const underscore = base.lastIndexOf('_')
  if (underscore !== -1 && !Number.isNaN(Number(base.slice(underscore + 1)))) base = base.slice(0, underscore)
  return base
}

function eachBone(root: THREE.Object3D, visit: (bone: THREE.Bone, key: string) => void): void {
  root.traverse((object) => {
    if (!(object as THREE.Bone).isBone) return
    // Mixamo 导出常有「父子同名」的占位骨，跳过子那根
    if (object.parent && object.parent.name === object.name) return
    visit(object as THREE.Bone, baseBoneName(object.name))
  })
}

/** 骨架 → 基名索引（同名重复骨只取第一根） */
export function indexBonesByBaseName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const index = new Map<string, THREE.Bone>()
  eachBone(root, (bone, key) => {
    if (!index.has(key)) index.set(key, bone)
  })
  return index
}

/** 每个节点相对 root 的累积朝向（root 本身 = 单位；不看 root 以上的挂载 / 摆放） */
function rootRelativeQuaternions(root: THREE.Object3D): Map<THREE.Object3D, THREE.Quaternion> {
  const out = new Map<THREE.Object3D, THREE.Quaternion>()
  out.set(root, new THREE.Quaternion())
  root.traverse((object) => {
    if (object === root) return
    const parent = object.parent ? out.get(object.parent) : undefined
    out.set(object, parent ? parent.clone().multiply(object.quaternion) : object.quaternion.clone())
  })
  return out
}

/** 采一份快照（骨架当前姿态；world 相对 root） */
export function snapshotBones(root: THREE.Object3D): PoseSnapshot {
  const snapshot: PoseSnapshot = new Map()
  const worlds = rootRelativeQuaternions(root)
  eachBone(root, (bone, key) => {
    if (!snapshot.has(key)) snapshot.set(key, { quaternion: bone.quaternion.clone(), position: bone.position.clone(), world: worlds.get(bone)!.clone() })
  })
  return snapshot
}

/** 角色 bind 的相对根朝向：先复位到 rest（applyMannequinSkeletonPose，= Mixamo bind，实测逐骨 0°），再累积 */
export function bindWorldQuaternionsByBaseName(root: THREE.Object3D): Map<string, THREE.Quaternion> {
  applyMannequinSkeletonPose(root)
  const worlds = rootRelativeQuaternions(root)
  const out = new Map<string, THREE.Quaternion>()
  eachBone(root, (bone, key) => {
    if (!out.has(key)) out.set(key, worlds.get(bone)!.clone())
  })
  return out
}

const smoothstep = (value: number): number => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** 两份快照按 alpha（0 = a，1 = b，smoothstep 缓动）逐骨 slerp；只在一边出现的骨原样带过 */
export function blendPoseSnapshots(a: PoseSnapshot | null, b: PoseSnapshot | null, alpha: number): PoseSnapshot | null {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  const eased = smoothstep(alpha)
  const out: PoseSnapshot = new Map()
  for (const [key, from] of a) {
    const to = b.get(key)
    if (!to) {
      out.set(key, { quaternion: from.quaternion.clone(), position: from.position.clone(), world: from.world.clone() })
      continue
    }
    out.set(key, {
      quaternion: from.quaternion.clone().slerp(to.quaternion, eased),
      position: from.position.clone().lerp(to.position, eased),
      world: from.world.clone().slerp(to.world, eased),
    })
  }
  for (const [key, to] of b) {
    if (!out.has(key)) out.set(key, { quaternion: to.quaternion.clone(), position: to.position.clone(), world: to.world.clone() })
  }
  return out
}

export type ApplySnapshotOptions = {
  /** 0–1：从角色当前姿态向目标 slerp 的权重（片段头尾淡入淡出） */
  weight: number
  /** 源骨架 bind（未播动画时）的快照：世界增量 Δ = 帧.world × bind.world⁻¹ */
  sourceBind: PoseSnapshot
  /** 角色 bind 的相对根朝向（bindWorldQuaternionsByBaseName） */
  targetBindWorld: Map<string, THREE.Quaternion>
  /** 角色骨架根：套骨按层级自上而下走，父朝向用刚写好的结果累积 */
  root: THREE.Object3D
  /** 角色 rest 骨盆位置（角色单位、角色骨盆父坐标系） */
  restHips: THREE.Vector3 | null
}

const _delta = new THREE.Quaternion()
const _frame = new THREE.Quaternion()
const _target = new THREE.Quaternion()
const _parentInverse = new THREE.Quaternion()
const _position = new THREE.Vector3()
const _sourceUp = new THREE.Vector3()
const _targetUp = new THREE.Vector3()

/**
 * 把快照套到角色骨架（按层级自上而下）：每根骨的目标朝向 = (源帧.world × 源 bind.world⁻¹) × 角色 bind.world，
 * 换回父局部 = 父朝向⁻¹ × 目标，按权重从当前 slerp。父朝向用本轮刚写好的结果累积（没在快照里的节点原样透传），
 * 所以世界增量在角色自己的骨架里自洽。骨盆位移是父坐标系向量：位移 = restHips + R·(帧 − bind)·(|restHips| / |源 bind 骨盆|)，
 * R = 源 rest 骨盆方向 → 角色 rest 骨盆方向。
 */
export function applyPoseSnapshot(bones: Map<string, THREE.Bone>, snapshot: PoseSnapshot, options: ApplySnapshotOptions): void {
  const weight = Math.max(0, Math.min(1, options.weight))
  if (weight <= 0) return
  const sourceHips = options.sourceBind.get(HIPS_BASE_NAME)
  const hipsFrameReady = Boolean(options.restHips && sourceHips && options.restHips.lengthSq() > 1e-8 && sourceHips.position.lengthSq() > 1e-8)
  if (hipsFrameReady) {
    _sourceUp.copy(sourceHips!.position).normalize()
    _targetUp.copy(options.restHips!).normalize()
    _frame.setFromUnitVectors(_sourceUp, _targetUp)
  }
  const boneKeys = new Map<THREE.Bone, string>()
  for (const [key, bone] of bones) boneKeys.set(bone, key)
  const worlds = new Map<THREE.Object3D, THREE.Quaternion>()
  worlds.set(options.root, new THREE.Quaternion())
  options.root.traverse((object) => {
    if (object === options.root) return
    const parentWorld = object.parent ? worlds.get(object.parent) : undefined
    if (!parentWorld) {
      worlds.set(object, object.quaternion.clone())
      return
    }
    const key = boneKeys.get(object as THREE.Bone)
    const sample = key ? snapshot.get(key) : undefined
    const bind = key ? options.sourceBind.get(key) : undefined
    const targetBind = key ? options.targetBindWorld.get(key) : undefined
    if (sample && bind && targetBind) {
      const bone = object as THREE.Bone
      _delta.copy(sample.world).multiply(_parentInverse.copy(bind.world).invert())
      _target.copy(_delta).multiply(targetBind)
      _parentInverse.copy(parentWorld).invert()
      _target.premultiply(_parentInverse)
      bone.quaternion.slerp(_target, weight)
      if (key === HIPS_BASE_NAME && hipsFrameReady) {
        const ratio = options.restHips!.length() / sourceHips!.position.length()
        _position.copy(sample.position).sub(sourceHips!.position).applyQuaternion(_frame).multiplyScalar(ratio).add(options.restHips!)
        bone.position.lerp(_position, weight)
      }
    }
    worlds.set(object, parentWorld.clone().multiply(object.quaternion))
  })
}

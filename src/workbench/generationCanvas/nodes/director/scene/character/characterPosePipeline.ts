/**
 * [INPUT]: 依赖 three、../../model/actionLibrary 的 T_POSE_ACTION_ID、../../model/poseBlend（resolveActionBlend / resolvePoseKeyframes / PoseSample）、
 *          ../../model/directorTypes、./characterRig（indexBones / applyBoneRotationOffsets / multiplyCanonicalOffset / BoneIndex）、
 *          ./mannequinSkeleton 的 applyMannequinSkeletonPose、./poseClipLibrary（samplePoseClip / poseClipSourceBind）、./poseSnapshot
 * [OUTPUT]: 对外提供 CharacterPoseContext、createCharacterPoseContext、PoseFrameResult、poseCharacterFrame
 * [POS]: director/scene/character 的每帧姿态管线前半段（零 React）：复位 bind → 静止姿态预设 → 动作层（淡入淡出 / 片段交叉）→ 记 basePose →
 *        手调偏移（姿态片段关键帧 slerp / 静止 boneRotations；动作在播时不叠）→ 更新矩阵。IK、视线、骨盆偏移挂载要读 store 与拖动态，留在 useCharacterRig。
 *        抽成纯函数是为了群众基准（characterCrowd.bench.ts）量的就是编辑器真跑的这一段，不另写一份近似。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { T_POSE_ACTION_ID } from '../../model/actionLibrary'
import type { ActionClip, DirectorObject, Vec3 } from '../../model/directorTypes'
import { resolveActionBlend, resolvePoseKeyframes, type PoseSample } from '../../model/poseBlend'
import { DEG_TO_RAD } from '../../model/vec3'
import { applyBoneRotationOffsets, findBoneByName, indexBones, multiplyCanonicalOffset, type BoneIndex } from './characterRig'
import { applyMannequinSkeletonPose } from './mannequinSkeleton'
import { poseClipSourceBind, samplePoseClip } from './poseClipLibrary'
import { applyPoseSnapshot, bindWorldQuaternionsByBaseName, blendPoseSnapshots, HIPS_BASE_NAME, indexBonesByBaseName, type PoseSnapshot } from './poseSnapshot'

export type CharacterPoseContext = {
  root: THREE.Object3D
  boneIndex: BoneIndex
  /** 姿态库快照按去前缀基名套骨 */
  baseBones: Map<string, THREE.Bone>
  /** 角色 bind 相对根朝向（挂载时量一次） */
  targetBindWorld: Map<string, THREE.Quaternion>
  restHips: THREE.Vector3 | null
  allBones: THREE.Bone[]
  /** 动作层之后、手调偏移之前的每骨四元数，IK / Gizmo 写回的偏移都相对它 */
  basePose: Map<THREE.Bone, THREE.Quaternion>
}

export function createCharacterPoseContext(root: THREE.Object3D): CharacterPoseContext {
  const baseBones = indexBonesByBaseName(root)
  const allBones: THREE.Bone[] = []
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) allBones.push(object as THREE.Bone)
  })
  return {
    root,
    boneIndex: indexBones(root),
    baseBones,
    targetBindWorld: bindWorldQuaternionsByBaseName(root),
    restHips: baseBones.get(HIPS_BASE_NAME)?.position.clone() ?? null,
    allBones,
    basePose: new Map(),
  }
}

const _quatA = new THREE.Quaternion()
const _quatB = new THREE.Quaternion()
const _identity = new THREE.Quaternion()
const _euler = new THREE.Euler()

function eulerFromDegrees(value: Vec3 | undefined): THREE.Euler {
  return _euler.set((value?.x ?? 0) * DEG_TO_RAD, (value?.y ?? 0) * DEG_TO_RAD, (value?.z ?? 0) * DEG_TO_RAD)
}

// 关键帧对按四元数 slerp，再按权重从零姿态 slerp（淡入淡出）叠到骨上
function applyPoseSample(index: BoneIndex, sample: PoseSample, weight: number): void {
  if (!sample.a || weight <= 0) return
  if (!sample.b) {
    applyBoneRotationOffsets(index, sample.a.boneRotations, weight)
    return
  }
  const bones = new Set([...Object.keys(sample.a.boneRotations), ...Object.keys(sample.b.boneRotations)])
  for (const name of bones) {
    const bone = findBoneByName(index, name)
    if (!bone) continue
    _quatA.setFromEuler(eulerFromDegrees(sample.a.boneRotations[name]))
    _quatB.setFromEuler(eulerFromDegrees(sample.b.boneRotations[name]))
    _quatA.slerp(_quatB, sample.alpha)
    // 从单位四元数按权重 slerp（_identity 每次先复位：slerp 会原地改它）
    if (weight < 1) _quatA.copy(_identity.identity().slerp(_quatA, weight))
    multiplyCanonicalOffset(bone, _quatA)
  }
}

function applySnapshot(context: CharacterPoseContext, actionId: string, snapshot: PoseSnapshot, weight: number): void {
  const sourceBind = poseClipSourceBind(actionId)
  if (!sourceBind) return
  applyPoseSnapshot(context.baseBones, snapshot, { weight, sourceBind, targetBindWorld: context.targetBindWorld, root: context.root, restHips: context.restHips })
}

// 动作层结果：poseClip = 当前覆盖的骨骼姿态片段（关键帧当偏移叠）；actionActive = 当前有动作片段在播（此时不叠角色静止微调 / 骨盆偏移）
function applyActionLayer(context: CharacterPoseContext, object: DirectorObject, time: number): { poseClip: ActionClip | null; actionActive: boolean } {
  // 复位只复位了旋转；骨盆位置是姿态库写的，每帧先放回 rest（否则切回 T-Pose 还留着上一姿态的骨盆位移）
  const hips = context.baseBones.get(HIPS_BASE_NAME)
  if (hips && context.restHips) hips.position.copy(context.restHips)
  const actionClips = object.actionTrackEnabled === false ? [] : object.actionClips ?? []
  const blend = resolveActionBlend(actionClips, time)
  const actionClip = blend.clip && blend.clip.clipType !== 'custom_pose' ? blend.clip : null
  const currentId = actionClip?.actionPose ?? ''
  const current = actionClip ? samplePoseClip(currentId, blend.localTime) : null
  // 静止姿态预设：没有片段覆盖时的基底，也是片段淡入 / 淡出的另一端（posePreset 语义）。
  // 动作片段满权重、没有上一段交叉、且和静止预设出自同一副源骨架（骨集合相同）时，预设套上去也会被整份盖掉——跳过（群众每人每帧省一次套骨）
  const restId = object.posePreset ?? T_POSE_ACTION_ID
  const coveredByAction = current !== null && blend.weight >= 1 && !blend.previous && poseClipSourceBind(currentId) === poseClipSourceBind(restId)
  if (!coveredByAction) {
    const restSnapshot = samplePoseClip(restId, time)
    if (restSnapshot) applySnapshot(context, restId, restSnapshot, 1)
  }
  if (!blend.clip) return { poseClip: null, actionActive: false }
  if (blend.clip.clipType === 'custom_pose') return { poseClip: blend.clip, actionActive: false }
  // 只有播放头落在片段内才算「动作在播」（片段外的淡出 / 间隙交叉仍叠静止微调）
  const inside = time >= blend.clip.startTime && time <= blend.clip.endTime
  if (!current) return { poseClip: null, actionActive: inside }
  // 上一片段挨得近：两段末帧 / 首帧直接交叉（不经过静止姿态）；否则从当前（静止预设）按权重淡入
  const previous = blend.previous && blend.previous.clipType !== 'custom_pose'
    ? samplePoseClip(blend.previous.actionPose ?? '', blend.previous.endTime - blend.previous.startTime)
    : null
  if (previous) {
    const mixed = blendPoseSnapshots(previous, current, blend.weight)
    if (mixed) applySnapshot(context, currentId, mixed, 1)
    return { poseClip: null, actionActive: inside }
  }
  // 混合用 smoothstep 缓动
  const eased = blend.weight * blend.weight * (3 - 2 * blend.weight)
  applySnapshot(context, currentId, current, eased)
  return { poseClip: null, actionActive: inside }
}

export type PoseFrameResult = {
  /** 当前覆盖的骨骼姿态片段在 time 的关键帧对（骨盆偏移也从它取）；没有 → null */
  poseSample: PoseSample | null
  /** 有动作片段在播（此时不叠静止 boneRotations / hipsOffset） */
  actionActive: boolean
}

/**
 * 一帧的姿态前半段：复位 → 静止预设 + 动作层 → 记 basePose → 手调偏移 → 更新矩阵。
 * keepBasePose = false：这一帧没人会读 basePose（角色没被选中、没在拖把手），跳过逐骨拷贝（群众快路径）；读它的那一帧调用方传 true，当帧就是新的。
 */
export function poseCharacterFrame(context: CharacterPoseContext, object: DirectorObject, time: number, options: { keepBasePose?: boolean } = {}): PoseFrameResult {
  applyMannequinSkeletonPose(context.root)
  const { poseClip, actionActive } = applyActionLayer(context, object, time)
  if (options.keepBasePose !== false) {
    for (const bone of context.allBones) {
      const saved = context.basePose.get(bone)
      if (saved) saved.copy(bone.quaternion)
      else context.basePose.set(bone, bone.quaternion.clone())
    }
  }
  const poseSample = poseClip ? resolvePoseKeyframes(poseClip, time) : null
  if (poseSample) applyPoseSample(context.boneIndex, poseSample, 1)
  else if (!actionActive && object.boneRotations) applyBoneRotationOffsets(context.boneIndex, object.boneRotations)
  context.root.updateMatrixWorld(true)
  return { poseSample, actionActive }
}

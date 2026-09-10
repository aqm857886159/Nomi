/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame、../../DirectorEditorContext 的 useDirectorStoreApi、
 *          ./mannequinSkeleton 的 applyMannequinSkeletonPose、./poseClipLibrary（samplePoseClip / poseClipSourceBind / preloadPoseClips）、
 *          ./poseSnapshot（indexBonesByBaseName / bindWorldQuaternionsByBaseName / blendPoseSnapshots / applyPoseSnapshot）、
 *          ../../model/actionLibrary 的 T_POSE_ACTION_ID、../../model/poseBlend（resolveActionBlend / resolvePoseKeyframes）、../../model/lookAtSolve、
 *          ../../model/ikChains（IK_TARGETS / IK_POLES / IkHandleKey）、../../model/rigs 的 boneName、../../model/directorTypes、../../model/vec3、./characterRig、
 *          ../../model/evaluatedSceneObject / sceneObjectGraph：目标先求完整场景位置，头与目标统一进角色坐标后调用原视线解算
 * [OUTPUT]: 对外提供 IkDrag / CharacterRigApi、useCharacterRig
 * [POS]: director/scene/character 的每帧骨骼管线：复位 bind → 静止姿态预设 → 动作层 →
 *        记 basePoseForOffsets → boneRotations 偏移（四元数右乘；动作片段在播时不叠）→ IK（两骨解析 / 极向量绕轴 / 胸腔朝向 / 头 CCD / 骨盆钉脚，解完立刻把
 *        base⁻¹·当前 写回 boneRotations）→ 视线 → 骨盆偏移（挂载组）。时间取 store.timeline.currentTime。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import { T_POSE_ACTION_ID } from '../../model/actionLibrary'
import type { ActionClip, DirectorObject, DirectorRig, Vec3 } from '../../model/directorTypes'
import type { DirectorStoreState } from '../../model/directorStore'
import { IK_POLES, IK_TARGETS, type IkHandleKey, type IkPoleKey, type IkTargetKey } from '../../model/ikChains'
import { bodyPartAnchor, distributeHeadAim, lookAtWeightAt, solveHeadAim } from '../../model/lookAtSolve'
import { resolveActionBlend, resolvePoseKeyframes, type PoseSample } from '../../model/poseBlend'
import { boneName } from '../../model/rigs'
import { DEG_TO_RAD } from '../../model/vec3'
import { evaluateSceneObjectPose } from '../../model/evaluatedSceneObject'
import { sceneFrame, transformPoint } from '../../model/sceneObjectGraph'
import {
  applyBoneRotationOffsets,
  applyLookAtOffsets,
  chainForHandle,
  findBoneByName,
  findSemanticBone,
  GROUND_FOOT_Y,
  indexBones,
  lowestSkinnedY,
  normalizeBoneKey,
  offsetFromBase,
  rotateLimbPlaneToward,
  solveCcd,
  solveChestToward,
  solveTwoBoneIk,
  type BoneIndex,
} from './characterRig'
import { applyMannequinSkeletonPose } from './mannequinSkeleton'
import { poseClipSourceBind, preloadPoseClips, samplePoseClip } from './poseClipLibrary'
import { applyPoseSnapshot, bindWorldQuaternionsByBaseName, blendPoseSnapshots, HIPS_BASE_NAME, indexBonesByBaseName, type PoseSnapshot } from './poseSnapshot'

export type IkDrag = { key: IkHandleKey; target: THREE.Vector3 }
/** 拖骨盆时两脚钉在原地：世界位置 + 世界朝向 */
type PinnedFoot = { position: THREE.Vector3; quaternion: THREE.Quaternion }

export type CharacterRigApi = {
  boneIndex: BoneIndex
  /** 该骨在「动作层之后、手调偏移之前」的四元数；FK gizmo 写偏移 = base⁻¹·当前 */
  baseQuaternionOf: (bone: THREE.Bone) => THREE.Quaternion | undefined
  /** 开始拖一只把手：记撤销快照、对齐当前时刻的骨骼关键帧；骨盆另记两脚钉位 */
  beginIkDrag: (key: IkHandleKey, target: THREE.Vector3) => void
  /** 拖动中更新靶点（世界坐标）；解算与写回在下一帧 */
  updateIkDrag: (key: IkHandleKey, target: THREE.Vector3) => void
  endIkDrag: () => void
  /** 双脚吸附地面：把两脚腕经两骨 IK 解到 y = GROUND_FOOT_Y */
  snapFeetToGround: () => void
}

const _quatA = new THREE.Quaternion()
const _quatB = new THREE.Quaternion()
const _identity = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _headPos = new THREE.Vector3()
const _lookAtTarget = new THREE.Vector3()
const _charQuat = new THREE.Quaternion()
const _upWorld = new THREE.Vector3()
const _defaultDir = new THREE.Vector3()
const _polePos = new THREE.Vector3()
const _parentInv = new THREE.Quaternion()

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
    if (weight < 1) _quatA.copy(_identity.slerp(_quatA, weight))
    bone.quaternion.multiply(_quatA)
  }
}

// 关键帧对上的骨盆偏移按同一插值系数 lerp（没记录的当 0）
function keyframeHipsOffset(sample: PoseSample): Vec3 | null {
  const a = sample.a?.hipsOffset ?? null
  const b = sample.b?.hipsOffset ?? null
  if (!a && !b) return null
  const from = a ?? { x: 0, y: 0, z: 0 }
  const to = b ?? (sample.b ? { x: 0, y: 0, z: 0 } : from)
  const t = sample.b ? sample.alpha : 0
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t }
}

function poleKeyFor(target: IkTargetKey): IkPoleKey | null {
  if (target === 'leftHand') return 'leftElbowPole'
  if (target === 'rightHand') return 'rightElbowPole'
  if (target === 'leftFoot') return 'leftKneePole'
  if (target === 'rightFoot') return 'rightKneePole'
  return null
}

export function useCharacterRig({
  objectId,
  rig,
  root,
  skinned,
  mountRef,
  mountBaseY,
}: {
  objectId: string
  rig: DirectorRig
  root: THREE.Object3D
  skinned: THREE.SkinnedMesh | null
  mountRef: React.RefObject<THREE.Group>
  // 挂载组基准高度（米）：静止姿态最低点贴地时挂载组的 y，骨盆偏移在此之上叠加
  mountBaseY: number
}): CharacterRigApi {
  const store = useDirectorStoreApi()
  const boneIndex = React.useMemo(() => indexBones(root), [root])
  // 姿态库快照按去前缀基名套骨：角色 bind 相对根朝向 + rest 骨盆位置在挂载时量一次，之后每帧按世界增量套（poseSnapshot）
  const baseBones = React.useMemo(() => indexBonesByBaseName(root), [root])
  const targetBindWorld = React.useMemo(() => bindWorldQuaternionsByBaseName(root), [root])
  const restHips = React.useMemo(() => baseBones.get(HIPS_BASE_NAME)?.position.clone() ?? null, [baseBones])
  const allBones = React.useMemo(() => {
    const list: THREE.Bone[] = []
    root.traverse((object) => {
      if ((object as THREE.Bone).isBone) list.push(object as THREE.Bone)
    })
    return list
  }, [root])
  // 动作层之后、手调偏移之前的每骨四元数，IK 写回的偏移都相对它
  const basePoseRef = React.useRef(new Map<THREE.Bone, THREE.Quaternion>())
  const ikDragsRef = React.useRef<IkDrag[]>([])
  const pinnedFeetRef = React.useRef<Partial<Record<'leftFoot' | 'rightFoot', PinnedFoot>> | null>(null)
  // 首帧自动贴地量出的挂载修正（米）：骨骼量身高只能把脚趾骨放到 y=0，鞋底比它低一两厘米，
  // 蒙皮最低点要等 boneMatrices 有效（首帧）才量得准；只量一次
  const groundFixRef = React.useRef<{ root: THREE.Object3D; offset: number } | null>(null)

  React.useEffect(() => {
    void preloadPoseClips()
  }, [])

  const semantic = React.useCallback((bone: Parameters<typeof findSemanticBone>[2]) => findSemanticBone(boneIndex, rig, bone), [boneIndex, rig])

  // 动作库快照套骨：每根骨 = 角色 bind × (源 bind⁻¹ × 源帧)，骨盆增量与位移经坐标系换算（poseSnapshot）
  const applySnapshot = React.useCallback(
    (actionId: string, snapshot: PoseSnapshot, weight: number) => {
      const sourceBind = poseClipSourceBind(actionId)
      if (!sourceBind) return
      applyPoseSnapshot(baseBones, snapshot, { weight, sourceBind, targetBindWorld, root, restHips })
    },
    [baseBones, restHips, root, targetBindWorld],
  )

  // 动作层结果：poseClip = 当前覆盖的骨骼姿态片段（关键帧当偏移叠）；actionActive = 当前有动作片段在播（此时不叠角色静止微调 / 骨盆偏移）
  type ActionLayer = { poseClip: ActionClip | null; actionActive: boolean }
  const applyActionLayer = React.useCallback(
    (object: DirectorObject, time: number): ActionLayer => {
      // 复位只复位了旋转；骨盆位置是姿态库写的，每帧先放回 rest（否则切回 T-Pose 还留着上一姿态的骨盆位移）
      const hips = baseBones.get(HIPS_BASE_NAME)
      if (hips && restHips) hips.position.copy(restHips)
      // 静止姿态预设：没有片段覆盖时的基底，也是片段淡入 / 淡出的另一端（posePreset 语义）
      const restId = object.posePreset ?? T_POSE_ACTION_ID
      const restSnapshot = samplePoseClip(restId, time)
      if (restSnapshot) applySnapshot(restId, restSnapshot, 1)
      const actionClips = object.actionTrackEnabled === false ? [] : object.actionClips ?? []
      const blend = resolveActionBlend(actionClips, time)
      if (!blend.clip) return { poseClip: null, actionActive: false }
      if (blend.clip.clipType === 'custom_pose') return { poseClip: blend.clip, actionActive: false }
      // 只有播放头落在片段内才算「动作在播」（片段外的淡出 / 间隙交叉仍叠静止微调）
      const inside = time >= blend.clip.startTime && time <= blend.clip.endTime
      const currentId = blend.clip.actionPose ?? ''
      const current = samplePoseClip(currentId, blend.localTime)
      if (!current) return { poseClip: null, actionActive: inside }
      // 上一片段挨得近：两段末帧 / 首帧直接交叉（不经过静止姿态）；否则从当前（静止预设）按权重淡入
      const previous = blend.previous && blend.previous.clipType !== 'custom_pose'
        ? samplePoseClip(blend.previous.actionPose ?? '', blend.previous.endTime - blend.previous.startTime)
        : null
      if (previous) {
        const mixed = blendPoseSnapshots(previous, current, blend.weight)
        if (mixed) applySnapshot(currentId, mixed, 1)
        return { poseClip: null, actionActive: inside }
      }
      // 混合用 smoothstep 缓动
      const eased = blend.weight * blend.weight * (3 - 2 * blend.weight)
      applySnapshot(currentId, current, eased)
      return { poseClip: null, actionActive: inside }
    },
    [applySnapshot, baseBones, restHips],
  )

  const applyLookAt = React.useCallback(
    (object: DirectorObject, state: DirectorStoreState, time: number) => {
      const clips = object.lookAtTrackEnabled === false ? [] : object.lookAtClips ?? []
      let best: { weight: number; target: Vec3; clampingAngle: number; enablePitch: boolean } | null = null
      const scene = state.activeScene()
      for (const clip of clips) {
        const weight = lookAtWeightAt(clip, time)
        if (weight <= 0 || (best && weight <= best.weight)) continue
        let target: Vec3 | null = null
        if (clip.targetType === 'camera') {
          const camera = scene.cameras.find((item) => item.id === clip.targetId)
          if (camera) target = state.evaluatedPoses[camera.id]?.position ?? camera.position
        } else if (clip.targetType === 'object') {
          const other = scene.objects.find((item) => item.id === clip.targetId)
          const pose = other ? evaluateSceneObjectPose(scene.objects, other.id, time) : null
          if (pose) target = bodyPartAnchor(pose.position, clip.targetBodyPart, clip.targetHeightOffset)
        }
        if (target) best = { weight, target, clampingAngle: clip.clampingAngle, enablePitch: clip.enablePitch }
      }
      if (!best) return
      const head = semantic('head')
      if (!head) return
      head.getWorldPosition(_headPos)
      root.worldToLocal(_headPos)
      const worldTarget = transformPoint(sceneFrame(scene.sceneConfig), best.target)
      root.worldToLocal(_lookAtTarget.set(worldTarget.x, worldTarget.y, worldTarget.z))
      const aim = solveHeadAim({
        headPosition: { x: _headPos.x, y: _headPos.y, z: _headPos.z },
        targetPosition: { x: _lookAtTarget.x, y: _lookAtTarget.y, z: _lookAtTarget.z },
        bodyYaw: 0,
        clampingAngle: best.clampingAngle,
        enablePitch: best.enablePitch,
        weight: best.weight,
      })
      applyLookAtOffsets(boneIndex, rig, distributeHeadAim(aim))
    },
    [boneIndex, rig, root, semantic],
  )

  /** 把一组骨的「base⁻¹ · 当前」写回 boneRotations（拖动中每帧写，滑条实时跟） */
  const writeOffsets = React.useCallback(
    (bones: THREE.Bone[]) => {
      const rotations: Record<string, Vec3> = {}
      for (const bone of bones) {
        const base = basePoseRef.current.get(bone)
        if (!base) continue
        rotations[normalizeBoneKey(bone.name)] = offsetFromBase(bone, base)
      }
      if (Object.keys(rotations).length > 0) store.getState().writeBoneRotations(objectId, rotations)
    },
    [objectId, store],
  )

  const solveDrag = React.useCallback(
    (drag: IkDrag) => {
      root.getWorldQuaternion(_charQuat)
      _upWorld.set(0, 1, 0).applyQuaternion(_charQuat).normalize()
      if (drag.key in IK_POLES) {
        const pole = IK_POLES[drag.key as IkPoleKey]
        const rootBone = semantic(pole.root)
        const midBone = semantic(pole.mid)
        const endBone = semantic(pole.effector)
        if (!rootBone || !midBone || !endBone) return
        rotateLimbPlaneToward(rootBone, midBone, endBone, drag.target)
        writeOffsets([rootBone, midBone])
        return
      }
      if (drag.key === 'chest') {
        const spine = semantic('spine')
        const hips = semantic('hips')
        const base = spine ? basePoseRef.current.get(spine) : undefined
        if (!spine || !hips || !base) return
        solveChestToward(spine, hips, drag.target, _upWorld, base)
        writeOffsets([spine])
        return
      }
      if (drag.key === 'head') {
        const chain = chainForHandle(boneIndex, rig, 'head')
        if (!chain) return
        solveCcd(chain, drag.target)
        writeOffsets(chain.links)
        return
      }
      if (drag.key in IK_TARGETS) {
        const target = drag.key as IkTargetKey
        const config = IK_TARGETS[target]
        const poleKey = poleKeyFor(target)
        if (!poleKey) return
        const pole = IK_POLES[poleKey]
        const rootBone = semantic(pole.root)
        const midBone = semantic(pole.mid)
        const endBone = semantic(config.effector)
        if (!rootBone || !midBone || !endBone) return
        _defaultDir.set(pole.defaultDirection.x, pole.defaultDirection.y, pole.defaultDirection.z).applyQuaternion(_charQuat)
        // 极向量：正在拖或另一只在解时用它当前位置，否则按肢体平面算（有把手网格就用把手位置）
        const poleDrag = ikDragsRef.current.find((item) => item.key === poleKey)
        if (poleDrag) _polePos.copy(poleDrag.target)
        else _polePos.copy(midBone.getWorldPosition(_polePos)).addScaledVector(_defaultDir, pole.distance)
        solveTwoBoneIk(rootBone, midBone, endBone, drag.target, _polePos, _defaultDir, _upWorld)
        // 钉脚：脚腕保持拖前的世界朝向
        const pinned = pinnedFeetRef.current?.[target as 'leftFoot' | 'rightFoot']
        if (pinned && endBone.parent) {
          endBone.parent.getWorldQuaternion(_parentInv).invert()
          endBone.quaternion.copy(_parentInv).multiply(pinned.quaternion)
          endBone.updateMatrixWorld(true)
        }
        writeOffsets(pinned ? [rootBone, midBone, endBone] : [rootBone, midBone])
      }
    },
    [boneIndex, rig, root, semantic, writeOffsets],
  )

  useFrame(() => {
    const state = store.getState()
    const object = state.findObject(objectId)
    if (!object) return
    const time = state.timeline.currentTime
    // 1) 复位到 bind + 默认站姿
    applyMannequinSkeletonPose(root)
    // 2) 静止预设 + 动作层（骨骼姿态片段的关键帧作为「偏移」在 3 之后叠）
    const { poseClip, actionActive } = applyActionLayer(object, time)
    // 3) 记 basePoseForOffsets：IK 写回的偏移相对这一刻
    const base = basePoseRef.current
    for (const bone of allBones) {
      const saved = base.get(bone)
      if (saved) saved.copy(bone.quaternion)
      else base.set(bone, bone.quaternion.clone())
    }
    // 4) 手调偏移：骨骼姿态片段里按关键帧 slerp；动作片段在播时不叠（o !== -1 且非姿态片段 → 跳过）；否则角色静止 boneRotations
    const poseSample = poseClip ? resolvePoseKeyframes(poseClip, time) : null
    if (poseSample) applyPoseSample(boneIndex, poseSample, 1)
    else if (!actionActive && object.boneRotations) applyBoneRotationOffsets(boneIndex, object.boneRotations)
    root.updateMatrixWorld(true)
    // 5) IK：拖把手时每帧解一次并立刻写回
    for (const drag of ikDragsRef.current) solveDrag(drag)
    // 6) 视线
    applyLookAt(object, state, time)
    // 7) 骨盆偏移：整体挂载组平移（米）；首帧先按蒙皮最低点把鞋底贴到 y=0
    const mount = mountRef.current
    if (!mount) return
    if (groundFixRef.current?.root !== root) {
      mount.position.set(0, mountBaseY, 0)
      mount.updateMatrixWorld(true)
      skinned?.skeleton.update()
      groundFixRef.current = { root, offset: -lowestSkinnedY(root) }
    }
    const groundFix = groundFixRef.current.offset
    // 骨盆偏移来源同 4)：姿态片段取关键帧上的（首尾停在端帧、中间按系数插值）；动作在播时为 0；否则角色静止 hipsOffset
    const hips = poseSample ? keyframeHipsOffset(poseSample) : actionActive ? null : object.hipsOffset
    mount.position.set(hips?.x ?? 0, mountBaseY + groundFix + (hips?.y ?? 0), hips?.z ?? 0)
  })

  const beginIkDrag = React.useCallback(
    (key: IkHandleKey, target: THREE.Vector3) => {
      const state = store.getState()
      state.saveState()
      state.syncBoneKeyframeAtPlayhead(objectId)
      if (key === 'pelvis') {
        // 骨盆：两脚钉在原地（世界位置 + 朝向），两条腿一起解
        const pinned: NonNullable<typeof pinnedFeetRef.current> = {}
        const drags: IkDrag[] = []
        for (const foot of ['leftFoot', 'rightFoot'] as const) {
          const bone = semantic(foot)
          if (!bone) continue
          const position = bone.getWorldPosition(new THREE.Vector3())
          pinned[foot] = { position, quaternion: bone.getWorldQuaternion(new THREE.Quaternion()) }
          drags.push({ key: foot, target: position.clone() })
        }
        pinnedFeetRef.current = pinned
        ikDragsRef.current = drags
        return
      }
      pinnedFeetRef.current = null
      ikDragsRef.current = [{ key, target: target.clone() }]
    },
    [objectId, semantic, store],
  )
  const updateIkDrag = React.useCallback((key: IkHandleKey, target: THREE.Vector3) => {
    const drag = ikDragsRef.current.find((item) => item.key === key)
    if (drag) drag.target.copy(target)
  }, [])
  const endIkDrag = React.useCallback(() => {
    ikDragsRef.current = []
    pinnedFeetRef.current = null
  }, [])

  // 脚腕世界位置的 y 改成 GROUND_FOOT_Y，走一遍两骨 IK 并写回（一次性，不进拖动态）
  const snapFeetToGround = React.useCallback(() => {
    const state = store.getState()
    state.saveState()
    state.syncBoneKeyframeAtPlayhead(objectId)
    root.updateMatrixWorld(true)
    for (const foot of ['leftFoot', 'rightFoot'] as const) {
      const bone = semantic(foot)
      if (!bone) continue
      const target = bone.getWorldPosition(new THREE.Vector3())
      target.y = GROUND_FOOT_Y
      solveDrag({ key: foot, target })
    }
  }, [objectId, root, semantic, solveDrag, store])

  // 卸载时不留悬空拖动
  React.useEffect(() => () => endIkDrag(), [endIkDrag])
  void boneName

  const baseQuaternionOf = React.useCallback((bone: THREE.Bone) => basePoseRef.current.get(bone), [])

  return { boneIndex, baseQuaternionOf, beginIkDrag, updateIkDrag, endIkDrag, snapFeetToGround }
}

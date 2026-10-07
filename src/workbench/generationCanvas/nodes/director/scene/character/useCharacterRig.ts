/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame、../../DirectorEditorContext 的 useDirectorStoreApi、
 *          ./characterPosePipeline（createCharacterPoseContext / poseCharacterFrame：复位 → 动作层 → basePose → 手调偏移）、./poseClipLibrary 的 preloadPoseClips、
 *          ../../model/poseBlend 的 PoseSample、../../model/lookAtSolve、
 *          ../../model/ikChains（IK_TARGETS / IK_POLES / IkHandleKey）、../../model/rigs 的 boneName、../../model/directorTypes、../../model/vec3、./characterRig、
 *          ../../model/evaluatedSceneObject / sceneObjectGraph：目标先求完整场景位置，头与目标统一进角色坐标后调用原视线解算
 * [OUTPUT]: 对外提供 IkDrag / CharacterRigApi、useCharacterRig
 * [POS]: director/scene/character 的每帧骨骼管线：复位 bind → 静止姿态预设 → 动作层 →
 *        记 basePoseForOffsets → boneRotations 偏移（四元数右乘；动作片段在播时不叠）→ IK（两骨解析 / 极向量绕轴 / 胸腔朝向 / 头 CCD / 骨盆钉脚，解完立刻把
 *        base⁻¹·当前 写回 boneRotations）→ 视线（只补动作层还没转到的那部分头 yaw）→ 骨盆偏移（挂载组）。时间取 store.timeline.currentTime。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject, DirectorRig, Vec3 } from '../../model/directorTypes'
import type { DirectorStoreState } from '../../model/directorStore'
import { IK_POLES, IK_TARGETS, type IkHandleKey, type IkPoleKey, type IkTargetKey } from '../../model/ikChains'
import { bodyPartAnchor, distributeHeadAim, lookAtWeightAt, solveHeadAim } from '../../model/lookAtSolve'
import type { PoseSample } from '../../model/poseBlend'
import { boneName } from '../../model/rigs'
import { evaluateSceneObjectPose } from '../../model/evaluatedSceneObject'
import { sceneFrame, transformPoint } from '../../model/sceneObjectGraph'
import {
  applyLookAtOffsets,
  chainForHandle,
  findSemanticBone,
  GROUND_FOOT_Y,
  headYawInCharacter,
  lowestSkinnedY,
  normalizeBoneKey,
  offsetFromBase,
  rotateLimbPlaneToward,
  solveCcd,
  solveChestToward,
  solveTwoBoneIk,
  type BoneIndex,
} from './characterRig'
import { createCharacterPoseContext, poseCharacterFrame } from './characterPosePipeline'
import { preloadPoseClips } from './poseClipLibrary'

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

const _headPos = new THREE.Vector3()
const _lookAtTarget = new THREE.Vector3()
const _charQuat = new THREE.Quaternion()
const _upWorld = new THREE.Vector3()
const _defaultDir = new THREE.Vector3()
const _polePos = new THREE.Vector3()
const _parentInv = new THREE.Quaternion()

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
  mountRef: React.RefObject<THREE.Group | null>
  // 挂载组基准高度（米）：静止姿态最低点贴地时挂载组的 y，骨盆偏移在此之上叠加
  mountBaseY: number
}): CharacterRigApi {
  const store = useDirectorStoreApi()
  // 姿态管线前半段的上下文（骨索引 / 基名索引 / bind / rest 骨盆 / basePose）：挂载时建一次，每帧经 poseCharacterFrame 跑
  const poseContext = React.useMemo(() => createCharacterPoseContext(root), [root])
  const boneIndex = poseContext.boneIndex
  const ikDragsRef = React.useRef<IkDrag[]>([])
  const pinnedFeetRef = React.useRef<Partial<Record<'leftFoot' | 'rightFoot', PinnedFoot>> | null>(null)
  // 首帧自动贴地量出的挂载修正（米）：骨骼量身高只能把脚趾骨放到 y=0，鞋底比它低一两厘米，
  // 蒙皮最低点要等 boneMatrices 有效（首帧）才量得准；只量一次
  const groundFixRef = React.useRef<{ root: THREE.Object3D; offset: number } | null>(null)

  React.useEffect(() => {
    void preloadPoseClips()
  }, [])

  const semantic = React.useCallback((bone: Parameters<typeof findSemanticBone>[2]) => findSemanticBone(boneIndex, rig, bone), [boneIndex, rig])

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
      const currentHeadYaw = headYawInCharacter(head, root)
      const worldTarget = transformPoint(sceneFrame(scene.sceneConfig), best.target)
      root.worldToLocal(_lookAtTarget.set(worldTarget.x, worldTarget.y, worldTarget.z))
      const aim = solveHeadAim({
        headPosition: { x: _headPos.x, y: _headPos.y, z: _headPos.z },
        targetPosition: { x: _lookAtTarget.x, y: _lookAtTarget.y, z: _lookAtTarget.z },
        bodyYaw: 0,
        clampingAngle: best.clampingAngle,
        enablePitch: best.enablePitch,
        weight: best.weight,
        currentHeadYaw,
      })
      root.getWorldQuaternion(_charQuat)
      applyLookAtOffsets(boneIndex, rig, distributeHeadAim(aim), _upWorld.set(0, 1, 0).applyQuaternion(_charQuat).normalize())
    },
    [boneIndex, rig, root, semantic],
  )

  /** 把一组骨的「base⁻¹ · 当前」写回 boneRotations（拖动中每帧写，滑条实时跟） */
  const writeOffsets = React.useCallback(
    (bones: THREE.Bone[]) => {
      const rotations: Record<string, Vec3> = {}
      for (const bone of bones) {
        const base = poseContext.basePose.get(bone)
        if (!base) continue
        rotations[normalizeBoneKey(bone.name)] = offsetFromBase(bone, base)
      }
      if (Object.keys(rotations).length > 0) store.getState().writeBoneRotations(objectId, rotations)
    },
    [objectId, poseContext, store],
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
        const base = spine ? poseContext.basePose.get(spine) : undefined
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
    [boneIndex, poseContext, rig, root, semantic, writeOffsets],
  )

  useFrame(() => {
    const state = store.getState()
    const object = state.findObject(objectId)
    if (!object) return
    const time = state.timeline.currentTime
    // 1–4) 复位 → 静止预设 + 动作层 → 记 basePose → 手调偏移 → 更新矩阵（characterPosePipeline）；
    //      basePose 只给 IK / 旋转 Gizmo 写回用：没选中也没在拖时不拷（群众快路径）
    const keepBasePose = state.selection.objectId === objectId || ikDragsRef.current.length > 0
    const { poseSample, actionActive } = poseCharacterFrame(poseContext, object, time, { keepBasePose })
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

  const baseQuaternionOf = React.useCallback((bone: THREE.Bone) => poseContext.basePose.get(bone), [poseContext])

  return { boneIndex, baseQuaternionOf, beginIkDrag, updateIkDrag, endIkDrag, snapFeetToGround }
}

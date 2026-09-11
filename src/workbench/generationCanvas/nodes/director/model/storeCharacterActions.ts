/**
 * [INPUT]: 依赖 ./directorStore 的 CommitProject / StoreGet / StoreSet、./directorTypes（DirectorObject / Vec3）、./rigs（BODY_TYPE_PRESETS / mirrorBoneRotations）、./actionLibrary 的 findActionEntry
 * [OUTPUT]: 对外提供 DirectorCharacterActions、createCharacterActions：骨骼旋转单骨写入 / 合并 / 拖动中逐帧写、全部复位 / 复位此肢体 / 左右镜像、
 *           播放头对齐骨骼关键帧、姿态预设（切换清微调）、快捷体形、骨盆偏移
 * [POS]: director/model 的角色骨骼级动作（清单 §4.1 姿态页 / 骨骼页）：写入落点由选择态决定——选中骨骼关键帧时改那一帧，否则改角色静止 boneRotations；
 *        单骨写入不快照（滑条 onChangeStart 已快照），其余每个动作一次快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { findActionEntry } from './actionLibrary'
import { IK_POLES, IK_TARGETS, type IkHandleKey } from './ikChains'
import { boneName } from './rigs'
import { FRAME_EPSILON } from './timeGrid'
import type { CommitProject, StoreGet, StoreSet } from './directorStore'
import type { ActionClip, DirectorObject, Vec3 } from './directorTypes'
import { BODY_TYPE_PRESETS, mirrorBoneRotations } from './rigs'

export type DirectorCharacterActions = {
  setBoneRotation: (objectId: string, bone: string, rotation: Vec3) => void
  mergeBoneRotations: (objectId: string, rotations: Record<string, Vec3>) => void
  /** IK 拖动中每帧写（不快照；快照在 beginIkDrag） */
  writeBoneRotations: (objectId: string, rotations: Record<string, Vec3>) => void
  resetBoneRotations: (objectId: string, bones?: string[]) => void
  /** boneRotations 清空 + 骨盆偏移归零（姿态预设保留） */
  resetAllPose: (objectId: string) => void
  /** 按把手清对应骨（骨盆 = 骨盆偏移归零；胸腔 = 脊柱；极向量 = 根 + 中；靶点 = 末端 + 链节） */
  resetLimb: (objectId: string, handleKey: IkHandleKey) => void
  /** 播放头落在骨骼姿态片段的某个关键帧上就把它设为写入落点 */
  syncBoneKeyframeAtPlayhead: (objectId: string) => void
  mirrorPose: (objectId: string, fromSide: 'left' | 'right') => void
  applyPosePreset: (objectId: string, presetId: string) => boolean
  setBodyType: (objectId: string, bodyTypeId: string) => boolean
  setHipsOffset: (objectId: string, offset: Vec3 | undefined) => void
  updateActionClip: (objectId: string, clipId: string, patch: Partial<Pick<ActionClip, 'name' | 'actionPose'>>) => void
}

// 当前骨骼写入落点：选中的骨骼关键帧（骨骼页改的是那一帧）或角色静止姿态
function rotationTarget(object: DirectorObject, keyframeId: string | null): Record<string, Vec3> {
  if (keyframeId) {
    for (const clip of object.actionClips ?? []) {
      const keyframe = clip.keyframes?.find((item) => item.id === keyframeId)
      if (keyframe) return keyframe.boneRotations
    }
  }
  object.boneRotations = object.boneRotations ?? {}
  return object.boneRotations
}

export function createCharacterActions(_set: StoreSet, get: StoreGet, commitProject: CommitProject): DirectorCharacterActions {
  const save = () => get().saveState()
  const mutateObject = (objectId: string, mutate: (object: DirectorObject) => void) =>
    commitProject((_, scene) => {
      const object = scene.objects.find((item) => item.id === objectId)
      if (object?.type === 'character') mutate(object)
    })

  return {
    setBoneRotation: (objectId, bone, rotation) => {
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (object) => {
        rotationTarget(object, keyframeId)[bone] = { ...rotation }
      })
    },

    // IK 拖完 / 批量写入：把一组骨骼旋转合并进当前落点
    mergeBoneRotations: (objectId, rotations) => {
      if (Object.keys(rotations).length === 0) return
      save()
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (object) => {
        const target = rotationTarget(object, keyframeId)
        for (const [bone, value] of Object.entries(rotations)) target[bone] = { ...value }
      })
    },

    // 复位：不传 bones = 全部复位（含骨盆偏移与姿态预设）
    writeBoneRotations: (objectId, rotations) => {
      if (Object.keys(rotations).length === 0) return
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (object) => {
        const target = rotationTarget(object, keyframeId)
        for (const [bone, value] of Object.entries(rotations)) target[bone] = { ...value }
      })
    },

    resetBoneRotations: (objectId, bones) => {
      save()
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (object) => {
        const target = rotationTarget(object, keyframeId)
        if (!bones) {
          for (const bone of Object.keys(target)) delete target[bone]
          if (!keyframeId) object.hipsOffset = undefined
          return
        }
        for (const bone of bones) delete target[bone]
      })
    },

    resetAllPose: (objectId) => {
      save()
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (object) => {
        const target = rotationTarget(object, keyframeId)
        for (const bone of Object.keys(target)) delete target[bone]
        object.hipsOffset = { x: 0, y: 0, z: 0 }
      })
    },

    resetLimb: (objectId, handleKey) => {
      save()
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (object) => {
        const rig = object.rig ?? 'mixamo'
        if (handleKey === 'pelvis') {
          object.hipsOffset = { x: 0, y: 0, z: 0 }
          return
        }
        const target = rotationTarget(object, keyframeId)
        const names: string[] = []
        if (handleKey === 'chest') names.push(boneName(rig, 'spine'))
        else if (handleKey in IK_POLES) {
          const pole = IK_POLES[handleKey as keyof typeof IK_POLES]
          names.push(boneName(rig, pole.root), boneName(rig, pole.mid))
        } else if (handleKey in IK_TARGETS) {
          const config = IK_TARGETS[handleKey as keyof typeof IK_TARGETS]
          names.push(boneName(rig, config.effector), ...config.links.map((link) => boneName(rig, link)))
        }
        for (const name of names) delete target[name]
      })
    },

    syncBoneKeyframeAtPlayhead: (objectId) => {
      const state = get()
      const object = state.findObject(objectId)
      if (!object) return
      const time = state.timeline.currentTime
      for (const clip of object.actionClips ?? []) {
        if (clip.clipType !== 'custom_pose') continue
        const keyframe = clip.keyframes?.find((item) => Math.abs(item.time - time) <= FRAME_EPSILON)
        if (keyframe) {
          if (state.selection.boneKeyframeId !== keyframe.id) state.select({ boneKeyframeId: keyframe.id, boneClipId: clip.id })
          return
        }
      }
    },

    mirrorPose: (objectId, fromSide) => {
      const object = get().findObject(objectId)
      if (!object?.rig && !object) return
      save()
      const keyframeId = get().selection.boneKeyframeId
      mutateObject(objectId, (target) => {
        const rotations = rotationTarget(target, keyframeId)
        const mirrored = mirrorBoneRotations(rotations, target.rig ?? 'mixamo', fromSide)
        for (const bone of Object.keys(rotations)) delete rotations[bone]
        Object.assign(rotations, mirrored)
      })
    },

    // 静止姿态预设 = 动作库条目（与 posePreset 同义）：角色没有动作片段时按它采样；boneRotations 的手调偏移仍叠在其上
    // 换预设即清掉全部微调（「微调会在切换后重置」）；同一个预设不重复写
    applyPosePreset: (objectId, presetId) => {
      if (!findActionEntry(presetId)) return false
      const current = get().findObject(objectId)
      if (!current || current.posePreset === presetId) return false
      save()
      mutateObject(objectId, (object) => {
        object.posePreset = presetId
        object.boneRotations = {}
      })
      return true
    },

    setBodyType: (objectId, bodyTypeId) => {
      const preset = BODY_TYPE_PRESETS.find((item) => item.id === bodyTypeId)
      if (!preset) return false
      save()
      mutateObject(objectId, (object) => {
        object.bodyType = bodyTypeId
        object.scale = { ...preset.scale }
      })
      return true
    },

    setHipsOffset: (objectId, offset) => {
      mutateObject(objectId, (object) => {
        object.hipsOffset = offset ? { ...offset } : undefined
      })
    },

    updateActionClip: (objectId, clipId, patch) => {
      save()
      mutateObject(objectId, (object) => {
        const clip = object.actionClips?.find((item) => item.id === clipId)
        if (clip) Object.assign(clip, patch)
      })
    },
  }
}

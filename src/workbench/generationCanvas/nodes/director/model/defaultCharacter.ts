/**
 * [INPUT]: 依赖 ./directorTypes（DirectorObject / DirectorRig / Vec3）
 * [OUTPUT]: 对外提供 CharacterGender、CHARACTER_MODEL_BY_GENDER、DEFAULT_CROWD_ACTION_ID、defaultCharacterInput：「加人」与「放置群众」共用的默认角色模板
 * [POS]: director/model 的默认角色唯一定义：角色放置（scene/creation/useCharacterPlacement）与群众（store.batchCreateCrowd）都从这里取模型 / 绑定 / 颜色，
 *        群众因此永远和「加人」是同一个人偶（2026-10-07 用户拍板：群众并进「加人」、用默认角色、不复制选中角色）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorObject, DirectorRig, Vec3 } from './directorTypes'
import { DEFAULT_CHARACTER_MODEL_PATH, DEFAULT_CHARACTER_RIG } from './rigs'

export type CharacterGender = 'female' | 'male'

export const CHARACTER_MODEL_BY_GENDER: Record<CharacterGender, { modelPath: string; rig: DirectorRig }> = {
  female: { modelPath: DEFAULT_CHARACTER_MODEL_PATH, rig: DEFAULT_CHARACTER_RIG },
  male: { modelPath: DEFAULT_CHARACTER_MODEL_PATH, rig: DEFAULT_CHARACTER_RIG },
}

/** 群众默认动作 = 动作库「站立」（standing_idle）。 */
export const DEFAULT_CROWD_ACTION_ID = 'standing_idle'

type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 }

/** 一个默认角色的 addObject 入参；posePreset 缺省为 T-Pose（「加人」的现状），群众传动作库 id。 */
export function defaultCharacterInput(gender: CharacterGender, name: string, transform: Transform, posePreset = 'tpose'): Omit<DirectorObject, 'id'> {
  const spec = CHARACTER_MODEL_BY_GENDER[gender]
  return {
    name,
    type: 'character',
    ...transform,
    color: gender === 'female' ? '#fb7185' : '#38bdf8',
    visible: true,
    locked: false,
    posePreset,
    modelPath: spec.modelPath,
    modelScale: 1,
    isSystemModel: true,
    rig: spec.rig,
  }
}

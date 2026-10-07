/**
 * [INPUT]: 依赖 ./directorTypes（DirectorObject / Vec3）、./rigs（RIG_BONE_MAPS / SEMANTIC_BONES / isBuiltinCharacterModel）、
 *          ./actionLibrary（findActionEntry / resolveActionAlias / LEGACY_APPROXIMATE_ACTIONS）
 * [OUTPUT]: 对外提供 UalMigrationNote、createUalMigrationNote、migrateBuiltinCharacterToUal
 * [POS]: director/model 的「内置人偶 Mixamo → UAL」读时迁移（2026-10-07 默认人偶换 UAL，不留并行版）：只由 directorProject.normalizeObject 调用，
 *        所以编辑器、Agent 写口、预演截帧、出片、导入图层读到的都是同一份迁移结果；纯函数、幂等、只改内存里那份。
 *        判据 = 内置人偶（modelPath 缺省或 builtin:*）且 rig 缺省或 'mixamo'；用户上传的 Mixamo 角色一个字不碰。
 *        动作 id 按动作库别名表换（一张表，施工计划 §3），boneRotations 的键 mixamorig* → UAL 骨名、值原样（值是规范轴度数，
 *        scene/character/canonicalBoneFrame 保证语义不变）；没有对应骨的键（手指 / 末端）丢掉并计数。迁移说明只回给调用方，不进工程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { findActionEntry, LEGACY_APPROXIMATE_ACTIONS, resolveActionAlias } from './actionLibrary'
import type { DirectorObject, Vec3 } from './directorTypes'
import { isBuiltinCharacterModel, RIG_BONE_MAPS, SEMANTIC_BONES } from './rigs'

export type UalMigrationNote = {
  /** 迁成 UAL 的内置人偶个数 */
  characters: number
  /** 旧动作在 UAL 里没有原样对应、换成了相近动作的次数（坐地上 / 跪 / 下跪 / 跪起身） */
  approximatedActions: number
  /** 手调骨骼里没有对应骨、丢掉的键数（手指、头顶 / 脚尖末端） */
  droppedBoneKeys: number
}

export function createUalMigrationNote(): UalMigrationNote {
  return { characters: 0, approximatedActions: 0, droppedBoneKeys: 0 }
}

/** mixamorig 骨名（带不带冒号、大小写）→ UAL 语义骨名；已是 UAL 语义骨名的原样；其它 → null */
const UAL_BONE_BY_KEY = new Map<string, string>(
  SEMANTIC_BONES.flatMap((bone) => [
    [RIG_BONE_MAPS.mixamo[bone].toLowerCase(), RIG_BONE_MAPS.ual[bone]],
    [RIG_BONE_MAPS.ual[bone].toLowerCase(), RIG_BONE_MAPS.ual[bone]],
  ]),
)
const ualBoneFor = (key: string): string | null => UAL_BONE_BY_KEY.get(key.replace(':', '').toLowerCase()) ?? null

function migrateBoneRotations(rotations: Record<string, Vec3>, note: UalMigrationNote): Record<string, Vec3> {
  const out: Record<string, Vec3> = {}
  for (const [key, value] of Object.entries(rotations)) {
    const bone = ualBoneFor(key)
    if (bone) out[bone] = value
    else note.droppedBoneKeys += 1
  }
  return out
}

/** 动作 id：库里有 → 原样；旧 id / 别名 → 库里的 UAL id（近似的记一次）；认不出 → 原样（保持「找不到条目 = 静止」） */
function migrateActionId(id: string, note: UalMigrationNote): string {
  if (findActionEntry(id)) return id
  const entry = resolveActionAlias(id)
  if (!entry) return id
  if (LEGACY_APPROXIMATE_ACTIONS.has(id)) note.approximatedActions += 1
  return entry.id
}

export function migrateBuiltinCharacterToUal(object: DirectorObject, note: UalMigrationNote): void {
  if (object.type !== 'character' || !isBuiltinCharacterModel(object.modelPath)) return
  if (object.rig !== undefined && object.rig !== 'mixamo') return
  object.rig = 'ual'
  note.characters += 1
  if (object.posePreset) object.posePreset = migrateActionId(object.posePreset, note)
  if (object.boneRotations) object.boneRotations = migrateBoneRotations(object.boneRotations, note)
  for (const clip of object.actionClips ?? []) {
    if (clip.actionPose) {
      const previous = clip.actionPose
      clip.actionPose = migrateActionId(previous, note)
      // 编译器把片段名写成动作 id（directorPlanCompiler）：名字恰好是旧 id 的一并换掉；用户起的名字不动
      if (clip.name === previous) clip.name = clip.actionPose
    }
    for (const keyframe of clip.keyframes ?? []) keyframe.boneRotations = migrateBoneRotations(keyframe.boneRotations, note)
  }
}

/**
 * [INPUT]: 无依赖（纯数据）
 * [OUTPUT]: 对外提供 T_POSE_ACTION_ID、ActionLibraryEntry、ACTION_LIBRARY、ACTION_ALIASES、findActionEntry、resolveActionAlias、LEGACY_POSE_TO_ACTION、legacyPoseToAction
 * [POS]: director/model 的动作库单一真相：T-Pose（绑定姿态）+ 9 个 Mixamo FBX 动画，
 *        同一份清单同时是「动作片段」的可选项和角色「静止姿态预设」（posePreset）的可选项——不区分「循环」与「单帧」两类，
 *        静态与否由 FBX 时长在运行时判定（scene/character/poseClipLibrary）。文件地址住 scene/character/mannequinAssets（model 层不碰 URL）。
 *        别名表给 AI 搭场景 / 自然语言 / 站位参考词表留口子；LEGACY_POSE_TO_ACTION 给 V1 手写预设 id 找对应动画（迁移与站位 builder 用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** 绑定姿态，不对应任何文件 */
export const T_POSE_ACTION_ID = 'tpose'

export type ActionLibraryEntry = {
  id: string
  /** src/assets/director/pose 下的文件名（不含扩展名）；T-Pose 为 null */
  file: string | null
  /** 加进时间轴时的默认片段时长（秒） */
  defaultDuration: number
}

export const ACTION_LIBRARY: readonly ActionLibraryEntry[] = [
  { id: T_POSE_ACTION_ID, file: null, defaultDuration: 2 },
  { id: 'standing_idle', file: 'StandingIdle', defaultDuration: 4 },
  { id: 'kneeling_down', file: 'KneelingDown', defaultDuration: 3 },
  { id: 'kneeling', file: 'Kneeling', defaultDuration: 4 },
  { id: 'standing_up', file: 'Standing', defaultDuration: 3 },
  { id: 'standard_walk', file: 'StandardWalk', defaultDuration: 4 },
  { id: 'running', file: 'Running', defaultDuration: 4 },
  { id: 'male_sitting_pose_1', file: 'MaleSittingPose1', defaultDuration: 4 },
  { id: 'male_sitting_pose', file: 'MaleSittingPose', defaultDuration: 4 },
  { id: 'kneeling_idle', file: 'KneelingIdle', defaultDuration: 4 },
]

// 自然语言 / AI 用的别名（含中文）：小写、去空格后匹配
export const ACTION_ALIASES: Record<string, string> = {
  stand: 'standing_idle',
  standing: 'standing_idle',
  standing_idle: 'standing_idle',
  basic_standing: 'standing_idle',
  basic_standing_2: 'standing_idle',
  idle: 'standing_idle',
  walk: 'standard_walk',
  walking: 'standard_walk',
  standard_walk: 'standard_walk',
  run: 'running',
  running: 'running',
  jog: 'running',
  jogging: 'running',
  sprint: 'running',
  sprint_start: 'running',
  kneel: 'kneeling',
  kneeling: 'kneeling',
  kneeling_down: 'kneeling_down',
  kneeling_idle: 'kneeling_idle',
  standing_up: 'standing_up',
  sit: 'male_sitting_pose_1',
  sitting: 'male_sitting_pose_1',
  basic_sitting: 'male_sitting_pose_1',
  male_sitting_pose_1: 'male_sitting_pose_1',
  sit_ground: 'male_sitting_pose',
  sitting_on_ground: 'male_sitting_pose',
  male_sitting_pose: 'male_sitting_pose',
  't-pose': T_POSE_ACTION_ID,
  站立: 'standing_idle',
  待机: 'standing_idle',
  行走: 'standard_walk',
  走: 'standard_walk',
  走路: 'standard_walk',
  跑: 'running',
  跑步: 'running',
  奔跑: 'running',
  坐: 'male_sitting_pose_1',
  坐下: 'male_sitting_pose_1',
  坐姿: 'male_sitting_pose_1',
  坐地上: 'male_sitting_pose',
  席地而坐: 'male_sitting_pose',
  跪: 'kneeling',
  跪下: 'kneeling',
  跪地: 'kneeling',
  单膝跪: 'kneeling',
  单膝跪地: 'kneeling',
  双膝跪: 'kneeling_idle',
  双膝跪地: 'kneeling_idle',
  起身: 'standing_up',
  站起来: 'standing_up',
  T型: T_POSE_ACTION_ID,
  T字: T_POSE_ACTION_ID,
}

/** V1 手写姿态预设 id → 动作库 id（无对应 → undefined，迁移时只烘 boneRotations） */
export const LEGACY_POSE_TO_ACTION: Record<string, string> = {
  standing: 'standing_idle',
  't-pose': T_POSE_ACTION_ID,
  walk: 'standard_walk',
  run: 'running',
  sit: 'male_sitting_pose_1',
  'single-knee': 'kneeling',
  'double-knee': 'kneeling_idle',
}

export function legacyPoseToAction(presetId: string | undefined): string | undefined {
  return presetId ? LEGACY_POSE_TO_ACTION[presetId] : undefined
}

export function findActionEntry(id: string): ActionLibraryEntry | undefined {
  return ACTION_LIBRARY.find((entry) => entry.id === id)
}

export function resolveActionAlias(text: string): ActionLibraryEntry | undefined {
  const key = text.trim().toLowerCase().replace(/\s+/g, '')
  const direct = findActionEntry(key)
  if (direct) return direct
  const alias = ACTION_ALIASES[key] ?? ACTION_ALIASES[text.trim().replace(/\s+/g, '')]
  return alias ? findActionEntry(alias) : undefined
}

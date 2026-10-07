/**
 * [INPUT]: 依赖 ./assetCatalog/ualActions 的 UAL_ACTIONS（scripts/director-assets/prepare_ual.py 从 UAL glb 生成的动作元数据）
 * [OUTPUT]: 对外提供 T_POSE_ACTION_ID、ActionKind、ActionLibraryEntry、ACTION_LIBRARY、ACTION_ALIASES、LEGACY_APPROXIMATE_ACTIONS、
 *           findActionEntry、resolveActionAlias、PLANNER_ACTION_IDS、LEGACY_POSE_TO_ACTION、legacyPoseToAction
 * [POS]: director/model 的动作库单一真相：T-Pose（绑定姿态）+ 默认人偶 UAL 自带的 43 个原生动作（45 个去掉两个带根运动的 _RM 重复版——
 *        我们的重定向只套骨盆，根运动播不出来）。同一份清单同时是「动作片段」与角色「静止姿态预设」（posePreset）的可选项，
 *        也是规划器提示词、评测尺子、动作选择器的来源（不许各自手抄）。动作 id = glb 里的 clip 名；动画数据住 scene/character/poseClipLibrary（model 层不碰 URL / three）。
 *        kind：loop 循环取模；once 播完停在末帧；pose 单姿势（T-Pose 与只有零点几秒的瞄准姿势）。
 *        别名表一份三用：AI / 自然语言词、旧 Mixamo 动作 id（2026-10-07 换 UAL 前存档里的）读档迁移、V1 手写预设经 LEGACY_POSE_TO_ACTION 落到动作。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { UAL_ACTIONS } from './assetCatalog/ualActions'

/** 绑定姿态，不对应任何动作数据 */
export const T_POSE_ACTION_ID = 'tpose'

export type ActionKind = 'loop' | 'once' | 'pose'

export type ActionLibraryEntry = {
  /** = glb 里的 clip 名；T-Pose 为 tpose */
  id: string
  /** glb 里的 clip 名；T-Pose 为 null */
  clip: string | null
  kind: ActionKind
  /** 动作原始时长（秒）；T-Pose 为 0 */
  durationSec: number
  tags: readonly string[]
  /** 加进时间轴时的默认片段时长（秒） */
  defaultDuration: number
}

/** 时长不超过它的非循环动作当单姿势（UAL 的 Pistol_Aim_* 只有 0.16s，实为一个姿势） */
const POSE_MAX_SECONDS = 0.2
/** 列表按「最常用先出现」分组：取动作第一个命中的标签在这里的位置 */
const DISPLAY_GROUPS = ['idle', 'dialogue', 'walk', 'jog', 'sprint', 'crouch', 'sit', 'interact', 'jump', 'roll', 'swim', 'emote', 'vehicle', 'hit', 'fall', 'punch', 'pistol', 'sword', 'spell']
const groupOf = (tags: readonly string[]) => {
  const index = DISPLAY_GROUPS.findIndex((group) => tags.includes(group))
  return index === -1 ? DISPLAY_GROUPS.length : index
}

function entryFromUal(meta: (typeof UAL_ACTIONS)[number]): ActionLibraryEntry {
  // Sword_Idle 元数据标 loop:false 却是待机：带 idle 标签的一律按循环（施工计划 §11 第 8 条）
  const loop = meta.loop || meta.tags.includes('idle')
  const kind: ActionKind = loop ? 'loop' : meta.durationSec <= POSE_MAX_SECONDS ? 'pose' : 'once'
  return { id: meta.id, clip: meta.id, kind, durationSec: meta.durationSec, tags: meta.tags, defaultDuration: kind === 'once' ? Math.max(2, Math.ceil(meta.durationSec)) : kind === 'pose' ? 2 : 4 }
}

export const ACTION_LIBRARY: readonly ActionLibraryEntry[] = [
  { id: T_POSE_ACTION_ID, clip: null, kind: 'pose', durationSec: 0, tags: [], defaultDuration: 2 },
  ...UAL_ACTIONS.filter((meta) => !meta.rootMotion)
    .map(entryFromUal)
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => groupOf(a.entry.tags) - groupOf(b.entry.tags) || a.order - b.order)
    .map(({ entry }) => entry),
]

/**
 * 换 UAL 前（Mixamo 9 动作）的旧 id 里，UAL 没有对应、只能落到相近动作的那几个：读档迁移计数后用 toast 告诉用户（施工计划 §3）。
 * 坐地上 → 蹲；单膝 / 双膝跪、下跪 → 跪地维修；跪起身 → 待机。
 */
export const LEGACY_APPROXIMATE_ACTIONS: ReadonlySet<string> = new Set(['male_sitting_pose', 'kneeling', 'kneeling_idle', 'kneeling_down', 'standing_up'])

// 自然语言 / AI / 旧动作 id 的别名（含中文）：小写、去空格后匹配。动作 id 本身大小写不敏感，不用在这里重复写
export const ACTION_ALIASES: Record<string, string> = {
  // 旧 Mixamo 动作 id（读档迁移走同一张表）
  standing_idle: 'Idle_Loop',
  standard_walk: 'Walk_Loop',
  running: 'Jog_Fwd_Loop',
  male_sitting_pose_1: 'Sitting_Idle_Loop',
  male_sitting_pose: 'Crouch_Idle_Loop',
  kneeling: 'Fixing_Kneeling',
  kneeling_idle: 'Fixing_Kneeling',
  kneeling_down: 'Fixing_Kneeling',
  standing_up: 'Idle_Loop',
  // 英文
  idle: 'Idle_Loop',
  stand: 'Idle_Loop',
  standing: 'Idle_Loop',
  basic_standing: 'Idle_Loop',
  basic_standing_2: 'Idle_Loop',
  talk: 'Idle_Talking_Loop',
  talking: 'Idle_Talking_Loop',
  walk: 'Walk_Loop',
  walking: 'Walk_Loop',
  formal_walk: 'Walk_Formal_Loop',
  run: 'Jog_Fwd_Loop',
  jog: 'Jog_Fwd_Loop',
  jogging: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  sprint_start: 'Sprint_Loop',
  chase: 'Sprint_Loop',
  sit: 'Sitting_Idle_Loop',
  sitting: 'Sitting_Idle_Loop',
  basic_sitting: 'Sitting_Idle_Loop',
  sitting_talking: 'Sitting_Talking_Loop',
  crouch: 'Crouch_Idle_Loop',
  sit_ground: 'Crouch_Idle_Loop',
  sitting_on_ground: 'Crouch_Idle_Loop',
  kneel: 'Fixing_Kneeling',
  hit: 'Hit_Chest',
  fall: 'Death01',
  death: 'Death01',
  jump: 'Jump_Start',
  roll: 'Roll',
  dance: 'Dance_Loop',
  drive: 'Driving_Loop',
  driving: 'Driving_Loop',
  swim: 'Swim_Fwd_Loop',
  push: 'Push_Loop',
  pick_up: 'PickUp_Table',
  pickup: 'PickUp_Table',
  interact: 'Interact',
  punch: 'Punch_Jab',
  shoot: 'Pistol_Shoot',
  aim: 'Pistol_Aim_Neutral',
  sword: 'Sword_Attack',
  cast: 'Spell_Simple_Shoot',
  't-pose': T_POSE_ACTION_ID,
  // 中文
  站立: 'Idle_Loop',
  站着: 'Idle_Loop',
  待机: 'Idle_Loop',
  说话: 'Idle_Talking_Loop',
  对话: 'Idle_Talking_Loop',
  行走: 'Walk_Loop',
  走: 'Walk_Loop',
  走路: 'Walk_Loop',
  跑: 'Jog_Fwd_Loop',
  跑步: 'Jog_Fwd_Loop',
  慢跑: 'Jog_Fwd_Loop',
  奔跑: 'Sprint_Loop',
  冲刺: 'Sprint_Loop',
  追: 'Sprint_Loop',
  追逐: 'Sprint_Loop',
  坐: 'Sitting_Idle_Loop',
  坐下: 'Sitting_Enter',
  坐姿: 'Sitting_Idle_Loop',
  坐着说话: 'Sitting_Talking_Loop',
  起身: 'Sitting_Exit',
  站起来: 'Sitting_Exit',
  蹲: 'Crouch_Idle_Loop',
  蹲下: 'Crouch_Idle_Loop',
  坐地上: 'Crouch_Idle_Loop',
  席地而坐: 'Crouch_Idle_Loop',
  跪: 'Fixing_Kneeling',
  跪下: 'Fixing_Kneeling',
  跪地: 'Fixing_Kneeling',
  单膝跪: 'Fixing_Kneeling',
  单膝跪地: 'Fixing_Kneeling',
  双膝跪: 'Fixing_Kneeling',
  双膝跪地: 'Fixing_Kneeling',
  受击: 'Hit_Chest',
  被打: 'Hit_Chest',
  倒地: 'Death01',
  摔倒: 'Death01',
  死亡: 'Death01',
  跳: 'Jump_Start',
  跳跃: 'Jump_Start',
  翻滚: 'Roll',
  跳舞: 'Dance_Loop',
  开车: 'Driving_Loop',
  驾驶: 'Driving_Loop',
  游泳: 'Swim_Fwd_Loop',
  推: 'Push_Loop',
  捡: 'PickUp_Table',
  拿起: 'PickUp_Table',
  交互: 'Interact',
  出拳: 'Punch_Jab',
  打拳: 'Punch_Jab',
  开枪: 'Pistol_Shoot',
  射击: 'Pistol_Shoot',
  瞄准: 'Pistol_Aim_Neutral',
  挥剑: 'Sword_Attack',
  施法: 'Spell_Simple_Shoot',
  T型: T_POSE_ACTION_ID,
  T字: T_POSE_ACTION_ID,
}

/** V1 手写姿态预设 id → 动作库 id（无对应 → undefined，迁移时只烘 boneRotations） */
export const LEGACY_POSE_TO_ACTION: Record<string, string> = {
  standing: 'Idle_Loop',
  't-pose': T_POSE_ACTION_ID,
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  sit: 'Sitting_Idle_Loop',
  'single-knee': 'Fixing_Kneeling',
  'double-knee': 'Fixing_Kneeling',
}

export function legacyPoseToAction(presetId: string | undefined): string | undefined {
  return presetId ? LEGACY_POSE_TO_ACTION[presetId] : undefined
}

export function findActionEntry(id: string): ActionLibraryEntry | undefined {
  const direct = ACTION_LIBRARY.find((entry) => entry.id === id)
  if (direct) return direct
  const alias = ACTION_ALIASES[id] ?? ACTION_ALIASES[id.trim().toLowerCase()]
  return alias ? ACTION_LIBRARY.find((entry) => entry.id === alias) : undefined
}

const BY_LOWER_ID = new Map(ACTION_LIBRARY.map((entry) => [entry.id.toLowerCase(), entry]))

/** 动作 id（大小写不敏感）→ 条目；否则查别名；都没有 → undefined */
export function resolveActionAlias(text: string): ActionLibraryEntry | undefined {
  const key = text.trim().toLowerCase().replace(/\s+/g, '')
  const direct = BY_LOWER_ID.get(key)
  if (direct) return direct
  const alias = ACTION_ALIASES[key] ?? ACTION_ALIASES[text.trim().replace(/\s+/g, '')]
  return alias ? findActionEntry(alias) : undefined
}

/**
 * 规划器提示词里列给模型的常用动作（施工计划 §2：只列 12–16 个，43 个全列会涨提示词也让小模型乱选）。
 * 按「动作词」写、经别名表解析成库里的 id——库换了这里跟着换，不手抄 id；别名缺了在模块加载时就炸（单测钉住）；放在文件末尾，等 resolveActionAlias 依赖的表都建好。
 */
const PLANNER_ACTION_WORDS = ['idle', 'talk', 'walk', 'run', 'sprint', 'sit', 'sitting_talking', 'crouch', 'kneel', 'hit', 'fall', 'jump', 'interact', 'pick_up', 't-pose']
export const PLANNER_ACTION_IDS: readonly string[] = PLANNER_ACTION_WORDS.map((word) => {
  const entry = resolveActionAlias(word)
  if (!entry) throw new Error(`planner action word has no library entry: ${word}`)
  return entry.id
})

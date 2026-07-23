import * as THREE from 'three'
import type { Scene3DVector3 } from './scene3dTypes'

export type CrowdAddOptions = {
  rows: number
  columns: number
  spacing: number
}

export type MannequinPoseControl = {
  axisIndex: 0 | 1 | 2
  baseOffsetDeg?: number
  bone: string
  label: string
  max?: number
  min?: number
  standingValue: number
  valueScale?: number
}

export type MannequinPoseSection =
  | {
    title: string
    controls: MannequinPoseControl[]
    groups?: never
  }
  | {
    title: string
    controls?: never
    groups: Array<{
      title: string
      controls: MannequinPoseControl[]
    }>
  }

export type MannequinPosePreset = {
  id: string
  label: string
  pose?: Record<string, Scene3DVector3>
}

export type Scene3DMovementCode =
  | 'KeyW'
  | 'KeyA'
  | 'KeyS'
  | 'KeyD'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Space'
  | 'ShiftLeft'
  | 'ShiftRight'

export function radiansToDegrees(value: number): number {
  return Number(THREE.MathUtils.radToDeg(value).toFixed(1))
}

export function degreesToRadians(value: number): number {
  return Number(THREE.MathUtils.degToRad(value).toFixed(4))
}

export function makePoseOffset(values: Record<string, Scene3DVector3>): Record<string, Scene3DVector3> {
  return Object.fromEntries(
    Object.entries(values).map(([boneName, rotation]) => [
      boneName,
      rotation.map((value) => degreesToRadians(value)) as Scene3DVector3,
    ]),
  )
}

export const MOVEMENT_CODES = new Set<string>([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
])

export const OBJECT_LIMIT = 100
export const SCENE3D_EDITOR_ONLY_FLAG = 'scene3dCameraHelper'
export const SCENE3D_GRID_FLAG = 'scene3dGridHelper'
export const SCENE3D_RUNTIME_ID_KEY = 'scene3dId'
// 全屏编辑器需盖过工作台常规 UI（≤2000 区间），但必须低于全局模态层（3400+：付费确认 3500、
// 库面板 4000、灯箱 4200）与反馈层（src/ui/feedbackLayer.ts）——曾设 int32 最大值，导致编辑器
// 打开期间 toast/付费确认全部被压在底下不可见。不变量测试见 src/ui/feedbackLayer.test.ts。
export const FULLSCREEN_Z_INDEX = 3000
export const CAMERA_MARKER_COLOR = '#8b5e34'
export const CAMERA_MARKER_ACCENT_COLOR = '#a97946'
export const CAMERA_HELPER_VISUAL_FAR = 1.2
export const CAMERA_AIM_FEEDBACK_LENGTH = 1.45
export const CAMERA_AIM_HANDLE_DISTANCE = 0.42
export const CAMERA_DEFAULT_TARGET: Scene3DVector3 = [0, 0.75, 0]
export const OBJECT_GROUND_GUIDE_ELEVATION = 0.018
export const MANNEQUIN_FOOT_RING_COLOR = '#3b82f6'
export const MANNEQUIN_DEFAULT_SCALE: Scene3DVector3 = [2.5, 2.5, 2.5]
export const MANNEQUIN_LABEL_BASE_HEIGHT = 0.58
export const ROLE_COLOR_SEQUENCE = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#06b6d4', '#ec4899'] as const
export const CROWD_MAX_AXIS = 10
export const CROWD_DETAILED_MODEL_LIMIT = 4
export const CROWD_INSTANCED_GEOMETRY_SEGMENTS = 12
export const CROWD_FOOT_RING_SEGMENTS = 48
export const FREE_LOOK_ROTATION_SPEED = 0.003
export const WHEEL_TRAVEL_SPEED = 0.0045
// #3 续：录制/操控态绕拍角色时，给 OrbitControls 俯仰角(polar angle)夹一个「电影构图带」。
// OrbitControls polar：0=正俯视(头顶)、π/2=水平平视、π=正仰视(脚底)。横向方位角(绕圈)不夹=创作目标手感不变；
// 只夹竖向两极——猛拖向下会把相机绕到角色下方仰视(polar→π)→角色被顶出画面上边/只剩腿(用户实测痛点)；
// 反向猛拖向上会绕到正俯视(polar→0)→角色缩成头顶一点。夹在「中高俯角~近水平仰角」之间，
// 主体始终留在画面内。退出操控/录制 = 不传这俩界(undefined)→ OrbitControls 默认 [0,π] 无约束(零回归自由 orbit)。
// 取值是从「保住站立主体取景」推的：上界 ≈ 26°(从竖直起算的中高俯角，不到正俯视鸟瞰)、
// 下界 ≈ 100°(略过水平的低角度，留一点仰拍英雄镜空间，但远不到贴地正仰视的脚底视角)。
// 痛点正是「猛拖向下把相机绕到角色下方仰视(polar→π)→角色顶出上边/只剩腿」，这条下界把它夹死。
export const FOLLOW_ORBIT_MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(26)
export const FOLLOW_ORBIT_MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(100)
export const CAMERA_LENS_DEPTH_MAX_FACTOR = 0.85
export const MANNEQUIN_MODEL_URL = new URL('../../../../assets/x-bot.glb', import.meta.url).href
// 假人 locomotion 动画 clip（idle/walk/run 等）的来源。和 x-bot 同骨架（mixamorig: 带冒号），
// 这里只用它的 animations，几何/蒙皮仍来自 x-bot。建议后续把它剥成纯动画（去掉冗余 mesh）减体积。
export const MANNEQUIN_ANIMATION_URL = new URL('../../../../assets/mannequin-animations.glb', import.meta.url).href

// possess 态自动 locomotion：clip 名（须与 mannequin-animations.glb 内 clip 名逐字一致）。
export type Scene3DLocomotionClip = 'idle' | 'walk' | 'run'
export const LOCOMOTION_CLIP_IDLE: Scene3DLocomotionClip = 'idle'
export const LOCOMOTION_CLIP_WALK: Scene3DLocomotionClip = 'walk'
export const LOCOMOTION_CLIP_RUN: Scene3DLocomotionClip = 'run'
// 由「角色地面速度(米/秒)」分桶到 locomotion clip 的阈值。低于 walk 阈值 = 站立(idle)；
// 超过 run 阈值 = 奔跑。地面速度由 header「速度」滑块经 groundSpeedForFlySpeed 派生（≈1.2~6.0 m/s）：
// 低档落在 walk 段、中高档越过 run 阈值触发奔跑；walk 门设在「确实在动」的微小正速度之上。
export const LOCOMOTION_WALK_SPEED_THRESHOLD = 0.05
export const LOCOMOTION_RUN_SPEED_THRESHOLD = 3.2
// crossFade 时长(秒)：clip 切换的平滑过渡。
export const LOCOMOTION_CROSSFADE_SECONDS = 0.22
export const SCENE3D_LIGHT_BACKGROUND = '#f6f3ee'
export const SCENE3D_DARK_BACKGROUND = '#111827'
export const SPHERE_RADIUS_DEFAULT = 50
export const SPHERE_RADIUS_MIN = 10
export const SPHERE_RADIUS_MAX = 200
export const GRID_CELL_COLOR = '#94a3b8'
export const GRID_SECTION_COLOR = '#64748b'
export const DARK_GRID_CELL_COLOR = '#475569'
export const DARK_GRID_SECTION_COLOR = '#94a3b8'
export const CLIPBOARD_PASTE_OFFSET: Scene3DVector3 = [0.45, 0, 0.45]
export const MANNEQUIN_REST_ROTATION_KEY = 'scene3dRestRotation'
export const UNGROUPED_TRAJECTORY_GROUP_ID = '__ungrouped_trajectories__'
export const CAMERA_AIM_HANDLE_POSITIONS = new Float32Array([
  -0.14, 0, 0,
  0.14, 0, 0,
  0, -0.14, 0,
  0, 0.14, 0,
])

export const MANNEQUIN_DEFAULT_POSE: Record<string, Scene3DVector3> = {
  mixamorigSpine: [degreesToRadians(2), 0, 0],
  // 头颈基线：x-bot bind 头颈天然前倾（度量核实测默认头前俯 18.8°，人眼即「垂头丧气」G1）。
  // 分摊到颈+头两节抬回自然平视（poseMetrics neckPitchFwd 目标 ≈ +2°～+6°）；轴向实测 −x = 抬头。
  mixamorigNeck: [degreesToRadians(-8), 0, 0],
  mixamorigHead: [degreesToRadians(-10), 0, 0],
  mixamorigLeftArm: [degreesToRadians(67.5), degreesToRadians(11.4), degreesToRadians(-6.8)],
  mixamorigRightArm: [degreesToRadians(67.5), degreesToRadians(-11.4), degreesToRadians(6.8)],
  mixamorigLeftForeArm: [degreesToRadians(8), degreesToRadians(-4), 0],
  mixamorigRightForeArm: [degreesToRadians(8), degreesToRadians(4), 0],
  mixamorigLeftHand: [degreesToRadians(6), 0, degreesToRadians(-8)],
  mixamorigRightHand: [degreesToRadians(6), 0, degreesToRadians(8)],
}

export const MANNEQUIN_POSE_SECTIONS: MannequinPoseSection[] = [
  {
    title: '身体',
    controls: [
      { bone: 'mixamorigHips', axisIndex: 0, label: '前倾', standingValue: 0 },
      { bone: 'mixamorigHips', axisIndex: 1, label: '转身', standingValue: 0 },
      { bone: 'mixamorigHips', axisIndex: 2, label: '侧倾', standingValue: 0 },
    ],
  },
  {
    title: '躯干',
    controls: [
      { bone: 'mixamorigSpine', axisIndex: 0, label: '前倾', standingValue: 2, baseOffsetDeg: 2 },
      { bone: 'mixamorigSpine', axisIndex: 1, label: '扭转', standingValue: 0 },
      { bone: 'mixamorigSpine', axisIndex: 2, label: '侧倾', standingValue: 0 },
    ],
  },
  {
    title: '头部',
    controls: [
      { bone: 'mixamorigHead', axisIndex: 0, label: '点头', standingValue: -10, baseOffsetDeg: -10 },
      { bone: 'mixamorigHead', axisIndex: 1, label: '转头', standingValue: 0 },
      { bone: 'mixamorigHead', axisIndex: 2, label: '歪头', standingValue: 0 },
    ],
  },
  {
    title: '手臂—肩',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftArm', axisIndex: 0, label: '前举', standingValue: -5, baseOffsetDeg: 74 },
          { bone: 'mixamorigLeftArm', axisIndex: 1, label: '外展', standingValue: 7, baseOffsetDeg: 2 },
          { bone: 'mixamorigLeftArm', axisIndex: 2, label: '扭转', standingValue: 0, baseOffsetDeg: -4 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightArm', axisIndex: 0, label: '前举', standingValue: -5, baseOffsetDeg: 74 },
          { bone: 'mixamorigRightArm', axisIndex: 1, label: '外展', standingValue: 7, baseOffsetDeg: -2, valueScale: -1 },
          { bone: 'mixamorigRightArm', axisIndex: 2, label: '扭转', standingValue: 0, baseOffsetDeg: 4 },
        ],
      },
    ],
  },
  {
    title: '肘部',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftForeArm', axisIndex: 0, label: '弯曲', standingValue: 10, baseOffsetDeg: 10 },
          { bone: 'mixamorigLeftForeArm', axisIndex: 1, label: '内收', standingValue: -8, baseOffsetDeg: -8 },
          { bone: 'mixamorigLeftForeArm', axisIndex: 2, label: '扭转', standingValue: 0 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightForeArm', axisIndex: 0, label: '弯曲', standingValue: 10, baseOffsetDeg: 10 },
          { bone: 'mixamorigRightForeArm', axisIndex: 1, label: '内收', standingValue: -8, baseOffsetDeg: 8, valueScale: -1 },
          { bone: 'mixamorigRightForeArm', axisIndex: 2, label: '扭转', standingValue: 0 },
        ],
      },
    ],
  },
  {
    title: '手腕',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftHand', axisIndex: 0, label: '下压', standingValue: 6, baseOffsetDeg: 6 },
          { bone: 'mixamorigLeftHand', axisIndex: 1, label: '侧摆', standingValue: 0 },
          { bone: 'mixamorigLeftHand', axisIndex: 2, label: '放松', standingValue: -8, baseOffsetDeg: -8 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightHand', axisIndex: 0, label: '下压', standingValue: 6, baseOffsetDeg: 6 },
          { bone: 'mixamorigRightHand', axisIndex: 1, label: '侧摆', standingValue: 0 },
          { bone: 'mixamorigRightHand', axisIndex: 2, label: '放松', standingValue: -8, baseOffsetDeg: 8, valueScale: -1 },
        ],
      },
    ],
  },
  {
    title: '大腿',
    groups: [
      {
        title: '左',
        controls: [
          { bone: 'mixamorigLeftUpLeg', axisIndex: 0, label: '前摆', standingValue: 0, min: -90, max: 120 },
          { bone: 'mixamorigLeftUpLeg', axisIndex: 1, label: '外展', standingValue: 0, min: -60, max: 60 },
        ],
      },
      {
        title: '右',
        controls: [
          { bone: 'mixamorigRightUpLeg', axisIndex: 0, label: '前摆', standingValue: 0, min: -90, max: 120 },
          { bone: 'mixamorigRightUpLeg', axisIndex: 1, label: '外展', standingValue: 0, valueScale: -1, min: -60, max: 60 },
        ],
      },
    ],
  },
  {
    title: '膝盖',
    groups: [
      {
        title: '左',
        controls: [{ bone: 'mixamorigLeftLeg', axisIndex: 0, label: '弯曲', standingValue: 0, min: -10, max: 150 }],
      },
      {
        title: '右',
        controls: [{ bone: 'mixamorigRightLeg', axisIndex: 0, label: '弯曲', standingValue: 0, min: -10, max: 150 }],
      },
    ],
  },
  {
    title: '脚踝',
    groups: [
      {
        title: '左',
        controls: [{ bone: 'mixamorigLeftFoot', axisIndex: 0, label: '勾绷', standingValue: 0, min: -60, max: 70 }],
      },
      {
        title: '右',
        controls: [{ bone: 'mixamorigRightFoot', axisIndex: 0, label: '勾绷', standingValue: 0, min: -60, max: 70 }],
      },
    ],
  },
]

export const MANNEQUIN_POSE_MIN_DEG = -90
export const MANNEQUIN_POSE_MAX_DEG = 90

export const MANNEQUIN_POSE_PRESETS: MannequinPosePreset[] = [
  {
    id: 'standing',
    label: '站立',
  },
  {
    id: 't-pose',
    label: 'T型',
    pose: makePoseOffset({
      mixamorigSpine: [-2, 0, 0],
      mixamorigHead: [2, 0, 0],
      mixamorigLeftArm: [-67.5, -11.4, 6.8],
      mixamorigRightArm: [-67.5, 11.4, -6.8],
      mixamorigLeftForeArm: [-8, 4, 0],
      mixamorigRightForeArm: [-8, -4, 0],
      mixamorigLeftHand: [-6, 0, 8],
      mixamorigRightHand: [-6, 0, -8],
    }),
  },
  {
    id: 'walk',
    label: '行走',
    pose: makePoseOffset({
      mixamorigHips: [0, -6, 0],
      mixamorigSpine: [2, 4, 0],
      mixamorigLeftArm: [22, -4, 2],
      mixamorigRightArm: [-18, 4, -2],
      mixamorigLeftForeArm: [12, -3, 0],
      mixamorigRightForeArm: [16, 3, 0],
      mixamorigLeftUpLeg: [-28, 0, 0],
      mixamorigLeftLeg: [20, 0, 0],
      mixamorigRightUpLeg: [22, 0, 0],
      mixamorigRightLeg: [8, 0, 0],
    }),
  },
  {
    id: 'run',
    label: '跑步',
    pose: makePoseOffset({
      mixamorigHips: [8, -8, 0],
      mixamorigSpine: [10, 5, 0],
      mixamorigHead: [-2, 0, 0],
      mixamorigLeftArm: [44, -16, 4],
      mixamorigRightArm: [-32, 16, -4],
      mixamorigLeftForeArm: [42, -4, 0],
      mixamorigRightForeArm: [48, 4, 0],
      mixamorigLeftUpLeg: [-44, 0, 0],
      mixamorigLeftLeg: [42, 0, 0],
      mixamorigRightUpLeg: [34, 0, 0],
      mixamorigRightLeg: [26, 0, 0],
      mixamorigLeftFoot: [-10, 0, 0],
      mixamorigRightFoot: [10, 0, 0],
    }),
  },
  {
    id: 'sit',
    label: '坐姿',
    // 椅面坐姿：大腿近水平、小腿垂直、脚掌踩平；双臂微屈落在大腿两侧。
    // 2026-07-05 用 pose-lab 多视角复核，避免坐姿看起来像深蹲或手臂空垂穿腿。
    pose: makePoseOffset({
      mixamorigSpine: [4, 0, 0],
      // 肘外张 + 前臂少屈：手落在大腿外上方而非插进大腿（度量核胶囊层曾抓出前臂×大腿穿插 85%）。
      mixamorigLeftArm: [-4, -14, 0],
      mixamorigRightArm: [-4, 14, 0],
      mixamorigLeftForeArm: [46, -6, 0],
      mixamorigRightForeArm: [46, 6, 0],
      mixamorigLeftHand: [2, 0, -4],
      mixamorigRightHand: [2, 0, 4],
      mixamorigLeftUpLeg: [86, 4, 0],
      mixamorigRightUpLeg: [86, -4, 0],
      mixamorigLeftLeg: [94, 0, 0],
      mixamorigRightLeg: [94, 0, 0],
      mixamorigLeftFoot: [-14, 0, 0],
      mixamorigRightFoot: [-14, 0, 0],
    }),
  },
  {
    id: 'squat',
    label: '蹲下',
    // 深蹲：髋/膝深屈、躯干前倾、脚掌踩平。
    // ⚠️ 脚轴向（poseMetrics 实测锚定）：mixamorigFoot +x = 背屈（脚尖上翘）/ −x = 跖屈（绷脚）。
    // 旧值 Foot −42 实为绷脚 42° → 脚跟离地 2.6% 身高、重心前出支撑面 10.5%（度量核抓出）；
    // 深蹲小腿前倾 ≈30°，鞋底踩平需要背屈 +32。肘略外张让手垂在膝前，不插进大腿。
    pose: makePoseOffset({
      mixamorigHips: [-6, 0, 0],
      mixamorigSpine: [20, 0, 0],
      mixamorigHead: [-6, 0, 0],
      mixamorigLeftArm: [12, 28, 0],
      mixamorigRightArm: [12, -28, 0],
      mixamorigLeftForeArm: [44, -8, 0],
      mixamorigRightForeArm: [44, 8, 0],
      mixamorigLeftUpLeg: [98, 8, 0],
      mixamorigRightUpLeg: [98, -8, 0],
      mixamorigLeftLeg: [124, 0, 0],
      mixamorigRightLeg: [124, 0, 0],
      mixamorigLeftFoot: [-26, 0, 0],
      mixamorigRightFoot: [-26, 0, 0],
    }),
  },
  {
    // 游戏式操控 C 键专用「半蹲」（区别于上面的点击式深蹲 squat，两者是不同动作，P1/P4 各有一份数据源）。
    // 目标：髋/膝屈到大约一半、上身**基本直立**、脚掌**踩平**、重心稳、看着「随时能走/起身」——不是压在膝上的深蹲。
    // 多视角侧视校准（pose-lab side view）得到的关键规律：
    //  ① 上身要**略前倾**(Spine +12)——肩膀落在脚上方偏前才像自然半蹲/预备姿势；后仰(负值)会变「往后坐要摔倒」(用户实测「蹲反了」)、
    //     大幅前倾(如深蹲 +26)又会折成「深鞠躬」。+12 是「直立带一点前倾」的中间态。
    //  ② 膝屈(Leg) 明显大于髋屈(UpLeg)：把重心压低而不是把臀往后坐；
    //  ③ 膝一弯小腿前倾，脚必须大幅**背屈**才能整只脚掌踩平——背屈不够就踮脚尖。
    //     ⚠️ 脚轴向（poseMetrics 实测锚定）：+x = 背屈（脚尖上翘）/ −x = 跖屈。旧值 −34 写反了方向。
    //  ④ Hips 不动（它是骨架根，动了整体歪身，蹲会变成坐/后仰）。蒙皮最低点自动落地(scene3dMath)。
    id: 'crouch',
    label: '半蹲',
    pose: makePoseOffset({
      mixamorigHips: [-4, 0, 0],
      mixamorigSpine: [16, 0, 0],
      mixamorigHead: [-5, 0, 0],
      mixamorigLeftArm: [8, -4, 0],
      mixamorigRightArm: [8, 4, 0],
      mixamorigLeftUpLeg: [58, 5, 0],
      mixamorigRightUpLeg: [58, -5, 0],
      mixamorigLeftLeg: [80, 0, 0],
      mixamorigRightLeg: [80, 0, 0],
      mixamorigLeftFoot: [-26, 0, 0],
      mixamorigRightFoot: [-26, 0, 0],
    }),
  },
  {
    id: 'single-knee',
    label: '单膝跪',
    // 前腿(左)：大腿近水平、小腿近垂直、脚掌踩平。后腿(右)：大腿近垂直略后、膝着地、小腿向后**平贴地面**、
    // 脚背贴地（= 大幅跖屈）。
    // ⚠️ 脚轴向（poseMetrics 实测锚定）：+x = 背屈（脚尖上翘）/ −x = 跖屈（脚背压平）。
    // 旧值 Foot +74 实为把脚尖朝上抬 → 后小腿离地 10.7% 身高、整条后腿悬空（度量核抓出）。
    // 后小腿要横平：膝屈 ≈ 90°+大腿后倾量（Leg 96 配 UpLeg −8）。
    pose: makePoseOffset({
      mixamorigHips: [-4, 0, 0],
      mixamorigSpine: [5, 0, 0],
      mixamorigLeftUpLeg: [76, 4, 0],
      mixamorigLeftLeg: [88, 0, 0],
      mixamorigLeftFoot: [-20, 0, 0],
      mixamorigRightUpLeg: [8, -2, 0],
      mixamorigRightLeg: [80, 0, 0],
      mixamorigRightFoot: [-54, 0, 0],
    }),
  },
  {
    id: 'double-knee',
    label: '双膝跪',
    // 直身双膝跪（非跪坐/趴伏）：大腿近垂直略后，小腿向后平贴地、脚背贴地。
    // ⚠️ 脚轴向（poseMetrics 实测锚定）：+x = 背屈 / −x = 跖屈；旧值 +66 把脚尖朝上抬
    // → 双脚背离地 35.7% 身高（度量核抓出）。小腿横平：Leg ≈ 90°+大腿后倾量。
    pose: makePoseOffset({
      mixamorigHips: [-4, 0, 0],
      mixamorigSpine: [6, 0, 0],
      mixamorigLeftUpLeg: [8, 4, 0],
      mixamorigRightUpLeg: [8, -4, 0],
      mixamorigLeftLeg: [96, 0, 0],
      mixamorigRightLeg: [96, 0, 0],
      mixamorigLeftFoot: [-54, 0, 0],
      mixamorigRightFoot: [-54, 0, 0],
    }),
  },
  {
    id: 'hands-on-hips',
    label: '叉腰',
    pose: makePoseOffset({
      mixamorigLeftArm: [-28, 0, 0],
      mixamorigRightArm: [-28, 0, 0],
      mixamorigLeftForeArm: [102, 0, 0],
      mixamorigRightForeArm: [102, 0, 0],
    }),
  },
  {
    id: 'point',
    label: '指向',
    pose: makePoseOffset({
      mixamorigRightArm: [-76, 30, -8],
      mixamorigRightForeArm: [8, 0, 0],
      mixamorigRightHand: [-4, 0, 6],
    }),
  },
  {
    id: 'wave',
    label: '举手',
    pose: makePoseOffset({
      mixamorigRightArm: [-148, 10, -4],
      mixamorigRightForeArm: [28, 0, 8],
      mixamorigRightHand: [-8, 0, 10],
    }),
  },
  {
    id: 'cheer',
    label: '举双手',
    pose: makePoseOffset({
      mixamorigLeftArm: [-138, -18, 8],
      mixamorigRightArm: [-138, 18, -8],
      mixamorigLeftForeArm: [18, 0, -4],
      mixamorigRightForeArm: [18, 0, 4],
    }),
  },
]

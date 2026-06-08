// Scene3D 常量与姿态数据。
// 从 Scene3DFullscreen.tsx 抽出（纯数据 + 构建数据所需的 degreesToRadians/makePoseOffset），
// 单向依赖：scene3dMath.ts → scene3dConstants.ts（构建器内置于此，避免与 math 形成循环依赖）。
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

// 姿态数据构建器。内置于此以保持 constants 自洽，math 反向依赖这两个函数。
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
export const CAMERA_HELPER_FLAG = 'scene3dCameraHelper'
export const SCENE3D_GRID_FLAG = 'scene3dGridHelper'
export const FULLSCREEN_Z_INDEX = 2147483647
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
export const ROLE_COLOR_SEQUENCE = ['#ef4444', '#facc15', '#3b82f6', '#22c55e'] as const
export const CROWD_MAX_AXIS = 10
export const CROWD_DETAILED_MODEL_LIMIT = 4
export const CROWD_INSTANCED_GEOMETRY_SEGMENTS = 12
export const CROWD_FOOT_RING_SEGMENTS = 48
export const FREE_LOOK_ROTATION_SPEED = 0.003
export const WHEEL_TRAVEL_SPEED = 0.0045
export const CAMERA_LENS_DEPTH_MAX_FACTOR = 0.85
export const MANNEQUIN_MODEL_URL = new URL('../../../../assets/x-bot.glb', import.meta.url).href
export const SCENE3D_LIGHT_BACKGROUND = '#f6f3ee'
export const SCENE3D_DARK_BACKGROUND = '#111827'
export const GRID_CELL_COLOR = '#94a3b8'
export const GRID_SECTION_COLOR = '#64748b'
export const DARK_GRID_CELL_COLOR = '#475569'
export const DARK_GRID_SECTION_COLOR = '#94a3b8'
export const CLIPBOARD_PASTE_OFFSET: Scene3DVector3 = [0.45, 0, 0.45]
export const MANNEQUIN_REST_ROTATION_KEY = 'scene3dRestRotation'

export const MANNEQUIN_DEFAULT_POSE: Record<string, Scene3DVector3> = {
  mixamorigSpine: [degreesToRadians(2), 0, 0],
  mixamorigHead: [degreesToRadians(-10), 0, 0],
  mixamorigLeftArm: [degreesToRadians(74), degreesToRadians(2), degreesToRadians(-4)],
  mixamorigRightArm: [degreesToRadians(74), degreesToRadians(-2), degreesToRadians(4)],
  mixamorigLeftForeArm: [degreesToRadians(10), degreesToRadians(-8), 0],
  mixamorigRightForeArm: [degreesToRadians(10), degreesToRadians(8), 0],
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
      mixamorigHead: [10, 0, 0],
      mixamorigLeftArm: [-74, -2, 4],
      mixamorigRightArm: [-74, 2, -4],
      mixamorigLeftForeArm: [-10, 8, 0],
      mixamorigRightForeArm: [-10, -8, 0],
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
      mixamorigHead: [6, 0, 0],
      mixamorigLeftArm: [44, -10, 4],
      mixamorigRightArm: [-32, 10, -4],
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
    pose: makePoseOffset({
      mixamorigHips: [-6, 0, 0],
      mixamorigSpine: [6, 0, 0],
      mixamorigLeftArm: [4, -16, 8],
      mixamorigRightArm: [4, 16, -8],
      mixamorigLeftForeArm: [12, -8, 0],
      mixamorigRightForeArm: [12, 8, 0],
      mixamorigLeftHand: [-2, 0, -6],
      mixamorigRightHand: [-2, 0, 6],
      mixamorigLeftUpLeg: [-68, 4, 0],
      mixamorigRightUpLeg: [-68, -4, 0],
      mixamorigLeftLeg: [-72, 0, 0],
      mixamorigRightLeg: [-72, 0, 0],
      mixamorigLeftFoot: [10, 0, 0],
      mixamorigRightFoot: [10, 0, 0],
    }),
  },
  {
    id: 'squat',
    label: '蹲下',
    pose: makePoseOffset({
      mixamorigHips: [-24, 0, 0],
      mixamorigSpine: [14, 0, 0],
      mixamorigHead: [8, 0, 0],
      mixamorigLeftArm: [18, -8, 2],
      mixamorigRightArm: [18, 8, -2],
      mixamorigLeftForeArm: [30, -6, 0],
      mixamorigRightForeArm: [30, 6, 0],
      mixamorigLeftUpLeg: [68, 0, 0],
      mixamorigRightUpLeg: [68, 0, 0],
      mixamorigLeftLeg: [-96, 0, 0],
      mixamorigRightLeg: [-96, 0, 0],
      mixamorigLeftFoot: [34, 0, 0],
      mixamorigRightFoot: [34, 0, 0],
    }),
  },
  {
    id: 'single-knee',
    label: '单膝跪',
    pose: makePoseOffset({
      mixamorigHips: [-16, 0, 0],
      mixamorigSpine: [10, 0, 0],
      mixamorigLeftArm: [16, -6, 2],
      mixamorigRightArm: [10, 6, -2],
      mixamorigLeftForeArm: [28, -4, 0],
      mixamorigRightForeArm: [22, 4, 0],
      mixamorigLeftUpLeg: [70, 0, 0],
      mixamorigLeftLeg: [-72, 0, 0],
      mixamorigRightUpLeg: [18, 0, 0],
      mixamorigRightLeg: [-108, 0, 0],
      mixamorigLeftFoot: [18, 0, 0],
      mixamorigRightFoot: [50, 0, 0],
    }),
  },
  {
    id: 'double-knee',
    label: '双膝跪',
    pose: makePoseOffset({
      mixamorigHips: [-22, 0, 0],
      mixamorigSpine: [12, 0, 0],
      mixamorigLeftArm: [12, -4, 2],
      mixamorigRightArm: [12, 4, -2],
      mixamorigLeftForeArm: [26, -4, 0],
      mixamorigRightForeArm: [26, 4, 0],
      mixamorigLeftUpLeg: [46, 0, 0],
      mixamorigRightUpLeg: [46, 0, 0],
      mixamorigLeftLeg: [-118, 0, 0],
      mixamorigRightLeg: [-118, 0, 0],
      mixamorigLeftFoot: [56, 0, 0],
      mixamorigRightFoot: [56, 0, 0],
    }),
  },
]

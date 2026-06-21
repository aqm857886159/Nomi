// 运镜参考工具的「语义词汇表」：人话运镜 → 3D 相机轨迹参数。
// 工具(create_camera_move)的 schema 描述直接引用这里的取值，单一真相源。
// 配 cameraMoveBuilder.ts（词汇 → Scene3DState）。见 docs/plan/2026-06-22-ai-camera-move-tool.md。
// 景别(StagingShot/SHOT_FRAMING)复用站位词汇表，不重复（单一真相源）。

import { SHOT_FRAMING, type StagingShot } from './stagingVocab'

export { SHOT_FRAMING }
export type { StagingShot }

// 运镜类型 = 10 个常用电影运镜。
export type CameraMove =
  | 'orbit_left'
  | 'orbit_right'
  | 'push_in'
  | 'pull_out'
  | 'crane_up'
  | 'crane_down'
  | 'track_left'
  | 'track_right'
  | 'arc_left'
  | 'arc_right'

export const CAMERA_MOVES: CameraMove[] = [
  'orbit_left',
  'orbit_right',
  'push_in',
  'pull_out',
  'crane_up',
  'crane_down',
  'track_left',
  'track_right',
  'arc_left',
  'arc_right',
]

// 运镜速度 → 时长（秒），落在 Seedance 3-8s 甜区内。
export type CameraSpeed = 'slow' | 'medium' | 'fast'
export const CAMERA_SPEED_DURATION: Record<CameraSpeed, number> = { slow: 8, medium: 5, fast: 3 }

// 运镜中文标签（轨迹命名 / UI 用）。
export const CAMERA_MOVE_LABEL: Record<CameraMove, string> = {
  orbit_left: '左环绕',
  orbit_right: '右环绕',
  push_in: '推近',
  pull_out: '拉远',
  crane_up: '升镜',
  crane_down: '降镜',
  track_left: '左横移跟拍',
  track_right: '右横移跟拍',
  arc_left: '左弧线',
  arc_right: '右弧线',
}

// 运镜专属景别（distance/fov）——**不复用站位的 SHOT_FRAMING**（那套为「主体占画面」收紧，
// 可见竖向 < 主体身高 2.5，运镜里会把头/脚裁掉）。运镜要让整个 2.5 高的主体始终在框内且留余量：
// 目标「可见竖向 = 2·distance·tan(fov/2) ≥ 3.0」（主体 2.5 + 约 20% 余量），逐景别已验算（见单测）：
//   wide  : 2·7  ·tan(20°) ≈ 5.10
//   medium: 2·4.8·tan(20°) ≈ 3.49
//   close : 2·3.6·tan(23°) ≈ 3.06
// push_in 的近端距离 = medium 距离，故推到底也不裁。
export const CAMERA_MOVE_FRAMING: Record<StagingShot, { distance: number; fov: number }> = {
  wide: { distance: 7, fov: 40 },
  medium: { distance: 4.8, fov: 40 },
  close: { distance: 3.6, fov: 46 },
}

// 运镜人话描述（喂给 AI 的 schema，让它选对运镜）。
export const CAMERA_MOVE_DESC: Record<CameraMove, string> = {
  orbit_left: '相机绕主体逆时针大角度环绕（约 300°），展示主体四周空间。',
  orbit_right: '相机绕主体顺时针大角度环绕（约 300°），展示主体四周空间。',
  push_in: '相机正面推近主体，逐渐放大主体、强化压迫感或聚焦。',
  pull_out: '相机从主体拉远，逐渐揭示环境、收尾或退场感。',
  crane_up: '相机在主体前方升高（升降臂上摇），从平视升到俯视。',
  crane_down: '相机在主体前方降低，从俯视降到平视或仰视。',
  track_left: '相机在主体前方向左横移跟拍（平移），保持距离不变。',
  track_right: '相机在主体前方向右横移跟拍（平移），保持距离不变。',
  arc_left: '相机绕主体逆时针小角度弧线（约 90°），轻微换视角。',
  arc_right: '相机绕主体顺时针小角度弧线（约 90°），轻微换视角。',
}

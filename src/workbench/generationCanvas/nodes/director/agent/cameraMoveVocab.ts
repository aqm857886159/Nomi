/**
 * [INPUT]: 依赖 ./stagingVocab 的 SHOT_FRAMING / StagingShot（景别复用站位词表，单一真相源）
 * [OUTPUT]: 对外提供 CameraMove / CAMERA_MOVES / ZOOM_MOVES、CameraSpeed / CAMERA_SPEED_DURATION、CAMERA_MOVE_LABEL、CAMERA_MOVE_FRAMING、CAMERA_MOVE_DESC，再导出 SHOT_FRAMING / StagingShot
 * [POS]: director/agent 的运镜词汇表（原 V1 cameraMoveVocab，切换门入籍）：13 个电影运镜（10 个机位运动 + 3 个变焦族），
 *        create_camera_move 工具 schema 与工具摘要 / 手动运镜控件都从这里取；配 ./cameraMoveBuilder。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { SHOT_FRAMING, type StagingShot } from './stagingVocab'

export { SHOT_FRAMING }
export type { StagingShot }

export type CameraMove =
  | 'orbit_left' | 'orbit_right' | 'push_in' | 'pull_out' | 'crane_up' | 'crane_down'
  | 'track_left' | 'track_right' | 'arc_left' | 'arc_right' | 'zoom_in' | 'zoom_out' | 'dolly_zoom'

export const CAMERA_MOVES: CameraMove[] = [
  'orbit_left', 'orbit_right', 'push_in', 'pull_out', 'crane_up', 'crane_down',
  'track_left', 'track_right', 'arc_left', 'arc_right', 'zoom_in', 'zoom_out', 'dolly_zoom',
]

// 变焦族（FOV 随段进度渐变）
export const ZOOM_MOVES = new Set<CameraMove>(['zoom_in', 'zoom_out', 'dolly_zoom'])

// 运镜速度 → 时长（秒），落在 Seedance 3-8s 甜区内
export type CameraSpeed = 'slow' | 'medium' | 'fast'
export const CAMERA_SPEED_DURATION: Record<CameraSpeed, number> = { slow: 8, medium: 5, fast: 3 }

export const CAMERA_MOVE_LABEL: Record<CameraMove, string> = {
  orbit_left: '左环绕', orbit_right: '右环绕', push_in: '推近', pull_out: '拉远', crane_up: '升镜', crane_down: '降镜',
  track_left: '左横移跟拍', track_right: '右横移跟拍', arc_left: '左弧线', arc_right: '右弧线',
  zoom_in: '变焦推', zoom_out: '变焦拉', dolly_zoom: '希区柯克变焦',
}

// 运镜专属景别（distance/fov）：让整个 2.5 高的主体始终在框内且留余量（可见竖向 = 2·distance·tan(fov/2) ≥ 3.0）
export const CAMERA_MOVE_FRAMING: Record<StagingShot, { distance: number; fov: number }> = {
  wide: { distance: 7, fov: 40 },
  medium: { distance: 4.8, fov: 40 },
  close: { distance: 3.6, fov: 46 },
}

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
  zoom_in: '机位不动，镜头变焦推近（FOV 收窄），画面放大、空间压缩感。',
  zoom_out: '机位不动，镜头变焦拉远（FOV 放宽），画面变广、揭示环境。',
  dolly_zoom: '希区柯克变焦：机位后拉同时变焦推近，主体大小不变、背景被抽离拉伸（眩晕感）。',
}

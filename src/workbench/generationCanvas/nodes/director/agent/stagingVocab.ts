/**
 * [OUTPUT]: 对外提供站位词表：StagingLayout / StagingFacing / StagingCameraAngle / StagingCameraHeight / StagingShot / StagingEnvironment、
 *           CAMERA_ANGLE_AZIMUTH_DEG、CAMERA_HEIGHT_POSE、SHOT_FRAMING、ENV_PRESET、STAGING_CHARACTER_SPACING、SHOT_SPACING_SCALE、LAYOUT_CAMERA_DEFAULT
 * [POS]: director/agent 的「人话 → 3D 参数」站位词汇表（原 V1 stagingVocab，切换门入籍）：create_staging_reference 工具 schema 的取值来源，
 *        配 ./stagingBuilder（词汇 → V1 形状场景 → 迁移成 director 工程）。数值仍按 V1 世界（假人 2.5 高）定义，迁移器负责换算。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type StagingLayout = 'solo' | 'facing' | 'side-by-side' | 'line' | 'behind' | 'circle'
export type StagingFacing = 'toward' | 'away' | 'camera' | 'left' | 'right'
export type StagingCameraAngle = 'front' | 'three-quarter' | 'side' | 'back'
export type StagingCameraHeight = 'eye' | 'low' | 'high' | 'overhead'
export type StagingShot = 'wide' | 'medium' | 'close'
export type StagingEnvironment = 'studio' | 'day' | 'night'

// 相机方位角（绕 Y，度）：0=正前方（角色默认朝 +Z 即朝镜头）
export const CAMERA_ANGLE_AZIMUTH_DEG: Record<StagingCameraAngle, number> = { front: 0, 'three-quarter': 35, side: 90, back: 180 }

// 相机高度 → 机位 Y 与注视点 Y（V1 世界单位；角色约 2.5 高，胸口约 1.4）
export const CAMERA_HEIGHT_POSE: Record<StagingCameraHeight, { camY: number; targetY: number; distanceScale: number }> = {
  eye: { camY: 1.45, targetY: 1.35, distanceScale: 1 },
  low: { camY: 0.7, targetY: 1.7, distanceScale: 1 },
  high: { camY: 3.0, targetY: 1.0, distanceScale: 1 },
  overhead: { camY: 6.0, targetY: 0.6, distanceScale: 0.5 },
}

// 景别 → 水平距离与 fov（主体占画面：wide 全身带余、medium 收紧、close 近）
export const SHOT_FRAMING: Record<StagingShot, { distance: number; fov: number }> = {
  wide: { distance: 5.2, fov: 42 },
  medium: { distance: 3.6, fov: 38 },
  close: { distance: 2.5, fov: 34 },
}

export const ENV_PRESET: Record<StagingEnvironment, { backgroundColor: string; showSky: boolean; darkMode: boolean }> = {
  studio: { backgroundColor: '#f6f3ee', showSky: false, darkMode: false },
  day: { backgroundColor: '#cfe3f5', showSky: true, darkMode: false },
  night: { backgroundColor: '#161c28', showSky: false, darkMode: true },
}

// 角色脚下站位间距（角色 scale 2.5，约 1 单位宽，留余量）
export const STAGING_CHARACTER_SPACING = 1.5

// 景别 → 间距缩放：近景收紧、全景略放
export const SHOT_SPACING_SCALE: Record<StagingShot, number> = { close: 0.62, medium: 1, wide: 1.15 }

// 每个 layout 的「最佳默认机位」（agent 没显式指定 angle/height 时用）
export const LAYOUT_CAMERA_DEFAULT: Record<StagingLayout, { angle?: StagingCameraAngle; height?: StagingCameraHeight }> = {
  solo: { angle: 'front', height: 'eye' },
  facing: { angle: 'three-quarter', height: 'eye' },
  'side-by-side': { angle: 'front', height: 'eye' },
  line: { angle: 'side', height: 'eye' },
  behind: { angle: 'three-quarter', height: 'high' },
  circle: { angle: 'front', height: 'high' },
}

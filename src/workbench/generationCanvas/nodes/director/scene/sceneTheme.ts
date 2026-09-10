/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 DirectorViewportTheme、VIEWPORT_THEMES（default 深邃黑 / neutral-gray Blender 灰）、
 *           GIZMO_COLORS、CAMERA_STATE_COLORS、CAMERA_BODY_COLOR、PREVIEW_COLORS、SKELETON_COLORS、CHARACTER_COLOR_PRESETS、CLAY_COLOR
 * [POS]: director/scene 的 3D 世界内颜色单一真相（世界内颜色与 UI 主题无关、不走 token；对齐设计系统「3D 场景颜色主题不变」）。
 *        
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type DirectorViewportTheme = 'default' | 'neutral-gray'

export type ViewportThemeSpec = {
  skyColor: string
  gridCenterColor: number
  gridColor: number
  groundColor: number
  groundOpacity: number
  axesColored: boolean
}

export const VIEWPORT_THEMES: Record<DirectorViewportTheme, ViewportThemeSpec> = {
  default: {
    skyColor: '#1a1a1a',
    gridCenterColor: 0x444444,
    gridColor: 0x222222,
    groundColor: 0x222222,
    groundOpacity: 0.2,
    axesColored: false,
  },
  'neutral-gray': {
    skyColor: '#303030',
    gridCenterColor: 0x5a5a5a,
    gridColor: 0x3c3c3c,
    groundColor: 0x303030,
    groundOpacity: 0,
    axesColored: true,
  },
}

export const GIZMO_COLORS = { x: 0xef4444, y: 0x16a34a, z: 0x3b82f6 } as const
// 骨骼层：骨骼球青、选中红；IK 把手琥珀、选中红
// 动作库弹窗的预览小场景（#141416 底、灰网格）
export const PREVIEW_COLORS = { background: 0x141416, gridMajor: 0x3f3f46, gridMinor: 0x27272a } as const
// 骨骼层（2026-09-04 用户参考图：细菱形骨按链分色 + 小黄点关节；选中红）；把手沿用琥珀 / 选中红
export const SKELETON_COLORS = { boneSpine: 0xa78bfa, boneArm: 0x38bdf8, boneLeg: 0x2dd4bf, joint: 0xfbbf24, boneSelected: 0xff0000, handle: 0xf59e0b, handleSelected: 0xef4444 } as const

// 机位机身底色（程序化几何，深灰金属；emissive 按四态叠）
export const CAMERA_BODY_COLOR = 0x2a2a2e
// 相机模型四态：选中 / 激活（主视口在看） / 预览（画中画在看） / 默认
export const CAMERA_STATE_COLORS = {
  selected: 0x00ffcc,
  active: 0xffb400,
  preview: 0x38bdf8,
  idle: 0x00a2ff,
} as const

export const CHARACTER_COLOR_PRESETS = [
  { id: 'plaster', value: '#e0e3e8' },
  { id: 'sky', value: '#38bdf8' },
  { id: 'coral', value: '#fb7185' },
  { id: 'apricot', value: '#fb923c' },
  { id: 'mint', value: '#34d399' },
  { id: 'violet', value: '#a78bfa' },
  { id: 'sun', value: '#facc15' },
  { id: 'neutral', value: '#c7cbd1' },
] as const

export const CLAY_COLOR = 0xe0e0e8
export const CLAY_EDGE_COLOR = 0x303440
export const DEFAULT_PRIMITIVE_COLOR = '#e2e8f0'
export const PLACEMENT_RING_COLOR = 0x38bdf8

// 路径可视化（S2）：曲线 / 路标 / 画笔预览；路标选中态与 gizmo 黄轴同色系
export const TRAJECTORY_COLORS = { line: 0x60a5fa, lineCamera: 0xf472b6, waypoint: 0x93c5fd, waypointSelected: 0xfacc15, waypointActive: 0xffffff, ghost: 0x38bdf8 } as const

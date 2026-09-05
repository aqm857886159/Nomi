export type EditingPanelPreset = 'default' | 'focus' | 'result' | 'portrait' | 'custom'

export type EditingPanelVisibility = {
  source: boolean
  inspector: boolean
  assistant: boolean
}

export type EditingPanelLayout = {
  sourceWidth: number
  inspectorWidth: number
  assistantWidth: number
  timelineHeight: number
  visibility: EditingPanelVisibility
  preset: EditingPanelPreset
}

export const EDITING_PANEL_DEFAULTS: EditingPanelLayout = {
  sourceWidth: 300,
  inspectorWidth: 240,
  assistantWidth: 390,
  timelineHeight: 260,
  visibility: { source: true, inspector: true, assistant: true },
  preset: 'default',
}

export const EDITING_PANEL_PRESETS: Record<Exclude<EditingPanelPreset, 'custom'>, EditingPanelLayout> = {
  default: EDITING_PANEL_DEFAULTS,
  focus: { ...EDITING_PANEL_DEFAULTS, visibility: { source: false, inspector: false, assistant: true }, preset: 'focus' },
  result: { ...EDITING_PANEL_DEFAULTS, visibility: { source: false, inspector: false, assistant: false }, preset: 'result' },
  portrait: { ...EDITING_PANEL_DEFAULTS, sourceWidth: 260, inspectorWidth: 220, assistantWidth: 320, timelineHeight: 240, preset: 'portrait' },
}

/**
 * 合同 §2.1 的默认 / 最小尺寸表，**像素**。
 * react-resizable-panels v4 把数字当像素、把无单位字符串当百分比，所以这张表就是面板 props 本身，
 * 无需换算——单一真相，改这里等于改界面与 Agent 契约两处。
 */
export const EDITING_PANEL_BOUNDS = {
  source: { min: 240, max: 520 },
  inspector: { min: 200, max: 420 },
  assistant: { min: 320, max: 600 },
  timeline: { min: 140, max: 360 },
  /** 预览列不可收起，只有下限。 */
  preview: { min: 480 },
  /** 舞台行（预览 + 左右两栏）的高度下限，给时间轴让出 260 后仍能站住画面。 */
  stage: { min: 260 },
} as const

/**
 * 左三块（镜头 / 预览 / 属性）合起来的最小宽度。
 * 直接由三块的下限相加 derive，别再手写一个数——那正是「同一语义两份定义」的老坑。
 */
export const EDITING_PANEL_MAIN_MIN =
  EDITING_PANEL_BOUNDS.source.min + EDITING_PANEL_BOUNDS.preview.min + EDITING_PANEL_BOUNDS.inspector.min

/** 收起后的图标条宽度（合同 §2.1：32px）。 */
export const EDITING_PANEL_RAIL_WIDTH = 32

export type EditingPanelSizeKey = 'sourceWidth' | 'inspectorWidth' | 'assistantWidth' | 'timelineHeight'

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)))
}

export function clampEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return {
    ...layout,
    sourceWidth: clamp(layout.sourceWidth, EDITING_PANEL_BOUNDS.source),
    inspectorWidth: clamp(layout.inspectorWidth, EDITING_PANEL_BOUNDS.inspector),
    assistantWidth: clamp(layout.assistantWidth, EDITING_PANEL_BOUNDS.assistant),
    timelineHeight: clamp(layout.timelineHeight, EDITING_PANEL_BOUNDS.timeline),
    visibility: { ...layout.visibility },
  }
}

export function cloneEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return { ...layout, visibility: { ...layout.visibility } }
}

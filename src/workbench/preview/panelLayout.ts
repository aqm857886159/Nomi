import { z } from 'zod'
import { ASSISTANT_WIDTH_MIN, ASSISTANT_WIDTH_MAX, clampAssistantWidth } from '../assistantWidthBounds'
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
  assistant: { min: ASSISTANT_WIDTH_MIN, max: ASSISTANT_WIDTH_MAX },
  timeline: { min: 140, max: 360 },
  /** 预览列不可收起，只有下限。 */
  preview: { min: 480 },
  /** 舞台行（预览 + 左右两栏）的高度下限，给时间轴让出 260 后仍能站住画面。 */
  stage: { min: 260 },
} as const

/** 收起后的图标条宽度（合同 §2.1：32px）。 */
export const EDITING_PANEL_RAIL_WIDTH = 32

export type EditingPanelSizeKey = 'sourceWidth' | 'inspectorWidth' | 'assistantWidth' | 'timelineHeight'

/** 能被拖成收起条的两栏（Nomi 那列不在面板组里，收起后由顶栏角标叫回）。 */
const COLLAPSIBLE_PANEL_BY_SIZE_KEY: Partial<Record<EditingPanelSizeKey, keyof EditingPanelVisibility>> = {
  sourceWidth: 'source',
  inspectorWidth: 'inspector',
}

export type EditingPanelResizeEffect =
  | { kind: 'visibility'; panel: keyof EditingPanelVisibility; visible: boolean }
  | { kind: 'size'; size: number }
  | null

/**
 * 面板库回报一次尺寸，store 该做什么。「收起」只有 store 一份真相（visibility）：
 * 拖过最小宽度，面板库会把栏吸成收起条；从收起条拖开同理——这一跨必须写回 visibility，内容才跟着换。
 * 此前 ≤ rail 宽的回报被直接丢掉：栏宽收成 32px，内容仍按展开态画，镜头 / 素材标签与整块面板挤成一条
 * （2026-09-25「素材标签页重叠」）。收起态量到的是 rail 宽，不是用户挑的宽度，不写回尺寸。
 */
export function editingPanelResizeEffect(key: EditingPanelSizeKey, pixels: number, visible: boolean): EditingPanelResizeEffect {
  const panel = COLLAPSIBLE_PANEL_BY_SIZE_KEY[key]
  const collapsedNow = pixels <= EDITING_PANEL_RAIL_WIDTH
  if (panel && collapsedNow === visible) return { kind: 'visibility', panel, visible: !collapsedNow }
  if (!visible || collapsedNow) return null
  return { kind: 'size', size: Math.round(pixels) }
}

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)))
}

export function clampEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return {
    ...layout,
    sourceWidth: clamp(layout.sourceWidth, EDITING_PANEL_BOUNDS.source),
    inspectorWidth: clamp(layout.inspectorWidth, EDITING_PANEL_BOUNDS.inspector),
    assistantWidth: clampAssistantWidth(layout.assistantWidth, typeof window === 'undefined' ? 0 : window.innerWidth),
    timelineHeight: clamp(layout.timelineHeight, EDITING_PANEL_BOUNDS.timeline),
    visibility: { ...layout.visibility },
  }
}

export function cloneEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return { ...layout, visibility: { ...layout.visibility } }
}

/** Persisted layout is validated before the normalizer retains it. */
export const editingPanelLayoutSchema: z.ZodType<EditingPanelLayout> = z.object({
  sourceWidth: z.number().finite(), inspectorWidth: z.number().finite(),
  assistantWidth: z.number().finite(), timelineHeight: z.number().finite(),
  visibility: z.object({ source: z.boolean(), inspector: z.boolean(), assistant: z.boolean() }),
  preset: z.custom<EditingPanelPreset>(value => typeof value === 'string' && (value === 'custom' || Object.prototype.hasOwnProperty.call(EDITING_PANEL_PRESETS, value))),
})

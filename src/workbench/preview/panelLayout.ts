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

export function clampEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return {
    ...layout,
    sourceWidth: Math.max(240, Math.min(520, Math.round(layout.sourceWidth))),
    inspectorWidth: Math.max(200, Math.min(420, Math.round(layout.inspectorWidth))),
    assistantWidth: Math.max(320, Math.min(600, Math.round(layout.assistantWidth))),
    timelineHeight: Math.max(140, Math.min(360, Math.round(layout.timelineHeight))),
    visibility: { ...layout.visibility },
  }
}

export function cloneEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return { ...layout, visibility: { ...layout.visibility } }
}

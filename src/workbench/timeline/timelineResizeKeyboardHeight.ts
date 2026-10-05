import { TIMELINE_PANEL_MAX, TIMELINE_PANEL_MIN } from './timelinePanelBounds'

export function timelineResizeKeyboardHeight(current: number, key: string): number | null {
  if (key === 'ArrowUp') return current + 16
  if (key === 'ArrowDown') return current - 16
  if (key === 'Home') return TIMELINE_PANEL_MIN
  if (key === 'End') return TIMELINE_PANEL_MAX
  return null
}
